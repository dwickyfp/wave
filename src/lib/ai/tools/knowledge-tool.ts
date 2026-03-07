import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { KnowledgeSummary } from "app-types/knowledge";
import {
  queryKnowledgeAsDocs,
  formatDocsAsText,
  QueryKnowledgeDocsOptions,
} from "lib/knowledge/retriever";

const DEFAULT_AGENT_KNOWLEDGE_TOKENS = 5000;

export function createKnowledgeDocsTool(
  group: KnowledgeSummary,
  options: Pick<QueryKnowledgeDocsOptions, "userId" | "source"> = {},
) {
  return tool({
    description: `Search the "${group.name}" knowledge base${group.description ? `: ${group.description}` : ""}. By default, return section-first context: the most relevant sections plus their parent or continuation context. Use mode="full-doc" only when the user explicitly needs the whole document or a complete document-wide summary.`,
    inputSchema: z.object({
      query: z.string().describe("The search query to find relevant documents"),
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
    execute: async ({ query, tokens, mode }) => {
      const docs = await queryKnowledgeAsDocs(group, query, {
        ...options,
        source: options.source ?? "agent",
        tokens: tokens ?? DEFAULT_AGENT_KNOWLEDGE_TOKENS,
        resultMode: mode ?? "section-first",
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
