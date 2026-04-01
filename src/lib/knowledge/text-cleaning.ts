const HTML_WHITESPACE_ENTITY_RE =
  /&(nbsp|ensp|emsp|thinsp|#160|#xa0|#8194|#8195|#8201);/gi;

export function normalizeWhitespaceArtifacts(text: string): string {
  if (!text) return "";

  return text
    .normalize("NFC")
    .replace(HTML_WHITESPACE_ENTITY_RE, " ")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "");
}
