import type {
  SnowflakeAgentConfig,
  SnowflakeAgentRepository,
} from "app-types/snowflake-agent";
import { pgDb as db } from "../db.pg";
import { SnowflakeAgentConfigTable } from "../schema.pg";
import { eq } from "drizzle-orm";
import { generateUUID } from "lib/utils";

type DbSnowflakeRow = typeof SnowflakeAgentConfigTable.$inferSelect;

function toConfig(row: DbSnowflakeRow): SnowflakeAgentConfig {
  return {
    ...row,
    privateKeyPassphrase: row.privateKeyPassphrase ?? undefined,
    snowflakeRole: row.snowflakeRole ?? undefined,
  };
}

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
        privateKeyPassphrase: config.privateKeyPassphrase ?? null,
        database: config.database,
        schema: config.schema,
        cortexAgentName: config.cortexAgentName,
        snowflakeRole: config.snowflakeRole ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return toConfig(result);
  },

  async selectSnowflakeConfigByAgentId(
    agentId,
  ): Promise<SnowflakeAgentConfig | null> {
    const [result] = await db
      .select()
      .from(SnowflakeAgentConfigTable)
      .where(eq(SnowflakeAgentConfigTable.agentId, agentId));

    return result ? toConfig(result) : null;
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

    return toConfig(result);
  },

  async deleteSnowflakeConfig(agentId): Promise<void> {
    await db
      .delete(SnowflakeAgentConfigTable)
      .where(eq(SnowflakeAgentConfigTable.agentId, agentId));
  },
};
