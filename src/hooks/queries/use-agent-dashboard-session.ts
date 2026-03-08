"use client";

import type {
  AgentDashboardSessionDetail,
  AgentDashboardSessionSource,
} from "app-types/agent-dashboard";
import { fetcher } from "lib/utils";
import useSWR from "swr";

export function useAgentDashboardSession(options: {
  agentId?: string;
  sessionId?: string;
  source?: AgentDashboardSessionSource;
  enabled?: boolean;
}) {
  const shouldFetch =
    options.enabled &&
    options.agentId &&
    options.sessionId &&
    options.source &&
    (options.source === "in_app" || options.source === "external_chat");

  const key = shouldFetch
    ? `/api/agent/${options.agentId}/dashboard/session/${options.sessionId}?source=${options.source}`
    : null;

  return useSWR<AgentDashboardSessionDetail>(key, fetcher);
}
