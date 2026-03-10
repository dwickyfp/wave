import { MCPServerInfo } from "app-types/mcp";
import { mcpClientsManager } from "lib/ai/mcp/mcp-manager";
import { mcpRepository } from "lib/db/repository";
import { getCurrentUser } from "lib/auth/permissions";
import { getMcpApiErrorResponse } from "lib/mcp/api-error";
import { getIsUserAdmin } from "lib/user/utils";

export async function GET() {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser || !currentUser.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [servers, memoryClients] = await Promise.all([
      mcpRepository.selectAllForUser(currentUser.id),
      mcpClientsManager.getClients(),
    ]);

    const memoryMap = new Map(
      memoryClients.map(({ id, client }) => [id, client] as const),
    );

    // Add servers that exist in DB but not yet in memory
    const addTargets = servers.filter((server) => !memoryMap.has(server.id));

    if (addTargets.length > 0) {
      // no need to wait for this
      Promise.allSettled(
        addTargets.map((server) => mcpClientsManager.refreshClient(server.id)),
      );
    }

    const result = servers.map((server) => {
      const mem = memoryMap.get(server.id);
      const info = mem?.getInfo();
      const canManage =
        server.userId === currentUser.id || getIsUserAdmin(currentUser);
      const mcpInfo: MCPServerInfo = {
        ...server,
        // Hide config from non-owners to prevent credential exposure
        config: canManage ? server.config : undefined,
        enabled: info?.enabled ?? true,
        status: info?.status ?? "disconnected",
        lastConnectionStatus: server.lastConnectionStatus,
        error: info?.error,
        toolInfo: info?.toolInfo ?? server.toolInfo ?? [],
        publishEnabled: canManage
          ? (server.publishEnabled ?? false)
          : undefined,
        publishAuthMode: canManage
          ? (server.publishAuthMode ?? "none")
          : undefined,
      };
      return mcpInfo;
    });

    return Response.json(result);
  } catch (error) {
    return getMcpApiErrorResponse(error);
  }
}
