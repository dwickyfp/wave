export const MAX_REMOTE_HTML_BYTES = 5 * 1024 * 1024;

export function normalizeRemoteContentType(
  value: string | null | undefined,
): string | null {
  return value?.split(";", 1)[0]?.trim().toLowerCase() || null;
}

export function isHtmlContentType(value: string | null | undefined): boolean {
  const normalized = normalizeRemoteContentType(value);
  return (
    normalized === "text/html" ||
    normalized === "application/xhtml+xml" ||
    normalized === "text/plain"
  );
}

export function isImageContentType(value: string | null | undefined): boolean {
  const normalized = normalizeRemoteContentType(value);
  return normalized?.startsWith("image/") ?? false;
}

export async function readResponseBufferWithinLimit(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Buffer> {
  const contentLength = Number.parseInt(
    response.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`${label} exceeds maximum size of ${maxBytes} bytes`);
  }

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error(`${label} exceeds maximum size of ${maxBytes} bytes`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (!value?.byteLength) {
      continue;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`${label} exceeds maximum size of ${maxBytes} bytes`);
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, totalBytes);
}
