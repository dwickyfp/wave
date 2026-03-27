import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { createAzure } from "@ai-sdk/azure";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createGroq } from "@ai-sdk/groq";
import { createCohere } from "@ai-sdk/cohere";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOllama } from "ollama-ai-provider-v2";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { LanguageModel, RerankingModel } from "ai";
import { ChatModel } from "app-types/chat";
import type { ProviderSettings } from "app-types/settings";
import { CacheKeys } from "lib/cache/cache-keys";
import { serverCache } from "lib/cache";
import { settingsRepository } from "lib/db/repository";

const PROVIDER_CACHE_TTL_MS = 5 * 60 * 1000;

const SNOWFLAKE_ALLOWED_JSON_SCHEMA_KEYS = new Set([
  "type",
  "properties",
  "items",
  "required",
  "enum",
  "description",
  "title",
]);

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function readSettingString(
  settings: ProviderSettings | null | undefined,
  key: string,
): string | null {
  const value = settings?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readSettingBoolean(
  settings: ProviderSettings | null | undefined,
  key: string,
): boolean | null {
  const value = settings?.[key];
  return typeof value === "boolean" ? value : null;
}

function sanitizeSnowflakeJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => sanitizeSnowflakeJsonSchema(item));
  }

  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const entries = Object.entries(schema as Record<string, unknown>)
    .filter(([key]) => SNOWFLAKE_ALLOWED_JSON_SCHEMA_KEYS.has(key))
    .map(([key, value]) => {
      if (key === "properties" && value && typeof value === "object") {
        return [
          key,
          Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(
              ([propertyName, propertySchema]) => [
                propertyName,
                sanitizeSnowflakeJsonSchema(propertySchema),
              ],
            ),
          ),
        ] as const;
      }

      if (key === "items") {
        return [key, sanitizeSnowflakeJsonSchema(value)] as const;
      }

      return [key, value] as const;
    });

  return Object.fromEntries(entries);
}

function transformSnowflakeRequestBody(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const responseFormat = args.response_format;
  if (!responseFormat || typeof responseFormat !== "object") {
    return args;
  }

  const typedResponseFormat = responseFormat as Record<string, unknown>;
  if (typedResponseFormat.type !== "json_schema") {
    return args;
  }

  const jsonSchema = typedResponseFormat.json_schema;
  if (!jsonSchema || typeof jsonSchema !== "object") {
    return args;
  }

  const typedJsonSchema = jsonSchema as Record<string, unknown>;

  return {
    ...args,
    response_format: {
      ...typedResponseFormat,
      json_schema: {
        ...Object.fromEntries(
          Object.entries(typedJsonSchema).filter(([key]) => key !== "strict"),
        ),
        schema: sanitizeSnowflakeJsonSchema(typedJsonSchema.schema),
      },
    },
  };
}

/**
 * Creates a LanguageModel instance from a provider name + API model name,
 * using the given API key and base URL.
 */
