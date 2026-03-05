import { getSession } from "auth/server";
import { settingsRepository } from "lib/db/repository";
import { NextResponse } from "next/server";

// Static provider metadata for seeding
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  google: "Google AI",
  anthropic: "Anthropic",
  xai: "xAI Grok",
  groq: "Groq",
  ollama: "Ollama",
  openRouter: "OpenRouter",
};

// Static model data from models.ts structure
const STATIC_MODELS: Array<{
  provider: string;
  uiName: string;
  apiName: string;
  supportsTools: boolean;
  supportsImageInput: boolean;
  supportsFileInput: boolean;
}> = [
  // OpenRouter (aggregator)
  {
    provider: "openRouter",
    uiName: "gpt-oss-20b:free",
    apiName: "openai/gpt-oss-20b:free",
    supportsTools: false,
    supportsImageInput: false,
    supportsFileInput: false,
  },
  {
    provider: "openRouter",
    uiName: "qwen3-8b:free",
    apiName: "qwen/qwen3-8b:free",
    supportsTools: false,
    supportsImageInput: false,
    supportsFileInput: false,
  },
  {
    provider: "openRouter",
    uiName: "qwen3-14b:free",
    apiName: "qwen/qwen3-14b:free",
    supportsTools: false,
    supportsImageInput: false,
    supportsFileInput: false,
  },
  {
    provider: "openRouter",
    uiName: "qwen3-coder:free",
    apiName: "qwen/qwen3-coder:free",
    supportsTools: true,
    supportsImageInput: false,
    supportsFileInput: false,
  },
  {
    provider: "openRouter",
    uiName: "deepseek-r1:free",
    apiName: "deepseek/deepseek-r1-0528:free",
    supportsTools: false,
    supportsImageInput: false,
    supportsFileInput: false,
  },
  {
    provider: "openRouter",
    uiName: "deepseek-v3:free",
    apiName: "deepseek/deepseek-chat-v3-0324:free",
    supportsTools: true,
    supportsImageInput: false,
    supportsFileInput: false,
  },
  {
    provider: "openRouter",
    uiName: "gemini-2.0-flash-exp:free",
    apiName: "google/gemini-2.0-flash-exp:free",
    supportsTools: true,
    supportsImageInput: false,
    supportsFileInput: true,
  },
  // OpenAI
  {
    provider: "openai",
    uiName: "gpt-4.1",
    apiName: "openai/gpt-4.1",
    supportsTools: true,
    supportsImageInput: true,
    supportsFileInput: true,
  },
  {
    provider: "openai",
    uiName: "gpt-4.1-mini",
    apiName: "openai/gpt-4.1-mini",
    supportsTools: true,
    supportsImageInput: true,
    supportsFileInput: true,
  },
  {
    provider: "openai",
    uiName: "o4-mini",
    apiName: "openai/o4-mini",
    supportsTools: false,
    supportsImageInput: true,
    supportsFileInput: false,
  },
  {
    provider: "openai",
    uiName: "o3",
    apiName: "openai/o3",
    supportsTools: true,
    supportsImageInput: true,
    supportsFileInput: false,
  },
  {
    provider: "openai",
    uiName: "gpt-5.1-chat",
    apiName: "openai/gpt-5.1-chat-latest",
    supportsTools: true,
    supportsImageInput: true,
    supportsFileInput: false,
  },
  {
    provider: "openai",
    uiName: "gpt-5.1",
    apiName: "openai/gpt-5.1",
    supportsTools: true,
    supportsImageInput: true,
    supportsFileInput: false,
  },
  // Google
  {
    provider: "google",
    uiName: "gemini-2.5-flash-lite",
    apiName: "google/gemini-2.5-flash-lite",
    supportsTools: true,
    supportsImageInput: true,
    supportsFileInput: true,
  },
  {
    provider: "google",
    uiName: "gemini-2.5-flash",
    apiName: "google/gemini-2.5-flash",
    supportsTools: true,
    supportsImageInput: true,
    supportsFileInput: true,
  },
  {
    provider: "google",
    uiName: "gemini-3-pro",
    apiName: "google/gemini-3-pro-preview",
    supportsTools: true,
    supportsImageInput: true,
    supportsFileInput: true,
  },
  {
    provider: "google",
    uiName: "gemini-2.5-pro",
    apiName: "google/gemini-2.5-pro",
    supportsTools: true,
    supportsImageInput: true,
    supportsFileInput: true,
  },
  // Anthropic
  {
    provider: "anthropic",
    uiName: "sonnet-4.5",
    apiName: "anthropic/claude-sonnet-4-5",
    supportsTools: true,
    supportsImageInput: true,
    supportsFileInput: true,
  },
  {
    provider: "anthropic",
    uiName: "haiku-4.5",
    apiName: "anthropic/claude-haiku-4-5",
    supportsTools: true,
    supportsImageInput: false,
    supportsFileInput: false,
  },
  {
    provider: "anthropic",
    uiName: "opus-4.5",
    apiName: "anthropic/claude-opus-4-5",
    supportsTools: true,
    supportsImageInput: true,
    supportsFileInput: true,
  },
  // xAI
  {
    provider: "xai",
    uiName: "grok-4-1-fast",
    apiName: "x-ai/grok-4.1-fast",
    supportsTools: true,
    supportsImageInput: true,
    supportsFileInput: true,
  },
  {
    provider: "xai",
    uiName: "grok-4-1",
    apiName: "x-ai/grok-4.1",
    supportsTools: true,
    supportsImageInput: true,
    supportsFileInput: true,
  },
  {
    provider: "xai",
    uiName: "grok-3-mini",
    apiName: "x-ai/grok-3-mini",
    supportsTools: true,
    supportsImageInput: true,
    supportsFileInput: true,
  },
  // Groq
  {
    provider: "groq",
    uiName: "kimi-k2-instruct",
    apiName: "moonshotai/kimi-k2",
    supportsTools: true,
    supportsImageInput: false,
    supportsFileInput: false,
  },
  {
    provider: "groq",
    uiName: "llama-4-scout-17b",
    apiName: "meta-llama/llama-4-scout-17b-16e-instruct",
    supportsTools: true,
    supportsImageInput: false,
    supportsFileInput: false,
  },
  {
    provider: "groq",
    uiName: "gpt-oss-20b",
    apiName: "openai/gpt-oss-20b",
    supportsTools: true,
    supportsImageInput: false,
    supportsFileInput: false,
  },
  {
    provider: "groq",
    uiName: "gpt-oss-120b",
    apiName: "openai/gpt-oss-120b",
    supportsTools: true,
    supportsImageInput: false,
    supportsFileInput: false,
  },
  {
    provider: "groq",
    uiName: "qwen3-32b",
    apiName: "qwen/qwen3-32b",
    supportsTools: true,
    supportsImageInput: false,
    supportsFileInput: false,
  },
  // Ollama
  {
    provider: "ollama",
    uiName: "gemma3:1b",
    apiName: "google/gemma-3-1b-it",
    supportsTools: false,
    supportsImageInput: false,
    supportsFileInput: false,
  },
  {
    provider: "ollama",
    uiName: "gemma3:4b",
    apiName: "google/gemma-3-4b-it",
    supportsTools: false,
    supportsImageInput: false,
    supportsFileInput: false,
  },
  {
    provider: "ollama",
    uiName: "gemma3:12b",
    apiName: "google/gemma-3-12b-it",
    supportsTools: false,
    supportsImageInput: false,
    supportsFileInput: false,
  },
];

