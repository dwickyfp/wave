import { z } from "zod";
import { VisibilitySchema } from "./util";

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
}

export type SkillSummary = Skill;

export const createSkillSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  instructions: z.string().min(1).max(50000),
  visibility: VisibilitySchema.default("private"),
});

export const updateSkillSchema = createSkillSchema.partial();

export type CreateSkillInput = z.infer<typeof createSkillSchema>;
export type UpdateSkillInput = z.infer<typeof updateSkillSchema>;

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