export function createModelFromConfig(
  providerName: string,
  modelApiName: string,
  apiKey?: string | null,
  baseUrl?: string | null,
  providerSettings?: ProviderSettings | null,
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

      case "azure": {
        const key = apiKey || process.env.AZURE_API_KEY;
        if (!key) return null;

        const configuredBaseUrl =
          readSettingString(providerSettings, "baseURL") ||
          readSettingString(providerSettings, "baseUrl") ||
          (baseUrl && isHttpUrl(baseUrl) ? baseUrl : null);
        const configuredResourceName =
          readSettingString(providerSettings, "resourceName") ||
          readSettingString(providerSettings, "resource") ||
          (baseUrl && !isHttpUrl(baseUrl) ? baseUrl : null) ||
          process.env.AZURE_RESOURCE_NAME ||
          null;
        const configuredApiVersion =
          readSettingString(providerSettings, "apiVersion") || null;
        const useDeploymentBasedUrls = readSettingBoolean(
          providerSettings,
          "useDeploymentBasedUrls",
        );

        const provider = createAzure({
          apiKey: key,
          ...(configuredBaseUrl ? { baseURL: configuredBaseUrl } : {}),
          ...(!configuredBaseUrl && configuredResourceName
            ? { resourceName: configuredResourceName }
            : {}),
          ...(configuredApiVersion ? { apiVersion: configuredApiVersion } : {}),
          ...(useDeploymentBasedUrls !== null
            ? { useDeploymentBasedUrls }
            : {}),
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

      case "cohere": {
        const key = apiKey || process.env.COHERE_API_KEY;
        if (!key) return null;
        const provider = createCohere({ apiKey: key });
        return provider(modelApiName);
      }

      case "snowflake": {
        const key = apiKey || process.env.SNOWFLAKE_API_KEY;
        if (!key) return null;
        const accountId = baseUrl || process.env.SNOWFLAKE_ACCOUNT_ID;
        if (!accountId) return null;
        const snowflakeBaseUrl = `https://${accountId}.snowflakecomputing.com/api/v2/cortex/v1`;
        const provider = createOpenAICompatible({
          name: "snowflake",
          apiKey: key,
          baseURL: snowflakeBaseUrl,
          supportsStructuredOutputs: true,
          transformRequestBody: transformSnowflakeRequestBody,
        });
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

/**
 * Creates a RerankingModel instance from a provider name + model API name.
 * Currently only Cohere is supported.
 */
export function createRerankingModelFromConfig(
  providerName: string,
  modelApiName: string,
  apiKey?: string | null,
): RerankingModel | null {
  try {
    switch (providerName) {
      case "cohere": {
        const key = apiKey || process.env.COHERE_API_KEY;
        if (!key) return null;
        const provider = createCohere({ apiKey: key });
        return provider.reranking(modelApiName);
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Looks up the given provider + model name in the database and returns a
 * RerankingModel instance. Returns null if not found or not configured.
 */
export async function getDbRerankingModel(
  providerName: string,
  modelName: string,
): Promise<RerankingModel | null> {
  try {
    const providerConfig = await serverCache.get<{
      id: string;
      apiKey: string | null;
      baseUrl: string | null;
      settings: ProviderSettings;
      enabled: boolean;
    }>(CacheKeys.providerConfig(providerName));
    const resolvedProviderConfig =
      providerConfig ??
      (await settingsRepository
        .getProviderByName(providerName)
        .then(async (value) => {
          if (value) {
            await serverCache.set(
              CacheKeys.providerConfig(providerName),
              value,
              PROVIDER_CACHE_TTL_MS,
            );
          }
          return value;
        }));
    if (!resolvedProviderConfig || !resolvedProviderConfig.enabled) return null;

    const modelConfig =
      (await serverCache.get<any>(
        CacheKeys.rerankingModelConfig(providerName, modelName),
      )) ??
      (await settingsRepository
        .getRerankingModel(providerName, modelName)
        .then(async (value) => {
          if (value) {
            await serverCache.set(
              CacheKeys.rerankingModelConfig(providerName, modelName),
              value,
              PROVIDER_CACHE_TTL_MS,
            );
          }
          return value;
        }));
    if (!modelConfig) return null;

    return createRerankingModelFromConfig(
      providerName,
      modelConfig.apiName,
      resolvedProviderConfig.apiKey,
    );
  } catch {
    return null;
  }
}

export type DbModelResult = {
  model: LanguageModel;
  contextLength: number;
  inputTokenPricePer1MUsd: number;
  outputTokenPricePer1MUsd: number;
  supportsTools: boolean;
  supportsGeneration: boolean;
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
    const providerConfig =
      (await serverCache.get<{
        id: string;
        apiKey: string | null;
        baseUrl: string | null;
        settings: ProviderSettings;
        enabled: boolean;
      }>(CacheKeys.providerConfig(chatModel.provider))) ??
      (await settingsRepository
        .getProviderByName(chatModel.provider)
        .then(async (value) => {
          if (value) {
            await serverCache.set(
              CacheKeys.providerConfig(chatModel.provider),
              value,
              PROVIDER_CACHE_TTL_MS,
            );
          }
          return value;
        }));
    if (!providerConfig || !providerConfig.enabled) return null;

    const modelConfig =
      (await serverCache.get<any>(
        CacheKeys.providerModelConfig(chatModel.provider, chatModel.model),
      )) ??
      (await settingsRepository
        .getModelForChat(chatModel.provider, chatModel.model)
        .then(async (value) => {
          if (value) {
            await serverCache.set(
              CacheKeys.providerModelConfig(
                chatModel.provider,
                chatModel.model,
              ),
              value,
              PROVIDER_CACHE_TTL_MS,
            );
          }
          return value;
        }));
    if (!modelConfig) return null;

    const model = createModelFromConfig(
      chatModel.provider,
      modelConfig.apiName,
      providerConfig.apiKey,
      providerConfig.baseUrl,
      providerConfig.settings,
    );
    if (!model) return null;

    return {
      model,
      contextLength: modelConfig.contextLength,
      inputTokenPricePer1MUsd: modelConfig.inputTokenPricePer1MUsd,
      outputTokenPricePer1MUsd: modelConfig.outputTokenPricePer1MUsd,
      supportsTools: modelConfig.supportsTools,
      supportsGeneration: modelConfig.supportsGeneration,
      supportsImageInput: modelConfig.supportsImageInput,
      supportsFileInput: modelConfig.supportsFileInput,
    };
  } catch {
    return null;
  }
}
