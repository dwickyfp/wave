import { agentRepository, subAgentRepository } from "lib/db/repository";
import { getSession } from "auth/server";
import { z } from "zod";
import { AgentUpdateSchema } from "app-types/agent";
import { SubAgentCreateSchema } from "app-types/subagent";
import { serverCache } from "lib/cache";
import { CacheKeys } from "lib/cache/cache-keys";
import { canEditAgent, canDeleteAgent } from "lib/auth/permissions";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();

  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const agent = await agentRepository.selectAgentById(id, session.user.id);
  if (!agent) {
    return new Response("Unauthorized", { status: 401 });
  }
  const subAgents = await subAgentRepository.selectSubAgentsByAgentId(id);
  return Response.json({ ...agent, subAgents });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();

  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Check if user has permission to edit agents
  const canEdit = await canEditAgent();
  if (!canEdit) {
    return Response.json(
      { error: "Only editors and admins can edit agents" },
      { status: 403 },
    );
  }

  try {
    const { id } = await params;
    const body = await request.json();

    // Extract subAgents from body before parsing the agent schema
    const { subAgents: subAgentsRaw, ...agentBody } = body;

    const data = AgentUpdateSchema.parse(agentBody);

    // Check access for write operations
    const hasAccess = await agentRepository.checkAccess(id, session.user.id);
    if (!hasAccess) {
      return new Response("Unauthorized", { status: 401 });
    }

    // For non-owners of public agents, preserve original visibility
    const existingAgent = await agentRepository.selectAgentById(
      id,
      session.user.id,
    );
    if (existingAgent && existingAgent.userId !== session.user.id) {
      data.visibility = existingAgent.visibility;
    }

    const agent = await agentRepository.updateAgent(id, session.user.id, data);
    serverCache.delete(CacheKeys.agentInstructions(agent.id));

    // Sync subagents if provided in the payload
    let subAgents = await subAgentRepository.selectSubAgentsByAgentId(id);
    if (Array.isArray(subAgentsRaw)) {
      const parsedSubAgents = subAgentsRaw.map((sa: unknown) =>
        SubAgentCreateSchema.parse(sa),
      );
      subAgents = await subAgentRepository.syncSubAgents(id, parsedSubAgents);
    }

    return Response.json({ ...agent, subAgents });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: error.message },
        { status: 400 },
      );
    }

    console.error("Failed to update agent:", error);
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();

  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Check if user has permission to delete agents
  const canDelete = await canDeleteAgent();
  if (!canDelete) {
    return Response.json(
      { error: "Only editors and admins can delete agents" },
      { status: 403 },
    );
  }

  try {
    const { id } = await params;
    const hasAccess = await agentRepository.checkAccess(
      id,
      session.user.id,
      true, // destructive = true for delete operations
    );
    if (!hasAccess) {
      return new Response("Unauthorized", { status: 401 });
    }
    await agentRepository.deleteAgent(id, session.user.id);
    serverCache.delete(CacheKeys.agentInstructions(id));
    return Response.json({ success: true });
  } catch (error) {
    console.error("Failed to delete agent:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
