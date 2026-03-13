import "server-only";

import { createHash } from "node:crypto";
import { rerank } from "ai";
import {
  KnowledgeDocumentImage,
  KnowledgeQueryResult,
  KnowledgeSection,
} from "app-types/knowledge";
import { CacheKeys } from "lib/cache/cache-keys";
import { serverCache } from "lib/cache";
import { createRerankingModelFromConfig } from "lib/ai/provider-factory";
import { knowledgeRepository } from "lib/db/repository";
import { settingsRepository } from "lib/db/repository";
import { embedSingleText } from "./embedder";
import {
  mergeKnowledgeQueryConstraints,
  matchesRetrievalIdentityConstraints,
  type KnowledgeQueryConstraints,
} from "./query-constraints";

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
const CANDIDATE_LIMIT = 60;
/** Default final topN returned */
const FINAL_AFTER_RERANK = 10;
/** Minimum cosine similarity to keep a vector result (filters noise) */
const MIN_VECTOR_SCORE = 0.25;
/** Vector search results get a weight boost in RRF (semantic > keyword) */
const VECTOR_RRF_WEIGHT = 1.5;
const IMAGE_VECTOR_RRF_WEIGHT = 1.35;
/** How many top results to expand with neighbor chunks */
const NEIGHBOR_EXPAND_TOP = 3;
const IMAGE_MIN_VECTOR_SCORE = 0.2;
const MAX_MATCHED_IMAGES = 4;
const MAX_MATCHED_IMAGES_PER_DOC = 2;
/** Maximum multiplicative boost from document metadata relevance. */
const DOC_META_BOOST_MAX = 0.35;
/** Whether doc-level metadata vector scoring is enabled. */
const DOC_META_VECTOR_ENABLED = process.env.DOC_META_VECTOR_ENABLED !== "false";
const IMAGE_FALLBACK_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "your",
  "you",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "what",
  "when",
  "where",
  "which",
  "show",
  "need",
  "want",
  "about",
  "page",
  "step",
  "guide",
  "docs",
  "document",
  "image",
]);
const KNOWLEDGE_DOCS_CACHE_TTL_MS = 60 * 1000;
const SHOULD_USE_KNOWLEDGE_DOCS_CACHE = process.env.NODE_ENV !== "test";

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

async function getDocumentMetadataSignals(
  groupId: string,
  query: string,
  queryEmbedding?: number[],
  limit = CANDIDATE_LIMIT,
  documentIds?: string[],
): Promise<Map<string, number>> {
  const lexicalPromise = knowledgeRepository.searchDocumentMetadata(
    groupId,
    query,
    limit,
    documentIds,
  );
  const semanticPromise =
    DOC_META_VECTOR_ENABLED && queryEmbedding
      ? knowledgeRepository.vectorSearchDocumentMetadata(
          groupId,
          queryEmbedding,
          limit,
          documentIds,
        )
      : Promise.resolve([]);

  const [lexicalRows, semanticRows] = await Promise.all([
    lexicalPromise.catch(() => []),
    semanticPromise.catch(() => []),
  ]);

  return buildDocumentSignalMap(lexicalRows, semanticRows);
}

// ─── Query Expansion ───────────────────────────────────────────────────────────

type RetrievalResultMode = "section-first" | "full-doc";
type RecallProfile = {
  docCandidates: number;
  sectionCandidates: number;
  chunkCandidates: number;
};

function isLikelyLatinQuery(query: string): boolean {
  const letters = Array.from(query).filter((char) => /\p{L}/u.test(char));
  if (letters.length === 0) return true;

  const latinLetters = letters.filter((char) => /\p{Script=Latin}/u.test(char));
  return latinLetters.length / letters.length >= 0.8;
}

function extractSignificantQueryTerms(query: string): string[] {
  const terms = Array.from(
    new Set(
      query
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2),
    ),
  );

  if (!isLikelyLatinQuery(query)) {
    return terms;
  }

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

  return terms.filter((term) => !stopWords.has(term));
}

function getRecallProfile(
  query: string,
  resultMode: RetrievalResultMode,
): RecallProfile {
  const significantTerms = extractSignificantQueryTerms(query);
  const count = significantTerms.length;

  if (resultMode === "full-doc" || count >= 9) {
    return {
      docCandidates: 28,
      sectionCandidates: 112,
      chunkCandidates: 160,
    };
  }

  if (count >= 4) {
    return {
      docCandidates: 20,
      sectionCandidates: 80,
      chunkCandidates: 120,
    };
  }

  return {
    docCandidates: 12,
    sectionCandidates: 48,
    chunkCandidates: 72,
  };
}

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

  const keywords = extractSignificantQueryTerms(trimmed).filter(
    (word) => word.length > 2,
  );

  if (keywords.length >= 2 && keywords.length < 20) {
    variants.push(keywords.join(" "));
  }

  // 2. Hypothetical document prefix (lightweight HyDE)
  // Wrapping the query as if it's the beginning of an answer
  // helps embed closer to actual answer content
  if (keywords.length >= 2 && isLikelyLatinQuery(trimmed)) {
    variants.push(`Information about ${keywords.slice(0, 8).join(" ")}`);
  }

  return variants;
}

// ─── RRF Merge ─────────────────────────────────────────────────────────────────

function weightedImageRrfMerge(
  rankedLists: Array<{
    results: Array<KnowledgeDocumentImage & { score: number }>;
    weight: number;
  }>,
): Array<KnowledgeDocumentImage & { score: number }> {
  const scores = new Map<
    string,
    { result: KnowledgeDocumentImage & { score: number }; score: number }
  >();

  for (const { results, weight } of rankedLists) {
    results.forEach((result, rank) => {
      const rrfScore = weight / (RRF_K + rank + 1);
      const existing = scores.get(result.id);
      if (existing) {
        existing.score += rrfScore;
        if (result.score > existing.result.score) {
          existing.result = result;
        }
      } else {
        scores.set(result.id, { result, score: rrfScore });
      }
    });
  }

  const merged = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ result, score }) => ({ ...result, score }));

  const topScore = merged[0]?.score ?? 0;
  if (topScore <= 0) return merged;
  return merged.map((result) => ({
    ...result,
    score: result.score / topScore,
  }));
}

type RankedChunkCandidate = {
  result: KnowledgeQueryResult;
  fusionScore: number;
  semanticScore: number;
  lexicalScore: number;
  lexicalConfidence: number;
  docSignal: number;
  confidenceScore: number;
  rerankScore?: number;
};

type RankedSectionCandidate = {
  section: KnowledgeSection;
  documentId: string;
  documentName: string;
  fusionScore: number;
  semanticScore: number;
  lexicalScore: number;
  lexicalConfidence: number;
  docSignal: number;
  confidenceScore: number;
};

