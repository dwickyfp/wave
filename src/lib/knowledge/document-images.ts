import type {
  KnowledgeDocumentImage,
  KnowledgeImageChartData,
  KnowledgeDocumentImagePreview,
  KnowledgeImageStructuredData,
  KnowledgeImageTableData,
} from "app-types/knowledge";

function cleanInlineText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clipText(value: string | null | undefined, maxChars: number): string {
  const cleaned = cleanInlineText(value);
  if (cleaned.length <= maxChars) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxChars).trim()}...`;
}

export function sanitizeImageStepHint(
  value: string | null | undefined,
): string | null {
  const cleaned = cleanInlineText(value);
  if (!cleaned) return null;
  if (/^(CTX_IMAGE_\d+|\[image\s+\d+\])$/i.test(cleaned)) {
    return null;
  }
  return cleaned;
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

function formatChartData(chartData?: KnowledgeImageChartData | null): string {
  if (!chartData) return "";

  const series = (chartData.series ?? [])
    .slice(0, 4)
    .map((entry) => {
      const values = (entry.values ?? []).slice(0, 6).join(", ");
      return values
        ? `${cleanInlineText(entry.name)}: ${cleanInlineText(values)}`
        : cleanInlineText(entry.name);
    })
    .filter(Boolean)
    .join(" | ");

  return [
    chartData.chartType
      ? `Chart type: ${cleanInlineText(chartData.chartType)}`
      : "",
    chartData.title ? `Chart title: ${cleanInlineText(chartData.title)}` : "",
    chartData.xAxisLabel
      ? `X axis: ${cleanInlineText(chartData.xAxisLabel)}`
      : "",
    chartData.yAxisLabel
      ? `Y axis: ${cleanInlineText(chartData.yAxisLabel)}`
      : "",
    chartData.legend?.length
      ? `Legend: ${chartData.legend.map((entry) => cleanInlineText(entry)).join(", ")}`
      : "",
    chartData.units?.length
      ? `Units: ${chartData.units.map((entry) => cleanInlineText(entry)).join(", ")}`
      : "",
    series ? `Series: ${series}` : "",
    chartData.summary
      ? `Chart summary: ${cleanInlineText(chartData.summary)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatTableData(tableData?: KnowledgeImageTableData | null): string {
  if (!tableData) return "";

  const compactRows = (tableData.rows ?? [])
    .slice(0, 4)
    .map((row) =>
      row
        .map((cell) => cleanInlineText(cell))
        .filter(Boolean)
        .join(" | "),
    )
    .filter(Boolean)
    .join(" ; ");

  return [
    tableData.headers?.length
      ? `Table headers: ${tableData.headers.map((entry) => cleanInlineText(entry)).join(", ")}`
      : "",
    compactRows ? `Table rows: ${compactRows}` : "",
    tableData.summary
      ? `Table summary: ${cleanInlineText(tableData.summary)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildKnowledgeImageStructuredSummary(input: {
  imageType?: KnowledgeDocumentImage["imageType"];
  exactValueSnippets?: KnowledgeDocumentImage["exactValueSnippets"];
  ocrText?: KnowledgeDocumentImage["ocrText"];
  ocrConfidence?: KnowledgeDocumentImage["ocrConfidence"];
  structuredData?: KnowledgeImageStructuredData | null;
}): string {
  const exactValues = (input.exactValueSnippets ?? [])
    .map((entry) => cleanInlineText(entry))
    .filter(Boolean)
    .slice(0, 8);

  return [
    input.imageType ? `Image type: ${input.imageType}` : "",
    exactValues.length ? `Exact values: ${exactValues.join(" | ")}` : "",
    input.ocrText ? `OCR: ${clipText(input.ocrText, 1800)}` : "",
    input.ocrConfidence != null
      ? `OCR confidence: ${Math.max(0, Math.min(1, input.ocrConfidence)).toFixed(2)}`
      : "",
    formatChartData(input.structuredData?.chartData ?? null),
    formatTableData(input.structuredData?.tableData ?? null),
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildContextImageMarkdownBlock(
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
    const stepHint = sanitizeImageStepHint(options.stepHint);
    if (stepHint) {
      lines.push(`Step : ${stepHint}`);
    }
  }
  return lines.join("\n");
}

export function buildDocumentImageEmbeddingText(input: {
  documentTitle: string;
  image: Pick<
    KnowledgeDocumentImage,
    | "label"
    | "description"
    | "headingPath"
    | "stepHint"
    | "caption"
    | "altText"
    | "surroundingText"
    | "precedingText"
    | "followingText"
    | "imageType"
    | "ocrText"
    | "ocrConfidence"
    | "exactValueSnippets"
    | "structuredData"
    | "pageNumber"
  >;
}): string {
  const sanitizedStepHint = sanitizeImageStepHint(input.image.stepHint);
  const structuredSummary = buildKnowledgeImageStructuredSummary({
    imageType: input.image.imageType ?? null,
    ocrText: input.image.ocrText ?? null,
    ocrConfidence: input.image.ocrConfidence ?? null,
    exactValueSnippets: input.image.exactValueSnippets ?? null,
    structuredData: input.image.structuredData ?? null,
  });

  return [
    `document: ${cleanInlineText(input.documentTitle)}`,
    input.image.headingPath
      ? `heading: ${cleanInlineText(input.image.headingPath)}`
      : "",
    sanitizedStepHint ? `step: ${sanitizedStepHint}` : "",
    `label: ${cleanInlineText(input.image.label)}`,
    `description: ${cleanInlineText(input.image.description)}`,
    input.image.caption
      ? `caption: ${cleanInlineText(input.image.caption)}`
      : "",
    input.image.altText ? `alt: ${cleanInlineText(input.image.altText)}` : "",
    input.image.surroundingText
      ? `context: ${cleanInlineText(input.image.surroundingText)}`
      : "",
    input.image.precedingText
      ? `before: ${cleanInlineText(input.image.precedingText)}`
      : "",
    input.image.followingText
      ? `after: ${cleanInlineText(input.image.followingText)}`
      : "",
    structuredSummary ? structuredSummary : "",
    input.image.pageNumber != null ? `page: ${input.image.pageNumber}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function syncContextImageBlocksInMarkdown(
  markdown: string,
  images: Array<
    Pick<
      KnowledgeDocumentImage,
      "ordinal" | "label" | "description" | "stepHint"
    >
  >,
): string {
  if (!images.length) return markdown;

  const imageByOrdinal = new Map(
    images.map((image) => [image.ordinal, image] as const),
  );
  const lines = markdown.split("\n");
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].trim().match(/^\[image\s+(\d+)\]$/i);
    if (!match) {
      output.push(lines[index]);
      continue;
    }

    const ordinal = Number.parseInt(match[1], 10);
    const image = imageByOrdinal.get(ordinal);
    if (!image) {
      output.push(lines[index]);
      continue;
    }

    output.push(
      buildContextImageMarkdownBlock(ordinal, image.description, {
        label: image.label,
        stepHint: image.stepHint,
      }),
    );

    let cursor = index + 1;
    while (cursor < lines.length) {
      const trimmed = lines[cursor].trim();
      if (!trimmed) {
        cursor += 1;
        break;
      }
      if (/^(Label|Description|Step)\s*:/i.test(trimmed)) {
        cursor += 1;
        continue;
      }
      break;
    }
    index = cursor - 1;
  }

  return output
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildKnowledgeImageAssetUrl(input: {
  groupId: string;
  documentId: string;
  imageId: string;
  versionId?: string | null;
}): string {
  const query = input.versionId
    ? `?versionId=${encodeURIComponent(input.versionId)}`
    : "";
  return `/api/knowledge/${input.groupId}/documents/${input.documentId}/images/${input.imageId}/asset${query}`;
}

export function withKnowledgeImageAssetUrl(
  groupId: string,
  images: KnowledgeDocumentImage[],
): KnowledgeDocumentImagePreview[] {
  return images.map((image) => ({
    ...image,
    assetUrl: image.isRenderable
      ? buildKnowledgeImageAssetUrl({
          groupId,
          documentId: image.documentId,
          imageId: image.id,
          versionId: image.versionId ?? null,
        })
      : null,
  }));
}
