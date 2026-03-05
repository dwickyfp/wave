import "server-only";

import { rerank } from "ai";
import { knowledgeRepository } from "lib/db/repository";
import { embedSingleText } from "./embedder";
import { KnowledgeQueryResult } from "app-types/knowledge";

// Minimal group interface — satisfied by both KnowledgeGroup and KnowledgeSummary
type GroupForRetrieval = {
  id: string;
  name: string;
  embeddingModel: string;
  embeddingProvider: string;
  rerankingModel?: string | null;
  rerankingProvider?: string | null;
};
import { createRerankingModelFromConfig } from "lib/ai/provider-factory";
import { settingsRepository } from "lib/db/repository";

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

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ result, score }) => ({ ...result, score }));
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

  // ── Step 1: Query expansion ──────────────────────────────────────────────
  const queryVariants = expandQuery(query);
  const allQueries = [query, ...queryVariants];

  // ── Step 2: Embed all query variants in parallel ─────────────────────────
  const embeddings = await Promise.all(
    allQueries.map((q) =>
      embedSingleText(q, group.embeddingProvider, group.embeddingModel),
    ),
  );

  // ── Step 3: Multi-arm retrieval ──────────────────────────────────────────
  // Run vector search for each query variant + full-text search
  const vectorSearches = embeddings.map((emb) =>
    knowledgeRepository.vectorSearch(group.id, emb, CANDIDATE_LIMIT),
  );
  const textSearch = knowledgeRepository.fullTextSearch(
    group.id,
    query,
    CANDIDATE_LIMIT,
  );

  const searchResults = await Promise.all([...vectorSearches, textSearch]);

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

  const merged = weightedRrfMerge(rankedLists).slice(0, FINAL_BEFORE_RERANK);

  if (merged.length === 0) {
    return [];
  }

  // ── Step 6: Rerank if configured ─────────────────────────────────────────
  let finalResults = merged;

  if (group.rerankingProvider && group.rerankingModel && merged.length > topN) {
    try {
      const providerConfig = await settingsRepository.getProviderByName(
        group.rerankingProvider,
      );
      const rerankModel = providerConfig
        ? createRerankingModelFromConfig(
            group.rerankingProvider,
            group.rerankingModel,
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

  // ── Step 7: Neighbor chunk expansion ─────────────────────────────────────
  // After ranking, expand top results with adjacent chunks for richer context
  finalResults = await expandWithNeighborChunks(finalResults, group.id);

  // ── Step 8: Log usage ────────────────────────────────────────────────────
  if (!skipLogging) {
    const latencyMs = Date.now() - start;
    knowledgeRepository
      .insertUsageLog({
        groupId: group.id,
        userId: userId ?? null,
        query,
        source,
        chunksRetrieved: finalResults.length,
        latencyMs,
      })
      .catch(() => {});
  }

  return finalResults;
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

export interface QueryKnowledgeDocsOptions {
  topic?: string;
  tokens?: number;
  userId?: string | null;
  source?: "chat" | "agent" | "mcp";
}

/**
 * A document-level retrieval result with relevance info.
 */
export interface DocRetrievalResult {
  documentId: string;
  documentName: string;
  /** Aggregated relevance score from chunk-level search */
  relevanceScore: number;
  /** Number of chunks from this document that appeared in search results */
  chunkHits: number;
  /** Full markdown content of the document (may be truncated for budget) */
  markdown: string;
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
  const start = Date.now();

  // ── Step 1: Use the full RAG pipeline to find relevant chunks ─────────
  // We fetch more chunks than usual to get better document coverage
  const chunkResults = await queryKnowledge(group, query, {
    topN: FINAL_BEFORE_RERANK,
    skipLogging: true,
  });

  if (chunkResults.length === 0) return [];

  // ── Step 2: Aggregate chunk scores by document ────────────────────────
  const docScores = new Map<
    string,
    { score: number; count: number; name: string }
  >();

  for (const r of chunkResults) {
    const score = r.rerankScore ?? r.score;
    const existing = docScores.get(r.chunk.documentId);
    if (existing) {
      existing.score += score;
      existing.count += 1;
    } else {
      docScores.set(r.chunk.documentId, {
        score,
        count: 1,
        name: r.documentName,
      });
    }
  }

  // Rank documents by aggregated score (more chunk hits + higher scores = more relevant)
  const rankedDocs = Array.from(docScores.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .map(([docId, info]) => ({
      documentId: docId,
      documentName: info.name,
      relevanceScore: info.score,
      chunkHits: info.count,
    }));

  // ── Step 3: Fetch full markdown and assemble within token budget ───────
  const results: DocRetrievalResult[] = [];
  let tokensUsed = 0;

  for (const doc of rankedDocs) {
    const docData = await knowledgeRepository.getDocumentMarkdown(
      doc.documentId,
    );
    if (!docData?.markdown) continue;

    const contentTokens = estimateTokens(docData.markdown);

    if (contentTokens + tokensUsed <= tokenBudget) {
      // Entire document fits
      results.push({ ...doc, markdown: docData.markdown });
      tokensUsed += contentTokens;
    } else {
      // Truncate to fit remaining budget
      const remaining = tokenBudget - tokensUsed;
      if (remaining < 200) break; // Not enough room for meaningful content
      const charLimit = remaining * 4;
      let truncated = docData.markdown.slice(0, charLimit);
      const lastParagraph = truncated.lastIndexOf("\n\n");
      if (lastParagraph > charLimit * 0.5) {
        truncated = truncated.slice(0, lastParagraph);
      }
      results.push({
        ...doc,
        markdown: truncated + "\n\n[... content truncated]",
      });
      tokensUsed += estimateTokens(truncated);
      break; // Budget exhausted
    }
  }

  // ── Step 4: Log usage ─────────────────────────────────────────────────
  const latencyMs = Date.now() - start;
  knowledgeRepository
    .insertUsageLog({
      groupId: group.id,
      userId: options.userId ?? null,
      query,
      source: options.source ?? "chat",
      chunksRetrieved: chunkResults.length,
      latencyMs,
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
  const parts = docs.map((d) => `## ${d.documentName}\n\n${d.markdown}`);
  return `[Knowledge: ${groupName}]\n\n${parts.join("\n\n---\n\n")}`;
}
