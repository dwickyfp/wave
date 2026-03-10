import type { Agent } from "app-types/agent";
import { getLearnedPersonalizationPromptForUser } from "lib/self-learning/runtime";

export type AgentPersonalizationSurface =
  | "platform_chat"
  | "external_access"
  | "a2a";

export function isPlatformChatPersonalizationEnabled(
  agent?: Pick<Agent, "chatPersonalizationEnabled"> | null,
) {
  return agent?.chatPersonalizationEnabled !== false;
}

export async function resolveAgentPersonalizationPrompt(options: {
  surface: AgentPersonalizationSurface;
  platformUserId?: string | null;
  agent?: Pick<Agent, "chatPersonalizationEnabled"> | null;
}): Promise<string | false> {
  if (options.surface !== "platform_chat") {
    return false;
  }

  if (!options.platformUserId) {
    return false;
  }

  if (!isPlatformChatPersonalizationEnabled(options.agent)) {
    return false;
  }

  return getLearnedPersonalizationPromptForUser(options.platformUserId);
}
