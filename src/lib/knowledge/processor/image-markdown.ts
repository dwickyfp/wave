import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { LanguageModel, generateText } from "ai";
import { createModelFromConfig } from "lib/ai/provider-factory";
import { settingsRepository } from "lib/db/repository";
import { optimizeKnowledgeImageBuffer } from "./image-optimization";
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
- If the image is a photo or object image, identify the main subjects, actions, environment, notable text, and distinctive details
- If the image is a UI screenshot, identify the product/page, visible sections, controls, labels, statuses, and any important numbers or messages
- Return exactly two lines in plain text:
Label: <short specific label, 4-12 words>
Description: <1-3 sentences about this exact image>`;

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

type ImageAnalysis = {
  label: string;
  description: string;
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
    const response = await fetch(resolvedUrl, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const mediaType = response.headers.get("content-type");
    const buffer = Buffer.from(await response.arrayBuffer());
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

function buildImageFallbackAnalysis(
  candidate: ImageCandidate,
  options: { includeIdentity?: boolean } = {},
): ImageAnalysis {
  let description = buildImageFallbackDescription(candidate);
  if (options.includeIdentity) {
    description = `${description} Extracted image index: ${candidate.index}.`;
  }

  return {
    label: buildImageFallbackLabel(candidate),
    description,
  };
}

function buildImageAnalysisPrompt(
  candidate: ImageCandidate,
  documentTitle?: string,
  options: { neighborContextEnabled?: boolean } = {},
): string {
  const neighborContextEnabled = options.neighborContextEnabled !== false;
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
    neighborContextEnabled
      ? "If the before/after text materially disambiguates the image, add at most one short context sentence to the description."
      : "Do not add context sentences from nearby document text unless they are directly visible in the image.",
    "Keep the label image-focused and keep the description primarily about what is visible.",
    "Return exactly two lines:",
    "Label: ...",
    "Description: ...",
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

function parseImageAnalysisResponse(
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
      label: shortenLabel(label),
      description,
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
      label: shortenLabel(inferredLabel),
      description: inferredDescription,
    };
  }

  if (inferredDescription) {
    return {
      label: deriveImageLabel(candidate, inferredDescription),
      description: inferredDescription,
    };
  }

  return buildImageFallbackAnalysis(candidate);
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
  return `${cleanInlineText(analysis.label).toLowerCase()}|${cleanInlineText(
    analysis.description,
  ).toLowerCase()}`;
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
        }),
      },
    ];

    content.push({
      type: "image",
      image: candidate.buffer as Buffer,
      ...(candidate.mediaType ? { mediaType: candidate.mediaType } : {}),
    });

    const { text } = await generateText({
      model: resolvedModel.model,
      system: IMAGE_ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
      temperature: 0,
    });

    return parseImageAnalysisResponse(text, candidate);
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

  const resolvedModel = await resolveImageAnalysisModel(options.imageAnalysis);
  if (options.imageAnalysisRequired && !resolvedModel) {
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
