import * as cheerio from "cheerio";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

export async function processUrl(url: string): Promise<string> {
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

  const markdown = turndown.turndown(mainContent);

  // Add source info at the top
  const title = $("title").text().trim();
  return `# ${title || url}\n\nSource: ${url}\n\n${markdown}`;
}

export async function processHtml(buffer: Buffer): Promise<string> {
  const html = buffer.toString("utf-8");
  const $ = cheerio.load(html);
  $("script, style").remove();
  const body = $("body").html() || html;
  return turndown.turndown(body);
}
