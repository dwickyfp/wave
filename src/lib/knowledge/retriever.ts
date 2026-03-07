import "server-only";

import { rerank } from "ai";
import { KnowledgeQueryResult, KnowledgeSection } from "app-types/knowledge";
import { createRerankingModelFromConfig } from "lib/ai/provider-factory";
import { knowledgeRepository } from "lib/db/repository";
import { settingsRepository } from "lib/db/repository";
import { embedSingleText } from "./embedder";

// Minimal group interface — satisfied by both KnowledgeGroup and KnowledgeSummary
type GroupForRetrieval = {
  id: string;
  name: string;
  embeddingModel: string;
  embeddingProvider: string;
  rerankingModel?: string | null;
  rerankingProvider?: string | null;
  /** Minimum relevance score (0–1) to include a result. 0 = no filtering. */
  retrievalThreshold?: number | null;
};

type RetrievalScope = GroupForRetrieval & {
  isInherited: boolean;
};

// ─── Tuning Constants ──────────────────────────────────────────────────────────
const RRF_K = 60;
/** Per-search-arm candidate limit (increased for better recall) */
const CANDIDATE_LIMIT = 50;
/** Post-RRF, pre-rerank cap */
const FINAL_BEFORE_RERANK = 25;
/** Default final topN returned */
const FINAL_AFTER_RERANK = 10;
/** Minimum cosine similarity to keep a vector result (filters noise) */
const MIN_VECTOR_SCORE = 0.25;
/** Vector search results get a weight boost in RRF (semantic > keyword) */
const VECTOR_RRF_WEIGHT = 1.5;
/** How many top results to expand with neighbor chunks */
const NEIGHBOR_EXPAND_TOP = 3;
/** Maximum multiplicative boost from document metadata relevance. */
const DOC_META_BOOST_MAX = 0.35;
/** Whether doc-level metadata vector scoring is enabled. */
const DOC_META_VECTOR_ENABLED = process.env.DOC_META_VECTOR_ENABLED !== "false";
/** Freshness share in final doc ranking: effective = (1-w)*relevance + w*freshness */
const DOC_META_RERANK_WEIGHT = Math.min(
  0.5,
  Math.max(0, Number(process.env.DOC_META_RERANK_WEIGHT ?? "0.1")),
);

async function resolveRetrievalScopes(
  group: GroupForRetrieval,
): Promise<RetrievalScope[]> {
  const scopes = await knowledgeRepository
    .selectRetrievalScopes(group.id)
    .catch(() => []);
  if (scopes.length === 0) {
    return [{ ...group, isInherited: false }];
  }

  // Always trust the runtime group object for the primary scope so UI-updated
  // settings are applied immediately for the active group.
  const primary: RetrievalScope = { ...group, isInherited: false };
  const inherited = scopes
    .filter((scope) => scope.id !== group.id)
    .map((scope) => ({ ...scope, isInherited: true }));
  return [primary, ...inherited];
}

// ─── Shared Scoring Helpers ───────────────────────────────────────────────────

function normalizeDocScores(
  rows: Array<{ documentId: string; score: number }>,
): Map<string, number> {
  if (rows.length === 0) return new Map();
  const maxScore = Math.max(...rows.map((r) => Number(r.score) || 0), 0);
  if (maxScore <= 0) return new Map();

  const out = new Map<string, number>();
  for (const row of rows) {
    out.set(row.documentId, Math.max(0, Number(row.score) / maxScore));
  }
  return out;
}

function buildDocumentSignalMap(
  lexicalRows: Array<{ documentId: string; score: number }>,
  semanticRows: Array<{ documentId: string; score: number }>,
): Map<string, number> {
  const lexical = normalizeDocScores(lexicalRows);
  const semantic = normalizeDocScores(semanticRows);
  const docIds = new Set([...lexical.keys(), ...semantic.keys()]);

  const out = new Map<string, number>();
  for (const docId of docIds) {
    const lexicalScore = lexical.get(docId) ?? 0;
    const semanticScore = semantic.get(docId) ?? 0;
    // Metadata lexical matches are a stronger precision signal.
    out.set(docId, lexicalScore * 0.65 + semanticScore * 0.35);
  }
  return out;
}

function applyDocumentBoost(
  merged: KnowledgeQueryResult[],
  docSignalMap: Map<string, number>,
): KnowledgeQueryResult[] {
  if (merged.length === 0 || docSignalMap.size === 0) return merged;

  const boosted = merged.map((r) => {
    const docSignal = docSignalMap.get(r.documentId) ?? 0;
    const boostedScore = r.score * (1 + DOC_META_BOOST_MAX * docSignal);
    return { ...r, score: boostedScore };
  });

  boosted.sort((a, b) => b.score - a.score);
  const maxScore = boosted[0]?.score ?? 0;
  if (maxScore <= 0) return boosted;
  return boosted.map((r) => ({ ...r, score: r.score / maxScore }));
}

async function getDocumentMetadataSignals(
  groupId: string,
  query: string,
  queryEmbedding?: number[],
): Promise<Map<string, number>> {
  const lexicalPromise = knowledgeRepository.searchDocumentMetadata(
    groupId,
    query,
    CANDIDATE_LIMIT,
  );
  const semanticPromise =
    DOC_META_VECTOR_ENABLED && queryEmbedding
      ? knowledgeRepository.vectorSearchDocumentMetadata(
          groupId,
          queryEmbedding,
          CANDIDATE_LIMIT,
        )
      : Promise.resolve([]);

  const [lexicalRows, semanticRows] = await Promise.all([
    lexicalPromise.catch(() => []),
    semanticPromise.catch(() => []),
  ]);

  return buildDocumentSignalMap(lexicalRows, semanticRows);
}

// ─── Query Expansion ───────────────────────────────────────────────────────────

/**
 * Generates alternative query formulations to improve recall.
 * Uses lightweight text transforms (no LLM call) — fast and free.
 *
 * Strategies:
 * 1. Keyword extraction — strip stop words and question phrasing
 * 2. Hypothetical answer prefix — "The answer is about:" + query keywords
 * 3. Contextual rewrite — rephrase as a declarative statement
 */
