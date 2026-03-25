import { NextRequest, NextResponse } from "next/server";
import { getSession } from "auth/server";
import { agentRepository } from "lib/db/repository";
import { hash } from "bcrypt-ts";
import { nanoid } from "nanoid";
import { canEditAgent } from "lib/auth/permissions";
import { z } from "zod";

interface Params {
  params: Promise<{ id: string }>;
}

const actionSchema = z.object({
  action: z.enum(["generate", "revoke"]),
});

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  requireAuth: z.boolean().optional(),
});

async function loadOwnedAgent(
  agentId: string,
  userId: string,
): Promise<
  | {
      ok: true;
      agent: Awaited<ReturnType<typeof agentRepository.selectAgentById>>;
    }
  | { ok: false; response: NextResponse }
> {
  const agent = await agentRepository.selectAgentById(agentId, userId);
  if (!agent) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Agent not found" },
        { status: 404 },
      ),
    };
  }

  if (agent.userId !== userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, agent };
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canEdit = await canEditAgent();
    if (!canEdit) {
      return NextResponse.json(
        { error: "Only creators and admins can edit agents" },
        { status: 403 },
      );
    }

    const { id } = await params;
    const { action } = actionSchema.parse(await req.json());
    const ownershipCheck = await loadOwnedAgent(id, session.user.id);
    if (!ownershipCheck.ok) return ownershipCheck.response;

    if (action === "revoke") {
      await Promise.all([
        agentRepository.setMcpApiKey(id, session.user.id, null, null),
        agentRepository.setA2aApiKey(id, session.user.id, null, null),
        agentRepository.setA2aEnabled(id, session.user.id, false),
      ]);
      return NextResponse.json({ success: true });
    }

    const rawKey = `emmaa_${nanoid(40)}`;
    const keyHash = await hash(rawKey, 10);
    const keyPreview = rawKey.slice(-4);

    await Promise.all([
      agentRepository.setMcpApiKey(id, session.user.id, keyHash, keyPreview),
      agentRepository.setA2aApiKey(id, session.user.id, keyHash, keyPreview),
    ]);

    return NextResponse.json({ key: rawKey, preview: keyPreview });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: "Failed to update agent A2A key" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canEdit = await canEditAgent();
    if (!canEdit) {
      return NextResponse.json(
        { error: "Only creators and admins can edit agents" },
        { status: 403 },
      );
    }

    const { id } = await params;
    const body = updateSchema.parse(await req.json());
    const ownershipCheck = await loadOwnedAgent(id, session.user.id);
    if (!ownershipCheck.ok) return ownershipCheck.response;

    if (body.requireAuth !== undefined) {
      await agentRepository.setA2aRequireAuth(
        id,
        session.user.id,
        body.requireAuth,
      );
      return NextResponse.json({ success: true });
    }

    const enabled = body.enabled;
    if (enabled === undefined) {
      return NextResponse.json(
        { error: "Must provide either 'enabled' or 'requireAuth'" },
        { status: 400 },
      );
    }

    const sharedKeyHash =
      ownershipCheck.agent?.mcpApiKeyHash ??
      ownershipCheck.agent?.a2aApiKeyHash;

    if (enabled && !sharedKeyHash) {
      return NextResponse.json(
        {
          error: "Generate an external access key before enabling publishing.",
        },
        { status: 400 },
      );
    }

    await agentRepository.setA2aEnabled(id, session.user.id, enabled);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: "Failed to update A2A publishing state" },
      { status: 500 },
    );
  }
}
