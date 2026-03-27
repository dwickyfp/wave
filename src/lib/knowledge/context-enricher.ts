/**
 * Contextual enrichment for chunk embeddings.
 *
 * The default path is deterministic and cheap. LLM summaries are only used
 * when explicitly configured and when the chunk structure is weak enough that
 * an extra summary is likely to help retrieval.
 */
import { LanguageModel, generateText } from "ai";
import type { KnowledgeContextMode } from "app-types/knowledge";
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
const CONTEXT_MODEL_KEY = "knowledge-context-model";
const LEGACY_CONTEXT_MODEL_KEY = "contextx-model";

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

type ContextEnrichmentOptions = {
  mode?: KnowledgeContextMode;
  modelConfig?: { provider: string; model: string } | null;
};

async function getContextModel(
  overrideConfig?: { provider: string; model: string } | null,
): Promise<LanguageModel | null> {
  const config =
    overrideConfig ??
    ((await settingsRepository.getSetting(CONTEXT_MODEL_KEY)) as {
      provider: string;
      model: string;
    } | null) ??
    ((await settingsRepository.getSetting(LEGACY_CONTEXT_MODEL_KEY)) as {
      provider: string;
      model: string;
    } | null);

  if (config?.provider && config?.model) {
    try {
      const providerConfig = await settingsRepository.getProviderByName(
        config.provider,
      );
      if (providerConfig?.enabled) {
        const modelConfig = await settingsRepository.getModelForChat(
          config.provider,
          config.model,
        );
        const resolvedModelName = modelConfig?.apiName ?? config.model;
        const model = createModelFromConfig(
          config.provider,
          resolvedModelName,
          providerConfig.apiKey,
          providerConfig.baseUrl,
          providerConfig.settings,
        );
        if (model) return model;
      }
    } catch {
      // Fall through to hardcoded preferences.
    }
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

function formatPageSpan(chunk: TextChunk): string {
  const start = chunk.metadata.pageStart ?? chunk.metadata.pageNumber;
  const end = chunk.metadata.pageEnd ?? chunk.metadata.pageNumber;
  if (!start) return "";
  if (!end || end === start) return `Pages: ${start}.`;
  return `Pages: ${start}-${end}.`;
}

function buildEmbeddingIdentityPrefix(chunk: TextChunk): string {
  const parts = [
    chunk.metadata.canonicalTitle
      ? `Document: ${chunk.metadata.canonicalTitle}.`
      : "",
    chunk.metadata.noteNumber
      ? `Note: ${chunk.metadata.noteSubsection ? `${chunk.metadata.noteNumber}.${chunk.metadata.noteSubsection}` : chunk.metadata.noteNumber}.`
      : "",
    chunk.metadata.noteTitle ? `Note title: ${chunk.metadata.noteTitle}.` : "",
    formatPageSpan(chunk),
  ].filter(Boolean);

  return parts.join(" ").trim();
}

function isWeaklyStructuredChunk(chunk: TextChunk): boolean {
  const metadata = chunk.metadata;
  if (!metadata.headingPath && !metadata.section) return true;
  if (!metadata.chunkType || metadata.chunkType === "other") return true;
  if (metadata.chunkType === "table" || metadata.chunkType === "directive") {
    return true;
  }
  if ((metadata.qualityScore ?? 1) < 0.68) return true;
  return false;
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
${formatPageSpan(chunk) ? `<page_span>${formatPageSpan(chunk)}</page_span>` : ""}

<chunk>
${chunk.content}
</chunk>

Generate a short factual context that explains what this chunk covers and how it fits within the local section. Do not repeat the chunk verbatim. Output only the context.`;

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
  chunk: TextChunk,
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
  const pageSpan = formatPageSpan(chunk);
  if (pageSpan) parts.push(pageSpan);
  if (localContext.parentSummary) {
    parts.push(localContext.parentSummary);
  }

  return parts.join(" ").trim();
}

export async function enrichChunksWithContext(
  chunks: TextChunk[],
  documentTitle: string,
  sections: ChunkSectionContext[],
  options: ContextEnrichmentOptions = {},
): Promise<EnrichedChunk[]> {
  if (chunks.length === 0) return [];

  const mode = options.mode ?? "deterministic";
  const resolveLocalContext = buildSectionContextMap(sections);
  if (mode === "deterministic") {
    return chunks.map((chunk) => {
      const localContext = resolveLocalContext(chunk);
      const context = generateFallbackContext(
        chunk,
        documentTitle,
        localContext,
      );
      return {
        ...chunk,
        contextSummary: context,
        embeddingText: [
          buildEmbeddingIdentityPrefix(chunk),
          context,
          chunk.content,
        ]
          .filter(Boolean)
          .join("\n\n"),
      };
    });
  }

  const model = await getContextModel(options.modelConfig);
  if (!model) {
    return chunks.map((chunk) => {
      const localContext = resolveLocalContext(chunk);
      const context = generateFallbackContext(
        chunk,
        documentTitle,
        localContext,
      );
      return {
        ...chunk,
        contextSummary: context,
        embeddingText: [
          buildEmbeddingIdentityPrefix(chunk),
          context,
          chunk.content,
        ]
          .filter(Boolean)
          .join("\n\n"),
      };
    });
  }

  const chunksNeedingLlm =
    mode === "always-llm" ? chunks : chunks.filter(isWeaklyStructuredChunk);
  const llmContextByChunkIndex = new Map<number, string>();

  if (chunksNeedingLlm.length > 0) {
    const contexts = await processInBatches(
      chunksNeedingLlm,
      CONTEXT_GEN_CONCURRENCY,
      (chunk) =>
        generateChunkContext(
          model,
          chunk,
          documentTitle,
          resolveLocalContext(chunk),
        ),
    );

    chunksNeedingLlm.forEach((chunk, index) => {
      llmContextByChunkIndex.set(chunk.chunkIndex, contexts[index] ?? "");
    });
  }

  return chunks.map((chunk) => {
    const localContext = resolveLocalContext(chunk);
    const llmContext = llmContextByChunkIndex.get(chunk.chunkIndex) ?? "";
    const context =
      llmContext || generateFallbackContext(chunk, documentTitle, localContext);

    return {
      ...chunk,
      contextSummary: context,
      embeddingText: [
        buildEmbeddingIdentityPrefix(chunk),
        context,
        chunk.content,
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  });
}
