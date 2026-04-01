import { generateUUID } from "lib/utils";
import {
  classifyFinancialStatementDocument,
  matchFinancialNoteHeading,
  matchFinancialSubsection,
  type FinancialStatementClassification,
} from "./financial-statement";
import { parsePageMarker } from "./page-markers";

export const SECTION_GRAPH_VERSION = 2;
const MAX_SECTION_TOKENS = 900;
const TARGET_SECTION_PART_TOKENS = 700;
const SUMMARY_TOKEN_LIMIT = 160;

interface ParsedSection {
  heading: string;
  headingLevel: number;
  headingBreadcrumb: string[];
  content: string;
  pageStart?: number;
  pageEnd?: number;
  noteNumber?: string;
  noteTitle?: string;
  noteSubsection?: string;
  continued?: boolean;
}

interface ContentBlock {
  type: "paragraph" | "code" | "table" | "list" | "blockquote" | "other";
  content: string;
}

interface BaseSection {
  key: string;
  heading: string;
  headingPath: string;
  headings: string[];
  level: number;
  parentBaseKey?: string;
  content: string;
  sourcePath?: string;
  libraryId?: string;
  libraryVersion?: string;
  includeHeadingInChunkContent: boolean;
  headinglessDoc: boolean;
  pageStart?: number;
  pageEnd?: number;
  noteNumber?: string;
  noteTitle?: string;
  noteSubsection?: string;
  continued?: boolean;
}

export interface KnowledgeSectionNode {
  id: string;
  documentId: string;
  groupId: string;
  parentSectionId?: string | null;
  prevSectionId?: string | null;
  nextSectionId?: string | null;
  heading: string;
  headingPath: string;
  headings?: string[];
  level: number;
  partIndex: number;
  partCount: number;
  content: string;
  summary: string;
  tokenCount: number;
  sourcePath?: string;
  libraryId?: string;
  libraryVersion?: string;
  includeHeadingInChunkContent?: boolean;
  pageStart?: number;
  pageEnd?: number;
  canonicalTitle?: string;
  noteNumber?: string;
  noteTitle?: string;
  noteSubsection?: string;
  continued?: boolean;
}

function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.35));
}

function cleanText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[^\S\n]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
}

function extractSourcePath(
  headingPath: string | undefined,
  content: string,
): string | undefined {
  const headingMatch = headingPath?.match(
    /([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]{1,10})/,
  );
  if (headingMatch?.[1]) return headingMatch[1];

  const contentMatch = content.match(
    /(?:^|\s)([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]{1,10})(?:\s|$)/m,
  );
  if (contentMatch?.[1]) return contentMatch[1];

  return undefined;
}

function extractLibraryVersion(text: string): string | undefined {
  const match = text.match(/\bv?\d+\.\d+(?:\.\d+)?(?:-[A-Za-z0-9.-]+)?\b/);
  return match?.[0];
}

