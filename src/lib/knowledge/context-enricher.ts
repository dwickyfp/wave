/**
 * Contextual Enrichment Module
 *
 * Implements Anthropic's "Contextual Retrieval" technique:
 * For each chunk, an LLM generates a short context summary that explains
 * what the chunk discusses and how it relates to the broader document.
 * This context is stored alongside the chunk and prepended before embedding,
 * producing richer, more self-contained vector representations.
 *
 * Research shows this reduces retrieval failure rate by ~35% and by ~49%
 * when combined with hybrid search (BM25 + vector).
 */
import { LanguageModel, generateText } from "ai";
import { createModelFromConfig } from "lib/ai/provider-factory";
import { settingsRepository } from "lib/db/repository";
import type { TextChunk } from "./chunker";

// ─── Configuration ─────────────────────────────────────────────────────────────

/** Max chars of the full document to include in the prompt */
const DOC_CONTEXT_LIMIT = 3000;

/**
 * Small, fast model for context generation. We prefer a cheap/fast model
 * since this runs per-chunk during ingestion.
 */
const CONTEXT_MODEL_PREFERENCES = [
  { provider: "openai", model: "gpt-4.1-mini" },
  { provider: "google", model: "gemini-2.5-flash-lite" },
  { provider: "anthropic", model: "claude-haiku-4.5" },
  { provider: "openai", model: "gpt-4.1" },
] as const;

/** Concurrency for contextual summary generation */
const CONTEXT_GEN_CONCURRENCY = 5;

// ─── LLM Model Resolution ─────────────────────────────────────────────────────

const CONTEXTX_MODEL_KEY = "contextx-model";

/**
 * Try to resolve the user-configured ContextX model from system settings.
 * Falls back to the hardcoded preference list if no setting is configured.
 */
async function getContextModel(): Promise<LanguageModel | null> {
  // 1. Try the admin-configured ContextX model first
  try {
    const config = await settingsRepository.getSetting(CONTEXTX_MODEL_KEY);
    if (
      config &&
      typeof config === "object" &&
      "provider" in config &&
      "model" in config
    ) {
      const { provider, model: modelName } = config as {
        provider: string;
        model: string;
      };
      const providerConfig =
        await settingsRepository.getProviderByName(provider);
      if (providerConfig?.enabled) {
        const modelConfig = await settingsRepository.getModelForChat(
          provider,
          modelName,
        );
        const resolvedModelName = modelConfig?.apiName ?? modelName;
        const m = createModelFromConfig(
          provider,
          resolvedModelName,
          providerConfig.apiKey,
          providerConfig.baseUrl,
        );
        if (m) {
          if (!modelConfig) {
            console.warn(
              `[ContextX] Context model "${provider}/${modelName}" is not registered; using direct provider fallback`,
            );
          } else {
            console.log(
              `[ContextX] Using configured model: ${provider}/${modelName}`,
            );
          }
          return m;
        }
      }
    }
  } catch {
    // Setting not found or invalid — fall through to preference list
  }

  // 2. Fallback: iterate the hardcoded preference list
  for (const pref of CONTEXT_MODEL_PREFERENCES) {
    try {
      const providerConfig = await settingsRepository.getProviderByName(
        pref.provider,
      );
      if (!providerConfig?.enabled) continue;

      const modelConfig = await settingsRepository.getModelForChat(
        pref.provider,
        pref.model,
      );
      if (!modelConfig) continue;

      const model = createModelFromConfig(
        pref.provider,
        modelConfig.apiName,
        providerConfig.apiKey,
        providerConfig.baseUrl,
      );
      if (model) return model;
    } catch {
      continue;
    }
  }
  return null;
}

// ─── Context Generation ────────────────────────────────────────────────────────

/**
 * Generate a contextual summary for a single chunk.
 * The summary situates the chunk within the broader document context.
 */
