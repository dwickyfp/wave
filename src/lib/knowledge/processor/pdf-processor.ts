import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  assessExtractedPageQuality,
  formatExtractedPageToMarkdown,
} from "../document-quality";
import { createPageMarker } from "../page-markers";
import {
  createContextImageMarker,
  generateContextImageArtifacts,
  generateContextImageBlocks,
  type ImageCandidate,
} from "./image-markdown";
import type {
  DocumentProcessingOptions,
  ProcessedDocument,
  ProcessedDocumentPage,
  ProcessedImageAnchor,
} from "./types";

const _require = createRequire(import.meta.url);
const { PDFParse } = _require("pdf-parse") as {
  PDFParse: new (opts: { data: Uint8Array }) => {
    getImage(opts?: {
      imageThreshold?: number;
    }): Promise<{
      pages: Array<{
        pageNumber: number;
        images: Array<{
          data: Uint8Array;
          name: string;
          width: number;
          height: number;
          dataUrl?: string;
        }>;
      }>;
    }>;
    destroy(): Promise<void>;
  };
};

type PdfImageExtractionResult = {
  pages: Array<{
    pageNumber: number;
    images: Array<{
      data: Uint8Array;
      name: string;
      width: number;
      height: number;
      dataUrl?: string;
    }>;
  }>;
};

const PDF_OP_SAVE = 10;
const PDF_OP_RESTORE = 11;
const PDF_OP_TRANSFORM = 12;
const PDF_OP_PAINT_IMAGE_XOBJECT = 85;
const PDF_OP_PAINT_INLINE_IMAGE_XOBJECT = 86;

type PdfPageProxy = {
  getTextContent(args: {
    includeMarkedContent?: boolean;
    disableNormalization?: boolean;
  }): Promise<{ items: Array<Record<string, unknown>> }>;
  getViewport(args: { scale: number }): {
    transform: number[];
    convertToViewportPoint: (x: number, y: number) => [number, number];
    width?: number;
    height?: number;
  };
  getOperatorList(): Promise<{
    fnArray: number[];
    argsArray: Array<unknown[]>;
  }>;
  cleanup(): void;
};

type PdfDocumentProxy = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageProxy>;
};

type PdfLine = {
  text: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  breakBefore: boolean;
};

type PdfImagePlacement = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type PdfImageSelectionInput = {
  lines: PdfLine[];
  placement: PdfImagePlacement | null;
  pageWidth: number | null;
  pageHeight: number | null;
  imageWidth: number;
  imageHeight: number;
};

function multiplyTransform(a: number[], b: number[]) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function transformPoint(matrix: number[], x: number, y: number) {
  return [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5],
  ] as const;
}

