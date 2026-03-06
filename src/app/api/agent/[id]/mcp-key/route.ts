import { NextRequest, NextResponse } from "next/server";
import { getSession } from "auth/server";
import { agentRepository, settingsRepository } from "lib/db/repository";
import { hash } from "bcrypt-ts";
import { nanoid } from "nanoid";
import { z } from "zod";

interface Params {
  params: Promise<{ id: string }>;
}

const actionSchema = z.object({
  action: z.enum(["generate", "revoke"]),
});

const updateSchema = z
  .object({
    enabled: z.boolean().optional(),
    model: z
      .object({
        provider: z.string().min(1),
        model: z.string().min(1),
      })
      .nullable()
      .optional(),
  })
  .refine((value) => value.enabled !== undefined || value.model !== undefined, {
    message: "At least one of enabled/model is required",
  });

function isToolCapableLlmModel(candidate: {
  enabled: boolean;
  supportsTools: boolean;
  modelType?: string | null;
}) {
  return (
    candidate.enabled &&
    candidate.supportsTools &&
    (!candidate.modelType || candidate.modelType === "llm")
  );
}

async function validateMcpModelSelection(input: {
  provider: string;
  model: string;
}): Promise<boolean> {
  const providers = await settingsRepository.getProviders({
    enabledOnly: true,
  });
  const matchedProvider = providers.find((provider) => {
    return provider.name === input.provider;
  });
  if (!matchedProvider) return false;

  return matchedProvider.models.some(
    (candidate) =>
      isToolCapableLlmModel(candidate) &&
      (candidate.uiName === input.model || candidate.apiName === input.model),
  );
}

async function loadOwnedStandardAgent(
  agentId: string,
  userId: string,
): Promise<
  | {
      ok: true;
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

  if (agent.agentType === "snowflake_cortex") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "MCP is only available for base agents" },
        { status: 400 },
      ),
    };
  }

  return { ok: true };
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { action } = actionSchema.parse(await req.json());

    const ownershipCheck = await loadOwnedStandardAgent(id, session.user.id);
    if (!ownershipCheck.ok) return ownershipCheck.response;

    if (action === "revoke") {
      await agentRepository.setMcpApiKey(id, session.user.id, null, null);
      return NextResponse.json({ success: true });
    }

    const rawKey = `wavea_${nanoid(40)}`;
    const keyHash = await hash(rawKey, 10);
    const keyPreview = rawKey.slice(-4);

    await agentRepository.setMcpApiKey(
      id,
      session.user.id,
      keyHash,
      keyPreview,
    );
    return NextResponse.json({ key: rawKey, preview: keyPreview });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Failed to update agent MCP key" },
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

    const { id } = await params;
    const { enabled, model } = updateSchema.parse(await req.json());

    const ownershipCheck = await loadOwnedStandardAgent(id, session.user.id);
    if (!ownershipCheck.ok) return ownershipCheck.response;

    if (enabled !== undefined) {
      await agentRepository.setMcpEnabled(id, session.user.id, enabled);
    }

    if (model !== undefined) {
      if (model === null) {
        await agentRepository.setMcpModel(id, session.user.id, null, null);
      } else {
        const validSelection = await validateMcpModelSelection(model);
        if (!validSelection) {
          return NextResponse.json(
            {
              error:
                "Invalid MCP model selection. Select an enabled tool-capable LLM model.",
            },
            { status: 400 },
          );
        }

        await agentRepository.setMcpModel(
          id,
          session.user.id,
          model.provider,
          model.model,
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Failed to update agent MCP status" },
      { status: 500 },
    );
  }
}
