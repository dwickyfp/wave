import "server-only";

import { tool } from "ai";
import type { ChatKnowledgeCitation, ChatKnowledgeImage } from "app-types/chat";
import { z } from "zod";
import type {
  KnowledgeComparisonGroup,
  KnowledgeEvidenceItem,
  KnowledgeQueryAnalysis,
  KnowledgeSummary,
} from "app-types/knowledge";
import {
  DocRetrievalResult,
  formatKnowledgeRetrievalEnvelopeAsText,
  QueryKnowledgeDocsOptions,
  queryKnowledgeStructured,
} from "lib/knowledge/retriever";
import {
  formatKnowledgeDocumentSummaryAsText,
  resolveKnowledgeDocumentByName,
  summarizeKnowledgeDocumentById,
} from "lib/knowledge/document-summary";
import {
  buildKnowledgeCitations,
  formatKnowledgeEvidencePack,
} from "lib/chat/knowledge-citations";
import {
  buildChatKnowledgeImages,
  dedupeChatKnowledgeImages,
} from "lib/chat/knowledge-sources";

const DEFAULT_AGENT_KNOWLEDGE_TOKENS = 5000;
const MAX_TOOL_RESULT_IMAGES = 4;
const EMPTY_QUERY_ANALYSIS: KnowledgeQueryAnalysis = {
  intent: "lookup",
  explicitAxes: [],
  requestedTopics: [],
};

export type KnowledgeDocsRetrievedPayload = {
  groupId: string;
  groupName: string;
  query: string;
  docs: DocRetrievalResult[];
  queryAnalysis: KnowledgeQueryAnalysis;
  comparisonGroups: KnowledgeComparisonGroup[];
  evidenceItems: KnowledgeEvidenceItem[];
  contextText: string;
};

export type KnowledgeDocsPreparedPayload = {
  contextText?: string;
  citations?: ChatKnowledgeCitation[];
  images?: ChatKnowledgeImage[];
  evidencePack?: string | null;
};

export type KnowledgeDocsToolResult = {
  source: "attached_agent_knowledge";
  groupId: string;
  groupName: string;
  query: string;
  hasResults: boolean;
  contextText: string;
  citationInstructions: string;
  evidencePack: string | null;
  citations: ChatKnowledgeCitation[];
  images: ChatKnowledgeImage[];
  queryAnalysis: KnowledgeQueryAnalysis;
  comparisonGroups: KnowledgeComparisonGroup[];
  evidenceItems: KnowledgeEvidenceItem[];
};

