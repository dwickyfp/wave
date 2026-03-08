import type { A2AAgentConfig, A2AAgentRepository } from "app-types/a2a-agent";
import { eq } from "drizzle-orm";
import { generateUUID } from "lib/utils";
import { pgDb as db } from "../db.pg";
import { A2AAgentConfigTable } from "../schema.pg";

type DbA2ARow = typeof A2AAgentConfigTable.$inferSelect;

function toConfig(row: DbA2ARow): A2AAgentConfig {
  return {
    ...row,
    authHeaderName: row.authHeaderName ?? undefined,
    authSecret: row.authSecret ?? undefined,
  };
}

export const pgA2aAgentRepository: A2AAgentRepository = {
  async insertA2AConfig(agentId, config): Promise<A2AAgentConfig> {
    const [result] = await db
      .insert(A2AAgentConfigTable)
      .values({
        id: generateUUID(),
        agentId,
        inputUrl: config.inputUrl,
        agentCardUrl: config.agentCardUrl,
        rpcUrl: config.rpcUrl,
        authMode: config.authMode,
        authHeaderName: config.authHeaderName ?? null,
        authSecret: config.authSecret ?? null,
        agentCard: config.agentCard,
        lastDiscoveredAt: config.lastDiscoveredAt ?? new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return toConfig(result);
  },

  async selectA2AConfigByAgentId(agentId): Promise<A2AAgentConfig | null> {
    const [result] = await db
      .select()
      .from(A2AAgentConfigTable)
      .where(eq(A2AAgentConfigTable.agentId, agentId));

    return result ? toConfig(result) : null;
  },

  async updateA2AConfig(agentId, config): Promise<A2AAgentConfig> {
    const [result] = await db
      .update(A2AAgentConfigTable)
      .set({
        ...config,
        authHeaderName:
          config.authHeaderName === undefined
            ? undefined
            : (config.authHeaderName ?? null),
        authSecret:
          config.authSecret === undefined
            ? undefined
            : (config.authSecret ?? null),
        updatedAt: new Date(),
      })
      .where(eq(A2AAgentConfigTable.agentId, agentId))
      .returning();

    return toConfig(result);
  },

  async deleteA2AConfig(agentId): Promise<void> {
    await db
      .delete(A2AAgentConfigTable)
      .where(eq(A2AAgentConfigTable.agentId, agentId));
  },
};
