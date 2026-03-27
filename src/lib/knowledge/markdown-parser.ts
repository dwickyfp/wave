/**
 * LLM-based markdown reconstruction for extracted pages.
 *
 * The parser operates page-by-page so ContextX can preserve page grounding
 * while still using high-quality LLM reconstruction instead of full-document
 * parsing.
 */
import { createHash } from "node:crypto";
import { LanguageModel, generateText } from "ai";
import type {
  KnowledgeParseMode,
  KnowledgeParseRepairPolicy,
} from "app-types/knowledge";
import { createModelFromConfig } from "lib/ai/provider-factory";
import { settingsRepository } from "lib/db/repository";
import { mapWithConcurrency } from "./async-pool";
import { createPageMarker } from "./page-markers";
import type { ProcessedDocumentPage } from "./processor/types";

const PARSE_SYSTEM_PROMPT = `You are a document reconstruction expert. Your task is to convert raw extracted document text into clean, readable markdown.

Primary goal:
- Reconstruct the most likely local reading order when extraction is visibly broken
- Match the actual document structure semantically, not just readability
- Prefer local page/section repair over exact raw line order

Non-negotiable rules:
- Preserve ALL factual information from the original text
- Do not summarize, invent, or omit content
- Do not flatten, merge, or reorder major sections
- Do not move content across major sections or unrelated page regions
- When layout is ambiguous, keep the original local grouping instead of guessing
- Output only markdown content

Structure rules:
- Preserve heading hierarchy, numbering, and sibling order when they are present
- Preserve section boundaries, callouts, appendices, footnotes, and figure/table references when they are detectable
- Preserve list nesting, checklist state, and ordered list numbering
- Preserve table grouping, captions, nearby notes, and continuation rows
- Keep each CTX_IMAGE marker at the same local structural anchor; never hoist it to the start of a section

Allowed repairs:
- Reorder text within the same local section to repair columns and broken reading order
- Merge wrapped lines back into paragraphs
- Repair split list items, headings, captions, and table rows
- Keep captions close to the nearest table, chart, image marker, or related paragraph
- Remove repeated headers, footers, page numbers, and watermark artifacts

Markdown rules:
- Use headings (# ## ###) only for real section titles
- Keep related items together instead of turning every short line into a heading
- Format lists compactly
- Convert tabular data into markdown tables when the structure is clear
- Never output horizontal rules (--- or ***)
- Use a single blank line between sections
- Do not invent headings to make the page look cleaner

Code and markers:
- Preserve code exactly and wrap it in fenced code blocks when appropriate
- Preserve any literal CTX_IMAGE_<number> marker exactly as written
- Preserve any literal <!--CTX_PAGE:number--> marker exactly as written
- Never renumber, rewrite, or remove CTX_IMAGE or CTX_PAGE markers`;

const WINDOW_CHARS = 40_000;
const WINDOW_OVERLAP_CHARS = 4_000;
const OVERLAP_COMPARE_LINES = 80;
const AUTO_PARSE_QUALITY_THRESHOLD = 0.68;
const DEFAULT_PARSE_PAGE_CONCURRENCY = 4;
const DEFAULT_PARSE_WINDOW_CONCURRENCY = 2;
const DEFAULT_LONG_DOC_PAGE_THRESHOLD = 40;
const DEFAULT_PARSE_RETRY_ATTEMPTS = 4;
const DEFAULT_PARSE_RETRY_BASE_DELAY_MS = 3_000;

const pageParseCache = new Map<string, ProcessedDocumentPage>();

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getLongDocPageThreshold() {
  return readPositiveIntEnv(
    "KNOWLEDGE_PARSE_LONG_DOC_PAGE_THRESHOLD",
    DEFAULT_LONG_DOC_PAGE_THRESHOLD,
  );
}

function getPageParseConcurrency(totalPages: number) {
  const configured = readPositiveIntEnv(
    "KNOWLEDGE_PARSE_PAGE_CONCURRENCY",
    DEFAULT_PARSE_PAGE_CONCURRENCY,
  );
  return totalPages >= getLongDocPageThreshold()
    ? configured
    : Math.min(2, configured);
}

