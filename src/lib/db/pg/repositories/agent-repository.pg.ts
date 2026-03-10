import { Agent, AgentRepository, AgentSummary } from "app-types/agent";
import { pgDb as db } from "../db.pg";
import { AgentTable, BookmarkTable, UserTable } from "../schema.pg";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { generateUUID } from "lib/utils";

function toAgentRecord(result: any): Agent {
  return {
    ...result,
    description: result.description ?? undefined,
    icon: result.icon ?? undefined,
    instructions: result.instructions ?? {},
    chatPersonalizationEnabled: result.chatPersonalizationEnabled ?? true,
    mcpApiKeyHash: result.mcpApiKeyHash ?? null,
    mcpApiKeyPreview: result.mcpApiKeyPreview ?? null,
    mcpModelProvider: result.mcpModelProvider ?? null,
    mcpModelName: result.mcpModelName ?? null,
    mcpCodingMode: result.mcpCodingMode ?? false,
    mcpAutocompleteModelProvider: result.mcpAutocompleteModelProvider ?? null,
    mcpAutocompleteModelName: result.mcpAutocompleteModelName ?? null,
    mcpPresentationMode: result.mcpPresentationMode ?? "compatibility",
    a2aApiKeyHash: result.a2aApiKeyHash ?? null,
    a2aApiKeyPreview: result.a2aApiKeyPreview ?? null,
    a2aEnabled: result.a2aEnabled ?? false,
    isBookmarked: result.isBookmarked ?? false,
    userName: result.userName ?? undefined,
    userAvatar: result.userAvatar ?? undefined,
  };
}

function toAgentSummaryRecord(result: any): AgentSummary {
  return {
    ...result,
    description: result.description ?? undefined,
    icon: result.icon ?? undefined,
    a2aApiKeyHash: result.a2aApiKeyHash ?? null,
    a2aApiKeyPreview: result.a2aApiKeyPreview ?? null,
    a2aEnabled: result.a2aEnabled ?? false,
    userName: result.userName ?? undefined,
    userAvatar: result.userAvatar ?? undefined,
    isBookmarked: result.isBookmarked ?? false,
  };
}