function expandQuery(query: string): string[] {
  const variants: string[] = [];
  const trimmed = query.trim();

  // Skip expansion for very short or very long queries
  if (trimmed.length < 8 || trimmed.length > 500) return variants;

  // 1. Keyword extraction: strip common question words and stopwords
  const stopWords = new Set([
    "what",
    "how",
    "why",
    "when",
    "where",
    "who",
    "which",
    "is",
    "are",
    "was",
    "were",
    "do",
    "does",
    "did",
    "can",
    "could",
    "would",
    "should",
    "the",
    "a",
    "an",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "and",
    "or",
    "but",
    "not",
    "this",
    "that",
    "it",
    "its",
    "my",
    "your",
    "tell",
    "me",
    "about",
    "please",
    "explain",
    "describe",
  ]);
  const keywords = trimmed
    .toLowerCase()
    .replace(/[?!.,;:'"()[\]{}]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  if (keywords.length >= 2 && keywords.length < 20) {
    variants.push(keywords.join(" "));
  }

  // 2. Hypothetical document prefix (lightweight HyDE)
  // Wrapping the query as if it's the beginning of an answer
  // helps embed closer to actual answer content
  if (keywords.length >= 2) {
    variants.push(`Information about ${keywords.slice(0, 8).join(" ")}`);
  }

  return variants;
}

// ─── RRF Merge ─────────────────────────────────────────────────────────────────

/**
 * Weighted Reciprocal Rank Fusion.
 * Merges multiple ranked lists into a single list. Each source can have
 * a weight multiplier applied to its RRF score contributions.
 */
function weightedRrfMerge(
  rankedLists: Array<{ results: KnowledgeQueryResult[]; weight: number }>,
): KnowledgeQueryResult[] {
  const scores = new Map<
    string,
    { result: KnowledgeQueryResult; score: number }
  >();

  for (const { results, weight } of rankedLists) {
    results.forEach((r, rank) => {
      const rrfScore = (weight * 1) / (RRF_K + rank + 1);
      const existing = scores.get(r.chunk.id);
      if (existing) {
        existing.score += rrfScore;
        // Keep the result with the higher original score
        if (r.score > existing.result.score) {
          existing.result = r;
        }
      } else {
        scores.set(r.chunk.id, { result: r, score: rrfScore });
      }
    });
  }

  const merged = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ result, score }) => ({ ...result, score }));

  // Normalize to 0-1 so retrievalThreshold behaves intuitively in UI.
  // Raw RRF scores are very small (~0.01), which makes threshold filtering
  // overly aggressive even for strong matches.
  const topScore = merged[0]?.score ?? 0;
  if (topScore <= 0) return merged;
  return merged.map((r) => ({ ...r, score: r.score / topScore }));
}

// ─── Neighbor Chunk Expansion ──────────────────────────────────────────────────

/**
 * For the top N results, fetch adjacent chunks (±1) from the same document.
 * This provides surrounding context that often contains critical information
 * that was split during chunking.
 */
async function expandWithNeighborChunks(
  results: KnowledgeQueryResult[],
  groupId: string,
): Promise<KnowledgeQueryResult[]> {
  if (results.length === 0) return results;

  const topResults = results.slice(0, NEIGHBOR_EXPAND_TOP);
  const existingIds = new Set(results.map((r) => r.chunk.id));

  // Collect neighbor chunk requests
  const neighborRequests: Array<{
    documentId: string;
    chunkIndex: number;
  }> = [];

  for (const r of topResults) {
    if (r.chunk.chunkIndex > 0) {
      neighborRequests.push({
        documentId: r.chunk.documentId,
        chunkIndex: r.chunk.chunkIndex - 1,
      });
    }
    neighborRequests.push({
      documentId: r.chunk.documentId,
      chunkIndex: r.chunk.chunkIndex + 1,
    });
  }

  if (neighborRequests.length === 0) return results;

  try {
    const neighbors = await knowledgeRepository.getAdjacentChunks(
      groupId,
      neighborRequests,
    );

    // Build a map of existing results by documentId + chunkIndex for dedup
    const resultKey = (docId: string, idx: number) => `${docId}:${idx}`;
    const existingKeys = new Set(
      results.map((r) => resultKey(r.chunk.documentId, r.chunk.chunkIndex)),
    );

    // Insert neighbor chunks after their source chunk
    const expanded = [...results];
    for (const neighbor of neighbors) {
      const key = resultKey(
        neighbor.chunk.documentId,
        neighbor.chunk.chunkIndex,
      );
      if (!existingIds.has(neighbor.chunk.id) && !existingKeys.has(key)) {
        existingIds.add(neighbor.chunk.id);
        existingKeys.add(key);
        // Give neighbor chunks a slightly lower score to keep them ranked after their source
        expanded.push({ ...neighbor, score: 0 });
      }
    }

    return expanded;
  } catch {
    // If neighbor expansion fails, just return original results
    return results;
  }
}

// ─── Main Query Pipeline ───────────────────────────────────────────────────────

export interface QueryKnowledgeOptions {
  topN?: number;
  userId?: string | null;
  source?: "chat" | "agent" | "mcp";
  skipLogging?: boolean;
}

