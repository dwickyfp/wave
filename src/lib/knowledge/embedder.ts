import { embedMany, embed } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createCohere } from "@ai-sdk/cohere";
import { createOllama } from "ollama-ai-provider-v2";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { settingsRepository } from "lib/db/repository";
import { EmbeddingModel } from "ai";

const EMBEDDING_CACHE_MAX_ENTRIES = 500;
const EMBEDDING_CACHE_TTL_MS = 15 * 60 * 1000;

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

function createEmbeddingModel(
  provider: string,
  modelApiName: string,
  apiKey?: string | null,
  baseUrl?: string | null,
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
        return p.embedding(modelApiName);
      }
      case "cohere": {
        const key = apiKey || process.env.COHERE_API_KEY;
        if (!key) return null;
        const p = createCohere({ apiKey: key });
        return p.textEmbeddingModel(modelApiName);
      }
      case "ollama": {
        const url =
          baseUrl ||
          process.env.OLLAMA_BASE_URL ||
          "http://localhost:11434/api";
        const p = createOllama({ baseURL: url });
        return p.embedding(modelApiName);
      }
      case "openrouter": {
        const key = apiKey || process.env.OPENROUTER_API_KEY;
        if (!key) return null;
        const p = createOpenRouter({ apiKey: key });
        return p.textEmbeddingModel(modelApiName as any);
      }
      default:
        return null;
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

  let processed = text
    // Normalize unicode
    .normalize("NFC")
    // Remove zero-width chars
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
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
  return `${provider}:${modelName}:${text}`;
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
    const { embeddings, usage } = await embedMany({
      model,
      values: batch,
    });
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
  }

  const { embedding, usage } = await embed({ model, value: preprocessed });
  if (options.cache !== false) {
    embeddingCache.set(cacheKey, embedding);
  }
  return {
    embedding,
    usageTokens: Number.isFinite(usage.tokens) ? Number(usage.tokens) : 0,
  };
}
