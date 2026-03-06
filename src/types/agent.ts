import z from "zod";
import { ChatMentionSchema } from "./chat";
import { VisibilitySchema } from "./util";
import type { SubAgent } from "./subagent";
import type { KnowledgeSummary } from "./knowledge";
import type { SkillSummary } from "./skill";

export type AgentIcon = {
  type: "emoji";
  value: string;
  style?: Record<string, string>;
};

export const AgentInstructionsSchema = z.object({
  role: z.string().optional(),
  systemPrompt: z.string().optional(),
  mentions: z.array(ChatMentionSchema).optional(),
});

export const AgentCreateSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().max(8000).optional(),
    icon: z
      .object({
        type: z.literal("emoji"),
        value: z.string(),
        style: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
    userId: z.string(),
    instructions: AgentInstructionsSchema,
    visibility: VisibilitySchema.optional().default("private"),
    subAgentsEnabled: z.boolean().optional().default(false),
    agentType: z
      .enum(["standard", "snowflake_cortex"])
      .optional()
      .default("standard"),
  })
  .strip();
export const AgentUpdateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(8000).optional(),
    icon: z
      .object({
        type: z.literal("emoji"),
        value: z.string(),
        style: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
    instructions: AgentInstructionsSchema.optional(),
    visibility: VisibilitySchema.optional(),
    subAgentsEnabled: z.boolean().optional(),
  })
  .strip();

export const AgentQuerySchema = z.object({
  type: z.enum(["all", "mine", "shared", "bookmarked"]).default("all"),
  filters: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});

export type AgentVisibility = z.infer<typeof VisibilitySchema>;

export type AgentSummary = {
  id: string;
  name: string;
  description?: string;
  icon?: AgentIcon;
  userId: string;
  visibility: AgentVisibility;
  createdAt: Date;
  updatedAt: Date;
  userName?: string;
  userAvatar?: string;
  isBookmarked?: boolean;
  subAgentsEnabled?: boolean;
  agentType?: "standard" | "snowflake_cortex";
};

export type Agent = AgentSummary & {
  instructions: z.infer<typeof AgentInstructionsSchema>;
  subAgents?: SubAgent[];
  knowledgeGroups?: KnowledgeSummary[];
  skills?: SkillSummary[];
};

export type AgentRepository = {
  insertAgent(agent: z.infer<typeof AgentCreateSchema>): Promise<Agent>;

  selectAgentById(id: string, userId: string): Promise<Agent | null>;

  selectAgentsByUserId(userId: string): Promise<Agent[]>;

  updateAgent(
    id: string,
    userId: string,
    agent: z.infer<typeof AgentUpdateSchema>,
  ): Promise<Agent>;

  deleteAgent(id: string, userId: string): Promise<void>;

  selectAgents(
    currentUserId: string,
    filters?: ("all" | "mine" | "shared" | "bookmarked")[],
    limit?: number,
  ): Promise<AgentSummary[]>;

  checkAccess(
    agentId: string,
    userId: string,
    destructive?: boolean,
  ): Promise<boolean>;
};

export const AgentGenerateSubAgentSchema = z.object({
  name: z.string().describe("Subagent name"),
  description: z.string().describe("What this subagent specializes in"),
  instructions: z.string().describe("Subagent system instructions"),
  tools: z
    .array(z.string())
    .describe("Required tool names for this subagent")
    .optional()
    .default([]),
});

export const AgentGenerateSchema = z.object({
  name: z.string().describe("Agent name"),
  description: z.string().describe("Agent description"),
  instructions: z.string().describe("Agent instructions"),
  role: z.string().describe("Agent role"),
  tools: z
    .array(z.string())
    .describe("Agent allowed tools name")
    .optional()
    .default([]),
  subAgentsEnabled: z.boolean().optional().default(false),
  subAgents: z
    .array(AgentGenerateSubAgentSchema)
    .describe("Generated subagents for this orchestrator agent")
    .optional()
    .default([]),
});
