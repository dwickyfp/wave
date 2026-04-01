import { createHash } from "node:crypto";
import type {
  KnowledgeDocument,
  KnowledgeDocumentSummaryOutlineItem,
  KnowledgeDocumentSummaryResult,
  KnowledgeDocumentSummarySectionRef,
  KnowledgeDocumentSummaryValueItem,
  KnowledgeGroup,
  KnowledgeSection,
  KnowledgeSectionSummaryCoverageFlags,
  RetrievedKnowledgeCitation,
} from "app-types/knowledge";
import { CacheKeys } from "lib/cache/cache-keys";
import { serverCache } from "lib/cache";
import { knowledgeRepository } from "lib/db/repository";
import { fuzzySearch } from "lib/fuzzy-search";

const SHOULD_USE_DOCUMENT_SUMMARY_CACHE = process.env.NODE_ENV !== "test";
const DOCUMENT_SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SUMMARY_TOKENS = 2200;
const MAX_SUMMARY_TOKENS = 12000;

type LogicalSectionAggregate = {
  logicalSectionKey: string;
  sections: KnowledgeSection[];
  sectionId: string;
  heading: string;
  headingPath: string;
  pageStart: number | null;
  pageEnd: number | null;
  summary: string;
  valueDigest: KnowledgeDocumentSummaryValueItem[];
  coverageFlags: KnowledgeSectionSummaryCoverageFlags;
};

type SummaryRollupBlock = {
  label: string;
  summary: string;
  valueDigest: string[];
  pageStart: number | null;
  pageEnd: number | null;
};

function cleanInlineText(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function estimateTokens(text: string): number {
  return Math.ceil(cleanInlineText(text).length / 4);
}

function trimTextToTokenBudget(text: string, budgetTokens: number): string {
  const cleaned = cleanInlineText(text);
  const charLimit = Math.max(0, budgetTokens * 4);
  if (!cleaned || cleaned.length <= charLimit) return cleaned;

  let cut = cleaned.slice(0, charLimit);
  const lastSentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  if (lastSentence > charLimit * 0.55) {
    cut = cut.slice(0, lastSentence + 1);
  } else {
    const lastSpace = cut.lastIndexOf(" ");
    if (lastSpace > charLimit * 0.6) {
      cut = cut.slice(0, lastSpace);
    }
  }

  return cut.trim();
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => cleanInlineText(value)).filter(Boolean)),
  );
}

function orCoverageFlags(
  sections: KnowledgeSection[],
): KnowledgeSectionSummaryCoverageFlags {
  return sections.reduce<KnowledgeSectionSummaryCoverageFlags>(
    (acc, section) => {
      const flags = section.summaryData?.coverageFlags;
      return {
        hasTable: acc.hasTable || Boolean(flags?.hasTable),
        hasDenseNumbers: acc.hasDenseNumbers || Boolean(flags?.hasDenseNumbers),
        hasResearchResults:
          acc.hasResearchResults || Boolean(flags?.hasResearchResults),
        hasContinuation: acc.hasContinuation || Boolean(flags?.hasContinuation),
      };
    },
    {
      hasTable: false,
      hasDenseNumbers: false,
      hasResearchResults: false,
      hasContinuation: false,
    },
  );
}

