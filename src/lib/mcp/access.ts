import type { McpServerSelect } from "app-types/mcp";
import { getCurrentUser } from "lib/auth/permissions";
import { mcpRepository } from "lib/db/repository";
import { getIsUserAdmin } from "lib/user/utils";

type MCPAccessMode = "read" | "manage";

function canReadMcpServer(
  server: McpServerSelect,
  currentUser: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
) {
  return (
    server.userId === currentUser.id ||
    server.visibility === "public" ||
    getIsUserAdmin(currentUser)
  );
}

function canManageMcpServer(
  server: McpServerSelect,
  currentUser: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
) {
  return server.userId === currentUser.id || getIsUserAdmin(currentUser);
}

function assertMcpAccess(
  server: McpServerSelect | null,
  currentUser: Awaited<ReturnType<typeof getCurrentUser>>,
  mode: MCPAccessMode,
) {
  if (!currentUser) {
    throw new Error("Unauthorized");
  }

  if (!server) {
    throw new Error("MCP server not found");
  }

  const hasAccess =
    mode === "manage"
      ? canManageMcpServer(server, currentUser)
      : canReadMcpServer(server, currentUser);

  if (!hasAccess) {
    throw new Error("Unauthorized");
  }

  return {
    currentUser,
    isOwner: server.userId === currentUser.id,
    server,
  };
}

export async function getAccessibleMcpServerOrThrow(
  id: string,
  mode: MCPAccessMode = "read",
) {
  const [currentUser, server] = await Promise.all([
    getCurrentUser(),
    mcpRepository.selectById(id),
  ]);

  return assertMcpAccess(server, currentUser, mode);
}

export async function getAccessibleMcpServerByNameOrThrow(
  serverName: string,
  mode: MCPAccessMode = "read",
) {
  const [currentUser, server] = await Promise.all([
    getCurrentUser(),
    mcpRepository.selectByServerName(serverName),
  ]);

  return assertMcpAccess(server, currentUser, mode);
}

export async function listAccessibleMcpServerIds(userId: string) {
  const servers = await mcpRepository.selectAllForUser(userId);
  return new Set(servers.map((server) => server.id));
}
