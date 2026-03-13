import {
  SharedTeamSummary,
  TeamDetail,
  TeamMember,
  TeamRepository,
  TeamResourceShare,
  TeamRole,
  TeamSummary,
} from "app-types/team";
import { and, count, eq, inArray, or, sql } from "drizzle-orm";
import { generateUUID } from "lib/utils";
import { pgDb as db } from "../db.pg";
import {
  AgentTable,
  McpServerTable,
  SkillTable,
  TeamMemberTable,
  TeamResourceShareTable,
  TeamTable,
  UserTable,
} from "../schema.pg";

function mapTeamSummary(row: any): TeamSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    role: row.role,
    ownerUserId: row.ownerUserId,
    memberCount: Number(row.memberCount ?? 0),
    resourceCount: Number(row.resourceCount ?? 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapTeamMember(row: any): TeamMember {
  return {
    teamId: row.teamId,
    userId: row.userId,
    role: row.role,
    name: row.name,
    email: row.email,
    image: row.image ?? null,
    addedByUserId: row.addedByUserId ?? null,
    createdAt: row.createdAt,
  };
}

async function selectTeamSummary(teamId: string, userId: string) {
  const [row] = await db
    .select({
      id: TeamTable.id,
      name: TeamTable.name,
      description: TeamTable.description,
      ownerUserId: TeamTable.ownerUserId,
      role: TeamMemberTable.role,
      createdAt: TeamTable.createdAt,
      updatedAt: TeamTable.updatedAt,
      memberCount: sql<number>`(
        select count(*)::int from ${TeamMemberTable} tm
        where tm.team_id = ${TeamTable.id}
      )`,
      resourceCount: sql<number>`(
        select count(*)::int from ${TeamResourceShareTable} trs
        where trs.team_id = ${TeamTable.id}
      )`,
    })
    .from(TeamTable)
    .innerJoin(
      TeamMemberTable,
      and(
        eq(TeamMemberTable.teamId, TeamTable.id),
        eq(TeamMemberTable.userId, userId),
      ),
    )
    .where(eq(TeamTable.id, teamId));

  return row ? mapTeamSummary(row) : null;
}

async function hydrateResourceMetadata(shares: TeamResourceShare[]) {
  const agentIds = shares
    .filter((share) => share.resourceType === "agent")
    .map((share) => share.resourceId);
  const mcpIds = shares
    .filter((share) => share.resourceType === "mcp")
    .map((share) => share.resourceId);
  const skillIds = shares
    .filter((share) => share.resourceType === "skill")
    .map((share) => share.resourceId);

  const [agents, mcps, skills] = await Promise.all([
    agentIds.length
      ? db
          .select({
            id: AgentTable.id,
            name: AgentTable.name,
            visibility: AgentTable.visibility,
            userId: AgentTable.userId,
          })
          .from(AgentTable)
          .where(inArray(AgentTable.id, agentIds))
      : Promise.resolve([]),
    mcpIds.length
      ? db
          .select({
            id: McpServerTable.id,
            name: McpServerTable.name,
            visibility: McpServerTable.visibility,
            userId: McpServerTable.userId,
          })
          .from(McpServerTable)
          .where(inArray(McpServerTable.id, mcpIds))
      : Promise.resolve([]),
    skillIds.length
      ? db
          .select({
            id: SkillTable.id,
            name: SkillTable.title,
            visibility: SkillTable.visibility,
            userId: SkillTable.userId,
          })
          .from(SkillTable)
          .where(inArray(SkillTable.id, skillIds))
      : Promise.resolve([]),
  ]);

  const resourceMap = new Map<
    string,
    { name: string; visibility: any; userId: string }
  >();

  for (const resource of [...agents, ...mcps, ...skills]) {
    resourceMap.set(resource.id, resource);
  }

  return shares.map((share) => {
    const resource = resourceMap.get(share.resourceId);
    return {
      ...share,
      resourceName: resource?.name,
      resourceVisibility: resource?.visibility,
      resourceOwnerId: resource?.userId,
    };
  });
}

export const pgTeamRepository: TeamRepository = {
  async createTeam(input) {
    const teamId = generateUUID();
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx.insert(TeamTable).values({
        id: teamId,
        name: input.name,
        description: input.description,
        ownerUserId: input.ownerUserId,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(TeamMemberTable).values({
        id: generateUUID(),
        teamId,
        userId: input.ownerUserId,
        role: "owner",
        addedByUserId: input.ownerUserId,
        createdAt: now,
      });
    });

    return {
      id: teamId,
      name: input.name,
      description: input.description,
      role: "owner",
      ownerUserId: input.ownerUserId,
      memberCount: 1,
      resourceCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  },

  async listTeamsForUser(userId) {
    const rows = await db
      .select({
        id: TeamTable.id,
        name: TeamTable.name,
        description: TeamTable.description,
        ownerUserId: TeamTable.ownerUserId,
        role: TeamMemberTable.role,
        createdAt: TeamTable.createdAt,
        updatedAt: TeamTable.updatedAt,
        memberCount: sql<number>`(
          select count(*)::int from ${TeamMemberTable} tm
          where tm.team_id = ${TeamTable.id}
        )`,
        resourceCount: sql<number>`(
          select count(*)::int from ${TeamResourceShareTable} trs
          where trs.team_id = ${TeamTable.id}
        )`,
      })
      .from(TeamTable)
      .innerJoin(
        TeamMemberTable,
        and(
          eq(TeamMemberTable.teamId, TeamTable.id),
          eq(TeamMemberTable.userId, userId),
        ),
      )
      .orderBy(TeamTable.name);

    return rows.map(mapTeamSummary);
  },

  async getTeamById(teamId, userId) {
    const summary = await selectTeamSummary(teamId, userId);
    if (!summary) return null;

    const [members, resources] = await Promise.all([
      this.getTeamMembers(teamId),
      this.listTeamShares(teamId),
    ]);

    return {
      ...summary,
      members,
      resources,
    } satisfies TeamDetail;
  },

  async getTeamSummaryById(teamId, userId) {
    return await selectTeamSummary(teamId, userId);
  },

  async updateTeam(teamId, input) {
    const [row] = await db
      .update(TeamTable)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(TeamTable.id, teamId))
      .returning();

    const [memberCountRow, resourceCountRow] = await Promise.all([
      db
        .select({ value: count() })
        .from(TeamMemberTable)
        .where(eq(TeamMemberTable.teamId, teamId)),
      db
        .select({ value: count() })
        .from(TeamResourceShareTable)
        .where(eq(TeamResourceShareTable.teamId, teamId)),
    ]);

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      role: "owner",
      ownerUserId: row.ownerUserId,
      memberCount: memberCountRow[0]?.value ?? 0,
      resourceCount: resourceCountRow[0]?.value ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },

  async deleteTeam(teamId) {
    await db.delete(TeamTable).where(eq(TeamTable.id, teamId));
  },

  async getTeamMembers(teamId) {
    const rows = await db
      .select({
        teamId: TeamMemberTable.teamId,
        userId: TeamMemberTable.userId,
        role: TeamMemberTable.role,
        addedByUserId: TeamMemberTable.addedByUserId,
        createdAt: TeamMemberTable.createdAt,
        name: UserTable.name,
        email: UserTable.email,
        image: UserTable.image,
      })
      .from(TeamMemberTable)
      .innerJoin(UserTable, eq(UserTable.id, TeamMemberTable.userId))
      .where(eq(TeamMemberTable.teamId, teamId))
      .orderBy(TeamMemberTable.createdAt);

    return rows.map(mapTeamMember);
  },

  async getTeamMember(teamId, userId) {
    const [row] = await db
      .select({
        teamId: TeamMemberTable.teamId,
        userId: TeamMemberTable.userId,
        role: TeamMemberTable.role,
        addedByUserId: TeamMemberTable.addedByUserId,
        createdAt: TeamMemberTable.createdAt,
        name: UserTable.name,
        email: UserTable.email,
        image: UserTable.image,
      })
      .from(TeamMemberTable)
      .innerJoin(UserTable, eq(UserTable.id, TeamMemberTable.userId))
      .where(
        and(
          eq(TeamMemberTable.teamId, teamId),
          eq(TeamMemberTable.userId, userId),
        ),
      );

    return row ? mapTeamMember(row) : null;
  },

  async addTeamMember(input) {
    await db.insert(TeamMemberTable).values({
      id: generateUUID(),
      teamId: input.teamId,
      userId: input.userId,
      role: input.role,
      addedByUserId: input.addedByUserId,
      createdAt: new Date(),
    });

    const member = await this.getTeamMember(input.teamId, input.userId);
    if (!member) {
      throw new Error("Failed to add team member");
    }
    return member;
  },

  async updateTeamMemberRole(teamId, userId, role) {
    await db
      .update(TeamMemberTable)
      .set({ role })
      .where(
        and(
          eq(TeamMemberTable.teamId, teamId),
          eq(TeamMemberTable.userId, userId),
        ),
      );

    const member = await this.getTeamMember(teamId, userId);
    if (!member) {
      throw new Error("Failed to update team member");
    }
    return member;
  },

  async removeTeamMember(teamId, userId) {
    await db
      .delete(TeamMemberTable)
      .where(
        and(
          eq(TeamMemberTable.teamId, teamId),
          eq(TeamMemberTable.userId, userId),
        ),
      );
  },

  async listTeamShares(teamId) {
    const rows = await db
      .select({
        id: TeamResourceShareTable.id,
        teamId: TeamResourceShareTable.teamId,
        resourceType: TeamResourceShareTable.resourceType,
        resourceId: TeamResourceShareTable.resourceId,
        sharedByUserId: TeamResourceShareTable.sharedByUserId,
        createdAt: TeamResourceShareTable.createdAt,
        teamName: TeamTable.name,
      })
      .from(TeamResourceShareTable)
      .innerJoin(TeamTable, eq(TeamTable.id, TeamResourceShareTable.teamId))
      .where(eq(TeamResourceShareTable.teamId, teamId));

    return await hydrateResourceMetadata(
      rows.map((row) => ({
        id: row.id,
        teamId: row.teamId,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        sharedByUserId: row.sharedByUserId,
        createdAt: row.createdAt,
        teamName: row.teamName,
      })),
    );
  },

  async addResourceShare(input) {
    const [row] = await db
      .insert(TeamResourceShareTable)
      .values({
        id: generateUUID(),
        teamId: input.teamId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        sharedByUserId: input.sharedByUserId,
        createdAt: new Date(),
      })
      .returning();

    return {
      id: row.id,
      teamId: row.teamId,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      sharedByUserId: row.sharedByUserId,
      createdAt: row.createdAt,
    };
  },

  async removeResourceShare(teamId, resourceType, resourceId) {
    await db
      .delete(TeamResourceShareTable)
      .where(
        and(
          eq(TeamResourceShareTable.teamId, teamId),
          eq(TeamResourceShareTable.resourceType, resourceType),
          eq(TeamResourceShareTable.resourceId, resourceId),
        ),
      );
  },

  async listSharedTeamsForResource(input) {
    const rows = await db
      .select({
        id: TeamTable.id,
        name: TeamTable.name,
      })
      .from(TeamResourceShareTable)
      .innerJoin(TeamTable, eq(TeamTable.id, TeamResourceShareTable.teamId))
      .where(
        and(
          eq(TeamResourceShareTable.resourceType, input.resourceType),
          eq(TeamResourceShareTable.resourceId, input.resourceId),
        ),
      )
      .orderBy(TeamTable.name);

    return rows as SharedTeamSummary[];
  },

  async listReadableTeamIdsForUser(userId) {
    const rows = await db
      .select({ teamId: TeamMemberTable.teamId })
      .from(TeamMemberTable)
      .where(eq(TeamMemberTable.userId, userId));

    return rows.map((row) => row.teamId);
  },

  async listManageableTeamIdsForUser(userId) {
    const rows = await db
      .select({ teamId: TeamMemberTable.teamId })
      .from(TeamMemberTable)
      .where(
        and(
          eq(TeamMemberTable.userId, userId),
          or(
            eq(TeamMemberTable.role, "owner"),
            eq(TeamMemberTable.role, "admin"),
          ),
        ),
      );

    return rows.map((row) => row.teamId);
  },

  async isResourceSharedWithUserTeam(input) {
    const [row] = await db
      .select({ id: TeamResourceShareTable.id })
      .from(TeamResourceShareTable)
      .innerJoin(
        TeamMemberTable,
        and(
          eq(TeamMemberTable.teamId, TeamResourceShareTable.teamId),
          eq(TeamMemberTable.userId, input.userId),
        ),
      )
      .where(
        and(
          eq(TeamResourceShareTable.resourceType, input.resourceType),
          eq(TeamResourceShareTable.resourceId, input.resourceId),
        ),
      );

    return !!row;
  },
};
