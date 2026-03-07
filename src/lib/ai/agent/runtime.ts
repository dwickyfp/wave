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
  knowledgeDocsToolName,
} from "lib/ai/tools/knowledge-tool";
import {
  createLoadSkillTool,
  LOAD_SKILL_TOOL_NAME,
} from "lib/ai/tools/skill-tool";
import {
  knowledgeRepository,
  skillRepository,
  subAgentRepository,
} from "lib/db/repository";
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

export async function loadWaveAgentBoundTools(options: {
  agent?: Agent | null;
  userId: string;
  mentions?: ChatMention[];
  allowedMcpServers?: Record<string, AllowedMCPServer>;
  allowedAppDefaultToolkit?: string[];
  dataStream: UIMessageStreamWriter;
  abortSignal: AbortSignal;
  chatModel: ChatModel;
  source: "agent" | "mcp";
  isToolCallAllowed?: boolean;
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
    attachedSkills: [] as SkillSummary[],
  };

  if (!isToolCallAllowed) {
    return emptyResult;
  }

  const [mcpTools, workflowTools, appDefaultTools, subAgents] =
    await Promise.all([
      loadMcpTools({
        mentions: options.mentions,
        allowedMcpServers: options.allowedMcpServers,
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

  const subagentTools =
    agent?.subAgentsEnabled && subAgents.length > 0
      ? await loadSubAgentTools(
          {
            ...agent,
            subAgents,
          },
          options.dataStream,
          options.abortSignal,
          options.chatModel,
        )
      : {};

  const [knowledgeTools, attachedSkills] = agent?.id
    ? await Promise.all([
        knowledgeRepository.getGroupsByAgentId(agent.id).then((groups) =>
          groups.reduce(
            (acc, group) => {
              acc[knowledgeDocsToolName(group.id)] = createKnowledgeDocsTool(
                group,
                {
                  userId: options.userId,
                  source: options.source,
                },
              );
              return acc;
            },
            {} as Record<string, Tool>,
          ),
        ),
        skillRepository.getSkillsByAgentId(agent.id),
      ])
    : [
        {} as Record<string, Tool>,
        [] as Awaited<ReturnType<typeof skillRepository.getSkillsByAgentId>>,
      ];

  const skillTools: Record<string, Tool> = attachedSkills.length
    ? {
        [LOAD_SKILL_TOOL_NAME]: createLoadSkillTool(attachedSkills),
      }
    : {};

  return {
    mcpTools,
    workflowTools,
    appDefaultTools,
    subagentTools,
    knowledgeTools,
    skillTools,
    subAgents,
    attachedSkills,
  };
}

export function buildWaveAgentSystemPrompt(options: {
  user?: User;
  userPreferences?: UserPreferences;
  agent?: Agent | null;
  subAgents?: Agent["subAgents"];
  attachedSkills?: Pick<SkillSummary, "title" | "description">[];
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
    buildAgentSkillsSystemPrompt(options.attachedSkills ?? []),
    options.toolCallUnsupported && buildToolCallUnsupportedModelSystemPrompt,
    buildKnowledgeContextSystemPrompt(options.knowledgeContexts ?? []),
    ...(options.extraPrompts ?? []),
  );
}
