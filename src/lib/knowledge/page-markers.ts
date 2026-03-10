const PAGE_MARKER_PREFIX = "<!--CTX_PAGE:";
const PAGE_MARKER_SUFFIX = "-->";

export function createPageMarker(pageNumber: number): string {
  return `${PAGE_MARKER_PREFIX}${pageNumber}${PAGE_MARKER_SUFFIX}`;
}

export function parsePageMarker(line: string): number | null {
  const match = line.trim().match(/^<!--CTX_PAGE:(\d+)-->$/);
  if (!match) return null;

  const pageNumber = Number.parseInt(match[1], 10);
  return Number.isFinite(pageNumber) ? pageNumber : null;
}
