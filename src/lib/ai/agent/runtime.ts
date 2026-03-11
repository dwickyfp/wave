import type { Tool, UIMessageStreamWriter } from "ai";
import type { Agent } from "app-types/agent";
import type { ChatMention, ChatModel } from "app-types/chat";
import type {
  AllowedMCPServer,
  McpServerCustomizationsPrompt,
} from "app-types/mcp";
import type { SkillSummary } from "app-types/skill";
import type { UserPreferences } from "app-types/user";
import type { User } from "better-auth";
import {
  buildAgentSkillsSystemPrompt,
  buildKnowledgeContextSystemPrompt,
  buildMcpServerCustomizationsSystemPrompt,
  buildParallelSubAgentSystemPrompt,
  buildToolCallUnsupportedModelSystemPrompt,
  buildUserSystemPrompt,
} from "lib/ai/prompts";
import { loadSubAgentTools } from "lib/ai/agent/subagent-loader";
import {
  createKnowledgeDocsTool,
  type KnowledgeDocsRetrievedPayload,
  knowledgeDocsToolName,
} from "lib/ai/tools/knowledge-tool";
import {
  createLoadSkillTool,
  LOAD_SKILL_TOOL_NAME,
} from "lib/ai/tools/skill-tool";
import type { ActiveAgentSkill } from "lib/ai/agent/skill-activation";
import { getAgentAttachedSkills } from "lib/ai/agent/attached-skills";
import { knowledgeRepository, subAgentRepository } from "lib/db/repository";
import {
  loadAppDefaultTools,
  loadMcpTools,
  loadWorkFlowTools,
  mergeSystemPrompt,
} from "@/app/api/chat/shared.chat";

export function createNoopDataStream() {
  return {
    write() {},
    merge() {},
  } as unknown as UIMessageStreamWriter;
}

function resolveWaveAgentCapabilityUserId(options: {
  agent?: Agent | null;
  userId: string;
  capabilityUserId?: string;
}) {
  return options.capabilityUserId ?? options.agent?.userId ?? options.userId;
}

export async function loadWaveAgentContinueCapabilities(options: {
  agent?: Agent | null;
  userId: string;
  capabilityUserId?: string;
  dataStream: UIMessageStreamWriter;
  abortSignal: AbortSignal;
  chatModel: ChatModel;
  source: "agent" | "mcp";
  isToolCallAllowed?: boolean;
  onKnowledgeDocsRetrieved?: (
    payload: KnowledgeDocsRetrievedPayload,
  ) => void | Promise<void>;
}) {
  const isToolCallAllowed = options.isToolCallAllowed ?? true;
  const agent = options.agent;

  const emptyResult = {
    subagentTools: {} as Record<string, Tool>,
    knowledgeTools: {} as Record<string, Tool>,
    skillTools: {} as Record<string, Tool>,
    subAgents: [] as Agent["subAgents"],
    knowledgeGroups: [] as Awaited<
      ReturnType<typeof knowledgeRepository.getGroupsByAgentId>
    >,
    attachedSkills: [] as SkillSummary[],
  };

  if (!isToolCallAllowed || !agent) {
    return emptyResult;
  }

  const capabilityUserId = resolveWaveAgentCapabilityUserId(options);

  const [subAgents, knowledgeGroups, skillState] = await Promise.all([
    agent.subAgentsEnabled
      ? subAgentRepository.selectSubAgentsByAgentId(agent.id)
      : Promise.resolve([]),
    knowledgeRepository.getGroupsByAgentId(agent.id),
    getAgentAttachedSkills(agent.id),
  ]);
  const attachedSkills = skillState.attachedSkills;

  const subagentTools =
    agent.subAgentsEnabled && subAgents.length > 0
      ? await loadSubAgentTools(
          {
            ...agent,
            subAgents,
          },
          capabilityUserId,
          options.dataStream,
          options.abortSignal,
          options.chatModel,
          attachedSkills,
        )
      : {};

  const knowledgeTools = knowledgeGroups.reduce(
    (acc, group) => {
      acc[knowledgeDocsToolName(group.id)] = createKnowledgeDocsTool(group, {
        userId: capabilityUserId,
        source: options.source,
        onRetrieved: options.onKnowledgeDocsRetrieved,
      });
      return acc;
    },
    {} as Record<string, Tool>,
  );

  const skillTools: Record<string, Tool> = attachedSkills.length
    ? {
        [LOAD_SKILL_TOOL_NAME]: createLoadSkillTool(attachedSkills),
      }
    : {};

  return {
    subagentTools,
    knowledgeTools,
    skillTools,
    subAgents,
    knowledgeGroups,
    attachedSkills,
  };
}

