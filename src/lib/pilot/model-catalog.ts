import type { ChatModel } from "app-types/chat";
import type { PilotModelProvider } from "app-types/pilot";

type ProviderModel = {
  enabled: boolean;
  uiName: string;
  apiName: string;
  contextLength: number;
  supportsGeneration: boolean;
  supportsTools: boolean;
  supportsImageInput: boolean;
  supportsFileInput: boolean;
  modelType?: string | null;
};

type ProviderRecord = {
  name: string;
  apiKeyMasked?: string | null;
  models: ProviderModel[];
};

export function buildPilotModelProviders(
  providers: ProviderRecord[],
): PilotModelProvider[] {
  return providers
    .filter((provider) => provider.models.some((model) => model.enabled))
    .map((provider) => {
      const models = provider.models
        .filter(
          (model) =>
            model.enabled &&
            model.supportsTools &&
            (!model.modelType || model.modelType === "llm"),
        )
        .map((model) => ({
          name: model.uiName || model.apiName,
          contextLength: model.contextLength,
          supportsGeneration: model.supportsGeneration,
          isToolCallUnsupported: !model.supportsTools,
          isImageInputUnsupported: !model.supportsImageInput,
          supportedFileMimeTypes: model.supportsFileInput
            ? [
                "image/jpeg",
                "image/png",
                "image/webp",
                "image/gif",
                "application/pdf",
              ]
            : [],
        }));

      return {
        provider: provider.name,
        hasAPIKey: Boolean(provider.apiKeyMasked),
        models,
      };
    })
    .filter((provider) => provider.models.length > 0)
    .sort((a, b) => {
      if (a.hasAPIKey && !b.hasAPIKey) return -1;
      if (!a.hasAPIKey && b.hasAPIKey) return 1;
      return 0;
    });
}

export function resolveDefaultPilotChatModelFromProviders(
  providers: ProviderRecord[],
): ChatModel | null {
  const pilotProviders = buildPilotModelProviders(providers);
  const firstProvider =
    pilotProviders.find((provider) => provider.hasAPIKey) ?? pilotProviders[0];
  const firstModel = firstProvider?.models[0];

  if (!firstProvider || !firstModel) {
    return null;
  }

  return {
    provider: firstProvider.provider,
    model: firstModel.name,
  };
}
