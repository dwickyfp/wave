import { createHash } from "node:crypto";
import type {
  KnowledgeImageMode,
  KnowledgeImageStructuredData,
  KnowledgeImageType,
} from "app-types/knowledge";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { LanguageModel, Output, generateText, jsonSchema } from "ai";
import { z } from "zod";
import { createModelFromConfig } from "lib/ai/provider-factory";
import { settingsRepository } from "lib/db/repository";
import { safeOutboundFetch } from "lib/network/safe-outbound-fetch";
import { optimizeKnowledgeImageBuffer } from "./image-optimization";
import { MAX_KNOWLEDGE_IMAGE_BYTES } from "./image-optimization";
import {
  isImageContentType,
  normalizeRemoteContentType,
  readResponseBufferWithinLimit,
} from "./remote-fetch";
import type {
  ContextImageBlock,
  DocumentProcessingOptions,
  ProcessedDocument,
  ProcessedImageAnchor,
  ProcessedDocumentImage,
} from "./types";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

const IMAGE_MARKER_PREFIX = "CTX_IMAGE_";
const IMAGE_CONTEXT_MAX_CHARS = 1_200;
const IMAGE_NEIGHBOR_CONTEXT_MAX_CHARS = 320;
const IMAGE_ANALYSIS_CONCURRENCY = 1;

const IMAGE_ANALYSIS_SYSTEM_PROMPT = `You analyze exactly one extracted document image at a time for a knowledge base.

Requirements:
- Focus only on the current image, never on other images from the same document
- Be factual and specific
- Use only details that are visible in the image itself; nearby document text is only for disambiguation
- Keep the label focused on the image itself, not on surrounding paragraph summaries
- Keep the description primarily visual; nearby document text may add at most one short disambiguating sentence when it truly helps
- Do not replace the visual description with a summary of surrounding text
- If the exact visual contents are unclear, say that directly instead of guessing
- If the image is a chart, diagram, or table-like visual, identify the chart type, axes, labels, legend, series, units, and the main relationship or trend
- If the image is a table, capture the visible headers and the most salient rows or cells
- If the image is a scan or text-heavy figure, capture exact visible OCR text when legible
- If the image is a UI screenshot, identify the product/page, visible sections, controls, labels, statuses, and any important numbers or messages
- Only put exact text or numeric values in OCR/value fields when they are clearly visible
- Leave chartData, tableData, OCR text, or value snippets empty when they are not applicable`;

const IMAGE_TYPES = [
  "ui",
  "chart",
  "table",
  "document_scan",
  "diagram",
  "photo",
  "other",
] as const;

const nullToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (value === null ? undefined : value),
    schema.optional(),
  );

const IMAGE_ANALYSIS_OUTPUT_RUNTIME_SCHEMA = z.object({
  imageType: nullToUndefined(z.enum(IMAGE_TYPES)),
  label: nullToUndefined(z.string()),
  description: nullToUndefined(z.string()),
  ocrText: nullToUndefined(z.string()),
  exactValueSnippets: nullToUndefined(z.array(z.string())),
  chartData: nullToUndefined(
    z.object({
      chartType: nullToUndefined(z.string()),
      title: nullToUndefined(z.string()),
      xAxisLabel: nullToUndefined(z.string()),
      yAxisLabel: nullToUndefined(z.string()),
      legend: nullToUndefined(z.array(z.string())),
      units: nullToUndefined(z.array(z.string())),
      series: nullToUndefined(
        z.array(
          z.object({
            name: nullToUndefined(z.string()),
            values: nullToUndefined(z.array(z.string())),
          }),
        ),
      ),
      summary: nullToUndefined(z.string()),
    }),
  ),
  tableData: nullToUndefined(
    z.object({
      headers: nullToUndefined(z.array(z.string())),
      rows: nullToUndefined(z.array(z.array(z.string()))),
      summary: nullToUndefined(z.string()),
    }),
  ),
  ocrConfidence: nullToUndefined(z.number().min(0).max(1)),
});

type StructuredImageAnalysisOutput = z.infer<
  typeof IMAGE_ANALYSIS_OUTPUT_RUNTIME_SCHEMA
>;

const IMAGE_ANALYSIS_OUTPUT_SCHEMA = jsonSchema<StructuredImageAnalysisOutput>(
  {
    type: "object",
    properties: {
      imageType: {
        type: "string",
        enum: [...IMAGE_TYPES],
      },
      label: { type: "string" },
      description: { type: "string" },
      ocrText: { type: "string" },
      exactValueSnippets: {
        type: "array",
        items: { type: "string" },
      },
      chartData: {
        type: "object",
        properties: {
          chartType: { type: "string" },
          title: { type: "string" },
          xAxisLabel: { type: "string" },
          yAxisLabel: { type: "string" },
          legend: {
            type: "array",
            items: { type: "string" },
          },
          units: {
            type: "array",
            items: { type: "string" },
          },
          series: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                values: {
                  type: "array",
                  items: { type: "string" },
                },
              },
            },
          },
          summary: { type: "string" },
        },
      },
      tableData: {
        type: "object",
        properties: {
          headers: {
            type: "array",
            items: { type: "string" },
          },
          rows: {
            type: "array",
            items: {
              type: "array",
              items: { type: "string" },
            },
          },
          summary: { type: "string" },
        },
      },
      ocrConfidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
    },
  },
  {
    validate: (value) => {
      const result = IMAGE_ANALYSIS_OUTPUT_RUNTIME_SCHEMA.safeParse(value);
      return result.success
        ? { success: true, value: result.data }
        : { success: false, error: result.error };
    },
  },
);