async function queryKnowledgeSingleScope(
  scope: RetrievalScope,
  query: string,
  topN: number,
): Promise<KnowledgeQueryResult[]> {
  // ── Step 1: Query expansion ──────────────────────────────────────────────
  const queryVariants = expandQuery(query);
  const allQueries = [query, ...queryVariants];

  // ── Step 2: Embed all query variants in parallel ─────────────────────────
  let embeddings: number[][] = [];
  try {
    embeddings = await Promise.all(
      allQueries.map((q) =>
        embedSingleText(q, scope.embeddingProvider, scope.embeddingModel),
      ),
    );
  } catch (err) {
    console.warn(
      `[ContextX] Query embedding failed for group ${scope.id}, using lexical retrieval fallback:`,
      err,
    );
  }

  // ── Step 3: Multi-arm retrieval ──────────────────────────────────────────
  // Run vector search for each query variant + full-text search
  const vectorSearches = embeddings.map((emb) =>
    knowledgeRepository.vectorSearch(scope.id, emb, CANDIDATE_LIMIT),
  );
  const textSearch = knowledgeRepository.fullTextSearch(
    scope.id,
    query,
    CANDIDATE_LIMIT,
  );
  const docSignalPromise = getDocumentMetadataSignals(
    scope.id,
    query,
    embeddings[0],
  );

  const [searchResults, docSignalMap] = await Promise.all([
    Promise.all([...vectorSearches, textSearch]),
    docSignalPromise,
  ]);

  // Last result is full-text, rest are vector searches
  const textResults = searchResults[searchResults.length - 1];
  const allVectorResults = searchResults.slice(0, -1);

  // ── Step 4: Filter low-score vector results ──────────────────────────────
  const filteredVectorResults = allVectorResults.map((results) =>
    results.filter((r) => r.score >= MIN_VECTOR_SCORE),
  );

  // ── Step 5: Weighted RRF merge ───────────────────────────────────────────
  const rankedLists: Array<{
    results: KnowledgeQueryResult[];
    weight: number;
  }> = [];

  // Primary vector search (original query) gets highest weight
  if (filteredVectorResults[0]) {
    rankedLists.push({
      results: filteredVectorResults[0],
      weight: VECTOR_RRF_WEIGHT,
    });
  }

  // Expanded query vectors get slightly less weight
  for (let i = 1; i < filteredVectorResults.length; i++) {
    rankedLists.push({
      results: filteredVectorResults[i],
      weight: VECTOR_RRF_WEIGHT * 0.75,
    });
  }

  // Full-text search with standard weight
  rankedLists.push({ results: textResults, weight: 1.0 });

  const merged = applyDocumentBoost(
    weightedRrfMerge(rankedLists),
    docSignalMap,
  ).slice(0, FINAL_BEFORE_RERANK);

  if (merged.length === 0) {
    return [];
  }

  // ── Step 6: Rerank if configured ─────────────────────────────────────────
  let finalResults = merged;

  if (scope.rerankingProvider && scope.rerankingModel && merged.length > topN) {
    try {
      const providerConfig = await settingsRepository.getProviderByName(
        scope.rerankingProvider,
      );
      const rerankModel = providerConfig
        ? createRerankingModelFromConfig(
            scope.rerankingProvider,
            scope.rerankingModel,
            providerConfig.apiKey,
          )
        : null;

      if (rerankModel) {
        // Use context_summary + content for richer reranking signal
        const documents = merged.map((r) => {
          const parts: string[] = [];
          if (r.chunk.contextSummary) parts.push(r.chunk.contextSummary);
          parts.push(r.chunk.content);
          return parts.join("\n\n");
        });

        const { rerankedDocuments, ranking } = await rerank({
          model: rerankModel,
          query,
          documents,
          topN,
        });

        finalResults = rerankedDocuments.map((_, idx) => {
          const originalIdx = ranking[idx].originalIndex;
          return {
            ...merged[originalIdx],
            rerankScore: ranking[idx].score,
          };
        });
      }
    } catch (err) {
      console.warn("[ContextX] Reranking failed, using RRF results:", err);
      finalResults = merged.slice(0, topN);
    }
  } else {
    finalResults = merged.slice(0, topN);
  }

  // ── Step 7: Apply retrieval threshold ────────────────────────────────────
  const threshold = scope.retrievalThreshold ?? 0;
  if (threshold > 0) {
    finalResults = finalResults.filter(
      (r) => (r.rerankScore ?? r.score) >= threshold,
    );
  }

  // ── Step 8: Neighbor chunk expansion ─────────────────────────────────────
  // After ranking, expand top results with adjacent chunks for richer context
  finalResults = await expandWithNeighborChunks(finalResults, scope.id);

  return finalResults;
}

export async function queryKnowledge(
  group: GroupForRetrieval,
  query: string,
  options: QueryKnowledgeOptions = {},
): Promise<KnowledgeQueryResult[]> {
  const {
    topN = FINAL_AFTER_RERANK,
    userId,
    source = "chat",
    skipLogging = false,
  } = options;
  const start = Date.now();

  const scopes = await resolveRetrievalScopes(group);
  const scopedResults = await Promise.all(
    scopes.map((scope) =>
      queryKnowledgeSingleScope(
        scope,
        query,
        Math.max(topN * 2, FINAL_AFTER_RERANK),
      ).catch(() => []),
    ),
  );

  const mergedByChunk = new Map<string, KnowledgeQueryResult>();
  for (let i = 0; i < scopes.length; i++) {
    const scope = scopes[i];
    const results = scopedResults[i];
    for (const result of results) {
      const enriched: KnowledgeQueryResult = {
        ...result,
        chunk: {
          ...result.chunk,
          metadata: {
            ...(result.chunk.metadata ?? {}),
            sourceGroupId: scope.id,
            sourceGroupName: scope.name,
          },
        },
      };

      const existing = mergedByChunk.get(enriched.chunk.id);
      const enrichedScore = enriched.rerankScore ?? enriched.score;
      const existingScore = existing
        ? (existing.rerankScore ?? existing.score)
        : -Infinity;
      if (!existing || enrichedScore > existingScore) {
        mergedByChunk.set(enriched.chunk.id, enriched);
      }
    }
  }

  const merged = Array.from(mergedByChunk.values())
    .sort((a, b) => (b.rerankScore ?? b.score) - (a.rerankScore ?? a.score))
    .slice(0, topN);

  if (!skipLogging) {
    const latencyMs = Date.now() - start;
    knowledgeRepository
      .insertUsageLog({
        groupId: group.id,
        userId: userId ?? null,
        query,
        source,
        chunksRetrieved: merged.length,
        latencyMs,
      })
      .catch(() => {});
  }

  return merged;
}

