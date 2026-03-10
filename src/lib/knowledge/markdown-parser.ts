/**
 * LLM-based markdown repair for low-quality extracted pages.
 *
 * The parser operates page-by-page so ContextX can keep ingest cheap on clean
 * documents and only spend LLM cost where layout repair materially helps.
 */
import { createHash } from "node:crypto";
import { LanguageModel, generateText } from "ai";
import type {
  KnowledgeParseMode,
  KnowledgeParseRepairPolicy,
} from "app-types/knowledge";
import { createModelFromConfig } from "lib/ai/provider-factory";
import { settingsRepository } from "lib/db/repository";
import { createPageMarker } from "./page-markers";
import type { ProcessedDocumentPage } from "./processor/types";

const PARSE_SYSTEM_PROMPT = `You are a document reconstruction expert. Your task is to convert raw extracted document text into clean, readable markdown.

Primary goal:
- Reconstruct the most likely local reading order when extraction is visibly broken
- Prefer local page/section repair over exact raw line order
- Improve readability without changing the document's facts

Non-negotiable rules:
- Preserve ALL factual information from the original text
- Do not summarize, invent, or omit content
- Do not move content across major sections or unrelated page regions
- When layout is ambiguous, keep the original local grouping instead of guessing
- Output only markdown content

Allowed repairs:
- Reorder text within the same local section to repair columns and broken reading order
- Merge wrapped lines back into paragraphs
- Repair split list items, headings, and table rows
- Keep captions close to the nearest table, chart, image marker, or related paragraph
- Remove repeated headers, footers, page numbers, and watermark artifacts

Markdown rules:
- Use headings (# ## ###) only for real section titles
- Keep related items together instead of turning every short line into a heading
- Format lists compactly
- Convert tabular data into markdown tables when the structure is clear
- Never output horizontal rules (--- or ***)
- Use a single blank line between sections

Code and markers:
- Preserve code exactly and wrap it in fenced code blocks when appropriate
- Preserve any literal CTX_IMAGE_<number> marker exactly as written
- Preserve any literal <!--CTX_PAGE:number--> marker exactly as written
- Never renumber, rewrite, or remove CTX_IMAGE or CTX_PAGE markers`;

const WINDOW_CHARS = 40_000;
const WINDOW_OVERLAP_CHARS = 4_000;
const OVERLAP_COMPARE_LINES = 80;
const AUTO_PARSE_QUALITY_THRESHOLD = 0.68;

const pageParseCache = new Map<string, ProcessedDocumentPage>();

async function resolveParsingModel(provider: string, modelName: string) {
  const providerConfig = await settingsRepository.getProviderByName(provider);
  if (!providerConfig?.enabled) {
    throw new Error(
      `Parsing provider "${provider}" is not enabled or not found`,
    );
  }

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
  if (!model) {
    throw new Error(
      `Failed to create model instance for ${provider}/${modelName}`,
    );
  }

  if (!modelConfig) {
    console.warn(
      `[ContextX] Parsing model "${modelName}" is not registered in settings; using direct provider model fallback`,
    );
  }

  return model;
}

function buildParsePrompt(input: {
  rawText: string;
  documentTitle: string;
  pageNumber: number;
  windowIndex: number;
  totalWindows: number;
  repairPolicy: KnowledgeParseRepairPolicy;
  qualityScore: number;
  repairReason?: string | null;
}): string {
  return `Document title: "${input.documentTitle}"
Page: ${input.pageNumber}
Window: ${input.windowIndex} of ${input.totalWindows}
Repair policy: ${input.repairPolicy}
Extraction quality score: ${input.qualityScore.toFixed(2)}
${input.repairReason ? `Repair hints: ${input.repairReason}` : ""}

Raw extracted text:
<document_window>
${input.rawText}
</document_window>

Convert this page window into readable markdown.
You may reorder text within the same local section to repair columns, wrapped paragraphs, tables, and lists.
Do not summarize, invent, or move content across major sections.
If the layout is ambiguous, keep the original local grouping.`;
}

