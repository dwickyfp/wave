import {
  A2AAgentConfigUpdateSchema,
  type A2AAgentConfig,
} from "app-types/a2a-agent";
import { A2A_REDACTED_SECRET, toSafeA2AConfig } from "lib/a2a/client";
import { getSession } from "auth/server";
import { canEditAgent } from "lib/auth/permissions";
import { agentRepository, a2aAgentRepository } from "lib/db/repository";
import { z } from "zod";

function mergeConfigUpdate(
  current: A2AAgentConfig,
  incoming: Record<string, unknown>,
) {
  const next = { ...incoming };

  if (next.authSecret === A2A_REDACTED_SECRET || next.authSecret === "") {
    next.authSecret = current.authSecret;
  }

  if (next.authHeaderName === "" || next.authHeaderName === undefined) {
    next.authHeaderName = current.authHeaderName;
  }

  if (next.authMode === "none") {
    next.authHeaderName = undefined;
    next.authSecret = undefined;
  }

  return next;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const hasAccess = await agentRepository.checkAccess(id, session.user.id);
  if (!hasAccess) {
    return new Response("Unauthorized", { status: 401 });
  }

  const agent = await agentRepository.selectAgentById(id, session.user.id);
  if (!agent || agent.agentType !== "a2a_remote") {
    return Response.json({ error: "A2A agent not found" }, { status: 404 });
  }

  const config = await a2aAgentRepository.selectA2AConfigByAgentId(id);
  if (!config) {
    return Response.json({ error: "A2A config not found" }, { status: 404 });
  }

  return Response.json(toSafeA2AConfig(config));
}

export async function PUT(
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
      { error: "Only creators and admins can edit agents" },
      { status: 403 },
    );
  }

  try {
    const { id } = await params;
    const hasAccess = await agentRepository.checkAccess(id, session.user.id);
    if (!hasAccess) {
      return new Response("Unauthorized", { status: 401 });
    }

    const current = await a2aAgentRepository.selectA2AConfigByAgentId(id);
    if (!current) {
      return Response.json({ error: "A2A config not found" }, { status: 404 });
    }

    const rawBody = await request.json();
    const data = A2AAgentConfigUpdateSchema.parse(
      mergeConfigUpdate(current, rawBody),
    );

    const config = await a2aAgentRepository.updateA2AConfig(id, data);
    return Response.json(toSafeA2AConfig(config));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: error.message },
        { status: 400 },
      );
    }

    console.error("Failed to update A2A config:", error);
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
