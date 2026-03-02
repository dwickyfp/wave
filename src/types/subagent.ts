import z from "zod";
import { ChatMentionSchema, ChatMention } from "./chat";

export const SubAgentCreateSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().max(2000).optional(),
    instructions: z.string().max(8000).optional(),
    tools: z.array(ChatMentionSchema).default([]),
    enabled: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
  })
  .strip();

export const SubAgentUpdateSchema = SubAgentCreateSchema.partial().strip();

export const SubAgentGenerateSchema = z.object({
  name: z.string().describe("Subagent name"),
  description: z.string().describe("Subagent description"),
  instructions: z.string().describe("Subagent system instructions"),
  tools: z
    .array(z.string())
    .describe("Required tool names")
    .optional()
    .default([]),
});

export type SubAgent = {
  id: string;
  agentId: string;
  name: string;
  description?: string;
  instructions?: string;
  tools: ChatMention[];
  enabled: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type SubAgentRepository = {
  insertSubAgent(
    agentId: string,
    data: z.infer<typeof SubAgentCreateSchema>,
  ): Promise<SubAgent>;

  selectSubAgentsByAgentId(agentId: string): Promise<SubAgent[]>;

  selectSubAgentById(id: string): Promise<SubAgent | null>;

  updateSubAgent(
    id: string,
    agentId: string,
    data: z.infer<typeof SubAgentUpdateSchema>,
  ): Promise<SubAgent>;

  deleteSubAgent(id: string, agentId: string): Promise<void>;

  deleteSubAgentsByAgentId(agentId: string): Promise<void>;

  syncSubAgents(
    agentId: string,
    subAgents: z.infer<typeof SubAgentCreateSchema>[],
  ): Promise<SubAgent[]>;
};
