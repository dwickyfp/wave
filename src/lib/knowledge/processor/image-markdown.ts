import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { LanguageModel, generateText } from "ai";
import { createModelFromConfig } from "lib/ai/provider-factory";
import { settingsRepository } from "lib/db/repository";
import type {
  ContextImageBlock,
  DocumentProcessingOptions,
  ProcessedDocument,
} from "./types";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

const IMAGE_MARKER_PREFIX = "CTX_IMAGE_";
const IMAGE_CONTEXT_MAX_CHARS = 1_200;
const IMAGE_DESCRIPTION_CONCURRENCY = 3;

const IMAGE_DESCRIPTION_SYSTEM_PROMPT = `You describe document images for retrieval in a knowledge base.

Requirements:
- Be factual and specific
- Output plain text only, no markdown
- Mention the important visible details, not generic filler
- If the image is a chart, diagram, or table-like visual, identify the chart type, axes, labels, legend, series, units, and the main relationship or trend
- If the image is a photo or object image, identify the main subjects, actions, environment, notable text, and distinctive details
- If the image is a UI screenshot, identify the product/page, visible sections, controls, labels, statuses, and any important numbers or messages
- Use nearby document context only to disambiguate what is shown
- If something is unclear, say that directly instead of guessing
- Keep the description detailed but compact, usually 2-4 sentences`;

type ImageCandidate = {
  index: number;
  marker: string;
  buffer?: Buffer | null;
  mediaType?: string | null;
  altText?: string | null;
  caption?: string | null;
  surroundingText?: string | null;
  sourceUrl?: string | null;
  pageNumber?: number | null;
  width?: number | null;
  height?: number | null;
};

type ResolvedImageAnalysisModel = {
  model: LanguageModel;
  supportsImageInput: boolean;
};

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
): Pick<ImageCandidate, "altText" | "caption" | "surroundingText"> {
  const altText = cleanInlineText(
    $img.attr("alt") ?? $img.attr("title") ?? $img.attr("aria-label"),
  );
  const figureCaption = cleanInlineText(
    $img.closest("figure").find("figcaption").first().text(),
  );
  const parentText = extractParentTextWithoutImages($img);
  const prevText = extractSiblingText($img, "prev");
  const nextText = extractSiblingText($img, "next");
  const surroundingText = clipText(
    [figureCaption, parentText, prevText, nextText].filter(Boolean).join(" "),
    IMAGE_CONTEXT_MAX_CHARS,
  );

  return {
    altText: altText || null,
    caption: figureCaption || null,
    surroundingText: surroundingText || null,
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
    supportsImageInput: modelConfig?.supportsImageInput ?? false,
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

function buildImageDescriptionPrompt(
  candidate: ImageCandidate,
  documentTitle?: string,
): string {
  const parts = [
    documentTitle ? `Document title: ${documentTitle}` : null,
    `Image index: ${candidate.index}`,
    candidate.pageNumber != null
      ? `Page number: ${candidate.pageNumber}`
      : null,
    candidate.altText ? `Alt text: ${candidate.altText}` : null,
    candidate.caption ? `Caption: ${candidate.caption}` : null,
    candidate.width && candidate.height
      ? `Image size: ${candidate.width}x${candidate.height} pixels`
      : null,
    candidate.sourceUrl ? `Image source URL: ${candidate.sourceUrl}` : null,
    candidate.surroundingText
      ? `Nearby document context:\n${candidate.surroundingText}`
      : null,
    "",
    "Describe this image so it can be stored in markdown and later retrieved as document context.",
    "Write one compact paragraph. Output only the description.",
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

async function describeImageCandidate(
  candidate: ImageCandidate,
  options: DocumentProcessingOptions,
  resolvedModel: ResolvedImageAnalysisModel | null,
): Promise<string> {
  if (!resolvedModel) {
    return buildImageFallbackDescription(candidate);
  }

  try {
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image"; image: Buffer; mediaType?: string }
    > = [
      {
        type: "text",
        text: buildImageDescriptionPrompt(candidate, options.documentTitle),
      },
    ];

    if (
      resolvedModel.supportsImageInput &&
      candidate.buffer &&
      (candidate.mediaType?.startsWith("image/") ?? true)
    ) {
      content.push({
        type: "image",
        image: candidate.buffer,
        ...(candidate.mediaType ? { mediaType: candidate.mediaType } : {}),
      });
    }

    const { text } = await generateText({
      model: resolvedModel.model,
      system: IMAGE_DESCRIPTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
      temperature: 0,
    });

    const description = normalizeGeneratedDescription(text);
    if (!description) {
      return buildImageFallbackDescription(candidate);
    }

    return description;
  } catch (error) {
    console.warn(
      `[ContextX] Failed to describe image ${candidate.index} for "${options.documentTitle ?? "Untitled"}":`,
      error,
    );
    return buildImageFallbackDescription(candidate);
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
): string {
  return `[image ${index}]\nDescription : ${normalizeGeneratedDescription(description)}`;
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
  candidates: ImageCandidate[],
  options: DocumentProcessingOptions,
): Promise<ContextImageBlock[]> {
  if (candidates.length === 0) return [];

  const resolvedModel = await resolveImageAnalysisModel(options.imageAnalysis);
  const descriptions = await processInBatches(
    candidates,
    IMAGE_DESCRIPTION_CONCURRENCY,
    (candidate) => describeImageCandidate(candidate, options, resolvedModel),
  );

  return descriptions.map((description, index) => ({
    marker: candidates[index].marker,
    index: candidates[index].index,
    markdown: buildContextImageMarkdownBlock(
      candidates[index].index,
      description,
    ),
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
      width: Number.isFinite(width) ? width : null,
      height: Number.isFinite(height) ? height : null,
    });

    $img.replaceWith(` ${marker} `);
    imageIndex += 1;
  }

  const markdown = turndown.turndown(
    $("body").html() ?? $.root().html() ?? html,
  );
  const imageBlocks = await generateContextImageBlocks(candidates, options);

  return {
    markdown,
    imageBlocks,
  };
}

export type { ImageCandidate };
