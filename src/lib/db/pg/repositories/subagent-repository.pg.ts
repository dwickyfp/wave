import { SubAgent, SubAgentRepository } from "app-types/subagent";
import { pgDb as db } from "../db.pg";
import { SubAgentTable } from "../schema.pg";
import { and, asc, eq } from "drizzle-orm";
import { generateUUID } from "lib/utils";

export const pgSubAgentRepository: SubAgentRepository = {
  async insertSubAgent(agentId, data) {
    const [result] = await db
      .insert(SubAgentTable)
      .values({
        id: generateUUID(),
        agentId,
        name: data.name,
        description: data.description,
        instructions: data.instructions,
        tools: data.tools ?? [],
        enabled: data.enabled ?? true,
        sortOrder: data.sortOrder ?? 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return mapSubAgent(result);
  },

  async selectSubAgentsByAgentId(agentId) {
    const results = await db
      .select()
      .from(SubAgentTable)
      .where(eq(SubAgentTable.agentId, agentId))
      .orderBy(asc(SubAgentTable.sortOrder), asc(SubAgentTable.createdAt));

    return results.map(mapSubAgent);
  },

  async selectSubAgentById(id) {
    const [result] = await db
      .select()
      .from(SubAgentTable)
      .where(eq(SubAgentTable.id, id));

    if (!result) return null;
    return mapSubAgent(result);
  },

  async updateSubAgent(id, agentId, data) {
    const [result] = await db
      .update(SubAgentTable)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(and(eq(SubAgentTable.id, id), eq(SubAgentTable.agentId, agentId)))
      .returning();

    return mapSubAgent(result);
  },

  async deleteSubAgent(id, agentId) {
    await db
      .delete(SubAgentTable)
      .where(and(eq(SubAgentTable.id, id), eq(SubAgentTable.agentId, agentId)));
  },

  async deleteSubAgentsByAgentId(agentId) {
    await db.delete(SubAgentTable).where(eq(SubAgentTable.agentId, agentId));
  },

  async syncSubAgents(agentId, subAgents) {
    if (!subAgents || subAgents.length === 0) {
      await db.delete(SubAgentTable).where(eq(SubAgentTable.agentId, agentId));
      return [];
    }

    // We'll do a full replace: delete all then re-insert in order
    // This keeps sortOrder consistent with the UI's order
    await db.delete(SubAgentTable).where(eq(SubAgentTable.agentId, agentId));

    if (subAgents.length === 0) return [];

    const toInsert = subAgents.map((sa, index) => ({
      id: generateUUID(),
      agentId,
      name: sa.name,
      description: sa.description,
      instructions: sa.instructions,
      tools: sa.tools ?? [],
      enabled: sa.enabled ?? true,
      sortOrder: index,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const results = await db.insert(SubAgentTable).values(toInsert).returning();

    return results.map(mapSubAgent);
  },
};

function mapSubAgent(result: typeof SubAgentTable.$inferSelect): SubAgent {
  return {
    ...result,
    description: result.description ?? undefined,
    instructions: result.instructions ?? undefined,
    tools: result.tools ?? [],
  };
}
