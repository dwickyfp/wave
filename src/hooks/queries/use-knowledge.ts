"use client";

import useSWR, { mutate } from "swr";
import { fetcher } from "lib/utils";
import {
  KnowledgeSummary,
  KnowledgeDocument,
  KnowledgeUsageStats,
} from "app-types/knowledge";
import { appStore } from "@/app/store";

export function useKnowledge(filters = "mine,shared") {
  return useSWR<KnowledgeSummary[]>(
    `/api/knowledge?filters=${filters}`,
    fetcher,
    {
      onSuccess: (data) => {
        appStore.setState({ knowledgeList: data });
      },
    },
  );
}

export function useKnowledgeDocuments(groupId: string) {
  return useSWR<KnowledgeDocument[]>(
    groupId ? `/api/knowledge/${groupId}/documents` : null,
    fetcher,
    { refreshInterval: 5000 }, // Poll every 5s to catch processing updates
  );
}

export function useKnowledgeUsage(groupId: string, days = 7) {
  return useSWR<KnowledgeUsageStats>(
    groupId ? `/api/knowledge/${groupId}/usage?days=${days}` : null,
    fetcher,
  );
}

export function mutateKnowledge() {
  return mutate(
    (key: unknown) =>
      typeof key === "string" && key.startsWith("/api/knowledge"),
  );
}