export function createKnowledgeDocsTool(
  group: KnowledgeSummary,
  options: Pick<QueryKnowledgeDocsOptions, "userId" | "source"> & {
    onRetrieved?: (
      payload: KnowledgeDocsRetrievedPayload,
    ) =>
      | KnowledgeDocsPreparedPayload
      | void
      | Promise<KnowledgeDocsPreparedPayload | void>;
  } = {},
) {
  const { onRetrieved, ...queryOptions } = options;

  return tool({
    description: `Search the "${group.name}" knowledge base${group.description ? `: ${group.description}` : ""}. By default, return section-first context: the most relevant sections plus their parent or continuation context. Use mode="full-doc" only when the user explicitly needs the whole document or a complete document-wide summary.`,
    inputSchema: z.object({
      query: z.string().describe("The search query to find relevant documents"),
      documentId: z
        .string()
        .optional()
        .describe(
          "Optional exact document id. Use this for document-summary mode when the target document is already known.",
        ),
      document: z
        .string()
        .optional()
        .describe(
          "Optional document name or filename to resolve before running document-summary mode.",
        ),
      page: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional exact page filter."),
      note: z
        .string()
        .optional()
        .describe("Optional exact note filter, e.g. '14' or '14.a'."),
      tokens: z
        .number()
        .optional()
        .describe(
          "Maximum token budget for the response (default: 5000). Higher values return more context.",
        ),
      mode: z
        .enum(["section-first", "full-doc", "document-summary"])
        .optional()
        .describe(
          "Retrieval mode. Use section-first for targeted answers, full-doc when complete document context is required, and document-summary for a citation-ready document overview plus value digest.",
        ),
    }),
    execute: async ({
      query,
      documentId,
      document,
      page,
      note,
      tokens,
      mode,
    }) => {
      if (mode === "document-summary") {
        const resolution = documentId
          ? {
              status: "resolved" as const,
              document: { id: documentId, name: document ?? documentId },
            }
          : await resolveKnowledgeDocumentByName({
              groupId: group.id,
              document: document ?? query,
            });

        if (resolution.status === "ambiguous") {
          return {
            source: "attached_agent_knowledge",
            groupId: group.id,
            groupName: group.name,
            query,
            hasResults: false,
            contextText: [
              `[Document Summary Resolver: ${group.name}]`,
              `Multiple documents matched "${document ?? query}".`,
              "",
              "Ask the user to choose one of these documents:",
              ...resolution.candidates.map(
                (candidate, index) =>
                  `${index + 1}. ${candidate.name} (${candidate.id})`,
              ),
            ].join("\n"),
            citationInstructions:
              "No cited knowledge was retrieved from this tool result.",
            evidencePack: null,
            citations: [],
            images: [],
            queryAnalysis: EMPTY_QUERY_ANALYSIS,
            comparisonGroups: [],
            evidenceItems: [],
          } satisfies KnowledgeDocsToolResult;
        }

        if (resolution.status === "not_found") {
          return {
            source: "attached_agent_knowledge",
            groupId: group.id,
            groupName: group.name,
            query,
            hasResults: false,
            contextText: `No ready document matched "${document ?? query}" in "${group.name}".`,
            citationInstructions:
              "No cited knowledge was retrieved from this tool result.",
            evidencePack: null,
            citations: [],
            images: [],
            queryAnalysis: EMPTY_QUERY_ANALYSIS,
            comparisonGroups: [],
            evidenceItems: [],
          } satisfies KnowledgeDocsToolResult;
        }

        const summary = await summarizeKnowledgeDocumentById({
          group,
          documentId: resolution.document.id,
          tokens: tokens ?? DEFAULT_AGENT_KNOWLEDGE_TOKENS,
        });
        if (!summary) {
          return {
            source: "attached_agent_knowledge",
            groupId: group.id,
            groupName: group.name,
            query,
            hasResults: false,
            contextText: `The requested document could not be summarized from "${group.name}".`,
            citationInstructions:
              "No cited knowledge was retrieved from this tool result.",
            evidencePack: null,
            citations: [],
            images: [],
            queryAnalysis: EMPTY_QUERY_ANALYSIS,
            comparisonGroups: [],
            evidenceItems: [],
          } satisfies KnowledgeDocsToolResult;
        }

        const citations = summary.citations.map((citation, index) => ({
          number: index + 1,
          groupId: group.id,
          groupName: group.name,
          documentId: summary.documentId,
          documentName: summary.documentName,
          versionId: summary.versionId ?? null,
          sectionId: citation.sectionId ?? null,
          sectionHeading: citation.sectionHeading ?? null,
          pageStart: citation.pageStart ?? null,
          pageEnd: citation.pageEnd ?? null,
          excerpt: citation.excerpt,
          relevanceScore: citation.relevanceScore,
        }));
        const evidencePack = citations.length
          ? formatKnowledgeEvidencePack(citations)
          : null;

        return {
          source: "attached_agent_knowledge",
          groupId: group.id,
          groupName: group.name,
          query,
          hasResults: true,
          contextText: formatKnowledgeDocumentSummaryAsText(summary),
          citationInstructions: citations.length
            ? 'When you answer from this tool result, cite the matching inline ids exactly as "[n]". Uncited factual claims from this tool result are invalid.'
            : "No cited knowledge was retrieved from this tool result.",
          evidencePack,
          citations,
          images: [],
          queryAnalysis: EMPTY_QUERY_ANALYSIS,
          comparisonGroups: [],
          evidenceItems: [],
        } satisfies KnowledgeDocsToolResult;
      }

      const envelope = await queryKnowledgeStructured(group, query, {
        ...queryOptions,
        source: queryOptions.source ?? "agent",
        page,
        note,
        tokens: tokens ?? DEFAULT_AGENT_KNOWLEDGE_TOKENS,
        resultMode: mode ?? "section-first",
      });
      const docs = envelope.docs;
      const contextText = formatKnowledgeRetrievalEnvelopeAsText(envelope);
      const prepared = await Promise.resolve(
        onRetrieved?.({
          groupId: group.id,
          groupName: group.name,
          query,
          docs,
          queryAnalysis: envelope.queryAnalysis,
          comparisonGroups: envelope.comparisonGroups,
          evidenceItems: envelope.evidenceItems,
          contextText,
        }),
      ).catch(() => undefined);

      const fallbackCitations = buildKnowledgeCitations({
        retrievedGroups: [
          {
            groupId: group.id,
            groupName: group.name,
            docs,
          },
        ],
      });
      const citations = [...(prepared?.citations ?? fallbackCitations)].sort(
        (left, right) => left.number - right.number,
      );
      const fallbackImages = buildChatKnowledgeImages({
        groupId: group.id,
        groupName: group.name,
        docs,
      });
      const images = dedupeChatKnowledgeImages(
        prepared?.images ?? fallbackImages,
      ).slice(0, MAX_TOOL_RESULT_IMAGES);
      const evidencePack =
        prepared?.evidencePack ??
        (citations.length ? formatKnowledgeEvidencePack(citations) : null);

      return {
        source: "attached_agent_knowledge",
        groupId: group.id,
        groupName: group.name,
        query,
        hasResults: docs.length > 0,
        contextText: prepared?.contextText ?? contextText,
        citationInstructions: citations.length
          ? 'When you answer from this tool result, cite the matching inline ids exactly as "[n]". Uncited factual claims from this tool result are invalid.'
          : "No cited knowledge was retrieved from this tool result.",
        evidencePack,
        citations,
        images,
        queryAnalysis: envelope.queryAnalysis,
        comparisonGroups: envelope.comparisonGroups,
        evidenceItems: envelope.evidenceItems,
      } satisfies KnowledgeDocsToolResult;
    },
  });
}

/**
 * Tool name prefix used to identify knowledge tools in the tool list.
 */
export const KNOWLEDGE_DOCS_TOOL_PREFIX = "get_docs_";

/**
 * Returns the tool name for a knowledge group.
 */
export function knowledgeDocsToolName(groupId: string) {
  return `${KNOWLEDGE_DOCS_TOOL_PREFIX}${groupId.replace(/-/g, "_")}`.slice(
    0,
    64,
  );
}
