import type { Agent } from "app-types/agent";
import type { ChatModel } from "app-types/chat";
import { settingsRepository } from "lib/db/repository";
import { z } from "zod";

export const VOICE_AGENT_MODEL_KEY = "voice-agent-model";

export const VoiceAgentModelConfigSchema = z.object({
  provider: z.string().min(1, "Provider is required"),
  model: z.string().min(1, "Model is required"),
});

export type VoiceAgentModelConfig = z.infer<typeof VoiceAgentModelConfigSchema>;

type ProviderModelCandidate = {
  apiName?: string | null;
  uiName?: string | null;
  enabled: boolean;
  supportsTools: boolean;
  modelType?: string | null;
};

type ProviderCandidate = {
  name: string;
  models: ProviderModelCandidate[];
};

function isToolCapableLlmModel(model: ProviderModelCandidate) {
  return (
    model.enabled &&
    model.supportsTools &&
    (!model.modelType || model.modelType === "llm")
  );
}

function toChatModel(
  provider: string,
  model: ProviderModelCandidate,
): ChatModel {
  return {
    provider,
    model: model.uiName || model.apiName || "",
  };
}

function findConfiguredModel(
  providers: ProviderCandidate[],
  config: VoiceAgentModelConfig,
) {
  const provider = providers.find((item) => item.name === config.provider);
  const model = provider?.models.find(
    (candidate) =>
      isToolCapableLlmModel(candidate) &&
      (candidate.uiName === config.model || candidate.apiName === config.model),
  );

  if (!provider || !model) {
    return null;
  }

  return toChatModel(provider.name, model);
}

export function resolveVoiceAgentModelSelection(input: {
  agent?: Pick<Agent, "agentType" | "mcpModelProvider" | "mcpModelName"> | null;
  defaultConfig?: VoiceAgentModelConfig | null;
  providers: ProviderCandidate[];
}): ChatModel | null {
  if (
    input.agent?.agentType === "snowflake_cortex" ||
    input.agent?.agentType === "a2a_remote"
  ) {
    return null;
  }

  if (input.agent?.mcpModelProvider && input.agent?.mcpModelName) {
    const configuredAgentModel = findConfiguredModel(input.providers, {
      provider: input.agent.mcpModelProvider,
      model: input.agent.mcpModelName,
    });

    if (!configuredAgentModel) {
      throw new Error(
        "Configured agent MCP model is unavailable or not tool-capable. Update this agent's MCP model selection before starting voice chat.",
      );
    }

    return configuredAgentModel;
  }

  if (!input.defaultConfig) {
    throw new Error(
      "Default Voice Agent Model is not configured. Set it in Emma Model Setup before starting voice chat.",
    );
  }

  const configuredDefaultModel = findConfiguredModel(
    input.providers,
    input.defaultConfig,
  );

  if (!configuredDefaultModel) {
    throw new Error(
      "Configured Default Voice Agent Model is unavailable or not tool-capable. Update Emma Model Setup before starting voice chat.",
    );
  }

  return configuredDefaultModel;
}

export async function getVoiceAgentModelConfig() {
  const config = await settingsRepository.getSetting(VOICE_AGENT_MODEL_KEY);
  if (!config) {
    return null;
  }

  return VoiceAgentModelConfigSchema.parse(config);
}

export async function resolveVoiceAgentChatModel(input: {
  agent?: Pick<Agent, "agentType" | "mcpModelProvider" | "mcpModelName"> | null;
}) {
  const [providers, defaultConfig] = await Promise.all([
    settingsRepository.getProviders({ enabledOnly: true }),
    getVoiceAgentModelConfig(),
  ]);

  return resolveVoiceAgentModelSelection({
    agent: input.agent ?? null,
    defaultConfig,
    providers,
  });
}
