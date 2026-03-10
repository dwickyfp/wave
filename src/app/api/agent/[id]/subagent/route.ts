import { subAgentRepository, agentRepository } from "lib/db/repository";
import { getSession } from "auth/server";
import { z } from "zod";
import { canEditAgent } from "lib/auth/permissions";
import { SubAgentCreateSchema } from "app-types/subagent";

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
  return Response.json(subAgents);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();

  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const canEdit = await canEditAgent();
  if (!canEdit) {
    return Response.json(
      { error: "Only editors and admins can edit agents" },
      { status: 403 },
    );
  }

  try {
    const { id } = await params;

    const hasAccess = await agentRepository.checkAccess(id, session.user.id);
    if (!hasAccess) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await request.json();
    const data = SubAgentCreateSchema.parse(body);

    const subAgent = await subAgentRepository.insertSubAgent(id, data);
    return Response.json(subAgent);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: error.message },
        { status: 400 },
      );
    }

    console.error("Failed to create subagent:", error);
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
