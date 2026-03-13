import { z } from "zod";

export const TeamRoleSchema = z.enum(["owner", "admin", "member"]);
export type TeamRole = z.infer<typeof TeamRoleSchema>;

export const TeamResourceTypeSchema = z.enum(["agent", "mcp", "skill"]);
export type TeamResourceType = z.infer<typeof TeamResourceTypeSchema>;

export const TeamAccessSourceSchema = z.enum(["owner", "team", "public"]);
export type TeamAccessSource = z.infer<typeof TeamAccessSourceSchema>;

export const TeamSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
});

export const UpdateTeamSchema = TeamSchema.partial();

export const TeamMemberInviteSchema = z.object({
  email: z.string().email(),
  role: TeamRoleSchema.exclude(["owner"]).default("member"),
});

export const TeamMemberUpdateSchema = z.object({
  role: TeamRoleSchema.exclude(["owner"]),
});

export const TeamResourceShareSchema = z.object({
  resourceType: TeamResourceTypeSchema,
  resourceId: z.string().uuid(),
});

export type SharedTeamSummary = {
  id: string;
  name: string;
};

export type TeamSummary = {
  id: string;
  name: string;
  description?: string;
  role: TeamRole;
  ownerUserId: string;
  memberCount: number;
  resourceCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type TeamMember = {
  teamId: string;
  userId: string;
  role: TeamRole;
  name: string;
  email: string;
  image?: string | null;
  addedByUserId?: string | null;
  createdAt: Date;
};

export type TeamResourceShare = {
  id: string;
  teamId: string;
  resourceType: TeamResourceType;
  resourceId: string;
  sharedByUserId: string;
  createdAt: Date;
  teamName?: string;
  resourceName?: string;
  resourceVisibility?: "private" | "public" | "readonly";
  resourceOwnerId?: string;
};

export type TeamDetail = TeamSummary & {
  members: TeamMember[];
  resources: TeamResourceShare[];
};

export type TeamRepository = {
  createTeam(input: {
    name: string;
    description?: string;
    ownerUserId: string;
  }): Promise<TeamSummary>;
  listTeamsForUser(userId: string): Promise<TeamSummary[]>;
  getTeamById(teamId: string, userId: string): Promise<TeamDetail | null>;
  getTeamSummaryById(
    teamId: string,
    userId: string,
  ): Promise<TeamSummary | null>;
  updateTeam(
    teamId: string,
    input: {
      name?: string;
      description?: string;
    },
  ): Promise<TeamSummary>;
  deleteTeam(teamId: string): Promise<void>;
  getTeamMembers(teamId: string): Promise<TeamMember[]>;
  getTeamMember(teamId: string, userId: string): Promise<TeamMember | null>;
  addTeamMember(input: {
    teamId: string;
    userId: string;
    role: Exclude<TeamRole, "owner">;
    addedByUserId: string;
  }): Promise<TeamMember>;
  updateTeamMemberRole(
    teamId: string,
    userId: string,
    role: Exclude<TeamRole, "owner">,
  ): Promise<TeamMember>;
  removeTeamMember(teamId: string, userId: string): Promise<void>;
  listTeamShares(teamId: string): Promise<TeamResourceShare[]>;
  addResourceShare(input: {
    teamId: string;
    resourceType: TeamResourceType;
    resourceId: string;
    sharedByUserId: string;
  }): Promise<TeamResourceShare>;
  removeResourceShare(
    teamId: string,
    resourceType: TeamResourceType,
    resourceId: string,
  ): Promise<void>;
  listSharedTeamsForResource(input: {
    resourceType: TeamResourceType;
    resourceId: string;
  }): Promise<SharedTeamSummary[]>;
  listReadableTeamIdsForUser(userId: string): Promise<string[]>;
  listManageableTeamIdsForUser(userId: string): Promise<string[]>;
  isResourceSharedWithUserTeam(input: {
    userId: string;
    resourceType: TeamResourceType;
    resourceId: string;
  }): Promise<boolean>;
};
