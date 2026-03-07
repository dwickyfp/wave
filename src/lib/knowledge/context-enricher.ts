/**
 * Contextual enrichment for chunk embeddings.
 *
 * Uses local section context instead of the document opening so late-page
 * chunks stay grounded in the section they came from.
 */
import { LanguageModel, generateText } from "ai";
import { createModelFromConfig } from "lib/ai/provider-factory";
import { settingsRepository } from "lib/db/repository";
import type { TextChunk } from "./chunker";

const SECTION_EXCERPT_LIMIT = 800;

const CONTEXT_MODEL_PREFERENCES = [
  { provider: "openai", model: "gpt-4.1-mini" },
  { provider: "google", model: "gemini-2.5-flash-lite" },
  { provider: "anthropic", model: "claude-haiku-4.5" },
  { provider: "openai", model: "gpt-4.1" },
] as const;

const CONTEXT_GEN_CONCURRENCY = 5;
const CONTEXTX_MODEL_KEY = "contextx-model";

export interface EnrichedChunk extends TextChunk {
  contextSummary: string;
  embeddingText: string;
}

export interface ChunkSectionContext {
  id: string;
  headingPath: string;
  content: string;
  summary: string;
  parentSectionId?: string | null;
}

async function getContextModel(): Promise<LanguageModel | null> {
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
        const model = createModelFromConfig(
          provider,
          resolvedModelName,
          providerConfig.apiKey,
          providerConfig.baseUrl,
          providerConfig.settings,
        );
        if (model) return model;
      }
    }
  } catch {
    // Fall through to hardcoded preferences.
  }

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
        providerConfig.settings,
      );
      if (model) return model;
    } catch {
      continue;
    }
  }

  return null;
}

function buildSectionContextMap(sections: ChunkSectionContext[]) {
  const map = new Map(sections.map((section) => [section.id, section]));

  return (chunk: TextChunk) => {
    const section = chunk.sectionId ? map.get(chunk.sectionId) : undefined;
    const parent = section?.parentSectionId
      ? map.get(section.parentSectionId)
      : undefined;

    return {
      section,
      parentSummary: parent?.summary ?? "",
      sectionPath:
        section?.headingPath ??
        chunk.metadata.headingPath ??
        chunk.metadata.section ??
        "",
      sectionExcerpt: section?.content.slice(0, SECTION_EXCERPT_LIMIT) ?? "",
    };
  };
}

async function generateChunkContext(
  model: LanguageModel,
  chunk: TextChunk,
  documentTitle: string,
  localContext: {
    sectionPath: string;
    parentSummary: string;
    sectionExcerpt: string;
  },
): Promise<string> {
  const prompt = `<document_title>${documentTitle}</document_title>

${localContext.sectionPath ? `<section_path>${localContext.sectionPath}</section_path>` : ""}
${localContext.parentSummary ? `<parent_section_summary>${localContext.parentSummary}</parent_section_summary>` : ""}
${localContext.sectionExcerpt ? `<section_excerpt>\n${localContext.sectionExcerpt}\n</section_excerpt>` : ""}

<chunk>
${chunk.content}
</chunk>

Generate a short (1-3 sentences) factual context that explains what this chunk covers and how it fits within the section. Do not repeat the chunk verbatim. Output only the context.`;

  try {
    const { text } = await generateText({
      model,
      prompt,
      temperature: 0,
    });
    return text.trim();
  } catch (error) {
    console.warn(
      `[ContextX] Failed to generate section context for chunk ${chunk.chunkIndex}:`,
      error,
    );
    return "";
  }
}

async function processInBatches<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current]);
    }
  });

  await Promise.all(workers);
  return results;
}

function generateFallbackContext(
  documentTitle: string,
  localContext: {
    sectionPath: string;
    parentSummary: string;
  },
): string {
  const parts: string[] = [];

  if (documentTitle) parts.push(`From document: "${documentTitle}".`);
  if (localContext.sectionPath) {
    parts.push(`Section: ${localContext.sectionPath}.`);
  }
  if (localContext.parentSummary) {
    parts.push(localContext.parentSummary);
  }

  return parts.join(" ").trim();
}

export async function enrichChunksWithContext(
  chunks: TextChunk[],
  documentTitle: string,
  sections: ChunkSectionContext[],
): Promise<EnrichedChunk[]> {
  if (chunks.length === 0) return [];

  const resolveLocalContext = buildSectionContextMap(sections);
  const model = await getContextModel();

  if (model) {
    console.log(
      `[ContextX] Generating contextual summaries for ${chunks.length} chunks using section-local context`,
    );

    const contexts = await processInBatches(
      chunks,
      CONTEXT_GEN_CONCURRENCY,
      (chunk) =>
        generateChunkContext(
          model,
          chunk,
          documentTitle,
          resolveLocalContext(chunk),
        ),
    );

    return chunks.map((chunk, index) => {
      const localContext = resolveLocalContext(chunk);
      const context =
        contexts[index] || generateFallbackContext(documentTitle, localContext);

      return {
        ...chunk,
        contextSummary: context,
        embeddingText: context
          ? `${context}\n\n${chunk.content}`
          : chunk.content,
      };
    });
  }

  console.log(
    `[ContextX] No LLM available for context generation - using section-local fallback for ${chunks.length} chunks`,
  );

  return chunks.map((chunk) => {
    const localContext = resolveLocalContext(chunk);
    const context = generateFallbackContext(documentTitle, localContext);
    return {
      ...chunk,
      contextSummary: context,
      embeddingText: context ? `${context}\n\n${chunk.content}` : chunk.content,
    };
  });
}
