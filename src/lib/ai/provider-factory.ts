import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOllama } from "ollama-ai-provider-v2";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { LanguageModel } from "ai";
import { ChatModel } from "app-types/chat";
import { settingsRepository } from "lib/db/repository";

/**
 * Creates a LanguageModel instance from a provider name + API model name,
 * using the given API key and base URL.
 */
export function createModelFromConfig(
  providerName: string,
  modelApiName: string,
  apiKey?: string | null,
  baseUrl?: string | null,
): LanguageModel | null {
  try {
    switch (providerName) {
      case "openrouter": {
        const key = apiKey || process.env.OPENROUTER_API_KEY;
        if (!key) return null;
        const provider = createOpenRouter({ apiKey: key });
        return provider(modelApiName) as LanguageModel;
      }

      case "openai": {
        const key = apiKey || process.env.OPENAI_API_KEY;
        if (!key) return null;
        const provider = createOpenAI({
          apiKey: key,
          ...(baseUrl ? { baseURL: baseUrl } : {}),
        });
        return provider(modelApiName);
      }

      case "anthropic": {
        const key = apiKey || process.env.ANTHROPIC_API_KEY;
        if (!key) return null;
        const provider = createAnthropic({ apiKey: key });
        return provider(modelApiName);
      }

      case "google": {
        const key = apiKey || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!key) return null;
        const provider = createGoogleGenerativeAI({ apiKey: key });
        return provider(modelApiName);
      }

      case "xai": {
        const key = apiKey || process.env.XAI_API_KEY;
        if (!key) return null;
        const provider = createXai({ apiKey: key });
        return provider(modelApiName);
      }

      case "groq": {
        const key = apiKey || process.env.GROQ_API_KEY;
        if (!key) return null;
        const provider = createGroq({ apiKey: key });
        return provider(modelApiName);
      }

      case "ollama": {
        const url =
          baseUrl ||
          process.env.OLLAMA_BASE_URL ||
          "http://localhost:11434/api";
        const provider = createOllama({ baseURL: url });
        return provider(modelApiName);
      }

      default: {
        // Generic OpenAI-compatible provider
        if (!baseUrl) return null;
        const key = apiKey || "";
        const provider = createOpenAICompatible({
          name: providerName,
          apiKey: key,
          baseURL: baseUrl,
        });
        return provider(modelApiName);
      }
    }
  } catch {
    return null;
  }
}

export type DbModelResult = {
  model: LanguageModel;
  supportsTools: boolean;
  supportsImageInput: boolean;
  supportsFileInput: boolean;
};

/**
 * Looks up the given ChatModel in the database and returns a LanguageModel
 * instance (with capability flags) using the stored provider API key.
 * Returns null if not found or not configured.
 */
export async function getDbModel(
  chatModel: ChatModel | undefined | null,
): Promise<DbModelResult | null> {
  if (!chatModel) return null;
  try {
    const providerConfig = await settingsRepository.getProviderByName(
      chatModel.provider,
    );
    if (!providerConfig || !providerConfig.enabled) return null;

    const modelConfig = await settingsRepository.getModelForChat(
      chatModel.provider,
      chatModel.model,
    );
    if (!modelConfig) return null;

    const model = createModelFromConfig(
      chatModel.provider,
      modelConfig.apiName,
      providerConfig.apiKey,
      providerConfig.baseUrl,
    );
    if (!model) return null;

    return {
      model,
      supportsTools: modelConfig.supportsTools,
      supportsImageInput: modelConfig.supportsImageInput,
      supportsFileInput: modelConfig.supportsFileInput,
    };
  } catch {
    return null;
  }
}
