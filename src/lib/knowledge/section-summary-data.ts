import type {
  KnowledgeSectionSummaryCoverageFlags,
  KnowledgeSectionSummaryData,
  KnowledgeSectionTableDigest,
  KnowledgeSectionValueDigestItem,
} from "app-types/knowledge";
import type { ProcessedDocumentImage } from "./processor/types";

type SummarySection = {
  id: string;
  heading: string;
  headingPath: string;
  parentSectionId?: string | null;
  prevSectionId?: string | null;
  nextSectionId?: string | null;
  partIndex: number;
  partCount: number;
  content: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  noteNumber?: string | null;
  noteTitle?: string | null;
  noteSubsection?: string | null;
  continued?: boolean | null;
};

type SectionFamily = {
  key: string;
  sections: SummarySection[];
  pageStart: number | null;
  pageEnd: number | null;
  content: string;
  images: ProcessedDocumentImage[];
};

const SUMMARY_TOKEN_LIMIT = 160;
const PART_SUMMARY_TOKEN_LIMIT = 180;
const LOGICAL_SUMMARY_TOKEN_LIMIT = 260;
const MAX_VALUE_DIGEST_ITEMS = 12;
const MAX_TABLE_DIGEST_ROWS = 8;
const VALUE_TEXT_MAX_CHARS = 220;

type MarkdownTableBlock = {
  headers: string[];
  rows: string[][];
};

function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.35));
}

function cleanInlineText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/<!--CTX_PAGE:\d+-->/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimTextToTokenLimit(text: string, tokenLimit: number): string {
  const cleaned = cleanInlineText(text);
  if (!cleaned) return "";
  if (estimateTokens(cleaned) <= tokenLimit) return cleaned;

  const words = cleaned.split(/\s+/);
  const selected: string[] = [];
  for (const word of words) {
    selected.push(word);
    if (estimateTokens(selected.join(" ")) >= tokenLimit) {
      selected.pop();
      break;
    }
  }

  return selected.join(" ").trim() || words.slice(0, 12).join(" ").trim();
}

function normalizeDigestText(value: string): string {
  return cleanInlineText(value).slice(0, VALUE_TEXT_MAX_CHARS).trim();
}

function dedupeValues<T>(
  items: T[],
  getKey: (item: T) => string,
  limit?: number,
): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (limit != null && deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}

function splitIntoParagraphs(content: string): string[] {
  return content
    .split(/\n{2,}/)
    .map((block) => cleanInlineText(block))
    .filter(Boolean);
}

function extractFirstMeaningfulParagraph(content: string): string | null {
  for (const paragraph of splitIntoParagraphs(content)) {
    if (
      paragraph.length >= 30 &&
      !paragraph.startsWith("|") &&
      !/^[-*+]\s+/.test(paragraph) &&
      !/^\d+[.)]\s+/.test(paragraph)
    ) {
      return paragraph;
    }
  }

  return null;
}