export async function queryKnowledgeAsText(
  group: GroupForRetrieval,
  query: string,
  options: QueryKnowledgeOptions = {},
): Promise<string> {
  const results = await queryKnowledge(group, query, options);

  if (results.length === 0) {
    return `[Knowledge: ${group.name}]\nNo relevant content found for: "${query}"`;
  }

  const citations = results
    .map((r, i) => {
      // Embed documentId as a knowledge:// link so the frontend can open a preview
      const docLink = `[**${r.documentName}**](knowledge://${group.id}/${r.documentId})`;
      const summary = r.chunk.contextSummary
        ? `\n*Context: ${r.chunk.contextSummary}*`
        : "";
      return `[${i + 1}] ${docLink} (relevance: ${(r.rerankScore ?? r.score).toFixed(2)})${summary}\n\n${r.chunk.content}`;
    })
    .join("\n\n---\n\n");

  return `[Knowledge: ${group.name}]\n\n${citations}`;
}

// ─── Context7-Style Full-Doc Retrieval ─────────────────────────────────────────

/** Default token budget for full-doc retrieval (like Context7's default) */
const DEFAULT_FULL_DOC_TOKENS = 10000;
const MAX_FULL_DOC_TOKENS = 50000;

/**
 * Estimate token count for a string (~4 chars per token).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function tokenizeQueryTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3),
    ),
  );
}

type MarkdownSection = {
  index: number;
  heading: string;
  headingLevel: number;
  content: string;
  tokenCount: number;
};

function splitMarkdownIntoSections(markdown: string): MarkdownSection[] {
  const lines = markdown.split("\n");
  const sections: MarkdownSection[] = [];
  let inCodeFence = false;
  let currentHeading = "Introduction";
  let currentLevel = 0;
  let currentLines: string[] = [];

  const flush = () => {
    const content = currentLines.join("\n").trim();
    if (!content) return;
    sections.push({
      index: sections.length,
      heading: currentHeading,
      headingLevel: currentLevel,
      content,
      tokenCount: estimateTokens(content),
    });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
    }

    const headingMatch = !inCodeFence ? line.match(/^(#{1,6})\s+(.+)$/) : null;
    if (headingMatch) {
      flush();
      currentLines = [line];
      currentHeading = headingMatch[2].trim();
      currentLevel = headingMatch[1].length;
      continue;
    }

    currentLines.push(line);
  }

  flush();
  return sections;
}

function trimTextToTokenBudget(text: string, budgetTokens: number): string {
  const charLimit = Math.max(0, budgetTokens * 4);
  if (charLimit <= 0) return "";
  if (text.length <= charLimit) return text;

  let cut = text.slice(0, charLimit);
  const cutAtParagraph = cut.lastIndexOf("\n\n");
  if (cutAtParagraph > charLimit * 0.5) {
    cut = cut.slice(0, cutAtParagraph);
  } else {
    const cutAtLine = cut.lastIndexOf("\n");
    if (cutAtLine > charLimit * 0.6) {
      cut = cut.slice(0, cutAtLine);
    } else {
      const cutAtWord = cut.lastIndexOf(" ");
      if (cutAtWord > charLimit * 0.6) {
        cut = cut.slice(0, cutAtWord);
      }
    }
  }

  return cut.trim();
}

function trimMarkdownByMatchedSections(input: {
  markdown: string;
  query: string;
  budgetTokens: number;
  chunkMatches: KnowledgeQueryResult[];
}): string {
  const { markdown, query, budgetTokens, chunkMatches } = input;
  const sections = splitMarkdownIntoSections(markdown);
  if (sections.length === 0) {
    const fallback = trimTextToTokenBudget(markdown, budgetTokens);
    return fallback
      ? `${fallback}\n\n[... content trimmed for token budget]`
      : "";
  }

  const queryTerms = tokenizeQueryTerms(query);
  const headingHints = chunkMatches
    .map(
      (r) => r.chunk.metadata?.headingPath ?? r.chunk.metadata?.section ?? "",
    )
    .map((s) => s.toLowerCase())
    .filter(Boolean);
  const textHints = chunkMatches
    .map((r) => r.chunk.content.toLowerCase())
    .map((s) => s.slice(0, 220));

  const scored = sections.map((section) => {
    const headingLower = section.heading.toLowerCase();
    const contentLower = section.content.toLowerCase();

    let score = 0;
    for (const term of queryTerms) {
      if (headingLower.includes(term)) score += 2.0;
      if (contentLower.includes(term)) score += 0.8;
    }

    for (const hint of headingHints) {
      if (!hint) continue;
      if (hint.includes(headingLower) || headingLower.includes(hint)) {
        score += 2.5;
      } else {
        const headingParts = hint.split(">").map((p) => p.trim());
        if (headingParts.some((p) => p && headingLower.includes(p))) {
          score += 1.25;
        }
      }
    }

    for (const hint of textHints) {
      if (!hint) continue;
      const snippet = hint.slice(0, 120);
      if (snippet && contentLower.includes(snippet)) {
        score += 1.5;
        break;
      }
    }

    // Prefer higher-level sections when scores tie.
    score += section.headingLevel > 0 ? (7 - section.headingLevel) * 0.02 : 0;

    return { section, score };
  });

  const ranked = [...scored].sort((a, b) => b.score - a.score);
  let remaining = budgetTokens;
  const selected: MarkdownSection[] = [];

  for (const row of ranked) {
    if (remaining < 80) break;
    if (row.score <= 0 && selected.length > 0) break;

    const t = row.section.tokenCount;
    if (t <= remaining) {
      selected.push(row.section);
      remaining -= t;
      continue;
    }

    // Include partial section if nothing selected yet or still enough room.
    if (remaining >= 120) {
      const partial = trimTextToTokenBudget(row.section.content, remaining);
      if (partial) {
        selected.push({
          ...row.section,
          content: `${partial}\n\n[... section trimmed]`,
          tokenCount: estimateTokens(partial),
        });
        remaining = 0;
      }
    }
    break;
  }

  if (selected.length === 0) {
    const fallback = trimTextToTokenBudget(markdown, budgetTokens);
    return fallback
      ? `${fallback}\n\n[... content trimmed for token budget]`
      : "";
  }

  // Preserve original document ordering for readability.
  selected.sort((a, b) => a.index - b.index);
  return `${selected.map((s) => s.content).join("\n\n---\n\n")}\n\n[... content trimmed for token budget]`;
}

type NormalizedDocsResultMode = "section-first" | "full-doc";

function normalizeDocsResultMode(
  resultMode: QueryKnowledgeDocsOptions["resultMode"],
): NormalizedDocsResultMode {
  return resultMode === "full-doc" ? "full-doc" : "section-first";
}

function getSectionGraphVersion(
  metadata?: Record<string, unknown> | null,
): number | null {
  const rawValue = metadata?.sectionGraphVersion;
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return rawValue;
  }
  if (typeof rawValue === "string") {
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type RankedDocCandidate = Omit<
  DocRetrievalResult,
  "markdown" | "matchedSections"
> & {
  sectionGraphVersion: number | null;
};

type SectionBundleCandidate = {
  doc: RankedDocCandidate;
  section: KnowledgeSection;
  matches: KnowledgeQueryResult[];
  score: number;
  hitCount: number;
};

function formatSectionHeading(section: KnowledgeSection): string {
  if (section.partCount > 1) {
    return `${section.headingPath} (Part ${section.partIndex + 1}/${section.partCount})`;
  }
  return section.headingPath;
}

function getSplitSiblingSection(
  section: KnowledgeSection,
  relatedSectionMap: Map<string, KnowledgeSection>,
  direction: "prev" | "next",
): KnowledgeSection | null {
  if (section.partCount <= 1) return null;

  const relatedId =
    direction === "prev" ? section.prevSectionId : section.nextSectionId;
  if (!relatedId) return null;

  const sibling = relatedSectionMap.get(relatedId);
  if (!sibling) return null;
  if (sibling.documentId !== section.documentId) return null;
  if (sibling.headingPath !== section.headingPath) return null;
  return sibling;
}

function buildSectionBundleMarkdown(input: {
  section: KnowledgeSection;
  relatedSectionMap: Map<string, KnowledgeSection>;
  budgetTokens: number;
}): { markdown: string; tokenCount: number } {
  const { section, relatedSectionMap, budgetTokens } = input;
  if (budgetTokens < 100) return { markdown: "", tokenCount: 0 };

  const blocks: string[] = [];
  let remaining = budgetTokens;

  const pushBlock = (
    text: string,
    options: { minTokens?: number; suffixWhenTrimmed?: string } = {},
  ) => {
    const minTokens = options.minTokens ?? 1;
    const tokenCount = estimateTokens(text);
    if (tokenCount <= remaining) {
      blocks.push(text);
      remaining -= tokenCount;
      return true;
    }

    if (remaining < minTokens) return false;

    const trimmed = trimTextToTokenBudget(text, remaining);
    if (!trimmed) return false;

    const finalText = options.suffixWhenTrimmed
      ? `${trimmed}\n\n${options.suffixWhenTrimmed}`.trim()
      : trimmed;
    const finalTokens = estimateTokens(finalText);
    if (finalTokens > remaining) return false;

    blocks.push(finalText);
    remaining -= finalTokens;
    return true;
  };

  if (!pushBlock(`### ${formatSectionHeading(section)}`, { minTokens: 12 })) {
    return { markdown: "", tokenCount: 0 };
  }

  const parentSection = section.parentSectionId
    ? relatedSectionMap.get(section.parentSectionId)
    : undefined;
  if (parentSection?.summary) {
    pushBlock(
      `_Parent context: ${trimTextToTokenBudget(parentSection.summary, 120)}_`,
      { minTokens: 24 },
    );
  }

  const currentContent = section.content.trim();
  if (
    !pushBlock(currentContent, {
      minTokens: 80,
      suffixWhenTrimmed: "[... section trimmed]",
    })
  ) {
    return { markdown: "", tokenCount: 0 };
  }

  const previousPart = getSplitSiblingSection(
    section,
    relatedSectionMap,
    "prev",
  );
  if (previousPart) {
    pushBlock(
      `#### Previous Part\n${trimTextToTokenBudget(previousPart.content, Math.min(220, remaining))}`,
      { minTokens: 40 },
    );
  }

  const nextPart = getSplitSiblingSection(section, relatedSectionMap, "next");
  if (nextPart) {
    pushBlock(
      `#### Next Part\n${trimTextToTokenBudget(nextPart.content, Math.min(220, remaining))}`,
      { minTokens: 40 },
    );
  }

  const markdown = blocks.join("\n\n").trim();
  return {
    markdown,
    tokenCount: markdown ? estimateTokens(markdown) : 0,
  };
}

function normalizeLibraryIdToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/\s+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/-+/g, "-");
}

function toLibrarySlug(value: string): string {
  const normalized = normalizeLibraryIdToken(value);
  const tail = normalized.split("/").filter(Boolean).pop() ?? normalized;
  return tail
    .replace(/[._]/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractHeadingRoot(headingPath?: string): string | null {
  if (!headingPath) return null;
  const root = headingPath
    .split(">")
    .map((s) => s.trim())
    .find(Boolean);
  return root ?? null;
}

function chunkMatchesLibraryScope(input: {
  hit: KnowledgeQueryResult;
  libraryId?: string;
  libraryVersion?: string;
}): boolean {
  const { hit, libraryId, libraryVersion } = input;
  if (!libraryId && !libraryVersion) return true;

  const metadata = hit.chunk.metadata;
  const requestedId = libraryId ? normalizeLibraryIdToken(libraryId) : null;
  const requestedSlug = requestedId ? toLibrarySlug(requestedId) : null;
  const requestedVersion = libraryVersion?.trim().toLowerCase();

  const candidateIds = [
    metadata?.libraryId,
    extractHeadingRoot(metadata?.headingPath ?? undefined),
    metadata?.sectionTitle,
    metadata?.section,
  ]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map(normalizeLibraryIdToken);

  const candidateSlugs = candidateIds.map(toLibrarySlug);

  const idMatched =
    !requestedId ||
    candidateIds.some(
      (id) =>
        id === requestedId ||
        id.includes(requestedId) ||
        requestedId.includes(id),
    ) ||
    (requestedSlug
      ? candidateSlugs.some(
          (slug) =>
            slug === requestedSlug ||
            slug.includes(requestedSlug) ||
            requestedSlug.includes(slug),
        )
      : false);

  if (!idMatched) return false;
  if (!requestedVersion) return true;

  const chunkVersion = metadata?.libraryVersion?.trim().toLowerCase();
  if (!chunkVersion) return true;
  return (
    chunkVersion === requestedVersion ||
    chunkVersion.includes(requestedVersion) ||
    requestedVersion.includes(chunkVersion)
  );
}

export interface QueryKnowledgeDocsOptions {
  topic?: string;
  tokens?: number;
  /** section-first is the default compact mode; matched-sections remains as a compatibility alias. */
  resultMode?: "section-first" | "full-doc" | "matched-sections";
  /** Hard cap of returned documents (applied after ranking/filtering). */
  maxDocs?: number;
  /** Optional library scope (Context7-style query-docs). */
  libraryId?: string;
  /** Optional library version scope. */
  libraryVersion?: string;
  userId?: string | null;
  source?: "chat" | "agent" | "mcp";
}

