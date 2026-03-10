import type {
  KnowledgeDocumentImage,
  KnowledgeDocumentImagePreview,
} from "app-types/knowledge";

function cleanInlineText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
    | "pageNumber"
  >;
}): string {
  const sanitizedStepHint = sanitizeImageStepHint(input.image.stepHint);

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
