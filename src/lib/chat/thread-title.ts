export const THREAD_TITLE_MAX_LENGTH = 80;

const TITLE_PREFIX_RE = /^title\s*[:\-]\s*/iu;
const LEADING_MARKUP_RE = /^(?:[#>*_`~\-+]+|\d+[.)-])\s*/u;

function cleanThreadTitleLine(value: string): string {
  let line = value.trim();
  if (!line) return "";

  let previous = "";
  while (line && line !== previous) {
    previous = line;
    line = line
      .replace(TITLE_PREFIX_RE, "")
      .replace(LEADING_MARKUP_RE, "")
      .trim();
  }

  return line
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/['’‘]/gu, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeThreadTitle(
  value: string,
  maxLength = THREAD_TITLE_MAX_LENGTH,
): string {
  if (!value) return "";

  const normalized = value.normalize("NFKC").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";

  for (const line of normalized.split("\n")) {
    const cleaned = cleanThreadTitleLine(line);
    if (!cleaned) continue;
    return cleaned.slice(0, maxLength).trim();
  }

  return "";
}
