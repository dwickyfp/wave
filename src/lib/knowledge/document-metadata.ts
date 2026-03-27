/**
 * Utilities for auto-generating and embedding document-level metadata.
 */

import { LanguageModel, generateText } from "ai";
import { createModelFromConfig } from "lib/ai/provider-factory";
import { settingsRepository } from "lib/db/repository";

const METADATA_MODEL_KEY = "knowledge-context-model";
const LEGACY_METADATA_MODEL_KEY = "contextx-model";
const METADATA_MODEL_PREFERENCES = [
  { provider: "openai", model: "gpt-4.1-mini" },
  { provider: "google", model: "gemini-2.5-flash-lite" },
  { provider: "anthropic", model: "claude-haiku-4.5" },
  { provider: "openai", model: "gpt-4.1" },
] as const;
const DOCUMENT_METADATA_SYSTEM_PROMPT = `You generate retrieval-oriented metadata for one document.

Requirements:
- Base the answer on the document content, not on file names unless the same identity is clearly supported by the content
- Be faithful and specific
- For legal and regulatory documents, prefer the official instrument title, issuer, number, year, and subject when present
- For reports, use the actual organization, report type, and period only when they are explicit in the content
- Do not invent missing details
- Keep the title concise but precise
- Keep the description factual, keyword-rich, and useful for retrieval in 1-2 sentences
- Return exactly two lines in plain text:
Title: <title>
Description: <description>`;

type AutoDocumentMetadata = {
  title: string;
  description: string | null;
};

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMetadataControlMarkers(markdown: string): string {
  return markdown
    .replace(/<!--CTX_PAGE:\d+-->/g, "\n")
    .replace(/^CTX_IMAGE_\d+\s*$/gm, "")
    .replace(/^\[image\s+\d+\]\s*$/gim, "")
    .replace(/^(Label|Description|Step)\s*:\s*.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeSentence(text: string, maxChars: number): string {
  const cleaned = stripInlineMarkdown(text);
  if (!cleaned) return "";
  if (cleaned.length <= maxChars) return cleaned;
  const sliced = cleaned.slice(0, maxChars);
  const lastSpace = sliced.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.6 ? sliced.slice(0, lastSpace) : sliced)
    .trim()
    .replace(/[.,;:!?-]+$/g, "");
}

function extractFirstHeading(markdown: string): string | null {
  const lines = markdown.split("\n");
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1?.[1]) return normalizeSentence(h1[1], 140);
  }

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2?.[1]) return normalizeSentence(h2[1], 140);
  }

  return null;
}

function extractHeadings(markdown: string, maxItems = 12): string[] {
  const headings: string[] = [];

  for (const line of markdown.split("\n")) {
    const match = line.match(/^#{1,6}\s+(.+)$/);
    if (!match?.[1]) continue;
    const normalized = normalizeSentence(match[1], 160);
    if (!normalized) continue;
    headings.push(normalized);
    if (headings.length >= maxItems) {
      break;
    }
  }

  return headings;
}

function looksLikeDescriptionParagraph(paragraph: string): boolean {
  const text = paragraph.trim();
  if (!text) return false;
  if (text.length < 40) return false;
  if (text.startsWith("#")) return false;
  if (text.startsWith(">")) return false;
  if (text === "---") return false;
  if (/^[-*+]\s+/.test(text) || /^\d+[.)]\s+/.test(text)) return false;
  if (text.startsWith("|") && text.includes("|")) return false;
  return true;
}

function extractFirstMeaningfulParagraph(markdown: string): string | null {
  const lines = markdown.split("\n");
  const paragraphs: string[] = [];
  let buffer: string[] = [];
  let inCodeFence = false;

  const flush = () => {
    if (buffer.length === 0) return;
    const paragraph = buffer.join(" ").trim();
    if (paragraph) paragraphs.push(paragraph);
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      flush();
      continue;
    }
    if (inCodeFence) continue;

    if (!trimmed) {
      flush();
      continue;
    }

    if (/^#{1,6}\s+/.test(trimmed) || trimmed === "---") {
      flush();
      continue;
    }

    buffer.push(trimmed);
  }
  flush();

  for (const paragraph of paragraphs) {
    if (looksLikeDescriptionParagraph(paragraph)) {
      return normalizeSentence(paragraph, 280);
    }
  }

  return null;
}

function extractMeaningfulParagraphs(markdown: string, maxItems = 6): string[] {
  const lines = markdown.split("\n");
  const paragraphs: string[] = [];
  let buffer: string[] = [];
  let inCodeFence = false;

  const flush = () => {
    if (buffer.length === 0) return;
    const paragraph = buffer.join(" ").trim();
    if (paragraph && looksLikeDescriptionParagraph(paragraph)) {
      paragraphs.push(normalizeSentence(paragraph, 320));
    }
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      flush();
      continue;
    }
    if (inCodeFence) continue;

    if (!trimmed) {
      flush();
      continue;
    }

    if (/^#{1,6}\s+/.test(trimmed) || trimmed === "---") {
      flush();
      continue;
    }

    buffer.push(trimmed);
  }
  flush();

  return paragraphs.filter(Boolean).slice(0, maxItems);
}

