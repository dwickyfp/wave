import "server-only";

import { createHash } from "node:crypto";
import { generateText, Output, rerank } from "ai";
import { z } from "zod";
import {
  KnowledgeComparisonGroup,
  KnowledgeDisplayContext,
  KnowledgeDocumentImage,
  KnowledgeDocumentContext,
  KnowledgeEvidenceItem,
  KnowledgeMatchedTopic,
  KnowledgeLocationContext,
  KnowledgeQueryResult,
  KnowledgeQueryAnalysis,
  KnowledgeRetrievalAxis,
  KnowledgeRetrievalAxisKind,
  KnowledgeRetrievalEnvelope,
  KnowledgeSection,
  KnowledgeSourceContext,
  KnowledgeTemporalHints,
} from "app-types/knowledge";
import { CacheKeys } from "lib/cache/cache-keys";
import { serverCache } from "lib/cache";
import {
  createModelFromConfig,
  createRerankingModelFromConfig,
} from "lib/ai/provider-factory";
import {
  knowledgeRepository,
  selfLearningRepository,
  settingsRepository,
} from "lib/db/repository";
import {
  inferCitationPageFromMarkdown,
  normalizeCitationLookupText,
} from "./citation-page-resolution";
import { buildKnowledgeImageStructuredSummary } from "./document-images";
import { embedSingleText } from "./embedder";
import {
  getRelatedGraphSections,
  getSectionSeedsForEntities,
  searchKnowledgeEntities,
} from "./graph-store";
import { extractPrimaryLegalReferenceKey } from "./legal-references";
import { rewriteKnowledgeQuery } from "./query-rewrite";
import {
  mergeKnowledgeQueryConstraints,
  type KnowledgeQueryConstraints,
} from "./query-constraints";
import {
  buildKnowledgeBaseTitle,
  buildKnowledgeDisplayContext,
  buildKnowledgeLocationLabel,
  buildKnowledgeTopicLabel,
  buildKnowledgeVariantLabel,
  deriveKnowledgeTemporalHints,
  extractKnowledgeComparisonAxesFromText,
} from "./document-metadata";
import { getContextXRollout } from "./rollout";

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
type MemoryPolicy = "off" | "user";

// ─── Tuning Constants ──────────────────────────────────────────────────────────
const RRF_K = 60;
/** Per-search-arm candidate limit (increased for better recall) */
const CANDIDATE_LIMIT = 80;
/** Default final topN returned */
const FINAL_AFTER_RERANK = 10;
/** Minimum cosine similarity to keep a vector result (filters noise) */
const MIN_VECTOR_SCORE = 0.2;
/** Vector search results get a weight boost in RRF (semantic > keyword) */
const VECTOR_RRF_WEIGHT = 1.5;
const IMAGE_VECTOR_RRF_WEIGHT = 1.35;
/** How many top results to expand with neighbor chunks */
const NEIGHBOR_EXPAND_TOP = 3;
const IMAGE_MIN_VECTOR_SCORE = 0.2;
const MAX_MATCHED_IMAGES = 4;
const MAX_MATCHED_IMAGES_PER_DOC = 2;
/** Maximum multiplicative boost from document metadata relevance. */
const DOC_META_BOOST_MAX = 0.2;
/** Whether doc-level metadata vector scoring is enabled. */
const DOC_META_VECTOR_ENABLED = process.env.DOC_META_VECTOR_ENABLED !== "false";
const LISTWISE_RERANK_MODEL_KEY = "knowledge-context-model";
const LEGACY_LISTWISE_RERANK_MODEL_KEY = "contextx-model";
const LISTWISE_RERANK_LIMIT = 24;
const MULTI_VECTOR_SCORE_FLOORS = {
  content: 0.24,
  context: 0.22,
  identity: 0.2,
  entity: 0.18,
} as const;
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

const LISTWISE_RERANK_SCHEMA = z.object({
  ranking: z
    .array(
      z.object({
        index: z.number().int().min(1),
        score: z.number().min(0).max(1),
      }),
    )
    .default([]),
});

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

async function getListwiseRerankModel() {
  const getSetting = settingsRepository.getSetting?.bind(settingsRepository);
  const getProviderByName =
    settingsRepository.getProviderByName?.bind(settingsRepository);
  const getModelForChat =
    settingsRepository.getModelForChat?.bind(settingsRepository);
  if (!getSetting || !getProviderByName || !getModelForChat) {
    return null;
  }

  const config =
    ((await getSetting(LISTWISE_RERANK_MODEL_KEY)) as {
      provider: string;
      model: string;
    } | null) ??
    ((await getSetting(LEGACY_LISTWISE_RERANK_MODEL_KEY)) as {
      provider: string;
      model: string;
    } | null);
  if (!config?.provider || !config.model) {
    return null;
  }

  const providerConfig = await getProviderByName(config.provider);
  if (!providerConfig?.enabled) {
    return null;
  }

  const modelConfig = await getModelForChat(config.provider, config.model);
  return createModelFromConfig(
    config.provider,
    modelConfig?.apiName ?? config.model,
    providerConfig.apiKey,
    providerConfig.baseUrl,
    providerConfig.settings,
  );
}

async function rerankDocumentsWithLlm(
  query: string,
  documents: string[],
): Promise<Map<number, number>> {
  if (documents.length <= 1) {
    return new Map();
  }

  const model = await getListwiseRerankModel();
  if (!model) {
    return new Map();
  }

  try {
    const renderedDocuments = documents
      .map(
        (document, index) =>
          `[${index + 1}] ${trimTextToTokenBudget(document, 220)}`,
      )
      .join("\n\n");
    const { output } = await generateText({
      model,
      temperature: 0,
      output: Output.object({
        schema: LISTWISE_RERANK_SCHEMA,
        name: "knowledge_listwise_rerank",
        description: "Rank retrieval candidates for knowledge search.",
      }),
      prompt: [
        "Rank the retrieval candidates for the user query.",
        "Return only candidates that are materially relevant.",
        "Scores must be between 0 and 1, where 1 is the strongest answer candidate.",
        "Prefer candidates that directly answer the query with specific evidence.",
        `Query: ${query}`,
        "",
        renderedDocuments,
      ].join("\n"),
    });

    const rerankScores = new Map<number, number>();
    for (const entry of output.ranking) {
      const index = entry.index - 1;
      if (!Number.isInteger(index) || index < 0 || index >= documents.length) {
        continue;
      }
      const normalizedScore = Math.max(0, Math.min(1, entry.score));
      const existing = rerankScores.get(index) ?? -Infinity;
      if (normalizedScore > existing) {
        rerankScores.set(index, normalizedScore);
      }
    }
    return rerankScores;
  } catch {
    return new Map();
  }
}

async function rerankCandidateTexts(input: {
  query: string;
  documents: string[];
  rerankingProvider?: string | null;
  rerankingModel?: string | null;
  allowLlmFallback: boolean;
}): Promise<Map<number, number>> {
  if (input.documents.length <= 1) {
    return new Map();
  }

  const scopedDocuments = input.documents.slice(0, LISTWISE_RERANK_LIMIT);

  if (input.rerankingProvider && input.rerankingModel) {
    try {
      const providerConfig = await settingsRepository.getProviderByName(
        input.rerankingProvider,
      );
      const rerankModel = providerConfig
        ? createRerankingModelFromConfig(
            input.rerankingProvider,
            input.rerankingModel,
            providerConfig.apiKey,
          )
        : null;

      if (rerankModel) {
        const { ranking } = await rerank({
          model: rerankModel,
          query: input.query,
          documents: scopedDocuments,
          topN: scopedDocuments.length,
        });

        return new Map(
          ranking.map((entry) => [entry.originalIndex, entry.score]),
        );
      }
    } catch (err) {
      console.warn("[ContextX] Native reranking failed, falling back:", err);
    }
  }

  if (!input.allowLlmFallback) {
    return new Map();
  }

  return rerankDocumentsWithLlm(input.query, scopedDocuments);
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
): Promise<Map<string, number>> {
  const lexicalPromise = knowledgeRepository.searchDocumentMetadata(
    groupId,
    query,
    limit,
  );
  const semanticPromise =
    DOC_META_VECTOR_ENABLED && queryEmbedding
      ? knowledgeRepository.vectorSearchDocumentMetadata(
          groupId,
          queryEmbedding,
          limit,
        )
      : Promise.resolve([]);

  const [lexicalRows, semanticRows] = await Promise.all([
    lexicalPromise.catch(() => []),
    semanticPromise.catch(() => []),
  ]);

  return buildDocumentSignalMap(lexicalRows, semanticRows);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function mergeScoreMaps(maps: Array<Map<string, number>>): Map<string, number> {
  const merged = new Map<string, number>();
  for (const map of maps) {
    for (const [key, value] of map.entries()) {
      const existing = merged.get(key) ?? 0;
      if (value > existing) {
        merged.set(key, value);
      }
    }
  }
  return merged;
}

function mergeKnowledgeResultsByChunkId(
  results: KnowledgeQueryResult[],
): KnowledgeQueryResult[] {
  const merged = new Map<string, KnowledgeQueryResult>();
  for (const result of results) {
    const existing = merged.get(result.chunk.id);
    if (!existing || result.score > existing.score) {
      merged.set(result.chunk.id, result);
    }
  }
  return Array.from(merged.values());
}

function mergeSectionRowsById<
  T extends { section: { id: string }; score: number },
>(rows: T[]): T[] {
  const merged = new Map<string, T>();
  for (const row of rows) {
    const existing = merged.get(row.section.id);
    if (!existing || row.score > existing.score) {
      merged.set(row.section.id, row);
    }
  }
  return Array.from(merged.values());
}

async function getMemoryQueryVariants(input: {
  userId?: string | null;
  query: string;
  source: "chat" | "agent" | "mcp";
  memoryPolicy: MemoryPolicy;
  embeddingProvider: string;
  embeddingModel: string;
}): Promise<string[]> {
  if (
    input.memoryPolicy !== "user" ||
    !input.userId ||
    input.source === "mcp"
  ) {
    return [];
  }

  try {
    if (!selfLearningRepository.searchActiveMemoriesForUser) {
      return [];
    }
    const queryEmbedding = await embedSingleText(
      input.query,
      input.embeddingProvider,
      input.embeddingModel,
    ).catch(() => null);
    const memories = await selfLearningRepository.searchActiveMemoriesForUser({
      userId: input.userId,
      query: input.query,
      embedding: queryEmbedding,
      limit: 3,
    });
    return uniqueStrings(
      memories.flatMap((memory) => [
        memory.title,
        memory.content,
        `${memory.title}: ${memory.content}`,
      ]),
    ).slice(0, 6);
  } catch {
    return [];
  }
}

async function backfillChunkMatchesForDocument(input: {
  doc: RankedDocCandidate;
  query: string;
  scopeById: Map<string, RetrievalScope>;
  embeddingCache: Map<string, number[] | null>;
  limit?: number;
}): Promise<KnowledgeQueryResult[]> {
  const scope = input.scopeById.get(input.doc.sourceGroupId ?? "");
  if (!scope) return [];

  const searchLimit = Math.max(input.limit ?? 3, 6);
  const filters = { documentIds: [input.doc.documentId] };

  const lexicalPromise = knowledgeRepository
    .fullTextSearch(scope.id, input.query, searchLimit, filters)
    .catch(() => []);

  let queryEmbedding = input.embeddingCache.get(scope.id);
  if (queryEmbedding === undefined) {
    queryEmbedding = DOC_META_VECTOR_ENABLED
      ? await embedSingleText(
          input.query,
          scope.embeddingProvider,
          scope.embeddingModel,
        ).catch(() => null)
      : null;
    input.embeddingCache.set(scope.id, queryEmbedding);
  }

  const semanticPromise =
    DOC_META_VECTOR_ENABLED && queryEmbedding
      ? knowledgeRepository
          .vectorSearch(scope.id, queryEmbedding, searchLimit, filters)
          .catch(() => [])
      : Promise.resolve([]);

  const [lexicalRows, semanticRows] = await Promise.all([
    lexicalPromise,
    semanticPromise,
  ]);

  const merged = new Map<string, KnowledgeQueryResult>();
  const ingest = (
    row: KnowledgeQueryResult,
    scoreType: "lexicalScore" | "semanticScore",
  ) => {
    const existing = merged.get(row.chunk.id);
    const score = row.score ?? 0;
    if (!existing) {
      merged.set(row.chunk.id, {
        ...row,
        confidenceScore: score,
        lexicalScore: scoreType === "lexicalScore" ? score : undefined,
        semanticScore: scoreType === "semanticScore" ? score : undefined,
      });
      return;
    }

    merged.set(row.chunk.id, {
      ...existing,
      score: Math.max(existing.score ?? 0, score),
      confidenceScore: Math.max(existing.confidenceScore ?? 0, score),
      lexicalScore:
        scoreType === "lexicalScore"
          ? Math.max(existing.lexicalScore ?? 0, score)
          : existing.lexicalScore,
      semanticScore:
        scoreType === "semanticScore"
          ? Math.max(existing.semanticScore ?? 0, score)
          : existing.semanticScore,
    });
  };

  for (const row of lexicalRows) ingest(row, "lexicalScore");
  for (const row of semanticRows) ingest(row, "semanticScore");

  return Array.from(merged.values())
    .sort((left, right) => {
      const leftScore = left.confidenceScore ?? left.score;
      const rightScore = right.confidenceScore ?? right.score;
      return rightScore - leftScore;
    })
    .slice(0, input.limit ?? 3);
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
      docCandidates: 40,
      sectionCandidates: 160,
      chunkCandidates: 220,
    };
  }

  if (count >= 4) {
    return {
      docCandidates: 28,
      sectionCandidates: 112,
      chunkCandidates: 160,
    };
  }

  return {
    docCandidates: 18,
    sectionCandidates: 72,
    chunkCandidates: 108,
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

  // 3. Document-name variant — phrase the query as if looking for a named
  // document. Helps surface documents whose title/description matches the
  // query terms even when the chunk content does not contain them verbatim.
  if (keywords.length >= 2) {
    variants.push(`document report ${keywords.slice(0, 6).join(" ")}`);
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
  rerankScore?: number;
};

function buildChunkRerankText(candidate: RankedChunkCandidate): string {
  const parts: string[] = [];
  if (candidate.result.chunk.contextSummary) {
    parts.push(candidate.result.chunk.contextSummary);
  }
  parts.push(candidate.result.chunk.content);
  return parts.join("\n\n");
}

function buildSectionRerankText(candidate: RankedSectionCandidate): string {
  const parts = [
    candidate.documentName ? `document: ${candidate.documentName}` : "",
    candidate.section.headingPath
      ? `heading: ${candidate.section.headingPath}`
      : candidate.section.heading
        ? `heading: ${candidate.section.heading}`
        : "",
    candidate.section.summary ? `summary: ${candidate.section.summary}` : "",
    candidate.section.content,
  ];

  return parts.filter(Boolean).join("\n");
}

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

  // Secondary tiebreaker: prefer chunks with a temporal hint over those without,
  // then fall back to most recently created.
  const leftHasTime = !!left.result.chunk.metadata?.temporalHints?.effectiveAt;
  const rightHasTime =
    !!right.result.chunk.metadata?.temporalHints?.effectiveAt;
  if (rightHasTime !== leftHasTime) {
    return rightHasTime ? 1 : -1;
  }

  return (
    right.result.chunk.createdAt.getTime() -
    left.result.chunk.createdAt.getTime()
  );
}

