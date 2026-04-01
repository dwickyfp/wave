import { createHash } from "node:crypto";
import { embedMany, embed } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAzure } from "@ai-sdk/azure";
import { createCohere } from "@ai-sdk/cohere";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOllama } from "ollama-ai-provider-v2";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { CacheKeys } from "lib/cache/cache-keys";
import { serverCache } from "lib/cache";
import { settingsRepository } from "lib/db/repository";
import { normalizeWhitespaceArtifacts } from "./text-cleaning";
import { EmbeddingModel } from "ai";
import type { ProviderSettings } from "app-types/settings";

const EMBEDDING_CACHE_MAX_ENTRIES = 500;
const EMBEDDING_CACHE_TTL_MS = 15 * 60 * 1000;
const EMBEDDING_CACHE_TTL_SERVER_MS = 15 * 60 * 1000;
const DEFAULT_EMBEDDING_RETRY_ATTEMPTS = 6;
const DEFAULT_EMBEDDING_RETRY_BASE_DELAY_MS = 5_000;
const DEFAULT_EMBEDDING_MAX_CONCURRENCY = 1;

class AsyncSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
      return () => this.release();
    }

    await new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });

    return () => this.release();
  }

  private release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    next?.();
  }
}

class EmbeddingLruCache {
  private readonly entries = new Map<
    string,
    { embedding: number[]; expiresAt: number }
  >();

  get(key: string): number[] | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.embedding;
  }

  set(key: string, embedding: number[]) {
    this.entries.delete(key);
    this.entries.set(key, {
      embedding,
      expiresAt: Date.now() + EMBEDDING_CACHE_TTL_MS,
    });

    while (this.entries.size > EMBEDDING_CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }
}

const embeddingCache = new EmbeddingLruCache();
const embeddingSemaphores = new Map<string, AsyncSemaphore>();

type EmbeddingBatchResult = {
  embeddings: number[][];
  usageTokens: number;
};

type EmbeddingSingleResult = {
  embedding: number[];
  usageTokens: number;
};

type SingleEmbeddingOptions = {
  cache?: boolean;
};

// ─── Model Creation ────────────────────────────────────────────────────────────

