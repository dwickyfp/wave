import * as cheerio from "cheerio";
import { safeOutboundFetch } from "lib/network/safe-outbound-fetch";
import { convertHtmlFragmentToProcessedDocument } from "./image-markdown";
import {
  isHtmlContentType,
  MAX_REMOTE_HTML_BYTES,
  normalizeRemoteContentType,
  readResponseBufferWithinLimit,
} from "./remote-fetch";
import type { DocumentProcessingOptions, ProcessedDocument } from "./types";

export async function processUrl(
  url: string,
  options: DocumentProcessingOptions = {},
): Promise<ProcessedDocument> {
  const response = await safeOutboundFetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
      "User-Agent":
        "Mozilla/5.0 (compatible; ContextX-bot/1.0; +https://contextx.internal)",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch URL: ${response.status} ${response.statusText}`,
    );
  }

  const contentType = normalizeRemoteContentType(
    response.headers.get("content-type"),
  );
  if (contentType && !isHtmlContentType(contentType)) {
    throw new Error(`Unsupported URL content type: ${contentType}`);
  }

  const html = (
    await readResponseBufferWithinLimit(
      response,
      MAX_REMOTE_HTML_BYTES,
      "Remote HTML response",
    )
  ).toString("utf-8");
  const $ = cheerio.load(html);
  const title = $("title").text().trim();

  // Remove noise elements
  $(
    "script, style, nav, footer, header, aside, [class*='menu'], [class*='sidebar'], [id*='nav'], [id*='footer']",
  ).remove();

  // Extract main content
  const mainContent =
    $("main").html() ||
    $("article").html() ||
    $('[role="main"]').html() ||
    $("body").html() ||
    "";

  const processed = await convertHtmlFragmentToProcessedDocument(mainContent, {
    ...options,
    baseUrl: url,
    documentTitle: options.documentTitle || title || url,
  });

  // Add source info at the top
  return {
    markdown: `# ${title || url}\n\nSource: ${url}\n\n${processed.markdown}`,
    imageBlocks: processed.imageBlocks,
    images: processed.images,
  };
}

export async function processHtml(
  buffer: Buffer,
  options: DocumentProcessingOptions = {},
): Promise<ProcessedDocument> {
  const html = buffer.toString("utf-8");
  const $ = cheerio.load(html);
  $("script, style").remove();
  const body = $("body").html() || html;
  return convertHtmlFragmentToProcessedDocument(body, options);
}
