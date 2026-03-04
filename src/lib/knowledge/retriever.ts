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

const RRF_K = 60;
const CANDIDATE_LIMIT = 30;
const FINAL_BEFORE_RERANK = 20;
const FINAL_AFTER_RERANK = 10;

function rrfMerge(
  vectorResults: KnowledgeQueryResult[],
  textResults: KnowledgeQueryResult[],
): KnowledgeQueryResult[] {
  const scores = new Map<
    string,
    { result: KnowledgeQueryResult; score: number }
  >();

  vectorResults.forEach((r, rank) => {
    const s = 1 / (RRF_K + rank + 1);
    scores.set(r.chunk.id, { result: r, score: s });
  });

  textResults.forEach((r, rank) => {
    const s = 1 / (RRF_K + rank + 1);
    const existing = scores.get(r.chunk.id);
    if (existing) {
      existing.score += s;
    } else {
      scores.set(r.chunk.id, { result: r, score: s });
    }
  });

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ result, score }) => ({ ...result, score }));
}

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

  // 1. Embed the query
  const queryEmbedding = await embedSingleText(
    query,
    group.embeddingProvider,
    group.embeddingModel,
  );

  // 2. Hybrid search: vector + full-text
  const [vectorResults, textResults] = await Promise.all([
    knowledgeRepository.vectorSearch(group.id, queryEmbedding, CANDIDATE_LIMIT),
    knowledgeRepository.fullTextSearch(group.id, query, CANDIDATE_LIMIT),
  ]);

  // 3. RRF merge
  const merged = rrfMerge(vectorResults, textResults).slice(
    0,
    FINAL_BEFORE_RERANK,
  );

  if (merged.length === 0) {
    return [];
  }

  // 4. Rerank if configured
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
        const { rerankedDocuments, ranking } = await rerank({
          model: rerankModel,
          query,
          documents: merged.map((r) => r.chunk.content),
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

  // 5. Log usage
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
      const docRef = r.documentName;
      const summary = r.chunk.contextSummary
        ? `\n*Context: ${r.chunk.contextSummary}*`
        : "";
      return `[${i + 1}] **${docRef}** (relevance: ${(r.rerankScore ?? r.score).toFixed(2)})${summary}\n\n${r.chunk.content}`;
    })
    .join("\n\n---\n\n");

  return `[Knowledge: ${group.name}]\n\n${citations}`;
}
