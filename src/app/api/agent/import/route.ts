import "server-only";

import {
  agentRepository,
  subAgentRepository,
  snowflakeAgentRepository,
  mcpRepository,
  workflowRepository,
} from "lib/db/repository";
import { getSession } from "auth/server";
import { canCreateAgent } from "lib/auth/permissions";
import { z } from "zod";
import { SubAgentCreateSchema } from "app-types/subagent";
import { ChatMentionSchema, type ChatMention } from "app-types/chat";
import { SnowflakeAgentConfigCreateSchema } from "app-types/snowflake-agent";
import { serverCache } from "lib/cache";
import { CacheKeys } from "lib/cache/cache-keys";

// ─── Zod Schema ───────────────────────────────────────────────────────────────

const AgentImportSchema = z.object({
  version: z.number().optional(),
  agentType: z.enum(["standard", "snowflake_cortex"]).default("standard"),
  name: z.string().min(1).max(100),
  description: z.string().max(8000).optional(),
  icon: z
    .object({
      type: z.literal("emoji"),
      value: z.string(),
      style: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  visibility: z
    .enum(["public", "private", "readonly"])
    .optional()
    .default("private"),
  subAgentsEnabled: z.boolean().optional().default(false),
  instructions: z
    .object({
      role: z.string().optional(),
      systemPrompt: z.string().optional(),
      mentions: z.array(ChatMentionSchema).optional(),
    })
    .optional(),
  subAgents: z.array(SubAgentCreateSchema).optional().default([]),
  snowflakeConfig: SnowflakeAgentConfigCreateSchema.optional(),
});

// ─── Tool Existence Check ─────────────────────────────────────────────────────

/**
 * Filters tool mentions to only keep those that exist in the current environment:
 * - defaultTool: always kept (built-in)
 * - mcpTool / mcpServer: kept only if the MCP server still exists
 * - workflow: kept only if the workflow still exists
 * - agent: always dropped (agent IDs differ across environments)
 */
async function filterExistingMentions(
  mentions: ChatMention[],
): Promise<ChatMention[]> {
  // Batch-collect unique IDs to check
  const serverIds = new Set<string>();
  const workflowIds = new Set<string>();

  for (const m of mentions) {
    if (m.type === "mcpTool" || m.type === "mcpServer")
      serverIds.add(m.serverId);
    if (m.type === "workflow") workflowIds.add(m.workflowId);
  }

  // Resolve existence in parallel
  const [existingServers, existingWorkflows] = await Promise.all([
    Promise.all(
      [...serverIds].map((sid) =>
        mcpRepository.selectById(sid).then((r) => [sid, !!r] as const),
      ),
    ),
    Promise.all(
      [...workflowIds].map((wid) =>
        workflowRepository.selectById(wid).then((r) => [wid, !!r] as const),
      ),
    ),
  ]);

  const serverExists = new Map(existingServers);
  const workflowExists = new Map(existingWorkflows);

  return mentions.filter((m) => {
    if (m.type === "defaultTool") return true;
    if (m.type === "mcpTool" || m.type === "mcpServer")
      return serverExists.get(m.serverId) ?? false;
    if (m.type === "workflow") return workflowExists.get(m.workflowId) ?? false;
    // "agent" type: drop — agent IDs don't transfer across environments
    return false;
  });
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const hasPermission = await canCreateAgent();
  if (!hasPermission) {
    return Response.json(
      { error: "You don't have permission to create agents" },
      { status: 403 },
    );
  }

  try {
    const json = await request.json();
    const data = AgentImportSchema.parse(json);

    // Filter mentions for the main agent
    const filteredMentions = await filterExistingMentions(
      data.instructions?.mentions ?? [],
    );

    // Create the agent (always as private regardless of exported visibility)
    const agent = await agentRepository.insertAgent({
      name: data.name,
      description: data.description,
      icon: data.icon,
      userId: session.user.id,
      instructions: {
        ...data.instructions,
        mentions: filteredMentions,
      },
      visibility: "private",
      subAgentsEnabled: data.subAgentsEnabled ?? false,
      agentType: data.agentType,
    });

    // Create sub-agents with filtered tools
    const createdSubAgents = [];
    for (const subAgent of data.subAgents) {
      const filteredTools = await filterExistingMentions(subAgent.tools ?? []);
      const created = await subAgentRepository.insertSubAgent(agent.id, {
        ...subAgent,
        tools: filteredTools,
      });
      createdSubAgents.push(created);
    }

    // Create Snowflake config for snowflake_cortex agents
    if (data.agentType === "snowflake_cortex" && data.snowflakeConfig) {
      await snowflakeAgentRepository.insertSnowflakeConfig(
        agent.id,
        data.snowflakeConfig,
      );
    }

    serverCache.delete(CacheKeys.agentInstructions(agent.id));

    return Response.json(
      { ...agent, subAgents: createdSubAgents },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: error.message },
        { status: 400 },
      );
    }
    console.error("Failed to import agent:", error);
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
