/**
 * LLM-based Markdown Parser
 *
 * Converts raw extracted text into clean, well-structured markdown before
 * chunking and embedding.
 */
import { LanguageModel, generateText } from "ai";
import { createModelFromConfig } from "lib/ai/provider-factory";
import { settingsRepository } from "lib/db/repository";

const PARSE_SYSTEM_PROMPT = `You are a document formatting expert. Your task is to convert raw document text into clean, well-structured markdown.

Rules:
- Preserve ALL information from the original text; do not summarize or omit content
- Use proper markdown headings (# ## ###) only for genuine section titles and major document divisions
- Keep related items together instead of turning each line into a heading
- Format lists as compact markdown lists with no blank lines between related items
- Never output horizontal rules (--- or ***)
- Use a single blank line between sections and never emit multiple consecutive blank lines

Code:
- Wrap code samples in fenced code blocks with the language identifier when clear
- Keep related code together in one code block
- Preserve comments inside code blocks exactly
- If the entire document is source code, wrap it in one fenced code block

Tables:
- Convert tabular data into proper markdown tables
- Preserve values exactly, including numbers, dates, percentages, and units

Images and Visual Elements:
- Replace image references or placeholders with a markdown blockquote description inferred from nearby context
- Never silently drop image references

Other:
- Remove page numbers, repeated headers or footers, and watermark artifacts
- Preserve technical terms, names, numbers, and dates exactly
- Output only the markdown content`;

const WINDOW_CHARS = 40_000;
const WINDOW_OVERLAP_CHARS = 4_000;
const OVERLAP_COMPARE_LINES = 80;

async function resolveParsingModel(provider: string, modelName: string) {
  const providerConfig = await settingsRepository.getProviderByName(provider);
  if (!providerConfig?.enabled) {
    throw new Error(
      `Parsing provider "${provider}" is not enabled or not found`,
    );
  }

  const modelConfig = await settingsRepository.getModelForChat(
    provider,
    modelName,
  );
  const resolvedModelName = modelConfig?.apiName ?? modelName;
  const model = createModelFromConfig(
    provider,
    resolvedModelName,
    providerConfig.apiKey,
    providerConfig.baseUrl,
    providerConfig.settings,
  );
  if (!model) {
    throw new Error(
      `Failed to create model instance for ${provider}/${modelName}`,
    );
  }

  if (!modelConfig) {
    console.warn(
      `[ContextX] Parsing model "${modelName}" is not registered in settings; using direct provider model fallback`,
    );
  }

  return model;
}

function buildParsePrompt(
  rawText: string,
  documentTitle: string,
  windowIndex: number,
  totalWindows: number,
): string {
  return `Document title: "${documentTitle}"
Window: ${windowIndex} of ${totalWindows}

Raw extracted text:
<document_window>
${rawText}
</document_window>

Convert this document window into clean, well-structured markdown.
Preserve all content and keep the original order.`;
}

function findWindowEnd(
  rawText: string,
  desiredEnd: number,
  minEnd: number,
): number {
  const paragraphBreak = rawText.lastIndexOf("\n\n", desiredEnd);
  if (paragraphBreak > minEnd) return paragraphBreak + 2;

  const lineBreak = rawText.lastIndexOf("\n", desiredEnd);
  if (lineBreak > minEnd) return lineBreak + 1;

  const sentenceBreak = Math.max(
    rawText.lastIndexOf(". ", desiredEnd),
    rawText.lastIndexOf("! ", desiredEnd),
    rawText.lastIndexOf("? ", desiredEnd),
  );
  if (sentenceBreak > minEnd) return sentenceBreak + 2;

  const spaceBreak = rawText.lastIndexOf(" ", desiredEnd);
  if (spaceBreak > minEnd) return spaceBreak + 1;

  return desiredEnd;
}

