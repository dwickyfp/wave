import { getSession } from "auth/server";
import { hash } from "bcrypt-ts";
import { nanoid } from "nanoid";
import { NextRequest, NextResponse } from "next/server";
import {
  McpServerPublishKeyActionZodSchema,
  McpServerPublishUpdateZodSchema,
} from "app-types/mcp";
import { getMcpApiError } from "lib/mcp/api-error";
import { getAccessibleMcpServerOrThrow } from "lib/mcp/access";
import { mcpRepository } from "lib/db/repository";

function toErrorResponse(error: unknown) {
  const resolved = getMcpApiError(error);

  return NextResponse.json(
    { error: resolved.message, message: resolved.message },
    { status: resolved.status },
  );
}

interface Params {
  params: Promise<{ id: string }>;
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    await getAccessibleMcpServerOrThrow(id, "manage");
    const body = McpServerPublishUpdateZodSchema.parse(await req.json());

    if (body.enabled && body.authMode === "bearer") {
      const server = await mcpRepository.selectById(id);
      if (!server?.publishApiKeyHash) {
        return NextResponse.json(
          {
            error: "Generate a publish key before enabling bearer mode.",
            message: "Generate a publish key before enabling bearer mode.",
          },
          { status: 400 },
        );
      }
    }

    await mcpRepository.updatePublishState(id, {
      enabled: body.enabled,
      authMode: body.authMode,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    await getAccessibleMcpServerOrThrow(id, "manage");
    const { action } = McpServerPublishKeyActionZodSchema.parse(
      await req.json(),
    );

    if (action === "revoke") {
      await Promise.all([
        mcpRepository.setPublishApiKey(id, null, null),
        mcpRepository.updatePublishState(id, {
          enabled: false,
          authMode: "bearer",
        }),
      ]);
      return NextResponse.json({ success: true });
    }

    const rawKey = `mcp_${nanoid(40)}`;
    const keyHash = await hash(rawKey, 10);
    const keyPreview = rawKey.slice(-4);

    await mcpRepository.setPublishApiKey(id, keyHash, keyPreview);

    return NextResponse.json({ key: rawKey, preview: keyPreview });
  } catch (error) {
    return toErrorResponse(error);
  }
}
