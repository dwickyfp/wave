"use client";

import useSWR from "swr";
import { fetcher } from "lib/utils";

export type KnowledgeModelEntry = { uiName: string; apiName: string };

export type KnowledgeProviderGroup = {
  provider: string;
  displayName: string;
  hasAPIKey: boolean;
  models: KnowledgeModelEntry[];
};

export type KnowledgeModelsResponse = {
  embeddingProviders: KnowledgeProviderGroup[];
  rerankingProviders: KnowledgeProviderGroup[];
};

export function useKnowledgeModels() {
  return useSWR<KnowledgeModelsResponse>("/api/knowledge/models", fetcher, {
    dedupingInterval: 60_000 * 5,
    revalidateOnFocus: false,
    fallbackData: { embeddingProviders: [], rerankingProviders: [] },
  });
}
