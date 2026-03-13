import type { UIMessage } from "ai";
import type {
  ChatKnowledgeCitation,
  ChatKnowledgeSource,
  ChatMetadata,
} from "app-types/chat";
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

function stripTrailingCitationMarkers(line: string): string {
  return line.replace(/\s*(?:\[(\d+)\](?!\())+\s*$/g, "").trimEnd();
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
  const numbers = extractCitationNumbers(line);
  if (numbers.length === 0) return line.trimEnd();
  const base = stripTrailingCitationMarkers(line).trim();
  const formatted = formatCitationSequence(numbers);
  if (!base) return formatted;
  return appendCitationSequence(base, formatted);
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

      nextLines[previousIndex] = normalizeCitationInlineMarkers(
        `${nextLines[previousIndex]} ${formatCitationSequence(citationNumbers)}`,
      );
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

function tokenizeForCitationMatch(value: string): Set<string> {
  return new Set(
    stripMarkdown(value)
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );
}

function scoreCitationForLine(
  line: string,
  citation: ChatKnowledgeCitation,
): number {
  const lineTokens = tokenizeForCitationMatch(line);
  if (lineTokens.size === 0) return citation.relevanceScore;

  const citationTokens = tokenizeForCitationMatch(
    [
      citation.documentName,
      citation.sectionHeading,
      citation.excerpt,
      citation.groupName,
    ]
      .filter(Boolean)
      .join(" "),
  );

  let overlap = 0;
  for (const token of lineTokens) {
    if (citationTokens.has(token)) overlap += 1;
  }

  return overlap * 2 + citation.relevanceScore;
}

function pickBestCitationForLine(
  line: string,
  citations: ChatKnowledgeCitation[],
): ChatKnowledgeCitation | null {
  if (!citations.length) return null;

  return [...citations].sort(
    (left, right) =>
      scoreCitationForLine(line, right) - scoreCitationForLine(line, left),
  )[0]!;
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

    for (const line of segment.value.split("\n")) {
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
        .map((line) => {
          if (!shouldRequireCitation(line)) return line;

          const cleanedLine = line.replace(/\[(\d+)\](?!\()/g, (full, raw) => {
            const citationNumber = Number.parseInt(raw, 10);
            return input.citations.some(
              (citation) => citation.number === citationNumber,
            )
              ? full
              : "";
          });
          const existingCitations = extractCitationNumbers(cleanedLine);
          if (existingCitations.length > 0) {
            return cleanedLine;
          }

          const bestCitation = pickBestCitationForLine(
            cleanedLine,
            input.citations,
          );
          if (!bestCitation) return cleanedLine;

          return appendCitationSequence(
            cleanedLine,
            `[${bestCitation.number}]`,
          );
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
  const citationsByNumber = new Map(
    input.citations.map((citation) => [citation.number, citation]),
  );

  return splitTextAndCodeSegments(input.text)
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

  const metadata = message.metadata as ChatMetadata | undefined;
  const knowledgeCitations = Array.isArray(metadata?.knowledgeCitations)
    ? metadata.knowledgeCitations
    : [];
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
  const knowledgeCitations = Array.isArray(metadataPatch?.knowledgeCitations)
    ? metadataPatch.knowledgeCitations
    : Array.isArray(
          (message.metadata as ChatMetadata | undefined)?.knowledgeCitations,
        )
      ? ((message.metadata as ChatMetadata | undefined)
          ?.knowledgeCitations as ChatKnowledgeCitation[])
      : [];
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
