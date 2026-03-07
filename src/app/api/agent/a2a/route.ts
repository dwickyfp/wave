import { getSession } from "auth/server";
import { z } from "zod";
import { canCreateAgent } from "lib/auth/permissions";
import { agentRepository, a2aAgentRepository } from "lib/db/repository";
import { CacheKeys } from "lib/cache/cache-keys";
import { serverCache } from "lib/cache";
import { A2AAgentConfigCreateSchema } from "app-types/a2a-agent";

const CreateA2ARemoteAgentSchema = z.object({
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
  a2aConfig: A2AAgentConfigCreateSchema,
});

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
    const data = CreateA2ARemoteAgentSchema.parse(body);

    const agent = await agentRepository.insertAgent({
      name: data.name,
      description: data.description,
      icon: data.icon,
      userId: session.user.id,
      instructions: {
        role: data.a2aConfig.agentCard.name,
        systemPrompt: `You are a wrapper for the remote A2A agent "${data.a2aConfig.agentCard.name}". Route user requests to the remote agent.`,
        mentions: [],
      },
      visibility: data.visibility,
      subAgentsEnabled: false,
      agentType: "a2a_remote",
    });

    const a2aConfig = await a2aAgentRepository.insertA2AConfig(
      agent.id,
      data.a2aConfig,
    );

    serverCache.delete(CacheKeys.agentInstructions(agent.id));

    return Response.json({
      ...agent,
      a2aConfig: {
        ...a2aConfig,
        authSecret: a2aConfig.authSecret ? "••••••••" : "",
        hasAuthSecret: Boolean(a2aConfig.authSecret),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: error.message },
        { status: 400 },
      );
    }

    console.error("Failed to create A2A agent:", error);
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