function getWindowParseConcurrency(totalPages: number) {
  const configured = readPositiveIntEnv(
    "KNOWLEDGE_PARSE_WINDOW_CONCURRENCY",
    DEFAULT_PARSE_WINDOW_CONCURRENCY,
  );
  return totalPages >= getLongDocPageThreshold()
    ? configured
    : Math.min(1, configured);
}

export function isTransientKnowledgeParseError(error: unknown) {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error);
  return (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("overloaded") ||
    message.includes("temporarily unavailable") ||
    message.includes("timeout")
  );
}

function getParseRetryAttempts(): number {
  return readPositiveIntEnv(
    "KNOWLEDGE_PARSE_RETRY_ATTEMPTS",
    DEFAULT_PARSE_RETRY_ATTEMPTS,
  );
}

function getParseRetryBaseDelayMs(): number {
  const raw = process.env.KNOWLEDGE_PARSE_RETRY_BASE_DELAY_MS;
  if (!raw) return DEFAULT_PARSE_RETRY_BASE_DELAY_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_PARSE_RETRY_BASE_DELAY_MS;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableParseError(error: unknown): boolean {
  const anyError = error as any;
  // Respect the AI SDK's own isRetryable flag (covers 500s marked retriable)
  if (anyError?.isRetryable === true) return true;
  const message = (
    anyError instanceof Error ? anyError.message : String(anyError)
  ).toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("429") ||
    message.includes("500") ||
    message.includes("internal server error") ||
    message.includes("internal error") ||
    message.includes("overloaded") ||
    message.includes("temporarily unavailable") ||
    message.includes("timeout") ||
    message.includes("timed out")
  );
}

