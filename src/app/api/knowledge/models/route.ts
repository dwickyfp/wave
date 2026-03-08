import { settingsRepository } from "lib/db/repository";

export const GET = async () => {
  try {
    const dbProviders = await settingsRepository.getProviders({
      enabledOnly: true,
    });

    const embeddingProviders = dbProviders
      .map((p) => ({
        provider: p.name,
        displayName: p.displayName,
        hasAPIKey: !!p.apiKeyMasked,
        models: p.models
          .filter((m) => m.enabled && m.modelType === "embedding")
          .map((m) => ({ uiName: m.uiName, apiName: m.apiName })),
      }))
      .filter((p) => p.models.length > 0);

    const rerankingProviders = dbProviders
      .map((p) => ({
        provider: p.name,
        displayName: p.displayName,
        hasAPIKey: !!p.apiKeyMasked,
        models: p.models
          .filter((m) => m.enabled && m.modelType === "reranking")
          .map((m) => ({ uiName: m.uiName, apiName: m.apiName })),
      }))
      .filter((p) => p.models.length > 0);

    const chatProviders = dbProviders
      .map((p) => ({
        provider: p.name,
        displayName: p.displayName,
        hasAPIKey: !!p.apiKeyMasked,
        models: p.models
          .filter((m) => m.enabled && m.modelType === "llm")
          .map((m) => ({ uiName: m.uiName, apiName: m.apiName })),
      }))
      .filter((p) => p.models.length > 0);

    return Response.json({
      embeddingProviders,
      rerankingProviders,
      chatProviders,
    });
  } catch {
    return Response.json(
      { embeddingProviders: [], rerankingProviders: [], chatProviders: [] },
      { status: 200 },
    );
  }
};
