import "server-only";

import { tool } from "ai";
import type { ChatKnowledgeCitation, ChatKnowledgeImage } from "app-types/chat";
import { z } from "zod";
import { KnowledgeSummary } from "app-types/knowledge";
import {
  DocRetrievalResult,
  queryKnowledgeAsDocs,
  formatDocsAsText,
  QueryKnowledgeDocsOptions,
} from "lib/knowledge/retriever";
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

export type KnowledgeDocsRetrievedPayload = {
  groupId: string;
  groupName: string;
  query: string;
  docs: DocRetrievalResult[];
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
        .enum(["section-first", "full-doc"])
        .optional()
        .describe(
          "Retrieval mode. Use section-first for targeted answers and full-doc only when complete document context is required.",
        ),
    }),
    execute: async ({ query, page, note, tokens, mode }) => {
      const docs = await queryKnowledgeAsDocs(group, query, {
        ...queryOptions,
        source: queryOptions.source ?? "agent",
        page,
        note,
        tokens: tokens ?? DEFAULT_AGENT_KNOWLEDGE_TOKENS,
        resultMode: mode ?? "section-first",
      });
      const contextText = formatDocsAsText(group.name, docs, query);
      const prepared = await Promise.resolve(
        onRetrieved?.({
          groupId: group.id,
          groupName: group.name,
          query,
          docs,
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
