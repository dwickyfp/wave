/**
 * Normalize markdown into a stable, section-oriented structure.
 *
 * Goals:
 * - Preserve heading hierarchy and content fidelity
 * - Insert `---` separators between major sections
 * - Keep code fences and tables intact
 * - Reduce noisy spacing/artifacts
 */
export function normalizeStructuredMarkdown(markdown: string): string {
  if (!markdown.trim()) return "";

  const cleaned = markdown
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[^\S\n]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  const lines = cleaned.split("\n");
  const out: string[] = [];
  let inCodeFence = false;
  let seenBodyContent = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      out.push(line);
      if (trimmed) seenBodyContent = true;
      continue;
    }

    if (!inCodeFence) {
      const headingMatch = trimmed.match(/^(#{1,6})\s+.+$/);
      const isMajorHeading =
        !!headingMatch && headingMatch[1].length <= 3 && seenBodyContent;

      if (isMajorHeading) {
        const prev = out[out.length - 1]?.trim();
        if (prev && prev !== "---") {
          out.push("", "---", "");
        }
      }
    }

    out.push(line);
    if (trimmed && trimmed !== "---") seenBodyContent = true;
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n*---\n*/g, "\n\n---\n\n")
    .trim();
}
