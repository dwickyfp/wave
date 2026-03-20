import type { AgentSummary } from "app-types/agent";

export type AgentDiscoveryFilter = "all" | "mine" | "shared" | "bookmarked";

export function mergeDiscoverableAgents(
  ...groups: AgentSummary[][]
): AgentSummary[] {
  const seenIds = new Set<string>();

  return groups.flat().filter((agent) => {
    if (seenIds.has(agent.id)) {
      return false;
    }

    seenIds.add(agent.id);
    return true;
  });
}

export function shouldSyncAgentStore(filters: AgentDiscoveryFilter[]) {
  return filters.includes("all");
}