function normalizeGeneratedTitle(title: string, fallbackTitle: string): string {
  const cleaned = normalizeSentence(title.replace(/^title\s*:\s*/i, ""), 180)
    .replace(/^['"]+|['"]+$/g, "")
    .trim();
  return cleaned || normalizeSentence(fallbackTitle, 180) || fallbackTitle;
}

function normalizeGeneratedDescription(description: string): string | null {
  const cleaned = normalizeSentence(
    description.replace(/^description\s*:\s*/i, ""),
    420,
  );
  return cleaned || null;
}

function parseGeneratedDocumentMetadata(
  text: string,
  fallback: AutoDocumentMetadata,
): AutoDocumentMetadata {
  const cleaned = text.trim();
  if (!cleaned) return fallback;

  const titleMatch = cleaned.match(/^title\s*:\s*(.+)$/im);
  const descriptionMatch = cleaned.match(/^description\s*:\s*([\s\S]+)$/im);
  const title = normalizeGeneratedTitle(
    titleMatch?.[1] ?? cleaned.split("\n")[0] ?? fallback.title,
    fallback.title,
  );
  const description = normalizeGeneratedDescription(
    descriptionMatch?.[1] ?? cleaned.split("\n").slice(1).join(" "),
  );

  return {
    title,
    description: description ?? fallback.description,
  };
}

function buildDocumentMetadataPrompt(input: {
  markdown: string;
  fallbackTitle: string;
  originalFilename?: string | null;
  sourceUrl?: string | null;
  pageCount?: number | null;
}): string {
  const cleanedMarkdown = stripMetadataControlMarkers(input.markdown);
  const headings = extractHeadings(cleanedMarkdown);
  const paragraphs = extractMeaningfulParagraphs(cleanedMarkdown);
  const excerpt = cleanedMarkdown.slice(0, 10_000).trim();

  return [
    `Fallback title: ${input.fallbackTitle}`,
    input.originalFilename
      ? `Original filename: ${input.originalFilename}`
      : "",
    input.sourceUrl ? `Source URL: ${input.sourceUrl}` : "",
    input.pageCount ? `Page count: ${input.pageCount}` : "",
    headings.length > 0 ? `Detected headings:\n- ${headings.join("\n- ")}` : "",
    paragraphs.length > 0
      ? `Key paragraphs:\n- ${paragraphs.join("\n- ")}`
      : "",
    "Document excerpt:",
    `<document_excerpt>\n${excerpt}\n</document_excerpt>`,
    "Generate the best retrieval title and description for this document.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function getDocumentMetadataModel(
  overrideConfig?: { provider: string; model: string } | null,
): Promise<LanguageModel | null> {
  const config =
    overrideConfig ??
    ((await settingsRepository.getSetting(METADATA_MODEL_KEY)) as {
      provider: string;
      model: string;
    } | null) ??
    ((await settingsRepository.getSetting(LEGACY_METADATA_MODEL_KEY)) as {
      provider: string;
      model: string;
    } | null);

  const resolveConfiguredModel = async (
    provider: string,
    modelName: string,
  ) => {
    const providerConfig = await settingsRepository.getProviderByName(provider);
    if (!providerConfig?.enabled) return null;
    const modelConfig = await settingsRepository.getModelForChat(
      provider,
      modelName,
    );
    const resolvedModelName = modelConfig?.apiName ?? modelName;
    return createModelFromConfig(
      provider,
      resolvedModelName,
      providerConfig.apiKey,
      providerConfig.baseUrl,
      providerConfig.settings,
    );
  };

  if (config?.provider && config?.model) {
    try {
      const model = await resolveConfiguredModel(config.provider, config.model);
      if (model) return model;
    } catch {
      // Fall through to hardcoded preferences.
    }
  }

  for (const preference of METADATA_MODEL_PREFERENCES) {
    try {
      const model = await resolveConfiguredModel(
        preference.provider,
        preference.model,
      );
      if (model) return model;
    } catch {
      continue;
    }
  }

  return null;
}

export function extractAutoDocumentMetadata(
  markdown: string,
  fallbackTitle: string,
): { title: string; description: string | null } {
  const cleanedMarkdown = stripMetadataControlMarkers(markdown);
  const title =
    extractFirstHeading(cleanedMarkdown) ||
    normalizeSentence(fallbackTitle, 140);
  const description = extractFirstMeaningfulParagraph(cleanedMarkdown);

  return {
    title: title || fallbackTitle,
    description: description || null,
  };
}

export async function generateDocumentMetadata(input: {
  markdown: string;
  fallbackTitle: string;
  originalFilename?: string | null;
  sourceUrl?: string | null;
  pageCount?: number | null;
  modelConfig?: { provider: string; model: string } | null;
}): Promise<AutoDocumentMetadata> {
  const fallback = extractAutoDocumentMetadata(
    input.markdown,
    input.fallbackTitle,
  );
  const model = await getDocumentMetadataModel(input.modelConfig);
  if (!model) return fallback;

  try {
    const { text } = await generateText({
      model,
      system: DOCUMENT_METADATA_SYSTEM_PROMPT,
      prompt: buildDocumentMetadataPrompt(input),
      temperature: 0,
    });
    return parseGeneratedDocumentMetadata(text, fallback);
  } catch (error) {
    console.warn(
      `[ContextX] Failed to generate document metadata for \"${input.fallbackTitle}\":`,
      error,
    );
    return fallback;
  }
}

export function buildDocumentCanonicalTitle(input: {
  markdown: string;
  fallbackTitle: string;
}): string {
  return extractFirstHeading(input.markdown) || input.fallbackTitle;
}

export function buildDocumentMetadataEmbeddingText(input: {
  title: string;
  description?: string | null;
  originalFilename?: string | null;
  sourceUrl?: string | null;
}): string {
  return [
    `title: ${input.title}`,
    input.description ? `description: ${input.description}` : "",
    input.originalFilename ? `filename: ${input.originalFilename}` : "",
    input.sourceUrl ? `source: ${input.sourceUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}
