import { settingsRepository } from "lib/db/repository";

export const GET = async () => {
  try {
    const dbProviders = await settingsRepository.getProviders({
      enabledOnly: true,
    });

    const providerList = dbProviders
      .filter((p) => p.models.some((m) => m.enabled))
      .map((p) => {
        const enabledModels = p.models.filter((m) => m.enabled);

        const llmModels = enabledModels
          .filter((m) => !m.modelType || m.modelType === "llm")
          .map((m) => ({
            name: m.uiName,
            contextLength: m.contextLength,
            supportsGeneration: m.supportsGeneration,
            isToolCallUnsupported: !m.supportsTools,
            isImageInputUnsupported: !m.supportsImageInput,
            supportedFileMimeTypes: m.supportsFileInput
              ? [
                  "image/jpeg",
                  "image/png",
                  "image/webp",
                  "image/gif",
                  "application/pdf",
                ]
              : [],
          }));

        const imageGenerationModels = enabledModels
          .filter((m) => m.modelType === "image_generation")
          .map((m) => ({
            name: m.uiName,
            supportsImageInput: m.supportsImageInput,
          }));

        return {
          provider: p.name,
          models: llmModels,
          imageGenerationModels,
          hasAPIKey: !!p.apiKeyMasked,
        };
      })
      .filter((p) => p.models.length > 0 || p.imageGenerationModels.length > 0)
      .sort((a, b) => {
        if (a.hasAPIKey && !b.hasAPIKey) return -1;
        if (!a.hasAPIKey && b.hasAPIKey) return 1;
        return 0;
      });

    return Response.json(providerList);
  } catch {
    return Response.json([], { status: 200 });
  }
};