/**
 * A document-level retrieval result with relevance info.
 */
export interface DocRetrievalResult {
  documentId: string;
  documentName: string;
  sourceGroupId?: string | null;
  sourceGroupName?: string | null;
  isInherited?: boolean;
  /** Aggregated relevance score from chunk-level search */
  relevanceScore: number;
  /** Number of chunks from this document that appeared in search results */
  chunkHits: number;
  /** Markdown payload (full doc or matched section snippets depending on mode) */
  markdown: string;
  /** Optional list of top matched section headings (for UI display). */
  matchedSections?: Array<{
    heading: string;
    score: number;
  }>;
}

async function assembleFullDocResults(input: {
  docsToAssemble: RankedDocCandidate[];
  chunkStats: Map<
    string,
    {
      name: string;
      chunkHits: number;
      sumScore: number;
      maxScore: number;
      matches: KnowledgeQueryResult[];
    }
  >;
  query: string;
  tokenBudget: number;
}): Promise<{ results: DocRetrievalResult[]; tokensUsed: number }> {
  const { docsToAssemble, chunkStats, query, tokenBudget } = input;
  const results: DocRetrievalResult[] = [];
  let tokensUsed = 0;

  for (const doc of docsToAssemble) {
    const remaining = tokenBudget - tokensUsed;
    if (remaining < 120) break;

    const docData = await knowledgeRepository.getDocumentMarkdown(
      doc.documentId,
    );
    if (!docData?.markdown) continue;

    const contentTokens = estimateTokens(docData.markdown);
    if (contentTokens + tokensUsed <= tokenBudget) {
      results.push({
        documentId: doc.documentId,
        documentName: doc.documentName,
        sourceGroupId: doc.sourceGroupId,
        sourceGroupName: doc.sourceGroupName,
        isInherited: doc.isInherited,
        relevanceScore: doc.relevanceScore,
        chunkHits: doc.chunkHits,
        markdown: docData.markdown,
      });
      tokensUsed += contentTokens;
      continue;
    }

    if (remaining < 160) break;
    const truncated = trimMarkdownByMatchedSections({
      markdown: docData.markdown,
      query,
      budgetTokens: remaining,
      chunkMatches: chunkStats.get(doc.documentId)?.matches ?? [],
    });
    if (!truncated) break;

    results.push({
      documentId: doc.documentId,
      documentName: doc.documentName,
      sourceGroupId: doc.sourceGroupId,
      sourceGroupName: doc.sourceGroupName,
      isInherited: doc.isInherited,
      relevanceScore: doc.relevanceScore,
      chunkHits: doc.chunkHits,
      markdown: truncated,
    });
    tokensUsed += estimateTokens(truncated);
    break;
  }

  return { results, tokensUsed };
}