function cleanPdfText(value: string) {
  return value
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

function looksLikeCaption(text: string) {
  const cleaned = cleanPdfText(text);
  if (!cleaned) return false;
  return (
    /^(figure|fig\.?|table|exhibit|chart|diagram|illustration)\b/i.test(
      cleaned,
    ) || cleaned.length <= 120
  );
}

function buildAnchorSnippet(lines: PdfLine[], lineIndex: number | null) {
  if (lineIndex === null || lineIndex < 0 || lineIndex >= lines.length) {
    return null;
  }

  return lines
    .slice(Math.max(0, lineIndex - 1), Math.min(lines.length, lineIndex + 2))
    .map((line) => cleanPdfText(line.text))
    .filter(Boolean)
    .join(" ")
    .trim();
}

function placementOverlapsLine(line: PdfLine, placement: PdfImagePlacement) {
  return !(
    line.xMax < placement.left ||
    line.xMin > placement.right ||
    line.yMax < placement.top ||
    line.yMin > placement.bottom
  );
}

function hasNearbyCaption(lines: PdfLine[], placement: PdfImagePlacement) {
  return lines.some(
    (line) =>
      line.yMin >= placement.bottom - 4 &&
      line.yMin - placement.bottom <= 48 &&
      looksLikeCaption(line.text),
  );
}

export function shouldKeepPdfImageCandidate(
  input: PdfImageSelectionInput,
): boolean {
  if (input.imageWidth * input.imageHeight < 2_500) {
    return false;
  }

  if (!input.placement) {
    return true;
  }

  const placementWidth = Math.max(
    0,
    input.placement.right - input.placement.left,
  );
  const placementHeight = Math.max(
    0,
    input.placement.bottom - input.placement.top,
  );

  if (placementWidth < 40 || placementHeight < 40) {
    return false;
  }

  const pageWidth =
    input.pageWidth && Number.isFinite(input.pageWidth)
      ? Math.abs(input.pageWidth)
      : null;
  const pageHeight =
    input.pageHeight && Number.isFinite(input.pageHeight)
      ? Math.abs(input.pageHeight)
      : null;
  const hasCaption = hasNearbyCaption(input.lines, input.placement);

  if (pageWidth && pageHeight) {
    const isThinHorizontalStrip =
      placementWidth >= pageWidth * 0.75 &&
      placementHeight <= Math.max(36, pageHeight * 0.08);
    const isThinVerticalStrip =
      placementHeight >= pageHeight * 0.75 &&
      placementWidth <= Math.max(36, pageWidth * 0.08);

    if (isThinHorizontalStrip || isThinVerticalStrip) {
      return false;
    }

    const coverage =
      (placementWidth * placementHeight) / (pageWidth * pageHeight);
    if (coverage >= 0.72) {
      return false;
    }

    const overlappingLines = input.lines.filter((line) =>
      placementOverlapsLine(line, input.placement as PdfImagePlacement),
    ).length;
    const overlapRatio =
      input.lines.length > 0 ? overlappingLines / input.lines.length : 0;

    if (
      !hasCaption &&
      coverage >= 0.38 &&
      (overlapRatio >= 0.35 || input.lines.length >= 8)
    ) {
      return false;
    }

    if (!hasCaption && coverage >= 0.2 && overlapRatio >= 0.72) {
      return false;
    }
  }

  return true;
}

async function extractPdfLines(page: PdfPageProxy): Promise<PdfLine[]> {
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent({
    includeMarkedContent: false,
    disableNormalization: false,
  });

  const lines: PdfLine[] = [];
  let currentParts: string[] = [];
  let currentXMin = Number.POSITIVE_INFINITY;
  let currentXMax = Number.NEGATIVE_INFINITY;
  let currentYMin = Number.POSITIVE_INFINITY;
  let currentYMax = Number.NEGATIVE_INFINITY;
  let pendingBreakBefore = false;
  let lastX: number | undefined;
  let lastY: number | undefined;
  let lineHeight = 0;

  const flushLine = () => {
    const text = cleanPdfText(currentParts.join(""));
    if (!text) {
      currentParts = [];
      currentXMin = Number.POSITIVE_INFINITY;
      currentXMax = Number.NEGATIVE_INFINITY;
      currentYMin = Number.POSITIVE_INFINITY;
      currentYMax = Number.NEGATIVE_INFINITY;
      return;
    }

    lines.push({
      text,
      xMin: Number.isFinite(currentXMin) ? currentXMin : 0,
      xMax: Number.isFinite(currentXMax) ? currentXMax : 0,
      yMin: Number.isFinite(currentYMin) ? currentYMin : 0,
      yMax: Number.isFinite(currentYMax) ? currentYMax : 0,
      breakBefore: pendingBreakBefore,
    });
    currentParts = [];
    currentXMin = Number.POSITIVE_INFINITY;
    currentXMax = Number.NEGATIVE_INFINITY;
    currentYMin = Number.POSITIVE_INFINITY;
    currentYMax = Number.NEGATIVE_INFINITY;
    pendingBreakBefore = false;
  };

  for (const item of textContent.items) {
    if (!("str" in item)) continue;
    const str = typeof item.str === "string" ? item.str : "";
    if (!str.trim()) continue;

    const transform = Array.isArray(item.transform)
      ? (item.transform as number[])
      : [1, 0, 0, 1, 0, 0];
    const [x, y] = viewport.convertToViewportPoint(
      transform[4] ?? 0,
      transform[5] ?? 0,
    );
    const width =
      typeof item.width === "number" && Number.isFinite(item.width)
        ? item.width
        : 0;
    const height =
      typeof item.height === "number" && Number.isFinite(item.height)
        ? item.height
        : 0;

    if (lastY !== undefined && Math.abs(lastY - y) > 4.6) {
      pendingBreakBefore =
        Math.abs(lastY - y) - 1 > Math.max(lineHeight, 10) * 1.2;
      flushLine();
      lastX = undefined;
      lineHeight = 0;
    }

    let part = str;
    if (
      lastX !== undefined &&
      lastY !== undefined &&
      Math.abs(lastY - y) <= 4.6 &&
      Math.abs(lastX - x) > 7
    ) {
      part = ` ${part}`;
    }

    currentParts.push(part);
    currentXMin = Math.min(currentXMin, x);
    currentXMax = Math.max(currentXMax, x + width);
    currentYMin = Math.min(currentYMin, y);
    currentYMax = Math.max(currentYMax, y + height);
    lastX = x + width;
    lastY = y;
    lineHeight = Math.max(lineHeight, height);

    if (item.hasEOL === true || str.endsWith("\n")) {
      flushLine();
      lastX = undefined;
      lineHeight = 0;
    }
  }

  flushLine();
  return lines;
}

async function extractPdfImagePlacements(
  page: PdfPageProxy,
  pageImages: Array<{ name: string }>,
): Promise<Map<string, PdfImagePlacement[]>> {
  const trackedNames = new Set(pageImages.map((image) => image.name));
  if (trackedNames.size === 0) {
    return new Map();
  }

  const viewport = page.getViewport({ scale: 1 });
  const operatorList = await page.getOperatorList();
  const placements = new Map<string, PdfImagePlacement[]>();
  let transformMatrix = [1, 0, 0, 1, 0, 0];
  const transformStack: number[][] = [];

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index];
    const args = operatorList.argsArray[index] ?? [];

    if (fn === PDF_OP_SAVE) {
      transformStack.push([...transformMatrix]);
      continue;
    }

    if (fn === PDF_OP_RESTORE) {
      transformMatrix = transformStack.pop() ?? [1, 0, 0, 1, 0, 0];
      continue;
    }

    if (fn === PDF_OP_TRANSFORM && args.length >= 6) {
      transformMatrix = multiplyTransform(
        transformMatrix,
        args.slice(0, 6).map((value) => Number(value)),
      );
      continue;
    }

    if (
      fn !== PDF_OP_PAINT_IMAGE_XOBJECT &&
      fn !== PDF_OP_PAINT_INLINE_IMAGE_XOBJECT
    ) {
      continue;
    }

    const imageName =
      typeof args[0] === "string" && trackedNames.has(args[0]) ? args[0] : null;
    if (!imageName) {
      continue;
    }

    const combined = multiplyTransform(viewport.transform, transformMatrix);
    const corners = [
      transformPoint(combined, 0, 0),
      transformPoint(combined, 1, 0),
      transformPoint(combined, 0, 1),
      transformPoint(combined, 1, 1),
    ];
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);

    const placement: PdfImagePlacement = {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
    };

    const entries = placements.get(imageName) ?? [];
    entries.push(placement);
    placements.set(imageName, entries);
  }

  return placements;
}

