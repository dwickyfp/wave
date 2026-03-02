import { subAgentRepository, agentRepository } from "lib/db/repository";
import { getSession } from "auth/server";
import { z } from "zod";
import { canEditAgent } from "lib/auth/permissions";
import { SubAgentUpdateSchema } from "app-types/subagent";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; subId: string }> },
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
    const { id, subId } = await params;

    const hasAccess = await agentRepository.checkAccess(id, session.user.id);
    if (!hasAccess) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await request.json();
    const data = SubAgentUpdateSchema.parse(body);

    const subAgent = await subAgentRepository.updateSubAgent(subId, id, data);
    return Response.json(subAgent);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: error.message },
        { status: 400 },
      );
    }

    console.error("Failed to update subagent:", error);
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; subId: string }> },
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
    const { id, subId } = await params;

    const hasAccess = await agentRepository.checkAccess(
      id,
      session.user.id,
      true,
    );
    if (!hasAccess) {
      return new Response("Unauthorized", { status: 401 });
    }

    await subAgentRepository.deleteSubAgent(subId, id);
    return Response.json({ success: true });
  } catch (error) {
    console.error("Failed to delete subagent:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
