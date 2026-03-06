/**
 * LLM-based Markdown Parser
 *
 * Converts raw extracted text (from PDF/DOCX/XLSX/URL/HTML processors) into
 * clean, well-structured markdown using a configured LLM. This improves
 * chunking quality by producing semantically coherent, properly formatted
 * markdown before the chunker and embedder run.
 *
 * The parsing LLM is configured per knowledge group (parsingProvider + parsingModel).
 */
import { generateText } from "ai";
import { createModelFromConfig } from "lib/ai/provider-factory";
import { settingsRepository } from "lib/db/repository";

// ─── Model Resolution ──────────────────────────────────────────────────────────

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

// ─── Prompt ────────────────────────────────────────────────────────────────────

const PARSE_SYSTEM_PROMPT = `You are a document formatting expert. Your task is to convert raw document text into clean, well-structured markdown.

Rules:
- Preserve ALL information from the original text — do not summarize or omit content
- Use proper markdown headings (# ## ###) ONLY for genuine section titles and major document divisions — do NOT turn every line or list item into a heading
- Items that belong together (e.g. a skill and its qualifier, a name and its description) must stay on the same line or in the same list item, not split into separate headings
- Format lists as compact markdown lists (- or 1.) with NO blank lines between list items — consecutive related items should be grouped into a single list
- NEVER output horizontal rules (--- or ***) — use headings for section breaks instead
- Use a SINGLE blank line between sections; NEVER use multiple consecutive blank lines
- Do NOT add a blank line between items in the same list or section

Code:
- Wrap code samples in fenced code blocks (\`\`\`) with the language identifier
- Keep related code together in one code block — do NOT split a single function, config object, or logical code unit across multiple blocks
- Preserve comments within code blocks exactly as they appear
- If the entire document is source code, wrap it in a single fenced code block

Tables:
- Detect ANY tabular data in the raw text (columns separated by spaces/tabs, aligned rows, or data presented in a grid-like format) and convert it into a proper markdown table with | column | headers | and separator rows
- Infer column headers from context if not explicitly present
- Preserve all cell values exactly, including numbers, dates, percentages, and units

Images and Visual Elements:
- When you encounter image placeholders, figure references, chart labels, or captions (e.g. "[Image]", "[Figure 1]", "Figure 2:", "Chart:", "[photo]", "[diagram]", or any surrounding caption text), replace or supplement them with a descriptive markdown block in this format:
  > **[Image: <type>]** <description inferred from surrounding context, caption, title, or nearby text>
- For charts and graphs: describe the chart type (bar, line, pie, etc.), the axes/legend labels, and any data values or trends visible in nearby text
- For diagrams and illustrations: describe what the diagram depicts based on its title, caption, or surrounding context
- For photos or screenshots: describe the subject based on any caption or context
- If there is absolutely no context to infer a description, use: > **[Image]** *Visual content — no description available*
- Never skip or silently drop image references

Other:
- Remove artifacts like page numbers, repeated headers/footers, watermarks
- Preserve technical terms, names, numbers, and dates exactly as they appear
- Output ONLY the markdown content, no preamble or explanation`;

function buildParsePrompt(rawText: string, documentTitle: string): string {
  return `Document title: "${documentTitle}"

Raw extracted text:
<document>
${rawText}
</document>

Convert the above raw text into clean, well-structured markdown. Preserve all content.`;
}

// ─── Main Parser ───────────────────────────────────────────────────────────────

/** Max input characters to avoid extreme token costs on very large docs */
const MAX_INPUT_CHARS = 120_000;

/**
 * Parse raw document text into clean markdown using an LLM.
 *
 * @param rawText - Text extracted by the document processor
 * @param documentTitle - Document name/title for context
 * @param parsingProvider - Provider name (e.g. "openai", "anthropic")
 * @param parsingModel - Model API name (e.g. "gpt-4.1-mini")
 * @returns Clean markdown string, or the original rawText if parsing fails
 */
export async function parseDocumentToMarkdown(
  rawText: string,
  documentTitle: string,
  parsingProvider: string,
  parsingModel: string,
): Promise<string> {
  // For very large documents, chunk input to avoid token limits
  const input =
    rawText.length > MAX_INPUT_CHARS
      ? rawText.slice(0, MAX_INPUT_CHARS)
      : rawText;

  try {
    const model = await resolveParsingModel(parsingProvider, parsingModel);

    console.log(
      `[ContextX] Parsing "${documentTitle}" with LLM (${parsingProvider}/${parsingModel}), ${input.length} chars`,
    );

    const { text } = await generateText({
      model,
      system: PARSE_SYSTEM_PROMPT,
      prompt: buildParsePrompt(input, documentTitle),
      temperature: 0,
    });

    const parsed = text.trim();
    if (!parsed || parsed.length < 50) {
      console.warn(
        `[ContextX] LLM parser returned suspiciously short output for "${documentTitle}", using raw text`,
      );
      return rawText;
    }

    console.log(
      `[ContextX] LLM parsing complete for "${documentTitle}": ${rawText.length} → ${parsed.length} chars`,
    );
    return parsed;
  } catch (err) {
    console.error(
      `[ContextX] LLM markdown parsing failed for "${documentTitle}", falling back to raw text:`,
      err,
    );
    return rawText;
  }
}