export function selectImageAnchor(
  lines: PdfLine[],
  pageNumber: number,
  placement: PdfImagePlacement | null,
): ProcessedImageAnchor {
  if (lines.length === 0) {
    return {
      pageNumber,
      blockIndex: null,
      anchorText: null,
      precedingText: null,
      followingText: null,
      placement: "after",
      source: "page-fallback",
      confidence: 0.2,
    };
  }

  if (!placement) {
    const lastIndex = Math.max(0, lines.length - 1);
    return {
      pageNumber,
      blockIndex: lastIndex,
      anchorText: lines[lastIndex]?.text ?? null,
      precedingText: lines[lastIndex]?.text ?? null,
      followingText: null,
      placement: "after",
      source: "page-fallback",
      confidence: 0.3,
    };
  }

  const sameColumnLines = lines
    .map((line, index) => ({
      index,
      line,
      overlaps:
        Math.min(line.xMax, placement.right) -
        Math.max(line.xMin, placement.left),
    }))
    .filter((entry) => entry.overlaps >= -40);

  const searchLines =
    sameColumnLines.length > 0
      ? sameColumnLines
      : lines.map((line, index) => ({ index, line, overlaps: -100 }));

  const captionCandidate = searchLines.find(
    ({ line }) =>
      line.yMin >= placement.bottom - 4 &&
      line.yMin - placement.bottom <= 40 &&
      looksLikeCaption(line.text),
  );
  if (captionCandidate) {
    return {
      pageNumber,
      blockIndex: captionCandidate.index,
      anchorText: captionCandidate.line.text,
      precedingText: captionCandidate.line.text,
      followingText: lines[captionCandidate.index + 1]?.text ?? null,
      placement: "after",
      source: "caption",
      confidence: 0.95,
    };
  }

  const preceding = [...searchLines]
    .filter(({ line }) => line.yMax <= placement.top + 8)
    .sort((a, b) => b.line.yMax - a.line.yMax)[0];
  if (preceding) {
    return {
      pageNumber,
      blockIndex: preceding.index,
      anchorText: preceding.line.text,
      precedingText: preceding.line.text,
      followingText: lines[preceding.index + 1]?.text ?? null,
      placement: "after",
      source: "pdf-layout",
      confidence: 0.8,
    };
  }

  const following = searchLines
    .filter(({ line }) => line.yMin >= placement.bottom - 8)
    .sort((a, b) => a.line.yMin - b.line.yMin)[0];
  if (following) {
    return {
      pageNumber,
      blockIndex: following.index,
      anchorText: following.line.text,
      precedingText: lines[Math.max(0, following.index - 1)]?.text ?? null,
      followingText: following.line.text,
      placement: "before",
      source: "pdf-layout",
      confidence: 0.7,
    };
  }

  const lastIndex = Math.max(0, lines.length - 1);
  return {
    pageNumber,
    blockIndex: lastIndex,
    anchorText: lines[lastIndex]?.text ?? null,
    precedingText: lines[lastIndex]?.text ?? null,
    followingText: null,
    placement: "after",
    source: "page-fallback",
    confidence: 0.4,
  };
}

