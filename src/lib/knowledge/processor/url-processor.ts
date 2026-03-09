import * as cheerio from "cheerio";
import { convertHtmlFragmentToProcessedDocument } from "./image-markdown";
import type { DocumentProcessingOptions, ProcessedDocument } from "./types";

export async function processUrl(
  url: string,
  options: DocumentProcessingOptions = {},
): Promise<ProcessedDocument> {
  const response = await fetch(url, {
    headers: {
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

  const html = await response.text();
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