function groupLogicalSections(
  sections: KnowledgeSection[],
): LogicalSectionAggregate[] {
  const orderedSections = [...sections].sort((left, right) => {
    const leftPage = left.pageStart ?? Number.MAX_SAFE_INTEGER;
    const rightPage = right.pageStart ?? Number.MAX_SAFE_INTEGER;
    if (leftPage !== rightPage) return leftPage - rightPage;
    if (left.partIndex !== right.partIndex)
      return left.partIndex - right.partIndex;
    return left.id.localeCompare(right.id);
  });
  const groups: LogicalSectionAggregate[] = [];

  for (const section of orderedSections) {
    const logicalSectionKey =
      section.summaryData?.logicalSectionKey ??
      [
        section.headingPath,
        section.noteNumber ?? "",
        section.noteSubsection ?? "",
      ].join("::");
    const currentGroup = groups.at(-1);
    if (currentGroup && currentGroup.logicalSectionKey === logicalSectionKey) {
      currentGroup.sections.push(section);
      currentGroup.pageStart =
        currentGroup.pageStart == null
          ? (section.pageStart ?? null)
          : section.pageStart == null
            ? currentGroup.pageStart
            : Math.min(currentGroup.pageStart, section.pageStart);
      currentGroup.pageEnd =
        currentGroup.pageEnd == null
          ? (section.pageEnd ?? null)
          : section.pageEnd == null
            ? currentGroup.pageEnd
            : Math.max(currentGroup.pageEnd, section.pageEnd);
      continue;
    }

    groups.push({
      logicalSectionKey,
      sections: [section],
      sectionId: section.id,
      heading: section.heading,
      headingPath: section.headingPath,
      pageStart: section.pageStart ?? null,
      pageEnd: section.pageEnd ?? null,
      summary: "",
      valueDigest: [],
      coverageFlags: {
        hasTable: false,
        hasDenseNumbers: false,
        hasResearchResults: false,
        hasContinuation: false,
      },
    });
  }

  return groups.map((group) => {
    const summaries = dedupeStrings(
      group.sections.map(
        (section) =>
          section.summaryData?.logicalSectionSummary ??
          section.summaryData?.partSummary ??
          section.summary,
      ),
    );
    const valueDigest = group.sections.flatMap((section) =>
      (section.summaryData?.valueDigest ?? []).map((item) => ({
        ...item,
        logicalSectionKey: group.logicalSectionKey,
        sectionId: section.id,
        sectionHeading: section.headingPath,
      })),
    );

    return {
      ...group,
      summary: summaries[0] ?? group.sections[0]?.summary ?? "",
      valueDigest,
      coverageFlags: orCoverageFlags(group.sections),
    };
  });
}

function buildOutline(
  logicalSections: LogicalSectionAggregate[],
): KnowledgeDocumentSummaryOutlineItem[] {
  return logicalSections.map((section) => ({
    logicalSectionKey: section.logicalSectionKey,
    sectionId: section.sectionId,
    heading: section.heading,
    headingPath: section.headingPath,
    pageStart: section.pageStart,
    pageEnd: section.pageEnd,
    summary: section.summary,
    hasContinuation: section.coverageFlags.hasContinuation,
  }));
}

function buildSectionRefs(
  logicalSections: LogicalSectionAggregate[],
): KnowledgeDocumentSummarySectionRef[] {
  return logicalSections.map((section) => ({
    logicalSectionKey: section.logicalSectionKey,
    sectionId: section.sectionId,
    heading: section.heading,
    headingPath: section.headingPath,
    pageStart: section.pageStart,
    pageEnd: section.pageEnd,
    summary: section.summary,
    valueDigest: section.valueDigest.map((item) => ({
      kind: item.kind,
      text: item.text,
      pageStart: item.pageStart,
      pageEnd: item.pageEnd,
    })),
    coverageFlags: section.coverageFlags,
  }));
}

function buildCitations(
  logicalSections: LogicalSectionAggregate[],
): RetrievedKnowledgeCitation[] {
  return logicalSections.map((section, index) => ({
    versionId: null,
    sectionId: section.sectionId,
    sectionHeading: section.headingPath,
    pageStart: section.pageStart,
    pageEnd: section.pageEnd,
    excerpt:
      section.valueDigest[0]?.text ??
      trimTextToTokenBudget(section.summary, 60) ??
      `Summary coverage for ${section.headingPath}`,
    relevanceScore: Math.max(0.5, 1 - index * 0.03),
  }));
}

function buildSummaryRollupBlock(
  blocks: SummaryRollupBlock[],
): SummaryRollupBlock {
  const label =
    blocks.length === 1
      ? (blocks[0]?.label ?? "Summary")
      : `${blocks[0]?.label ?? "Start"} -> ${blocks.at(-1)?.label ?? "End"}`;
  const summary = trimTextToTokenBudget(
    blocks.map((block) => `${block.label}: ${block.summary}`).join(" "),
    240,
  );
  const valueDigest = dedupeStrings(
    blocks.flatMap((block) => block.valueDigest),
  ).slice(0, 10);
  const pageStarts = blocks
    .map((block) => block.pageStart)
    .filter((value): value is number => value != null);
  const pageEnds = blocks
    .map((block) => block.pageEnd)
    .filter((value): value is number => value != null);

  return {
    label,
    summary,
    valueDigest,
    pageStart: pageStarts.length > 0 ? Math.min(...pageStarts) : null,
    pageEnd: pageEnds.length > 0 ? Math.max(...pageEnds) : null,
  };
}