export function composePageText(
  lines: PdfLine[],
  imageMarkers: Array<{ marker: string; anchor: ProcessedImageAnchor }>,
) {
  if (lines.length === 0) {
    return imageMarkers
      .map((entry) => entry.marker)
      .join("\n\n")
      .trim();
  }

  const markersBefore = new Map<number, string[]>();
  const markersAfter = new Map<number, string[]>();

  for (const entry of imageMarkers) {
    const lineIndex = Math.max(
      0,
      Math.min(entry.anchor.blockIndex ?? lines.length - 1, lines.length - 1),
    );
    const targetMap =
      entry.anchor.placement === "before" ? markersBefore : markersAfter;
    const markers = targetMap.get(lineIndex) ?? [];
    markers.push(entry.marker);
    targetMap.set(lineIndex, markers);
  }

  const output: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.breakBefore && output[output.length - 1] !== "") {
      output.push("");
    }

    const before = markersBefore.get(index) ?? [];
    for (const marker of before) {
      if (output[output.length - 1] !== "") {
        output.push("");
      }
      output.push(marker);
      output.push("");
    }

    output.push(line.text);

    const after = markersAfter.get(index) ?? [];
    for (const marker of after) {
      output.push("");
      output.push(marker);
      output.push("");
    }
  }

  return output
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdfImagesSafely(parser: {
  getImage(opts?: {
    imageThreshold?: number;
  }): Promise<PdfImageExtractionResult>;
}): Promise<PdfImageExtractionResult> {
  try {
    return await parser.getImage({ imageThreshold: 80 });
  } catch (error) {
    console.warn(
      "[ContextX] Failed to extract embedded PDF images; continuing with text-only PDF ingestion:",
      error,
    );
    return { pages: [] };
  }
}

