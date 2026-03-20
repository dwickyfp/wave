import {
  CreateSkillInput,
  Skill,
  SkillRepository,
  SkillSummary,
  UpdateSkillInput,
} from "app-types/skill";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { generateUUID } from "lib/utils";
import { pgDb as db } from "../db.pg";
import { SkillAgentTable, SkillTable, UserTable } from "../schema.pg";
import { buildTeamShareExists } from "./team-resource-access.pg";
import { attachSharedTeamsToResources } from "./team-resource-metadata.pg";

function mapSkill(row: typeof SkillTable.$inferSelect): Skill {
  return {
    ...row,
    description: row.description ?? undefined,
  };
}

export const pgSkillRepository: SkillRepository = {
  async insertSkill(data: CreateSkillInput & { userId: string }) {
    const [row] = await db
      .insert(SkillTable)
      .values({
        id: generateUUID(),
        title: data.title,
        description: data.description,
        instructions: data.instructions,
        userId: data.userId,
        visibility: data.visibility ?? "private",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return mapSkill(row);
  },

  async selectSkillById(id: string, userId: string) {
    const [row] = await db
      .select()
      .from(SkillTable)
      .where(
        and(
          eq(SkillTable.id, id),
          or(
            eq(SkillTable.userId, userId),
            eq(SkillTable.visibility, "public"),
            eq(SkillTable.visibility, "readonly"),
            buildTeamShareExists("skill", SkillTable.id, userId),
          ),
        ),
      );
    if (!row) return null;

    const [skill] = await attachSharedTeamsToResources(
      [mapSkill(row)],
      "skill",
      userId,
    );

    return skill;
  },

  async selectSkills(userId: string, filters = ["mine", "shared"]) {
    let whereCondition: any;
    const teamSharedAccess = buildTeamShareExists(
      "skill",
      SkillTable.id,
      userId,
    );

    if (filters.includes("mine") && filters.includes("shared")) {
      whereCondition = or(
        eq(SkillTable.userId, userId),
        and(
          ne(SkillTable.userId, userId),
          or(
            eq(SkillTable.visibility, "public"),
            eq(SkillTable.visibility, "readonly"),
            teamSharedAccess,
          ),
        ),
      );
    } else if (filters.includes("mine")) {
      whereCondition = eq(SkillTable.userId, userId);
    } else {
      whereCondition = and(
        ne(SkillTable.userId, userId),
        or(
          eq(SkillTable.visibility, "public"),
          eq(SkillTable.visibility, "readonly"),
          teamSharedAccess,
        ),
      );
    }

    const rows = await db
      .select({
        id: SkillTable.id,
        title: SkillTable.title,
        description: SkillTable.description,
        instructions: SkillTable.instructions,
        userId: SkillTable.userId,
        visibility: SkillTable.visibility,
        createdAt: SkillTable.createdAt,
        updatedAt: SkillTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
      })
      .from(SkillTable)
      .innerJoin(UserTable, eq(SkillTable.userId, UserTable.id))
      .where(whereCondition)
      .orderBy(
        sql`CASE WHEN ${SkillTable.userId} = ${userId} THEN 0 ELSE 1 END`,
        desc(SkillTable.createdAt),
      );

    return (await attachSharedTeamsToResources(
      rows.map((row) => ({
        ...row,
        description: row.description ?? undefined,
        userName: row.userName ?? undefined,
        userAvatar: row.userAvatar ?? null,
      })),
      "skill",
      userId,
    )) as SkillSummary[];
  },

  async updateSkill(id: string, userId: string, data: UpdateSkillInput) {
    const [row] = await db
      .update(SkillTable)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(and(eq(SkillTable.id, id), eq(SkillTable.userId, userId)))
      .returning();

    return mapSkill(row);
  },

  async deleteSkill(id: string, userId: string) {
    await db
      .delete(SkillTable)
      .where(and(eq(SkillTable.id, id), eq(SkillTable.userId, userId)));
  },

  async linkAgentToSkill(agentId: string, skillId: string) {
    await db
      .insert(SkillAgentTable)
      .values({
        id: generateUUID(),
        agentId,
        skillId,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  },

  async unlinkAgentFromSkill(agentId: string, skillId: string) {
    await db
      .delete(SkillAgentTable)
      .where(
        and(
          eq(SkillAgentTable.agentId, agentId),
          eq(SkillAgentTable.skillId, skillId),
        ),
      );
  },

  async getSkillsByAgentId(agentId: string) {
    const rows = await db
      .select({
        id: SkillTable.id,
        title: SkillTable.title,
        description: SkillTable.description,
        instructions: SkillTable.instructions,
        userId: SkillTable.userId,
        visibility: SkillTable.visibility,
        createdAt: SkillTable.createdAt,
        updatedAt: SkillTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
      })
      .from(SkillAgentTable)
      .innerJoin(SkillTable, eq(SkillAgentTable.skillId, SkillTable.id))
      .innerJoin(UserTable, eq(SkillTable.userId, UserTable.id))
      .where(eq(SkillAgentTable.agentId, agentId));

    return rows.map((row) => ({
      ...row,
      description: row.description ?? undefined,
      userName: row.userName ?? undefined,
      userAvatar: row.userAvatar ?? null,
    })) as SkillSummary[];
  },

  async getAgentsBySkillId(skillId: string) {
    const rows = await db
      .select({ agentId: SkillAgentTable.agentId })
      .from(SkillAgentTable)
      .where(eq(SkillAgentTable.skillId, skillId));
    return rows.map((row) => row.agentId);
  },
};