function findWindowEnd(
  rawText: string,
  desiredEnd: number,
  minEnd: number,
): number {
  const paragraphBreak = rawText.lastIndexOf("\n\n", desiredEnd);
  if (paragraphBreak > minEnd) return paragraphBreak + 2;

  const lineBreak = rawText.lastIndexOf("\n", desiredEnd);
  if (lineBreak > minEnd) return lineBreak + 1;

  const sentenceBreak = Math.max(
    rawText.lastIndexOf(". ", desiredEnd),
    rawText.lastIndexOf("! ", desiredEnd),
    rawText.lastIndexOf("? ", desiredEnd),
  );
  if (sentenceBreak > minEnd) return sentenceBreak + 2;

  const spaceBreak = rawText.lastIndexOf(" ", desiredEnd);
  if (spaceBreak > minEnd) return spaceBreak + 1;

  return desiredEnd;
}

export function splitRawTextIntoWindows(
  rawText: string,
  windowChars = WINDOW_CHARS,
  overlapChars = WINDOW_OVERLAP_CHARS,
): string[] {
  if (rawText.length <= windowChars) return [rawText];

  const windows: string[] = [];
  let start = 0;

  while (start < rawText.length) {
    const desiredEnd = Math.min(start + windowChars, rawText.length);
    const minEnd = Math.min(
      rawText.length,
      start + Math.floor(windowChars * 0.6),
    );
    const end =
      desiredEnd < rawText.length
        ? findWindowEnd(rawText, desiredEnd, minEnd)
        : desiredEnd;

    const windowText = rawText.slice(start, end).trim();
    if (windowText) windows.push(windowText);
    if (end >= rawText.length) break;

    const nextStart = Math.max(0, end - overlapChars);
    start = nextStart <= start ? end : nextStart;
  }

  return windows;
}

function findLineOverlap(previous: string, next: string): number {
  const previousLines = previous.split("\n").map((line) => line.trimEnd());
  const nextLines = next.split("\n").map((line) => line.trimEnd());
  const maxLines = Math.min(
    OVERLAP_COMPARE_LINES,
    previousLines.length,
    nextLines.length,
  );

  for (let size = maxLines; size > 0; size -= 1) {
    const previousSlice = previousLines.slice(-size).join("\n");
    const nextSlice = nextLines.slice(0, size).join("\n");
    if (previousSlice === nextSlice) return size;
  }

  return 0;
}