function extractLibraryId(headingBreadcrumb: string[]): string | undefined {
  const root = headingBreadcrumb[0]?.trim();
  if (!root) return undefined;

  const cleaned = root
    .replace(/\bv?\d+\.\d+(?:\.\d+)?(?:-[A-Za-z0-9.-]+)?\b/g, "")
    .replace(/[^\w\-./ ]+/g, " ")
    .trim();
  if (!cleaned) return undefined;

  return cleaned
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isLikelyStructuredHeading(text: string): boolean {
  const heading = text.trim();
  if (!heading) return false;
  if (matchFinancialNoteHeading(heading) || matchFinancialSubsection(heading)) {
    return true;
  }
  if (heading.length < 2 || heading.length > 140) return false;

  const alphaCount = (heading.match(/[A-Za-z]/g) ?? []).length;
  const digitCount = (heading.match(/\d/g) ?? []).length;
  if (alphaCount < 2) return false;
  if (digitCount > alphaCount) return false;
  if (
    /(?:rp|usd|\d{1,3}(?:[.,]\d{3}){1,}|jumlah|saldo awal|saldo akhir)/i.test(
      heading,
    )
  ) {
    return false;
  }
  if (heading.includes("|")) return false;
  return true;
}

function splitIntoSections(markdown: string): ParsedSection[] {
  const lines = markdown.split("\n");
  const sections: ParsedSection[] = [];
  const headingStack: Array<{ level: number; text: string }> = [];
  let currentHeading = "";
  let currentLevel = 0;
  let currentLines: string[] = [];
  let inCodeFence = false;
  let currentPage = 1;
  let currentPageStart = 1;
  let currentPageEnd = 1;

  const flushSection = () => {
    const content = currentLines.join("\n").trim();
    if (!content.length) return;
    sections.push({
      heading: currentHeading,
      headingLevel: currentLevel,
      headingBreadcrumb:
        headingStack.length > 0 ? headingStack.map((item) => item.text) : [],
      content,
      pageStart: currentPageStart,
      pageEnd: currentPageEnd,
    });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const pageMarker = !inCodeFence ? parsePageMarker(trimmed) : null;
    if (pageMarker !== null) {
      currentPage = pageMarker;
      if (currentLines.length === 0) {
        currentPageStart = pageMarker;
      }
      continue;
    }
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      currentLines.push(line);
      currentPageEnd = currentPage;
      continue;
    }

    const headingMatch = !inCodeFence ? line.match(/^(#{1,6})\s+(.+)/) : null;
    if (!headingMatch) {
      currentLines.push(line);
      currentPageEnd = currentPage;
      continue;
    }

    if (!isLikelyStructuredHeading(headingMatch[2])) {
      currentLines.push(line);
      currentPageEnd = currentPage;
      continue;
    }

    flushSection();
    currentLines = [];
    currentPageStart = currentPage;
    currentPageEnd = currentPage;

    const level = headingMatch[1].length;
    const text = headingMatch[2].trim();
    while (
      headingStack.length > 0 &&
      headingStack[headingStack.length - 1].level >= level
    ) {
      headingStack.pop();
    }
    headingStack.push({ level, text });
    currentHeading = text;
    currentLevel = level;
  }

  flushSection();
  return sections;
}

function splitIntoFinancialSections(markdown: string): ParsedSection[] {
  type ActiveSection = {
    heading: string;
    headingLevel: number;
    headingBreadcrumb: string[];
    lines: string[];
    pageStart: number;
    pageEnd: number;
    noteNumber?: string;
    noteTitle?: string;
    noteSubsection?: string;
    continued?: boolean;
  };

  const sections: ParsedSection[] = [];
  const lines = markdown.split("\n");
  let inCodeFence = false;
  let currentPage = 1;
  let introLines: string[] = [];
  let introPageStart = 1;
  let introPageEnd = 1;
  let active: ActiveSection | null = null;

  const flushIntro = () => {
    const content = introLines.join("\n").trim();
    if (!content) return;
    sections.push({
      heading: "Introduction",
      headingLevel: 1,
      headingBreadcrumb: ["Introduction"],
      content,
      pageStart: introPageStart,
      pageEnd: introPageEnd,
    });
    introLines = [];
  };

  const flushActive = () => {
    if (!active) return;
    const content = active.lines.join("\n").trim();
    if (content) {
      sections.push({
        heading: active.heading,
        headingLevel: active.headingLevel,
        headingBreadcrumb: active.headingBreadcrumb,
        content,
        pageStart: active.pageStart,
        pageEnd: active.pageEnd,
        noteNumber: active.noteNumber,
        noteTitle: active.noteTitle,
        noteSubsection: active.noteSubsection,
        continued: active.continued,
      });
    }
    active = null;
  };

  const startSection = (input: {
    heading: string;
    headingLevel: number;
    headingBreadcrumb: string[];
    noteNumber?: string;
    noteTitle?: string;
    noteSubsection?: string;
    continued?: boolean;
  }) => {
    flushActive();
    active = {
      ...input,
      lines: [],
      pageStart: currentPage,
      pageEnd: currentPage,
    };
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const pageMarker = !inCodeFence ? parsePageMarker(trimmed) : null;
    if (pageMarker !== null) {
      currentPage = pageMarker;
      if (!active && introLines.length === 0) {
        introPageStart = pageMarker;
      }
      continue;
    }

    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      const currentActive = active as ActiveSection | null;
      if (currentActive) {
        currentActive.lines.push(line);
        currentActive.pageEnd = currentPage;
      } else {
        introLines.push(line);
        introPageEnd = currentPage;
      }
      continue;
    }

    const noteHeading = !inCodeFence ? matchFinancialNoteHeading(line) : null;
    if (noteHeading) {
      const nextHeading = `${noteHeading.noteNumber}. ${noteHeading.noteTitle}`;
      const currentActive = active as ActiveSection | null;
      const sameNote =
        currentActive?.noteNumber === noteHeading.noteNumber &&
        currentActive?.noteTitle === noteHeading.noteTitle;

      if (sameNote && currentActive) {
        currentActive.pageEnd = currentPage;
        currentActive.continued =
          currentActive.continued || noteHeading.continued;
        continue;
      }

      flushIntro();
      startSection({
        heading: nextHeading,
        headingLevel: 2,
        headingBreadcrumb: [nextHeading],
        noteNumber: noteHeading.noteNumber,
        noteTitle: noteHeading.noteTitle,
        continued: noteHeading.continued,
      });
      continue;
    }

    const currentActive = active as ActiveSection | null;
    const subsection =
      !inCodeFence && currentActive ? matchFinancialSubsection(line) : null;
    if (
      currentActive &&
      subsection &&
      currentActive.noteNumber &&
      currentActive.noteTitle
    ) {
      const parentHeading = `${currentActive.noteNumber}. ${currentActive.noteTitle}`;
      startSection({
        heading: `${subsection.noteSubsection}. ${subsection.title}`,
        headingLevel: 3,
        headingBreadcrumb: [
          parentHeading,
          `${subsection.noteSubsection}. ${subsection.title}`,
        ],
        noteNumber: currentActive.noteNumber,
        noteTitle: currentActive.noteTitle,
        noteSubsection: subsection.noteSubsection,
        continued: currentActive.continued,
      });
      continue;
    }

    if (currentActive) {
      currentActive.lines.push(line);
      currentActive.pageEnd = currentPage;
    } else {
      if (introLines.length === 0) {
        introPageStart = currentPage;
      }
      introLines.push(line);
      introPageEnd = currentPage;
    }
  }

  flushActive();
  flushIntro();
  return sections;
}

function splitIntoBlocks(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const lines = content.split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.match(/^```/)) {
      const codeLines = [line];
      index++;
      while (index < lines.length && !lines[index].match(/^```/)) {
        codeLines.push(lines[index]);
        index++;
      }
      if (index < lines.length) codeLines.push(lines[index++]);
      blocks.push({ type: "code", content: codeLines.join("\n") });
      continue;
    }

    if (line.match(/^\|/) || line.match(/^\s*\|?\s*:?-{3,}:?\s*\|/)) {
      const tableLines = [line];
      index++;
      while (
        index < lines.length &&
        (lines[index].match(/^\|/) ||
          lines[index].match(/^\s*\|?\s*:?-{3,}:?\s*\|/))
      ) {
        tableLines.push(lines[index]);
        index++;
      }
      blocks.push({ type: "table", content: tableLines.join("\n") });
      continue;
    }

    if (line.match(/^[\s]*[-*+]\s/) || line.match(/^[\s]*\d+[.)]\s/)) {
      const listLines = [line];
      index++;
      while (
        index < lines.length &&
        (lines[index].match(/^[\s]*[-*+]\s/) ||
          lines[index].match(/^[\s]*\d+[.)]\s/) ||
          lines[index].match(/^\s{2,}/) ||
          lines[index].trim() === "")
      ) {
        listLines.push(lines[index]);
        index++;
      }
      while (
        listLines.length > 0 &&
        listLines[listLines.length - 1].trim() === ""
      ) {
        listLines.pop();
      }
      blocks.push({ type: "list", content: listLines.join("\n") });
      continue;
    }

    if (line.match(/^>/)) {
      const quoteLines = [line];
      index++;
      while (
        index < lines.length &&
        (lines[index].match(/^>/) || lines[index].trim() !== "")
      ) {
        if (!lines[index].match(/^>/) && lines[index].trim() === "") break;
        quoteLines.push(lines[index]);
        index++;
      }
      blocks.push({ type: "blockquote", content: quoteLines.join("\n") });
      continue;
    }

    if (!line.trim()) {
      index++;
      continue;
    }

    const paragraphLines = [line];
    index++;
    while (index < lines.length && lines[index].trim() !== "") {
      if (
        lines[index].match(/^```/) ||
        lines[index].match(/^\|/) ||
        lines[index].match(/^[\s]*[-*+]\s/) ||
        lines[index].match(/^[\s]*\d+[.)]\s/) ||
        lines[index].match(/^>/)
      ) {
        break;
      }
      paragraphLines.push(lines[index]);
      index++;
    }
    blocks.push({ type: "paragraph", content: paragraphLines.join("\n") });
  }

  return blocks;
}

function findBestBreakPoint(
  text: string,
  targetEnd: number,
  minPos: number,
): number {
  const paragraphBreak = text.lastIndexOf("\n\n", targetEnd);
  if (paragraphBreak > minPos) return paragraphBreak + 2;

  const sentenceRegex = /[.!?][\s\n]/g;
  let lastSentenceEnd = -1;
  let match: RegExpExecArray | null;
  while ((match = sentenceRegex.exec(text)) !== null) {
    if (match.index > targetEnd) break;
    if (match.index > minPos) lastSentenceEnd = match.index + 1;
  }
  if (lastSentenceEnd > minPos) return lastSentenceEnd;

  const lineBreak = text.lastIndexOf("\n", targetEnd);
  if (lineBreak > minPos) return lineBreak + 1;

  const clauseRegex = /[;,:]\s/g;
  let lastClauseEnd = -1;
  while ((match = clauseRegex.exec(text)) !== null) {
    if (match.index > targetEnd) break;
    if (match.index > minPos) lastClauseEnd = match.index + 1;
  }
  if (lastClauseEnd > minPos) return lastClauseEnd;

  const wordBreak = text.lastIndexOf(" ", targetEnd);
  if (wordBreak > minPos) return wordBreak + 1;

  return targetEnd;
}

function splitOversizedText(text: string, targetTokens: number): string[] {
  const chunkChars = targetTokens * 4;
  const parts: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkChars, text.length);
    if (end < text.length) {
      const minPos = start + Math.floor(chunkChars * 0.5);
      end = findBestBreakPoint(text, end, minPos);
    }
    const piece = text.slice(start, end).trim();
    if (piece) parts.push(piece);
    if (end <= start) break;
    start = end;
  }

  return parts;
}

function splitSectionContent(content: string): string[] {
  const totalTokens = estimateTokens(content);
  if (totalTokens <= MAX_SECTION_TOKENS) {
    return [content.trim()];
  }

  const blocks = splitIntoBlocks(content);
  const parts: string[] = [];
  let buffer: string[] = [];
  let bufferTokens = 0;

  const flush = () => {
    const value = buffer.join("\n\n").trim();
    if (value) parts.push(value);
    buffer = [];
    bufferTokens = 0;
  };

  for (const block of blocks) {
    const blockText = block.content.trim();
    if (!blockText) continue;
    const blockTokens = estimateTokens(blockText);

    if (blockTokens > MAX_SECTION_TOKENS) {
      if (bufferTokens > 0) flush();
      parts.push(...splitOversizedText(blockText, TARGET_SECTION_PART_TOKENS));
      continue;
    }

    if (
      bufferTokens > 0 &&
      bufferTokens + blockTokens > TARGET_SECTION_PART_TOKENS &&
      bufferTokens >= Math.floor(TARGET_SECTION_PART_TOKENS * 0.5)
    ) {
      flush();
    }

    buffer.push(blockText);
    bufferTokens += blockTokens;
  }

  if (bufferTokens > 0) flush();

  return parts.length > 0
    ? parts
    : splitOversizedText(content, TARGET_SECTION_PART_TOKENS);
}

function stripInlineMarkdown(text: string): string {
  return text
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
  const cleaned = stripInlineMarkdown(text);
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

function extractFirstMeaningfulParagraph(content: string): string | null {
  const blocks = splitIntoBlocks(content);
  for (const block of blocks) {
    if (block.type !== "paragraph" && block.type !== "blockquote") continue;
    const paragraph = stripInlineMarkdown(block.content);
    if (paragraph.length >= 30) return paragraph;
  }
  return null;
}

function buildSectionSummary(
  headingPath: string,
  content: string,
  parentHeadingPath?: string,
): string {
  const paragraph = extractFirstMeaningfulParagraph(content);
  const parts = [
    `Section: ${headingPath}.`,
    parentHeadingPath ? `Parent: ${parentHeadingPath}.` : "",
    paragraph ? trimTextToTokenLimit(paragraph, SUMMARY_TOKEN_LIMIT - 20) : "",
  ].filter(Boolean);

  return trimTextToTokenLimit(parts.join(" "), SUMMARY_TOKEN_LIMIT);
}

function createBaseSections(
  markdown: string,
  classification?: FinancialStatementClassification | null,
): BaseSection[] {
  const resolvedClassification =
    classification ?? classifyFinancialStatementDocument({ markdown });
  const parsed =
    resolvedClassification.isFinancialStatement &&
    resolvedClassification.noteHeadingCount >= 1
      ? splitIntoFinancialSections(markdown)
      : splitIntoSections(markdown);
  const hasHeadings = parsed.some(
    (section) => section.headingLevel > 0 && section.heading.length > 0,
  );

  if (!hasHeadings) {
    const headinglessContent =
      parsed
        .map((section) => section.content)
        .filter(Boolean)
        .join("\n\n") || markdown;
    return [
      {
        key: "headingless",
        heading: "Part 1",
        headingPath: "Part 1",
        headings: ["Part 1"],
        level: 1,
        content: headinglessContent,
        sourcePath: extractSourcePath(undefined, headinglessContent),
        includeHeadingInChunkContent: false,
        headinglessDoc: true,
        pageStart: parsed[0]?.pageStart ?? 1,
        pageEnd:
          parsed[parsed.length - 1]?.pageEnd ?? parsed[0]?.pageStart ?? 1,
        noteNumber: undefined,
        noteTitle: undefined,
        noteSubsection: undefined,
        continued: false,
      },
    ];
  }

  const baseSections: BaseSection[] = [];
  for (const section of parsed) {
    const headingPath =
      section.headingBreadcrumb.length > 0
        ? section.headingBreadcrumb.join(" > ")
        : "Introduction";
    const heading =
      section.headingLevel > 0 && section.heading
        ? section.heading
        : "Introduction";
    const level =
      section.headingLevel > 0 && section.heading ? section.headingLevel : 1;
    const headings =
      section.headingBreadcrumb.length > 0
        ? section.headingBreadcrumb
        : ["Introduction"];
    const parentBaseKey =
      section.headingBreadcrumb.length > 1
        ? section.headingBreadcrumb.slice(0, -1).join(" > ")
        : undefined;
    const content = section.content.trim();
    if (!content) continue;

    baseSections.push({
      key: headingPath,
      heading,
      headingPath,
      headings,
      level,
      parentBaseKey:
        heading === "Introduction" && headingPath === "Introduction"
          ? undefined
          : parentBaseKey,
      content,
      sourcePath: extractSourcePath(
        headingPath,
        `${"#".repeat(level)} ${heading}\n\n${content}`,
      ),
      libraryId: extractLibraryId(section.headingBreadcrumb),
      libraryVersion: extractLibraryVersion(
        [section.heading, headingPath].filter(Boolean).join(" "),
      ),
      includeHeadingInChunkContent: heading !== "Introduction",
      headinglessDoc: false,
      pageStart: section.pageStart,
      pageEnd: section.pageEnd,
      noteNumber: section.noteNumber,
      noteTitle: section.noteTitle,
      noteSubsection: section.noteSubsection,
      continued: section.continued,
    });
  }

  return baseSections;
}

export function buildKnowledgeSectionGraph(
  markdown: string,
  documentId: string,
  groupId: string,
  options: {
    canonicalTitle?: string | null;
    classification?: FinancialStatementClassification | null;
  } = {},
): KnowledgeSectionNode[] {
  const cleaned = cleanText(markdown);
  if (!cleaned) return [];

  const baseSections = createBaseSections(cleaned, options.classification);
  if (baseSections.length === 0) return [];

  const expanded = baseSections.map((base) => {
    const parts = splitSectionContent(base.content).filter(Boolean);
    return { base, parts: parts.length > 0 ? parts : [base.content] };
  });

  const firstSectionIdByBaseKey = new Map<string, string>();
  const allSections: Array<KnowledgeSectionNode & { baseKey: string }> = [];

  for (const { base, parts } of expanded) {
    const partIds = parts.map(() => generateUUID());
    firstSectionIdByBaseKey.set(base.key, partIds[0]);

    parts.forEach((part, index) => {
      const partNumber = index + 1;
      const heading = base.headinglessDoc ? `Part ${partNumber}` : base.heading;
      const headingPath = base.headinglessDoc
        ? `Part ${partNumber}`
        : base.headingPath;

      allSections.push({
        id: partIds[index],
        documentId,
        groupId,
        baseKey: base.key,
        heading,
        headingPath,
        headings: base.headinglessDoc ? [heading] : base.headings,
        level: base.level,
        partIndex: index,
        partCount: parts.length,
        content: part,
        summary: "",
        tokenCount: estimateTokens(part),
        sourcePath: base.sourcePath,
        libraryId: base.libraryId,
        libraryVersion: base.libraryVersion,
        includeHeadingInChunkContent: base.includeHeadingInChunkContent,
        pageStart: base.pageStart,
        pageEnd: base.pageEnd,
        canonicalTitle: options.canonicalTitle ?? undefined,
        noteNumber: base.noteNumber,
        noteTitle: base.noteTitle,
        noteSubsection: base.noteSubsection,
        continued: base.continued,
      });
    });
  }

  const parentHeadingPathByBaseKey = new Map(
    baseSections.map((base) => [base.key, base.parentBaseKey]),
  );

  for (let index = 0; index < allSections.length; index++) {
    const section = allSections[index];
    const parentBaseKey = parentHeadingPathByBaseKey.get(section.baseKey);
    section.parentSectionId = parentBaseKey
      ? (firstSectionIdByBaseKey.get(parentBaseKey) ?? null)
      : null;
    section.prevSectionId = index > 0 ? allSections[index - 1].id : null;
    section.nextSectionId =
      index < allSections.length - 1 ? allSections[index + 1].id : null;
    const parentHeadingPath = parentBaseKey || undefined;
    section.summary = buildSectionSummary(
      section.headingPath,
      section.content,
      parentHeadingPath,
    );
  }

  return allSections.map(({ baseKey: _baseKey, ...section }) => section);
}