const VALUE_DENSE_IMAGE_HINT_PATTERN =
  /\b(chart|graph|plot|figure|fig\.?|table|exhibit|diagram|legend|axis|series|histogram|heatmap|matrix|trend|scan|statement|invoice|receipt|schedule|appendix|balance|revenue|liabilities|assets|cash flow)\b/i;
const VALUE_DENSE_NUMERIC_PATTERN =
  /(?:[$€£¥₹]|rp\b|idr\b|usd\b|eur\b|%|\b\d[\d.,]{1,}\b)/i;

type ImageCandidate = {
  index: number;
  marker: string;
  buffer?: Buffer | null;
  mediaType?: string | null;
  altText?: string | null;
  caption?: string | null;
  surroundingText?: string | null;
  precedingText?: string | null;
  followingText?: string | null;
  sourceUrl?: string | null;
  pageNumber?: number | null;
  width?: number | null;
  height?: number | null;
  anchor?: ProcessedImageAnchor | null;
};

type ImageAnalysisDetail = "simple" | "rich";

type ImageAnalysis = {
  imageType: KnowledgeImageType;
  label: string;
  description: string;
  ocrText?: string | null;
  exactValueSnippets?: string[] | null;
  structuredData?: KnowledgeImageStructuredData | null;
  ocrConfidence?: number | null;
};

type ResolvedImageContext = Pick<
  ProcessedDocumentImage,
  "headingPath" | "stepHint"
>;

type ResolvedImageAnalysisModel = {
  model: LanguageModel;
  supportsImageInput: boolean | null;
};

async function normalizeImageCandidate(
  candidate: ImageCandidate,
): Promise<ImageCandidate> {
  if (!candidate.buffer?.length) {
    return candidate;
  }

  const optimized = await optimizeKnowledgeImageBuffer({
    buffer: candidate.buffer,
    mediaType: candidate.mediaType,
  });

  return {
    ...candidate,
    buffer: optimized.buffer,
    mediaType: optimized.mediaType ?? candidate.mediaType ?? null,
    width: optimized.width ?? candidate.width ?? null,
    height: optimized.height ?? candidate.height ?? null,
  };
}

type HtmlConversionOptions = DocumentProcessingOptions & {
  baseUrl?: string;
};

function cleanInlineText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeImageMode(
  value: KnowledgeImageMode | null | undefined,
): KnowledgeImageMode {
  if (value === "off" || value === "always") {
    return value;
  }
  return "auto";
}