export async function loadWaveAgentBoundTools(options: {
  agent?: Agent | null;
  userId: string;
  capabilityUserId?: string;
  additionalMcpUserIds?: string[];
  mentions?: ChatMention[];
  allowedMcpServers?: Record<string, AllowedMCPServer>;
  allowedAppDefaultToolkit?: string[];
  dataStream: UIMessageStreamWriter;
  abortSignal: AbortSignal;
  chatModel: ChatModel;
  source: "agent" | "mcp";
  isToolCallAllowed?: boolean;
  onKnowledgeDocsRetrieved?: (
    payload: KnowledgeDocsRetrievedPayload,
  ) => void | Promise<void>;
}) {
  const isToolCallAllowed = options.isToolCallAllowed ?? true;
  const agent = options.agent;

  const emptyResult = {
    mcpTools: {} as Record<string, Tool>,
    workflowTools: {} as Record<string, Tool>,
    appDefaultTools: {} as Record<string, Tool>,
    subagentTools: {} as Record<string, Tool>,
    knowledgeTools: {} as Record<string, Tool>,
    skillTools: {} as Record<string, Tool>,
    subAgents: [],
    knowledgeGroups: [] as Awaited<
      ReturnType<typeof knowledgeRepository.getGroupsByAgentId>
    >,
    attachedSkills: [] as SkillSummary[],
  };

  if (!isToolCallAllowed) {
    return emptyResult;
  }

  const additionalMcpUserIds =
    options.additionalMcpUserIds ??
    (agent?.userId && agent.userId !== options.userId ? [agent.userId] : []);

  const [mcpTools, workflowTools, appDefaultTools, subAgents] =
    await Promise.all([
      loadMcpTools({
        mentions: options.mentions,
        allowedMcpServers: options.allowedMcpServers,
        userId: options.userId,
        additionalUserIds: additionalMcpUserIds,
      }),
      loadWorkFlowTools({
        mentions: options.mentions,
        dataStream: options.dataStream,
      }),
      loadAppDefaultTools({
        mentions: options.mentions,
        allowedAppDefaultToolkit: options.allowedAppDefaultToolkit,
      }),
      agent?.subAgentsEnabled
        ? subAgentRepository.selectSubAgentsByAgentId(agent.id)
        : Promise.resolve([]),
    ]);

  const {
    subagentTools,
    knowledgeTools,
    skillTools,
    knowledgeGroups,
    attachedSkills,
  } = await loadWaveAgentContinueCapabilities(options);

  return {
    mcpTools,
    workflowTools,
    appDefaultTools,
    subagentTools,
    knowledgeTools,
    skillTools,
    subAgents,
    knowledgeGroups,
    attachedSkills,
  };
}

export function buildWaveAgentSystemPrompt(options: {
  user?: User;
  userPreferences?: UserPreferences;
  agent?: Agent | null;
  subAgents?: Agent["subAgents"];
  attachedSkills?: Pick<SkillSummary, "title" | "description">[];
  activeSkills?: ActiveAgentSkill[];
  knowledgeContexts?: string[];
  mcpServerCustomizations?: Record<string, McpServerCustomizationsPrompt>;
  toolCallUnsupported?: boolean;
  extraPrompts?: Array<string | false | undefined>;
}) {
  return mergeSystemPrompt(
    buildUserSystemPrompt(
      options.user,
      options.userPreferences,
      options.agent ?? undefined,
    ),
    buildMcpServerCustomizationsSystemPrompt(
      options.mcpServerCustomizations ?? {},
    ),
    buildParallelSubAgentSystemPrompt(options.subAgents ?? []),
    buildAgentSkillsSystemPrompt(
      options.attachedSkills ?? [],
      options.activeSkills ?? [],
    ),
    options.toolCallUnsupported && buildToolCallUnsupportedModelSystemPrompt,
    buildKnowledgeContextSystemPrompt(options.knowledgeContexts ?? []),
    ...(options.extraPrompts ?? []),
  );
}

export const loadEmmaAgentContinueCapabilities =
  loadWaveAgentContinueCapabilities;
export const loadEmmaAgentBoundTools = loadWaveAgentBoundTools;
export const buildEmmaAgentSystemPrompt = buildWaveAgentSystemPrompt;