export async function processPdf(
  buffer: Buffer,
  options: DocumentProcessingOptions = {},
): Promise<ProcessedDocument> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    const loadedDocument = await (
      parser as unknown as {
        load(): Promise<PdfDocumentProxy>;
      }
    ).load();
    const imageResult = await extractPdfImagesSafely(parser);
    const imagesByPage = new Map(
      imageResult.pages.map((page) => [page.pageNumber, page.images] as const),
    );

    let imageIndex = 1;
    const imageCandidates: ImageCandidate[] = [];
    const output: string[] = [];
    const pages: ProcessedDocumentPage[] = [];

    for (
      let pageNumber = 1;
      pageNumber <= loadedDocument.numPages;
      pageNumber += 1
    ) {
      const page = await loadedDocument.getPage(pageNumber);
      try {
        const lines = await extractPdfLines(page);
        const viewport = page.getViewport({ scale: 1 });
        const pageImages = imagesByPage.get(pageNumber) ?? [];
        const placementsByName = await extractPdfImagePlacements(
          page,
          pageImages,
        );
        const pageMarkers: Array<{
          marker: string;
          anchor: ProcessedImageAnchor;
        }> = [];

        for (const image of pageImages) {
          const placements = placementsByName.get(image.name) ?? [];
          const placement = placements.shift() ?? null;
          if (
            !shouldKeepPdfImageCandidate({
              lines,
              placement,
              pageWidth:
                typeof viewport.width === "number" ? viewport.width : null,
              pageHeight:
                typeof viewport.height === "number" ? viewport.height : null,
              imageWidth: image.width,
              imageHeight: image.height,
            })
          ) {
            continue;
          }

          const marker = createContextImageMarker(imageIndex);
          const anchor = selectImageAnchor(lines, pageNumber, placement);
          const anchorSnippet = buildAnchorSnippet(
            lines,
            anchor.blockIndex ?? null,
          );

          imageCandidates.push({
            index: imageIndex,
            marker,
            buffer: Buffer.from(image.data),
            mediaType:
              image.dataUrl?.match(/^data:([^;]+);/i)?.[1] ?? "image/png",
            caption:
              anchor.source === "caption" ? (anchor.anchorText ?? null) : null,
            pageNumber,
            surroundingText: anchorSnippet,
            precedingText: anchor.precedingText ?? null,
            followingText: anchor.followingText ?? null,
            width: image.width,
            height: image.height,
            anchor,
          });
          pageMarkers.push({ marker, anchor });
          imageIndex += 1;
        }

        const pageRawText = composePageText(lines, pageMarkers);
        const pageMarkdown = formatExtractedPageToMarkdown(pageRawText);
        const pageQuality = assessExtractedPageQuality(
          pageRawText,
          pageMarkdown,
        );

        pages.push({
          pageNumber,
          rawText: pageRawText,
          normalizedText: pageMarkdown,
          markdown: pageMarkdown,
          fingerprint: createHash("sha1")
            .update(pageRawText)
            .update(`:${pageNumber}`)
            .digest("hex"),
          qualityScore: pageQuality.score,
          extractionMode: "normalized",
          repairReason: pageQuality.reasons.join(", ") || null,
        });

        output.push(createPageMarker(pageNumber));
        if (pageMarkdown) {
          output.push(pageMarkdown);
        }
      } finally {
        page.cleanup();
      }
    }

    const images = await generateContextImageArtifacts(
      imageCandidates,
      options,
    );
    const imageBlocks = await generateContextImageBlocks(images);

    return {
      markdown: output.join("\n\n").trim(),
      pages,
      imageBlocks,
      images,
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}