function cleanMultilineText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function clipText(value: string | null | undefined, maxChars: number): string {
  const cleaned = cleanInlineText(value);
  if (cleaned.length <= maxChars) return cleaned;
  const clipped = cleaned.slice(0, maxChars);
  const lastSpace = clipped.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.7 ? clipped.slice(0, lastSpace) : clipped)
    .trim()
    .concat("...");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureSentenceEnding(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function guessImageTypeFromCandidate(
  candidate: ImageCandidate,
): KnowledgeImageType {
  const context = [
    candidate.altText,
    candidate.caption,
    candidate.surroundingText,
    candidate.precedingText,
    candidate.followingText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    /\b(chart|graph|plot|histogram|trend|series|axis|legend)\b/.test(context)
  ) {
    return "chart";
  }
  if (/\b(table|rows?|columns?|tabular)\b/.test(context)) {
    return "table";
  }
  if (/\b(scan|statement|invoice|receipt|form|document)\b/.test(context)) {
    return "document_scan";
  }
  if (
    /\b(ui|screen|dialog|modal|page|settings|dashboard|button|form field)\b/.test(
      context,
    )
  ) {
    return "ui";
  }
  if (/\b(diagram|architecture|workflow|flowchart|schema)\b/.test(context)) {
    return "diagram";
  }
  if (/\b(photo|portrait|person|camera)\b/.test(context)) {
    return "photo";
  }
  return "other";
}

function resolveImageAnalysisDetail(
  candidate: ImageCandidate,
  imageMode: KnowledgeImageMode,
): ImageAnalysisDetail {
  if (imageMode === "always") {
    return "rich";
  }

  const context = [
    candidate.altText,
    candidate.caption,
    candidate.surroundingText,
    candidate.precedingText,
    candidate.followingText,
  ]
    .filter(Boolean)
    .join(" ");
  const area =
    Math.max(0, candidate.width ?? 0) * Math.max(0, candidate.height ?? 0);
  const hasValueDenseHint = VALUE_DENSE_IMAGE_HINT_PATTERN.test(context);
  const hasNumericHint = VALUE_DENSE_NUMERIC_PATTERN.test(context);
  const hasPdfCaptionAnchor =
    candidate.anchor?.source === "caption" ||
    candidate.anchor?.source === "pdf-layout";

  if (hasValueDenseHint) {
    return "rich";
  }
  if (
    (hasNumericHint && hasPdfCaptionAnchor) ||
    (hasNumericHint && area >= 90_000)
  ) {
    return "rich";
  }
  if (candidate.pageNumber != null && hasPdfCaptionAnchor && area >= 120_000) {
    return "rich";
  }
  return "simple";
}

function isProbablyDecorativeHtmlImage(
  $img: cheerio.Cheerio<any>,
  altText: string,
): boolean {
  const role = ($img.attr("role") ?? "").toLowerCase();
  if (role === "presentation") return true;

  const ariaHidden = ($img.attr("aria-hidden") ?? "").toLowerCase();
  if (ariaHidden === "true") return true;

  const className = ($img.attr("class") ?? "").toLowerCase();
  const src = ($img.attr("src") ?? "").toLowerCase();
  const width = Number.parseInt($img.attr("width") ?? "", 10);
  const height = Number.parseInt($img.attr("height") ?? "", 10);

  if (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width <= 32 &&
    height <= 32
  ) {
    return true;
  }

  const obviousDecorativePattern = /\b(icon|logo|avatar|emoji|spacer|sprite)\b/;
  if (obviousDecorativePattern.test(className)) return true;
  if (obviousDecorativePattern.test(altText)) return true;
  if (obviousDecorativePattern.test(src) && !altText) return true;

  return false;
}

function extractParentTextWithoutImages($img: cheerio.Cheerio<any>): string {
  const parent = $img.parent();
  if (!parent.length) return "";
  const clone = parent.clone();
  clone.find("img").remove();
  return cleanInlineText(clone.text());
}

function extractSiblingText(
  $img: cheerio.Cheerio<any>,
  direction: "prev" | "next",
) {
  const sibling =
    direction === "prev" ? $img.prevAll().first() : $img.nextAll().first();
  if (!sibling.length) return "";
  return cleanInlineText(sibling.text());
}

function extractHtmlImageContext(
  $img: cheerio.Cheerio<any>,
): Pick<
  ImageCandidate,
  "altText" | "caption" | "surroundingText" | "precedingText" | "followingText"
> {
  const altText = cleanInlineText(
    $img.attr("alt") ?? $img.attr("title") ?? $img.attr("aria-label"),
  );
  const figureCaption = cleanInlineText(
    $img.closest("figure").find("figcaption").first().text(),
  );
  const parentText = extractParentTextWithoutImages($img);
  const prevText = extractSiblingText($img, "prev");
  const nextText = extractSiblingText($img, "next");
  const precedingText = clipText(
    prevText || parentText,
    IMAGE_NEIGHBOR_CONTEXT_MAX_CHARS,
  );
  const followingText = clipText(
    nextText || parentText,
    IMAGE_NEIGHBOR_CONTEXT_MAX_CHARS,
  );
  const surroundingText = clipText(
    [figureCaption, parentText, prevText, nextText].filter(Boolean).join(" "),
    IMAGE_CONTEXT_MAX_CHARS,
  );

  return {
    altText: altText || null,
    caption: figureCaption || null,
    surroundingText: surroundingText || null,
    precedingText: precedingText || null,
    followingText: followingText || null,
  };
}

async function loadImageSource(
  src: string | undefined,
  baseUrl?: string,
): Promise<{
  buffer?: Buffer | null;
  mediaType?: string | null;
  sourceUrl?: string | null;
}> {
  const cleanedSrc = src?.trim();
  if (!cleanedSrc) {
    return { buffer: null, mediaType: null, sourceUrl: null };
  }

  const dataUrlMatch = cleanedSrc.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (dataUrlMatch) {
    return {
      buffer: Buffer.from(dataUrlMatch[2], "base64"),
      mediaType: dataUrlMatch[1],
      sourceUrl: null,
    };
  }

  let resolvedUrl: string | null = null;
  try {
    resolvedUrl = baseUrl
      ? new URL(cleanedSrc, baseUrl).toString()
      : new URL(cleanedSrc).toString();
  } catch {
    return {
      buffer: null,
      mediaType: null,
      sourceUrl: cleanedSrc,
    };
  }

  try {
    const response = await safeOutboundFetch(resolvedUrl, {
      headers: {
        Accept: "image/*,*/*;q=0.1",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const mediaType = normalizeRemoteContentType(
      response.headers.get("content-type"),
    );
    if (mediaType && !isImageContentType(mediaType)) {
      throw new Error(`Unsupported remote image content type: ${mediaType}`);
    }

    const buffer = await readResponseBufferWithinLimit(
      response,
      MAX_KNOWLEDGE_IMAGE_BYTES,
      "Remote image response",
    );
    return {
      buffer,
      mediaType,
      sourceUrl: resolvedUrl,
    };
  } catch (error) {
    console.warn(
      `[ContextX] Failed to fetch image asset "${resolvedUrl}":`,
      error,
    );
    return {
      buffer: null,
      mediaType: null,
      sourceUrl: resolvedUrl,
    };
  }
}

async function resolveImageAnalysisModel(
  config: DocumentProcessingOptions["imageAnalysis"],
): Promise<ResolvedImageAnalysisModel | null> {
  if (!config?.provider || !config?.model) return null;

  const providerConfig = await settingsRepository.getProviderByName(
    config.provider,
  );
  if (!providerConfig?.enabled) return null;

  const modelConfig = await settingsRepository.getModelForChat(
    config.provider,
    config.model,
  );
  const modelName = modelConfig?.apiName ?? config.model;
  const model = createModelFromConfig(
    config.provider,
    modelName,
    providerConfig.apiKey,
    providerConfig.baseUrl,
    providerConfig.settings,
  );

  if (!model) return null;

  return {
    model,
    supportsImageInput:
      typeof modelConfig?.supportsImageInput === "boolean"
        ? modelConfig.supportsImageInput
        : null,
  };
}

function buildImageFallbackDescription(candidate: ImageCandidate): string {
  const parts: string[] = [];

  if (candidate.pageNumber != null) {
    parts.push(`Document visual on page ${candidate.pageNumber}.`);
  } else {
    parts.push("Document visual extracted from the source content.");
  }

  if (candidate.altText) {
    parts.push(ensureSentenceEnding(`Embedded alt text: ${candidate.altText}`));
  }

  if (candidate.caption && candidate.caption !== candidate.altText) {
    parts.push(
      ensureSentenceEnding(`Caption or nearby label: ${candidate.caption}`),
    );
  }

  if (candidate.surroundingText) {
    parts.push(
      ensureSentenceEnding(
        `Nearby document context: ${candidate.surroundingText}`,
      ),
    );
  }

  if (candidate.precedingText) {
    parts.push(
      ensureSentenceEnding(`Text before image: ${candidate.precedingText}`),
    );
  }

  if (candidate.followingText) {
    parts.push(
      ensureSentenceEnding(`Text after image: ${candidate.followingText}`),
    );
  }

  if (candidate.width && candidate.height) {
    parts.push(
      ensureSentenceEnding(
        `Image size: ${candidate.width}x${candidate.height} pixels`,
      ),
    );
  }

  if (candidate.sourceUrl) {
    parts.push(ensureSentenceEnding(`Image source: ${candidate.sourceUrl}`));
  }

  if (parts.length === 1) {
    parts.push(
      "No embedded caption, alt text, or visual analysis was available, so the exact contents could not be determined automatically.",
    );
  }

  return parts.join(" ").trim();
}

function buildImageFallbackLabel(candidate: ImageCandidate): string {
  const preferred = cleanInlineText(candidate.caption || candidate.altText);
  if (preferred) {
    return normalizeGeneratedLabel(shortenLabel(preferred));
  }

  if (candidate.pageNumber != null) {
    return `Embedded image ${candidate.index} on page ${candidate.pageNumber}`;
  }

  return `Embedded image ${candidate.index}`;
}

function normalizeExactValueSnippets(
  values: string[] | null | undefined,
): string[] | null {
  const normalized = Array.from(
    new Set(
      (values ?? []).map((value) => cleanInlineText(value)).filter(Boolean),
    ),
  ).slice(0, 8);
  return normalized.length > 0 ? normalized : null;
}

function normalizeStructuredData(
  output: StructuredImageAnalysisOutput,
): KnowledgeImageStructuredData | null {
  const chartSeries = (output.chartData?.series ?? [])
    .map((entry) => ({
      name: cleanInlineText(entry.name),
      values: (entry.values ?? [])
        .map((value) => cleanInlineText(value))
        .filter(Boolean),
    }))
    .filter((entry) => entry.name || entry.values.length > 0);
  const chartData =
    output.chartData &&
    [
      output.chartData.chartType,
      output.chartData.title,
      output.chartData.xAxisLabel,
      output.chartData.yAxisLabel,
      output.chartData.summary,
      ...(output.chartData.legend ?? []),
      ...(output.chartData.units ?? []),
      ...chartSeries.map((entry) => entry.name),
      ...chartSeries.flatMap((entry) => entry.values),
    ]
      .map((value) => cleanInlineText(value))
      .some(Boolean)
      ? {
          chartType: cleanInlineText(output.chartData.chartType) || null,
          title: cleanInlineText(output.chartData.title) || null,
          xAxisLabel: cleanInlineText(output.chartData.xAxisLabel) || null,
          yAxisLabel: cleanInlineText(output.chartData.yAxisLabel) || null,
          legend:
            output.chartData.legend
              ?.map((entry) => cleanInlineText(entry))
              .filter(Boolean) ?? null,
          units:
            output.chartData.units
              ?.map((entry) => cleanInlineText(entry))
              .filter(Boolean) ?? null,
          series: chartSeries.length > 0 ? chartSeries : null,
          summary: cleanInlineText(output.chartData.summary) || null,
        }
      : null;

  const tableRows = (output.tableData?.rows ?? [])
    .map((row) => row.map((cell) => cleanInlineText(cell)).filter(Boolean))
    .filter((row) => row.length > 0)
    .slice(0, 6);
  const tableData =
    output.tableData &&
    [
      ...(output.tableData.headers ?? []),
      ...(output.tableData.rows ?? []).flat(),
      output.tableData.summary,
    ]
      .map((value) => cleanInlineText(value))
      .some(Boolean)
      ? {
          headers:
            output.tableData.headers
              ?.map((entry) => cleanInlineText(entry))
              .filter(Boolean) ?? null,
          rows: tableRows.length > 0 ? tableRows : null,
          summary: cleanInlineText(output.tableData.summary) || null,
        }
      : null;

  if (!chartData && !tableData) {
    return null;
  }

  return {
    chartData,
    tableData,
  };
}

function buildImageFallbackAnalysis(
  candidate: ImageCandidate,
  options: { includeIdentity?: boolean } = {},
): ImageAnalysis {
  let description = buildImageFallbackDescription(candidate);
  if (options.includeIdentity) {
    description = `${description} Extracted image index: ${candidate.index}.`;
  }

  return {
    imageType: guessImageTypeFromCandidate(candidate),
    label: buildImageFallbackLabel(candidate),
    description,
    ocrText: null,
    exactValueSnippets: null,
    structuredData: null,
    ocrConfidence: null,
  };
}

function buildImageAnalysisPrompt(
  candidate: ImageCandidate,
  documentTitle?: string,
  options: {
    neighborContextEnabled?: boolean;
    detail?: ImageAnalysisDetail;
  } = {},
): string {
  const neighborContextEnabled = options.neighborContextEnabled !== false;
  const detail = options.detail ?? "simple";
  const parts = [
    documentTitle ? `Document title: ${documentTitle}` : null,
    `Image index in document: ${candidate.index}`,
    candidate.pageNumber != null
      ? `Page number: ${candidate.pageNumber}`
      : null,
    candidate.altText ? `Alt text: ${candidate.altText}` : null,
    candidate.caption ? `Caption: ${candidate.caption}` : null,
    candidate.width && candidate.height
      ? `Image size: ${candidate.width}x${candidate.height} pixels`
      : null,
    candidate.sourceUrl ? `Image source URL: ${candidate.sourceUrl}` : null,
    neighborContextEnabled && candidate.precedingText
      ? `Text immediately before image:\n${candidate.precedingText}`
      : null,
    neighborContextEnabled && candidate.followingText
      ? `Text immediately after image:\n${candidate.followingText}`
      : null,
    candidate.surroundingText
      ? `Nearby document context:\n${candidate.surroundingText}`
      : null,
    "",
    "Analyze this exact image for later retrieval.",
    detail === "rich"
      ? "This image looks value-dense. Prioritize exact OCR text, chart axes and series, table headers and rows, and exact numeric snippets when they are legible."
      : "This image does not look strongly value-dense. Focus on a precise label and description, and only fill OCR or structured fields if the visible text is clear and materially useful.",
    neighborContextEnabled
      ? "If the before/after text materially disambiguates the image, add at most one short context sentence to the description."
      : "Do not add context sentences from nearby document text unless they are directly visible in the image.",
    "Keep the label image-focused and keep the description primarily about what is visible.",
    "Populate the structured fields for image type, label, description, OCR text, exact values, and chart/table data.",
  ];

  return parts.filter(Boolean).join("\n");
}

function normalizeGeneratedDescription(description: string): string {
  return description
    .replace(/^description\s*:\s*/i, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeGeneratedLabel(label: string): string {
  return label
    .replace(/^label\s*:\s*/i, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function shortenLabel(value: string, maxChars = 90): string {
  const cleaned = cleanInlineText(value);
  if (!cleaned) return "";
  if (cleaned.length <= maxChars) return cleaned;
  const clipped = cleaned.slice(0, maxChars);
  const lastSpace = clipped.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.6 ? clipped.slice(0, lastSpace) : clipped)
    .trim()
    .replace(/[.,;:!?-]+$/g, "")
    .concat("...");
}

function deriveImageLabel(
  candidate: ImageCandidate,
  description: string,
): string {
  const preferred =
    candidate.caption ||
    candidate.altText ||
    description.split(/[.!?]/)[0] ||
    `Image ${candidate.index}`;
  return (
    normalizeGeneratedLabel(shortenLabel(preferred)) ||
    `Image ${candidate.index}`
  );
}

function buildStructuredImageAnalysis(
  output: StructuredImageAnalysisOutput,
  candidate: ImageCandidate,
): ImageAnalysis {
  const fallback = buildImageFallbackAnalysis(candidate);
  const label = normalizeGeneratedLabel(output.label ?? "") || fallback.label;
  const description =
    normalizeGeneratedDescription(output.description ?? "") ||
    fallback.description;
  const ocrText = cleanMultilineText(output.ocrText);

  return {
    imageType: output.imageType ?? fallback.imageType,
    label: shortenLabel(label),
    description,
    ocrText: ocrText || null,
    exactValueSnippets: normalizeExactValueSnippets(output.exactValueSnippets),
    structuredData: normalizeStructuredData(output),
    ocrConfidence:
      typeof output.ocrConfidence === "number" &&
      Number.isFinite(output.ocrConfidence)
        ? Math.max(0, Math.min(1, output.ocrConfidence))
        : null,
  };
}

function parseLegacyImageAnalysisText(
  text: string,
  candidate: ImageCandidate,
): ImageAnalysis {
  const cleaned = text.trim();
  if (!cleaned) {
    return buildImageFallbackAnalysis(candidate);
  }

  const labelMatch = cleaned.match(/^label\s*:\s*(.+)$/im);
  const descriptionMatch = cleaned.match(/^description\s*:\s*([\s\S]+)$/im);
  const label = normalizeGeneratedLabel(labelMatch?.[1] ?? "");
  const description = normalizeGeneratedDescription(
    descriptionMatch?.[1] ?? "",
  );

  if (label && description) {
    return {
      imageType: guessImageTypeFromCandidate(candidate),
      label: shortenLabel(label),
      description,
      ocrText: null,
      exactValueSnippets: null,
      structuredData: null,
      ocrConfidence: null,
    };
  }

  const lines = cleaned
    .split("\n")
    .map((line) => cleanInlineText(line))
    .filter(Boolean);
  const inferredLabel = normalizeGeneratedLabel(lines[0] ?? "");
  const inferredDescription = normalizeGeneratedDescription(
    lines.slice(1).join(" "),
  );

  if (inferredLabel && inferredDescription) {
    return {
      imageType: guessImageTypeFromCandidate(candidate),
      label: shortenLabel(inferredLabel),
      description: inferredDescription,
      ocrText: null,
      exactValueSnippets: null,
      structuredData: null,
      ocrConfidence: null,
    };
  }

  if (inferredDescription) {
    return {
      imageType: guessImageTypeFromCandidate(candidate),
      label: deriveImageLabel(candidate, inferredDescription),
      description: inferredDescription,
      ocrText: null,
      exactValueSnippets: null,
      structuredData: null,
      ocrConfidence: null,
    };
  }

  return buildImageFallbackAnalysis(candidate);
}

function parseImageAnalysisResponse(
  result: { output?: unknown; text?: string },
  candidate: ImageCandidate,
): ImageAnalysis {
  // result.output is a lazy getter that throws NoOutputGeneratedError when the
  // model did not return structured output (e.g. Snowflake falling back to text).
  // Read it safely so we can still attempt the text-based fallbacks below.
  let outputValue: unknown;
  try {
    outputValue = result.output;
  } catch {
    outputValue = undefined;
  }

  const structured =
    IMAGE_ANALYSIS_OUTPUT_RUNTIME_SCHEMA.safeParse(outputValue);
  if (structured.success) {
    return buildStructuredImageAnalysis(structured.data, candidate);
  }

  const text = typeof result.text === "string" ? result.text.trim() : "";
  if (!text) {
    return buildImageFallbackAnalysis(candidate);
  }

  try {
    const parsedJson = JSON.parse(text);
    const structuredFromJson =
      IMAGE_ANALYSIS_OUTPUT_RUNTIME_SCHEMA.safeParse(parsedJson);
    if (structuredFromJson.success) {
      return buildStructuredImageAnalysis(structuredFromJson.data, candidate);
    }
  } catch {
    // fall through to legacy plain-text parsing
  }

  return parseLegacyImageAnalysisText(text, candidate);
}

function buildImageCandidateFingerprint(candidate: ImageCandidate): string {
  const hash = createHash("sha1");
  if (candidate.buffer?.length) {
    hash.update(candidate.buffer);
  } else {
    hash.update(candidate.sourceUrl ?? "");
  }
  hash.update(
    `:${candidate.pageNumber ?? ""}:${candidate.width ?? ""}:${candidate.height ?? ""}`,
  );
  return hash.digest("hex");
}

function normalizeImageAnalysisSignature(analysis: ImageAnalysis): string {
  return [
    cleanInlineText(analysis.label).toLowerCase(),
    cleanInlineText(analysis.description).toLowerCase(),
    cleanInlineText(analysis.ocrText).toLowerCase(),
    ...(analysis.exactValueSnippets ?? []).map((entry) =>
      cleanInlineText(entry).toLowerCase(),
    ),
  ].join("|");
}

function ensureDistinctImageAnalyses(
  candidates: ImageCandidate[],
  analyses: ImageAnalysis[],
): ImageAnalysis[] {
  const seen = new Map<string, { fingerprint: string; index: number }>();

  return analyses.map((analysis, index) => {
    const candidate = candidates[index];
    const signature = normalizeImageAnalysisSignature(analysis);
    const fingerprint = buildImageCandidateFingerprint(candidate);
    const existing = seen.get(signature);

    if (!existing) {
      seen.set(signature, { fingerprint, index });
      return analysis;
    }

    if (existing.fingerprint === fingerprint) {
      return analysis;
    }

    const fallback = buildImageFallbackAnalysis(candidate, {
      includeIdentity: true,
    });
    seen.set(normalizeImageAnalysisSignature(fallback), {
      fingerprint,
      index,
    });
    return fallback;
  });
}

function extractNearestStepHint(
  lines: string[],
  markerLineIndex: number,
): string {
  const candidates: string[] = [];

  for (
    let index = Math.max(0, markerLineIndex - 3);
    index <= Math.min(lines.length - 1, markerLineIndex + 3);
    index += 1
  ) {
    if (index === markerLineIndex) continue;
    const line = cleanInlineText(lines[index]);
    if (!line) continue;
    if (/^#{1,6}\s+/.test(line)) continue;
    if (/^(CTX_IMAGE_\d+|\[image\s+\d+\])$/i.test(line)) continue;
    if (/^(Label|Description|Step)\s*:/i.test(line)) continue;
    candidates.push(line);
  }

  const stepped =
    candidates.find((line) =>
      /^(\d+[.)]\s+|[-*+]\s+|\[[ xX]\]\s+)/.test(line),
    ) ?? candidates[0];

  return stepped ? clipText(stepped, 180) : "";
}

export function resolveContextImageLocations(
  markdown: string,
  images: ProcessedDocumentImage[] | undefined,
): ProcessedDocumentImage[] {
  if (!images?.length) return images ?? [];

  const lines = markdown.split("\n");
  const headingStack: Array<{ level: number; text: string }> = [];
  const markerContext = new Map<string, ResolvedImageContext>();
  let inCodeFence = false;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      return;
    }
    if (!inCodeFence) {
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = cleanInlineText(headingMatch[2]);
        while (
          headingStack.length > 0 &&
          headingStack[headingStack.length - 1].level >= level
        ) {
          headingStack.pop();
        }
        headingStack.push({ level, text });
      }
    }

    const markerMatch = trimmed.match(/^(CTX_IMAGE_\d+)$/);
    if (!markerMatch) return;

    markerContext.set(markerMatch[1], {
      headingPath: headingStack.map((entry) => entry.text).join(" > ") || null,
      stepHint: extractNearestStepHint(lines, index) || null,
    });
  });

  return images.map((image) => {
    const resolved = markerContext.get(image.marker);
    return resolved
      ? {
          ...image,
          headingPath: image.headingPath ?? resolved.headingPath ?? null,
          stepHint: image.stepHint ?? resolved.stepHint ?? null,
        }
      : image;
  });
}

async function analyzeImageCandidate(
  candidate: ImageCandidate,
  options: DocumentProcessingOptions,
  resolvedModel: ResolvedImageAnalysisModel | null,
): Promise<ImageAnalysis> {
  const imageAnalysisRequired = options.imageAnalysisRequired === true;
  const imageMode = normalizeImageMode(options.imageMode);
  if (imageMode === "off") {
    return buildImageFallbackAnalysis(candidate);
  }

  const analysisDetail = resolveImageAnalysisDetail(candidate, imageMode);
  const hasImagePayload =
    Boolean(candidate.buffer) &&
    (candidate.mediaType?.startsWith("image/") ?? true);

  if (!resolvedModel) {
    if (imageAnalysisRequired) {
      throw new Error(
        "Knowledge image model is required for image analysis but is not configured or enabled",
      );
    }
    return buildImageFallbackAnalysis(candidate);
  }

  if (!hasImagePayload) {
    if (imageAnalysisRequired) {
      throw new Error(
        "Document image analysis requires extracted image bytes and an image media type",
      );
    }
    return buildImageFallbackAnalysis(candidate);
  }

  if (!imageAnalysisRequired && resolvedModel.supportsImageInput === false) {
    return buildImageFallbackAnalysis(candidate);
  }

  try {
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image"; image: Buffer; mediaType?: string }
    > = [
      {
        type: "text",
        text: buildImageAnalysisPrompt(candidate, options.documentTitle, {
          neighborContextEnabled: options.imageNeighborContextEnabled,
          detail: analysisDetail,
        }),
      },
    ];

    content.push({
      type: "image",
      image: candidate.buffer as Buffer,
      ...(candidate.mediaType ? { mediaType: candidate.mediaType } : {}),
    });

    const result = await generateText({
      model: resolvedModel.model,
      system: IMAGE_ANALYSIS_SYSTEM_PROMPT,
      output: Output.object({
        schema: IMAGE_ANALYSIS_OUTPUT_SCHEMA,
        name: "knowledge_image_analysis",
        description:
          "Structured OCR and caption analysis for a single knowledge image.",
      }),
      messages: [{ role: "user", content }],
      temperature: 0,
    });

    return parseImageAnalysisResponse(
      result as { output?: unknown; text?: string },
      candidate,
    );
  } catch (error) {
    if (imageAnalysisRequired) {
      throw error instanceof Error
        ? error
        : new Error("Document image analysis failed");
    }
    console.warn(
      `[ContextX] Failed to analyze image ${candidate.index} for "${options.documentTitle ?? "Untitled"}":`,
      error,
    );
    return buildImageFallbackAnalysis(candidate);
  }
}

async function processInBatches<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const current = nextIndex++;
        results[current] = await fn(items[current]);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

export function createContextImageMarker(index: number): string {
  return `${IMAGE_MARKER_PREFIX}${index}`;
}

export function buildContextImageMarkdownBlock(
  index: number,
  description: string,
  options: {
    label?: string | null;
    stepHint?: string | null;
  } = {},
): string {
  const lines = [`[image ${index}]`];
  if (options.label) {
    lines.push(`Label : ${normalizeGeneratedLabel(options.label)}`);
  }
  lines.push(`Description : ${normalizeGeneratedDescription(description)}`);
  if (options.stepHint) {
    lines.push(`Step : ${cleanInlineText(options.stepHint)}`);
  }
  return lines.join("\n");
}

export function applyContextImageBlocks(
  markdown: string,
  imageBlocks: ContextImageBlock[] | undefined,
): string {
  if (!imageBlocks?.length) return markdown;

  let result = markdown;
  const missingBlocks: string[] = [];

  for (const block of imageBlocks) {
    const markerPattern = new RegExp(
      `\\s*${escapeRegExp(block.marker)}\\s*`,
      "g",
    );
    if (result.includes(block.marker)) {
      result = result.replace(markerPattern, `\n\n${block.markdown}\n\n`);
    } else {
      missingBlocks.push(block.markdown);
    }
  }

  if (missingBlocks.length > 0) {
    result = `${result.trim()}\n\n${missingBlocks.join("\n\n")}`;
  }

  return result.replace(/\n{3,}/g, "\n\n").trim();
}

export async function generateContextImageBlocks(
  candidates: ProcessedDocumentImage[],
): Promise<ContextImageBlock[]> {
  if (candidates.length === 0) return [];

  return candidates.map((candidate) => ({
    marker: candidate.marker,
    index: candidate.index,
    markdown: buildContextImageMarkdownBlock(
      candidate.index,
      candidate.description,
      {
        label: candidate.label,
        stepHint: candidate.stepHint,
      },
    ),
  }));
}

export async function generateContextImageArtifacts(
  candidates: ImageCandidate[],
  options: DocumentProcessingOptions,
): Promise<ProcessedDocumentImage[]> {
  if (candidates.length === 0) return [];

  const normalizedCandidates = await Promise.all(
    candidates.map((candidate) => normalizeImageCandidate(candidate)),
  );

  const imageMode = normalizeImageMode(options.imageMode);
  const resolvedModel =
    imageMode === "off"
      ? null
      : await resolveImageAnalysisModel(options.imageAnalysis);
  if (options.imageAnalysisRequired && imageMode !== "off" && !resolvedModel) {
    throw new Error(
      "Knowledge image model is required for image analysis but is not configured or enabled",
    );
  }
  const analyses = await processInBatches(
    normalizedCandidates,
    IMAGE_ANALYSIS_CONCURRENCY,
    (candidate) => analyzeImageCandidate(candidate, options, resolvedModel),
  );
  const distinctAnalyses = ensureDistinctImageAnalyses(
    normalizedCandidates,
    analyses,
  );

  return distinctAnalyses.map((analysis, index) => ({
    kind: "embedded",
    marker: normalizedCandidates[index].marker,
    index: normalizedCandidates[index].index,
    buffer: normalizedCandidates[index].buffer ?? null,
    mediaType: normalizedCandidates[index].mediaType ?? null,
    sourceUrl: normalizedCandidates[index].sourceUrl ?? null,
    pageNumber: normalizedCandidates[index].pageNumber ?? null,
    width: normalizedCandidates[index].width ?? null,
    height: normalizedCandidates[index].height ?? null,
    altText: normalizedCandidates[index].altText ?? null,
    caption: normalizedCandidates[index].caption ?? null,
    surroundingText: normalizedCandidates[index].surroundingText ?? null,
    precedingText: normalizedCandidates[index].precedingText ?? null,
    followingText: normalizedCandidates[index].followingText ?? null,
    imageType: analysis.imageType ?? null,
    ocrText: analysis.ocrText ?? null,
    ocrConfidence: analysis.ocrConfidence ?? null,
    exactValueSnippets: analysis.exactValueSnippets ?? null,
    structuredData: analysis.structuredData ?? null,
    label: analysis.label,
    description: analysis.description,
    anchor: normalizedCandidates[index].anchor ?? null,
    headingPath: null,
    stepHint: null,
    isRenderable: Boolean(
      normalizedCandidates[index].sourceUrl ||
        (normalizedCandidates[index].buffer &&
          normalizedCandidates[index].mediaType),
    ),
    manualLabel: false,
    manualDescription: false,
  }));
}

export async function convertHtmlFragmentToProcessedDocument(
  html: string,
  options: HtmlConversionOptions = {},
): Promise<ProcessedDocument> {
  const $ = cheerio.load(html);
  const imageNodes = $("img").toArray();

  if (imageNodes.length === 0) {
    return { markdown: turndown.turndown(html) };
  }

  const candidates: ImageCandidate[] = [];
  let imageIndex = 1;

  for (const imageNode of imageNodes) {
    const $img = $(imageNode);
    const context = extractHtmlImageContext($img);

    if (isProbablyDecorativeHtmlImage($img, context.altText ?? "")) {
      $img.remove();
      continue;
    }

    const marker = createContextImageMarker(imageIndex);
    const { buffer, mediaType, sourceUrl } = await loadImageSource(
      $img.attr("src"),
      options.baseUrl,
    );
    const width = Number.parseInt($img.attr("width") ?? "", 10);
    const height = Number.parseInt($img.attr("height") ?? "", 10);

    candidates.push({
      index: imageIndex,
      marker,
      buffer,
      mediaType,
      sourceUrl,
      altText: context.altText,
      caption: context.caption,
      surroundingText: context.surroundingText,
      precedingText: context.precedingText,
      followingText: context.followingText,
      width: Number.isFinite(width) ? width : null,
      height: Number.isFinite(height) ? height : null,
      anchor: {
        blockIndex: imageIndex - 1,
        placement: "after",
        source: "dom",
        confidence: 1,
      },
    });

    $img.replaceWith(` ${marker} `);
    imageIndex += 1;
  }

  const markdown = turndown.turndown(
    $("body").html() ?? $.root().html() ?? html,
  );
  const images = await generateContextImageArtifacts(candidates, options);
  const imageBlocks = await generateContextImageBlocks(images);

  return {
    markdown,
    imageBlocks,
    images,
  };
}

export type { ImageCandidate };