function reduceBlocksToFit(
  blocks: SummaryRollupBlock[],
  tokenBudget: number,
): SummaryRollupBlock[] {
  let current = [...blocks];

  while (
    current.length > 1 &&
    estimateTokens(
      current.map((block) => `${block.label}: ${block.summary}`).join(" "),
    ) > tokenBudget
  ) {
    const next: SummaryRollupBlock[] = [];
    for (let index = 0; index < current.length; index += 4) {
      next.push(buildSummaryRollupBlock(current.slice(index, index + 4)));
    }
    current = next;
  }

  return current;
}

function composeDocumentSummary(
  documentName: string,
  logicalSections: LogicalSectionAggregate[],
  tokenBudget: number,
): string {
  const initialBlocks = logicalSections.map((section) => ({
    label: section.headingPath,
    summary: section.summary,
    valueDigest: section.valueDigest.map((item) => item.text).slice(0, 6),
    pageStart: section.pageStart,
    pageEnd: section.pageEnd,
  }));
  const reducedBlocks = reduceBlocksToFit(initialBlocks, tokenBudget);
  const prefix = `Document: ${documentName}.`;
  const summaries = reducedBlocks
    .map((block) => `${block.label}: ${block.summary}`)
    .join(" ");
  const values = dedupeStrings(
    reducedBlocks.flatMap((block) => block.valueDigest),
  ).slice(0, 12);
  const suffix =
    values.length > 0 ? ` Material values: ${values.join("; ")}.` : "";
  return trimTextToTokenBudget(`${prefix} ${summaries}${suffix}`, tokenBudget);
}

function buildDocumentSummaryCacheKey(input: {
  groupId: string;
  documentId: string;
  versionId: string;
  tokens: number;
}): string {
  const hash = createHash("sha256")
    .update(JSON.stringify({ tokens: input.tokens, style: "default", v: 1 }))
    .digest("hex");
  return CacheKeys.knowledgeDocumentSummary(
    input.groupId,
    input.documentId,
    input.versionId,
    hash,
  );
}

export async function summarizeKnowledgeDocumentById(input: {
  group: Pick<KnowledgeGroup, "id" | "name">;
  documentId: string;
  tokens?: number;
}): Promise<KnowledgeDocumentSummaryResult | null> {
  const tokenBudget = Math.min(
    Math.max(input.tokens ?? DEFAULT_SUMMARY_TOKENS, 800),
    MAX_SUMMARY_TOKENS,
  );
  const docs = await knowledgeRepository.selectDocumentsByGroupScope(
    input.group.id,
  );
  const doc = docs.find(
    (candidate) =>
      candidate.id === input.documentId && candidate.status === "ready",
  );
  if (!doc) {
    return null;
  }

  const versionId = doc.activeVersionId ?? "live";
  const cacheKey = buildDocumentSummaryCacheKey({
    groupId: input.group.id,
    documentId: doc.id,
    versionId,
    tokens: tokenBudget,
  });
  if (SHOULD_USE_DOCUMENT_SUMMARY_CACHE) {
    const cached =
      await serverCache.get<KnowledgeDocumentSummaryResult>(cacheKey);
    if (cached) return cached;
  }

  const sections = await knowledgeRepository.getSectionsByDocumentId(doc.id);
  if (sections.length === 0) {
    return {
      documentId: doc.id,
      documentName: doc.name,
      versionId: doc.activeVersionId ?? null,
      outline: [],
      summary: `Document: ${doc.name}. No section summaries were available for this document.`,
      valueDigest: [],
      sectionRefs: [],
      citations: [],
    };
  }

  const logicalSections = groupLogicalSections(sections);
  const result = {
    documentId: doc.id,
    documentName: doc.name,
    versionId: doc.activeVersionId ?? null,
    outline: buildOutline(logicalSections),
    summary: composeDocumentSummary(doc.name, logicalSections, tokenBudget),
    valueDigest: Array.from(
      logicalSections
        .flatMap((section) => section.valueDigest)
        .reduce((map, item) => {
          const key = [
            item.logicalSectionKey,
            item.sectionId,
            item.kind,
            item.text.toLowerCase(),
          ].join("::");
          if (!map.has(key)) {
            map.set(key, item);
          }
          return map;
        }, new Map<string, KnowledgeDocumentSummaryValueItem>())
        .values(),
    ),
    sectionRefs: buildSectionRefs(logicalSections),
    citations: buildCitations(logicalSections),
  } satisfies KnowledgeDocumentSummaryResult;

  if (SHOULD_USE_DOCUMENT_SUMMARY_CACHE) {
    await serverCache.set(cacheKey, result, DOCUMENT_SUMMARY_CACHE_TTL_MS);
  }

  return result;
}

