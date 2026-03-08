import { pgDb as db } from "../db.pg";
import { McpServerTable, UserTable } from "../schema.pg";
import { eq, or, desc } from "drizzle-orm";
import { generateUUID } from "lib/utils";
import type { MCPRepository } from "app-types/mcp";

export const pgMcpRepository: MCPRepository = {
  async save(server) {
    const now = new Date();

    if (server.id) {
      const [existing] = await db
        .select()
        .from(McpServerTable)
        .where(eq(McpServerTable.id, server.id));

      if (existing) {
        if (existing.userId !== server.userId) {
          throw new Error("Unauthorized");
        }

        const [updated] = await db
          .update(McpServerTable)
          .set({
            name: server.name,
            config: server.config,
            visibility: server.visibility ?? existing.visibility,
            updatedAt: now,
          })
          .where(eq(McpServerTable.id, server.id))
          .returning();

        return updated;
      }
    }

    const [result] = await db
      .insert(McpServerTable)
      .values({
        id: server.id ?? generateUUID(),
        name: server.name,
        config: server.config,
        userId: server.userId,
        visibility: server.visibility ?? "private",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return result;
  },

  async selectById(id) {
    const [result] = await db
      .select()
      .from(McpServerTable)
      .where(eq(McpServerTable.id, id));
    return result;
  },

  async selectAll() {
    const results = await db.select().from(McpServerTable);
    return results;
  },

  async selectAllForUser(userId) {
    // Get user's own MCP servers and featured ones
    const results = await db
      .select({
        id: McpServerTable.id,
        name: McpServerTable.name,
        config: McpServerTable.config,
        enabled: McpServerTable.enabled,
        userId: McpServerTable.userId,
        visibility: McpServerTable.visibility,
        lastConnectionStatus: McpServerTable.lastConnectionStatus,
        createdAt: McpServerTable.createdAt,
        updatedAt: McpServerTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
      })
      .from(McpServerTable)
      .leftJoin(UserTable, eq(McpServerTable.userId, UserTable.id))
      .where(
        or(
          eq(McpServerTable.userId, userId),
          eq(McpServerTable.visibility, "public"),
        ),
      )
      .orderBy(desc(McpServerTable.createdAt));
    return results;
  },

  async updateVisibility(id, visibility) {
    await db
      .update(McpServerTable)
      .set({ visibility, updatedAt: new Date() })
      .where(eq(McpServerTable.id, id));
  },

  async deleteById(id) {
    await db.delete(McpServerTable).where(eq(McpServerTable.id, id));
  },

  async selectByServerName(name) {
    const [result] = await db
      .select()
      .from(McpServerTable)
      .where(eq(McpServerTable.name, name));
    return result;
  },
  async updateToolInfo(id, toolInfo) {
    await db
      .update(McpServerTable)
      .set({
        toolInfo,
        toolInfoUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(McpServerTable.id, id));
  },

  async updateConnectionStatus(id, status) {
    await db
      .update(McpServerTable)
      .set({
        lastConnectionStatus: status,
        updatedAt: new Date(),
      })
      .where(eq(McpServerTable.id, id));
  },

  async existsByServerName(name) {
    const [result] = await db
      .select({ id: McpServerTable.id })
      .from(McpServerTable)
      .where(eq(McpServerTable.name, name));

    return !!result;
  },
};
