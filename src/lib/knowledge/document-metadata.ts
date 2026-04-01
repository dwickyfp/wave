/**
 * Utilities for auto-generating and embedding document-level metadata.
 */

import { LanguageModel, generateText } from "ai";
import type {
  KnowledgeDisplayContext,
  KnowledgeRetrievalAxis,
  KnowledgeTemporalHints,
} from "app-types/knowledge";
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

function normalizeKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripFileDecoration(value: string): string {
  const basename = value
    .trim()
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\.[a-z0-9]{1,8}$/i, "");
  return basename ?? value.trim();
}

function normalizeMonthName(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  const monthMap: Record<string, string> = {
    jan: "January",
    january: "January",
    feb: "February",
    february: "February",
    mar: "March",
    march: "March",
    apr: "April",
    april: "April",
    may: "May",
    jun: "June",
    june: "June",
    jul: "July",
    july: "July",
    aug: "August",
    august: "August",
    sep: "September",
    sept: "September",
    september: "September",
    oct: "October",
    october: "October",
    nov: "November",
    november: "November",
    dec: "December",
    december: "December",
  };
  return monthMap[normalized] ?? null;
}

function monthToNumber(value: string): string | null {
  const month = normalizeMonthName(value);
  if (!month) return null;
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const index = months.indexOf(month);
  return index >= 0 ? String(index + 1).padStart(2, "0") : null;
}

function formatIsoDateLabel(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const monthIndex = Number.parseInt(match[2] ?? "0", 10) - 1;
  const month = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ][monthIndex];
  if (!month) return value;
  return `${Number.parseInt(match[3] ?? "0", 10)} ${month} ${match[1]}`;
}

