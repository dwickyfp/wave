"use server";
import { mcpClientsManager } from "lib/ai/mcp/mcp-manager";
import { z } from "zod";

import { McpServerTable } from "lib/db/pg/schema.pg";
import { mcpOAuthRepository, mcpRepository } from "lib/db/repository";
import {
  canCreateMCP,
  canShareMCPServer,
  getCurrentUser,
} from "lib/auth/permissions";
import {
  getAccessibleMcpServerByNameOrThrow,
  getAccessibleMcpServerOrThrow,
} from "lib/mcp/access";
import { getIsUserAdmin } from "lib/user/utils";

export async function selectMcpClientsAction() {
  // Get current user to filter MCP servers
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return [];
  }

  // Get all MCP servers the user can access (their own + shared)
  const accessibleServers = await mcpRepository.selectAllForUser(
    currentUser.id,
  );
  const accessibleIds = new Set(accessibleServers.map((s) => s.id));

  // Get all active clients and filter to only accessible ones
  const list = await mcpClientsManager.getClients();
  return list
    .filter(({ id }) => accessibleIds.has(id))
    .map(({ client, id }) => {
      const server = accessibleServers.find((s) => s.id === id);
      return {
        ...client.getInfo(),
        id,
        userId: server?.userId,
        visibility: server?.visibility,
        isOwner: server?.userId === currentUser.id,
        canManage: server
          ? server.userId === currentUser.id || getIsUserAdmin(currentUser)
          : false,
      };
    });
}

export async function selectMcpClientAction(id: string) {
  await getAccessibleMcpServerOrThrow(id, "manage");
  const client = await mcpClientsManager.getClient(id);
  if (!client) {
    throw new Error("Client not found");
  }
  return {
    ...client.client.getInfo(),
    id,
  };
}

export async function saveMcpClientAction(
  server: typeof McpServerTable.$inferInsert,
) {
  if (process.env.NOT_ALLOW_ADD_MCP_SERVERS) {
    throw new Error("Not allowed to add MCP servers");
  }

  const existingServer = server.id
    ? (await getAccessibleMcpServerOrThrow(server.id, "manage")).server
    : null;

  // Get current user
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error("You must be logged in to create MCP connections");
  }

  // Check if user has permission to create/edit MCP connections
  const hasPermission = await canCreateMCP();
  if (!hasPermission) {
    throw new Error("You don't have permission to create MCP connections");
  }
  // Validate name to ensure it only contains alphanumeric characters and hyphens
  const nameSchema = z.string().regex(/^[a-zA-Z0-9\-]+$/, {
    message:
      "Name must contain only alphanumeric characters (A-Z, a-z, 0-9) and hyphens (-)",
  });

  const result = nameSchema.safeParse(server.name);
  if (!result.success) {
    throw new Error(
      "Name must contain only alphanumeric characters (A-Z, a-z, 0-9) and hyphens (-)",
    );
  }

  // Check for duplicate names if creating a featured server
  if (server.visibility === "public") {
    // Only admins can create featured MCP servers
    const canShare = await canShareMCPServer();
    if (!canShare) {
      throw new Error("Only administrators can feature MCP servers");
    }

    // Check if a featured server with this name already exists
    const existing = await mcpRepository.selectByServerName(server.name);
    if (existing && existing.id !== existingServer?.id) {
      throw new Error("A featured MCP server with this name already exists");
    }
  }

  // Add userId to the server object
  const serverWithUser = {
    ...server,
    userId: existingServer?.userId ?? currentUser.id,
    visibility: server.visibility || existingServer?.visibility || "private",
  };

  return mcpClientsManager.persistClient(serverWithUser);
}

export async function existMcpClientByServerNameAction(serverName: string) {
  return await mcpRepository.existsByServerName(serverName);
}

export async function removeMcpClientAction(id: string) {
  await getAccessibleMcpServerOrThrow(id, "manage");
  await mcpClientsManager.removeClient(id);
}

export async function refreshMcpClientAction(id: string) {
  await getAccessibleMcpServerOrThrow(id, "manage");
  await mcpClientsManager.refreshClient(id);
}

export async function authorizeMcpClientAction(id: string) {
  await refreshMcpClientAction(id);
  const client = await mcpClientsManager.getClient(id);
  if (client?.client.status != "authorizing") {
    throw new Error("Not Authorizing");
  }
  return client.client.getAuthorizationUrl()?.toString();
}

export async function checkTokenMcpClientAction(id: string) {
  await getAccessibleMcpServerOrThrow(id, "manage");
  const session = await mcpOAuthRepository.getAuthenticatedSession(id);

  // for wait connect to mcp server
  await mcpClientsManager.getClient(id).catch(() => null);

  return !!session?.tokens;
}

export async function callMcpToolAction(
  id: string,
  toolName: string,
  input: unknown,
) {
  await getAccessibleMcpServerOrThrow(id, "manage");
  return mcpClientsManager.toolCall(id, toolName, input);
}

export async function callMcpToolByServerNameAction(
  serverName: string,
  toolName: string,
  input: unknown,
) {
  const { server } = await getAccessibleMcpServerByNameOrThrow(
    serverName,
    "read",
  );
  return mcpClientsManager.toolCall(server.id, toolName, input);
}

export async function shareMcpServerAction(
  id: string,
  visibility: "public" | "private",
) {
  // Only admins can feature MCP servers
  const canShare = await canShareMCPServer();
  if (!canShare) {
    throw new Error("Only administrators can feature MCP servers");
  }

  await getAccessibleMcpServerOrThrow(id, "manage");

  // Update the visibility of the MCP server
  await mcpRepository.updateVisibility(id, visibility);

  return { success: true };
}