async function assembleSectionFirstResults(input: {
  docsToAssemble: RankedDocCandidate[];
  chunkStats: Map<
    string,
    {
      name: string;
      chunkHits: number;
      sumScore: number;
      maxScore: number;
      matches: KnowledgeQueryResult[];
    }
  >;
  tokenBudget: number;
  threshold: number;
}): Promise<{
  results: DocRetrievalResult[];
  tokensUsed: number;
  sectionCount: number;
}> {
  const { docsToAssemble, chunkStats, tokenBudget, threshold } = input;
  if (docsToAssemble.length === 0) {
    return { results: [], tokensUsed: 0, sectionCount: 0 };
  }

  const sectionCandidates = new Map<
    string,
    {
      doc: RankedDocCandidate;
      matches: KnowledgeQueryResult[];
      topScore: number;
    }
  >();

  for (const doc of docsToAssemble) {
    const matches = chunkStats.get(doc.documentId)?.matches ?? [];
    for (const match of matches) {
      const sectionId = match.chunk.sectionId;
      if (!sectionId) continue;

      const score = Math.max(0, match.rerankScore ?? match.score);
      const existing = sectionCandidates.get(sectionId);
      if (existing) {
        existing.matches.push(match);
        existing.topScore = Math.max(existing.topScore, score);
      } else {
        sectionCandidates.set(sectionId, {
          doc,
          matches: [match],
          topScore: score,
        });
      }
    }
  }

  if (sectionCandidates.size === 0) {
    return { results: [], tokensUsed: 0, sectionCount: 0 };
  }

  const sectionIds = Array.from(sectionCandidates.keys());
  const sections = await knowledgeRepository.getSectionsByIds(sectionIds);
  if (sections.length === 0) {
    return { results: [], tokensUsed: 0, sectionCount: 0 };
  }

  const sectionMap = new Map(sections.map((section) => [section.id, section]));
  const relatedSections =
    await knowledgeRepository.getRelatedSections(sectionIds);
  const relatedSectionMap = new Map(
    [...sections, ...relatedSections].map((section) => [section.id, section]),
  );

  const minConfidence = Math.max(threshold, 0.2);
  const bundles: SectionBundleCandidate[] = Array.from(
    sectionCandidates.entries(),
  )
    .map(([sectionId, candidate]) => {
      const section = sectionMap.get(sectionId);
      if (!section) return null;

      return {
        doc: candidate.doc,
        section,
        matches: candidate.matches,
        score:
          candidate.topScore + Math.min(candidate.matches.length - 1, 3) * 0.05,
        hitCount: candidate.matches.length,
      } satisfies SectionBundleCandidate;
    })
    .filter(
      (bundle): bundle is SectionBundleCandidate =>
        bundle !== null && bundle.score >= minConfidence,
    )
    .sort((a, b) => b.score - a.score);

  if (bundles.length === 0) {
    return { results: [], tokensUsed: 0, sectionCount: 0 };
  }

  const aggregated = new Map<
    string,
    RankedDocCandidate & {
      blocks: string[];
      matchedSections: Array<{ heading: string; score: number }>;
    }
  >();
  let tokensUsed = 0;
  let sectionCount = 0;

  for (const bundle of bundles) {
    const remaining = tokenBudget - tokensUsed;
    if (remaining < 120) break;

    const rendered = buildSectionBundleMarkdown({
      section: bundle.section,
      relatedSectionMap,
      budgetTokens: remaining,
    });
    if (!rendered.markdown) continue;

    tokensUsed += rendered.tokenCount;
    sectionCount += 1;

    const existing = aggregated.get(bundle.doc.documentId);
    if (existing) {
      existing.blocks.push(rendered.markdown);
      existing.matchedSections.push({
        heading: formatSectionHeading(bundle.section),
        score: bundle.score,
      });
      continue;
    }

    aggregated.set(bundle.doc.documentId, {
      ...bundle.doc,
      blocks: [rendered.markdown],
      matchedSections: [
        {
          heading: formatSectionHeading(bundle.section),
          score: bundle.score,
        },
      ],
    });
  }

  const results = docsToAssemble
    .map((doc) => aggregated.get(doc.documentId))
    .filter(Boolean)
    .map((doc) => ({
      documentId: doc!.documentId,
      documentName: doc!.documentName,
      sourceGroupId: doc!.sourceGroupId,
      sourceGroupName: doc!.sourceGroupName,
      isInherited: doc!.isInherited,
      relevanceScore: doc!.relevanceScore,
      chunkHits: doc!.chunkHits,
      markdown: `${doc!.blocks.join("\n\n---\n\n")}\n\n[... section-first context]`,
      matchedSections: doc!.matchedSections,
    }));

  return { results, tokensUsed, sectionCount };
}