function toLexicalConfidence(rawScore: number): number {
  if (rawScore <= 0) return 0;
  return 1 - Math.exp(-rawScore / 2);
}

function computeConfidenceScore(input: {
  semanticScore: number;
  lexicalScore: number;
  docSignal: number;
  rerankScore?: number;
}) {
  const lexicalConfidence = toLexicalConfidence(input.lexicalScore);
  const confidence =
    input.rerankScore !== undefined
      ? 0.65 * input.rerankScore +
        0.2 * input.semanticScore +
        0.1 * lexicalConfidence +
        0.05 * input.docSignal
      : 0.6 * input.semanticScore +
        0.25 * lexicalConfidence +
        0.15 * input.docSignal;

  return {
    lexicalConfidence,
    confidenceScore: Math.max(0, Math.min(1, confidence)),
  };
}

function passesHardInclusionFloor(input: {
  semanticScore: number;
  lexicalConfidence: number;
  rerankScore?: number;
}) {
  return (
    input.semanticScore >= 0.28 ||
    input.lexicalConfidence >= 0.55 ||
    (input.rerankScore ?? 0) >= 0.2
  );
}

function compareRankedChunkCandidates(
  left: RankedChunkCandidate,
  right: RankedChunkCandidate,
) {
  const leftScore = left.rerankScore ?? left.confidenceScore;
  const rightScore = right.rerankScore ?? right.confidenceScore;
  const delta = rightScore - leftScore;
  if (Math.abs(delta) >= 0.03) {
    return delta;
  }

  return (
    right.result.chunk.createdAt.getTime() -
    left.result.chunk.createdAt.getTime()
  );
}

function mergeChunkCandidates(input: {
  vectorLists: KnowledgeQueryResult[][];
  textResults: KnowledgeQueryResult[];
  docSignalMap: Map<string, number>;
}) {
  const candidates = new Map<string, RankedChunkCandidate>();

  const upsert = (
    result: KnowledgeQueryResult,
    rank: number,
    weight: number,
    kind: "semantic" | "lexical",
  ) => {
    const key = result.chunk.id;
    const existing =
      candidates.get(key) ??
      ({
        result,
        fusionScore: 0,
        semanticScore: 0,
        lexicalScore: 0,
        lexicalConfidence: 0,
        docSignal: 0,
        confidenceScore: 0,
      } satisfies RankedChunkCandidate);

    existing.fusionScore += weight / (RRF_K + rank + 1);
    if (kind === "semantic") {
      existing.semanticScore = Math.max(existing.semanticScore, result.score);
    } else {
      existing.lexicalScore = Math.max(existing.lexicalScore, result.score);
    }
    if (result.score > existing.result.score) {
      existing.result = result;
    }
    candidates.set(key, existing);
  };

  input.vectorLists.forEach((results, index) => {
    const weight = index === 0 ? VECTOR_RRF_WEIGHT : VECTOR_RRF_WEIGHT * 0.75;
    results.forEach((result, rank) => upsert(result, rank, weight, "semantic"));
  });
  input.textResults.forEach((result, rank) =>
    upsert(result, rank, 1, "lexical"),
  );

  return Array.from(candidates.values())
    .map((candidate) => {
      candidate.docSignal =
        input.docSignalMap.get(candidate.result.documentId) ?? 0;
      candidate.fusionScore *= 1 + DOC_META_BOOST_MAX * candidate.docSignal;
      const { lexicalConfidence, confidenceScore } = computeConfidenceScore({
        semanticScore: candidate.semanticScore,
        lexicalScore: candidate.lexicalScore,
        docSignal: candidate.docSignal,
      });
      candidate.lexicalConfidence = lexicalConfidence;
      candidate.confidenceScore = confidenceScore;
      return candidate;
    })
    .sort((a, b) => b.fusionScore - a.fusionScore);
}

function mergeSectionCandidates(input: {
  vectorLists: Array<
    Array<{
      section: KnowledgeSection;
      documentId: string;
      documentName: string;
      score: number;
    }>
  >;
  textResults: Array<{
    section: KnowledgeSection;
    documentId: string;
    documentName: string;
    score: number;
  }>;
  docSignalMap: Map<string, number>;
}) {
  const candidates = new Map<string, RankedSectionCandidate>();

  const upsert = (
    result: {
      section: KnowledgeSection;
      documentId: string;
      documentName: string;
      score: number;
    },
    rank: number,
    weight: number,
    kind: "semantic" | "lexical",
  ) => {
    const key = result.section.id;
    const existing =
      candidates.get(key) ??
      ({
        section: result.section,
        documentId: result.documentId,
        documentName: result.documentName,
        fusionScore: 0,
        semanticScore: 0,
        lexicalScore: 0,
        lexicalConfidence: 0,
        docSignal: 0,
        confidenceScore: 0,
      } satisfies RankedSectionCandidate);

    existing.fusionScore += weight / (RRF_K + rank + 1);
    if (kind === "semantic") {
      existing.semanticScore = Math.max(existing.semanticScore, result.score);
    } else {
      existing.lexicalScore = Math.max(existing.lexicalScore, result.score);
    }
    candidates.set(key, existing);
  };

  input.vectorLists.forEach((results, index) => {
    const weight = index === 0 ? VECTOR_RRF_WEIGHT : VECTOR_RRF_WEIGHT * 0.75;
    results.forEach((result, rank) => upsert(result, rank, weight, "semantic"));
  });
  input.textResults.forEach((result, rank) =>
    upsert(result, rank, 1, "lexical"),
  );

  return Array.from(candidates.values())
    .map((candidate) => {
      candidate.docSignal = input.docSignalMap.get(candidate.documentId) ?? 0;
      candidate.fusionScore *= 1 + DOC_META_BOOST_MAX * candidate.docSignal;
      const { lexicalConfidence, confidenceScore } = computeConfidenceScore({
        semanticScore: candidate.semanticScore,
        lexicalScore: candidate.lexicalScore,
        docSignal: candidate.docSignal,
      });
      candidate.lexicalConfidence = lexicalConfidence;
      candidate.confidenceScore = confidenceScore;
      return candidate;
    })
    .filter((candidate) =>
      passesHardInclusionFloor({
        semanticScore: candidate.semanticScore,
        lexicalConfidence: candidate.lexicalConfidence,
      }),
    )
    .sort((a, b) => {
      if (b.confidenceScore !== a.confidenceScore) {
        return b.confidenceScore - a.confidenceScore;
      }
      return b.fusionScore - a.fusionScore;
    });
}

