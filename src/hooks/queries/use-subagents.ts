import useSWR from "swr";
import { SubAgent } from "app-types/subagent";
import { fetcher } from "lib/utils";

export function useSubAgents(agentId?: string | null) {
  return useSWR<SubAgent[]>(
    agentId ? `/api/agent/${agentId}/subagent` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      fallbackData: [],
    },
  );
}
