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
  const swr = useSWR<KnowledgeDocument[]>(
    groupId ? `/api/knowledge/${groupId}/documents` : null,
    fetcher,
    {
      // Only poll while at least one document is actively ingesting.
      // When all docs are settled (ready/failed) the interval drops to 0,
      // preventing the periodic refetch that causes the drawer glitch.
      refreshInterval: (data) =>
        data?.some((d) => d.status === "pending" || d.status === "processing")
          ? 2000
          : 0,
    },
  );
  return swr;
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
