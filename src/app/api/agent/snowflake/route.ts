import { agentRepository, snowflakeAgentRepository } from "lib/db/repository";
import { getSession } from "auth/server";
import { z } from "zod";
import { canCreateAgent } from "lib/auth/permissions";
import { SnowflakeAgentCreateSchema } from "app-types/snowflake-agent";
import { serverCache } from "lib/cache";
import { CacheKeys } from "lib/cache/cache-keys";

/**
 * POST /api/agent/snowflake
 * Creates a new Snowflake Intelligence agent along with its Cortex configuration.
 */
export async function POST(request: Request): Promise<Response> {
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
    const body = await request.json();
    const data = SnowflakeAgentCreateSchema.parse(body);

    // Create the base agent with agentType = "snowflake_cortex"
    const agent = await agentRepository.insertAgent({
      name: data.name,
      description: data.description,
      icon: data.icon,
      userId: session.user.id,
      instructions: {
        role: "Snowflake Intelligence",
        systemPrompt:
          "You are a Snowflake Cortex intelligent assistant. Answer questions using the connected Snowflake data.",
        mentions: [],
      },
      visibility: data.visibility ?? "private",
      subAgentsEnabled: false,
      agentType: "snowflake_cortex",
    });

    // Create the Snowflake-specific config linked to the agent
    const snowflakeConfig =
      await snowflakeAgentRepository.insertSnowflakeConfig(
        agent.id,
        data.snowflakeConfig,
      );

    serverCache.delete(CacheKeys.agentInstructions(agent.id));

    return Response.json({ ...agent, snowflakeConfig });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: error.message },
        { status: 400 },
      );
    }
    console.error("Failed to create Snowflake agent:", error);
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
