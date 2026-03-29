/**
 * Normalize markdown into a stable, clean structure.
 *
 * Goals:
 * - Preserve heading hierarchy and content fidelity
 * - Keep code fences and tables intact
 * - Reduce noisy spacing/artifacts
 * - Remove stray horizontal rules that fragment content and waste tokens
 */
import { normalizeWhitespaceArtifacts } from "./text-cleaning";

function collapseInlineSpacingArtifacts(line: string): string {
  if (/^\t|^ {4,}/.test(line)) {
    return line;
  }

  const leadingWhitespace = line.match(/^\s*/)?.[0] ?? "";
  const content = line
    .slice(leadingWhitespace.length)
    .replace(/(?<=\S)[ \t]{2,}(?=\S)/g, " ");

  return `${leadingWhitespace}${content}`;
}

export function normalizeStructuredMarkdown(markdown: string): string {
  if (!markdown.trim()) return "";

  const cleaned = normalizeWhitespaceArtifacts(markdown)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[^\S\n]+$/gm, "")
    .trim();

  const lines = cleaned.split("\n");
  const out: string[] = [];
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      out.push(line);
      continue;
    }

    // Inside code fences: pass through unchanged
    if (inCodeFence) {
      out.push(line);
      continue;
    }

    // Remove standalone horizontal rules (---, ***, ___) outside code fences
    // These fragment the content and waste tokens during embedding/retrieval
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      continue;
    }

    out.push(collapseInlineSpacingArtifacts(line));
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