function buildParseRetryDelayMs(error: unknown, attempt: number): number {
  const anyError = error as any;
  const retryAfterHeader =
    anyError?.responseHeaders?.["retry-after"] ??
    anyError?.responseHeaders?.["Retry-After"] ??
    anyError?.headers?.["retry-after"] ??
    anyError?.headers?.["Retry-After"];

  if (typeof retryAfterHeader === "string") {
    const seconds = Number.parseInt(retryAfterHeader, 10);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  }

  const message =
    anyError instanceof Error ? anyError.message : String(anyError);
  const secondsMatch = message.match(/retry after\s+(\d+)\s*seconds?/i);
  if (secondsMatch) {
    const seconds = Number.parseInt(secondsMatch[1], 10);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  }

  return getParseRetryBaseDelayMs() * 2 ** Math.max(0, attempt - 1);
}

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
Reconstruct the page so the markdown follows the actual document structure semantically.
You may reorder text within the same local section to repair columns, wrapped paragraphs, tables, lists, and captions.
Preserve heading hierarchy, numbering, list nesting, table/caption grouping, and CTX_IMAGE marker placement.
Do not summarize, invent, flatten sections, merge sibling sections, or move content across major sections.
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
  failureMode?: "fallback" | "fail";
}): Promise<string> {
  const maxAttempts = getParseRetryAttempts();
  let attempt = 0;
  let text: string;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    try {
      ({ text } = await generateText({
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
      }));
      break;
    } catch (error) {
      if (attempt >= maxAttempts || !isRetriableParseError(error)) {
        throw error;
      }
      const delayMs = buildParseRetryDelayMs(error, attempt);
      console.warn(
        `[ContextX] Parse API error for "${input.documentTitle}" page ${input.pageNumber} window ${input.windowIndex}; retrying in ${Math.ceil(delayMs / 1_000)}s (attempt ${attempt}/${maxAttempts})`,
      );
      await sleep(delayMs);
    }
  }

  const parsed = text!.trim();
  // Only treat truly empty or near-empty responses as failures – these catch
  // LLM refusals ("I can't help"), blank outputs, or network truncation.
  // Ratio-based comparisons against rawText are unreliable: sparse financial
  // pages, chart grids, and image-heavy pages all produce legitimately compact
  // markdown that would false-positive on any percentage threshold.
  if (!parsed || parsed.length < 20) {
    const message = `[ContextX] Parser returned suspiciously short output for "${input.documentTitle}" page ${input.pageNumber}`;
    if (input.failureMode === "fail") {
      throw new Error(message);
    }
    console.warn(`${message}; using normalized text`);
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
  failureMode?: "fallback" | "fail";
  windowConcurrency?: number;
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
  const windowConcurrency = Math.max(1, input.windowConcurrency ?? 1);
  const parsedWindows =
    windowConcurrency <= 1 || windows.length <= 1
      ? await mapWithConcurrency(windows, 1, async (windowText, index) =>
          parseWindowToMarkdown({
            model: input.model,
            rawText: windowText,
            documentTitle: input.documentTitle,
            pageNumber: input.page.pageNumber,
            windowIndex: index + 1,
            totalWindows: windows.length,
            repairPolicy: input.repairPolicy,
            qualityScore: input.page.qualityScore,
            repairReason: input.page.repairReason,
            failureMode: input.failureMode,
          }),
        )
      : await mapWithConcurrency(
          windows,
          Math.min(windowConcurrency, windows.length),
          async (windowText, index) =>
            parseWindowToMarkdown({
              model: input.model,
              rawText: windowText,
              documentTitle: input.documentTitle,
              pageNumber: input.page.pageNumber,
              windowIndex: index + 1,
              totalWindows: windows.length,
              repairPolicy: input.repairPolicy,
              qualityScore: input.page.qualityScore,
              repairReason: input.page.repairReason,
              failureMode: input.failureMode,
            }),
        );

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
  failureMode?: "fallback" | "fail";
  onPageProgress?: (state: {
    currentPage: number;
    totalPages: number;
    pageNumber: number;
    repairing: boolean;
  }) => Promise<void> | void;
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
    const totalPages = normalizedPages.length;
    const windowConcurrency = getWindowParseConcurrency(totalPages);
    let pageConcurrency = getPageParseConcurrency(totalPages);
    let completedPages = 0;
    const updatedPages = [...normalizedPages];
    const repairQueue = normalizedPages
      .map((page, index) => ({
        page,
        index,
        repairing: shouldRepairPage(page, input.mode),
      }))
      .filter((entry) => entry.repairing);

    const markProgress = async (
      page: ProcessedDocumentPage,
      repairing: boolean,
    ) => {
      completedPages += 1;
      await input.onPageProgress?.({
        currentPage: completedPages,
        totalPages,
        pageNumber: page.pageNumber,
        repairing,
      });
    };

    for (const entry of normalizedPages
      .map((page, index) => ({
        page,
        index,
        repairing: shouldRepairPage(page, input.mode),
      }))
      .filter((item) => !item.repairing)) {
      await markProgress(entry.page, false);
    }

    let cursor = 0;
    while (cursor < repairQueue.length) {
      const batchSize = Math.max(
        1,
        Math.min(pageConcurrency, repairQueue.length - cursor),
      );
      const batch = repairQueue.slice(cursor, cursor + batchSize);
      const batchResults = await mapWithConcurrency(
        batch,
        batchSize,
        async (entry) => {
          try {
            const parsedPage = await parseSinglePage({
              model,
              page: entry.page,
              documentTitle: input.documentTitle,
              provider: input.parsingProvider,
              parsingModel: input.parsingModel,
              repairPolicy: input.repairPolicy,
              failureMode: input.failureMode,
              windowConcurrency,
            });
            return {
              index: entry.index,
              page: parsedPage,
              repairing: true,
            };
          } catch (error) {
            if (isTransientKnowledgeParseError(error)) {
              pageConcurrency = 1;
            }
            if (input.failureMode === "fail") {
              throw error;
            }
            console.warn(
              `[ContextX] Falling back to normalized page ${entry.page.pageNumber} for "${input.documentTitle}":`,
              error,
            );
            return {
              index: entry.index,
              page: entry.page,
              repairing: true,
            };
          }
        },
      );

      for (const result of batchResults) {
        updatedPages[result.index] = result.page;
        await markProgress(result.page, result.repairing);
      }

      cursor += batchSize;
    }

    return {
      markdown: buildMarkdownFromPages(updatedPages),
      pages: updatedPages,
    };
  } catch (error) {
    if (input.failureMode === "fail") {
      throw error;
    }
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