export function splitRawTextIntoWindows(
  rawText: string,
  windowChars = WINDOW_CHARS,
  overlapChars = WINDOW_OVERLAP_CHARS,
): string[] {
  if (rawText.length <= windowChars) return [rawText];

  const windows: string[] = [];
  let start = 0;

  while (start < rawText.length) {
    const desiredEnd = Math.min(start + windowChars, rawText.length);
    const minEnd = Math.min(
      rawText.length,
      start + Math.floor(windowChars * 0.6),
    );
    const end =
      desiredEnd < rawText.length
        ? findWindowEnd(rawText, desiredEnd, minEnd)
        : desiredEnd;

    const windowText = rawText.slice(start, end).trim();
    if (windowText) windows.push(windowText);
    if (end >= rawText.length) break;

    const nextStart = Math.max(0, end - overlapChars);
    if (nextStart <= start) {
      start = end;
    } else {
      start = nextStart;
    }
  }

  return windows;
}

function findLineOverlap(previous: string, next: string): number {
  const previousLines = previous.split("\n").map((line) => line.trimEnd());
  const nextLines = next.split("\n").map((line) => line.trimEnd());
  const maxLines = Math.min(
    OVERLAP_COMPARE_LINES,
    previousLines.length,
    nextLines.length,
  );

  for (let size = maxLines; size > 0; size--) {
    const previousSlice = previousLines.slice(-size).join("\n");
    const nextSlice = nextLines.slice(0, size).join("\n");
    if (previousSlice === nextSlice) return size;
  }

  return 0;
}

function mergeTwoMarkdownWindows(previous: string, next: string): string {
  if (!previous.trim()) return next.trim();
  if (!next.trim()) return previous.trim();

  const overlapLines = findLineOverlap(previous, next);
  if (overlapLines > 0) {
    const previousLines = previous.split("\n");
    const nextLines = next.split("\n");
    return [...previousLines, ...nextLines.slice(overlapLines)]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  if (previous.includes(next)) return previous.trim();
  if (next.includes(previous)) return next.trim();

  return `${previous.trim()}\n\n${next.trim()}`.replace(/\n{3,}/g, "\n\n");
}

export function mergeParsedMarkdownWindows(windows: string[]): string {
  return windows.reduce(
    (combined, windowText) => mergeTwoMarkdownWindows(combined, windowText),
    "",
  );
}

async function parseWindowToMarkdown(
  model: LanguageModel,
  rawText: string,
  documentTitle: string,
  windowIndex: number,
  totalWindows: number,
): Promise<string> {
  const { text } = await generateText({
    model,
    system: PARSE_SYSTEM_PROMPT,
    prompt: buildParsePrompt(rawText, documentTitle, windowIndex, totalWindows),
    temperature: 0,
  });

  const parsed = text.trim();
  if (!parsed || parsed.length < 50) {
    console.warn(
      `[ContextX] Parser returned suspiciously short output for "${documentTitle}" window ${windowIndex}/${totalWindows}; using raw text for this window`,
    );
    return rawText;
  }

  return parsed;
}

export async function parseDocumentToMarkdown(
  rawText: string,
  documentTitle: string,
  parsingProvider: string,
  parsingModel: string,
): Promise<string> {
  try {
    const model = await resolveParsingModel(parsingProvider, parsingModel);
    const windows = splitRawTextIntoWindows(rawText);

    console.log(
      `[ContextX] Parsing "${documentTitle}" with LLM (${parsingProvider}/${parsingModel}), ${windows.length} window(s)`,
    );

    const parsedWindows: string[] = [];
    for (const [index, windowText] of windows.entries()) {
      parsedWindows.push(
        await parseWindowToMarkdown(
          model,
          windowText,
          documentTitle,
          index + 1,
          windows.length,
        ),
      );
    }

    const parsed = mergeParsedMarkdownWindows(parsedWindows).trim();
    if (!parsed || parsed.length < 50) {
      console.warn(
        `[ContextX] LLM parser returned suspiciously short output for "${documentTitle}", using raw text`,
      );
      return rawText;
    }

    console.log(
      `[ContextX] LLM parsing complete for "${documentTitle}": ${rawText.length} -> ${parsed.length} chars`,
    );
    return parsed;
  } catch (error) {
    console.error(
      `[ContextX] LLM markdown parsing failed for "${documentTitle}", falling back to raw text:`,
      error,
    );
    return rawText;
  }
}
