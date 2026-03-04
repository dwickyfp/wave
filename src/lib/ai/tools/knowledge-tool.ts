import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { KnowledgeSummary } from "app-types/knowledge";
import {
  queryKnowledgeAsText,
  QueryKnowledgeOptions,
} from "lib/knowledge/retriever";

/**
 * Creates an AI SDK tool that queries a specific knowledge group.
 * Intended to be injected into the agent's tool list when the agent
 * has one or more knowledge groups attached.
 */
export function createKnowledgeTool(
  group: KnowledgeSummary,
  options: Pick<QueryKnowledgeOptions, "userId" | "source"> = {},
) {
  return tool({
    description: `Search the "${group.name}" knowledge base${group.description ? `: ${group.description}` : ""}. Use this tool to find relevant information from this knowledge group.`,
    inputSchema: z.object({
      query: z
        .string()
        .describe("The search query to find relevant information"),
      topN: z
        .number()
        .optional()
        .describe("Maximum number of results to return (default: 10)"),
    }),
    execute: async ({ query, topN }) => {
      return queryKnowledgeAsText(group, query, {
        ...options,
        source: options.source ?? "agent",
        topN,
      });
    },
  });
}

/**
 * Tool name prefix used to identify knowledge tools in the tool list.
 */
export const KNOWLEDGE_TOOL_PREFIX = "query_knowledge_";

/**
 * Returns the tool name for a knowledge group.
 */
export function knowledgeToolName(groupId: string) {
  // Tool names must be alphanumeric + underscores, max 64 chars
  return `${KNOWLEDGE_TOOL_PREFIX}${groupId.replace(/-/g, "_")}`.slice(0, 64);
}
