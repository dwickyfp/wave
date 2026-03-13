import "server-only";

import { TeamResourceType } from "app-types/team";
import { pgDb } from "lib/db/pg/db.pg";
import { AgentTable, McpServerTable, SkillTable } from "lib/db/pg/schema.pg";
import { eq } from "drizzle-orm";

export type TeamResourceRecord = {
  id: string;
  name: string;
  userId: string;
  visibility: "private" | "public" | "readonly";
};

export async function getTeamResourceRecord(
  resourceType: TeamResourceType,
  resourceId: string,
): Promise<TeamResourceRecord | null> {
  if (resourceType === "agent") {
    const [row] = await pgDb
      .select({
        id: AgentTable.id,
        name: AgentTable.name,
        userId: AgentTable.userId,
        visibility: AgentTable.visibility,
      })
      .from(AgentTable)
      .where(eq(AgentTable.id, resourceId));

    return row ?? null;
  }

  if (resourceType === "mcp") {
    const [row] = await pgDb
      .select({
        id: McpServerTable.id,
        name: McpServerTable.name,
        userId: McpServerTable.userId,
        visibility: McpServerTable.visibility,
      })
      .from(McpServerTable)
      .where(eq(McpServerTable.id, resourceId));

    return row
      ? {
          ...row,
          visibility: row.visibility === "public" ? "public" : "private",
        }
      : null;
  }

  const [row] = await pgDb
    .select({
      id: SkillTable.id,
      name: SkillTable.title,
      userId: SkillTable.userId,
      visibility: SkillTable.visibility,
    })
    .from(SkillTable)
    .where(eq(SkillTable.id, resourceId));

  return row ?? null;
}