function trimNeighborContext(text?: string | null) {
  if (!text?.trim()) return undefined;
  const trimmed = trimTextToTokenBudget(text.trim(), 140);
  return trimmed || undefined;
}

async function attachNeighborContext(
  results: KnowledgeQueryResult[],
  groupId: string,
): Promise<KnowledgeQueryResult[]> {
  if (results.length === 0) return results;

  const topResults = results.slice(
    0,
    Math.min(NEIGHBOR_EXPAND_TOP, results.length),
  );
  const requests: Array<{ documentId: string; chunkIndex: number }> = [];

  for (const result of topResults) {
    if (result.chunk.chunkIndex > 0) {
      requests.push({
        documentId: result.chunk.documentId,
        chunkIndex: result.chunk.chunkIndex - 1,
      });
    }
    requests.push({
      documentId: result.chunk.documentId,
      chunkIndex: result.chunk.chunkIndex + 1,
    });
  }

  if (requests.length === 0) return results;

  try {
    const neighbors = await knowledgeRepository.getAdjacentChunks(
      groupId,
      requests,
    );
    const neighborMap = new Map(
      neighbors.map((neighbor) => [
        `${neighbor.chunk.documentId}:${neighbor.chunk.chunkIndex}`,
        neighbor.chunk.content,
      ]),
    );

    return results.map((result, index) => {
      if (index >= topResults.length) return result;

      const previous = trimNeighborContext(
        neighborMap.get(
          `${result.chunk.documentId}:${result.chunk.chunkIndex - 1}`,
        ),
      );
      const next = trimNeighborContext(
        neighborMap.get(
          `${result.chunk.documentId}:${result.chunk.chunkIndex + 1}`,
        ),
      );

      if (!previous && !next) {
        return result;
      }

      return {
        ...result,
        neighborContext: {
          ...(previous ? { previous } : {}),
          ...(next ? { next } : {}),
        },
      };
    });
  } catch {
    return results;
  }
}

// ─── Main Query Pipeline ───────────────────────────────────────────────────────

export interface QueryKnowledgeOptions {
  topN?: number;
  resultMode?: RetrievalResultMode;
  userId?: string | null;
  source?: "chat" | "agent" | "mcp";
  skipLogging?: boolean;
  constraints?: KnowledgeQueryConstraints;
}

async function queryKnowledgeSingleScope(
  scope: RetrievalScope,
  query: string,
  topN: number,
  resultMode: RetrievalResultMode,
  constraints: KnowledgeQueryConstraints,
): Promise<KnowledgeQueryResult[]> {
  const queryVariants = expandQuery(query);
  const allQueries = [query, ...queryVariants];
  const recallProfile = getRecallProfile(query, resultMode);
  const entityMatches =
    constraints.strictEntityMatch && (constraints.issuer || constraints.ticker)
      ? await knowledgeRepository.findDocumentIdsByRetrievalIdentity(scope.id, {
          issuer: constraints.issuer ?? null,
          ticker: constraints.ticker ?? null,
          limit: recallProfile.docCandidates,
        })
      : [];
  const entityMatchedDocumentIds = entityMatches.map((row) => row.documentId);

  if (
    constraints.strictEntityMatch &&
    (constraints.issuer || constraints.ticker) &&
    entityMatchedDocumentIds.length === 0
  ) {
    return [];
  }

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

  const docSignalPromise = getDocumentMetadataSignals(
    scope.id,
    query,
    embeddings[0],
    recallProfile.docCandidates,
    entityMatchedDocumentIds.length > 0 ? entityMatchedDocumentIds : undefined,
  );
  const docSignalMap = await docSignalPromise;
  for (const match of entityMatches) {
    const existing = docSignalMap.get(match.documentId) ?? 0;
    docSignalMap.set(
      match.documentId,
      Math.max(existing, 1 + match.score * 0.05),
    );
  }

  const shortlistedDocIds = Array.from(docSignalMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, recallProfile.docCandidates)
    .map(([documentId]) => documentId);

  if (shortlistedDocIds.length === 0) {
    return [];
  }

  const structuredSectionMatches =
    constraints.page || constraints.noteNumber
      ? await knowledgeRepository.findSectionsByStructuredFilters({
          groupId: scope.id,
          documentIds: shortlistedDocIds,
          page: constraints.page ?? null,
          noteNumber: constraints.noteNumber ?? null,
          noteSubsection: constraints.noteSubsection ?? null,
          limit: recallProfile.sectionCandidates,
        })
      : [];

  if (
    (constraints.page || constraints.noteNumber) &&
    structuredSectionMatches.length === 0
  ) {
    return [];
  }

  const shortlistedSectionIds =
    structuredSectionMatches.length > 0
      ? structuredSectionMatches.map((match) => match.section.id)
      : mergeSectionCandidates({
          vectorLists: (
            await Promise.all(
              embeddings.map((embedding) =>
                knowledgeRepository.vectorSearchSections(
                  scope.id,
                  embedding,
                  recallProfile.sectionCandidates,
                  shortlistedDocIds,
                ),
              ),
            )
          ).map((results) =>
            results.filter((result) => result.score >= MIN_VECTOR_SCORE),
          ),
          textResults: await knowledgeRepository.fullTextSearchSections(
            scope.id,
            query,
            recallProfile.sectionCandidates,
            shortlistedDocIds,
          ),
          docSignalMap,
        })
          .slice(0, recallProfile.sectionCandidates)
          .map((candidate) => candidate.section.id);

  const searchFilters =
    shortlistedSectionIds.length > 0
      ? { sectionIds: shortlistedSectionIds }
      : { documentIds: shortlistedDocIds };

  const [vectorResults, textResults] = await Promise.all([
    Promise.all(
      embeddings.map((embedding) =>
        knowledgeRepository.vectorSearch(
          scope.id,
          embedding,
          recallProfile.chunkCandidates,
          searchFilters,
        ),
      ),
    ),
    knowledgeRepository.fullTextSearch(
      scope.id,
      query,
      recallProfile.chunkCandidates,
      searchFilters,
    ),
  ]);

  let chunkCandidates = mergeChunkCandidates({
    vectorLists: vectorResults.map((results) =>
      results.filter((result) => result.score >= MIN_VECTOR_SCORE),
    ),
    textResults,
    docSignalMap,
  }).slice(0, recallProfile.chunkCandidates);

  if (chunkCandidates.length === 0) {
    return [];
  }

  if (
    scope.rerankingProvider &&
    scope.rerankingModel &&
    chunkCandidates.length > 1
  ) {
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
        const documents = chunkCandidates.map((candidate) => {
          const parts: string[] = [];
          if (candidate.result.chunk.contextSummary) {
            parts.push(candidate.result.chunk.contextSummary);
          }
          parts.push(candidate.result.chunk.content);
          return parts.join("\n\n");
        });

        const { ranking } = await rerank({
          model: rerankModel,
          query,
          documents,
          topN: documents.length,
        });

        const rerankByIndex = new Map(
          ranking.map((entry) => [entry.originalIndex, entry.score]),
        );

        chunkCandidates = chunkCandidates.map((candidate, index) => {
          const rerankScore = rerankByIndex.get(index);
          const { lexicalConfidence, confidenceScore } = computeConfidenceScore(
            {
              semanticScore: candidate.semanticScore,
              lexicalScore: candidate.lexicalScore,
              docSignal: candidate.docSignal,
              rerankScore,
            },
          );

          return {
            ...candidate,
            rerankScore,
            lexicalConfidence,
            confidenceScore,
          };
        });
      }
    } catch (err) {
      console.warn(
        "[ContextX] Reranking failed, using calibrated scores:",
        err,
      );
    }
  }

  const threshold = scope.retrievalThreshold ?? 0;
  let finalResults: KnowledgeQueryResult[] = chunkCandidates
    .filter((candidate) =>
      passesHardInclusionFloor({
        semanticScore: candidate.semanticScore,
        lexicalConfidence: candidate.lexicalConfidence,
        rerankScore: candidate.rerankScore,
      }),
    )
    .filter((candidate) =>
      threshold > 0 ? candidate.confidenceScore >= threshold : true,
    )
    .sort(compareRankedChunkCandidates)
    .slice(0, topN)
    .map((candidate) => ({
      ...candidate.result,
      score: candidate.confidenceScore,
      confidenceScore: candidate.confidenceScore,
      semanticScore: candidate.semanticScore,
      lexicalScore: candidate.lexicalScore,
      docSignal: candidate.docSignal,
      ...(candidate.rerankScore !== undefined
        ? { rerankScore: candidate.rerankScore }
        : {}),
    }));

  finalResults = await attachNeighborContext(finalResults, scope.id);
  if (
    constraints.strictEntityMatch &&
    (constraints.issuer || constraints.ticker)
  ) {
    finalResults = finalResults.filter((result) =>
      entityMatchedDocumentIds.includes(result.documentId),
    );
  }

  return finalResults;
}

