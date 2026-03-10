import { embedMany, embed } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createCohere } from "@ai-sdk/cohere";
import { createOllama } from "ollama-ai-provider-v2";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { settingsRepository } from "lib/db/repository";
import { EmbeddingModel } from "ai";

const embeddingCache = new Map<string, number[]>();

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
  const model = await getEmbeddingModelFromDb(provider, modelName);
  if (!model) {
    throw new Error(
      `Embedding model not available: ${provider}/${modelName}. Check provider configuration.`,
    );
  }

  // Preprocess all texts
  const preprocessed = texts.map(preprocessForEmbedding);
  const allEmbeddings: number[][] = new Array(preprocessed.length);
  const missing: Array<{ index: number; value: string; cacheKey: string }> = [];

  preprocessed.forEach((value, index) => {
    const cacheKey = buildEmbeddingCacheKey(provider, modelName, value);
    const cached = embeddingCache.get(cacheKey);
    if (cached) {
      allEmbeddings[index] = cached;
      return;
    }
    missing.push({ index, value, cacheKey });
  });

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    const { embeddings } = await embedMany({
      model,
      values: batch.map((entry) => entry.value),
    });

    batch.forEach((entry, index) => {
      const embedding = embeddings[index] ?? [];
      embeddingCache.set(entry.cacheKey, embedding);
      allEmbeddings[entry.index] = embedding;
    });
  }

  return allEmbeddings;
}

/**
 * Embed a single text with preprocessing.
 */
export async function embedSingleText(
  text: string,
  provider: string,
  modelName: string,
): Promise<number[]> {
  const model = await getEmbeddingModelFromDb(provider, modelName);
  if (!model) {
    throw new Error(
      `Embedding model not available: ${provider}/${modelName}. Check provider configuration.`,
    );
  }

  const preprocessed = preprocessForEmbedding(text);
  const cacheKey = buildEmbeddingCacheKey(provider, modelName, preprocessed);
  const cached = embeddingCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const { embedding } = await embed({ model, value: preprocessed });
  embeddingCache.set(cacheKey, embedding);
  return embedding;
}