export const pgAgentRepository: AgentRepository = {
  async insertAgent(agent) {
    const [result] = await db
      .insert(AgentTable)
      .values({
        id: generateUUID(),
        name: agent.name,
        description: agent.description,
        icon: agent.icon,
        userId: agent.userId,
        instructions: agent.instructions,
        visibility: agent.visibility || "private",
        subAgentsEnabled: agent.subAgentsEnabled ?? false,
        chatPersonalizationEnabled: agent.chatPersonalizationEnabled ?? true,
        agentType: (agent as any).agentType ?? "standard",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return toAgentRecord(result);
  },

  async selectAgentById(id, userId): Promise<Agent | null> {
    const [result] = await db
      .select({
        id: AgentTable.id,
        name: AgentTable.name,
        description: AgentTable.description,
        icon: AgentTable.icon,
        userId: AgentTable.userId,
        instructions: AgentTable.instructions,
        visibility: AgentTable.visibility,
        subAgentsEnabled: AgentTable.subAgentsEnabled,
        chatPersonalizationEnabled: AgentTable.chatPersonalizationEnabled,
        agentType: AgentTable.agentType,
        mcpEnabled: AgentTable.mcpEnabled,
        mcpApiKeyHash: AgentTable.mcpApiKeyHash,
        mcpApiKeyPreview: AgentTable.mcpApiKeyPreview,
        a2aEnabled: AgentTable.a2aEnabled,
        a2aApiKeyHash: AgentTable.a2aApiKeyHash,
        a2aApiKeyPreview: AgentTable.a2aApiKeyPreview,
        mcpModelProvider: AgentTable.mcpModelProvider,
        mcpModelName: AgentTable.mcpModelName,
        mcpCodingMode: AgentTable.mcpCodingMode,
        mcpAutocompleteModelProvider: AgentTable.mcpAutocompleteModelProvider,
        mcpAutocompleteModelName: AgentTable.mcpAutocompleteModelName,
        mcpPresentationMode: AgentTable.mcpPresentationMode,
        createdAt: AgentTable.createdAt,
        updatedAt: AgentTable.updatedAt,
        isBookmarked: sql<boolean>`${BookmarkTable.id} IS NOT NULL`,
      })
      .from(AgentTable)
      .leftJoin(
        BookmarkTable,
        and(
          eq(BookmarkTable.itemId, AgentTable.id),
          eq(BookmarkTable.userId, userId),
          eq(BookmarkTable.itemType, "agent"),
        ),
      )
      .where(
        and(
          eq(AgentTable.id, id),
          or(
            eq(AgentTable.userId, userId), // Own agent
            eq(AgentTable.visibility, "public"), // Public agent
            eq(AgentTable.visibility, "readonly"), // Readonly agent
          ),
        ),
      );

    if (!result) return null;

    return toAgentRecord(result);
  },

  async selectAgentByIdForMcp(id): Promise<Agent | null> {
    const [result] = await db
      .select({
        id: AgentTable.id,
        name: AgentTable.name,
        description: AgentTable.description,
        icon: AgentTable.icon,
        userId: AgentTable.userId,
        instructions: AgentTable.instructions,
        visibility: AgentTable.visibility,
        subAgentsEnabled: AgentTable.subAgentsEnabled,
        chatPersonalizationEnabled: AgentTable.chatPersonalizationEnabled,
        agentType: AgentTable.agentType,
        mcpEnabled: AgentTable.mcpEnabled,
        mcpApiKeyHash: AgentTable.mcpApiKeyHash,
        mcpApiKeyPreview: AgentTable.mcpApiKeyPreview,
        a2aEnabled: AgentTable.a2aEnabled,
        a2aApiKeyHash: AgentTable.a2aApiKeyHash,
        a2aApiKeyPreview: AgentTable.a2aApiKeyPreview,
        mcpModelProvider: AgentTable.mcpModelProvider,
        mcpModelName: AgentTable.mcpModelName,
        mcpCodingMode: AgentTable.mcpCodingMode,
        mcpAutocompleteModelProvider: AgentTable.mcpAutocompleteModelProvider,
        mcpAutocompleteModelName: AgentTable.mcpAutocompleteModelName,
        mcpPresentationMode: AgentTable.mcpPresentationMode,
        createdAt: AgentTable.createdAt,
        updatedAt: AgentTable.updatedAt,
      })
      .from(AgentTable)
      .where(eq(AgentTable.id, id));

    if (!result) return null;

    return toAgentRecord(result);
  },

  async selectAgentsByUserId(userId) {
    const results = await db
      .select({
        id: AgentTable.id,
        name: AgentTable.name,
        description: AgentTable.description,
        icon: AgentTable.icon,
        userId: AgentTable.userId,
        instructions: AgentTable.instructions,
        visibility: AgentTable.visibility,
        chatPersonalizationEnabled: AgentTable.chatPersonalizationEnabled,
        agentType: AgentTable.agentType,
        mcpEnabled: AgentTable.mcpEnabled,
        mcpApiKeyHash: AgentTable.mcpApiKeyHash,
        mcpApiKeyPreview: AgentTable.mcpApiKeyPreview,
        a2aEnabled: AgentTable.a2aEnabled,
        a2aApiKeyHash: AgentTable.a2aApiKeyHash,
        a2aApiKeyPreview: AgentTable.a2aApiKeyPreview,
        mcpModelProvider: AgentTable.mcpModelProvider,
        mcpModelName: AgentTable.mcpModelName,
        mcpCodingMode: AgentTable.mcpCodingMode,
        mcpAutocompleteModelProvider: AgentTable.mcpAutocompleteModelProvider,
        mcpAutocompleteModelName: AgentTable.mcpAutocompleteModelName,
        mcpPresentationMode: AgentTable.mcpPresentationMode,
        createdAt: AgentTable.createdAt,
        updatedAt: AgentTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
        isBookmarked: sql<boolean>`false`,
      })
      .from(AgentTable)
      .innerJoin(UserTable, eq(AgentTable.userId, UserTable.id))
      .where(eq(AgentTable.userId, userId))
      .orderBy(desc(AgentTable.createdAt));

    // Map database nulls to undefined and set defaults for owned agents
    return results.map((result) => ({
      ...toAgentRecord(result),
      isBookmarked: false,
    }));
  },

  async updateAgent(id, userId, agent) {
    const [result] = await db
      .update(AgentTable)
      .set({
        ...agent,
        updatedAt: new Date(),
      })
      .where(
        and(
          // Only allow updates to agents owned by the user or public agents
          eq(AgentTable.id, id),
          or(
            eq(AgentTable.userId, userId),
            eq(AgentTable.visibility, "public"),
          ),
        ),
      )
      .returning();

    return toAgentRecord(result);
  },

  async deleteAgent(id, userId) {
    await db
      .delete(AgentTable)
      .where(and(eq(AgentTable.id, id), eq(AgentTable.userId, userId)));
  },

  async selectAgents(
    currentUserId,
    filters = ["all"],
    limit = 50,
  ): Promise<AgentSummary[]> {
    let orConditions: any[] = [];

    // Build OR conditions based on filters array
    for (const filter of filters) {
      if (filter === "mine") {
        orConditions.push(eq(AgentTable.userId, currentUserId));
      } else if (filter === "shared") {
        orConditions.push(
          and(
            ne(AgentTable.userId, currentUserId),
            or(
              eq(AgentTable.visibility, "public"),
              eq(AgentTable.visibility, "readonly"),
            ),
          ),
        );
      } else if (filter === "bookmarked") {
        orConditions.push(
          and(
            ne(AgentTable.userId, currentUserId),
            or(
              eq(AgentTable.visibility, "public"),
              eq(AgentTable.visibility, "readonly"),
            ),
            sql`${BookmarkTable.id} IS NOT NULL`,
          ),
        );
      } else if (filter === "all") {
        // All available agents (mine + shared) - this overrides other filters
        orConditions = [
          or(
            // My agents
            eq(AgentTable.userId, currentUserId),
            // Shared agents
            and(
              ne(AgentTable.userId, currentUserId),
              or(
                eq(AgentTable.visibility, "public"),
                eq(AgentTable.visibility, "readonly"),
              ),
            ),
          ),
        ];
        break; // "all" overrides everything else
      }
    }

    const results = await db
      .select({
        id: AgentTable.id,
        name: AgentTable.name,
        description: AgentTable.description,
        icon: AgentTable.icon,
        userId: AgentTable.userId,
        // Exclude instructions from list queries for performance
        visibility: AgentTable.visibility,
        agentType: AgentTable.agentType,
        a2aEnabled: AgentTable.a2aEnabled,
        a2aApiKeyHash: AgentTable.a2aApiKeyHash,
        a2aApiKeyPreview: AgentTable.a2aApiKeyPreview,
        createdAt: AgentTable.createdAt,
        updatedAt: AgentTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
        isBookmarked: sql<boolean>`CASE WHEN ${BookmarkTable.id} IS NOT NULL THEN true ELSE false END`,
      })
      .from(AgentTable)
      .innerJoin(UserTable, eq(AgentTable.userId, UserTable.id))
      .leftJoin(
        BookmarkTable,
        and(
          eq(BookmarkTable.itemId, AgentTable.id),
          eq(BookmarkTable.itemType, "agent"),
          eq(BookmarkTable.userId, currentUserId),
        ),
      )
      .where(orConditions.length > 1 ? or(...orConditions) : orConditions[0])
      .orderBy(
        // My agents first, then other shared agents
        sql`CASE WHEN ${AgentTable.userId} = ${currentUserId} THEN 0 ELSE 1 END`,
        desc(AgentTable.createdAt),
      )
      .limit(limit);

    // Map database nulls to undefined
    return results.map((result) => toAgentSummaryRecord(result));
  },

  async checkAccess(agentId, userId, destructive = false) {
    const [agent] = await db
      .select({
        visibility: AgentTable.visibility,
        userId: AgentTable.userId,
      })
      .from(AgentTable)
      .where(eq(AgentTable.id, agentId));
    if (!agent) {
      return false;
    }
    if (userId == agent.userId) return true;
    if (agent.visibility === "public" && !destructive) return true;
    return false;
  },

  async setMcpApiKey(id, userId, keyHash, keyPreview) {
    await db
      .update(AgentTable)
      .set({
        mcpApiKeyHash: keyHash,
        mcpApiKeyPreview: keyPreview,
        updatedAt: new Date(),
      })
      .where(and(eq(AgentTable.id, id), eq(AgentTable.userId, userId)));
  },

  async setMcpEnabled(id, userId, enabled) {
    await db
      .update(AgentTable)
      .set({
        mcpEnabled: enabled,
        updatedAt: new Date(),
      })
      .where(and(eq(AgentTable.id, id), eq(AgentTable.userId, userId)));
  },

  async setChatPersonalizationEnabled(id, userId, enabled) {
    await db
      .update(AgentTable)
      .set({
        chatPersonalizationEnabled: enabled,
        updatedAt: new Date(),
      })
      .where(and(eq(AgentTable.id, id), eq(AgentTable.userId, userId)));
  },

  async setMcpModel(id, userId, modelProvider, modelName) {
    await db
      .update(AgentTable)
      .set({
        mcpModelProvider: modelProvider,
        mcpModelName: modelName,
        updatedAt: new Date(),
      })
      .where(and(eq(AgentTable.id, id), eq(AgentTable.userId, userId)));
  },

  async setMcpCodingMode(id, userId, enabled) {
    await db
      .update(AgentTable)
      .set({
        mcpCodingMode: enabled,
        updatedAt: new Date(),
      })
      .where(and(eq(AgentTable.id, id), eq(AgentTable.userId, userId)));
  },

  async setMcpAutocompleteModel(id, userId, modelProvider, modelName) {
    await db
      .update(AgentTable)
      .set({
        mcpAutocompleteModelProvider: modelProvider,
        mcpAutocompleteModelName: modelName,
        updatedAt: new Date(),
      })
      .where(and(eq(AgentTable.id, id), eq(AgentTable.userId, userId)));
  },

  async setMcpPresentationMode(id, userId, presentationMode) {
    await db
      .update(AgentTable)
      .set({
        mcpPresentationMode: presentationMode,
        updatedAt: new Date(),
      })
      .where(and(eq(AgentTable.id, id), eq(AgentTable.userId, userId)));
  },

  async setA2aApiKey(id, userId, keyHash, keyPreview) {
    await db
      .update(AgentTable)
      .set({
        a2aApiKeyHash: keyHash,
        a2aApiKeyPreview: keyPreview,
        updatedAt: new Date(),
      })
      .where(and(eq(AgentTable.id, id), eq(AgentTable.userId, userId)));
  },

  async setA2aEnabled(id, userId, enabled) {
    await db
      .update(AgentTable)
      .set({
        a2aEnabled: enabled,
        updatedAt: new Date(),
      })
      .where(and(eq(AgentTable.id, id), eq(AgentTable.userId, userId)));
  },

  async getAgentByMcpKey(agentId) {
    const [row] = await db
      .select({
        id: AgentTable.id,
        userId: AgentTable.userId,
        agentType: AgentTable.agentType,
        mcpApiKeyHash: AgentTable.mcpApiKeyHash,
        mcpEnabled: AgentTable.mcpEnabled,
      })
      .from(AgentTable)
      .where(eq(AgentTable.id, agentId));

    if (!row) return null;

    return {
      id: row.id,
      userId: row.userId,
      agentType: row.agentType,
      mcpApiKeyHash: row.mcpApiKeyHash ?? null,
      mcpEnabled: row.mcpEnabled,
    };
  },

  async getAgentByA2aKey(agentId) {
    const [row] = await db
      .select({
        id: AgentTable.id,
        userId: AgentTable.userId,
        agentType: AgentTable.agentType,
        mcpApiKeyHash: AgentTable.mcpApiKeyHash,
        a2aApiKeyHash: AgentTable.a2aApiKeyHash,
        a2aEnabled: AgentTable.a2aEnabled,
      })
      .from(AgentTable)
      .where(eq(AgentTable.id, agentId));

    if (!row) return null;

    return {
      id: row.id,
      userId: row.userId,
      agentType: row.agentType,
      mcpApiKeyHash: row.mcpApiKeyHash ?? null,
      a2aApiKeyHash: row.a2aApiKeyHash ?? null,
      a2aEnabled: row.a2aEnabled,
    };
  },
};