function mergeTwoMarkdownWindows(previous: string, next: string): string {
  if (!previous.trim()) return next.trim();
  if (!next.trim()) return previous.trim();

  const overlapLines = findLineOverlap(previous, next);
  if (overlapLines > 0) {
    const previousLines = previous.split("\n");
    const nextLines = next.split("\n");
    return [...previousLines, ...nextLines.slice(overlapLines)]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  if (previous.includes(next)) return previous.trim();
  if (next.includes(previous)) return next.trim();

  return `${previous.trim()}\n\n${next.trim()}`.replace(/\n{3,}/g, "\n\n");
}

export function mergeParsedMarkdownWindows(windows: string[]): string {
  return windows.reduce(
    (combined, windowText) => mergeTwoMarkdownWindows(combined, windowText),
    "",
  );
}

function buildPageCacheKey(input: {
  page: ProcessedDocumentPage;
  provider: string;
  model: string;
  repairPolicy: KnowledgeParseRepairPolicy;
}) {
  return createHash("sha1")
    .update(input.page.fingerprint)
    .update(`:${input.provider}:${input.model}:${input.repairPolicy}`)
    .digest("hex");
}

async function parseWindowToMarkdown(input: {
  model: LanguageModel;
  rawText: string;
  documentTitle: string;
  pageNumber: number;
  windowIndex: number;
  totalWindows: number;
  repairPolicy: KnowledgeParseRepairPolicy;
  qualityScore: number;
  repairReason?: string | null;
}): Promise<string> {
  const { text } = await generateText({
    model: input.model,
    system: PARSE_SYSTEM_PROMPT,
    prompt: buildParsePrompt({
      rawText: input.rawText,
      documentTitle: input.documentTitle,
      pageNumber: input.pageNumber,
      windowIndex: input.windowIndex,
      totalWindows: input.totalWindows,
      repairPolicy: input.repairPolicy,
      qualityScore: input.qualityScore,
      repairReason: input.repairReason,
    }),
    temperature: 0,
  });

  const parsed = text.trim();
  if (!parsed || parsed.length < Math.max(50, input.rawText.length * 0.15)) {
    console.warn(
      `[ContextX] Parser returned suspiciously short output for "${input.documentTitle}" page ${input.pageNumber}; using normalized text`,
    );
    return input.rawText;
  }

  return parsed;
}

function shouldRepairPage(
  page: ProcessedDocumentPage,
  mode: KnowledgeParseMode,
): boolean {
  if (mode === "off") return false;
  if (mode === "always") return true;
  return page.qualityScore < AUTO_PARSE_QUALITY_THRESHOLD;
}

function buildMarkdownFromPages(pages: ProcessedDocumentPage[]): string {
  return pages
    .flatMap((page) => [
      createPageMarker(page.pageNumber),
      page.markdown.trim() || page.normalizedText.trim(),
    ])
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

async function parseSinglePage(input: {
  model: LanguageModel;
  page: ProcessedDocumentPage;
  documentTitle: string;
  provider: string;
  parsingModel: string;
  repairPolicy: KnowledgeParseRepairPolicy;
}): Promise<ProcessedDocumentPage> {
  const cacheKey = buildPageCacheKey({
    page: input.page,
    provider: input.provider,
    model: input.parsingModel,
    repairPolicy: input.repairPolicy,
  });
  const cached = pageParseCache.get(cacheKey);
  if (cached) {
    return { ...cached };
  }

  const sourceText = input.page.rawText || input.page.normalizedText;
  const windows = splitRawTextIntoWindows(sourceText);
  const parsedWindows: string[] = [];

  for (const [index, windowText] of windows.entries()) {
    parsedWindows.push(
      await parseWindowToMarkdown({
        model: input.model,
        rawText: windowText,
        documentTitle: input.documentTitle,
        pageNumber: input.page.pageNumber,
        windowIndex: index + 1,
        totalWindows: windows.length,
        repairPolicy: input.repairPolicy,
        qualityScore: input.page.qualityScore,
        repairReason: input.page.repairReason,
      }),
    );
  }

  const markdown = mergeParsedMarkdownWindows(parsedWindows).trim();
  const repairedPage: ProcessedDocumentPage = {
    ...input.page,
    markdown: markdown || input.page.normalizedText,
    extractionMode: "refined",
  };
  pageParseCache.set(cacheKey, repairedPage);
  return repairedPage;
}

export async function parseDocumentToMarkdown(input: {
  pages: ProcessedDocumentPage[];
  documentTitle: string;
  parsingProvider: string;
  parsingModel: string;
  mode: KnowledgeParseMode;
  repairPolicy: KnowledgeParseRepairPolicy;
}): Promise<{
  markdown: string;
  pages: ProcessedDocumentPage[];
}> {
  const normalizedPages =
    input.pages.length > 0
      ? input.pages
      : [
          {
            pageNumber: 1,
            rawText: "",
            normalizedText: "",
            markdown: "",
            fingerprint: "empty",
            qualityScore: 0,
            extractionMode: "normalized" as const,
            repairReason: "empty_page",
          },
        ];

  if (input.mode === "off") {
    return {
      markdown: buildMarkdownFromPages(normalizedPages),
      pages: normalizedPages,
    };
  }

  try {
    const model = await resolveParsingModel(
      input.parsingProvider,
      input.parsingModel,
    );
    const updatedPages: ProcessedDocumentPage[] = [];

    for (const page of normalizedPages) {
      if (!shouldRepairPage(page, input.mode)) {
        updatedPages.push(page);
        continue;
      }

      updatedPages.push(
        await parseSinglePage({
          model,
          page,
          documentTitle: input.documentTitle,
          provider: input.parsingProvider,
          parsingModel: input.parsingModel,
          repairPolicy: input.repairPolicy,
        }),
      );
    }

    return {
      markdown: buildMarkdownFromPages(updatedPages),
      pages: updatedPages,
    };
  } catch (error) {
    console.error(
      `[ContextX] Page-level markdown parsing failed for "${input.documentTitle}", falling back to normalized pages:`,
      error,
    );
    return {
      markdown: buildMarkdownFromPages(normalizedPages),
      pages: normalizedPages,
    };
  }
}
