/**
 * Utilities for auto-generating and embedding document-level metadata.
 */

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

export function extractAutoDocumentMetadata(
  markdown: string,
  fallbackTitle: string,
): { title: string; description: string | null } {
  const title =
    extractFirstHeading(markdown) || normalizeSentence(fallbackTitle, 140);
  const description = extractFirstMeaningfulParagraph(markdown);

  return {
    title: title || fallbackTitle,
    description: description || null,
  };
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