async function generateChunkContext(
  model: LanguageModel,
  chunk: TextChunk,
  documentTitle: string,
  documentExcerpt: string,
): Promise<string> {
  const headingContext = chunk.metadata.headingPath
    ? `Section: ${chunk.metadata.headingPath}`
    : chunk.metadata.section
      ? `Section: ${chunk.metadata.section}`
      : "";

  const prompt = `<document_title>${documentTitle}</document_title>

<document_excerpt>
${documentExcerpt}
</document_excerpt>

${headingContext ? `<section_path>${headingContext}</section_path>\n` : ""}
<chunk>
${chunk.content}
</chunk>

Generate a short (1-3 sentences) context that explains what this chunk discusses and how it relates to the document. This context will be prepended to the chunk for better search retrieval. Be specific and factual. Do NOT repeat the chunk content. Only output the context, nothing else.`;

  try {
    const { text } = await generateText({
      model,
      prompt,
      temperature: 0,
    });
    return text.trim();
  } catch (err) {
    console.warn(
      `[ContextX] Failed to generate context for chunk ${chunk.chunkIndex}:`,
      err,
    );
    return "";
  }
}

// ─── Batch Processing ──────────────────────────────────────────────────────────

/**
 * Process chunks in batches with controlled concurrency.
 */
async function processInBatches<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  });

  await Promise.all(workers);
  return results;
}

// ─── Fallback Context (No LLM) ────────────────────────────────────────────────

/**
 * Generate a rule-based context summary when no LLM is available.
 * Uses document title + heading path to create a useful prefix.
 */
function generateFallbackContext(
  chunk: TextChunk,
  documentTitle: string,
): string {
  const parts: string[] = [];

  if (documentTitle) {
    parts.push(`From document: "${documentTitle}".`);
  }

  if (chunk.metadata.headingPath) {
    parts.push(`Section: ${chunk.metadata.headingPath}.`);
  } else if (chunk.metadata.section) {
    parts.push(`Section: ${chunk.metadata.section}.`);
  }

  return parts.join(" ");
}

// ─── Public API ────────────────────────────────────────────────────────────────

export interface EnrichedChunk extends TextChunk {
  contextSummary: string;
  /** The text that should be embedded (context + content) */
  embeddingText: string;
}

/**
 * Enrich chunks with contextual summaries using Anthropic's
 * Contextual Retrieval technique.
 *
 * If an LLM is available, generates per-chunk context summaries.
 * Falls back to rule-based context (document title + heading path)
 * if no LLM is available.
 *
 * @param chunks - Raw text chunks from the chunker
 * @param documentTitle - Title/filename of the source document
 * @param fullMarkdown - Full document markdown (truncated for prompt)
 * @returns Enriched chunks with contextSummary and embeddingText
 */
export async function enrichChunksWithContext(
  chunks: TextChunk[],
  documentTitle: string,
  fullMarkdown: string,
): Promise<EnrichedChunk[]> {
  if (chunks.length === 0) return [];

  // Prepare document excerpt for LLM prompt
  const documentExcerpt =
    fullMarkdown.length > DOC_CONTEXT_LIMIT
      ? fullMarkdown.slice(0, DOC_CONTEXT_LIMIT) + "\n[... document continues]"
      : fullMarkdown;

  // Try to get an LLM for context generation
  const model = await getContextModel();

  if (model) {
    console.log(
      `[ContextX] Generating contextual summaries for ${chunks.length} chunks using LLM`,
    );

    const contexts = await processInBatches(
      chunks,
      CONTEXT_GEN_CONCURRENCY,
      (chunk) =>
        generateChunkContext(model, chunk, documentTitle, documentExcerpt),
    );

    return chunks.map((chunk, i) => {
      const ctx = contexts[i] || generateFallbackContext(chunk, documentTitle);
      return {
        ...chunk,
        contextSummary: ctx,
        embeddingText: ctx ? `${ctx}\n\n${chunk.content}` : chunk.content,
      };
    });
  }

  // Fallback: rule-based context (no LLM available)
  console.log(
    `[ContextX] No LLM available for context generation — using rule-based fallback for ${chunks.length} chunks`,
  );

  return chunks.map((chunk) => {
    const ctx = generateFallbackContext(chunk, documentTitle);
    return {
      ...chunk,
      contextSummary: ctx,
      embeddingText: ctx ? `${ctx}\n\n${chunk.content}` : chunk.content,
    };
  });
}