function dedupeAxes(axes: KnowledgeRetrievalAxis[]): KnowledgeRetrievalAxis[] {
  const seen = new Set<string>();
  return axes.filter((axis) => {
    const key = `${axis.kind}:${axis.key}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractQuarterAxes(text: string): KnowledgeRetrievalAxis[] {
  const axes: KnowledgeRetrievalAxis[] = [];

  for (const match of text.matchAll(
    /\b(?:q([1-4])|quarter\s*([1-4]))(?:\s*[-/ ]?\s*(20\d{2}))?\b/gi,
  )) {
    const quarter = match[1] ?? match[2];
    if (!quarter) continue;
    const year = match[3]?.trim() ?? null;
    const label = year ? `Q${quarter} ${year}` : `Q${quarter}`;
    axes.push({
      kind: "period",
      key: normalizeKey(label),
      label,
      value: label,
      confidence: year ? 0.95 : 0.75,
    });
  }

  return axes;
}

function extractVersionAxes(text: string): KnowledgeRetrievalAxis[] {
  const axes: KnowledgeRetrievalAxis[] = [];

  for (const match of text.matchAll(
    /(?:^|[\s_(/-])(v(?:ersion\s*)?\d+(?:\.\d+)*)(?=$|[\s)_/-])/gi,
  )) {
    const raw = match[1]?.replace(/\s+/g, "") ?? "";
    if (!raw) continue;
    const label = raw.toLowerCase().startsWith("version")
      ? raw.replace(/^version/i, "v")
      : raw;
    axes.push({
      kind: "version",
      key: normalizeKey(label),
      label,
      value: label,
      confidence: 0.92,
    });
  }

  return axes;
}

function extractDateAxes(text: string): KnowledgeRetrievalAxis[] {
  const axes: KnowledgeRetrievalAxis[] = [];

  for (const match of text.matchAll(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/g)) {
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    axes.push({
      kind: "effective_at",
      key: iso,
      label: formatIsoDateLabel(iso),
      value: iso,
      confidence: 0.96,
    });
  }

  for (const match of text.matchAll(
    /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/gi,
  )) {
    const day = String(Number.parseInt(match[1] ?? "0", 10));
    const month = normalizeMonthName(match[2] ?? "");
    const monthNumber = monthToNumber(match[2] ?? "");
    const year = match[3] ?? "";
    if (!month || !monthNumber || !year) continue;
    axes.push({
      kind: "effective_at",
      key: `${year}-${monthNumber}-${String(Number.parseInt(day, 10)).padStart(2, "0")}`,
      label: `${day} ${month} ${year}`,
      value: `${year}-${monthNumber}-${String(Number.parseInt(day, 10)).padStart(2, "0")}`,
      confidence: 0.98,
    });
  }

  for (const match of text.matchAll(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})\b/gi,
  )) {
    const month = normalizeMonthName(match[1] ?? "");
    const monthNumber = monthToNumber(match[1] ?? "");
    const day = String(Number.parseInt(match[2] ?? "0", 10));
    const year = match[3] ?? "";
    if (!month || !monthNumber || !year) continue;
    axes.push({
      kind: "effective_at",
      key: `${year}-${monthNumber}-${String(Number.parseInt(day, 10)).padStart(2, "0")}`,
      label: `${day} ${month} ${year}`,
      value: `${year}-${monthNumber}-${String(Number.parseInt(day, 10)).padStart(2, "0")}`,
      confidence: 0.98,
    });
  }

  return axes;
}

function quarterAxisToPeriodEnd(axis: KnowledgeRetrievalAxis): string | null {
  const match = axis.label.match(/^Q([1-4])(?:\s+(20\d{2}))?$/i);
  if (!match?.[1] || !match[2]) return null;
  const year = match[2];
  switch (match[1]) {
    case "1":
      return `${year}-03-31`;
    case "2":
      return `${year}-06-30`;
    case "3":
      return `${year}-09-30`;
    case "4":
      return `${year}-12-31`;
    default:
      return null;
  }
}

export function extractKnowledgeComparisonAxesFromText(input: {
  text?: string | null;
  libraryVersion?: string | null;
  temporalHints?: KnowledgeTemporalHints | null;
  language?: string | null;
}): KnowledgeRetrievalAxis[] {
  const combined = [
    input.libraryVersion,
    input.temporalHints?.effectiveAt,
    input.text,
  ]
    .filter(Boolean)
    .join("\n");
  if (!combined.trim()) return [];

  const axes: KnowledgeRetrievalAxis[] = [];
  if (input.libraryVersion?.trim()) {
    axes.push({
      kind: "version",
      key: normalizeKey(input.libraryVersion),
      label: input.libraryVersion.trim(),
      value: input.libraryVersion.trim(),
      confidence: 1,
    });
  }
  if (input.temporalHints?.effectiveAt?.trim()) {
    const effectiveAt = input.temporalHints.effectiveAt.trim();
    axes.push({
      kind: "effective_at",
      key: normalizeKey(effectiveAt),
      label: formatIsoDateLabel(effectiveAt),
      value: effectiveAt,
      confidence: 1,
    });
  }

  axes.push(...extractQuarterAxes(combined));
  axes.push(...extractVersionAxes(combined));
  axes.push(...extractDateAxes(combined));

  if (input.language?.trim()) {
    axes.push({
      kind: "language",
      key: normalizeKey(input.language),
      label: input.language.trim(),
      value: input.language.trim(),
      confidence: 0.7,
    });
  }

  return dedupeAxes(axes);
}

export function buildKnowledgeBaseTitle(value: string): string {
  const cleaned = stripFileDecoration(value)
    .replace(
      /\b(?:q[1-4]|quarter\s*[1-4]|fy|h[12])(?:\s*[-/ ]?\s*(19|20)\d{2})?\b/gi,
      " ",
    )
    .replace(/\bv(?:ersion\s*)?\d+(?:\.\d+)*\b/gi, " ")
    .replace(
      /\beffective(?:\s+(?:from|at|on))?\s+(?:\d{1,2}\s+[a-z]+(?:\s+\d{4})?|[a-z]+\s+\d{1,2},?\s+\d{4}|20\d{2}[-/]\d{2}[-/]\d{2})\b/gi,
      " ",
    )
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/[()_[\]-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || stripFileDecoration(value);
}

export function deriveKnowledgeTemporalHints(input: {
  title?: string | null;
  originalFilename?: string | null;
  sourceUrl?: string | null;
  content?: string | null;
}): KnowledgeTemporalHints | null {
  const axes = extractKnowledgeComparisonAxesFromText({
    text: [input.title, input.originalFilename, input.sourceUrl, input.content]
      .filter(Boolean)
      .join("\n"),
  });

  const effectiveAxis = axes.find((axis) => axis.kind === "effective_at");
  if (effectiveAxis) {
    return {
      effectiveAt: effectiveAxis.value ?? effectiveAxis.label,
      expiresAt: null,
      freshnessLabel: null,
    };
  }

  const periodAxis = axes.find((axis) => axis.kind === "period");
  const periodEnd = periodAxis ? quarterAxisToPeriodEnd(periodAxis) : null;
  if (!periodEnd) return null;

  return {
    effectiveAt: periodEnd,
    expiresAt: null,
    freshnessLabel: null,
  };
}

export function buildKnowledgeVariantLabel(input: {
  title?: string | null;
  originalFilename?: string | null;
  sourceUrl?: string | null;
  libraryVersion?: string | null;
  temporalHints?: KnowledgeTemporalHints | null;
  fallback?: string | null;
}): string | null {
  if (input.libraryVersion?.trim()) {
    return input.libraryVersion.trim();
  }
  if (input.temporalHints?.effectiveAt?.trim()) {
    return formatIsoDateLabel(input.temporalHints.effectiveAt.trim());
  }

  const axes = extractKnowledgeComparisonAxesFromText({
    text: [input.title, input.originalFilename, input.sourceUrl]
      .filter(Boolean)
      .join("\n"),
  });
  const preferredAxis =
    axes.find((axis) => axis.kind === "period") ??
    axes.find((axis) => axis.kind === "version") ??
    axes.find((axis) => axis.kind === "effective_at");

  return preferredAxis?.label ?? input.fallback ?? null;
}

export function buildKnowledgeTopicLabel(input: {
  headingPath?: string | null;
  sectionTitle?: string | null;
  noteNumber?: string | null;
  noteSubsection?: string | null;
  noteTitle?: string | null;
  sheetName?: string | null;
  sourcePath?: string | null;
}): string {
  if (input.noteNumber?.trim()) {
    const noteRef = input.noteSubsection?.trim()
      ? `${input.noteNumber.trim()}.${input.noteSubsection.trim()}`
      : input.noteNumber.trim();
    return input.noteTitle?.trim()
      ? `Note ${noteRef} ${input.noteTitle.trim()}`
      : `Note ${noteRef}`;
  }

  const sectionTitle = input.sectionTitle?.trim();
  if (
    sectionTitle &&
    /^(article|pasal|clause|section|table|sheet)\b/i.test(sectionTitle)
  ) {
    return sectionTitle;
  }

  if (input.headingPath?.trim()) return input.headingPath.trim();
  if (input.sheetName?.trim()) return input.sheetName.trim();
  if (input.sourcePath?.trim()) return input.sourcePath.trim();
  return sectionTitle || "Document overview";
}

export function buildKnowledgeLocationLabel(input: {
  headingPath?: string | null;
  noteNumber?: string | null;
  noteSubsection?: string | null;
  noteTitle?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
}): string | null {
  const parts: string[] = [];

  if (input.noteNumber?.trim()) {
    const noteRef = input.noteSubsection?.trim()
      ? `${input.noteNumber.trim()}.${input.noteSubsection.trim()}`
      : input.noteNumber.trim();
    parts.push(
      input.noteTitle?.trim()
        ? `Note ${noteRef} ${input.noteTitle.trim()}`
        : `Note ${noteRef}`,
    );
  } else if (input.headingPath?.trim()) {
    parts.push(input.headingPath.trim());
  }

  if (input.pageStart && input.pageEnd) {
    parts.push(
      input.pageStart === input.pageEnd
        ? `Page ${input.pageStart}`
        : `Pages ${input.pageStart}-${input.pageEnd}`,
    );
  } else if (input.pageStart) {
    parts.push(`Page ${input.pageStart}`);
  }

  return parts.join(" | ") || null;
}

export function buildKnowledgeDisplayContext(input: {
  documentLabel?: string | null;
  variantLabel?: string | null;
  topicLabel?: string | null;
  locationLabel?: string | null;
}): KnowledgeDisplayContext {
  return {
    documentLabel: input.documentLabel ?? null,
    variantLabel: input.variantLabel ?? null,
    topicLabel: input.topicLabel ?? null,
    locationLabel: input.locationLabel ?? null,
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
