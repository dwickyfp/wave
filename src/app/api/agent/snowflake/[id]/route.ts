import { agentRepository, snowflakeAgentRepository } from "lib/db/repository";
import { getSession } from "auth/server";
import { z } from "zod";
import { canEditAgent } from "lib/auth/permissions";
import { SnowflakeAgentConfigUpdateSchema } from "app-types/snowflake-agent";

/**
 * GET /api/agent/snowflake/[id]
 * Returns the Snowflake config for an agent with the private key redacted.
 */
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

  const config =
    await snowflakeAgentRepository.selectSnowflakeConfigByAgentId(id);
  if (!config) {
    return Response.json(
      { error: "Snowflake config not found" },
      { status: 404 },
    );
  }

  // Redact the private key for safe display
  return Response.json({
    ...config,
    privateKeyPem: "••••••••",
    hasPrivateKey: config.privateKeyPem.length > 0,
  });
}

/**
 * PUT /api/agent/snowflake/[id]
 * Updates the Snowflake config for an agent.
 * If a blank privateKeyPem is submitted, the existing key is preserved.
 */
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
    const data = SnowflakeAgentConfigUpdateSchema.parse(body);

    // If privateKeyPem is blank or redacted, remove it from the update payload
    // so we don't overwrite the stored key with placeholder text
    if (!data.privateKeyPem || data.privateKeyPem === "••••••••") {
      delete data.privateKeyPem;
    }

    const config = await snowflakeAgentRepository.updateSnowflakeConfig(
      id,
      data,
    );

    return Response.json({
      ...config,
      privateKeyPem: "••••••••",
      hasPrivateKey: config.privateKeyPem.length > 0,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: error.message },
        { status: 400 },
      );
    }
    console.error("Failed to update Snowflake config:", error);
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
