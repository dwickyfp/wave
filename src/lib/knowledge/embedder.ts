import { embedMany, embed } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createCohere } from "@ai-sdk/cohere";
import { createOllama } from "ollama-ai-provider-v2";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { settingsRepository } from "lib/db/repository";
import { EmbeddingModel } from "ai";

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

const BATCH_SIZE = 100;

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

  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const { embeddings } = await embedMany({ model, values: batch });
    allEmbeddings.push(...embeddings);
  }

  return allEmbeddings;
}

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
  const { embedding } = await embed({ model, value: text });
  return embedding;
}
