import {
  CreateSkillGroupInput,
  SkillGroup,
  SkillGroupRepository,
  SkillGroupSummary,
  SkillSummary,
  UpdateSkillGroupInput,
} from "app-types/skill";
import { and, count, desc, eq, ne, or, sql } from "drizzle-orm";
import { generateUUID } from "lib/utils";
import { pgDb as db } from "../db.pg";
import {
  SkillGroupAgentTable,
  SkillGroupSkillTable,
  SkillGroupTable,
  SkillTable,
  UserTable,
} from "../schema.pg";

function mapGroup(row: typeof SkillGroupTable.$inferSelect): SkillGroup {
  return {
    ...row,
    description: row.description ?? undefined,
  };
}

export const pgSkillGroupRepository: SkillGroupRepository = {
  async insertGroup(data: CreateSkillGroupInput & { userId: string }) {
    const [row] = await db
      .insert(SkillGroupTable)
      .values({
        id: generateUUID(),
        name: data.name,
        description: data.description,
        userId: data.userId,
        visibility: data.visibility ?? "private",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return mapGroup(row);
  },

  async selectGroupById(id: string, userId: string) {
    const [row] = await db
      .select({
        id: SkillGroupTable.id,
        name: SkillGroupTable.name,
        description: SkillGroupTable.description,
        userId: SkillGroupTable.userId,
        visibility: SkillGroupTable.visibility,
        createdAt: SkillGroupTable.createdAt,
        updatedAt: SkillGroupTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
      })
      .from(SkillGroupTable)
      .innerJoin(UserTable, eq(SkillGroupTable.userId, UserTable.id))
      .where(
        and(
          eq(SkillGroupTable.id, id),
          or(
            eq(SkillGroupTable.userId, userId),
            eq(SkillGroupTable.visibility, "public"),
            eq(SkillGroupTable.visibility, "readonly"),
          ),
        ),
      );

    if (!row) return null;
    return {
      ...row,
      description: row.description ?? undefined,
      userName: row.userName ?? undefined,
      userAvatar: row.userAvatar ?? null,
    } as SkillGroup;
  },

  async selectGroups(userId: string, filters = ["mine", "shared"]) {
    let whereCondition: any;

    if (filters.includes("mine") && filters.includes("shared")) {
      whereCondition = or(
        eq(SkillGroupTable.userId, userId),
        and(
          ne(SkillGroupTable.userId, userId),
          or(
            eq(SkillGroupTable.visibility, "public"),
            eq(SkillGroupTable.visibility, "readonly"),
          ),
        ),
      );
    } else if (filters.includes("mine")) {
      whereCondition = eq(SkillGroupTable.userId, userId);
    } else {
      whereCondition = and(
        ne(SkillGroupTable.userId, userId),
        or(
          eq(SkillGroupTable.visibility, "public"),
          eq(SkillGroupTable.visibility, "readonly"),
        ),
      );
    }

    const skillCounts = db
      .select({
        groupId: SkillGroupSkillTable.groupId,
        skillCount: count(SkillGroupSkillTable.skillId).as("skill_count"),
      })
      .from(SkillGroupSkillTable)
      .groupBy(SkillGroupSkillTable.groupId)
      .as("skill_counts");

    const rows = await db
      .select({
        id: SkillGroupTable.id,
        name: SkillGroupTable.name,
        description: SkillGroupTable.description,
        userId: SkillGroupTable.userId,
        visibility: SkillGroupTable.visibility,
        createdAt: SkillGroupTable.createdAt,
        updatedAt: SkillGroupTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
        skillCount: sql<number>`COALESCE(${skillCounts.skillCount}, 0)`,
      })
      .from(SkillGroupTable)
      .innerJoin(UserTable, eq(SkillGroupTable.userId, UserTable.id))
      .leftJoin(skillCounts, eq(SkillGroupTable.id, skillCounts.groupId))
      .where(whereCondition)
      .orderBy(
        sql`CASE WHEN ${SkillGroupTable.userId} = ${userId} THEN 0 ELSE 1 END`,
        desc(SkillGroupTable.createdAt),
      );

    return rows.map((row) => ({
      ...row,
      description: row.description ?? undefined,
      userName: row.userName ?? undefined,
      userAvatar: row.userAvatar ?? null,
    })) as SkillGroupSummary[];
  },

  async updateGroup(id: string, userId: string, data: UpdateSkillGroupInput) {
    const [row] = await db
      .update(SkillGroupTable)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(
        and(eq(SkillGroupTable.id, id), eq(SkillGroupTable.userId, userId)),
      )
      .returning();

    return mapGroup(row);
  },

  async deleteGroup(id: string, userId: string) {
    await db
      .delete(SkillGroupTable)
      .where(
        and(eq(SkillGroupTable.id, id), eq(SkillGroupTable.userId, userId)),
      );
  },

  async addSkillToGroup(groupId: string, skillId: string) {
    await db
      .insert(SkillGroupSkillTable)
      .values({
        id: generateUUID(),
        groupId,
        skillId,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  },

  async removeSkillFromGroup(groupId: string, skillId: string) {
    await db
      .delete(SkillGroupSkillTable)
      .where(
        and(
          eq(SkillGroupSkillTable.groupId, groupId),
          eq(SkillGroupSkillTable.skillId, skillId),
        ),
      );
  },

  async getSkillsByGroupId(groupId: string) {
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
      .from(SkillGroupSkillTable)
      .innerJoin(SkillTable, eq(SkillGroupSkillTable.skillId, SkillTable.id))
      .innerJoin(UserTable, eq(SkillTable.userId, UserTable.id))
      .where(eq(SkillGroupSkillTable.groupId, groupId))
      .orderBy(
        desc(SkillGroupSkillTable.createdAt),
        desc(SkillTable.createdAt),
      );

    return rows.map((row) => ({
      ...row,
      description: row.description ?? undefined,
      userName: row.userName ?? undefined,
      userAvatar: row.userAvatar ?? null,
    })) as SkillSummary[];
  },

  async getSharedGroupsBySkillId(skillId: string) {
    const skillCounts = db
      .select({
        groupId: SkillGroupSkillTable.groupId,
        skillCount: count(SkillGroupSkillTable.skillId).as("skill_count"),
      })
      .from(SkillGroupSkillTable)
      .groupBy(SkillGroupSkillTable.groupId)
      .as("skill_counts");

    const rows = await db
      .select({
        id: SkillGroupTable.id,
        name: SkillGroupTable.name,
        description: SkillGroupTable.description,
        userId: SkillGroupTable.userId,
        visibility: SkillGroupTable.visibility,
        createdAt: SkillGroupTable.createdAt,
        updatedAt: SkillGroupTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
        skillCount: sql<number>`COALESCE(${skillCounts.skillCount}, 0)`,
      })
      .from(SkillGroupSkillTable)
      .innerJoin(
        SkillGroupTable,
        eq(SkillGroupSkillTable.groupId, SkillGroupTable.id),
      )
      .innerJoin(UserTable, eq(SkillGroupTable.userId, UserTable.id))
      .leftJoin(skillCounts, eq(SkillGroupTable.id, skillCounts.groupId))
      .where(
        and(
          eq(SkillGroupSkillTable.skillId, skillId),
          or(
            eq(SkillGroupTable.visibility, "public"),
            eq(SkillGroupTable.visibility, "readonly"),
          ),
        ),
      )
      .orderBy(desc(SkillGroupTable.createdAt));

    return rows.map((row) => ({
      ...row,
      description: row.description ?? undefined,
      userName: row.userName ?? undefined,
      userAvatar: row.userAvatar ?? null,
    })) as SkillGroupSummary[];
  },

  async linkAgentToGroup(agentId: string, groupId: string) {
    await db
      .insert(SkillGroupAgentTable)
      .values({
        id: generateUUID(),
        agentId,
        groupId,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  },

  async unlinkAgentFromGroup(agentId: string, groupId: string) {
    await db
      .delete(SkillGroupAgentTable)
      .where(
        and(
          eq(SkillGroupAgentTable.agentId, agentId),
          eq(SkillGroupAgentTable.groupId, groupId),
        ),
      );
  },

  async getGroupsByAgentId(agentId: string) {
    const skillCounts = db
      .select({
        groupId: SkillGroupSkillTable.groupId,
        skillCount: count(SkillGroupSkillTable.skillId).as("skill_count"),
      })
      .from(SkillGroupSkillTable)
      .groupBy(SkillGroupSkillTable.groupId)
      .as("skill_counts");

    const rows = await db
      .select({
        id: SkillGroupTable.id,
        name: SkillGroupTable.name,
        description: SkillGroupTable.description,
        userId: SkillGroupTable.userId,
        visibility: SkillGroupTable.visibility,
        createdAt: SkillGroupTable.createdAt,
        updatedAt: SkillGroupTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
        skillCount: sql<number>`COALESCE(${skillCounts.skillCount}, 0)`,
      })
      .from(SkillGroupAgentTable)
      .innerJoin(
        SkillGroupTable,
        eq(SkillGroupAgentTable.groupId, SkillGroupTable.id),
      )
      .innerJoin(UserTable, eq(SkillGroupTable.userId, UserTable.id))
      .leftJoin(skillCounts, eq(SkillGroupTable.id, skillCounts.groupId))
      .where(eq(SkillGroupAgentTable.agentId, agentId))
      .orderBy(desc(SkillGroupAgentTable.createdAt));

    return rows.map((row) => ({
      ...row,
      description: row.description ?? undefined,
      userName: row.userName ?? undefined,
      userAvatar: row.userAvatar ?? null,
    })) as SkillGroupSummary[];
  },

  async getSkillsByAgentGroupId(agentId: string) {
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
      .from(SkillGroupAgentTable)
      .innerJoin(
        SkillGroupSkillTable,
        eq(SkillGroupAgentTable.groupId, SkillGroupSkillTable.groupId),
      )
      .innerJoin(SkillTable, eq(SkillGroupSkillTable.skillId, SkillTable.id))
      .innerJoin(UserTable, eq(SkillTable.userId, UserTable.id))
      .where(eq(SkillGroupAgentTable.agentId, agentId))
      .orderBy(
        desc(SkillGroupAgentTable.createdAt),
        desc(SkillGroupSkillTable.createdAt),
      );

    return rows.map((row) => ({
      ...row,
      description: row.description ?? undefined,
      userName: row.userName ?? undefined,
      userAvatar: row.userAvatar ?? null,
    })) as SkillSummary[];
  },
};
