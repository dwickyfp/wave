import type {
  SnowflakeAgentConfig,
  SnowflakeAgentRepository,
} from "app-types/snowflake-agent";
import { pgDb as db } from "../db.pg";
import { SnowflakeAgentConfigTable } from "../schema.pg";
import { eq } from "drizzle-orm";
import { generateUUID } from "lib/utils";

export const pgSnowflakeAgentRepository: SnowflakeAgentRepository = {
  async insertSnowflakeConfig(agentId, config): Promise<SnowflakeAgentConfig> {
    const [result] = await db
      .insert(SnowflakeAgentConfigTable)
      .values({
        id: generateUUID(),
        agentId,
        accountLocator: config.accountLocator,
        account: config.account,
        snowflakeUser: config.snowflakeUser,
        privateKeyPem: config.privateKeyPem,
        database: config.database,
        schema: config.schema,
        cortexAgentName: config.cortexAgentName,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return result;
  },

  async selectSnowflakeConfigByAgentId(
    agentId,
  ): Promise<SnowflakeAgentConfig | null> {
    const [result] = await db
      .select()
      .from(SnowflakeAgentConfigTable)
      .where(eq(SnowflakeAgentConfigTable.agentId, agentId));

    return result ?? null;
  },

  async updateSnowflakeConfig(agentId, config): Promise<SnowflakeAgentConfig> {
    const [result] = await db
      .update(SnowflakeAgentConfigTable)
      .set({
        ...config,
        updatedAt: new Date(),
      })
      .where(eq(SnowflakeAgentConfigTable.agentId, agentId))
      .returning();

    return result;
  },

  async deleteSnowflakeConfig(agentId): Promise<void> {
    await db
      .delete(SnowflakeAgentConfigTable)
      .where(eq(SnowflakeAgentConfigTable.agentId, agentId));
  },
};
