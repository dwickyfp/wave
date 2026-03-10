import { NextRequest, NextResponse } from "next/server";
import { getSession } from "auth/server";
import logger from "lib/logger";
import { getAccessibleMcpServerOrThrow } from "lib/mcp/access";
import { getIsUserAdmin } from "lib/user/utils";
import { mcpClientsManager } from "lib/ai/mcp/mcp-manager";
import type { MCPServerDetail } from "app-types/mcp";
import { getMcpApiError } from "lib/mcp/api-error";
import { buildPublishedMcpUrl } from "lib/mcp/published-server";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;

  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await getAccessibleMcpServerOrThrow(params.id, "read");
    const client = await mcpClientsManager
      .getClient(params.id)
      .catch(() => null);
    const info = client?.client.getInfo();
    const canManage =
      access.isOwner || getIsUserAdmin(access.currentUser || session.user);

    const payload: MCPServerDetail = {
      ...access.server,
      config: canManage ? access.server.config : undefined,
      enabled: info?.enabled ?? access.server.enabled ?? true,
      status: info?.status ?? "disconnected",
      error: info?.error,
      toolInfo: info?.toolInfo ?? access.server.toolInfo ?? [],
      publishEnabled: canManage
        ? (access.server.publishEnabled ?? false)
        : undefined,
      publishAuthMode: canManage
        ? (access.server.publishAuthMode ?? "none")
        : undefined,
      publishApiKeyPreview: canManage
        ? (access.server.publishApiKeyPreview ?? null)
        : undefined,
      canManage,
      isOwner: access.isOwner,
      publishedUrl: canManage
        ? buildPublishedMcpUrl(request.nextUrl.origin, access.server.id)
        : undefined,
    };

    return NextResponse.json(payload);
  } catch (error) {
    const resolved = getMcpApiError(error);

    return NextResponse.json(
      {
        error: resolved.message,
        message: resolved.message,
      },
      { status: resolved.status },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;

  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const [
      { removeMcpClientAction },
      { pgMcpRepository },
      { canManageMCPServer },
    ] = await Promise.all([
      import("@/app/api/mcp/actions"),
      import("lib/db/pg/repositories/mcp-repository.pg"),
      import("lib/auth/permissions"),
    ]);
    const mcpServer = await pgMcpRepository.selectById(params.id);
    if (!mcpServer) {
      return NextResponse.json(
        { error: "MCP server not found" },
        { status: 404 },
      );
    }
    const canManage = await canManageMCPServer(
      mcpServer.userId,
      mcpServer.visibility,
    );
    if (!canManage) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    await removeMcpClientAction(params.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete MCP server:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete MCP server",
      },
      {
        status:
          error instanceof Error && error.message.includes("permission")
            ? 403
            : 500,
      },
    );
  }
}