function splitIntoSentenceCandidates(content: string): string[] {
  const normalized = content
    .replace(/<!--CTX_PAGE:\d+-->/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => !line.trim().startsWith("|"))
    .join("\n");
  const lineCandidates = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^#{1,6}\s+/.test(line))
    .filter((line) => !/^```/.test(line))
    .filter((line) => !/^\|/.test(line))
    .map((line) => cleanInlineText(line));

  const sentenceCandidates = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => cleanInlineText(sentence));

  return dedupeValues(
    [...lineCandidates, ...sentenceCandidates].filter(
      (value) => value.length >= 16,
    ),
    (value) => value.toLowerCase(),
  );
}

function isNumericSentence(value: string): boolean {
  return /(?:\d|\b(?:percent|percentage|ratio|total|increase|decrease|growth|decline|count|sample|n=|p=|ci\b|confidence interval|mean|median|std|sd|revenue|profit|loss|assets|liabilities|equity|cash flow)\b)/i.test(
    value,
  );
}

function scoreValueSentence(value: string): number {
  const normalized = value.toLowerCase();
  let score = 0;
  const numberMatches = value.match(
    /(?:\b\d+(?:[.,]\d+)*(?:%|x)?\b|\bp\s*[<=>]\s*0?\.\d+\b|\bci\b|\bn\s*=\s*\d+\b)/gi,
  );
  score += Math.min(6, numberMatches?.length ?? 0);

  if (
    /\b(total|subtotal|net|gross|ratio|margin|eps|roe|roa|profit|loss|assets|liabilities|equity|cash flow|sample|participants?|respondents?|confidence interval|mean|median|standard deviation|sd|p-value|p=|n=|results?)\b/i.test(
      normalized,
    )
  ) {
    score += 3;
  }
  if (/^\d+[.)]\s+/.test(value)) score += 2;
  if (value.length >= 48 && value.length <= VALUE_TEXT_MAX_CHARS) score += 1;
  return score;
}

function buildValueDigestItems(
  texts: string[],
  pageStart: number | null,
  pageEnd: number | null,
  kind: KnowledgeSectionValueDigestItem["kind"],
): KnowledgeSectionValueDigestItem[] {
  return texts.map((text) => ({
    kind,
    text: normalizeDigestText(text),
    pageStart,
    pageEnd,
  }));
}

function extractResearchResultTexts(content: string): string[] {
  return splitIntoSentenceCandidates(content)
    .filter((value) =>
      /\b(?:n\s*=\s*\d+|p\s*[<=>]\s*0?\.\d+|ci\b|confidence interval|odds ratio|hazard ratio|relative risk|mean|median|standard deviation|sd|interquartile range|iqr|effect size|accuracy|precision|recall|f1)\b/i.test(
        value,
      ),
    )
    .sort((left, right) => scoreValueSentence(right) - scoreValueSentence(left))
    .slice(0, 6);
}

function extractNumericValueTexts(content: string): string[] {
  return splitIntoSentenceCandidates(content)
    .filter(isNumericSentence)
    .sort((left, right) => scoreValueSentence(right) - scoreValueSentence(left))
    .slice(0, MAX_VALUE_DIGEST_ITEMS);
}

function parseMarkdownTableBlock(lines: string[]): MarkdownTableBlock | null {
  if (lines.length < 2) return null;

  const rows = lines
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cleanInlineText(cell)),
    )
    .filter((row) => row.some(Boolean));

  if (rows.length < 2) return null;

  const [headers, ...dataRows] = rows.filter(
    (row) =>
      !row.every((cell) => /^:?-{2,}:?$/.test(cell)) &&
      !row.every((cell) => !cell),
  );
  if (!headers || dataRows.length === 0) return null;

  return {
    headers,
    rows: dataRows,
  };
}

function scoreTableRow(row: string[]): number {
  const text = row.join(" ");
  let score = 0;
  if (
    /\b(total|subtotal|net|gross|closing|ending|opening|summary|profit|loss|assets|liabilities|equity)\b/i.test(
      text,
    )
  ) {
    score += 4;
  }
  if (/(?:\d|%)/.test(text)) score += 2;
  if (row.length > 1) score += 1;
  return score;
}

function selectSalientTableRows(rows: string[][]): string[][] {
  if (rows.length <= MAX_TABLE_DIGEST_ROWS) return rows;

  const ranked = rows
    .map((row, index) => ({
      row,
      index,
      score: scoreTableRow(row),
    }))
    .sort((left, right) => {
      const delta = right.score - left.score;
      if (delta !== 0) return delta;
      return left.index - right.index;
    })
    .slice(0, MAX_TABLE_DIGEST_ROWS)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.row);

  return ranked;
}

function extractMarkdownTableDigests(
  content: string,
  pageStart: number | null,
  pageEnd: number | null,
): KnowledgeSectionTableDigest[] {
  const lines = content.split("\n");
  const digests: KnowledgeSectionTableDigest[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith("|") || !line.includes("|")) continue;

    const blockLines = [lines[index]];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const candidate = lines[cursor].trim();
      if (!candidate.startsWith("|") || !candidate.includes("|")) break;
      blockLines.push(lines[cursor]);
      cursor += 1;
    }

    index = cursor - 1;
    const parsed = parseMarkdownTableBlock(blockLines);
    if (!parsed) continue;

    const rows = selectSalientTableRows(parsed.rows);
    const summaryText = trimTextToTokenLimit(
      [
        parsed.headers.length > 0
          ? `Headers: ${parsed.headers.join(", ")}.`
          : "",
        rows.length > 0
          ? `Rows: ${rows
              .map((row) => row.join(" | "))
              .slice(0, 4)
              .join("; ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      70,
    );

    digests.push({
      source: "markdown",
      title: null,
      headers: parsed.headers,
      rows,
      summary: summaryText || null,
      pageStart,
      pageEnd,
    });
  }

  return digests;
}

function extractImageTableDigests(
  images: ProcessedDocumentImage[],
  pageStart: number | null,
  pageEnd: number | null,
): KnowledgeSectionTableDigest[] {
  const digests: KnowledgeSectionTableDigest[] = [];

  for (const image of images) {
    const tableData = image.structuredData?.tableData;
    if (!tableData) continue;

    digests.push({
      source: "image",
      title: cleanInlineText(image.label) || null,
      headers: tableData.headers ?? null,
      rows: tableData.rows
        ? selectSalientTableRows(
            tableData.rows.map((row) =>
              row.map((cell) => cleanInlineText(cell)),
            ),
          )
        : null,
      summary:
        cleanInlineText(tableData.summary) ||
        cleanInlineText(image.description) ||
        null,
      pageStart: image.pageNumber ?? pageStart,
      pageEnd: image.pageNumber ?? pageEnd,
    });
  }

  return digests;
}

function buildTableValueDigest(
  tableDigest: KnowledgeSectionTableDigest[],
): string[] {
  const values: string[] = [];

  for (const table of tableDigest) {
    const headerText =
      table.headers && table.headers.length > 0
        ? `Headers: ${table.headers.join(", ")}`
        : "";
    if (headerText) {
      values.push(headerText);
    }
    for (const row of table.rows ?? []) {
      const text = row.join(" | ");
      if (text) values.push(text);
    }
    if (table.summary) {
      values.push(table.summary);
    }
  }

  return values;
}

function extractImageValueTexts(images: ProcessedDocumentImage[]): string[] {
  const values: string[] = [];

  for (const image of images) {
    for (const value of image.exactValueSnippets ?? []) {
      const normalized = normalizeDigestText(value);
      if (normalized) values.push(normalized);
    }

    const chartData = image.structuredData?.chartData;
    if (chartData?.summary) {
      values.push(normalizeDigestText(chartData.summary));
    }
    for (const series of chartData?.series ?? []) {
      const summary = normalizeDigestText(
        `${series.name}: ${(series.values ?? []).join(", ")}`,
      );
      if (summary) values.push(summary);
    }

    const tableData = image.structuredData?.tableData;
    if (tableData?.summary) {
      values.push(normalizeDigestText(tableData.summary));
    }
  }

  return values;
}

function hasDenseNumberPatterns(content: string): boolean {
  const matches = content.match(
    /(?:\b\d+(?:[.,]\d+)*(?:%|x)?\b|\bp\s*[<=>]\s*0?\.\d+\b|\bn\s*=\s*\d+\b)/gi,
  );
  return (matches?.length ?? 0) >= 6;
}

function buildCoverageFlags(input: {
  tableDigest: KnowledgeSectionTableDigest[];
  valueDigest: KnowledgeSectionValueDigestItem[];
  researchTexts: string[];
  continuation: KnowledgeSectionSummaryData["continuation"];
  content: string;
}): KnowledgeSectionSummaryCoverageFlags {
  return {
    hasTable: input.tableDigest.length > 0,
    hasDenseNumbers:
      hasDenseNumberPatterns(input.content) || input.valueDigest.length >= 5,
    hasResearchResults: input.researchTexts.length > 0,
    hasContinuation:
      input.continuation.usesPrevPart ||
      input.continuation.usesNextPart ||
      input.continuation.partCount > 1,
  };
}

function buildLogicalSectionKey(section: SummarySection): string {
  return [
    section.headingPath,
    section.noteNumber ?? "",
    section.noteSubsection ?? "",
  ].join("::");
}

function groupSectionFamilies(
  sections: SummarySection[],
  images: ProcessedDocumentImage[],
): SectionFamily[] {
  const families: SectionFamily[] = [];

  for (const section of sections) {
    const key = buildLogicalSectionKey(section);
    const lastFamily = families.at(-1);
    const canExtend =
      lastFamily != null &&
      lastFamily.key === key &&
      (lastFamily.sections.at(-1)?.nextSectionId === section.id ||
        section.prevSectionId === lastFamily.sections.at(-1)?.id ||
        section.continued === true ||
        lastFamily.sections.at(-1)?.continued === true);

    if (canExtend && lastFamily) {
      lastFamily.sections.push(section);
      lastFamily.pageStart =
        lastFamily.pageStart == null
          ? (section.pageStart ?? null)
          : section.pageStart == null
            ? lastFamily.pageStart
            : Math.min(lastFamily.pageStart, section.pageStart);
      lastFamily.pageEnd =
        lastFamily.pageEnd == null
          ? (section.pageEnd ?? null)
          : section.pageEnd == null
            ? lastFamily.pageEnd
            : Math.max(lastFamily.pageEnd, section.pageEnd);
      lastFamily.content = `${lastFamily.content}\n\n${section.content}`.trim();
      continue;
    }

    families.push({
      key,
      sections: [section],
      pageStart: section.pageStart ?? null,
      pageEnd: section.pageEnd ?? null,
      content: section.content.trim(),
      images: [],
    });
  }

  for (const family of families) {
    family.images = images.filter((image) => {
      const headingMatch =
        image.headingPath &&
        family.sections.some(
          (section) =>
            section.headingPath === image.headingPath ||
            image.headingPath?.startsWith(section.headingPath),
        );
      if (headingMatch) return true;

      const imagePage = image.pageNumber ?? null;
      if (imagePage == null) return false;
      if (family.pageStart == null && family.pageEnd == null) return false;

      const start = family.pageStart ?? family.pageEnd;
      const end = family.pageEnd ?? family.pageStart;
      if (start == null || end == null) return false;
      return imagePage >= start && imagePage <= end;
    });
  }

  return families;
}

function buildContinuation(input: {
  section: SummarySection;
  family: SectionFamily;
}): KnowledgeSectionSummaryData["continuation"] {
  const sectionIndex = input.family.sections.findIndex(
    (candidate) => candidate.id === input.section.id,
  );
  return {
    partIndex: input.section.partIndex,
    partCount: input.section.partCount,
    usesPrevPart: sectionIndex > 0,
    usesNextPart:
      sectionIndex >= 0 && sectionIndex < input.family.sections.length - 1,
  };
}

function buildSummaryText(input: {
  headingPath: string;
  parentHeadingPath?: string | null;
  baseParagraph: string | null;
  continuation: KnowledgeSectionSummaryData["continuation"];
  coverageFlags: KnowledgeSectionSummaryCoverageFlags;
  valueDigest: KnowledgeSectionValueDigestItem[];
  tableDigest: KnowledgeSectionTableDigest[];
  tokenLimit: number;
  label: "part" | "logical";
}): string {
  const parts = [`Section: ${input.headingPath}.`];

  if (input.parentHeadingPath) {
    parts.push(`Parent: ${input.parentHeadingPath}.`);
  }
  if (input.continuation.usesPrevPart || input.continuation.usesNextPart) {
    parts.push(
      input.label === "part"
        ? "Read with adjacent continuation parts for complete context."
        : "This section spans multiple continuation parts.",
    );
  }
  if (input.baseParagraph) {
    parts.push(
      trimTextToTokenLimit(
        input.baseParagraph,
        Math.max(40, input.tokenLimit - 80),
      ),
    );
  }
  if (input.coverageFlags.hasTable && input.tableDigest.length > 0) {
    const tableSummary = input.tableDigest
      .map(
        (table) => table.summary || cleanInlineText(table.headers?.join(", ")),
      )
      .filter(Boolean)
      .slice(0, 2)
      .join("; ");
    if (tableSummary) {
      parts.push(`Table coverage: ${tableSummary}.`);
    }
  }
  const topValues = input.valueDigest
    .map((item) => item.text)
    .filter(Boolean)
    .slice(0, input.label === "part" ? 3 : 4);
  if (topValues.length > 0) {
    parts.push(`Key values: ${topValues.join("; ")}.`);
  }

  return trimTextToTokenLimit(parts.join(" "), input.tokenLimit);
}

function resolveParentHeadingPath(
  section: SummarySection,
  sectionsById: Map<string, SummarySection>,
): string | null {
  const parentId = section.parentSectionId;
  if (!parentId) return null;
  return sectionsById.get(parentId)?.headingPath ?? null;
}

function buildFamilyValueDigest(family: SectionFamily): {
  valueDigest: KnowledgeSectionValueDigestItem[];
  tableDigest: KnowledgeSectionTableDigest[];
  researchTexts: string[];
} {
  const markdownTableDigest = extractMarkdownTableDigests(
    family.content,
    family.pageStart,
    family.pageEnd,
  );
  const imageTableDigest = extractImageTableDigests(
    family.images,
    family.pageStart,
    family.pageEnd,
  );
  const tableDigest = [...markdownTableDigest, ...imageTableDigest];

  const researchTexts = extractResearchResultTexts(family.content);
  const numericTexts = extractNumericValueTexts(family.content);
  const imageValueTexts = extractImageValueTexts(family.images);
  const tableValueTexts = buildTableValueDigest(tableDigest);

  const valueDigest = dedupeValues(
    [
      ...buildValueDigestItems(
        researchTexts,
        family.pageStart,
        family.pageEnd,
        "research_result",
      ),
      ...buildValueDigestItems(
        numericTexts,
        family.pageStart,
        family.pageEnd,
        "numeric_sentence",
      ),
      ...buildValueDigestItems(
        tableValueTexts,
        family.pageStart,
        family.pageEnd,
        "table_value",
      ),
      ...buildValueDigestItems(
        imageValueTexts,
        family.pageStart,
        family.pageEnd,
        "image_value",
      ),
    ].filter((item) => item.text.length >= 8),
    (item) => `${item.kind}:${item.text.toLowerCase()}`,
    MAX_VALUE_DIGEST_ITEMS,
  );

  return {
    valueDigest,
    tableDigest,
    researchTexts,
  };
}

export function buildKnowledgeSectionSummaryData(
  sections: SummarySection[],
  images: ProcessedDocumentImage[] = [],
): Map<string, KnowledgeSectionSummaryData> {
  if (sections.length === 0) {
    return new Map();
  }

  const orderedSections = [...sections].sort((left, right) => {
    const leftPage = left.pageStart ?? Number.MAX_SAFE_INTEGER;
    const rightPage = right.pageStart ?? Number.MAX_SAFE_INTEGER;
    if (leftPage !== rightPage) return leftPage - rightPage;
    if (left.partIndex !== right.partIndex)
      return left.partIndex - right.partIndex;
    return left.id.localeCompare(right.id);
  });
  const sectionsById = new Map(
    orderedSections.map((section) => [section.id, section]),
  );
  const families = groupSectionFamilies(orderedSections, images);
  const familyBySectionId = new Map<string, SectionFamily>();

  for (const family of families) {
    for (const section of family.sections) {
      familyBySectionId.set(section.id, family);
    }
  }

  const summaryData = new Map<string, KnowledgeSectionSummaryData>();

  for (const section of orderedSections) {
    const family = familyBySectionId.get(section.id);
    if (!family) continue;

    const sectionIndex = family.sections.findIndex(
      (candidate) => candidate.id === section.id,
    );
    const localSections = family.sections.filter((_, index) => {
      return (
        index === sectionIndex ||
        index === sectionIndex - 1 ||
        index === sectionIndex + 1
      );
    });
    const localContent = localSections
      .map((entry) => entry.content)
      .join("\n\n");
    const continuation = buildContinuation({ section, family });
    const localPageStart =
      localSections.reduce<number | null>((minValue, entry) => {
        if (entry.pageStart == null) return minValue;
        return minValue == null
          ? entry.pageStart
          : Math.min(minValue, entry.pageStart);
      }, null) ?? family.pageStart;
    const localPageEnd =
      localSections.reduce<number | null>((maxValue, entry) => {
        if (entry.pageEnd == null) return maxValue;
        return maxValue == null
          ? entry.pageEnd
          : Math.max(maxValue, entry.pageEnd);
      }, null) ?? family.pageEnd;
    const localImages = family.images.filter((image) => {
      const imagePage = image.pageNumber ?? null;
      if (image.headingPath && image.headingPath === section.headingPath) {
        return true;
      }
      if (imagePage == null || localPageStart == null || localPageEnd == null) {
        return false;
      }
      return imagePage >= localPageStart && imagePage <= localPageEnd;
    });

    const localFamily: SectionFamily = {
      key: family.key,
      sections: localSections,
      pageStart: localPageStart,
      pageEnd: localPageEnd,
      content: localContent,
      images: localImages,
    };
    const partDigest = buildFamilyValueDigest(localFamily);
    const logicalDigest = buildFamilyValueDigest(family);

    const partCoverageFlags = buildCoverageFlags({
      tableDigest: partDigest.tableDigest,
      valueDigest: partDigest.valueDigest,
      researchTexts: partDigest.researchTexts,
      continuation,
      content: localContent,
    });
    const logicalCoverageFlags = buildCoverageFlags({
      tableDigest: logicalDigest.tableDigest,
      valueDigest: logicalDigest.valueDigest,
      researchTexts: logicalDigest.researchTexts,
      continuation,
      content: family.content,
    });

    const partSummary = buildSummaryText({
      headingPath: section.headingPath,
      parentHeadingPath: resolveParentHeadingPath(section, sectionsById),
      baseParagraph: extractFirstMeaningfulParagraph(localContent),
      continuation,
      coverageFlags: partCoverageFlags,
      valueDigest: partDigest.valueDigest,
      tableDigest: partDigest.tableDigest,
      tokenLimit: PART_SUMMARY_TOKEN_LIMIT,
      label: "part",
    });
    const logicalSectionSummary = buildSummaryText({
      headingPath: section.headingPath,
      parentHeadingPath: resolveParentHeadingPath(section, sectionsById),
      baseParagraph: extractFirstMeaningfulParagraph(family.content),
      continuation,
      coverageFlags: logicalCoverageFlags,
      valueDigest: logicalDigest.valueDigest,
      tableDigest: logicalDigest.tableDigest,
      tokenLimit: LOGICAL_SUMMARY_TOKEN_LIMIT,
      label: "logical",
    });

    summaryData.set(section.id, {
      logicalSectionKey: family.key,
      partSummary: trimTextToTokenLimit(partSummary, SUMMARY_TOKEN_LIMIT),
      logicalSectionSummary,
      continuation,
      valueDigest: logicalDigest.valueDigest,
      tableDigest: logicalDigest.tableDigest,
      coverageFlags: logicalCoverageFlags,
    });
  }

  return summaryData;
}
