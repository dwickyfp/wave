import { settingsRepository } from "lib/db/repository";

export const GET = async () => {
  try {
    const dbProviders = await settingsRepository.getProviders({
      enabledOnly: true,
    });

    const providerList = dbProviders
      .filter((p) => p.models.some((m) => m.enabled))
      .map((p) => ({
        provider: p.name,
        models: p.models
          .filter((m) => m.enabled)
          .map((m) => ({
            name: m.uiName,
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
          })),
        hasAPIKey: !!p.apiKeyMasked,
      }))
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
