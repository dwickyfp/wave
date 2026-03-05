import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { KnowledgeSummary } from "app-types/knowledge";
import {
  queryKnowledgeAsDocs,
  formatDocsAsText,
  QueryKnowledgeDocsOptions,
} from "lib/knowledge/retriever";

/**
 * Creates a Context7-style full-doc retrieval tool for a knowledge group.
 * Uses embedding + BM25 + reranking to identify the most relevant documents,
 * then returns their full markdown content within a configurable token budget.
 */
export function createKnowledgeDocsTool(
  group: KnowledgeSummary,
  options: Pick<QueryKnowledgeDocsOptions, "userId" | "source"> = {},
) {
  return tool({
    description: `Search the "${group.name}" knowledge base${group.description ? `: ${group.description}` : ""}. Returns full document content ranked by relevance using semantic search. Use this to find comprehensive information from this knowledge group.`,
    inputSchema: z.object({
      query: z.string().describe("The search query to find relevant documents"),
      tokens: z
        .number()
        .optional()
        .describe(
          "Maximum token budget for the response (default: 10000). Higher values return more content.",
        ),
    }),
    execute: async ({ query, tokens }) => {
      const docs = await queryKnowledgeAsDocs(group, query, {
        ...options,
        source: options.source ?? "agent",
        tokens: tokens ?? 10000,
      });
      return formatDocsAsText(group.name, docs, query);
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