function compareKnowledgeResults(
  left: KnowledgeQueryResult,
  right: KnowledgeQueryResult,
) {
  const leftScore = left.rerankScore ?? left.confidenceScore ?? left.score;
  const rightScore = right.rerankScore ?? right.confidenceScore ?? right.score;
  const delta = rightScore - leftScore;
  if (Math.abs(delta) >= 0.03) {
    return delta;
  }

  return right.chunk.createdAt.getTime() - left.chunk.createdAt.getTime();
}

export async function queryKnowledge(
  group: GroupForRetrieval,
  query: string,
  options: QueryKnowledgeOptions = {},
): Promise<KnowledgeQueryResult[]> {
  const {
    topN = FINAL_AFTER_RERANK,
    resultMode = "section-first",
    userId,
    source = "chat",
    skipLogging = false,
    constraints: rawConstraints,
  } = options;
  const start = Date.now();
  const constraints = mergeKnowledgeQueryConstraints(query, rawConstraints);

  const scopes = await resolveRetrievalScopes(group);
  const scopedResults = await Promise.all(
    scopes.map((scope) =>
      queryKnowledgeSingleScope(
        scope,
        query,
        Math.max(topN, FINAL_AFTER_RERANK),
        resultMode,
        constraints,
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
      const enrichedScore =
        enriched.rerankScore ?? enriched.confidenceScore ?? enriched.score;
      const existingScore = existing
        ? (existing.rerankScore ?? existing.confidenceScore ?? existing.score)
        : -Infinity;
      if (!existing || enrichedScore > existingScore) {
        mergedByChunk.set(enriched.chunk.id, enriched);
      }
    }
  }

  const merged = Array.from(mergedByChunk.values())
    .sort(compareKnowledgeResults)
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
      const neighborBlocks = [
        r.neighborContext?.previous
          ? `Previous context:\n${r.neighborContext.previous}`
          : "",
        r.neighborContext?.next
          ? `Next context:\n${r.neighborContext.next}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const content = neighborBlocks
        ? `${r.chunk.content}\n\n${neighborBlocks}`
        : r.chunk.content;
      return `[${i + 1}] ${docLink} (relevance: ${(r.rerankScore ?? r.confidenceScore ?? r.score).toFixed(2)})${summary}\n\n${content}`;
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
  return extractSignificantQueryTerms(query).filter((term) => term.length >= 3);
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

function buildKnowledgeDocsCacheKey(input: {
  groupId: string;
  query: string;
  resultMode: NormalizedDocsResultMode;
  tokenBudget: number;
  maxDocs: number;
  retrievalThreshold?: number | null;
  libraryId?: string;
  libraryVersion?: string;
  constraints?: KnowledgeQueryConstraints;
}) {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        query: input.query,
        retrievalThreshold: input.retrievalThreshold ?? null,
        libraryId: input.libraryId ?? null,
        libraryVersion: input.libraryVersion ?? null,
        constraints: input.constraints ?? null,
      }),
    )
    .digest("hex");

  return CacheKeys.knowledgeDocs(
    input.groupId,
    input.resultMode,
    hash,
    input.tokenBudget,
    input.maxDocs,
  );
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
  "markdown" | "matchedSections" | "citationCandidates" | "matchedImages"
> & {
  sectionGraphVersion: number | null;
  freshnessScore?: number;
};

type SectionBundleCandidate = {
  doc: RankedDocCandidate;
  section: KnowledgeSection;
  matches: KnowledgeQueryResult[];
  score: number;
  hitCount: number;
};

function formatSectionHeading(section: KnowledgeSection): string {
  const baseLabel = getSectionCitationHeading(section);
  const partLabel =
    section.partCount > 1
      ? `Part ${section.partIndex + 1}/${section.partCount}`
      : null;
  const headingLabel = partLabel ? `${baseLabel} (${partLabel})` : baseLabel;
  const pageLabel =
    section.pageStart && section.pageEnd
      ? section.pageStart === section.pageEnd
        ? `Page ${section.pageStart}`
        : `Pages ${section.pageStart}-${section.pageEnd}`
      : null;

  return [headingLabel, pageLabel].filter(Boolean).join(" | ");
}

function getSectionCitationHeading(section: KnowledgeSection): string {
  return section.noteNumber
    ? `Note ${section.noteSubsection ? `${section.noteNumber}.${section.noteSubsection}` : section.noteNumber}${section.noteTitle ? ` ${section.noteTitle}` : ""}`
    : section.headingPath;
}

function buildCitationExcerpt(
  text: string | null | undefined,
  maxLength = 280,
): string {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;

  const cut = normalized.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.7 ? cut.slice(0, lastSpace) : cut).trim()}...`;
}

function buildSectionCitationCandidate(input: {
  section: KnowledgeSection;
  matches: KnowledgeQueryResult[];
  versionId?: string | null;
  relevanceScore: number;
}): RetrievedKnowledgeCitation {
  const topMatch = [...input.matches].sort((left, right) => {
    const leftScore = left.rerankScore ?? left.confidenceScore ?? left.score;
    const rightScore =
      right.rerankScore ?? right.confidenceScore ?? right.score;
    return rightScore - leftScore;
  })[0];
  const topMatchPageStart =
    topMatch?.chunk.metadata?.pageStart ?? topMatch?.chunk.metadata?.pageNumber;
  const topMatchPageEnd =
    topMatch?.chunk.metadata?.pageEnd ?? topMatch?.chunk.metadata?.pageNumber;

  return {
    versionId: input.versionId ?? null,
    sectionId: input.section.id,
    sectionHeading: getSectionCitationHeading(input.section),
    pageStart: input.section.pageStart ?? topMatchPageStart ?? null,
    pageEnd: input.section.pageEnd ?? topMatchPageEnd ?? null,
    excerpt: buildCitationExcerpt(
      input.section.content || topMatch?.chunk.content || input.section.summary,
    ),
    relevanceScore: input.relevanceScore,
  };
}

function buildChunkCitationCandidate(input: {
  match: KnowledgeQueryResult;
  versionId?: string | null;
}): RetrievedKnowledgeCitation {
  const pageStart =
    input.match.chunk.metadata?.pageStart ??
    input.match.chunk.metadata?.pageNumber;
  const pageEnd =
    input.match.chunk.metadata?.pageEnd ??
    input.match.chunk.metadata?.pageNumber;

  return {
    versionId: input.versionId ?? null,
    sectionId: input.match.chunk.sectionId ?? null,
    sectionHeading:
      input.match.chunk.metadata?.headingPath ??
      input.match.chunk.metadata?.section ??
      null,
    pageStart: pageStart ?? null,
    pageEnd: pageEnd ?? null,
    excerpt: buildCitationExcerpt(input.match.chunk.content),
    relevanceScore:
      input.match.rerankScore ??
      input.match.confidenceScore ??
      input.match.score,
  };
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
  issuer?: string;
  ticker?: string;
  page?: number;
  note?: string;
  strictEntityMatch?: boolean;
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
  versionId?: string | null;
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
  citationCandidates?: RetrievedKnowledgeCitation[];
  matchedImages?: RetrievedKnowledgeImage[];
}

export interface RetrievedKnowledgeCitation {
  versionId?: string | null;
  sectionId?: string | null;
  sectionHeading?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  excerpt: string;
  relevanceScore: number;
}

export interface RetrievedKnowledgeImage
  extends Pick<
    KnowledgeDocumentImage,
    | "id"
    | "documentId"
    | "groupId"
    | "versionId"
    | "ordinal"
    | "label"
    | "description"
    | "headingPath"
    | "stepHint"
    | "pageNumber"
    | "mediaType"
    | "sourceUrl"
    | "storagePath"
    | "isRenderable"
  > {
  relevanceScore: number;
}

function extractImageMatchTerms(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, " ")
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(
          (term) => term.length >= 3 && !IMAGE_FALLBACK_STOP_WORDS.has(term),
        ),
    ),
  );
}