function compareRankedSectionCandidates(
  left: RankedSectionCandidate,
  right: RankedSectionCandidate,
) {
  const leftScore = left.rerankScore ?? left.confidenceScore;
  const rightScore = right.rerankScore ?? right.confidenceScore;
  const delta = rightScore - leftScore;
  if (Math.abs(delta) >= 0.03) {
    return delta;
  }

  return right.section.createdAt.getTime() - left.section.createdAt.getTime();
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
    // Logarithmic weight decay per variant keeps primary query dominant
    // while secondary variants contribute diminishing but non-trivial signal.
    const weight = VECTOR_RRF_WEIGHT / Math.sqrt(index + 1);
    results.forEach((result, rank) => upsert(result, rank, weight, "semantic"));
  });
  input.textResults.forEach((result, rank) =>
    upsert(result, rank, 1, "lexical"),
  );

  const allCandidates = Array.from(candidates.values()).map((candidate) => {
    candidate.docSignal =
      input.docSignalMap.get(candidate.result.documentId) ?? 0;
    candidate.fusionScore *= 1 + DOC_META_BOOST_MAX * candidate.docSignal;
    return candidate;
  });

  // Normalize lexical scores across the candidate set so cross-corpus BM25
  // magnitude only affects the confidenceScore weight, not the hard inclusion
  // floor (which uses the raw score via toLexicalConfidence).
  const maxLexScore = Math.max(...allCandidates.map((c) => c.lexicalScore), 1);
  return allCandidates
    .map((candidate) => {
      // lexicalConfidence for passesHardInclusionFloor uses raw BM25 score.
      const rawLexConfidence = toLexicalConfidence(candidate.lexicalScore);
      // For confidenceScore weighting, normalize so the best BM25 in the set
      // always contributes fully rather than being capped by arbitrary scale.
      const normalizedLexForScoring =
        maxLexScore > 1
          ? candidate.lexicalScore / maxLexScore
          : candidate.lexicalScore;
      const { confidenceScore } = computeConfidenceScore({
        semanticScore: candidate.semanticScore,
        lexicalScore: normalizedLexForScoring,
        docSignal: candidate.docSignal,
      });
      candidate.lexicalConfidence = rawLexConfidence;
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
    const weight = VECTOR_RRF_WEIGHT / Math.sqrt(index + 1);
    results.forEach((result, rank) => upsert(result, rank, weight, "semantic"));
  });
  input.textResults.forEach((result, rank) =>
    upsert(result, rank, 1, "lexical"),
  );

  const allSectionCandidates = Array.from(candidates.values()).map(
    (candidate) => {
      candidate.docSignal = input.docSignalMap.get(candidate.documentId) ?? 0;
      candidate.fusionScore *= 1 + DOC_META_BOOST_MAX * candidate.docSignal;
      return candidate;
    },
  );

  const maxSectionLexScore = Math.max(
    ...allSectionCandidates.map((c) => c.lexicalScore),
    1,
  );
  return allSectionCandidates
    .map((candidate) => {
      const rawLexConfidence = toLexicalConfidence(candidate.lexicalScore);
      const normalizedLexForScoring =
        maxSectionLexScore > 1
          ? candidate.lexicalScore / maxSectionLexScore
          : candidate.lexicalScore;
      const { confidenceScore } = computeConfidenceScore({
        semanticScore: candidate.semanticScore,
        lexicalScore: normalizedLexForScoring,
        docSignal: candidate.docSignal,
      });
      candidate.lexicalScore = normalizedLexForScoring;
      candidate.lexicalConfidence = rawLexConfidence;
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
    // Expand neighbor context for all results when there are few hits;
    // up to NEIGHBOR_EXPAND_TOP for larger result sets.
    results.length <= NEIGHBOR_EXPAND_TOP * 2
      ? results.length
      : Math.min(NEIGHBOR_EXPAND_TOP, results.length),
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
  memoryPolicy?: MemoryPolicy;
}

type QueryRuntime = {
  queryVariants: string[];
  rollout: Awaited<ReturnType<typeof getContextXRollout>>;
};

// ─── Source Diversity Helpers ─────────────────────────────────────────────────

/**
 * After sorting chunk candidates by score, applies a per-document soft cap so
 * that a single document cannot monopolise all topN slots when multiple
 * documents have relevant results. Every document with qualifying candidates
 * gets at least ⌊topN / numDocs⌋ (minimum 1) slots reserved before the
 * remaining quota is filled by pure-score ordering.
 */
function selectChunkCandidatesWithDocDiversity(
  sortedCandidates: RankedChunkCandidate[],
  topN: number,
): RankedChunkCandidate[] {
  const docIds = new Set(sortedCandidates.map((c) => c.result.documentId));
  if (docIds.size <= 1 || topN <= 1) return sortedCandidates.slice(0, topN);

  const docGroups = new Map<string, RankedChunkCandidate[]>();
  for (const candidate of sortedCandidates) {
    const list = docGroups.get(candidate.result.documentId) ?? [];
    list.push(candidate);
    docGroups.set(candidate.result.documentId, list);
  }

  const guaranteedPerDoc = Math.max(1, Math.floor(topN / docGroups.size));
  const selectedIds = new Set<string>();
  const result: RankedChunkCandidate[] = [];

  // First pass: guaranteed minimum from each document (score-ordered within each doc).
  for (const candidates of docGroups.values()) {
    for (const candidate of candidates.slice(0, guaranteedPerDoc)) {
      if (!selectedIds.has(candidate.result.chunk.id)) {
        result.push(candidate);
        selectedIds.add(candidate.result.chunk.id);
      }
    }
  }

  // Second pass: fill remaining slots from the global score-ordered list.
  for (const candidate of sortedCandidates) {
    if (result.length >= topN) break;
    if (!selectedIds.has(candidate.result.chunk.id)) {
      result.push(candidate);
      selectedIds.add(candidate.result.chunk.id);
    }
  }

  // Re-sort to restore score-descending order after guaranteed-pick insertion.
  return result.sort(compareRankedChunkCandidates).slice(0, topN);
}

/**
 * After merging cross-scope results into a score-sorted list, guarantees that
 * each scope (inherited knowledge group) with relevant hits contributes at
 * least ⌊topN / numScopes⌋ (minimum 1) chunks to the final result. Remaining
 * slots fall back to pure score ordering.
 */
function selectResultsWithScopeDiversity(
  sortedResults: KnowledgeQueryResult[],
  scopeCount: number,
  topN: number,
): KnowledgeQueryResult[] {
  if (scopeCount <= 1 || topN <= 1) return sortedResults.slice(0, topN);

  const scopeGroups = new Map<string, KnowledgeQueryResult[]>();
  for (const result of sortedResults) {
    const scopeId =
      (result.chunk.metadata?.sourceGroupId as string | undefined) ?? "";
    const list = scopeGroups.get(scopeId) ?? [];
    list.push(result);
    scopeGroups.set(scopeId, list);
  }

  if (scopeGroups.size <= 1) return sortedResults.slice(0, topN);

  const guaranteedPerScope = Math.max(1, Math.floor(topN / scopeGroups.size));
  const selectedIds = new Set<string>();
  const result: KnowledgeQueryResult[] = [];

  // First pass: guaranteed minimum from each scope (score-ordered within each scope).
  for (const results of scopeGroups.values()) {
    for (const r of results.slice(0, guaranteedPerScope)) {
      if (!selectedIds.has(r.chunk.id)) {
        result.push(r);
        selectedIds.add(r.chunk.id);
      }
    }
  }

  // Second pass: fill remaining slots from the global score-ordered list.
  for (const r of sortedResults) {
    if (result.length >= topN) break;
    if (!selectedIds.has(r.chunk.id)) {
      result.push(r);
      selectedIds.add(r.chunk.id);
    }
  }

  return result.sort(compareKnowledgeResults).slice(0, topN);
}

async function queryKnowledgeSingleScope(
  scope: RetrievalScope,
  query: string,
  topN: number,
  resultMode: RetrievalResultMode,
  constraints: KnowledgeQueryConstraints,
  runtime: QueryRuntime,
): Promise<KnowledgeQueryResult[]> {
  const allQueries = [query, ...runtime.queryVariants];
  const recallProfile = getRecallProfile(query, resultMode);

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

  const docSignalMap = mergeScoreMaps(
    await Promise.all(
      allQueries.map((queryVariant, index) =>
        getDocumentMetadataSignals(
          scope.id,
          queryVariant,
          embeddings[index],
          recallProfile.docCandidates,
        ),
      ),
    ),
  );

  let candidateDocIds = Array.from(docSignalMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, recallProfile.docCandidates)
    .map(([documentId]) => documentId);

  const structuredSectionMatches =
    constraints.page || constraints.noteNumber
      ? await knowledgeRepository.findSectionsByStructuredFilters({
          groupId: scope.id,
          documentIds: candidateDocIds.length > 0 ? candidateDocIds : undefined,
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

  const entitySectionSeeds =
    runtime.rollout.graphRead && (constraints.entityTerms?.length ?? 0) > 0
      ? await searchKnowledgeEntities(
          scope.id,
          constraints.entityTerms ?? [],
          recallProfile.sectionCandidates,
        ).then(async (entities) => {
          const sectionSeeds = await getSectionSeedsForEntities(
            scope.id,
            entities.map((entity) => entity.entityId),
            recallProfile.sectionCandidates,
          );
          for (const seed of sectionSeeds) {
            const existing = docSignalMap.get(seed.documentId) ?? 0;
            docSignalMap.set(seed.documentId, Math.max(existing, 0.55));
          }
          return sectionSeeds;
        })
      : [];

  candidateDocIds = Array.from(docSignalMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, recallProfile.docCandidates)
    .map(([documentId]) => documentId);

  const sectionTextResults = mergeSectionRowsById(
    (
      await Promise.all(
        allQueries.map((queryVariant) =>
          knowledgeRepository.fullTextSearchSections(
            scope.id,
            queryVariant,
            recallProfile.sectionCandidates,
            candidateDocIds.length > 0 ? candidateDocIds : undefined,
          ),
        ),
      )
    ).flat(),
  );
  const sectionVectorLists = (
    await Promise.all(
      embeddings.map((embedding) =>
        knowledgeRepository.vectorSearchSections(
          scope.id,
          embedding,
          recallProfile.sectionCandidates,
          candidateDocIds.length > 0 ? candidateDocIds : undefined,
        ),
      ),
    )
  ).map((results) =>
    results.filter((result) => result.score >= MIN_VECTOR_SCORE),
  );

  let sectionCandidates = mergeSectionCandidates({
    vectorLists: sectionVectorLists,
    textResults: sectionTextResults,
    docSignalMap,
  }).slice(0, recallProfile.sectionCandidates);

  const sectionRerankByIndex =
    sectionCandidates.length > 1
      ? await rerankCandidateTexts({
          query,
          documents: sectionCandidates.map((candidate) =>
            buildSectionRerankText(candidate),
          ),
          rerankingProvider: scope.rerankingProvider,
          rerankingModel: scope.rerankingModel,
          allowLlmFallback: runtime.rollout.llmRerankFallback,
        })
      : new Map<number, number>();
  if (sectionRerankByIndex.size > 0) {
    sectionCandidates = sectionCandidates
      .map((candidate, index) => {
        const rerankScore = sectionRerankByIndex.get(index);
        if (rerankScore === undefined) {
          return candidate;
        }

        const { lexicalConfidence, confidenceScore } = computeConfidenceScore({
          semanticScore: candidate.semanticScore,
          lexicalScore: candidate.lexicalScore,
          docSignal: candidate.docSignal,
          rerankScore,
        });

        return {
          ...candidate,
          rerankScore,
          lexicalConfidence,
          confidenceScore,
        };
      })
      .sort(compareRankedSectionCandidates);
  }

  let shortlistedSectionIds = uniqueStrings([
    ...structuredSectionMatches.map((match) => match.section.id),
    ...entitySectionSeeds.map((seed) => seed.sectionId),
    ...sectionCandidates.map((candidate) => candidate.section.id),
  ]);

  if (runtime.rollout.graphRead && shortlistedSectionIds.length > 0) {
    const relatedGraphSections = await getRelatedGraphSections(
      scope.id,
      shortlistedSectionIds.slice(0, 12),
      2,
    ).catch(() => []);
    shortlistedSectionIds = uniqueStrings([
      ...shortlistedSectionIds,
      ...relatedGraphSections.map((row) => row.sectionId),
    ]);
  }

  const searchFilters =
    shortlistedSectionIds.length > 0
      ? { sectionIds: shortlistedSectionIds }
      : candidateDocIds.length > 0
        ? { documentIds: candidateDocIds }
        : undefined;

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
    Promise.all(
      allQueries.map((queryVariant) =>
        knowledgeRepository.fullTextSearch(
          scope.id,
          queryVariant,
          recallProfile.chunkCandidates,
          searchFilters,
        ),
      ),
    ),
  ]);
  const multiVectorLists =
    runtime.rollout.multiVectorRead && embeddings.length > 0
      ? await Promise.all(
          embeddings.slice(0, 3).flatMap((embedding) =>
            (["content", "context", "identity", "entity"] as const).map(
              async (kind) => ({
                kind,
                results: await knowledgeRepository
                  .vectorSearchByEmbeddingKind(
                    scope.id,
                    embedding,
                    recallProfile.chunkCandidates,
                    kind,
                    searchFilters,
                  )
                  .catch(() => []),
              }),
            ),
          ),
        )
      : [];

  let chunkCandidates = mergeChunkCandidates({
    vectorLists: [
      ...vectorResults.map((results) =>
        results.filter((result) => result.score >= MIN_VECTOR_SCORE),
      ),
      ...multiVectorLists.map(({ kind, results }) =>
        results.filter(
          (result) => result.score >= MULTI_VECTOR_SCORE_FLOORS[kind],
        ),
      ),
    ],
    textResults: mergeKnowledgeResultsByChunkId(textResults.flat()),
    docSignalMap,
  }).slice(0, recallProfile.chunkCandidates);

  if (chunkCandidates.length === 0) {
    return [];
  }

  const chunkRerankByIndex =
    chunkCandidates.length > 1
      ? await rerankCandidateTexts({
          query,
          documents: chunkCandidates.map((candidate) =>
            buildChunkRerankText(candidate),
          ),
          rerankingProvider: scope.rerankingProvider,
          rerankingModel: scope.rerankingModel,
          allowLlmFallback: runtime.rollout.llmRerankFallback,
        })
      : new Map<number, number>();
  if (chunkRerankByIndex.size > 0) {
    chunkCandidates = chunkCandidates.map((candidate, index) => {
      const rerankScore = chunkRerankByIndex.get(index);
      const { lexicalConfidence, confidenceScore } = computeConfidenceScore({
        semanticScore: candidate.semanticScore,
        lexicalScore: candidate.lexicalScore,
        docSignal: candidate.docSignal,
        rerankScore,
      });

      return {
        ...candidate,
        rerankScore,
        lexicalConfidence,
        confidenceScore,
      };
    });
  }

  const threshold = scope.retrievalThreshold ?? 0;
  let sortedFinalCandidates = chunkCandidates
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
    .sort(compareRankedChunkCandidates);

  // Fallback: if all candidates were filtered by the hard floor (but NOT by
  // a user-configured threshold), admit the top-scoring ones to avoid silently
  // returning nothing when there are relevant candidates.
  if (
    sortedFinalCandidates.length === 0 &&
    chunkCandidates.length > 0 &&
    threshold <= 0
  ) {
    sortedFinalCandidates = chunkCandidates
      .sort(compareRankedChunkCandidates)
      .slice(0, Math.min(3, chunkCandidates.length));
  }

  // Minimum-representation guarantee: every document that had ANY candidate in
  // the pre-floor pool gets at least one slot in the final list. This prevents
  // cumulative/comparative documents (e.g. Q3 covering Jan-Sep) from completely
  // crowding out standalone period docs (Q1, Q2) that scored just below the
  // hard floor but are still the most relevant sources for period-specific queries.
  if (chunkCandidates.length > 0 && threshold <= 0) {
    const representedDocIds = new Set(
      sortedFinalCandidates.map((c) => c.result.documentId),
    );
    const bestByUnrepresentedDoc = new Map<string, RankedChunkCandidate>();
    for (const candidate of chunkCandidates) {
      const docId = candidate.result.documentId;
      if (representedDocIds.has(docId)) continue;
      const existing = bestByUnrepresentedDoc.get(docId);
      const candidateScore = candidate.rerankScore ?? candidate.confidenceScore;
      const existingScore = existing
        ? (existing.rerankScore ?? existing.confidenceScore)
        : -Infinity;
      if (candidateScore > existingScore) {
        bestByUnrepresentedDoc.set(docId, candidate);
      }
    }
    if (bestByUnrepresentedDoc.size > 0) {
      sortedFinalCandidates = [
        ...sortedFinalCandidates,
        ...bestByUnrepresentedDoc.values(),
      ].sort(compareRankedChunkCandidates);
    }
  }

  let finalResults: KnowledgeQueryResult[] =
    selectChunkCandidatesWithDocDiversity(sortedFinalCandidates, topN).map(
      (candidate) => ({
        ...candidate.result,
        score: candidate.confidenceScore,
        confidenceScore: candidate.confidenceScore,
        semanticScore: candidate.semanticScore,
        lexicalScore: candidate.lexicalScore,
        docSignal: candidate.docSignal,
        ...(candidate.rerankScore !== undefined
          ? { rerankScore: candidate.rerankScore }
          : {}),
      }),
    );

  finalResults = await attachNeighborContext(finalResults, scope.id);

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
    memoryPolicy: rawMemoryPolicy,
  } = options;
  const start = Date.now();
  const rollout = await getContextXRollout();
  const memoryPolicy =
    rawMemoryPolicy ?? (userId && source !== "mcp" ? "user" : "off");
  const rewrite = rollout.coreRetrieval
    ? await rewriteKnowledgeQuery(query)
    : { rewrites: [], entityTerms: [] };
  const memoryVariants = rollout.memoryFusion
    ? await getMemoryQueryVariants({
        userId,
        query,
        source,
        memoryPolicy,
        embeddingProvider: group.embeddingProvider,
        embeddingModel: group.embeddingModel,
      })
    : [];
  const constraints = mergeKnowledgeQueryConstraints(query, {
    ...rawConstraints,
    entityTerms: uniqueStrings([
      ...(rawConstraints?.entityTerms ?? []),
      ...rewrite.entityTerms,
    ]),
  });
  const runtime: QueryRuntime = {
    rollout,
    queryVariants: uniqueStrings([
      ...expandQuery(query),
      ...rewrite.rewrites,
      ...memoryVariants,
    ]).filter((item) => item.toLowerCase() !== query.trim().toLowerCase()),
  };

  const scopes = await resolveRetrievalScopes(group);
  const scopedResults = await Promise.all(
    scopes.map((scope) =>
      queryKnowledgeSingleScope(
        scope,
        query,
        Math.max(topN, FINAL_AFTER_RERANK),
        resultMode,
        constraints,
        runtime,
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

  const merged = selectResultsWithScopeDiversity(
    Array.from(mergedByChunk.values()).sort(compareKnowledgeResults),
    scopes.length,
    topN,
  );

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
  userId?: string | null;
  source?: "chat" | "agent" | "mcp";
  memoryPolicy?: MemoryPolicy;
  rolloutFingerprint?: unknown;
}) {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        cacheVersion: 6,
        query: input.query,
        retrievalThreshold: input.retrievalThreshold ?? null,
        libraryId: input.libraryId ?? null,
        libraryVersion: input.libraryVersion ?? null,
        constraints: input.constraints ?? null,
        userId: input.userId ?? null,
        source: input.source ?? "chat",
        memoryPolicy: input.memoryPolicy ?? "off",
        rollout: input.rolloutFingerprint ?? null,
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

const COMPARISON_AXIS_PRIORITY: KnowledgeRetrievalAxisKind[] = [
  "period",
  "version",
  "effective_at",
  "jurisdiction",
  "region",
  "language",
  "custom",
];

function normalizeKey(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseDocumentContext(value: unknown): KnowledgeDocumentContext | null {
  if (!isRecord(value)) return null;
  return {
    documentId: readNullableString(value.documentId),
    documentName: readNullableString(value.documentName),
    canonicalTitle: readNullableString(value.canonicalTitle),
    baseTitle: readNullableString(value.baseTitle),
  };
}

function parseSourceContext(value: unknown): KnowledgeSourceContext | null {
  if (!isRecord(value)) return null;
  return {
    libraryId: readNullableString(value.libraryId),
    libraryVersion: readNullableString(value.libraryVersion),
    sourcePath: readNullableString(value.sourcePath),
    sheetName: readNullableString(value.sheetName),
    sourceGroupName: readNullableString(value.sourceGroupName),
  };
}

function parseTemporalHints(value: unknown): KnowledgeTemporalHints | null {
  if (!isRecord(value)) return null;
  return {
    effectiveAt: readNullableString(value.effectiveAt),
    expiresAt: readNullableString(value.expiresAt),
    freshnessLabel: readNullableString(value.freshnessLabel),
  };
}

function parseDisplayContext(value: unknown): KnowledgeDisplayContext | null {
  if (!isRecord(value)) return null;
  return {
    documentLabel: readNullableString(value.documentLabel),
    variantLabel: readNullableString(value.variantLabel),
    topicLabel: readNullableString(value.topicLabel),
    locationLabel: readNullableString(value.locationLabel),
  };
}

type ResolvedDocProvenance = {
  documentContext: KnowledgeDocumentContext;
  sourceContext: KnowledgeSourceContext;
  temporalHints: KnowledgeTemporalHints | null;
  display: KnowledgeDisplayContext;
};

function buildFallbackDocProvenance(input: {
  documentId: string;
  documentName: string;
  sourceGroupName?: string | null;
}): ResolvedDocProvenance {
  const documentContext = {
    documentId: input.documentId,
    documentName: input.documentName,
    canonicalTitle: input.documentName,
    baseTitle: buildKnowledgeBaseTitle(input.documentName),
  } satisfies KnowledgeDocumentContext;
  const temporalHints =
    deriveKnowledgeTemporalHints({
      title: input.documentName,
      originalFilename: input.documentName,
    }) ?? null;
  return {
    documentContext,
    sourceContext: {
      libraryId: null,
      libraryVersion: null,
      sourcePath: null,
      sheetName: null,
      sourceGroupName: input.sourceGroupName ?? null,
    },
    temporalHints,
    display: buildKnowledgeDisplayContext({
      documentLabel: input.documentName,
      variantLabel: buildKnowledgeVariantLabel({
        title: input.documentName,
        originalFilename: input.documentName,
        temporalHints,
      }),
    }),
  };
}

function resolveDocProvenance(input: {
  documentId: string;
  documentName: string;
  metadata?: Record<string, unknown> | null;
  sourceGroupName?: string | null;
}): ResolvedDocProvenance {
  const fallback = buildFallbackDocProvenance(input);
  const metadata = input.metadata ?? null;
  const documentContext = parseDocumentContext(metadata?.documentContext) ?? {};
  const sourceContext = parseSourceContext(metadata?.sourceContext) ?? {};
  const temporalHints =
    parseTemporalHints(metadata?.temporalHints) ?? fallback.temporalHints;
  const displayContext = parseDisplayContext(metadata?.display) ?? {};

  const legacy = isRecord(metadata?.retrievalIdentity)
    ? metadata?.retrievalIdentity
    : null;
  const legacyCanonicalTitle = readNullableString(legacy?.canonicalTitle);
  const legacyVariantLabel = readNullableString(legacy?.variantLabel);

  const resolvedDocumentContext = {
    documentId: documentContext.documentId ?? input.documentId,
    documentName: documentContext.documentName ?? input.documentName,
    canonicalTitle:
      documentContext.canonicalTitle ??
      legacyCanonicalTitle ??
      input.documentName,
    baseTitle:
      documentContext.baseTitle ??
      buildKnowledgeBaseTitle(
        documentContext.canonicalTitle ??
          legacyCanonicalTitle ??
          input.documentName,
      ),
  } satisfies KnowledgeDocumentContext;
  const resolvedSourceContext = {
    libraryId: sourceContext.libraryId ?? null,
    libraryVersion: sourceContext.libraryVersion ?? null,
    sourcePath: sourceContext.sourcePath ?? null,
    sheetName: sourceContext.sheetName ?? null,
    sourceGroupName:
      sourceContext.sourceGroupName ?? input.sourceGroupName ?? null,
  } satisfies KnowledgeSourceContext;

  return {
    documentContext: resolvedDocumentContext,
    sourceContext: resolvedSourceContext,
    temporalHints,
    display: buildKnowledgeDisplayContext({
      documentLabel:
        displayContext.documentLabel ??
        resolvedDocumentContext.canonicalTitle ??
        input.documentName,
      variantLabel:
        displayContext.variantLabel ??
        legacyVariantLabel ??
        buildKnowledgeVariantLabel({
          title: [
            resolvedDocumentContext.canonicalTitle,
            resolvedDocumentContext.documentName,
          ]
            .filter(Boolean)
            .join("\n"),
          sourceUrl: resolvedSourceContext.sourcePath,
          libraryVersion: resolvedSourceContext.libraryVersion,
          temporalHints,
        }),
      topicLabel: displayContext.topicLabel ?? null,
      locationLabel: displayContext.locationLabel ?? null,
    }),
  };
}

function buildEvidenceUnitId(input: {
  documentId: string;
  sectionId?: string | null;
  topicKey: string;
  variantLabel: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  excerpt: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        documentId: input.documentId,
        sectionId: input.sectionId ?? null,
        topicKey: input.topicKey,
        variantLabel: input.variantLabel,
        pageStart: input.pageStart ?? null,
        pageEnd: input.pageEnd ?? null,
        excerpt: input.excerpt,
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

function resolveEvidenceAxes(
  item: KnowledgeEvidenceItem,
): KnowledgeRetrievalAxis[] {
  return extractKnowledgeComparisonAxesFromText({
    text: [
      item.display.variantLabel,
      item.documentContext.canonicalTitle,
      item.documentContext.documentName,
      item.locationContext.headingPath,
      item.excerpt,
    ]
      .filter(Boolean)
      .join("\n"),
    libraryVersion: item.sourceContext.libraryVersion,
    temporalHints: item.temporalHints,
  }).sort(
    (left, right) =>
      COMPARISON_AXIS_PRIORITY.indexOf(left.kind) -
      COMPARISON_AXIS_PRIORITY.indexOf(right.kind),
  );
}

function resolveEvidenceFamilyLabel(item: KnowledgeEvidenceItem): string {
  return (
    item.sourceContext.libraryId?.trim() ||
    item.documentContext.baseTitle?.trim() ||
    item.display.documentLabel?.trim() ||
    item.documentName
  );
}

function resolveEvidenceTopicLabel(item: KnowledgeEvidenceItem): string {
  return (
    item.display.topicLabel?.trim() ||
    item.locationContext.headingPath?.trim() ||
    item.display.locationLabel?.trim() ||
    "Document overview"
  );
}

function resolveEvidenceVariantLabel(item: KnowledgeEvidenceItem): string {
  return (
    item.display.variantLabel?.trim() ||
    item.documentContext.canonicalTitle?.trim() ||
    item.documentName
  );
}

function buildMatchedTopics(evidenceItems: KnowledgeEvidenceItem[] = []) {
  const grouped = new Map<string, KnowledgeMatchedTopic>();
  for (const item of evidenceItems) {
    const existing = grouped.get(item.topicKey);
    if (existing) {
      existing.evidenceCount += 1;
      existing.relevanceScore = Math.max(
        existing.relevanceScore,
        item.relevanceScore,
      );
      continue;
    }
    grouped.set(item.topicKey, {
      topicLabel: item.display.topicLabel ?? resolveEvidenceTopicLabel(item),
      relevanceScore: item.relevanceScore,
      evidenceCount: 1,
    });
  }
  return Array.from(grouped.values()).sort(
    (left, right) => right.relevanceScore - left.relevanceScore,
  );
}

function formatEvidenceContext(item: KnowledgeEvidenceItem) {
  if (item.display.locationLabel?.trim()) {
    return item.display.locationLabel.trim();
  }
  const parts: string[] = [];
  if (item.locationContext.noteNumber) {
    parts.push(
      `Note ${item.locationContext.noteNumber}${item.locationContext.noteTitle ? ` ${item.locationContext.noteTitle}` : ""}`,
    );
  }
  if (item.locationContext.pageStart && item.locationContext.pageEnd) {
    parts.push(
      item.locationContext.pageStart === item.locationContext.pageEnd
        ? `Page ${item.locationContext.pageStart}`
        : `Pages ${item.locationContext.pageStart}-${item.locationContext.pageEnd}`,
    );
  } else if (item.locationContext.pageStart) {
    parts.push(`Page ${item.locationContext.pageStart}`);
  }
  return parts.join(" | ");
}

function buildEvidenceItemFromSection(input: {
  doc: Pick<
    RankedDocCandidate,
    | "documentId"
    | "documentName"
    | "documentContext"
    | "sourceContext"
    | "temporalHints"
    | "display"
  >;
  section: Pick<
    KnowledgeSection,
    | "id"
    | "headingPath"
    | "heading"
    | "content"
    | "pageStart"
    | "pageEnd"
    | "noteNumber"
    | "noteTitle"
    | "noteSubsection"
  >;
  relevanceScore: number;
}): KnowledgeEvidenceItem {
  const temporalHints =
    deriveKnowledgeTemporalHints({
      title: input.doc.documentContext.canonicalTitle,
      content: [input.section.headingPath, input.section.content].join("\n"),
    }) ?? input.doc.temporalHints;
  const topicLabel = buildKnowledgeTopicLabel({
    headingPath: input.section.headingPath,
    sectionTitle: input.section.heading,
    noteNumber: input.section.noteNumber ?? null,
    noteSubsection: input.section.noteSubsection ?? null,
    noteTitle: input.section.noteTitle ?? null,
  });
  const locationContext = {
    sectionId: input.section.id,
    headingPath: input.section.headingPath,
    noteNumber: input.section.noteSubsection
      ? `${input.section.noteNumber ?? ""}.${input.section.noteSubsection}`
      : (input.section.noteNumber ?? null),
    noteTitle: input.section.noteTitle ?? null,
    pageStart: input.section.pageStart ?? null,
    pageEnd: input.section.pageEnd ?? null,
    chunkIndex: null,
  } satisfies KnowledgeLocationContext;
  const display = buildKnowledgeDisplayContext({
    documentLabel:
      input.doc.display.documentLabel ??
      input.doc.documentContext.canonicalTitle ??
      input.doc.documentName,
    variantLabel:
      buildKnowledgeVariantLabel({
        title: [input.doc.documentName, input.section.headingPath].join("\n"),
        libraryVersion: input.doc.sourceContext.libraryVersion,
        sourceUrl: input.doc.sourceContext.sourcePath,
        temporalHints,
        fallback: input.doc.display.variantLabel ?? null,
      }) ?? input.doc.display.variantLabel,
    topicLabel,
    locationLabel: buildKnowledgeLocationLabel({
      headingPath: input.section.headingPath,
      noteNumber: input.section.noteNumber ?? null,
      noteSubsection: input.section.noteSubsection ?? null,
      noteTitle: input.section.noteTitle ?? null,
      pageStart: input.section.pageStart ?? null,
      pageEnd: input.section.pageEnd ?? null,
    }),
  });
  const excerpt = buildCitationExcerpt(input.section.content, 320);
  const topicKey = normalizeKey(topicLabel);
  const variantLabel =
    display.variantLabel ?? input.doc.documentName ?? input.doc.documentId;

  return {
    id: buildEvidenceUnitId({
      documentId: input.doc.documentId,
      sectionId: input.section.id,
      topicKey,
      variantLabel,
      pageStart: input.section.pageStart ?? null,
      pageEnd: input.section.pageEnd ?? null,
      excerpt,
    }),
    documentId: input.doc.documentId,
    documentName: input.doc.documentName,
    topicKey,
    excerpt,
    relevanceScore: input.relevanceScore,
    documentContext: input.doc.documentContext,
    sourceContext: input.doc.sourceContext,
    locationContext,
    temporalHints,
    display,
  };
}

function buildEvidenceItemFromMatch(input: {
  doc: Pick<
    RankedDocCandidate,
    | "documentId"
    | "documentName"
    | "documentContext"
    | "sourceContext"
    | "temporalHints"
    | "display"
  >;
  match: KnowledgeQueryResult;
}): KnowledgeEvidenceItem {
  const metadata = input.match.chunk.metadata;
  const documentContext = {
    ...input.doc.documentContext,
    ...(metadata?.documentContext ?? {}),
    documentId: metadata?.documentContext?.documentId ?? input.doc.documentId,
    documentName:
      metadata?.documentContext?.documentName ?? input.doc.documentName,
    canonicalTitle:
      metadata?.documentContext?.canonicalTitle ??
      metadata?.canonicalTitle ??
      input.doc.documentContext.canonicalTitle ??
      input.doc.documentName,
    baseTitle:
      metadata?.documentContext?.baseTitle ??
      buildKnowledgeBaseTitle(
        metadata?.documentContext?.canonicalTitle ??
          metadata?.canonicalTitle ??
          input.doc.documentContext.canonicalTitle ??
          input.doc.documentName,
      ),
  } satisfies KnowledgeDocumentContext;
  const sourceContext = {
    ...input.doc.sourceContext,
    ...(metadata?.sourceContext ?? {}),
    libraryId:
      metadata?.sourceContext?.libraryId ?? metadata?.libraryId ?? null,
    libraryVersion:
      metadata?.sourceContext?.libraryVersion ??
      metadata?.libraryVersion ??
      input.doc.sourceContext.libraryVersion ??
      null,
    sourcePath:
      metadata?.sourceContext?.sourcePath ??
      metadata?.sourcePath ??
      input.doc.sourceContext.sourcePath ??
      null,
    sheetName:
      metadata?.sourceContext?.sheetName ?? metadata?.sheetName ?? null,
    sourceGroupName:
      metadata?.sourceContext?.sourceGroupName ??
      input.doc.sourceContext.sourceGroupName ??
      null,
  } satisfies KnowledgeSourceContext;
  const pageStart = metadata?.pageStart ?? metadata?.pageNumber ?? null;
  const pageEnd = metadata?.pageEnd ?? metadata?.pageNumber ?? null;
  const locationContext = {
    ...(metadata?.locationContext ?? {}),
    sectionId:
      metadata?.locationContext?.sectionId ??
      input.match.chunk.sectionId ??
      null,
    headingPath:
      metadata?.locationContext?.headingPath ??
      metadata?.headingPath ??
      metadata?.section ??
      null,
    noteNumber:
      metadata?.locationContext?.noteNumber ??
      (metadata?.noteSubsection
        ? `${metadata.noteNumber ?? ""}.${metadata.noteSubsection}`
        : (metadata?.noteNumber ?? null)),
    noteTitle:
      metadata?.locationContext?.noteTitle ?? metadata?.noteTitle ?? null,
    pageStart: metadata?.locationContext?.pageStart ?? pageStart ?? null,
    pageEnd: metadata?.locationContext?.pageEnd ?? pageEnd ?? null,
    chunkIndex:
      metadata?.locationContext?.chunkIndex ?? input.match.chunk.chunkIndex,
  } satisfies KnowledgeLocationContext;
  const temporalHints =
    metadata?.temporalHints ??
    deriveKnowledgeTemporalHints({
      title: documentContext.canonicalTitle,
      sourceUrl: sourceContext.sourcePath,
      content: [
        metadata?.headingPath,
        metadata?.sectionTitle,
        input.match.chunk.content ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
    }) ??
    input.doc.temporalHints;
  const topicLabel = buildKnowledgeTopicLabel({
    headingPath: locationContext.headingPath,
    sectionTitle: metadata?.sectionTitle ?? metadata?.section ?? null,
    noteNumber: metadata?.noteNumber ?? null,
    noteSubsection: metadata?.noteSubsection ?? null,
    noteTitle: metadata?.noteTitle ?? null,
    sourcePath: sourceContext.sourcePath,
    sheetName: sourceContext.sheetName,
  });
  const display = buildKnowledgeDisplayContext({
    documentLabel:
      metadata?.display?.documentLabel ??
      input.doc.display.documentLabel ??
      documentContext.canonicalTitle ??
      input.doc.documentName,
    variantLabel:
      metadata?.display?.variantLabel ??
      buildKnowledgeVariantLabel({
        title: [
          documentContext.canonicalTitle,
          documentContext.documentName,
          metadata?.headingPath,
        ]
          .filter(Boolean)
          .join("\n"),
        sourceUrl: sourceContext.sourcePath,
        libraryVersion: sourceContext.libraryVersion,
        temporalHints,
        fallback: input.doc.display.variantLabel ?? null,
      }) ??
      input.doc.display.variantLabel,
    topicLabel: metadata?.display?.topicLabel ?? topicLabel,
    locationLabel:
      metadata?.display?.locationLabel ??
      buildKnowledgeLocationLabel({
        headingPath: locationContext.headingPath,
        noteNumber: metadata?.noteNumber ?? null,
        noteSubsection: metadata?.noteSubsection ?? null,
        noteTitle: metadata?.noteTitle ?? null,
        pageStart,
        pageEnd,
      }),
  });
  const excerpt = buildCitationExcerpt(input.match.chunk.content ?? "", 320);
  const topicKey = normalizeKey(display.topicLabel ?? topicLabel);
  const variantLabel =
    display.variantLabel ??
    documentContext.canonicalTitle ??
    input.doc.documentName;

  return {
    id: buildEvidenceUnitId({
      documentId: input.doc.documentId,
      sectionId: input.match.chunk.sectionId ?? null,
      topicKey,
      variantLabel,
      pageStart,
      pageEnd,
      excerpt,
    }),
    documentId: input.doc.documentId,
    documentName: input.doc.documentName,
    topicKey,
    excerpt,
    relevanceScore:
      input.match.rerankScore ??
      input.match.confidenceScore ??
      input.match.score,
    documentContext,
    sourceContext,
    locationContext,
    temporalHints,
    display,
  };
}

function formatDocHeading(doc: DocRetrievalResult) {
  const title =
    doc.isInherited && doc.sourceGroupName
      ? `${doc.documentName} (from ${doc.sourceGroupName})`
      : doc.documentName;
  const lines = [`## ${title}`];
  if (doc.display?.variantLabel) {
    lines.push(`Variant: ${doc.display.variantLabel}`);
  }
  if (doc.matchedTopics?.length) {
    lines.push(
      `Matched topics: ${doc.matchedTopics
        .slice(0, 4)
        .map((topic) => topic.topicLabel)
        .join(" | ")}`,
    );
  }
  return lines.join("\n");
}

function hasSharedVariantTopic(evidenceItems: KnowledgeEvidenceItem[]) {
  const groups = new Map<string, Set<string>>();
  for (const item of evidenceItems) {
    const key = `${normalizeKey(resolveEvidenceFamilyLabel(item))}:${item.topicKey}`;
    const variants = groups.get(key) ?? new Set<string>();
    variants.add(resolveEvidenceVariantLabel(item));
    groups.set(key, variants);
  }
  return Array.from(groups.values()).some((variants) => variants.size >= 2);
}

function buildQueryAnalysis(input: {
  query?: string;
  evidenceItems: KnowledgeEvidenceItem[];
}): KnowledgeQueryAnalysis {
  const explicitAxes = extractKnowledgeComparisonAxesFromText({
    text: input.query ?? "",
  });
  const explicitCompareSignal =
    explicitAxes.length >= 2 ||
    /(compare|versus|vs\b|trend|across|between|perbandingan|bandingkan)/i.test(
      input.query ?? "",
    );

  return {
    intent:
      explicitCompareSignal || hasSharedVariantTopic(input.evidenceItems)
        ? "compare"
        : "lookup",
    explicitAxes,
    requestedTopics: extractSignificantQueryTerms(input.query ?? "").slice(
      0,
      8,
    ),
  };
}

function selectComparisonAxisKind(input: {
  explicitAxes: KnowledgeRetrievalAxis[];
  evidenceItems: KnowledgeEvidenceItem[];
}): KnowledgeRetrievalAxisKind {
  if (input.explicitAxes.length > 0) {
    return input.explicitAxes[0]?.kind ?? "custom";
  }

  const counts = new Map<KnowledgeRetrievalAxisKind, Set<string>>();
  for (const item of input.evidenceItems) {
    for (const axis of resolveEvidenceAxes(item)) {
      const values = counts.get(axis.kind) ?? new Set<string>();
      values.add(axis.key);
      counts.set(axis.kind, values);
    }
  }

  const candidate = COMPARISON_AXIS_PRIORITY.find(
    (kind) => (counts.get(kind)?.size ?? 0) >= 2,
  );
  return candidate ?? "custom";
}

function sortComparisonVariants(
  axisKind: KnowledgeRetrievalAxisKind,
  variants: KnowledgeComparisonGroup["variants"],
) {
  const compareLabels = (left: string, right: string) =>
    left.localeCompare(right, undefined, { numeric: true });

  return [...variants].sort((left, right) => {
    const leftLabel = left.axisValueLabel ?? left.variantLabel;
    const rightLabel = right.axisValueLabel ?? right.variantLabel;

    if (axisKind === "period") {
      const quarterValue = (value: string) => {
        const match = value.match(/Q([1-4])\s*(20\d{2})?/i);
        if (!match) return Number.MAX_SAFE_INTEGER;
        const year = Number.parseInt(match[2] ?? "0", 10);
        const quarter = Number.parseInt(match[1], 10);
        return year * 10 + quarter;
      };
      return quarterValue(leftLabel) - quarterValue(rightLabel);
    }

    return compareLabels(leftLabel, rightLabel);
  });
}

function buildKnowledgeRetrievalEnvelope(input: {
  groupId?: string;
  groupName: string;
  query?: string;
  docs: DocRetrievalResult[];
}): KnowledgeRetrievalEnvelope<DocRetrievalResult> {
  const evidenceItems = Array.from(
    new Map(
      input.docs
        .flatMap((doc) => doc.evidenceItems ?? [])
        .map((item) => [item.id, item] as const),
    ).values(),
  );
  const queryAnalysis = buildQueryAnalysis({
    query: input.query,
    evidenceItems,
  });

  const grouped = new Map<
    string,
    {
      familyLabel: string;
      topicLabel: string;
      evidenceItems: KnowledgeEvidenceItem[];
    }
  >();
  for (const item of evidenceItems) {
    const familyLabel = resolveEvidenceFamilyLabel(item);
    const topicLabel = resolveEvidenceTopicLabel(item);
    const key = `${normalizeKey(familyLabel)}:${item.topicKey}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.evidenceItems.push(item);
      continue;
    }
    grouped.set(key, {
      familyLabel,
      topicLabel,
      evidenceItems: [item],
    });
  }

  const comparisonGroups: KnowledgeComparisonGroup[] =
    queryAnalysis.intent === "compare"
      ? Array.from(grouped.values())
          .map((group) => {
            const axisKind = selectComparisonAxisKind({
              explicitAxes: queryAnalysis.explicitAxes,
              evidenceItems: group.evidenceItems,
            });
            const variants = new Map<
              string,
              KnowledgeComparisonGroup["variants"][number]
            >();
            for (const item of group.evidenceItems) {
              const variantLabel = resolveEvidenceVariantLabel(item);
              const axes = resolveEvidenceAxes(item);
              const axisValue = axes.find((axis) => axis.kind === axisKind);
              const key = axisValue?.key ?? normalizeKey(variantLabel);
              const existing = variants.get(key);
              if (existing) {
                existing.documentIds = Array.from(
                  new Set([...existing.documentIds, item.documentId]),
                );
                existing.documentNames = Array.from(
                  new Set([...existing.documentNames, item.documentName]),
                );
                existing.evidenceItemIds = Array.from(
                  new Set([...existing.evidenceItemIds, item.id]),
                );
                continue;
              }
              variants.set(key, {
                variantLabel: axisValue?.label ?? variantLabel,
                axisValueKey: axisValue?.key ?? null,
                axisValueLabel: axisValue?.label ?? null,
                documentIds: [item.documentId],
                documentNames: [item.documentName],
                evidenceItemIds: [item.id],
              });
            }

            if (variants.size < 2) return null;
            return {
              familyLabel: group.familyLabel,
              topicLabel: group.topicLabel,
              axisKind,
              variants: sortComparisonVariants(
                axisKind,
                Array.from(variants.values()),
              ),
            } satisfies KnowledgeComparisonGroup;
          })
          .filter((group): group is KnowledgeComparisonGroup => group !== null)
      : [];

  return {
    groupId: input.groupId,
    groupName: input.groupName,
    query: input.query,
    docs: input.docs,
    queryAnalysis,
    comparisonGroups,
    evidenceItems,
  };
}

function formatEvidenceHeader(item: KnowledgeEvidenceItem) {
  return [
    item.display.documentLabel ?? item.documentName,
    item.display.variantLabel,
    item.display.topicLabel,
    item.display.locationLabel,
  ]
    .filter(Boolean)
    .join(" | ");
}

function formatComparisonGroupsAsText(
  envelope: KnowledgeRetrievalEnvelope<DocRetrievalResult>,
) {
  if (!envelope.comparisonGroups.length) return null;

  const evidenceById = new Map(
    envelope.evidenceItems.map((item) => [item.id, item] as const),
  );
  const blocks = envelope.comparisonGroups.map((group) => {
    const lines = [
      `### ${group.familyLabel} -> ${group.topicLabel}`,
      `Compared by: ${group.axisKind}`,
      "",
    ];

    for (const variant of group.variants) {
      const items = variant.evidenceItemIds
        .map((id) => evidenceById.get(id) ?? null)
        .filter((item): item is KnowledgeEvidenceItem => item !== null)
        .sort((left, right) => right.relevanceScore - left.relevanceScore);
      const topItem = items[0];
      if (!topItem) continue;
      const context = formatEvidenceContext(topItem);
      lines.push(
        `- ${variant.variantLabel} | ${variant.documentNames.join(" / ")} | ${topItem.display.topicLabel ?? resolveEvidenceTopicLabel(topItem)}${context ? ` | ${context}` : ""}: ${topItem.excerpt}`,
      );
    }

    return lines.join("\n").trim();
  });

  return ["## Comparison", ...blocks].join("\n\n");
}

function formatDocEvidenceBlocks(doc: DocRetrievalResult) {
  if (!doc.evidenceItems?.length) return null;

  return [
    "Evidence:",
    ...doc.evidenceItems
      .slice(0, 4)
      .map((item) => `- ${formatEvidenceHeader(item)}: ${item.excerpt}`),
  ].join("\n");
}

function formatDocsBodyAsText(docs: DocRetrievalResult[]) {
  return docs
    .map((doc) =>
      [formatDocHeading(doc), formatDocEvidenceBlocks(doc), doc.markdown]
        .filter(Boolean)
        .join("\n\n")
        .trim(),
    )
    .join("\n\n");
}

export function formatKnowledgeRetrievalEnvelopeAsText(
  envelope: KnowledgeRetrievalEnvelope<DocRetrievalResult>,
): string {
  if (envelope.docs.length === 0) {
    return `[Knowledge: ${envelope.groupName}]\nNo relevant content found${envelope.query ? ` for: "${envelope.query}"` : ""}.`;
  }

  const comparisonText = formatComparisonGroupsAsText(envelope);
  const docText = formatDocsBodyAsText(envelope.docs);
  return [`[Knowledge: ${envelope.groupName}]`, comparisonText, docText]
    .filter(Boolean)
    .join("\n\n");
}

type RankedDocCandidate = Omit<
  DocRetrievalResult,
  "markdown" | "matchedSections" | "citationCandidates" | "matchedImages"
> & {
  sectionGraphVersion: number | null;
  imageHits?: number;
  imageEvidenceScore?: number;
  freshnessScore?: number;
  rerankScore?: number;
};

type SectionBundleCandidate = {
  doc: RankedDocCandidate;
  section: KnowledgeSection;
  matches: KnowledgeQueryResult[];
  score: number;
  hitCount: number;
};

function buildDocRerankText(input: {
  doc: RankedDocCandidate;
  matches: KnowledgeQueryResult[];
}): string {
  const evidence = input.matches
    .slice(0, 3)
    .map((match) =>
      [match.chunk.contextSummary, match.chunk.content]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");

  return [
    `document: ${input.doc.documentName}`,
    evidence ? `evidence:\n${evidence}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

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

function shouldRefineCitationPage(
  candidate: Pick<RetrievedKnowledgeCitation, "pageStart" | "pageEnd">,
): boolean {
  return (
    candidate.pageStart == null ||
    candidate.pageEnd == null ||
    candidate.pageStart !== candidate.pageEnd
  );
}

function refineCitationCandidatePage(input: {
  candidate: RetrievedKnowledgeCitation;
  markdown: string;
  snippets: string[];
}): RetrievedKnowledgeCitation {
  if (!shouldRefineCitationPage(input.candidate)) {
    return input.candidate;
  }

  const inference = inferCitationPageFromMarkdown({
    markdown: input.markdown,
    snippets: input.snippets,
  });
  if (inference == null) {
    return input.candidate;
  }

  const canSafelyOverride =
    input.candidate.pageStart == null ||
    input.candidate.pageEnd == null ||
    inference.usedLegalReference ||
    inference.score >= 100;
  if (!canSafelyOverride) {
    return input.candidate;
  }

  return {
    ...input.candidate,
    pageStart: inference.pageNumber,
    pageEnd: inference.pageNumber,
  };
}

function getMatchCitationScore(match: KnowledgeQueryResult): number {
  return match.rerankScore ?? match.confidenceScore ?? match.score ?? 0;
}

function buildCitationReferenceText(match: KnowledgeQueryResult): string {
  return [
    match.chunk.metadata?.headingPath,
    match.chunk.metadata?.section,
    match.chunk.contextSummary,
    match.chunk.content,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");
}

function extractPrimaryCitationAnchorKey(
  match: KnowledgeQueryResult,
): string | null {
  const legalReference = extractPrimaryLegalReferenceKey(
    buildCitationReferenceText(match),
  );
  if (legalReference) {
    return `legal:${legalReference}`;
  }

  const headingAnchor = normalizeCitationLookupText(
    match.chunk.metadata?.headingPath ?? match.chunk.metadata?.section ?? "",
  );
  if (headingAnchor) {
    return `heading:${headingAnchor}`;
  }

  const contentAnchor = normalizeCitationLookupText(match.chunk.content)
    .split(/\s+/)
    .slice(0, 8)
    .join(" ");
  return contentAnchor ? `content:${contentAnchor}` : null;
}

function selectDiverseCitationMatches(
  matches: KnowledgeQueryResult[],
  maxCandidates = 4,
): KnowledgeQueryResult[] {
  if (maxCandidates <= 0 || matches.length === 0) return [];

  const rankedMatches = [...matches].sort(
    (left, right) => getMatchCitationScore(right) - getMatchCitationScore(left),
  );
  const selected: KnowledgeQueryResult[] = [];
  const selectedChunkIds = new Set<string>();
  const selectedPrimaryAnchors = new Set<string>();

  const trySelect = (
    match: KnowledgeQueryResult,
    requireNewPrimary: boolean,
  ) => {
    if (selected.length >= maxCandidates) return;
    if (selectedChunkIds.has(match.chunk.id)) return;

    const primaryAnchor = extractPrimaryCitationAnchorKey(match);
    if (requireNewPrimary && !primaryAnchor) return;
    if (
      requireNewPrimary &&
      primaryAnchor &&
      selectedPrimaryAnchors.has(primaryAnchor)
    ) {
      return;
    }

    selected.push(match);
    selectedChunkIds.add(match.chunk.id);
    if (primaryAnchor) {
      selectedPrimaryAnchors.add(primaryAnchor);
    }
  };

  for (const match of rankedMatches) {
    trySelect(match, true);
  }

  for (const match of rankedMatches) {
    trySelect(match, false);
  }

  return selected;
}

function buildCitationSnippetHints(input: {
  matches?: KnowledgeQueryResult[];
  fallbacks?: Array<string | null | undefined>;
}): string[] {
  const candidates = [
    ...(input.matches ?? [])
      .slice()
      .sort((left, right) => {
        const leftScore =
          left.rerankScore ?? left.confidenceScore ?? left.score;
        const rightScore =
          right.rerankScore ?? right.confidenceScore ?? right.score;
        return rightScore - leftScore;
      })
      .flatMap((match) => [
        match.chunk.metadata?.headingPath,
        match.chunk.metadata?.section,
        match.chunk.contextSummary,
        match.chunk.content,
      ]),
    ...(input.fallbacks ?? []),
  ];

  return Array.from(
    new Set(
      candidates
        .map((value) => value?.replace(/\s+/g, " ").trim() ?? "")
        .filter((value) => value.length >= 24),
    ),
  ).slice(0, 4);
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
    pageStart: topMatchPageStart ?? input.section.pageStart ?? null,
    pageEnd: topMatchPageEnd ?? input.section.pageEnd ?? null,
    excerpt: buildCitationExcerpt(
      input.section.content || topMatch?.chunk.content || input.section.summary,
    ),
    relevanceScore: input.relevanceScore,
  };
}

function buildSectionCitationEntries(input: {
  section: KnowledgeSection;
  matches: KnowledgeQueryResult[];
  versionId?: string | null;
  relevanceScore: number;
  maxCandidates?: number;
}): Array<{
  candidate: RetrievedKnowledgeCitation;
  pageSnippets: string[];
}> {
  const rankedMatches = selectDiverseCitationMatches(
    input.matches,
    input.maxCandidates ?? 3,
  );
  const entries: Array<{
    candidate: RetrievedKnowledgeCitation;
    pageSnippets: string[];
  }> = [];
  const seenKeys = new Set<string>();

  for (const match of rankedMatches) {
    const matchScore =
      match.rerankScore ?? match.confidenceScore ?? match.score ?? 0;
    const candidate = {
      ...buildChunkCitationCandidate({
        match,
        versionId: input.versionId ?? null,
      }),
      sectionId: match.chunk.sectionId ?? input.section.id,
      sectionHeading: getSectionCitationHeading(input.section),
      relevanceScore: Math.max(input.relevanceScore, matchScore),
    } satisfies RetrievedKnowledgeCitation;
    const key = [
      candidate.sectionId ?? "",
      candidate.pageStart ?? "",
      candidate.pageEnd ?? "",
      candidate.excerpt,
    ].join("::");
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    entries.push({
      candidate,
      pageSnippets: buildCitationSnippetHints({
        matches: [match],
        fallbacks: [
          match.chunk.content,
          match.chunk.contextSummary,
          input.section.summary,
        ],
      }),
    });
  }

  if (entries.length > 0) {
    return entries;
  }

  return [
    {
      candidate: buildSectionCitationCandidate(input),
      pageSnippets: buildCitationSnippetHints({
        matches: input.matches,
        fallbacks: [input.section.summary, input.section.content],
      }),
    },
  ];
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
  page?: number;
  note?: string;
  userId?: string | null;
  source?: "chat" | "agent" | "mcp";
  memoryPolicy?: MemoryPolicy;
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
  documentContext: KnowledgeDocumentContext;
  sourceContext: KnowledgeSourceContext;
  temporalHints?: KnowledgeTemporalHints | null;
  display: KnowledgeDisplayContext;
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
  matchedTopics?: KnowledgeMatchedTopic[];
  evidenceItems?: KnowledgeEvidenceItem[];
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

type RetrievedKnowledgeImageMatch = RetrievedKnowledgeImage &
  Pick<
    KnowledgeDocumentImage,
    | "caption"
    | "altText"
    | "surroundingText"
    | "precedingText"
    | "followingText"
    | "imageType"
    | "ocrText"
    | "ocrConfidence"
    | "exactValueSnippets"
    | "structuredData"
  >;

type ImageEvidenceStats = {
  hitCount: number;
  maxScore: number;
  meanScore: number;
  images: RetrievedKnowledgeImageMatch[];
};

function extractImageMatchTerms(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, " ")
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(
          (term) =>
            (term.length >= 3 || (/\d/.test(term) && term.length >= 2)) &&
            !IMAGE_FALLBACK_STOP_WORDS.has(term),
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

function buildCompactImageEvidenceText(
  image: Pick<
    KnowledgeDocumentImage,
    | "imageType"
    | "ocrText"
    | "ocrConfidence"
    | "exactValueSnippets"
    | "structuredData"
  >,
): string {
  return buildKnowledgeImageStructuredSummary({
    imageType: image.imageType ?? null,
    ocrText: image.ocrText ?? null,
    ocrConfidence: image.ocrConfidence ?? null,
    exactValueSnippets: image.exactValueSnippets ?? null,
    structuredData: image.structuredData ?? null,
  });
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
    | "imageType"
    | "ocrText"
    | "ocrConfidence"
    | "exactValueSnippets"
    | "structuredData"
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
    buildCompactImageEvidenceText(image),
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
    | "imageType"
    | "ocrText"
    | "ocrConfidence"
    | "exactValueSnippets"
    | "structuredData"
  >,
): {
  visual: string;
  structure: string;
  neighbor: string;
  evidence: string;
} {
  const evidence = buildCompactImageEvidenceText(image);
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
    evidence,
  };
}

function toRetrievedKnowledgeImageMatch(
  image: KnowledgeDocumentImage & { score: number },
): RetrievedKnowledgeImageMatch {
  return {
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
    caption: image.caption ?? null,
    altText: image.altText ?? null,
    surroundingText: image.surroundingText ?? null,
    precedingText: image.precedingText ?? null,
    followingText: image.followingText ?? null,
    imageType: image.imageType ?? null,
    ocrText: image.ocrText ?? null,
    ocrConfidence: image.ocrConfidence ?? null,
    exactValueSnippets: image.exactValueSnippets ?? null,
    structuredData: image.structuredData ?? null,
  };
}

function toPublicRetrievedKnowledgeImage(
  image: RetrievedKnowledgeImageMatch,
): RetrievedKnowledgeImage {
  return {
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
    relevanceScore: image.relevanceScore,
  };
}

async function searchImagesAcrossScopes(input: {
  query: string;
  scopes: RetrievalScope[];
  documentIdsByScope?: Map<string, string[]>;
  limit: number;
}): Promise<Array<KnowledgeDocumentImage & { score: number }>> {
  const rankedLists: Array<{
    results: Array<KnowledgeDocumentImage & { score: number }>;
    weight: number;
  }> = [];

  await Promise.all(
    input.scopes.map(async (scope) => {
      const documentIds = input.documentIdsByScope?.get(scope.id);
      if (
        input.documentIdsByScope &&
        (!documentIds || documentIds.length === 0)
      ) {
        return;
      }

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
          .fullTextSearchImages(scope.id, input.query, input.limit, documentIds)
          .catch(() => []),
        queryEmbedding
          ? knowledgeRepository
              .vectorSearchImages(
                scope.id,
                queryEmbedding,
                input.limit,
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

  return rankedLists.length > 0 ? weightedImageRrfMerge(rankedLists) : [];
}

function buildImageEvidenceStats(
  images: Array<KnowledgeDocumentImage & { score: number }>,
): Map<string, ImageEvidenceStats> {
  const grouped = new Map<
    string,
    Array<KnowledgeDocumentImage & { score: number }>
  >();

  for (const image of images) {
    const list = grouped.get(image.documentId) ?? [];
    list.push(image);
    grouped.set(image.documentId, list);
  }

  const stats = new Map<string, ImageEvidenceStats>();
  for (const [documentId, docImages] of grouped.entries()) {
    const topImages = docImages
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(toRetrievedKnowledgeImageMatch);
    const maxScore = topImages[0]?.relevanceScore ?? 0;
    const meanScore =
      topImages.length > 0
        ? topImages.reduce((sum, image) => sum + image.relevanceScore, 0) /
          topImages.length
        : 0;
    stats.set(documentId, {
      hitCount: topImages.length,
      maxScore,
      meanScore,
      images: topImages,
    });
  }

  return stats;
}

function selectRelevantImageEvidenceLines(
  query: string,
  image: RetrievedKnowledgeImageMatch,
): string[] {
  const queryTerms = extractImageMatchTerms(query);
  const exactValues = (image.exactValueSnippets ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((line) => ({ line, priority: 3 }));
  const ocrLines = (image.ocrText ?? "")
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 3)
    .map((line) => ({ line, priority: 2 }));
  const structuredLines = buildCompactImageEvidenceText(image)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ line, priority: 1 }));

  const ranked = [...exactValues, ...ocrLines, ...structuredLines]
    .map((line) => ({
      line: line.line,
      priority: line.priority,
      overlap: computeImageTextOverlap(queryTerms, line.line),
    }))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (b.overlap !== a.overlap) return b.overlap - a.overlap;
      return b.line.length - a.line.length;
    })
    .map((entry) => entry.line);

  return Array.from(new Set(ranked)).slice(0, 3);
}

function buildImageEvidenceBlock(
  query: string,
  images: RetrievedKnowledgeImageMatch[],
): string | null {
  if (images.length === 0) return null;

  const blocks = images.slice(0, 2).map((image) => {
    const lines = selectRelevantImageEvidenceLines(query, image);
    const pageLabel =
      image.pageNumber != null ? `page ${image.pageNumber}` : "page unknown";
    const typeLabel = image.imageType ?? "image";
    const summary = buildCompactImageEvidenceText(image)
      .split("\n")
      .find((line) =>
        /^(Chart summary|Table summary|OCR confidence)/.test(line),
      )
      ?.trim();

    return [
      `Image: ${image.label} (${pageLabel}, ${typeLabel})`,
      lines[0] ? `Evidence: ${lines[0]}` : "",
      lines[1] ? `Evidence: ${lines[1]}` : "",
      lines[2] ? `Evidence: ${lines[2]}` : "",
      summary ? summary : "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  return blocks.length > 0
    ? `### Image Evidence\n\n${blocks.join("\n\n")}`
    : null;
}

function buildImageCitationCandidates(
  query: string,
  images: RetrievedKnowledgeImageMatch[],
): RetrievedKnowledgeCitation[] {
  return images.slice(0, 2).map((image) => {
    const evidenceLines = selectRelevantImageEvidenceLines(query, image);
    const excerpt =
      image.exactValueSnippets?.[0] ??
      evidenceLines[0] ??
      image.description ??
      buildCompactImageEvidenceText(image) ??
      image.label;

    return {
      versionId: image.versionId ?? null,
      sectionId: null,
      sectionHeading: null,
      pageStart: image.pageNumber ?? null,
      pageEnd: image.pageNumber ?? null,
      excerpt,
      relevanceScore: image.relevanceScore,
    };
  });
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
  const evidenceOverlap = computeImageTextOverlap(
    input.matchContext.matchedSectionTerms,
    weightedText.evidence,
  );
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
        headingOverlap * 0.18 +
        evidenceOverlap * 0.12 +
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
    computeImageTextOverlap(input.queryTerms, weightedText.neighbor) * 0.1 +
    computeImageTextOverlap(input.queryTerms, weightedText.evidence) * 0.35;
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
      0.1 +
    computeImageTextOverlap(
      input.matchContext.matchedSectionTerms,
      weightedText.evidence,
    ) *
      0.1;
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
}): Promise<Map<string, RetrievedKnowledgeImageMatch[]>> {
  if (input.docs.length === 0) return new Map();

  const docIdsByScope = new Map<string, string[]>();
  for (const doc of input.docs) {
    const scopeId = doc.sourceGroupId ?? null;
    if (!scopeId) continue;
    const list = docIdsByScope.get(scopeId) ?? [];
    list.push(doc.documentId);
    docIdsByScope.set(scopeId, list);
  }

  const scopedResults = await searchImagesAcrossScopes({
    query: input.query,
    scopes: Array.from(input.scopeById.values()),
    documentIdsByScope: docIdsByScope,
    limit: CANDIDATE_LIMIT,
  });

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

  const merged = scopedResults
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
    .sort((a, b) => b.score - a.score);

  const topScore = merged[0]?.score ?? 0;
  const normalized =
    topScore > 0
      ? merged.map((image) => ({
          ...image,
          score: image.score / topScore,
        }))
      : merged;

  const selected: RetrievedKnowledgeImageMatch[] = [];
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
    selected.push(toRetrievedKnowledgeImageMatch(image));
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

      selected.push(
        toRetrievedKnowledgeImageMatch({
          ...candidate.image,
          score: candidate.score,
        }),
      );
      perDocCounts.set(candidate.image.documentId, currentDocCount + 1);
      selectedImageKeys.add(imageKey);
    }
  }

  const imagesByDocId = new Map<string, RetrievedKnowledgeImageMatch[]>();
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
  scopeById: Map<string, RetrievalScope>;
}): Promise<{ results: DocRetrievalResult[]; tokensUsed: number }> {
  const { docsToAssemble, chunkStats, query, tokenBudget, scopeById } = input;
  const results: DocRetrievalResult[] = [];
  let tokensUsed = 0;
  const embeddingCache = new Map<string, number[] | null>();

  for (const doc of docsToAssemble) {
    const remaining = tokenBudget - tokensUsed;
    if (remaining < 120) break;

    const docData = await knowledgeRepository.getDocumentMarkdown(
      doc.documentId,
    );
    if (!docData?.markdown) continue;

    const existingMatches = chunkStats.get(doc.documentId)?.matches ?? [];
    const citationMatches =
      existingMatches.length > 0
        ? existingMatches
        : await backfillChunkMatchesForDocument({
            doc,
            query,
            scopeById,
            embeddingCache,
            limit: 6,
          });

    const contentTokens = estimateTokens(docData.markdown);
    if (contentTokens + tokensUsed <= tokenBudget) {
      const selectedCitationMatches = selectDiverseCitationMatches(
        citationMatches,
        4,
      );
      const evidenceItems = selectedCitationMatches.map((match) =>
        buildEvidenceItemFromMatch({
          doc,
          match,
        }),
      );
      const citationCandidates = Array.from(
        new Map(
          selectedCitationMatches.map((match) => {
            const candidate = refineCitationCandidatePage({
              candidate: buildChunkCitationCandidate({
                match,
                versionId: doc.versionId ?? null,
              }),
              markdown: docData.markdown,
              snippets: buildCitationSnippetHints({
                matches: [match],
              }),
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
      ).slice(0, 4);

      results.push({
        documentId: doc.documentId,
        documentName: doc.documentName,
        sourceGroupId: doc.sourceGroupId,
        sourceGroupName: doc.sourceGroupName,
        isInherited: doc.isInherited,
        versionId: doc.versionId ?? null,
        documentContext: doc.documentContext,
        sourceContext: doc.sourceContext,
        temporalHints: doc.temporalHints,
        display: doc.display,
        relevanceScore: doc.relevanceScore,
        chunkHits: doc.chunkHits,
        markdown: docData.markdown,
        matchedTopics: buildMatchedTopics(evidenceItems),
        evidenceItems,
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
      chunkMatches: citationMatches,
    });
    if (!truncated) break;

    const selectedCitationMatches = selectDiverseCitationMatches(
      citationMatches,
      4,
    );
    const evidenceItems = selectedCitationMatches.map((match) =>
      buildEvidenceItemFromMatch({
        doc,
        match,
      }),
    );
    results.push({
      documentId: doc.documentId,
      documentName: doc.documentName,
      sourceGroupId: doc.sourceGroupId,
      sourceGroupName: doc.sourceGroupName,
      isInherited: doc.isInherited,
      versionId: doc.versionId ?? null,
      documentContext: doc.documentContext,
      sourceContext: doc.sourceContext,
      temporalHints: doc.temporalHints,
      display: doc.display,
      relevanceScore: doc.relevanceScore,
      chunkHits: doc.chunkHits,
      markdown: truncated,
      matchedTopics: buildMatchedTopics(evidenceItems),
      evidenceItems,
      citationCandidates: Array.from(
        new Map(
          selectedCitationMatches.map((match) => {
            const candidate = refineCitationCandidatePage({
              candidate: buildChunkCitationCandidate({
                match,
                versionId: doc.versionId ?? null,
              }),
              markdown: docData.markdown,
              snippets: buildCitationSnippetHints({
                matches: [match],
              }),
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
      ).slice(0, 4),
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
  query: string;
  scopeById: Map<string, RetrievalScope>;
}): Promise<{
  results: DocRetrievalResult[];
  tokensUsed: number;
  sectionCount: number;
}> {
  const {
    docsToAssemble,
    chunkStats,
    tokenBudget,
    threshold,
    query,
    scopeById,
  } = input;
  if (docsToAssemble.length === 0) {
    return { results: [], tokensUsed: 0, sectionCount: 0 };
  }

  // Backfill chunk matches for rescued docs that have no chunk hits in chunkStats.
  // Without this, rescued docs (those with strong metadata signal but chunkHits=0)
  // would produce empty sectionCandidates and be completely invisible to the model.
  const embeddingCache = new Map<string, number[] | null>();
  const docsNeedingBackfill = docsToAssemble.filter(
    (doc) => (chunkStats.get(doc.documentId)?.chunkHits ?? 0) === 0,
  );
  if (docsNeedingBackfill.length > 0) {
    await Promise.all(
      docsNeedingBackfill.map(async (doc) => {
        const backfilled = await backfillChunkMatchesForDocument({
          doc,
          query,
          scopeById,
          embeddingCache,
          limit: 6,
        });
        if (backfilled.length > 0) {
          chunkStats.set(doc.documentId, {
            name: doc.documentName,
            chunkHits: backfilled.length,
            sumScore: backfilled.reduce(
              (sum, c) => sum + (c.confidenceScore ?? c.score ?? 0),
              0,
            ),
            maxScore: Math.max(
              ...backfilled.map((c) => c.confidenceScore ?? c.score ?? 0),
            ),
            matches: backfilled,
          });
        }
      }),
    );
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
      evidenceItems: KnowledgeEvidenceItem[];
      citationCandidates: Array<{
        candidate: RetrievedKnowledgeCitation;
        pageSnippets: string[];
      }>;
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
      existing.evidenceItems.push(
        buildEvidenceItemFromSection({
          doc: bundle.doc,
          section: bundle.section,
          relevanceScore: bundle.score,
        }),
      );
      existing.citationCandidates.push(
        ...buildSectionCitationEntries({
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
      evidenceItems: [
        buildEvidenceItemFromSection({
          doc: bundle.doc,
          section: bundle.section,
          relevanceScore: bundle.score,
        }),
      ],
      citationCandidates: buildSectionCitationEntries({
        section: bundle.section,
        matches: bundle.matches,
        versionId: bundle.doc.versionId ?? null,
        relevanceScore: bundle.score,
      }),
    });
  }

  const results: DocRetrievalResult[] = [];

  for (const doc of docsToAssemble) {
    const aggregatedDoc = aggregated.get(doc.documentId);
    if (!aggregatedDoc) continue;

    const needsPageRefinement = aggregatedDoc.citationCandidates.some(
      ({ candidate }) => shouldRefineCitationPage(candidate),
    );
    const docMarkdown = needsPageRefinement
      ? ((await knowledgeRepository.getDocumentMarkdown(doc.documentId))
          ?.markdown ?? null)
      : null;

    results.push({
      documentId: aggregatedDoc.documentId,
      documentName: aggregatedDoc.documentName,
      sourceGroupId: aggregatedDoc.sourceGroupId,
      sourceGroupName: aggregatedDoc.sourceGroupName,
      isInherited: aggregatedDoc.isInherited,
      versionId: aggregatedDoc.versionId ?? null,
      documentContext: aggregatedDoc.documentContext,
      sourceContext: aggregatedDoc.sourceContext,
      temporalHints: aggregatedDoc.temporalHints,
      display: aggregatedDoc.display,
      relevanceScore: aggregatedDoc.relevanceScore,
      chunkHits: aggregatedDoc.chunkHits,
      markdown: `${aggregatedDoc.blocks.join("\n\n---\n\n")}\n\n[... section-first context]`,
      matchedSections: aggregatedDoc.matchedSections,
      matchedTopics: buildMatchedTopics(aggregatedDoc.evidenceItems),
      evidenceItems: aggregatedDoc.evidenceItems,
      citationCandidates: Array.from(
        new Map(
          aggregatedDoc.citationCandidates.map(
            ({ candidate, pageSnippets }) => {
              const resolvedCandidate =
                docMarkdown && pageSnippets.length > 0
                  ? refineCitationCandidatePage({
                      candidate,
                      markdown: docMarkdown,
                      snippets: pageSnippets,
                    })
                  : candidate;
              const key = [
                resolvedCandidate.sectionId ?? "",
                resolvedCandidate.pageStart ?? "",
                resolvedCandidate.pageEnd ?? "",
                resolvedCandidate.excerpt,
              ].join("::");
              return [key, resolvedCandidate] as const;
            },
          ),
        ).values(),
      ),
    });
  }

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

/**
 * Extracts period/time tokens from a query string. Used to boost documents
 * whose title and description directly mention the queried period (e.g. Q1, Q2,
 * Maret, Juni, 2025) so they are not crowded out by cumulative documents that
 * happen to score better semantically because they cover multiple periods.
 */
function extractPeriodTokensFromQuery(query: string): string[] {
  const tokens: string[] = [];
  // Quarter markers (Q1–Q4, q1–q4)
  for (const m of query.matchAll(/\bQ[1-4]\b/gi))
    tokens.push(m[0].toLowerCase());
  // Indonesian and English month names commonly used in financial reports
  for (const m of query.matchAll(
    /\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi,
  ))
    tokens.push(m[0].toLowerCase());
  // 4-digit years
  for (const m of query.matchAll(/\b20\d{2}\b/g)) tokens.push(m[0]);
  return [...new Set(tokens)];
}

async function queryKnowledgeAsDocsImpl(
  group: GroupForRetrieval,
  query: string,
  options: QueryKnowledgeDocsOptions = {},
): Promise<DocRetrievalResult[]> {
  const constraints = mergeKnowledgeQueryConstraints(query, {
    page: options.page,
    note: options.note,
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
  const rollout = await getContextXRollout();
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
    userId: options.userId ?? null,
    source: options.source ?? "chat",
    memoryPolicy:
      options.memoryPolicy ??
      (options.userId && (options.source ?? "chat") !== "mcp" ? "user" : "off"),
    rolloutFingerprint: rollout,
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
    userId: options.userId ?? null,
    source: options.source ?? "chat",
    memoryPolicy:
      options.memoryPolicy ??
      (options.userId && (options.source ?? "chat") !== "mcp" ? "user" : "off"),
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

  // Additional targeted metadata search using only period tokens (e.g. "Q1 2025").
  // The full query creates a long AND-style tsquery that no single doc passes,
  // making BM25 on doc metadata fail to distinguish "Q1 2025" from "Q3 2025".
  // Running a focused short query fixes this discrimination problem.
  const periodQuery = extractPeriodTokensFromQuery(query).join(" ");
  if (periodQuery) {
    const periodSignalMaps = await Promise.all(
      scopes.map(async (scope) => {
        let periodEmbedding: number[] | undefined;
        if (DOC_META_VECTOR_ENABLED) {
          periodEmbedding = await embedSingleText(
            periodQuery,
            scope.embeddingProvider,
            scope.embeddingModel,
          ).catch(() => undefined);
        }
        return getDocumentMetadataSignals(
          scope.id,
          periodQuery,
          periodEmbedding,
          recallProfile.docCandidates,
        );
      }),
    );
    for (const signalMap of periodSignalMaps) {
      for (const [docId, score] of signalMap.entries()) {
        const existing = docSignalMap.get(docId) ?? 0;
        if (score > existing) docSignalMap.set(docId, score);
      }
    }
  }
  const imageEvidenceByDoc =
    rollout.imageEvidenceRead && !options.libraryId && !options.libraryVersion
      ? buildImageEvidenceStats(
          await searchImagesAcrossScopes({
            query,
            scopes,
            limit: Math.min(
              recallProfile.docCandidates * 4,
              Math.max(CANDIDATE_LIMIT, maxDocs * 6),
            ),
          }),
        )
      : new Map<string, ImageEvidenceStats>();

  const scopedChunkResults = chunkResults.filter((hit) =>
    chunkMatchesLibraryScope({
      hit,
      libraryId: options.libraryId,
      libraryVersion: options.libraryVersion,
    }),
  );
  if (options.libraryId && scopedChunkResults.length === 0) return [];
  if (
    scopedChunkResults.length === 0 &&
    docSignalMap.size === 0 &&
    imageEvidenceByDoc.size === 0
  ) {
    return [];
  }

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
    const documentId = r.chunk.documentId || r.documentId;
    const score = Math.max(0, r.confidenceScore ?? r.score);
    const hitIncrement = score > 0 ? 1 : 0;
    const existing = chunkStats.get(documentId);
    if (existing) {
      existing.chunkHits += hitIncrement;
      existing.sumScore += score;
      existing.maxScore = Math.max(existing.maxScore, score);
      existing.matches.push(r);
    } else {
      chunkStats.set(documentId, {
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
  const topImageSignalIds =
    options.libraryId || options.libraryVersion
      ? []
      : Array.from(imageEvidenceByDoc.entries())
          .sort((a, b) => b[1].maxScore - a[1].maxScore)
          .slice(0, recallProfile.docCandidates)
          .map(([docId]) => docId);

  const candidateDocIds = Array.from(
    new Set([...chunkStats.keys(), ...topDocSignalIds, ...topImageSignalIds]),
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

  const now = Date.now();
  const periodTokens = extractPeriodTokensFromQuery(query);
  let rankedDocs: RankedDocCandidate[] = candidateDocMetaInScope
    .map((doc) => {
      const stats = chunkStats.get(doc.documentId);
      const metadataSignal = docSignalMap.get(doc.documentId) ?? 0;
      const imageStats = imageEvidenceByDoc.get(doc.documentId);
      const imageEvidenceScore = imageStats
        ? imageStats.maxScore * 0.72 + imageStats.meanScore * 0.28
        : 0;
      const avgChunkScore =
        stats && stats.chunkHits > 0 ? stats.sumScore / stats.chunkHits : 0;
      const maxChunkScore = stats?.maxScore ?? 0;
      const hitScore = Math.min(1, (stats?.chunkHits ?? 0) / 5);
      const imageHitScore = Math.min(1, (imageStats?.hitCount ?? 0) / 3);

      // Boost docs whose title/description explicitly mention the queried
      // period tokens (e.g. "Q1", "Maret", "2025"). This prevents cumulative
      // docs (Q3 covering Jan–Sep) from crowding out standalone period docs.
      const docText = `${doc.name} ${doc.description ?? ""}`.toLowerCase();
      const titlePeriodMatch =
        periodTokens.length > 0
          ? periodTokens.filter((t) => docText.includes(t)).length /
            periodTokens.length
          : 0;

      const relevanceScoreRaw =
        maxChunkScore * 0.42 +
        avgChunkScore * 0.14 +
        hitScore * 0.04 +
        metadataSignal * 0.18 +
        titlePeriodMatch * 0.12 +
        imageEvidenceScore * 0.08 +
        imageHitScore * 0.02;
      const relevanceScore = Math.max(0, Math.min(1, relevanceScoreRaw));

      const ageDays = Math.max(
        0,
        (now - new Date(doc.updatedAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      const freshnessScore = Math.exp(-ageDays / 90);
      const sourceScope = scopeById.get(doc.groupId);
      const provenance = resolveDocProvenance({
        documentId: doc.documentId,
        documentName: stats?.name ?? doc.name,
        metadata: doc.metadata,
        sourceGroupName: sourceScope?.name ?? null,
      });

      return {
        documentId: doc.documentId,
        documentName: stats?.name ?? doc.name,
        sourceGroupId: doc.groupId,
        sourceGroupName: sourceScope?.name ?? null,
        isInherited: doc.groupId !== group.id,
        versionId: doc.activeVersionId ?? null,
        documentContext: provenance.documentContext,
        sourceContext: provenance.sourceContext,
        temporalHints: provenance.temporalHints,
        display: provenance.display,
        chunkHits: stats?.chunkHits ?? 0,
        imageHits: imageStats?.hitCount ?? 0,
        imageEvidenceScore,
        relevanceScore,
        freshnessScore,
        sectionGraphVersion: getSectionGraphVersion(doc.metadata),
        rerankScore: undefined,
      };
    })
    .sort((a, b) => {
      const delta = b.relevanceScore - a.relevanceScore;
      if (Math.abs(delta) >= 0.03) return delta;
      return b.freshnessScore - a.freshnessScore;
    });

  const docRerankByIndex =
    rankedDocs.length > 1
      ? await rerankCandidateTexts({
          query,
          documents: rankedDocs.map((doc) =>
            buildDocRerankText({
              doc,
              matches: chunkStats.get(doc.documentId)?.matches ?? [],
            }),
          ),
          rerankingProvider: group.rerankingProvider,
          rerankingModel: group.rerankingModel,
          allowLlmFallback: rollout.llmRerankFallback,
        })
      : new Map<number, number>();
  if (docRerankByIndex.size > 0) {
    rankedDocs = rankedDocs
      .map((doc, index) => {
        const rerankScore = docRerankByIndex.get(index);
        if (rerankScore === undefined) {
          return doc;
        }

        return {
          ...doc,
          rerankScore,
          relevanceScore: Math.max(
            0,
            Math.min(1, 0.65 * rerankScore + 0.35 * doc.relevanceScore),
          ),
        };
      })
      .sort((a, b) => {
        const leftScore = a.rerankScore ?? a.relevanceScore;
        const rightScore = b.rerankScore ?? b.relevanceScore;
        const delta = rightScore - leftScore;
        if (Math.abs(delta) >= 0.03) {
          return delta;
        }
        return (b.freshnessScore ?? 0) - (a.freshnessScore ?? 0);
      });
  }

  // Thresholds were already enforced per scope in queryKnowledge().
  const threshold = scopes.length > 1 ? 0 : (group.retrievalThreshold ?? 0);
  const filteredDocs =
    threshold > 0
      ? rankedDocs.filter((d) => d.relevanceScore >= threshold)
      : rankedDocs;
  if (filteredDocs.length === 0) return [];
  // In section-first mode keep docs that have direct chunk hits at the normal
  // threshold. Additionally rescue docs that have no chunk hits yet but carry a
  // strong doc-level metadata signal — those are often highly relevant docs
  // whose chunks were crowded out by a dominant document in the shared pool.
  const sectionFirstThreshold = Math.max(threshold, 0.24);
  const docsToAssemble =
    resultMode === "section-first"
      ? (() => {
          const primary = filteredDocs.filter(
            (d) => d.chunkHits > 0 && d.relevanceScore >= sectionFirstThreshold,
          );
          if (primary.length >= maxDocs) return primary.slice(0, maxDocs);

          // Rescue: docs with strong metadata signal that didn't win chunks.
          const rescued = filteredDocs.filter(
            (d) =>
              d.chunkHits === 0 &&
              (docSignalMap.get(d.documentId) ?? 0) >= 0.35 &&
              !primary.some((p) => p.documentId === d.documentId),
          );
          return [...primary, ...rescued].slice(0, maxDocs);
        })()
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
      query,
      scopeById,
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
        scopeById,
      });
      results = fallback.results;
      tokensUsed = fallback.tokensUsed;
    }
    if (results.length > 0 && tokensUsed < tokenBudget) {
      const imageOnlyDocs = filteredDocs.filter(
        (doc) =>
          doc.chunkHits === 0 &&
          (doc.imageHits ?? 0) > 0 &&
          !results.some((result) => result.documentId === doc.documentId),
      );
      if (imageOnlyDocs.length > 0) {
        const supplemental = await assembleFullDocResults({
          docsToAssemble: imageOnlyDocs.slice(
            0,
            Math.max(1, maxDocs - results.length),
          ),
          chunkStats,
          query,
          tokenBudget: tokenBudget - tokensUsed,
          scopeById,
        });
        results = [...results, ...supplemental.results];
        tokensUsed += supplemental.tokensUsed;
      }
    }
  } else {
    const assembled = await assembleFullDocResults({
      docsToAssemble,
      chunkStats,
      query,
      tokenBudget,
      scopeById,
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
  results = results.map((result) => {
    const matchedImageMatches =
      matchedImagesByDocId.get(result.documentId) ?? [];
    const imageEvidenceBlock = rollout.imageEvidenceContext
      ? buildImageEvidenceBlock(query, matchedImageMatches)
      : null;
    const imageCitationCandidates = rollout.imageEvidenceContext
      ? buildImageCitationCandidates(query, matchedImageMatches)
      : [];
    const citationCandidates = Array.from(
      new Map(
        [...(result.citationCandidates ?? []), ...imageCitationCandidates].map(
          (candidate) => {
            const key = [
              candidate.sectionId ?? "",
              candidate.pageStart ?? "",
              candidate.pageEnd ?? "",
              candidate.excerpt,
            ].join("::");
            return [key, candidate] as const;
          },
        ),
      ).values(),
    );

    return {
      ...result,
      markdown: imageEvidenceBlock
        ? `${result.markdown}\n\n${imageEvidenceBlock}`
        : result.markdown,
      citationCandidates,
      matchedImages: matchedImageMatches.map(toPublicRetrievedKnowledgeImage),
    };
  });

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

export async function queryKnowledgeStructured(
  group: GroupForRetrieval,
  query: string,
  options: QueryKnowledgeDocsOptions = {},
): Promise<KnowledgeRetrievalEnvelope<DocRetrievalResult>> {
  const docs = await queryKnowledgeAsDocsImpl(group, query, options);
  return buildKnowledgeRetrievalEnvelope({
    groupId: group.id,
    groupName: group.name,
    query,
    docs,
  });
}

export async function queryKnowledgeAsDocs(
  group: GroupForRetrieval,
  query: string,
  options: QueryKnowledgeDocsOptions = {},
): Promise<DocRetrievalResult[]> {
  const envelope = await queryKnowledgeStructured(group, query, options);
  return envelope.docs;
}

/**
 * Format doc retrieval results as a single markdown text block for LLM injection.
 */
export function formatDocsAsText(
  groupName: string,
  docs: DocRetrievalResult[],
  query?: string,
): string {
  return formatKnowledgeRetrievalEnvelopeAsText(
    buildKnowledgeRetrievalEnvelope({
      groupName,
      query,
      docs,
    }),
  );
}