/**
 * Context7-style full-document retrieval with semantic ranking.
 *
 * Uses the full RAG pipeline (embedding + BM25 + RRF + reranking) to identify
 * which documents are most relevant to the query, then returns the full
 * markdown content of those ranked documents within a configurable token
 * budget.
 *
 * This provides complete, uncut context to the LLM — trading higher
 * token usage for higher accuracy and coherence.
 */
export async function queryKnowledgeAsDocs(
  group: GroupForRetrieval,
  query: string,
  options: QueryKnowledgeDocsOptions = {},
): Promise<DocRetrievalResult[]> {
  const tokenBudget = Math.min(
    Math.max(options.tokens || DEFAULT_FULL_DOC_TOKENS, 500),
    MAX_FULL_DOC_TOKENS,
  );
  const resultMode = normalizeDocsResultMode(options.resultMode);
  const maxDocs = Math.min(
    Math.max(options.maxDocs ?? (resultMode === "section-first" ? 8 : 50), 1),
    50,
  );
  const start = Date.now();
  const scopes = await resolveRetrievalScopes(group);
  const scopeById = new Map(scopes.map((scope) => [scope.id, scope]));

  // ── Step 1: Gather chunk-level and document-level signals ───────────────
  const chunkResults = await queryKnowledge(group, query, {
    topN: FINAL_BEFORE_RERANK,
    skipLogging: true,
  });

  const docSignalMaps = await Promise.all(
    scopes.map(async (scope) => {
      let queryEmbedding: number[] | undefined;
      if (DOC_META_VECTOR_ENABLED) {
        queryEmbedding = await embedSingleText(
          query,
          scope.embeddingProvider,
          scope.embeddingModel,
        )
          .then((v) => v)
          .catch(() => undefined);
      }
      return getDocumentMetadataSignals(scope.id, query, queryEmbedding);
    }),
  );

  const docSignalMap = new Map<string, number>();
  for (const signalMap of docSignalMaps) {
    for (const [docId, score] of signalMap.entries()) {
      const existing = docSignalMap.get(docId) ?? 0;
      if (score > existing) docSignalMap.set(docId, score);
    }
  }

  const scopedChunkResults = chunkResults.filter((hit) =>
    chunkMatchesLibraryScope({
      hit,
      libraryId: options.libraryId,
      libraryVersion: options.libraryVersion,
    }),
  );
  if (options.libraryId && scopedChunkResults.length === 0) return [];
  if (scopedChunkResults.length === 0 && docSignalMap.size === 0) return [];

  // ── Step 2: Build candidate document set + aggregate chunk signals ──────
  const chunkStats = new Map<
    string,
    {
      name: string;
      chunkHits: number;
      sumScore: number;
      maxScore: number;
      matches: KnowledgeQueryResult[];
    }
  >();

  for (const r of scopedChunkResults) {
    const score = Math.max(0, r.rerankScore ?? r.score);
    const hitIncrement = score > 0 ? 1 : 0;
    const existing = chunkStats.get(r.documentId);
    if (existing) {
      existing.chunkHits += hitIncrement;
      existing.sumScore += score;
      existing.maxScore = Math.max(existing.maxScore, score);
      existing.matches.push(r);
    } else {
      chunkStats.set(r.documentId, {
        name: r.documentName,
        chunkHits: hitIncrement,
        sumScore: score,
        maxScore: score,
        matches: [r],
      });
    }
  }

  const topDocSignalIds =
    options.libraryId || options.libraryVersion
      ? []
      : Array.from(docSignalMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, CANDIDATE_LIMIT)
          .map(([docId]) => docId);

  const candidateDocIds = Array.from(
    new Set([...chunkStats.keys(), ...topDocSignalIds]),
  );
  if (candidateDocIds.length === 0) return [];

  const candidateDocMeta =
    await knowledgeRepository.getDocumentMetadataByIdsAcrossGroups(
      candidateDocIds,
    );
  if (candidateDocMeta.length === 0) return [];

  const allowedGroupIds = new Set(scopes.map((scope) => scope.id));
  const candidateDocMetaInScope = candidateDocMeta.filter((doc) =>
    allowedGroupIds.has(doc.groupId),
  );
  if (candidateDocMetaInScope.length === 0) return [];

  const rawChunkScores = candidateDocMetaInScope.map((doc) => {
    const stats = chunkStats.get(doc.documentId);
    if (!stats) return 0;
    const hitBoost = Math.min(1, stats.chunkHits / 5);
    return stats.sumScore + stats.maxScore * 0.5 + hitBoost * 0.2;
  });
  const maxRawChunkScore = Math.max(...rawChunkScores, 0);

  const now = Date.now();
  const rankedDocs = candidateDocMetaInScope
    .map((doc) => {
      const stats = chunkStats.get(doc.documentId);
      const metadataSignal = docSignalMap.get(doc.documentId) ?? 0;
      const rawChunkScore = stats
        ? stats.sumScore +
          stats.maxScore * 0.5 +
          Math.min(1, stats.chunkHits / 5) * 0.2
        : 0;
      const chunkRelevance =
        maxRawChunkScore > 0 ? rawChunkScore / maxRawChunkScore : 0;
      const relevanceScore =
        maxRawChunkScore > 0
          ? chunkRelevance * 0.8 + metadataSignal * 0.2
          : metadataSignal;

      const ageDays = Math.max(
        0,
        (now - new Date(doc.updatedAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      const freshnessScore = Math.exp(-ageDays / 90);
      const effectiveScore =
        relevanceScore * (1 - DOC_META_RERANK_WEIGHT) +
        freshnessScore * DOC_META_RERANK_WEIGHT;
      const sourceScope = scopeById.get(doc.groupId);

      return {
        documentId: doc.documentId,
        documentName: stats?.name ?? doc.name,
        sourceGroupId: doc.groupId,
        sourceGroupName: sourceScope?.name ?? null,
        isInherited: doc.groupId !== group.id,
        chunkHits: stats?.chunkHits ?? 0,
        relevanceScore: effectiveScore,
        sectionGraphVersion: getSectionGraphVersion(doc.metadata),
      };
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  const maxEffective = rankedDocs[0]?.relevanceScore ?? 0;
  const normalizedRankedDocs =
    maxEffective > 0
      ? rankedDocs.map((d) => ({
          ...d,
          relevanceScore: d.relevanceScore / maxEffective,
        }))
      : rankedDocs;

  // Thresholds were already enforced per scope in queryKnowledge().
  const threshold = scopes.length > 1 ? 0 : (group.retrievalThreshold ?? 0);
  const filteredDocs =
    threshold > 0
      ? normalizedRankedDocs.filter((d) => d.relevanceScore >= threshold)
      : normalizedRankedDocs;
  if (filteredDocs.length === 0) return [];
  const docsToAssemble =
    resultMode === "section-first"
      ? filteredDocs
          .filter(
            (d) =>
              d.chunkHits > 0 && d.relevanceScore >= Math.max(threshold, 0.2),
          )
          .slice(0, maxDocs)
      : filteredDocs.slice(0, maxDocs);
  if (resultMode === "full-doc" && docsToAssemble.length === 0) return [];

  // ── Step 3: Assemble retrieval payload ──────────────────────────────────
  let results: DocRetrievalResult[] = [];
  let tokensUsed = 0;
  let sectionCount = 0;
  let fallbackUsed = false;

  if (resultMode === "section-first") {
    const sectionReadyDocs = docsToAssemble.filter(
      (doc) => (doc.sectionGraphVersion ?? 0) >= 1,
    );
    const assembled = await assembleSectionFirstResults({
      docsToAssemble: sectionReadyDocs,
      chunkStats,
      tokenBudget,
      threshold,
    });

    results = assembled.results;
    tokensUsed = assembled.tokensUsed;
    sectionCount = assembled.sectionCount;

    if (results.length === 0) {
      fallbackUsed = true;
      const fallback = await assembleFullDocResults({
        docsToAssemble: filteredDocs.slice(0, 1),
        chunkStats,
        query,
        tokenBudget,
      });
      results = fallback.results;
      tokensUsed = fallback.tokensUsed;
    }
  } else {
    const assembled = await assembleFullDocResults({
      docsToAssemble,
      chunkStats,
      query,
      tokenBudget,
    });
    results = assembled.results;
    tokensUsed = assembled.tokensUsed;
  }

  const docVersions = new Map(
    filteredDocs.map((doc) => [doc.documentId, doc.sectionGraphVersion]),
  );
  const tokensReturned =
    tokensUsed ||
    results.reduce((sum, result) => sum + estimateTokens(result.markdown), 0);
  const sectionGraphVersion = Math.max(
    0,
    ...results.map((result) => docVersions.get(result.documentId) ?? 0),
  );

  // ── Step 4: Log usage ─────────────────────────────────────────────────
  const latencyMs = Date.now() - start;
  knowledgeRepository
    .insertUsageLog({
      groupId: group.id,
      userId: options.userId ?? null,
      query,
      source: options.source ?? "chat",
      chunksRetrieved: scopedChunkResults.length,
      latencyMs,
      metadata: {
        resultMode,
        tokenBudget,
        tokensReturned,
        docCount: results.length,
        sectionCount,
        fallbackUsed,
        sectionGraphVersion: sectionGraphVersion || null,
      },
    })
    .catch(() => {});

  return results;
}

/**
 * Format doc retrieval results as a single markdown text block for LLM injection.
 */
export function formatDocsAsText(
  groupName: string,
  docs: DocRetrievalResult[],
  query?: string,
): string {
  if (docs.length === 0) {
    return `[Knowledge: ${groupName}]\nNo relevant content found${query ? ` for: "${query}"` : ""}.`;
  }
  const parts = docs.map((d) => {
    const title =
      d.isInherited && d.sourceGroupName
        ? `${d.documentName} (from ${d.sourceGroupName})`
        : d.documentName;
    return `## ${title}\n\n${d.markdown}`;
  });
  return `[Knowledge: ${groupName}]\n\n${parts.join("\n\n")}`;
}