export function formatKnowledgeDocumentSummaryAsText(
  summary: KnowledgeDocumentSummaryResult,
): string {
  const outline = summary.outline
    .map((item, index) => {
      const pageLabel =
        item.pageStart != null && item.pageEnd != null
          ? item.pageStart === item.pageEnd
            ? `Page ${item.pageStart}`
            : `Pages ${item.pageStart}-${item.pageEnd}`
          : "Page unknown";
      return `${index + 1}. ${item.headingPath} (${pageLabel})`;
    })
    .join("\n");
  const values = summary.valueDigest
    .map((item) => `- ${item.sectionHeading}: ${item.text}`)
    .join("\n");
  const citations = summary.citations
    .map((citation, index) => {
      const pageLabel =
        citation.pageStart != null && citation.pageEnd != null
          ? citation.pageStart === citation.pageEnd
            ? `Page ${citation.pageStart}`
            : `Pages ${citation.pageStart}-${citation.pageEnd}`
          : "Page unknown";
      return `[${index + 1}] ${citation.sectionHeading ?? "Section"} | ${pageLabel}: ${citation.excerpt}`;
    })
    .join("\n");

  return [
    `[Document Summary: ${summary.documentName}]`,
    "",
    "Summary:",
    summary.summary,
    "",
    "Outline:",
    outline || "No outline available.",
    "",
    "Value Digest:",
    values || "No material values extracted.",
    "",
    "Citations:",
    citations || "No citations available.",
  ].join("\n");
}

export async function resolveKnowledgeDocumentByName(input: {
  groupId: string;
  document?: string | null;
}): Promise<
  | { status: "resolved"; document: KnowledgeDocument }
  | { status: "ambiguous"; candidates: KnowledgeDocument[] }
  | { status: "not_found" }
> {
  const docs = (
    await knowledgeRepository.selectDocumentsByGroupScope(input.groupId)
  ).filter((doc) => doc.status === "ready");

  if (docs.length === 0) {
    return { status: "not_found" };
  }
  if (input.document?.trim()) {
    const normalizedQuery = input.document.trim().toLowerCase();
    const exact = docs.find(
      (doc) =>
        doc.id === input.document ||
        doc.name.trim().toLowerCase() === normalizedQuery ||
        doc.originalFilename.trim().toLowerCase() === normalizedQuery,
    );
    if (exact) {
      return { status: "resolved", document: exact };
    }

    const ranked = fuzzySearch(
      docs.map((doc) => ({
        id: doc.id,
        label: `${doc.name} ${doc.originalFilename}`,
        doc,
      })),
      input.document,
    ).map((entry) => entry.doc);

    if (ranked.length === 1) {
      return { status: "resolved", document: ranked[0] };
    }
    if (ranked.length > 1) {
      return { status: "ambiguous", candidates: ranked.slice(0, 5) };
    }
  }

  if (docs.length === 1) {
    return { status: "resolved", document: docs[0] };
  }

  return { status: "ambiguous", candidates: docs.slice(0, 5) };
}
