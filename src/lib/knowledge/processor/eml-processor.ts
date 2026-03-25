function normalizeHeaderName(name: string): string {
  return name
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join("-");
}

export function processEml(input: Buffer | string): string {
  const raw = Buffer.isBuffer(input) ? input.toString("utf-8") : input;
  const normalized = raw.replace(/\r\n/g, "\n");
  const [rawHeaders, ...bodyParts] = normalized.split(/\n\n/);
  const headers = rawHeaders
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, ...rest] = line.split(":");
      return `- ${normalizeHeaderName(key ?? "")}: ${rest.join(":").trim()}`;
    });
  const body = bodyParts.join("\n\n").trim();

  return [
    "# Email Message",
    "",
    headers.length > 0 ? "## Headers" : "",
    headers.length > 0 ? headers.join("\n") : "",
    body ? "\n## Body\n" : "",
    body,
    "",
  ]
    .filter(Boolean)
    .join("\n");
}
