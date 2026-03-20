import type { McpServerSelect } from "app-types/mcp";
import { getCurrentUser } from "lib/auth/permissions";
import { mcpRepository, teamRepository } from "lib/db/repository";
import { getIsUserAdmin } from "lib/user/utils";

type MCPAccessMode = "read" | "manage";

async function canReadMcpServer(
  server: McpServerSelect,
  currentUser: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
) {
  if (
    server.userId === currentUser.id ||
    server.visibility === "public" ||
    getIsUserAdmin(currentUser)
  ) {
    return true;
  }

  return await teamRepository.isResourceSharedWithUserTeam({
    userId: currentUser.id,
    resourceType: "mcp",
    resourceId: server.id,
  });
}

function canManageMcpServer(
  server: McpServerSelect,
  currentUser: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
) {
  return server.userId === currentUser.id || getIsUserAdmin(currentUser);
}

async function assertMcpAccess(
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
      : await canReadMcpServer(server, currentUser);

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

  return await assertMcpAccess(server, currentUser, mode);
}

export async function getAccessibleMcpServerByNameOrThrow(
  serverName: string,
  mode: MCPAccessMode = "read",
) {
  const [currentUser, server] = await Promise.all([
    getCurrentUser(),
    mcpRepository.selectByServerName(serverName),
  ]);

  return await assertMcpAccess(server, currentUser, mode);
}

export async function listAccessibleMcpServerIds(userId: string) {
  const servers = await mcpRepository.selectAllForUser(userId);
  return new Set(servers.map((server) => server.id));
}