export async function POST() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Group models by provider
    const byProvider = new Map<string, typeof STATIC_MODELS>();
    for (const m of STATIC_MODELS) {
      const key =
        m.provider.toLowerCase() === "openrouter" ? "openrouter" : m.provider;
      if (!byProvider.has(key)) byProvider.set(key, []);
      byProvider.get(key)!.push(m);
    }

    let importedCount = 0;

    for (const [providerKey, models] of byProvider.entries()) {
      const displayName =
        PROVIDER_DISPLAY_NAMES[providerKey] ||
        providerKey.charAt(0).toUpperCase() + providerKey.slice(1);

      // Upsert provider (don't overwrite existing api_key)
      const provider = await settingsRepository.upsertProvider({
        name: providerKey,
        displayName,
        enabled: true,
      });

      // Insert models that don't already exist
      const existingModels = await settingsRepository.getModelsByProvider(
        provider.id,
      );
      const existingUiNames = new Set(existingModels.map((m) => m.uiName));

      for (const [index, model] of models.entries()) {
        if (existingUiNames.has(model.uiName)) continue;

        await settingsRepository.createModel(provider.id, {
          apiName: model.apiName,
          uiName: model.uiName,
          enabled: true,
          supportsTools: model.supportsTools,
          supportsImageInput: model.supportsImageInput,
          supportsImageGeneration: false,
          supportsFileInput: model.supportsFileInput,
          modelType: "llm" as const,
          sortOrder: index,
        });
        importedCount++;
      }
    }

    return NextResponse.json({ success: true, imported: importedCount });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to seed models" },
      { status: 500 },
    );
  }
}
