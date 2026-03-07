"use client";

import type { AgentDashboardStats } from "app-types/agent-dashboard";
import { fetcher } from "lib/utils";
import useSWR from "swr";

export function useAgentDashboard(agentId?: string, days = 30) {
  return useSWR<AgentDashboardStats>(
    agentId ? `/api/agent/${agentId}/dashboard?days=${days}` : null,
    fetcher,
  );
}