function readSetting(
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

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getEmbeddingRetryAttempts(): number {
  return readPositiveIntEnv(
    "KNOWLEDGE_EMBEDDING_RETRY_ATTEMPTS",
    DEFAULT_EMBEDDING_RETRY_ATTEMPTS,
  );
}

function getEmbeddingRetryBaseDelayMs(): number {
  const raw = process.env.KNOWLEDGE_EMBEDDING_RETRY_BASE_DELAY_MS;
  if (!raw) return DEFAULT_EMBEDDING_RETRY_BASE_DELAY_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_EMBEDDING_RETRY_BASE_DELAY_MS;
}

function getEmbeddingMaxConcurrency(): number {
  return readPositiveIntEnv(
    "KNOWLEDGE_EMBEDDING_MAX_CONCURRENCY",
    DEFAULT_EMBEDDING_MAX_CONCURRENCY,
  );
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEmbeddingSemaphore(key: string): AsyncSemaphore {
  const existing = embeddingSemaphores.get(key);
  if (existing) return existing;
  const created = new AsyncSemaphore(getEmbeddingMaxConcurrency());
  embeddingSemaphores.set(key, created);
  return created;
}

function buildEmbeddingThrottleKey(
  provider: string,
  modelName: string,
): string {
  return `${provider}:${modelName}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function parseRetryDelayMs(error: unknown, attempt: number): number {
  const anyError = error as any;
  const retryAfterHeader =
    anyError?.responseHeaders?.["retry-after"] ??
    anyError?.responseHeaders?.["Retry-After"] ??
    anyError?.headers?.["retry-after"] ??
    anyError?.headers?.["Retry-After"];

  if (typeof retryAfterHeader === "string") {
    const retryAfterSeconds = Number.parseInt(retryAfterHeader, 10);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
      return retryAfterSeconds * 1000;
    }
  }

  const message = getErrorMessage(error);
  const secondsMatch = message.match(/retry after\s+(\d+)\s*seconds?/i);
  if (secondsMatch) {
    const seconds = Number.parseInt(secondsMatch[1], 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }

  const millisecondsMatch = message.match(/retry after\s+(\d+)\s*ms/i);
  if (millisecondsMatch) {
    const milliseconds = Number.parseInt(millisecondsMatch[1], 10);
    if (Number.isFinite(milliseconds) && milliseconds >= 0) {
      return milliseconds;
    }
  }

  const baseDelay = getEmbeddingRetryBaseDelayMs();
  return baseDelay * 2 ** Math.max(0, attempt - 1);
}

function isRetriableEmbeddingError(error: unknown): boolean {
  const anyError = error as any;
  const message = getErrorMessage(error).toLowerCase();
  const statusCode = Number(
    anyError?.statusCode ??
      anyError?.response?.status ??
      anyError?.cause?.statusCode ??
      NaN,
  );

  return (
    statusCode === 408 ||
    statusCode === 409 ||
    statusCode === 423 ||
    statusCode === 429 ||
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504 ||
    message.includes("ratelimitreached") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("retry after") ||
    message.includes("no successful provider responses") ||
    message.includes("socket hang up") ||
    message.includes("econnreset") ||
    message.includes("bad gateway") ||
    message.includes("gateway timeout") ||
    message.includes("internal server error") ||
    message.includes("service unavailable") ||
    message.includes("temporarily unavailable") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("503")
  );
}

async function runEmbeddingCallWithRetry<T>(
  provider: string,
  modelName: string,
  operation: () => Promise<T>,
): Promise<T> {
  const maxAttempts = getEmbeddingRetryAttempts();
  let attempt = 0;

  while (true) {
    attempt += 1;
    const release = await getEmbeddingSemaphore(
      buildEmbeddingThrottleKey(provider, modelName),
    ).acquire();
    let released = false;

    const safeRelease = () => {
      if (released) return;
      released = true;
      release();
    };

    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetriableEmbeddingError(error)) {
        throw error;
      }

      const delayMs = parseRetryDelayMs(error, attempt);
      console.warn(
        `[ContextX] Embedding request failed for ${provider}/${modelName}; retrying in ${Math.ceil(delayMs / 1000)}s (attempt ${attempt}/${maxAttempts})`,
      );
      safeRelease();
      await sleep(delayMs);
      continue;
    } finally {
      safeRelease();
    }
  }
}

function createEmbeddingModel(
  provider: string,
  modelApiName: string,
  apiKey?: string | null,
  baseUrl?: string | null,
  settings?: ProviderSettings | null,
): EmbeddingModel | null {
  try {
    switch (provider) {
      case "openai": {
        const key = apiKey || process.env.OPENAI_API_KEY;
        if (!key) return null;
        const p = createOpenAI({
          apiKey: key,
          ...(baseUrl ? { baseURL: baseUrl } : {}),
        });
        return p.textEmbeddingModel(modelApiName);
      }
      case "cohere": {
        const key = apiKey || process.env.COHERE_API_KEY;
        if (!key) return null;
        const p = createCohere({ apiKey: key });
        return p.textEmbeddingModel(modelApiName);
      }
      case "google": {
        const key = apiKey || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!key) return null;
        const p = createGoogleGenerativeAI({ apiKey: key });
        return p.textEmbeddingModel(modelApiName as any);
      }
      case "ollama": {
        const url =
          baseUrl ||
          process.env.OLLAMA_BASE_URL ||
          "http://localhost:11434/api";
        const p = createOllama({ baseURL: url });
        return p.textEmbeddingModel(modelApiName);
      }
      case "openrouter": {
        const key = apiKey || process.env.OPENROUTER_API_KEY;
        if (!key) return null;
        const p = createOpenRouter({ apiKey: key });
        return p.textEmbeddingModel(modelApiName as any);
      }
      case "azure": {
        const key = apiKey || process.env.AZURE_API_KEY;
        if (!key) return null;
        const isHttpUrl = baseUrl ? /^https?:\/\//i.test(baseUrl) : false;
        const configuredBaseUrl =
          readSetting(settings, "baseURL") ||
          readSetting(settings, "baseUrl") ||
          (isHttpUrl ? baseUrl : null);
        const configuredResourceName =
          readSetting(settings, "resourceName") ||
          readSetting(settings, "resource") ||
          (!isHttpUrl && baseUrl ? baseUrl : null) ||
          process.env.AZURE_RESOURCE_NAME ||
          null;
        const configuredApiVersion =
          readSetting(settings, "apiVersion") || null;
        const useDeploymentBasedUrls = readSettingBoolean(
          settings,
          "useDeploymentBasedUrls",
        );
        const p = createAzure({
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
        return p.textEmbeddingModel(modelApiName);
      }
      case "snowflake": {
        const key = apiKey || process.env.SNOWFLAKE_API_KEY;
        if (!key) return null;
        const accountId = baseUrl || process.env.SNOWFLAKE_ACCOUNT_ID;
        if (!accountId) return null;
        const p = createOpenAICompatible({
          name: "snowflake",
          apiKey: key,
          baseURL: `https://${accountId}.snowflakecomputing.com/api/v2/cortex/v1`,
        });
        return p.textEmbeddingModel(modelApiName as any);
      }
      case "openai-compatible": {
        if (!baseUrl) return null;
        const key = apiKey || "";
        const p = createOpenAICompatible({
          name: provider,
          apiKey: key,
          baseURL: baseUrl,
        });
        return p.textEmbeddingModel(modelApiName as any);
      }
      default:
        if (!baseUrl || !isHttpUrl(baseUrl)) return null;
        return createOpenAICompatible({
          name: provider,
          apiKey: apiKey || "",
          baseURL: baseUrl,
        }).textEmbeddingModel(modelApiName as any);
    }
  } catch {
    return null;
  }
}

