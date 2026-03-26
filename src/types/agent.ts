import z from "zod";
import { ChatMentionSchema } from "./chat";
import { VisibilitySchema } from "./util";
import type { SubAgent } from "./subagent";
import type { KnowledgeSummary } from "./knowledge";
import type { SkillGroupSummary, SkillSummary } from "./skill";
import type { SharedTeamSummary, TeamAccessSource } from "./team";

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

export const AgentTypeSchema = z.enum([
  "standard",
  "snowflake_cortex",
  "a2a_remote",
]);

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
    chatPersonalizationEnabled: z.boolean().optional(),
    agentType: AgentTypeSchema.optional().default("standard"),
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
    chatPersonalizationEnabled: z.boolean().optional(),
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
  mcpEnabled?: boolean;
  mcpApiKeyHash?: string | null;
  mcpApiKeyPreview?: string | null;
  mcpModelProvider?: string | null;
  mcpModelName?: string | null;
  mcpCodingMode?: boolean;
  mcpAutocompleteModelProvider?: string | null;
  mcpAutocompleteModelName?: string | null;
  mcpPresentationMode?: "compatibility" | "copilot_native";
  a2aEnabled?: boolean;
  a2aRequireAuth?: boolean;
  a2aApiKeyHash?: string | null;
  a2aApiKeyPreview?: string | null;
  userName?: string;
  userAvatar?: string;
  isBookmarked?: boolean;
  accessSource?: TeamAccessSource;
  sharedTeams?: SharedTeamSummary[];
  subAgentsEnabled?: boolean;
  chatPersonalizationEnabled?: boolean;
  agentType?: z.infer<typeof AgentTypeSchema>;
};

export type Agent = AgentSummary & {
  instructions: z.infer<typeof AgentInstructionsSchema>;
  subAgents?: SubAgent[];
  knowledgeGroups?: KnowledgeSummary[];
  skills?: SkillSummary[];
  skillGroups?: SkillGroupSummary[];
};

export type AgentRepository = {
  insertAgent(agent: z.infer<typeof AgentCreateSchema>): Promise<Agent>;

  selectAgentById(id: string, userId: string): Promise<Agent | null>;
  selectAgentByIdForMcp(id: string): Promise<Agent | null>;

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

  setMcpApiKey(
    id: string,
    userId: string,
    keyHash: string | null,
    keyPreview: string | null,
  ): Promise<void>;

  setMcpEnabled(id: string, userId: string, enabled: boolean): Promise<void>;

  setChatPersonalizationEnabled(
    id: string,
    userId: string,
    enabled: boolean,
  ): Promise<void>;

  setMcpModel(
    id: string,
    userId: string,
    modelProvider: string | null,
    modelName: string | null,
  ): Promise<void>;

  setMcpCodingMode(id: string, userId: string, enabled: boolean): Promise<void>;

  setMcpAutocompleteModel(
    id: string,
    userId: string,
    modelProvider: string | null,
    modelName: string | null,
  ): Promise<void>;

  setMcpPresentationMode(
    id: string,
    userId: string,
    presentationMode: "compatibility" | "copilot_native",
  ): Promise<void>;

  setA2aApiKey(
    id: string,
    userId: string,
    keyHash: string | null,
    keyPreview: string | null,
  ): Promise<void>;

  setA2aEnabled(id: string, userId: string, enabled: boolean): Promise<void>;

  setA2aRequireAuth(
    id: string,
    userId: string,
    requireAuth: boolean,
  ): Promise<void>;

  getAgentByMcpKey(
    agentId: string,
  ): Promise<Pick<
    Agent,
    "id" | "userId" | "agentType" | "mcpApiKeyHash" | "mcpEnabled"
  > | null>;

  getAgentByA2aKey(
    agentId: string,
  ): Promise<Pick<
    Agent,
    | "id"
    | "userId"
    | "agentType"
    | "mcpApiKeyHash"
    | "a2aApiKeyHash"
    | "a2aEnabled"
    | "a2aRequireAuth"
  > | null>;
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

export const AgentInstructionEnhanceRequestSchema = z.object({
  changePrompt: z.string().min(1),
  currentInstructions: z.string().default(""),
  chatModel: z
    .object({
      provider: z.string(),
      model: z.string(),
    })
    .optional(),
  agentContext: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      role: z.string().optional(),
    })
    .optional(),
});

export const AgentInstructionEnhanceResponseSchema = z.object({
  instructions: z.string().describe("Enhanced system instructions"),
});