function computeImageTextOverlap(terms: string[], text: string): number {
  if (!terms.length || !text.trim()) return 0;

  const haystack = text.toLowerCase();
  const matched = terms.filter((term) => haystack.includes(term)).length;
  return matched / terms.length;
}

function buildImageContextText(
  image: Pick<
    KnowledgeDocumentImage,
    | "label"
    | "description"
    | "headingPath"
    | "stepHint"
    | "caption"
    | "altText"
    | "surroundingText"
    | "precedingText"
    | "followingText"
  >,
): string {
  return [
    image.label,
    image.description,
    image.headingPath,
    image.stepHint,
    image.caption,
    image.altText,
    image.surroundingText,
    image.precedingText,
    image.followingText,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function buildWeightedImageFieldText(
  image: Pick<
    KnowledgeDocumentImage,
    | "label"
    | "description"
    | "caption"
    | "altText"
    | "headingPath"
    | "stepHint"
    | "surroundingText"
    | "precedingText"
    | "followingText"
  >,
): {
  visual: string;
  structure: string;
  neighbor: string;
} {
  return {
    visual: [
      image.label,
      image.description,
      image.caption,
      image.altText,
      image.label,
      image.description,
    ]
      .filter(Boolean)
      .join(" ")
      .trim(),
    structure: [image.headingPath, image.stepHint]
      .filter(Boolean)
      .join(" ")
      .trim(),
    neighbor: [image.precedingText, image.followingText, image.surroundingText]
      .filter(Boolean)
      .join(" ")
      .trim(),
  };
}

type ImageMatchContext = {
  matchedSectionHeadings: string[];
  matchedSectionTerms: string[];
  matchedPages: number[];
  hasAnchors: boolean;
};

function buildImageMatchContext(
  doc: DocRetrievalResult,
  matches: KnowledgeQueryResult[],
): ImageMatchContext {
  const matchedSectionHeadings = Array.from(
    new Set(
      [
        ...(doc.matchedSections ?? []).map((section) => section.heading),
        ...matches
          .map(
            (match) =>
              match.chunk.metadata?.headingPath ??
              match.chunk.metadata?.section,
          )
          .filter((value): value is string => typeof value === "string"),
      ].filter(Boolean),
    ),
  );
  const matchedPages = Array.from(
    new Set(
      matches.flatMap((match) => {
        const start =
          match.chunk.metadata?.pageStart ?? match.chunk.metadata?.pageNumber;
        const end =
          match.chunk.metadata?.pageEnd ?? match.chunk.metadata?.pageNumber;
        if (!start) return [];
        if (!end || end === start) return [start];
        return Array.from(
          { length: end - start + 1 },
          (_, index) => start + index,
        );
      }),
    ),
  );

  return {
    matchedSectionHeadings,
    matchedSectionTerms: extractImageMatchTerms(
      matchedSectionHeadings.join(" "),
    ),
    matchedPages,
    hasAnchors: matchedSectionHeadings.length > 0 || matchedPages.length > 0,
  };
}

function computeImagePageProximity(
  matchedPages: number[],
  pageNumber?: number | null,
) {
  if (!pageNumber || matchedPages.length === 0) return 0;
  if (matchedPages.includes(pageNumber)) return 1;
  if (matchedPages.some((page) => Math.abs(page - pageNumber) === 1))
    return 0.7;
  return 0;
}

export function scoreRetrievedImageCandidate(input: {
  image: KnowledgeDocumentImage & { score: number };
  docScore: number;
  matchContext: ImageMatchContext;
}): number {
  const weightedText = buildWeightedImageFieldText(input.image);
  const headingOverlap =
    computeImageTextOverlap(
      input.matchContext.matchedSectionTerms,
      weightedText.structure,
    ) *
      0.65 +
    computeImageTextOverlap(
      input.matchContext.matchedSectionTerms,
      weightedText.visual,
    ) *
      0.35;
  const pageProximity = computeImagePageProximity(
    input.matchContext.matchedPages,
    input.image.pageNumber,
  );

  return Math.max(
    0,
    Math.min(
      1,
      input.image.score * 0.55 +
        input.docScore * 0.15 +
        headingOverlap * 0.2 +
        pageProximity * 0.1,
    ),
  );
}

function scoreFallbackImageCandidate(input: {
  image: KnowledgeDocumentImage;
  queryTerms: string[];
  matchContext: ImageMatchContext;
  docScore: number;
}) {
  const imageContext = buildImageContextText(input.image);
  const weightedText = buildWeightedImageFieldText(input.image);
  const queryOverlap =
    computeImageTextOverlap(input.queryTerms, weightedText.visual) * 0.6 +
    computeImageTextOverlap(input.queryTerms, weightedText.structure) * 0.25 +
    computeImageTextOverlap(input.queryTerms, weightedText.neighbor) * 0.15;
  const headingOverlap =
    computeImageTextOverlap(
      input.matchContext.matchedSectionTerms,
      weightedText.visual,
    ) *
      0.25 +
    computeImageTextOverlap(
      input.matchContext.matchedSectionTerms,
      weightedText.structure,
    ) *
      0.55 +
    computeImageTextOverlap(
      input.matchContext.matchedSectionTerms,
      weightedText.neighbor,
    ) *
      0.2;
  const neighborOverlap = Math.max(
    computeImageTextOverlap(
      input.queryTerms,
      input.image.precedingText?.trim() ?? "",
    ),
    computeImageTextOverlap(
      input.queryTerms,
      input.image.followingText?.trim() ?? "",
    ),
  );
  const pageProximity = computeImagePageProximity(
    input.matchContext.matchedPages,
    input.image.pageNumber,
  );
  const normalizedContext = imageContext.toLowerCase();
  const exactHeadingBoost = input.matchContext.matchedSectionHeadings.some(
    (heading) => {
      const normalizedHeading = heading.trim().toLowerCase();
      return (
        normalizedHeading.length > 0 &&
        normalizedContext.length > 0 &&
        (normalizedContext.includes(normalizedHeading) ||
          normalizedHeading.includes(normalizedContext))
      );
    },
  )
    ? 0.2
    : 0;

  const score =
    input.docScore * 0.25 +
    queryOverlap * 0.4 +
    headingOverlap * 0.2 +
    neighborOverlap * 0.1 +
    pageProximity * 0.1 +
    exactHeadingBoost;

  return {
    score,
    headingOverlap,
    pageProximity,
  };
}

async function findMatchedImagesForDocs(input: {
  query: string;
  docs: DocRetrievalResult[];
  scopeById: Map<string, RetrievalScope>;
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
}): Promise<Map<string, RetrievedKnowledgeImage[]>> {
  if (input.docs.length === 0) return new Map();

  const docIdsByScope = new Map<string, string[]>();
  for (const doc of input.docs) {
    const scopeId = doc.sourceGroupId ?? null;
    if (!scopeId) continue;
    const list = docIdsByScope.get(scopeId) ?? [];
    list.push(doc.documentId);
    docIdsByScope.set(scopeId, list);
  }

  const rankedLists: Array<{
    results: Array<KnowledgeDocumentImage & { score: number }>;
    weight: number;
  }> = [];

  await Promise.all(
    Array.from(docIdsByScope.entries()).map(async ([scopeId, documentIds]) => {
      const scope = input.scopeById.get(scopeId);
      if (!scope) return;

      let queryEmbedding: number[] | undefined;
      try {
        queryEmbedding = await embedSingleText(
          input.query,
          scope.embeddingProvider,
          scope.embeddingModel,
        );
      } catch {
        queryEmbedding = undefined;
      }

      const [textResults, vectorResults] = await Promise.all([
        knowledgeRepository
          .fullTextSearchImages(
            scopeId,
            input.query,
            CANDIDATE_LIMIT,
            documentIds,
          )
          .catch(() => []),
        queryEmbedding
          ? knowledgeRepository
              .vectorSearchImages(
                scopeId,
                queryEmbedding,
                CANDIDATE_LIMIT,
                documentIds,
              )
              .then((results) =>
                results.filter(
                  (result) => result.score >= IMAGE_MIN_VECTOR_SCORE,
                ),
              )
              .catch(() => [])
          : Promise.resolve([]),
      ]);

      if (vectorResults.length > 0) {
        rankedLists.push({
          results: vectorResults,
          weight: IMAGE_VECTOR_RRF_WEIGHT,
        });
      }
      if (textResults.length > 0) {
        rankedLists.push({ results: textResults, weight: 1 });
      }
    }),
  );

  const docScoreMap = new Map(
    input.docs.map((doc) => [doc.documentId, doc.relevanceScore]),
  );
  const matchContextByDoc = new Map(
    input.docs.map((doc) => [
      doc.documentId,
      buildImageMatchContext(
        doc,
        input.chunkStats.get(doc.documentId)?.matches ?? [],
      ),
    ]),
  );

  const merged =
    rankedLists.length > 0
      ? weightedImageRrfMerge(rankedLists)
          .map((image) => {
            const docScore = docScoreMap.get(image.documentId) ?? 0;
            const matchContext = matchContextByDoc.get(image.documentId) ?? {
              matchedSectionHeadings: [],
              matchedSectionTerms: [],
              matchedPages: [],
              hasAnchors: false,
            };
            const score = scoreRetrievedImageCandidate({
              image,
              docScore,
              matchContext,
            });
            return { ...image, score };
          })
          .sort((a, b) => b.score - a.score)
      : [];

  const topScore = merged[0]?.score ?? 0;
  const normalized =
    topScore > 0
      ? merged.map((image) => ({
          ...image,
          score: image.score / topScore,
        }))
      : merged;

  const selected: RetrievedKnowledgeImage[] = [];
  const perDocCounts = new Map<string, number>();
  const selectedImageKeys = new Set<string>();

  for (const image of normalized) {
    if (selected.length >= MAX_MATCHED_IMAGES) break;

    const currentDocCount = perDocCounts.get(image.documentId) ?? 0;
    if (currentDocCount >= MAX_MATCHED_IMAGES_PER_DOC) continue;

    const matchContext = matchContextByDoc.get(image.documentId);
    if (matchContext?.hasAnchors) {
      const headingOverlap = computeImageTextOverlap(
        matchContext.matchedSectionTerms,
        buildWeightedImageFieldText(image).structure,
      );
      const pageProximity = computeImagePageProximity(
        matchContext.matchedPages,
        image.pageNumber,
      );
      if (headingOverlap === 0 && pageProximity === 0 && image.score < 0.55) {
        continue;
      }
    }

    const imageKey = `${image.documentId}:${image.id}:${image.versionId ?? "live"}`;
    selected.push({
      id: image.id,
      documentId: image.documentId,
      groupId: image.groupId,
      versionId: image.versionId ?? null,
      ordinal: image.ordinal,
      label: image.label,
      description: image.description,
      headingPath: image.headingPath ?? null,
      stepHint: image.stepHint ?? null,
      pageNumber: image.pageNumber ?? null,
      mediaType: image.mediaType ?? null,
      sourceUrl: image.sourceUrl ?? null,
      storagePath: image.storagePath ?? null,
      isRenderable: image.isRenderable,
      relevanceScore: image.score,
    });
    perDocCounts.set(image.documentId, currentDocCount + 1);
    selectedImageKeys.add(imageKey);
  }

  if (selected.length < MAX_MATCHED_IMAGES) {
    const queryTerms = extractImageMatchTerms(input.query);
    const fallbackImageGroups = await Promise.all(
      input.docs.map(async (doc) => ({
        doc,
        images: (
          await knowledgeRepository
            .getDocumentImages(doc.documentId)
            .catch(() => [])
        ).filter((image) => image.isRenderable),
      })),
    );

    const fallbackCandidates = fallbackImageGroups
      .flatMap(({ doc, images }) => {
        const matchContext = matchContextByDoc.get(doc.documentId) ?? {
          matchedSectionHeadings: [],
          matchedSectionTerms: [],
          matchedPages: [],
          hasAnchors: false,
        };

        return images
          .filter((image) => {
            const imageKey = `${image.documentId}:${image.id}:${image.versionId ?? "live"}`;
            return !selectedImageKeys.has(imageKey);
          })
          .map((image) => {
            const candidate = scoreFallbackImageCandidate({
              image,
              queryTerms,
              matchContext,
              docScore: doc.relevanceScore,
            });
            return {
              image,
              score: candidate.score,
              headingOverlap: candidate.headingOverlap,
              pageProximity: candidate.pageProximity,
              hasAnchors: matchContext.hasAnchors,
              docScore: doc.relevanceScore,
            };
          })
          .filter((candidate) => {
            if (candidate.score <= 0.18) return false;
            if (
              candidate.hasAnchors &&
              candidate.headingOverlap === 0 &&
              candidate.pageProximity === 0 &&
              candidate.score < 0.55
            ) {
              return false;
            }
            return true;
          });
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.docScore !== a.docScore) return b.docScore - a.docScore;
        return a.image.ordinal - b.image.ordinal;
      });

    for (const candidate of fallbackCandidates) {
      if (selected.length >= MAX_MATCHED_IMAGES) break;

      const currentDocCount = perDocCounts.get(candidate.image.documentId) ?? 0;
      if (currentDocCount >= MAX_MATCHED_IMAGES_PER_DOC) continue;

      const imageKey = `${candidate.image.documentId}:${candidate.image.id}:${candidate.image.versionId ?? "live"}`;
      if (selectedImageKeys.has(imageKey)) continue;

      selected.push({
        id: candidate.image.id,
        documentId: candidate.image.documentId,
        groupId: candidate.image.groupId,
        versionId: candidate.image.versionId ?? null,
        ordinal: candidate.image.ordinal,
        label: candidate.image.label,
        description: candidate.image.description,
        headingPath: candidate.image.headingPath ?? null,
        stepHint: candidate.image.stepHint ?? null,
        pageNumber: candidate.image.pageNumber ?? null,
        mediaType: candidate.image.mediaType ?? null,
        sourceUrl: candidate.image.sourceUrl ?? null,
        storagePath: candidate.image.storagePath ?? null,
        isRenderable: candidate.image.isRenderable,
        relevanceScore: candidate.score,
      });
      perDocCounts.set(candidate.image.documentId, currentDocCount + 1);
      selectedImageKeys.add(imageKey);
    }
  }

  const imagesByDocId = new Map<string, RetrievedKnowledgeImage[]>();
  for (const image of selected) {
    const list = imagesByDocId.get(image.documentId) ?? [];
    list.push(image);
    imagesByDocId.set(image.documentId, list);
  }

  return imagesByDocId;
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
      const citationCandidates = Array.from(
        new Map(
          (chunkStats.get(doc.documentId)?.matches ?? [])
            .sort((left, right) => {
              const leftScore =
                left.rerankScore ?? left.confidenceScore ?? left.score;
              const rightScore =
                right.rerankScore ?? right.confidenceScore ?? right.score;
              return rightScore - leftScore;
            })
            .map((match) => {
              const candidate = buildChunkCitationCandidate({
                match,
                versionId: doc.versionId ?? null,
              });
              const key = [
                candidate.sectionId ?? "",
                candidate.pageStart ?? "",
                candidate.pageEnd ?? "",
                candidate.excerpt,
              ].join("::");
              return [key, candidate] as const;
            }),
        ).values(),
      ).slice(0, 3);

      results.push({
        documentId: doc.documentId,
        documentName: doc.documentName,
        sourceGroupId: doc.sourceGroupId,
        sourceGroupName: doc.sourceGroupName,
        isInherited: doc.isInherited,
        versionId: doc.versionId ?? null,
        relevanceScore: doc.relevanceScore,
        chunkHits: doc.chunkHits,
        markdown: docData.markdown,
        citationCandidates,
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
      versionId: doc.versionId ?? null,
      relevanceScore: doc.relevanceScore,
      chunkHits: doc.chunkHits,
      markdown: truncated,
      citationCandidates: Array.from(
        new Map(
          (chunkStats.get(doc.documentId)?.matches ?? [])
            .sort((left, right) => {
              const leftScore =
                left.rerankScore ?? left.confidenceScore ?? left.score;
              const rightScore =
                right.rerankScore ?? right.confidenceScore ?? right.score;
              return rightScore - leftScore;
            })
            .map((match) => {
              const candidate = buildChunkCitationCandidate({
                match,
                versionId: doc.versionId ?? null,
              });
              const key = [
                candidate.sectionId ?? "",
                candidate.pageStart ?? "",
                candidate.pageEnd ?? "",
                candidate.excerpt,
              ].join("::");
              return [key, candidate] as const;
            }),
        ).values(),
      ).slice(0, 3),
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

      const score = Math.max(
        0,
        match.rerankScore ?? match.confidenceScore ?? match.score,
      );
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
      citationCandidates: RetrievedKnowledgeCitation[];
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
      existing.citationCandidates.push(
        buildSectionCitationCandidate({
          section: bundle.section,
          matches: bundle.matches,
          versionId: bundle.doc.versionId ?? null,
          relevanceScore: bundle.score,
        }),
      );
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
      citationCandidates: [
        buildSectionCitationCandidate({
          section: bundle.section,
          matches: bundle.matches,
          versionId: bundle.doc.versionId ?? null,
          relevanceScore: bundle.score,
        }),
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
      versionId: doc!.versionId ?? null,
      relevanceScore: doc!.relevanceScore,
      chunkHits: doc!.chunkHits,
      markdown: `${doc!.blocks.join("\n\n---\n\n")}\n\n[... section-first context]`,
      matchedSections: doc!.matchedSections,
      citationCandidates: Array.from(
        new Map(
          doc!.citationCandidates.map((candidate) => {
            const key = [
              candidate.sectionId ?? "",
              candidate.pageStart ?? "",
              candidate.pageEnd ?? "",
              candidate.excerpt,
            ].join("::");
            return [key, candidate] as const;
          }),
        ).values(),
      ),
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
  const constraints = mergeKnowledgeQueryConstraints(query, {
    issuer: options.issuer,
    ticker: options.ticker,
    page: options.page,
    note: options.note,
    strictEntityMatch: options.strictEntityMatch,
  });
  const tokenBudget = Math.min(
    Math.max(options.tokens || DEFAULT_FULL_DOC_TOKENS, 500),
    MAX_FULL_DOC_TOKENS,
  );
  const resultMode = normalizeDocsResultMode(options.resultMode);
  const maxDocs = Math.min(
    Math.max(options.maxDocs ?? (resultMode === "section-first" ? 8 : 50), 1),
    50,
  );
  const cacheKey = buildKnowledgeDocsCacheKey({
    groupId: group.id,
    query,
    resultMode,
    tokenBudget,
    maxDocs,
    retrievalThreshold: group.retrievalThreshold ?? null,
    libraryId: options.libraryId,
    libraryVersion: options.libraryVersion,
    constraints,
  });
  if (SHOULD_USE_KNOWLEDGE_DOCS_CACHE) {
    const cached = await serverCache.get<DocRetrievalResult[]>(cacheKey);
    if (cached) {
      return cached;
    }
  }
  const recallProfile = getRecallProfile(query, resultMode);
  const start = Date.now();
  const scopes = await resolveRetrievalScopes(group);
  const scopeById = new Map(scopes.map((scope) => [scope.id, scope]));

  // ── Step 1: Gather chunk-level and document-level signals ───────────────
  const chunkResults = await queryKnowledge(group, query, {
    topN: Math.min(recallProfile.chunkCandidates, Math.max(maxDocs * 12, 24)),
    resultMode,
    skipLogging: true,
    constraints,
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
      return getDocumentMetadataSignals(
        scope.id,
        query,
        queryEmbedding,
        recallProfile.docCandidates,
      );
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
    const score = Math.max(0, r.confidenceScore ?? r.score);
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
          .slice(0, recallProfile.docCandidates)
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
  const candidateDocMetaInScope = candidateDocMeta.filter(
    (doc) =>
      allowedGroupIds.has(doc.groupId) &&
      (!constraints.strictEntityMatch ||
        matchesRetrievalIdentityConstraints(
          (doc.metadata?.retrievalIdentity as any) ?? null,
          constraints,
        )),
  );
  if (candidateDocMetaInScope.length === 0) return [];

  const now = Date.now();
  const rankedDocs = candidateDocMetaInScope
    .map((doc) => {
      const stats = chunkStats.get(doc.documentId);
      const metadataSignal = docSignalMap.get(doc.documentId) ?? 0;
      const avgChunkScore =
        stats && stats.chunkHits > 0 ? stats.sumScore / stats.chunkHits : 0;
      const maxChunkScore = stats?.maxScore ?? 0;
      const hitScore = Math.min(1, (stats?.chunkHits ?? 0) / 5);
      const relevanceScore =
        maxChunkScore * 0.65 +
        avgChunkScore * 0.2 +
        hitScore * 0.05 +
        metadataSignal * 0.1;

      const ageDays = Math.max(
        0,
        (now - new Date(doc.updatedAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      const freshnessScore = Math.exp(-ageDays / 90);
      const sourceScope = scopeById.get(doc.groupId);

      return {
        documentId: doc.documentId,
        documentName: stats?.name ?? doc.name,
        sourceGroupId: doc.groupId,
        sourceGroupName: sourceScope?.name ?? null,
        isInherited: doc.groupId !== group.id,
        versionId: doc.activeVersionId ?? null,
        chunkHits: stats?.chunkHits ?? 0,
        relevanceScore,
        freshnessScore,
        sectionGraphVersion: getSectionGraphVersion(doc.metadata),
      };
    })
    .sort((a, b) => {
      const delta = b.relevanceScore - a.relevanceScore;
      if (Math.abs(delta) >= 0.03) return delta;
      return b.freshnessScore - a.freshnessScore;
    });

  // Thresholds were already enforced per scope in queryKnowledge().
  const threshold = scopes.length > 1 ? 0 : (group.retrievalThreshold ?? 0);
  const filteredDocs =
    threshold > 0
      ? rankedDocs.filter((d) => d.relevanceScore >= threshold)
      : rankedDocs;
  if (filteredDocs.length === 0) return [];
  const docsToAssemble =
    resultMode === "section-first"
      ? filteredDocs
          .filter(
            (d) =>
              d.chunkHits > 0 && d.relevanceScore >= Math.max(threshold, 0.24),
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

  const matchedImagesByDocId = await findMatchedImagesForDocs({
    query,
    docs: results,
    scopeById,
    chunkStats,
  });
  results = results.map((result) => ({
    ...result,
    matchedImages: matchedImagesByDocId.get(result.documentId) ?? [],
  }));

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

  if (SHOULD_USE_KNOWLEDGE_DOCS_CACHE) {
    await serverCache.set(cacheKey, results, KNOWLEDGE_DOCS_CACHE_TTL_MS);
  }
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