async function getEmbeddingModelFromDb(
  providerName: string,
  modelName: string,
): Promise<EmbeddingModel | null> {
  try {
    const providerConfig =
      await settingsRepository.getProviderByName(providerName);
    if (!providerConfig || !providerConfig.enabled) return null;
    return createEmbeddingModel(
      providerName,
      modelName,
      providerConfig.apiKey,
      providerConfig.baseUrl,
      providerConfig.settings,
    );
  } catch {
    return null;
  }
}

// ─── Text Preprocessing ────────────────────────────────────────────────────────

/**
 * Preprocess text before embedding to improve vector quality:
 * - Normalize unicode (NFC)
 * - Collapse excessive whitespace
 * - Remove markdown formatting noise that doesn't add semantic value
 * - Truncate to stay within typical embedding model token limits (~8K tokens)
 */
function preprocessForEmbedding(text: string): string {
  const MAX_EMBEDDING_CHARS = 30_000; // ~8K tokens safety limit

  let processed = normalizeWhitespaceArtifacts(text)
    // Collapse excessive whitespace
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    // Remove excessive markdown formatting (images, raw HTML tags)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1") // ![alt](url) → alt
    .replace(/<[^>]+>/g, " ") // strip HTML tags
    .trim();

  // Truncate if text exceeds embedding model limits
  if (processed.length > MAX_EMBEDDING_CHARS) {
    processed = processed.slice(0, MAX_EMBEDDING_CHARS);
    // Try to cut at a word boundary
    const lastSpace = processed.lastIndexOf(" ");
    if (lastSpace > MAX_EMBEDDING_CHARS * 0.9) {
      processed = processed.slice(0, lastSpace);
    }
  }

  return processed;
}

// ─── Public API ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 100;

function buildEmbeddingCacheKey(
  provider: string,
  modelName: string,
  text: string,
) {
  const hash = createHash("sha256").update(text).digest("hex");
  return CacheKeys.embedding(provider, modelName, hash);
}

/**
 * Embed multiple texts with preprocessing.
 * Texts are normalized and cleaned before being sent to the embedding model.
 */
export async function embedTexts(
  texts: string[],
  provider: string,
  modelName: string,
): Promise<number[][]> {
  const { embeddings } = await embedTextsWithUsage(texts, provider, modelName);
  return embeddings;
}

export async function embedTextsWithUsage(
  texts: string[],
  provider: string,
  modelName: string,
): Promise<EmbeddingBatchResult> {
  const model = await getEmbeddingModelFromDb(provider, modelName);
  if (!model) {
    throw new Error(
      `Embedding model not available: ${provider}/${modelName}. Check provider configuration.`,
    );
  }

  // Preprocess all texts
  const preprocessed = texts.map(preprocessForEmbedding);
  let usageTokens = 0;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < preprocessed.length; i += BATCH_SIZE) {
    const batch = preprocessed.slice(i, i + BATCH_SIZE);
    const { embeddings, usage } = await runEmbeddingCallWithRetry(
      provider,
      modelName,
      () =>
        embedMany({
          model,
          values: batch,
        }),
    );
    if (Number.isFinite(usage.tokens)) {
      usageTokens += Number(usage.tokens);
    }

    allEmbeddings.push(...embeddings.map((embedding) => embedding ?? []));
  }

  return {
    embeddings: allEmbeddings,
    usageTokens,
  };
}

/**
 * Embed a single text with preprocessing.
 */
export async function embedSingleText(
  text: string,
  provider: string,
  modelName: string,
  options: SingleEmbeddingOptions = {},
): Promise<number[]> {
  const { embedding } = await embedSingleTextWithUsage(
    text,
    provider,
    modelName,
    options,
  );
  return embedding;
}

export async function embedSingleTextWithUsage(
  text: string,
  provider: string,
  modelName: string,
  options: SingleEmbeddingOptions = {},
): Promise<EmbeddingSingleResult> {
  const model = await getEmbeddingModelFromDb(provider, modelName);
  if (!model) {
    throw new Error(
      `Embedding model not available: ${provider}/${modelName}. Check provider configuration.`,
    );
  }

  const preprocessed = preprocessForEmbedding(text);
  const cacheKey = buildEmbeddingCacheKey(provider, modelName, preprocessed);
  if (options.cache !== false) {
    const cached = embeddingCache.get(cacheKey);
    if (cached) {
      return {
        embedding: cached,
        usageTokens: 0,
      };
    }

    const sharedCached = await serverCache.get<number[]>(cacheKey);
    if (sharedCached) {
      embeddingCache.set(cacheKey, sharedCached);
      return {
        embedding: sharedCached,
        usageTokens: 0,
      };
    }
  }

  const { embedding, usage } = await runEmbeddingCallWithRetry(
    provider,
    modelName,
    () => embed({ model, value: preprocessed }),
  );
  if (options.cache !== false) {
    embeddingCache.set(cacheKey, embedding);
    await serverCache.set(cacheKey, embedding, EMBEDDING_CACHE_TTL_SERVER_MS);
  }
  return {
    embedding,
    usageTokens: Number.isFinite(usage.tokens) ? Number(usage.tokens) : 0,
  };
}
