import type { UIMessage } from "ai";
import type {
  ChatKnowledgeCitation,
  ChatKnowledgeSource,
  ChatMetadata,
} from "app-types/chat";
import {
  countLegalReferenceOverlap,
  extractLegalReferenceKeys,
  normalizeLegalReferenceText,
} from "lib/knowledge/legal-references";
import type { DocRetrievalResult } from "lib/knowledge/retriever";

type RetrievedKnowledgeGroup = {
  groupId: string;
  groupName: string;
  docs: DocRetrievalResult[];
};

type CitationValidationIssue = {
  lineIndex: number;
  line: string;
};

function stripCitationControlMarkers(value: string): string {
  return value
    .replace(/<!--CTX[_ ]PAGE:\d+-->/gi, " ")
    .replace(/^CTX_IMAGE_\d+\s*$/gim, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function inferCitationPageNumber(value: string): number | null {
  const match = value.match(/<!--CTX[_ ]PAGE:(\d+)-->/i);
  if (!match?.[1]) return null;

  const pageNumber = Number.parseInt(match[1], 10);
  return Number.isFinite(pageNumber) ? pageNumber : null;
}

export type CitationValidationResult = {
  isValid: boolean;
  missingCitations: CitationValidationIssue[];
  invalidCitationNumbers: number[];
  usedCitationNumbers: number[];
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkdown(value: string): string {
  return normalizeWhitespace(
    stripCitationControlMarkers(value)
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`[^`\n]+`/g, " ")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^[#>\-\s]+/gm, "")
      .replace(/[*_~]+/g, " ")
      .replace(/\|/g, " "),
  );
}

function trimExcerpt(value: string, maxLength = 280): string {
  const normalized = stripMarkdown(value);
  if (normalized.length <= maxLength) return normalized;

  const cut = normalized.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.7 ? cut.slice(0, lastSpace) : cut).trim()}...`;
}

function buildFallbackCitationExcerpt(doc: DocRetrievalResult): string {
  return trimExcerpt(doc.markdown);
}

function buildFallbackCitationHeading(doc: DocRetrievalResult): string | null {
  return doc.matchedSections?.[0]?.heading ?? null;
}

export function buildKnowledgeCitationKey(
  citation: Omit<ChatKnowledgeCitation, "number"> | ChatKnowledgeCitation,
) {
  return [
    citation.groupId,
    citation.documentId,
    citation.versionId ?? "",
    citation.sectionId ?? "",
    citation.pageStart ?? "",
    citation.pageEnd ?? "",
    citation.sectionHeading ?? "",
    citation.excerpt.toLowerCase(),
  ].join("::");
}

function isChatKnowledgeCitation(
  value: unknown,
): value is ChatKnowledgeCitation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const citation = value as Partial<ChatKnowledgeCitation>;
  return (
    typeof citation.number === "number" &&
    Number.isFinite(citation.number) &&
    typeof citation.groupId === "string" &&
    typeof citation.groupName === "string" &&
    typeof citation.documentId === "string" &&
    typeof citation.documentName === "string" &&
    typeof citation.excerpt === "string" &&
    typeof citation.relevanceScore === "number" &&
    Number.isFinite(citation.relevanceScore)
  );
}

function dedupeKnowledgeCitations(
  citations: ChatKnowledgeCitation[],
): ChatKnowledgeCitation[] {
  const deduped = new Map<string, ChatKnowledgeCitation>();

  for (const citation of citations) {
    const key = buildKnowledgeCitationKey(citation);
    if (!deduped.has(key)) {
      deduped.set(key, citation);
    }
  }

  return Array.from(deduped.values()).sort((left, right) => {
    if (left.number !== right.number) {
      return left.number - right.number;
    }

    return buildKnowledgeCitationKey(left).localeCompare(
      buildKnowledgeCitationKey(right),
    );
  });
}

function extractToolOutputKnowledgeCitations(
  parts: UIMessage["parts"],
): ChatKnowledgeCitation[] {
  return dedupeKnowledgeCitations(
    parts.flatMap((part) => {
      if (!("output" in part)) {
        return [];
      }

      const citations = (part.output as { citations?: unknown } | undefined)
        ?.citations;
      if (!Array.isArray(citations)) {
        return [];
      }

      return citations.filter(isChatKnowledgeCitation);
    }),
  );
}

export function getMessageKnowledgeCitations(message: UIMessage) {
  const metadata = message.metadata as ChatMetadata | undefined;
  const metadataCitations = Array.isArray(metadata?.knowledgeCitations)
    ? metadata.knowledgeCitations.filter(isChatKnowledgeCitation)
    : [];
  const toolOutputCitations = extractToolOutputKnowledgeCitations(
    message.parts,
  );

  if (!metadataCitations.length) {
    return toolOutputCitations;
  }

  if (!toolOutputCitations.length) {
    return metadataCitations;
  }

  return dedupeKnowledgeCitations([
    ...metadataCitations,
    ...toolOutputCitations,
  ]);
}

export function buildKnowledgeCitations(input: {
  retrievedGroups: RetrievedKnowledgeGroup[];
}): ChatKnowledgeCitation[] {
  const deduped = new Map<string, Omit<ChatKnowledgeCitation, "number">>();

  for (const group of input.retrievedGroups) {
    for (const doc of group.docs) {
      const candidates =
        doc.citationCandidates && doc.citationCandidates.length > 0
          ? doc.citationCandidates
          : [
              {
                versionId: doc.versionId ?? null,
                sectionId: null,
                sectionHeading: buildFallbackCitationHeading(doc),
                pageStart: null,
                pageEnd: null,
                excerpt: buildFallbackCitationExcerpt(doc),
                relevanceScore: doc.relevanceScore,
              },
            ];

      for (const candidate of candidates) {
        const inferredPageNumber =
          candidate.pageStart == null && candidate.pageEnd == null
            ? inferCitationPageNumber(candidate.excerpt)
            : null;
        const citation = {
          groupId: group.groupId,
          groupName: group.groupName,
          documentId: doc.documentId,
          documentName: doc.documentName,
          sourceGroupId: doc.sourceGroupId ?? null,
          sourceGroupName: doc.sourceGroupName ?? null,
          isInherited: doc.isInherited,
          versionId: candidate.versionId ?? doc.versionId ?? null,
          sectionId: candidate.sectionId ?? null,
          sectionHeading: candidate.sectionHeading ?? null,
          pageStart: candidate.pageStart ?? inferredPageNumber ?? null,
          pageEnd: candidate.pageEnd ?? inferredPageNumber ?? null,
          excerpt: trimExcerpt(candidate.excerpt),
          relevanceScore: candidate.relevanceScore,
        } satisfies Omit<ChatKnowledgeCitation, "number">;

        const key = buildKnowledgeCitationKey(citation);
        if (!deduped.has(key)) {
          deduped.set(key, citation);
        }
      }
    }
  }

  return Array.from(deduped.values()).map((citation, index) => ({
    ...citation,
    number: index + 1,
  }));
}

export function buildKnowledgeSourcesFromCitations(
  citations: ChatKnowledgeCitation[],
): ChatKnowledgeSource[] {
  const deduped = new Map<string, ChatKnowledgeSource>();

  for (const citation of citations) {
    const key = `${citation.groupId}:${citation.documentId}`;
    const existing = deduped.get(key);
    const matchedSection = citation.sectionHeading
      ? [citation.sectionHeading]
      : undefined;

    if (!existing) {
      deduped.set(key, {
        groupId: citation.groupId,
        groupName: citation.groupName,
        documentId: citation.documentId,
        documentName: citation.documentName,
        sourceGroupId: citation.sourceGroupId ?? null,
        sourceGroupName: citation.sourceGroupName ?? null,
        isInherited: citation.isInherited,
        matchedSections: matchedSection,
      });
      continue;
    }

    deduped.set(key, {
      ...existing,
      matchedSections: Array.from(
        new Set([
          ...(existing.matchedSections ?? []),
          ...(matchedSection ?? []),
        ]),
      ).slice(0, 3),
    });
  }

  return Array.from(deduped.values());
}

export function buildKnowledgeCitationPageLabel(input: {
  pageStart?: number | null;
  pageEnd?: number | null;
}): string | null {
  const pageStart = input.pageStart ?? null;
  const pageEnd = input.pageEnd ?? null;
  if (!pageStart && !pageEnd) return null;
  if (pageStart && pageEnd && pageStart !== pageEnd) {
    return `Pages ${pageStart}-${pageEnd}`;
  }
  return `Page ${pageStart ?? pageEnd}`;
}

export function formatKnowledgeEvidencePack(
  citations: ChatKnowledgeCitation[],
): string {
  if (!citations.length) return "";

  return [
    "<knowledge_evidence_pack>",
    ...citations.map((citation) =>
      [
        `[${citation.number}] ${citation.documentName}`,
        citation.sectionHeading ? `Section: ${citation.sectionHeading}` : "",
        buildKnowledgeCitationPageLabel(citation),
        `Excerpt: ${citation.excerpt}`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    "</knowledge_evidence_pack>",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function splitTextAndCodeSegments(markdown: string) {
  const segments: Array<{ type: "text" | "code"; value: string }> = [];
  const fenceRegex = /```[\s\S]*?```/g;
  let lastIndex = 0;

  for (const match of markdown.matchAll(fenceRegex)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({
        type: "text",
        value: markdown.slice(lastIndex, start),
      });
    }
    segments.push({ type: "code", value: match[0] });
    lastIndex = start + match[0].length;
  }

  if (lastIndex < markdown.length) {
    segments.push({ type: "text", value: markdown.slice(lastIndex) });
  }

  return segments;
}

function extractCitationNumbers(value: string): number[] {
  return Array.from(value.matchAll(/\[(\d+)\](?!\()/g))
    .map((match) => Number.parseInt(match[1] ?? "", 10))
    .filter((value) => Number.isFinite(value));
}

function dedupeCitationNumbers(value: number[]): number[] {
  return Array.from(new Set(value));
}

function formatCitationSequence(value: number[]): string {
  return dedupeCitationNumbers(value)
    .map((citationNumber) => `[${citationNumber}]`)
    .join("");
}

function appendCitationSequence(line: string, sequence: string): string {
  const trimmed = line.trim();
  if (!trimmed) return sequence;

  const terminalPunctuationMatch = trimmed.match(/([.!?])([)"'\]]*)$/);
  if (terminalPunctuationMatch) {
    const suffix = `${terminalPunctuationMatch[1]}${terminalPunctuationMatch[2]}`;
    const body = trimmed.slice(0, -suffix.length).trimEnd();
    return body ? `${body} ${sequence}${suffix}` : `${sequence}${suffix}`;
  }

  return `${trimmed} ${sequence}`;
}

function isCitationOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return trimmed.replace(/\[(\d+)\](?!\()/g, "").trim() === "";
}

function normalizeCitationLine(line: string): string {
  return line
    .trim()
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/^(\*\*|__)(.+)\1$/, "$2")
    .replace(/^(\*|_)(.+)\1$/, "$2")
    .trim();
}

function shouldRequireCitation(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (isCitationOnlyLine(trimmed)) return false;
  if (/^#{1,6}\s/.test(trimmed)) return false;
  if (/^\|/.test(trimmed)) return false;
  if (/^[-*_]{3,}$/.test(trimmed)) return false;
  if (/^>\s?$/.test(trimmed)) return false;

  const normalized = normalizeCitationLine(trimmed);
  if (!/[\p{L}\p{N}]/u.test(normalized)) return false;
  if (/^[\p{L}\p{N}_-]+:$/u.test(normalized)) return false;
  if (normalized.length < 8) return false;

  return true;
}

function splitInlineCodeSegments(line: string) {
  return line.split(/(`[^`\n]+`)/g);
}

function replaceCitationMarkersInLine(
  line: string,
  citationsByNumber: Map<number, ChatKnowledgeCitation>,
): string {
  return splitInlineCodeSegments(line)
    .map((segment) => {
      if (segment.startsWith("`") && segment.endsWith("`")) {
        return segment;
      }

      return segment.replace(/\[(\d+)\](?!\()/g, (full, rawNumber) => {
        const citationNumber = Number.parseInt(rawNumber, 10);
        const citation = citationsByNumber.get(citationNumber);
        if (!citation) return full;
        return `[${citationNumber}](${buildKnowledgeCitationHref(citation)})`;
      });
    })
    .join("");
}

function normalizeCitationInlineMarkers(line: string): string {
  if (line.includes("`")) return line.trimEnd();
  const numbers = extractCitationNumbers(line);
  if (numbers.length === 0) return line.trimEnd();
  const base = stripAllCitationMarkers(line);
  const formatted = formatCitationSequence(numbers);
  if (!base) return formatted;
  return appendCitationSequence(base, formatted);
}

function normalizeCitationMarkersForDisplay(text: string): string {
  return splitTextAndCodeSegments(text)
    .map((segment) => {
      if (segment.type === "code") return segment.value;

      return segment.value
        .split("\n")
        .map((line) => {
          if (MARKDOWN_TABLE_SEPARATOR_RE.test(line.trim())) {
            return line;
          }

          const parsedTableRow = parseMarkdownTableRow(line);
          if (!parsedTableRow) {
            return normalizeCitationInlineMarkers(line);
          }

          return joinMarkdownTableRow(
            parsedTableRow,
            parsedTableRow.cells.map((cell) =>
              normalizeCitationInlineMarkers(cell),
            ),
          );
        })
        .join("\n");
    })
    .join("");
}

function mergeDetachedCitationLines(text: string): string {
  const lines = text.split("\n");
  const nextLines: string[] = [];

  for (const line of lines) {
    if (isCitationOnlyLine(line)) {
      const citationNumbers = extractCitationNumbers(line);
      if (citationNumbers.length === 0) {
        continue;
      }

      const previousIndex = [...nextLines]
        .map((value, index) => [value, index] as const)
        .reverse()
        .find(([value]) => value.trim().length > 0)?.[1];

      if (previousIndex === undefined) {
        nextLines.push(normalizeCitationInlineMarkers(line));
        continue;
      }

      const previousLine = nextLines[previousIndex] ?? "";
      if (
        parseMarkdownTableRow(previousLine) != null ||
        MARKDOWN_TABLE_SEPARATOR_RE.test(previousLine.trim())
      ) {
        continue;
      }

      nextLines[previousIndex] = normalizeCitationInlineMarkers(
        `${nextLines[previousIndex]} ${formatCitationSequence(citationNumbers)}`,
      );
      continue;
    }

    if (
      parseMarkdownTableRow(line) != null ||
      MARKDOWN_TABLE_SEPARATOR_RE.test(line.trim())
    ) {
      nextLines.push(line);
      continue;
    }

    nextLines.push(normalizeCitationInlineMarkers(line));
  }

  return nextLines.join("\n");
}

function normalizeDocumentTitleForAppendixMatch(value: string): string {
  return normalizeWhitespace(value)
    .replace(/[^a-z0-9\s]/gi, " ")
    .toLowerCase();
}

function isLikelyCitationAppendixLine(
  line: string,
  citations: ChatKnowledgeCitation[],
): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (isCitationOnlyLine(trimmed)) return true;

  const normalizedLine = normalizeDocumentTitleForAppendixMatch(
    trimmed.replace(/^\d+\.\s+/, "").replace(/^\[(\d+)\]\s+/, ""),
  );
  if (!normalizedLine) return false;

  return citations.some((citation) => {
    const normalizedDocName = normalizeDocumentTitleForAppendixMatch(
      citation.documentName,
    );
    return (
      normalizedDocName.length > 4 && normalizedLine.includes(normalizedDocName)
    );
  });
}

function stripTrailingCitationAppendix(input: {
  text: string;
  citations: ChatKnowledgeCitation[];
  preserveAppendix?: boolean;
}): string {
  if (input.preserveAppendix) return input.text;

  const lines = input.text.split("\n");
  let endIndex = lines.length;
  while (endIndex > 0 && lines[endIndex - 1]?.trim() === "") {
    endIndex -= 1;
  }
  if (endIndex === 0) return input.text;

  let blockStart = endIndex - 1;
  while (blockStart > 0 && lines[blockStart - 1]?.trim() !== "") {
    blockStart -= 1;
  }

  const block = lines.slice(blockStart, endIndex);
  const meaningful = block.filter((line) => line.trim().length > 0);
  if (
    meaningful.length === 0 ||
    !meaningful.every((line) =>
      isLikelyCitationAppendixLine(line, input.citations),
    )
  ) {
    return input.text;
  }

  const trimmedPrefix = lines.slice(0, blockStart).join("\n").trimEnd();
  return trimmedPrefix;
}

function stripEvidencePackEcho(text: string): string {
  return text
    .replace(/<\/?knowledge_evidence_pack>\s*/gi, "")
    .replace(/^Section:\s+.*$/gim, "")
    .replace(/^Excerpt:\s+.*$/gim, "")
    .replace(/^Pages?\s+\d+(?:-\d+)?\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeCitationMatchText(value: string): string {
  return normalizeLegalReferenceText(stripMarkdown(value));
}

function buildCharacterNgrams(value: string, size = 4): Set<string> {
  const compact = normalizeCitationMatchText(value).replace(/\s+/g, "");
  if (!compact) return new Set();
  if (compact.length <= size) return new Set([compact]);

  const ngrams = new Set<string>();
  for (let index = 0; index <= compact.length - size; index += 1) {
    ngrams.add(compact.slice(index, index + size));
  }
  return ngrams;
}

function extractCitationIdentifiers(value: string): Set<string> {
  return new Set(
    normalizeCitationMatchText(value)
      .match(/\b\d{2,4}\b/g)
      ?.filter((token) => token.length >= 2) ?? [],
  );
}

function tokenizeForCitationMatch(value: string): Set<string> {
  const normalized = normalizeCitationMatchText(value);
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  const expanded = new Set(tokens);

  for (const token of tokens) {
    if (token.length < 12) continue;

    for (let index = 0; index <= token.length - 5; index += 1) {
      const slice = token.slice(index, index + 5);
      if (slice.length >= 4) {
        expanded.add(slice);
      }
    }
  }

  return expanded;
}

function computeSetOverlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / left.size;
}

function buildCitationLegalReferenceSet(
  citation: ChatKnowledgeCitation,
): Set<string> {
  return extractLegalReferenceKeys(
    [citation.sectionHeading, citation.excerpt, citation.documentName]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(" "),
  );
}

function scoreCitationForLine(
  line: string,
  citation: ChatKnowledgeCitation,
): number {
  const lineTokens = tokenizeForCitationMatch(line);
  const lineNgrams = buildCharacterNgrams(line);
  if (lineTokens.size === 0 && lineNgrams.size === 0) {
    return citation.relevanceScore * 0.25;
  }

  const excerptTokens = tokenizeForCitationMatch(citation.excerpt);
  const headingTokens = tokenizeForCitationMatch(citation.sectionHeading ?? "");
  const documentTokens = tokenizeForCitationMatch(citation.documentName);
  const excerptNgrams = buildCharacterNgrams(citation.excerpt);
  const headingNgrams = buildCharacterNgrams(citation.sectionHeading ?? "");
  const lineIdentifiers = extractCitationIdentifiers(line);
  const documentIdentifiers = extractCitationIdentifiers(citation.documentName);
  const lineLegalReferences = extractLegalReferenceKeys(line);
  const citationLegalReferences = buildCitationLegalReferenceSet(citation);

  const excerptTokenOverlap = computeSetOverlap(lineTokens, excerptTokens);
  const headingTokenOverlap = computeSetOverlap(lineTokens, headingTokens);
  const documentTokenOverlap = computeSetOverlap(lineTokens, documentTokens);
  const excerptCharacterOverlap = computeSetOverlap(lineNgrams, excerptNgrams);
  const headingCharacterOverlap = computeSetOverlap(lineNgrams, headingNgrams);
  const documentIdentifierOverlap = computeSetOverlap(
    lineIdentifiers,
    documentIdentifiers,
  );
  const legalReferenceOverlap = countLegalReferenceOverlap(
    lineLegalReferences,
    citationLegalReferences,
  );
  const hasConflictingLegalReferences =
    lineLegalReferences.size > 0 &&
    citationLegalReferences.size > 0 &&
    legalReferenceOverlap === 0;
  const missingLegalReferenceSignal =
    lineLegalReferences.size > 0 && citationLegalReferences.size === 0;

  return (
    excerptTokenOverlap * 8 +
    excerptCharacterOverlap * 6 +
    documentIdentifierOverlap * 12 +
    legalReferenceOverlap * 36 +
    headingTokenOverlap * 1.75 +
    headingCharacterOverlap * 1.25 +
    documentTokenOverlap * 0.75 +
    citation.relevanceScore * 0.25 -
    (hasConflictingLegalReferences ? 24 : 0) -
    (missingLegalReferenceSignal ? 4 : 0)
  );
}

type RankedCitationForLine = {
  citation: ChatKnowledgeCitation;
  score: number;
};

function rankCitationsForLine(
  line: string,
  citations: ChatKnowledgeCitation[],
): RankedCitationForLine[] {
  if (!citations.length) return [];

  return citations
    .map((citation) => ({
      citation,
      score: scoreCitationForLine(line, citation),
    }))
    .sort((left, right) => right.score - left.score);
}

function pickBestCitationsForLine(
  line: string,
  citations: ChatKnowledgeCitation[],
  options?: {
    maxCount?: number;
  },
): ChatKnowledgeCitation[] {
  const ranked = rankCitationsForLine(line, citations);
  if (!ranked.length) return [];

  const top = ranked[0];
  if (!top || top.score <= 0) return [];
  if ((options?.maxCount ?? 2) <= 1) {
    return [top.citation];
  }

  const selected = [top];
  const second = ranked.find(
    (entry) =>
      entry.citation.number !== top.citation.number &&
      entry.score > 0 &&
      entry.score >= top.score * 0.72 &&
      (entry.citation.documentId !== top.citation.documentId ||
        entry.citation.pageStart !== top.citation.pageStart ||
        entry.citation.pageEnd !== top.citation.pageEnd ||
        entry.citation.sectionId !== top.citation.sectionId),
  );

  if (second) {
    selected.push(second);
  }

  return selected.map((entry) => entry.citation);
}

function scoreCitationSelectionForLine(
  line: string,
  citations: ChatKnowledgeCitation[],
): number {
  return citations.reduce(
    (total, citation) => total + scoreCitationForLine(line, citation),
    0,
  );
}

function stripAllCitationMarkers(line: string): string {
  return line
    .replace(/\s*\[(\d+)\](?!\()/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sameCitationSet(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

const MARKDOWN_TABLE_SEPARATOR_RE =
  /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;

function parseMarkdownTableRow(line: string): {
  indent: string;
  trailingWhitespace: string;
  leadingPipe: boolean;
  trailingPipe: boolean;
  cells: string[];
} | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  if (MARKDOWN_TABLE_SEPARATOR_RE.test(trimmed)) return null;

  const leadingPipe = trimmed.startsWith("|");
  const trailingPipe = trimmed.endsWith("|");
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = inner.split("|").map((cell) => cell.trim());
  if (cells.length < 2) return null;

  return {
    indent: line.match(/^\s*/)?.[0] ?? "",
    trailingWhitespace: line.match(/\s*$/)?.[0] ?? "",
    leadingPipe,
    trailingPipe,
    cells,
  };
}

function isMarkdownTableHeaderRow(lines: string[], lineIndex: number): boolean {
  for (let index = lineIndex + 1; index < lines.length; index += 1) {
    const candidate = lines[index] ?? "";
    if (!candidate.trim()) continue;
    if (isCitationOnlyLine(candidate)) continue;
    return MARKDOWN_TABLE_SEPARATOR_RE.test(candidate.trim());
  }

  return false;
}

function stripCitationMarkersFromTableRow(line: string): string {
  const parsed = parseMarkdownTableRow(line);
  if (!parsed) return stripAllCitationMarkers(line);

  return joinMarkdownTableRow(
    parsed,
    parsed.cells.map((cell) => stripAllCitationMarkers(cell)),
  );
}

function sanitizeMarkdownTableStructure(text: string): string {
  const lines = text.split("\n");
  const nextLines: string[] = [];
  let activeTableColumnCount: number | null = null;

  for (const [index, line] of lines.entries()) {
    if (MARKDOWN_TABLE_SEPARATOR_RE.test(line.trim())) {
      nextLines.push(line);
      continue;
    }

    const parsedTableRow = parseMarkdownTableRow(line);
    if (!parsedTableRow) {
      if (isCitationOnlyLine(line)) {
        const previousLine = nextLines[nextLines.length - 1] ?? "";
        const nextNonEmptyLine = lines
          .slice(index + 1)
          .find((candidate) => candidate.trim().length > 0);
        if (
          parseMarkdownTableRow(previousLine) != null ||
          MARKDOWN_TABLE_SEPARATOR_RE.test(previousLine.trim()) ||
          parseMarkdownTableRow(nextNonEmptyLine ?? "") != null ||
          MARKDOWN_TABLE_SEPARATOR_RE.test((nextNonEmptyLine ?? "").trim())
        ) {
          continue;
        }
      }

      if (line.trim() === "") {
        activeTableColumnCount = null;
      }
      nextLines.push(line);
      continue;
    }

    if (isMarkdownTableHeaderRow(lines, index)) {
      const sanitizedCells = [...parsedTableRow.cells];
      while (
        sanitizedCells.length > 2 &&
        stripAllCitationMarkers(sanitizedCells[sanitizedCells.length - 1] ?? "")
          .length === 0
      ) {
        sanitizedCells.pop();
      }
      const strippedCells = sanitizedCells.map((cell) =>
        stripAllCitationMarkers(cell),
      );
      activeTableColumnCount = strippedCells.length;
      nextLines.push(joinMarkdownTableRow(parsedTableRow, strippedCells));
      continue;
    }

    if (activeTableColumnCount != null) {
      const sanitizedCells = [...parsedTableRow.cells];
      while (sanitizedCells.length > activeTableColumnCount) {
        const lastCell = sanitizedCells[sanitizedCells.length - 1] ?? "";
        if (stripAllCitationMarkers(lastCell).length > 0) {
          break;
        }
        sanitizedCells.pop();
      }
      nextLines.push(joinMarkdownTableRow(parsedTableRow, sanitizedCells));
      continue;
    }

    nextLines.push(line);
  }

  return nextLines.join("\n");
}

function joinMarkdownTableRow(
  row: NonNullable<ReturnType<typeof parseMarkdownTableRow>>,
  cells: string[],
) {
  return `${row.indent}${row.leadingPipe ? "| " : ""}${cells.join(" | ")}${row.trailingPipe ? " |" : ""}${row.trailingWhitespace}`;
}

function buildTableCellScoringText(input: {
  rowLabel?: string | null;
  columnLabel?: string | null;
  cell: string;
}) {
  return [input.columnLabel, input.rowLabel, input.cell]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");
}

function enforceCitationCoverageForSpan(input: {
  text: string;
  citations: ChatKnowledgeCitation[];
  scoringText?: string;
  maxCount?: number;
}): string {
  const cleanedLine = input.text.replace(/\[(\d+)\](?!\()/g, (full, raw) => {
    const citationNumber = Number.parseInt(raw, 10);
    return input.citations.some(
      (citation) => citation.number === citationNumber,
    )
      ? full
      : "";
  });
  const baseLine = stripAllCitationMarkers(cleanedLine);
  const scoringText = input.scoringText?.trim() || baseLine;
  const existingCitationNumbers = dedupeCitationNumbers(
    extractCitationNumbers(cleanedLine),
  );
  const existingCitations = existingCitationNumbers
    .map((citationNumber) =>
      input.citations.find((citation) => citation.number === citationNumber),
    )
    .filter((citation): citation is ChatKnowledgeCitation => citation != null);
  const recommendedCitations = pickBestCitationsForLine(
    scoringText,
    input.citations,
    {
      maxCount: input.maxCount,
    },
  );

  if (existingCitations.length > 0) {
    const normalizedExistingLine = appendCitationSequence(
      baseLine,
      formatCitationSequence(existingCitationNumbers),
    );
    if (!recommendedCitations.length) {
      return normalizedExistingLine;
    }

    const recommendedNumbers = recommendedCitations.map(
      (citation) => citation.number,
    );
    if (sameCitationSet(existingCitationNumbers, recommendedNumbers)) {
      return normalizedExistingLine;
    }

    const existingScore = scoreCitationSelectionForLine(
      scoringText,
      existingCitations,
    );
    const recommendedScore = scoreCitationSelectionForLine(
      scoringText,
      recommendedCitations,
    );

    if (recommendedScore <= existingScore + 1) {
      return normalizedExistingLine;
    }

    return appendCitationSequence(
      baseLine,
      formatCitationSequence(recommendedNumbers),
    );
  }

  if (!recommendedCitations.length) return cleanedLine;

  return appendCitationSequence(
    baseLine,
    formatCitationSequence(
      recommendedCitations.map((citation) => citation.number),
    ),
  );
}

function enforceCitationCoverageForLine(input: {
  line: string;
  citations: ChatKnowledgeCitation[];
  tableHeaderCells?: string[] | null;
}): string {
  const parsedTableRow = parseMarkdownTableRow(input.line);
  if (!parsedTableRow) {
    return enforceCitationCoverageForSpan({
      text: input.line,
      citations: input.citations,
    });
  }

  const nextCells = parsedTableRow.cells.map((cell, index) => {
    if (index === 0) return cell;
    if (
      !shouldRequireCitation(cell) &&
      extractCitationNumbers(cell).length === 0
    ) {
      return cell;
    }

    return enforceCitationCoverageForSpan({
      text: cell,
      citations: input.citations,
      scoringText: buildTableCellScoringText({
        columnLabel: input.tableHeaderCells?.[index] ?? null,
        rowLabel: parsedTableRow.cells[0] ?? null,
        cell,
      }),
      maxCount: 1,
    });
  });

  return joinMarkdownTableRow(parsedTableRow, nextCells);
}

export function validateKnowledgeCitationText(input: {
  text: string;
  citations: ChatKnowledgeCitation[];
}): CitationValidationResult {
  const allowedNumbers = new Set(
    input.citations.map((citation) => citation.number),
  );
  const invalidCitationNumbers = new Set<number>();
  const usedCitationNumbers = new Set<number>();
  const missingCitations: CitationValidationIssue[] = [];
  let lineIndex = 0;

  for (const segment of splitTextAndCodeSegments(input.text)) {
    if (segment.type === "code") continue;

    const lines = segment.value.split("\n");
    for (const [segmentLineIndex, line] of lines.entries()) {
      const parsedTableRow = parseMarkdownTableRow(line);
      if (parsedTableRow) {
        if (isMarkdownTableHeaderRow(lines, segmentLineIndex)) {
          lineIndex += 1;
          continue;
        }

        for (const [cellIndex, cell] of parsedTableRow.cells.entries()) {
          if (cellIndex === 0) continue;

          const citationNumbers = extractCitationNumbers(cell);
          for (const citationNumber of citationNumbers) {
            usedCitationNumbers.add(citationNumber);
            if (!allowedNumbers.has(citationNumber)) {
              invalidCitationNumbers.add(citationNumber);
            }
          }

          if (shouldRequireCitation(cell) && citationNumbers.length === 0) {
            missingCitations.push({
              lineIndex,
              line: cell.trim(),
            });
          }
        }

        lineIndex += 1;
        continue;
      }

      if (isCitationOnlyLine(line)) {
        missingCitations.push({
          lineIndex,
          line: line.trim(),
        });
        lineIndex += 1;
        continue;
      }

      const citationNumbers = extractCitationNumbers(line);
      for (const citationNumber of citationNumbers) {
        usedCitationNumbers.add(citationNumber);
        if (!allowedNumbers.has(citationNumber)) {
          invalidCitationNumbers.add(citationNumber);
        }
      }

      if (shouldRequireCitation(line) && citationNumbers.length === 0) {
        missingCitations.push({
          lineIndex,
          line: line.trim(),
        });
      }
      lineIndex += 1;
    }
  }

  return {
    isValid: missingCitations.length === 0 && invalidCitationNumbers.size === 0,
    missingCitations,
    invalidCitationNumbers: Array.from(invalidCitationNumbers).sort(
      (left, right) => left - right,
    ),
    usedCitationNumbers: Array.from(usedCitationNumbers).sort(
      (left, right) => left - right,
    ),
  };
}

export function enforceKnowledgeCitationCoverage(input: {
  text: string;
  citations: ChatKnowledgeCitation[];
}): string {
  if (!input.citations.length) return input.text;

  return splitTextAndCodeSegments(input.text)
    .map((segment) => {
      if (segment.type === "code") return segment.value;

      return segment.value
        .split("\n")
        .map((line, lineIndex, lines) => {
          const parsedTableRow = parseMarkdownTableRow(line);
          if (parsedTableRow) {
            if (isMarkdownTableHeaderRow(lines, lineIndex)) {
              return stripCitationMarkersFromTableRow(line);
            }
            const previousLine = lines[lineIndex - 1] ?? "";
            const nextLine = lines[lineIndex + 1] ?? "";
            const tableHeaderCells = MARKDOWN_TABLE_SEPARATOR_RE.test(
              previousLine.trim(),
            )
              ? (parseMarkdownTableRow(lines[lineIndex - 2] ?? "")?.cells ??
                null)
              : MARKDOWN_TABLE_SEPARATOR_RE.test(nextLine.trim())
                ? null
                : (() => {
                    let searchIndex = lineIndex - 1;
                    while (searchIndex >= 0) {
                      const candidateLine = lines[searchIndex] ?? "";
                      if (
                        MARKDOWN_TABLE_SEPARATOR_RE.test(candidateLine.trim())
                      ) {
                        return (
                          parseMarkdownTableRow(lines[searchIndex - 1] ?? "")
                            ?.cells ?? null
                        );
                      }
                      if (!parseMarkdownTableRow(candidateLine)) break;
                      searchIndex -= 1;
                    }
                    return null;
                  })();
            return enforceCitationCoverageForLine({
              line,
              citations: input.citations,
              tableHeaderCells,
            });
          }
          if (!shouldRequireCitation(line)) return line;
          return enforceCitationCoverageForLine({
            line,
            citations: input.citations,
          });
        })
        .join("\n");
    })
    .join("");
}

export function normalizeKnowledgeCitationLayout(input: {
  text: string;
  citations: ChatKnowledgeCitation[];
  preserveAppendix?: boolean;
}): string {
  if (!input.text.trim()) return input.text;

  const withoutEvidenceEcho = stripEvidencePackEcho(input.text);
  const mergedDetachedCitations =
    mergeDetachedCitationLines(withoutEvidenceEcho);
  const withoutAppendix = stripTrailingCitationAppendix({
    text: mergedDetachedCitations,
    citations: input.citations,
    preserveAppendix: input.preserveAppendix,
  });

  return withoutAppendix.replace(/\n{3,}/g, "\n\n").trim();
}

export function buildKnowledgeRepairPrompt(input: {
  draft: string;
  citations: ChatKnowledgeCitation[];
}): string {
  return [
    "Repair the markdown answer so every factual line or bullet has at least one valid inline citation marker.",
    "Only use citation ids from the allowed evidence pack.",
    "Keep citations inline at the end of the sentence or bullet. Do not put citations on their own line.",
    "Do not introduce new facts.",
    "If a line cannot be supported by the evidence pack, remove it.",
    "Do not output a separate Sources, References, or bibliography section unless the user explicitly asked for one.",
    "Keep the answer structure and wording as close as possible to the draft.",
    "",
    "Allowed citations:",
    formatKnowledgeEvidencePack(input.citations),
    "",
    "Draft answer:",
    input.draft,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildKnowledgeCitationHref(
  citation: ChatKnowledgeCitation | number,
): string {
  if (typeof citation === "number") {
    return `knowledge://citation/${citation}`;
  }

  const searchParams = new URLSearchParams();
  searchParams.set("citationNumber", String(citation.number));
  searchParams.set("documentName", citation.documentName);
  if (citation.versionId) {
    searchParams.set("versionId", citation.versionId);
  }
  if (citation.pageStart != null) {
    searchParams.set("pageStart", String(citation.pageStart));
  }
  if (citation.pageEnd != null) {
    searchParams.set("pageEnd", String(citation.pageEnd));
  }
  if (citation.sectionHeading) {
    searchParams.set("sectionHeading", citation.sectionHeading);
  }
  if (citation.excerpt) {
    searchParams.set("excerpt", citation.excerpt);
  }

  return `knowledge://${encodeURIComponent(citation.groupId)}/${encodeURIComponent(citation.documentId)}?${searchParams.toString()}`;
}

export function buildCitationViewerSearch(
  citation: Pick<ChatKnowledgeCitation, "excerpt">,
): string | null {
  const normalizedExcerpt = stripMarkdown(citation.excerpt);
  if (!normalizedExcerpt) return null;

  const tokens = normalizedExcerpt
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  if (tokens.length < 3) return null;

  return tokens.slice(0, 12).join(" ");
}

export function linkifyKnowledgeCitationMarkers(input: {
  text: string;
  citations: ChatKnowledgeCitation[];
}): string {
  if (!input.citations.length) return input.text;
  const sanitizedText = sanitizeMarkdownTableStructure(input.text);
  const normalizedText = normalizeCitationMarkersForDisplay(sanitizedText);
  const citationsByNumber = new Map(
    input.citations.map((citation) => [citation.number, citation]),
  );

  return splitTextAndCodeSegments(normalizedText)
    .map((segment) => {
      if (segment.type === "code") return segment.value;

      return segment.value
        .split("\n")
        .map((line) => replaceCitationMarkersInLine(line, citationsByNumber))
        .join("\n");
    })
    .join("");
}

export function stripKnowledgeCitationLinks(text: string): string {
  return text.replace(/\[(\d+)\]\(knowledge:\/\/[^)\s]+\)/g, "[$1]");
}

function findAssistantAnswerTextPartIndex(parts: UIMessage["parts"]): number {
  let fallbackIndex = -1;

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part?.type !== "text") continue;

    fallbackIndex = index;
    if (part.text.trim().length > 0) {
      return index;
    }
  }

  return fallbackIndex;
}

function updateAssistantTextPart(
  message: UIMessage,
  transform: (text: string, citations: ChatKnowledgeCitation[]) => string,
): UIMessage {
  if (message.role !== "assistant") {
    return message;
  }

  const knowledgeCitations = getMessageKnowledgeCitations(message);
  if (!knowledgeCitations.length) {
    return message;
  }

  const answerTextIndex = findAssistantAnswerTextPartIndex(message.parts);
  if (answerTextIndex === -1) {
    return message;
  }

  const part = message.parts[answerTextIndex];
  if (part.type !== "text") {
    return message;
  }

  const nextText = transform(part.text, knowledgeCitations);
  if (nextText === part.text) {
    return message;
  }

  const nextParts = [...message.parts];
  nextParts[answerTextIndex] = {
    ...part,
    text: nextText,
  };

  return {
    ...message,
    parts: nextParts,
  };
}

export function linkifyAssistantKnowledgeCitations(
  message: UIMessage,
): UIMessage {
  return updateAssistantTextPart(message, (text, citations) =>
    linkifyKnowledgeCitationMarkers({
      text,
      citations,
    }),
  );
}

export function stripAssistantKnowledgeCitationLinks(
  message: UIMessage,
): UIMessage {
  if (message.role !== "assistant") {
    return message;
  }

  const answerTextIndex = findAssistantAnswerTextPartIndex(message.parts);
  if (answerTextIndex === -1) {
    return message;
  }

  const part = message.parts[answerTextIndex];
  if (part.type !== "text") {
    return message;
  }

  const nextText = stripKnowledgeCitationLinks(part.text);
  if (nextText === part.text) {
    return message;
  }

  const nextParts = [...message.parts];
  nextParts[answerTextIndex] = {
    ...part,
    text: nextText,
  };

  return {
    ...message,
    parts: nextParts,
  };
}

export function applyFinalizedAssistantText(
  message: UIMessage,
  finalizedText: string,
  metadataPatch?: Partial<ChatMetadata>,
  options?: {
    linkifyCitations?: boolean;
  },
): UIMessage {
  if (message.role !== "assistant") {
    return {
      ...message,
      ...(metadataPatch
        ? { metadata: { ...(message.metadata ?? {}), ...metadataPatch } }
        : {}),
    };
  }

  const answerTextIndex = findAssistantAnswerTextPartIndex(message.parts);
  if (answerTextIndex === -1) {
    return {
      ...message,
      ...(metadataPatch
        ? { metadata: { ...(message.metadata ?? {}), ...metadataPatch } }
        : {}),
    };
  }

  const part = message.parts[answerTextIndex];
  if (part.type !== "text") {
    return {
      ...message,
      ...(metadataPatch
        ? { metadata: { ...(message.metadata ?? {}), ...metadataPatch } }
        : {}),
    };
  }

  const nextParts = [...message.parts];
  const nextMetadata = metadataPatch
    ? { ...(message.metadata ?? {}), ...metadataPatch }
    : message.metadata;
  const knowledgeCitations = getMessageKnowledgeCitations({
    ...message,
    metadata: nextMetadata,
  });
  const nextText =
    (options?.linkifyCitations ?? true) && knowledgeCitations.length
      ? linkifyKnowledgeCitationMarkers({
          text: finalizedText,
          citations: knowledgeCitations,
        })
      : finalizedText;
  nextParts[answerTextIndex] = {
    ...part,
    text: nextText,
    state: "done",
  };

  return {
    ...message,
    parts: nextParts,
    ...(metadataPatch
      ? { metadata: { ...(message.metadata ?? {}), ...metadataPatch } }
      : {}),
  };
}
