import { z } from "zod";
import { VisibilitySchema } from "./util";
import type { SharedTeamSummary, TeamAccessSource } from "./team";

export type SkillVisibility = z.infer<typeof VisibilitySchema>;

export interface Skill {
  id: string;
  title: string;
  description?: string;
  instructions: string;
  userId: string;
  visibility: SkillVisibility;
  createdAt: Date;
  updatedAt: Date;
  userName?: string;
  userAvatar?: string | null;
  accessSource?: TeamAccessSource;
  sharedTeams?: SharedTeamSummary[];
}

export type SkillSummary = Skill;

export interface SkillGroup {
  id: string;
  name: string;
  description?: string;
  userId: string;
  visibility: SkillVisibility;
  createdAt: Date;
  updatedAt: Date;
  userName?: string;
  userAvatar?: string | null;
}

export interface SkillGroupSummary extends SkillGroup {
  skillCount: number;
}

export type AgentSkillAttachment =
  | ({ kind: "skill" } & SkillSummary)
  | ({ kind: "group" } & SkillGroupSummary);

export const createSkillSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  instructions: z.string().min(1).max(50000),
  visibility: VisibilitySchema.default("private"),
});

export const updateSkillSchema = createSkillSchema.partial();

export const createSkillGroupSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  visibility: VisibilitySchema.default("private"),
});

export const updateSkillGroupSchema = createSkillGroupSchema.partial();

export const skillGroupMemberSchema = z.object({
  skillId: z.string().min(1),
});

export type CreateSkillInput = z.infer<typeof createSkillSchema>;
export type UpdateSkillInput = z.infer<typeof updateSkillSchema>;
export type CreateSkillGroupInput = z.infer<typeof createSkillGroupSchema>;
export type UpdateSkillGroupInput = z.infer<typeof updateSkillGroupSchema>;
export type SkillGroupMemberInput = z.infer<typeof skillGroupMemberSchema>;

export const SkillGenerateSchema = z.object({
  title: z.string().describe("Skill title"),
  description: z.string().describe("Short summary of what the skill does"),
  instructions: z
    .string()
    .describe("Detailed SKILL.md-style markdown instructions"),
});

export interface SkillRepository {
  insertSkill(data: CreateSkillInput & { userId: string }): Promise<Skill>;
  selectSkillById(id: string, userId: string): Promise<Skill | null>;
  selectSkills(
    userId: string,
    filters?: ("mine" | "shared")[],
  ): Promise<SkillSummary[]>;
  updateSkill(
    id: string,
    userId: string,
    data: UpdateSkillInput,
  ): Promise<Skill>;
  deleteSkill(id: string, userId: string): Promise<void>;

  linkAgentToSkill(agentId: string, skillId: string): Promise<void>;
  unlinkAgentFromSkill(agentId: string, skillId: string): Promise<void>;
  getSkillsByAgentId(agentId: string): Promise<SkillSummary[]>;
  getAgentsBySkillId(skillId: string): Promise<string[]>;
}

export interface SkillGroupRepository {
  insertGroup(
    data: CreateSkillGroupInput & { userId: string },
  ): Promise<SkillGroup>;
  selectGroupById(id: string, userId: string): Promise<SkillGroup | null>;
  selectGroups(
    userId: string,
    filters?: ("mine" | "shared")[],
  ): Promise<SkillGroupSummary[]>;
  updateGroup(
    id: string,
    userId: string,
    data: UpdateSkillGroupInput,
  ): Promise<SkillGroup>;
  deleteGroup(id: string, userId: string): Promise<void>;

  addSkillToGroup(groupId: string, skillId: string): Promise<void>;
  removeSkillFromGroup(groupId: string, skillId: string): Promise<void>;
  getSkillsByGroupId(groupId: string): Promise<SkillSummary[]>;
  getSharedGroupsBySkillId(skillId: string): Promise<SkillGroupSummary[]>;

  linkAgentToGroup(agentId: string, groupId: string): Promise<void>;
  unlinkAgentFromGroup(agentId: string, groupId: string): Promise<void>;
  getGroupsByAgentId(agentId: string): Promise<SkillGroupSummary[]>;
  getSkillsByAgentGroupId(agentId: string): Promise<SkillSummary[]>;
}
