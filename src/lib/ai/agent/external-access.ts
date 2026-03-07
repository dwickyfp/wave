import { compare } from "bcrypt-ts";
import {
  jsonSchema,
  streamText,
  tool as createTool,
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  type Tool,
  type ToolChoice,
} from "ai";
import type { Agent } from "app-types/agent";
import type { ChatModel } from "app-types/chat";
import type { KnowledgeSummary } from "app-types/knowledge";
import type { SubAgent } from "app-types/subagent";
import {
  getExternalAgentAutocompleteOpenAiModelId,
  getExternalAgentOpenAiModelId,
  sanitizeExternalAgentModelName,
} from "lib/ai/agent/external-agent-model-id";
import {
  buildContinueAutocompleteSystemMessage,
  buildContinueRoutePrompt,
} from "lib/ai/agent/continue-prompts";
import {
  buildWaveAgentSystemPrompt,
  createNoopDataStream,
  loadWaveAgentContinueCapabilities,
  loadWaveAgentBoundTools,
} from "lib/ai/agent/runtime";
import {
  sanitizeModelMessagesForProvider,
  shouldSendToolDefinitionsToProvider,
} from "lib/ai/provider-compatibility";
import { getDbModel } from "lib/ai/provider-factory";
import { workflowToVercelAITool } from "@/app/api/chat/shared.chat";
import { createKnowledgeDocsTool } from "lib/ai/tools/knowledge-tool";
import {
  agentRepository,
  knowledgeRepository,
  settingsRepository,
  subAgentRepository,
  workflowRepository,
} from "lib/db/repository";
import logger from "logger";
import { z } from "zod";

export const MCP_PRESENTATION_MODE_COMPATIBILITY = "compatibility";
export const MCP_PRESENTATION_MODE_COPILOT_NATIVE = "copilot_native";

export type McpPresentationMode =
  | typeof MCP_PRESENTATION_MODE_COMPATIBILITY
  | typeof MCP_PRESENTATION_MODE_COPILOT_NATIVE;

export type ExternalAccessAgent = Agent & {
  mcpPresentationMode?: McpPresentationMode;
};

export type ProgressReporter = (progress: number, message: string) => void;

export const externalAccessMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

export const externalAccessFileContextSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  language: z.string().optional(),
});

export const waveRunAgentSchema = z.object({
  task: z.string().min(1),
  messages: z.array(externalAccessMessageSchema).optional().default([]),
  files: z.array(externalAccessFileContextSchema).optional().default([]),
  responseMode: z.enum(["text", "unified_diff"]).optional().default("text"),
});

export const knowledgeQuerySchema = z.object({
  query: z.string().min(1),
  tokens: z.number().positive().optional(),
});

export type WaveRunAgentInput = z.infer<typeof waveRunAgentSchema>;

export function createUnauthorizedResponse() {
  return Response.json(
    {
      error: "Unauthorized",
      message:
        "Provide Authorization: Bearer <agent-key> (recommended) or EMMA_AGENT_KEY header.",
    },
    { status: 401 },
  );
}

export async function authenticateExternalAgentRequest(
  headers: Headers,
  agentId: string,
): Promise<boolean> {
  const headerCandidates = [
    headers.get("emma_agent_key"),
    headers.get("emma-agent-key"),
    headers.get("x_emma_agent_key"),
    headers.get("x-emma-agent-key"),
    headers.get("wave_agent_api_key"),
    headers.get("wave-agent-api-key"),
    headers.get("x-wave-agent-api-key"),
  ];
  const headerKey = headerCandidates
    .find((candidate) => !!candidate?.trim())
    ?.trim();

  const authHeader = headers.get("authorization");
  let authKey: string | null = null;
  if (authHeader?.trim()) {
    const normalized = authHeader.trim();
    if (/^Bearer\s+/i.test(normalized)) {
      authKey = normalized.replace(/^Bearer\s+/i, "").trim();
    } else if (!normalized.includes(" ")) {
      authKey = normalized;
    }
  }

  const rawKey = authKey || headerKey;
  if (!rawKey) return false;

  const agentInfo = await agentRepository.getAgentByMcpKey(agentId);
  if (!agentInfo?.mcpApiKeyHash) {
    return false;
  }

  return compare(rawKey, agentInfo.mcpApiKeyHash);
}

export function isToolCapableLlmModel(candidate: {
  enabled: boolean;
  supportsTools: boolean;
  modelType?: string | null;
}) {
  return (
    candidate.enabled &&
    candidate.supportsTools &&
    (!candidate.modelType || candidate.modelType === "llm")
  );
}

export function isEnabledLlmModel(candidate: {
  enabled: boolean;
  modelType?: string | null;
}) {
  return (
    candidate.enabled && (!candidate.modelType || candidate.modelType === "llm")
  );
}

export async function resolveExternalAgentModelSelection(agent: {
  mcpModelProvider?: string | null;
  mcpModelName?: string | null;
}): Promise<ChatModel | null> {
  const providers = await settingsRepository.getProviders({
    enabledOnly: true,
  });

  if (agent.mcpModelProvider && agent.mcpModelName) {
    const provider = providers.find(
      (item) => item.name === agent.mcpModelProvider,
    );
    const model = provider?.models.find(
      (candidate) =>
        isToolCapableLlmModel(candidate) &&
        (candidate.uiName === agent.mcpModelName ||
          candidate.apiName === agent.mcpModelName),
    );

    if (!provider || !model) {
      throw new Error(
        "Configured MCP model is unavailable or not tool-capable. Update this agent's MCP model selection.",
      );
    }

    return {
      provider: provider.name,
      model: model.uiName || model.apiName,
    };
  }

  for (const provider of providers) {
    const model = provider.models.find(isToolCapableLlmModel);
    if (!model) continue;

    return {
      provider: provider.name,
      model: model.uiName || model.apiName,
    };
  }

  return null;
}

export async function resolveExternalAgentAutocompleteModelSelection(agent: {
  mcpAutocompleteModelProvider?: string | null;
  mcpAutocompleteModelName?: string | null;
}): Promise<ChatModel | null> {
  const providers = await settingsRepository.getProviders({
    enabledOnly: true,
  });

  if (agent.mcpAutocompleteModelProvider && agent.mcpAutocompleteModelName) {
    const provider = providers.find(
      (item) => item.name === agent.mcpAutocompleteModelProvider,
    );
    const model = provider?.models.find(
      (candidate) =>
        isEnabledLlmModel(candidate) &&
        (candidate.uiName === agent.mcpAutocompleteModelName ||
          candidate.apiName === agent.mcpAutocompleteModelName),
    );

    if (!provider || !model) {
      throw new Error(
        "Configured autocomplete model is unavailable. Update this agent's Continue autocomplete model selection.",
      );
    }

    return {
      provider: provider.name,
      model: model.uiName || model.apiName,
    };
  }

  return null;
}

export async function requireEnabledExternalAgent(
  agentId: string,
  agent?: ExternalAccessAgent | null,
): Promise<ExternalAccessAgent> {
  const resolvedAgent =
    agent ??
    ((await agentRepository.selectAgentByIdForMcp(
      agentId,
    )) as ExternalAccessAgent | null);

  if (!resolvedAgent) {
    throw new Error("Agent not found");
  }
  if (resolvedAgent.agentType === "snowflake_cortex") {
    throw new Error("Snowflake agents are not supported on this endpoint");
  }
  if (!resolvedAgent.mcpEnabled) {
    throw new Error("MCP is not enabled for this agent");
  }

  return resolvedAgent;
}

export async function loadExternalAccessAgent(
  agentId: string,
): Promise<ExternalAccessAgent | null> {
  return (await agentRepository.selectAgentByIdForMcp(
    agentId,
  )) as ExternalAccessAgent | null;
}

export function createProgressReporter(options: {
  progressToken?: string | number;
  emit?: (payload: {
    jsonrpc: "2.0";
    method: string;
    params?: unknown;
  }) => void;
}) {
  let lastProgress = 0;
  let lastMessage = "";

  return (progress: number, message: string) => {
    if (!options.emit || options.progressToken === undefined) return;

    const normalized = Math.max(
      lastProgress,
      Math.min(100, Math.round(progress)),
    );

    if (normalized === lastProgress && message === lastMessage) {
      return;
    }

    lastProgress = normalized;
    lastMessage = message;

    options.emit({
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: {
        progressToken: options.progressToken,
        progress: normalized,
        total: 100,
        message,
      },
    });
  };
}

export async function resolveExternalAgentModelRuntime(
  agent: ExternalAccessAgent,
  onProgress?: ProgressReporter,
) {
  onProgress?.(10, "Resolving model");
  const chatModel = await resolveExternalAgentModelSelection(agent);
  if (!chatModel) {
    throw new Error(
      "No enabled tool-capable chat model is configured. Configure one in Settings > AI Providers.",
    );
  }

  onProgress?.(15, "Loading model");
  const dbModelResult = await getDbModel(chatModel);
  if (!dbModelResult) {
    throw new Error(
      "Configured chat model is not available. Verify provider key/model settings.",
    );
  }

  return {
    chatModel,
    model: dbModelResult.model,
  };
}

export async function resolveExternalAgentAutocompleteModelRuntime(
  agent: ExternalAccessAgent,
) {
  const chatModel = await resolveExternalAgentAutocompleteModelSelection(agent);
  if (!chatModel) {
    throw new Error(
      "No autocomplete model is configured for this agent. Select one in Agent Access before using Continue autocomplete.",
    );
  }

  const dbModelResult = await getDbModel(chatModel);
  if (!dbModelResult) {
    throw new Error(
      "Configured autocomplete model is not available. Verify provider key/model settings.",
    );
  }

  return {
    chatModel,
    model: dbModelResult.model,
  };
}

export function getAgentPresentationMode(agent: {
  mcpPresentationMode?: string | null;
}): McpPresentationMode {
  return agent.mcpPresentationMode === MCP_PRESENTATION_MODE_COPILOT_NATIVE
    ? MCP_PRESENTATION_MODE_COPILOT_NATIVE
    : MCP_PRESENTATION_MODE_COMPATIBILITY;
}

export function formatFileContext(
  files: Array<{ path: string; content: string; language?: string }>,
) {
  if (!files.length) return "";

  return files
    .map((file) => {
      const language = file.language?.trim() || "text";
      return [
        `File: ${file.path}`,
        `\`\`\`${language}`,
        file.content,
        "```",
      ].join("\n");
    })
    .join("\n\n");
}

export function getUnifiedDiffInstruction(
  responseMode: "text" | "unified_diff",
) {
  if (responseMode !== "unified_diff") return;

  return [
    "When the task implies file changes, return only a unified diff patch.",
    "Patch requirements: git unified diff format with file paths and hunks.",
    "Do not include extra commentary before or after the patch.",
    "If no file changes are required, return NO_CHANGES.",
  ].join(" ");
}

export function formatToolTextOutput(
  result: unknown,
  fallback = "Task completed.",
) {
  if (typeof result === "string") {
    const trimmed = result.trim();
    return trimmed || fallback;
  }

  if (result === null || result === undefined) {
    return fallback;
  }

  return JSON.stringify(result, null, 2);
}

function buildTaskSections(
  input: WaveRunAgentInput,
  heading = "Workspace file context from MCP client:",
) {
  const taskSections = [input.task];

  if (input.files.length > 0) {
    taskSections.push([heading, formatFileContext(input.files)].join("\n\n"));
  }

  return taskSections;
}

export function buildWaveRunAgentMessages(input: WaveRunAgentInput) {
  return [
    ...input.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    {
      role: "user" as const,
      content: buildTaskSections(input).join("\n\n"),
    },
  ] satisfies ModelMessage[];
}

async function runStreamedTextTask(options: {
  model: LanguageModel;
  provider?: string | null;
  system: string;
  messages: ModelMessage[];
  tools: Record<string, Tool>;
  abortSignal: AbortSignal;
  onProgress?: ProgressReporter;
  startMessage: string;
  toolProgressFormatter?: (toolName: string) => string;
  maxRetries?: number;
}) {
  let streamProgress = 35;
  let textChunkCount = 0;

  const nudgeProgress = (message: string, step = 2) => {
    streamProgress = Math.min(90, streamProgress + step);
    options.onProgress?.(streamProgress, message);
  };

  options.onProgress?.(35, options.startMessage);
  const compatibleMessages = sanitizeModelMessagesForProvider({
    provider: options.provider,
    messages: options.messages,
    tools: options.tools,
  });
  if (compatibleMessages.removedToolParts > 0) {
    logger.info(
      `provider compatibility pruned ${compatibleMessages.removedToolParts} stale tool parts across ${compatibleMessages.removedMessages} messages for external provider ${options.provider ?? "unknown"}`,
    );
  }
  const sendToolDefinitions = shouldSendToolDefinitionsToProvider({
    provider: options.provider,
    tools: options.tools,
  });
  const result = streamText({
    model: options.model,
    system: options.system,
    messages: compatibleMessages.messages,
    stopWhen: stepCountIs(10),
    maxRetries: options.maxRetries ?? 2,
    abortSignal: options.abortSignal,
    ...(sendToolDefinitions
      ? {
          tools: options.tools,
          toolChoice: "auto" as const,
        }
      : {}),
    onChunk: async ({ chunk }) => {
      if (chunk.type === "tool-call") {
        nudgeProgress(
          options.toolProgressFormatter?.(chunk.toolName) ??
            `Executing tool: ${chunk.toolName}`,
          3,
        );
      } else if (chunk.type === "tool-result") {
        nudgeProgress("Tool completed", 2);
      } else if (chunk.type === "text-delta") {
        textChunkCount += 1;
        if (textChunkCount % 12 === 0) {
          nudgeProgress("Generating response", 1);
        }
      }
    },
    onStepFinish: async () => {
      options.onProgress?.(92, "Finishing step");
    },
    onFinish: async () => {
      options.onProgress?.(96, "Finalizing response");
    },
  });

  const finalText = (await result.text)?.trim();
  options.onProgress?.(100, "Completed");

  return finalText || "Task completed.";
}

export async function streamWaveManagedAgentRun(options: {
  agent: ExternalAccessAgent;
  messages: ModelMessage[];
  abortSignal: AbortSignal;
  responseMode?: "text" | "unified_diff";
  onProgress?: ProgressReporter;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
}) {
  const resolvedAgent = await requireEnabledExternalAgent(
    options.agent.id,
    options.agent,
  );
  const { chatModel, model } = await resolveExternalAgentModelRuntime(
    resolvedAgent,
    options.onProgress,
  );

  options.onProgress?.(20, "Loading tools");
  const dataStream = createNoopDataStream();
  const toolset = await loadWaveAgentBoundTools({
    agent: resolvedAgent,
    userId: resolvedAgent.userId,
    mentions: resolvedAgent.instructions?.mentions ?? [],
    dataStream,
    abortSignal: options.abortSignal,
    chatModel,
    source: "mcp",
  });

  const systemPrompt = buildWaveAgentSystemPrompt({
    agent: resolvedAgent,
    subAgents: toolset.subAgents,
    attachedSkills: toolset.attachedSkills,
    extraPrompts: [
      ...buildContinueRoutePrompt({
        codingMode: resolvedAgent.mcpCodingMode ?? false,
        agentName: resolvedAgent.name,
        messages: options.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        capabilityState: getContinueCapabilityState({
          knowledgeGroups: toolset.knowledgeGroups,
          subAgents: toolset.subAgents ?? [],
          attachedSkills: toolset.attachedSkills,
        }),
      }),
      getUnifiedDiffInstruction(options.responseMode ?? "text"),
    ],
  });

  options.onProgress?.(30, "Running model");
  const tools = {
    ...toolset.mcpTools,
    ...toolset.workflowTools,
    ...toolset.subagentTools,
    ...toolset.knowledgeTools,
    ...toolset.skillTools,
    ...toolset.appDefaultTools,
  };
  const compatibleMessages = sanitizeModelMessagesForProvider({
    provider: chatModel.provider,
    messages: options.messages,
    tools,
  });
  if (compatibleMessages.removedToolParts > 0) {
    logger.info(
      `provider compatibility pruned ${compatibleMessages.removedToolParts} stale tool parts across ${compatibleMessages.removedMessages} messages for external provider ${chatModel.provider}`,
    );
  }
  return streamText({
    model,
    system: systemPrompt,
    messages: compatibleMessages.messages,
    stopWhen: stepCountIs(10),
    maxRetries: 2,
    abortSignal: options.abortSignal,
    temperature: options.temperature,
    topP: options.topP,
    maxOutputTokens: options.maxOutputTokens,
    stopSequences: options.stopSequences,
    onChunk: async ({ chunk }) => {
      if (chunk.type === "tool-call") {
        options.onProgress?.(50, `Executing tool: ${chunk.toolName}`);
      } else if (chunk.type === "tool-result") {
        options.onProgress?.(70, "Tool completed");
      }
    },
    onStepFinish: async () => {
      options.onProgress?.(92, "Finishing step");
    },
    onFinish: async () => {
      options.onProgress?.(100, "Completed");
    },
    ...(shouldSendToolDefinitionsToProvider({
      provider: chatModel.provider,
      tools,
    })
      ? {
          tools,
          toolChoice: "auto" as const,
        }
      : {}),
  });
}

export async function executeWaveRunAgent(
  input: WaveRunAgentInput,
  context: {
    agent: ExternalAccessAgent;
    abortSignal: AbortSignal;
    onProgress?: ProgressReporter;
  },
): Promise<string> {
  const result = await streamWaveManagedAgentRun({
    agent: context.agent,
    messages: buildWaveRunAgentMessages(input),
    abortSignal: context.abortSignal,
    responseMode: input.responseMode,
    onProgress: context.onProgress,
  });

  return (await result.text)?.trim() || "Task completed.";
}

function inferSubagentProgressVerb(name: string) {
  const normalized = name.toLowerCase();

  if (normalized.includes("plan")) return "Planning";
  if (normalized.includes("code") || normalized.includes("dev")) {
    return "Coding";
  }
  if (normalized.includes("review")) return "Reviewing";
  if (normalized.includes("test")) return "Testing";

  return `Running ${name}`;
}

export async function executeSubAgentExternalTool(
  subagent: SubAgent,
  rawInput: unknown,
  context: {
    agent: ExternalAccessAgent;
    abortSignal: AbortSignal;
    onProgress?: ProgressReporter;
  },
): Promise<string> {
  const input = waveRunAgentSchema.parse(rawInput);
  const { chatModel, model } = await resolveExternalAgentModelRuntime(
    context.agent,
    context.onProgress,
  );
  const dataStream = createNoopDataStream();
  const toolset = await loadWaveAgentBoundTools({
    userId: context.agent.userId,
    mentions: subagent.tools,
    dataStream,
    abortSignal: context.abortSignal,
    chatModel,
    source: "mcp",
  });

  const instructions =
    subagent.instructions ||
    `You are a specialized assistant called "${subagent.name}". Complete the given task autonomously and thoroughly.\n\nWhen you have finished, write a clear summary of your findings as your final response.`;
  const progressVerb = inferSubagentProgressVerb(subagent.name);
  const messages = [
    ...input.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    {
      role: "user" as const,
      content: buildTaskSections(
        input,
        `Workspace file context for ${subagent.name}:`,
      ).join("\n\n"),
    },
  ] satisfies ModelMessage[];

  return runStreamedTextTask({
    model,
    provider: chatModel.provider,
    system: buildWaveAgentSystemPrompt({
      extraPrompts: [
        instructions,
        getUnifiedDiffInstruction(input.responseMode),
      ],
    }),
    messages,
    tools: {
      ...toolset.mcpTools,
      ...toolset.workflowTools,
      ...toolset.appDefaultTools,
    },
    abortSignal: context.abortSignal,
    onProgress: context.onProgress,
    startMessage: progressVerb,
    maxRetries: 4,
    toolProgressFormatter: (toolName) => `${progressVerb}: ${toolName}`,
  });
}

export async function executeWorkflowExternalTool(
  workflow: {
    id: string;
    name: string;
    description?: string;
    schema: Record<string, unknown>;
  },
  rawInput: unknown,
  context: {
    abortSignal: AbortSignal;
    onProgress?: ProgressReporter;
  },
): Promise<string> {
  const input =
    rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
      ? rawInput
      : {};

  const workflowTool = workflowToVercelAITool({
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    schema: workflow.schema as any,
    dataStream: createNoopDataStream(),
  });

  context.onProgress?.(10, `Running workflow: ${workflow.name}`);
  const result = await workflowTool.execute?.(input as any, {
    toolCallId: `mcp-workflow-${workflow.id}`,
    abortSignal: context.abortSignal,
    messages: [],
  });

  const workflowResult = result as
    | { status?: string; result?: unknown; error?: { message?: string } }
    | undefined;

  if (workflowResult?.status === "fail") {
    throw new Error(
      workflowResult.error?.message || `Workflow "${workflow.name}" failed.`,
    );
  }

  context.onProgress?.(100, `Workflow completed: ${workflow.name}`);
  return formatToolTextOutput(
    workflowResult?.result ?? result,
    `${workflow.name} completed.`,
  );
}

export async function executeKnowledgeExternalTool(
  group: KnowledgeSummary,
  rawInput: unknown,
  context: {
    agent: ExternalAccessAgent;
    onProgress?: ProgressReporter;
  },
): Promise<string> {
  const input = knowledgeQuerySchema.parse(rawInput);
  context.onProgress?.(10, `Querying knowledge: ${group.name}`);
  const knowledgeTool = createKnowledgeDocsTool(group, {
    userId: context.agent.userId,
    source: "mcp",
  });

  const result = await knowledgeTool.execute?.(input as any, {
    toolCallId: `mcp-knowledge-${group.id}`,
    messages: [],
  });
  context.onProgress?.(100, `Knowledge results ready: ${group.name}`);

  return formatToolTextOutput(
    result,
    `No knowledge results returned from ${group.name}.`,
  );
}

export function sanitizeToolNamePart(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "item";
}

export function buildDynamicToolName(
  prefix: string,
  label: string,
  id: string,
  usedNames: Set<string>,
) {
  const labelPart = sanitizeToolNamePart(label).slice(0, 40);
  const idPart = sanitizeToolNamePart(id).slice(0, 8);

  let name = `${prefix}_${labelPart}`.slice(0, 64);
  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }

  name = `${prefix}_${labelPart}_${idPart}`.slice(0, 64);
  usedNames.add(name);
  return name;
}

export {
  sanitizeExternalAgentModelName,
  getExternalAgentOpenAiModelId,
  getExternalAgentAutocompleteOpenAiModelId,
};

export const openAiToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  }),
});

const openAiContentPartSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
});

const openAiAssistantToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }),
});

export const openAiMessageSchema = z.object({
  role: z.enum(["system", "developer", "user", "assistant", "tool"]),
  content: z
    .union([z.string(), z.array(openAiContentPartSchema), z.null()])
    .optional(),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
  tool_calls: z.array(openAiAssistantToolCallSchema).optional(),
});

export const openAiChatCompletionsRequestSchema = z.object({
  model: z.string().optional(),
  messages: z.array(openAiMessageSchema),
  stream: z.boolean().optional().default(false),
  tools: z.array(openAiToolSchema).optional(),
  tool_choice: z
    .union([
      z.enum(["auto", "none", "required"]),
      z.object({
        type: z.literal("function"),
        function: z.object({
          name: z.string().min(1),
        }),
      }),
    ])
    .optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
});

export const openAiLegacyCompletionsRequestSchema = z.object({
  model: z.string().optional(),
  prompt: z.union([z.string(), z.array(z.string())]),
  suffix: z.string().optional(),
  stream: z.boolean().optional().default(false),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
});

export function normalizeOpenAiTextContent(
  content: z.infer<typeof openAiMessageSchema>["content"],
) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
      .join("");
  }

  return "";
}

export function normalizeLegacyCompletionPrompt(
  prompt: z.infer<typeof openAiLegacyCompletionsRequestSchema>["prompt"],
) {
  if (typeof prompt === "string") {
    return prompt;
  }

  return prompt.join("\n");
}

export function summarizeExternalPreview(value: string, maxLength = 220) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function parseToolArguments(input: string) {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function parseToolOutput(input: string) {
  try {
    return {
      type: "json" as const,
      value: JSON.parse(input),
    };
  } catch {
    return {
      type: "text" as const,
      value: input,
    };
  }
}

export function convertOpenAiMessagesToModelMessages(
  messages: z.infer<typeof openAiChatCompletionsRequestSchema>["messages"],
) {
  const toolNamesByCallId = new Map<string, string>();

  return messages.flatMap((message) => {
    if (message.role === "system" || message.role === "developer") {
      return {
        role: "system" as const,
        content: normalizeOpenAiTextContent(message.content),
      };
    }

    if (message.role === "user") {
      return {
        role: "user" as const,
        content: normalizeOpenAiTextContent(message.content),
      };
    }

    if (message.role === "assistant") {
      const contentParts: Array<
        | { type: "text"; text: string }
        | {
            type: "tool-call";
            toolCallId: string;
            toolName: string;
            input: unknown;
          }
      > = [];
      const text = normalizeOpenAiTextContent(message.content);
      if (text) {
        contentParts.push({ type: "text", text });
      }

      for (const toolCall of message.tool_calls ?? []) {
        toolNamesByCallId.set(toolCall.id, toolCall.function.name);
        contentParts.push({
          type: "tool-call",
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          input: parseToolArguments(toolCall.function.arguments),
        });
      }

      if (contentParts.length === 1 && contentParts[0]?.type === "text") {
        return {
          role: "assistant" as const,
          content: contentParts[0].text,
        };
      }

      return {
        role: "assistant" as const,
        content: contentParts,
      };
    }

    if (!message.tool_call_id) {
      return [];
    }

    return {
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: message.tool_call_id,
          toolName:
            message.name ||
            toolNamesByCallId.get(message.tool_call_id) ||
            "tool",
          output: parseToolOutput(normalizeOpenAiTextContent(message.content)),
        },
      ],
    };
  }) satisfies ModelMessage[];
}

export function hasExternalToolConversation(
  request: z.infer<typeof openAiChatCompletionsRequestSchema>,
) {
  return Boolean(
    request.tools?.length ||
      request.messages.some(
        (message) =>
          message.role === "tool" ||
          (message.role === "assistant" &&
            (message.tool_calls?.length ?? 0) > 0),
      ),
  );
}

export function createContinueManagedToolSet(
  requestTools: z.infer<typeof openAiToolSchema>[],
) {
  return requestTools.reduce(
    (acc, definition) => {
      acc[definition.function.name] = createTool({
        description: definition.function.description,
        inputSchema: jsonSchema(
          definition.function.parameters ?? {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        ),
      });
      return acc;
    },
    {} as Record<string, Tool>,
  );
}

function getContinueCapabilityState(options: {
  knowledgeGroups: Array<{ name: string }>;
  subAgents: Array<{ name: string }>;
  attachedSkills: Array<{ title: string }>;
}) {
  return {
    knowledgeGroups: options.knowledgeGroups.map((group) => group.name),
    subAgents: options.subAgents.map((subAgent) => subAgent.name),
    skills: options.attachedSkills.map((skill) => skill.title),
  };
}

function mergeContinueManagedTools(options: {
  continueTools: Record<string, Tool>;
  internalTools: Record<string, Tool>;
}) {
  const collisions = Object.keys(options.continueTools).filter((toolName) =>
    Object.prototype.hasOwnProperty.call(options.internalTools, toolName),
  );

  if (collisions.length > 0) {
    logger.warn(
      `External Access: Continue client tools override internal Wave capability tools for: ${collisions.join(
        ", ",
      )}`,
    );
  }

  return {
    tools: {
      ...options.internalTools,
      ...options.continueTools,
    },
    collisions,
  };
}

export function mapOpenAiToolChoice(
  toolChoice: z.infer<typeof openAiChatCompletionsRequestSchema>["tool_choice"],
): ToolChoice<Record<string, Tool>> | undefined {
  if (!toolChoice) return undefined;
  if (typeof toolChoice === "string") return toolChoice;

  return {
    type: "tool",
    toolName: toolChoice.function.name,
  };
}

export async function streamContinueManagedTools(options: {
  agent: ExternalAccessAgent;
  request: z.infer<typeof openAiChatCompletionsRequestSchema>;
  abortSignal: AbortSignal;
}) {
  const resolvedAgent = await requireEnabledExternalAgent(
    options.agent.id,
    options.agent,
  );
  const { chatModel, model } =
    await resolveExternalAgentModelRuntime(resolvedAgent);
  const dataStream = createNoopDataStream();
  const externalTools = createContinueManagedToolSet(
    options.request.tools ?? [],
  );
  const internalCapabilities = await loadWaveAgentContinueCapabilities({
    agent: resolvedAgent,
    userId: resolvedAgent.userId,
    dataStream,
    abortSignal: options.abortSignal,
    chatModel,
    source: "mcp",
  });
  const mergedTools = mergeContinueManagedTools({
    continueTools: externalTools,
    internalTools: {
      ...internalCapabilities.knowledgeTools,
      ...internalCapabilities.subagentTools,
      ...internalCapabilities.skillTools,
    },
  });

  return streamText({
    model,
    system: buildWaveAgentSystemPrompt({
      agent: resolvedAgent,
      subAgents: internalCapabilities.subAgents,
      attachedSkills: internalCapabilities.attachedSkills,
      extraPrompts: buildContinueRoutePrompt({
        codingMode: resolvedAgent.mcpCodingMode ?? false,
        agentName: resolvedAgent.name,
        messages: options.request.messages,
        clientOwnsWorkspaceTools: true,
        capabilityState: getContinueCapabilityState({
          knowledgeGroups: internalCapabilities.knowledgeGroups,
          subAgents: internalCapabilities.subAgents ?? [],
          attachedSkills: internalCapabilities.attachedSkills,
        }),
      }),
    }),
    messages: sanitizeModelMessagesForProvider({
      provider: chatModel.provider,
      messages: convertOpenAiMessagesToModelMessages(options.request.messages),
      tools: mergedTools.tools,
    }).messages,
    abortSignal: options.abortSignal,
    maxRetries: 2,
    temperature: options.request.temperature,
    topP: options.request.top_p,
    maxOutputTokens: options.request.max_tokens,
    stopSequences: Array.isArray(options.request.stop)
      ? options.request.stop
      : options.request.stop
        ? [options.request.stop]
        : undefined,
    ...(shouldSendToolDefinitionsToProvider({
      provider: chatModel.provider,
      tools: mergedTools.tools,
    })
      ? {
          tools: mergedTools.tools,
          toolChoice: mapOpenAiToolChoice(options.request.tool_choice),
        }
      : {}),
  });
}

export async function streamContinueAutocomplete(options: {
  agent: ExternalAccessAgent;
  request: z.infer<typeof openAiLegacyCompletionsRequestSchema>;
  abortSignal: AbortSignal;
}) {
  const resolvedAgent = await requireEnabledExternalAgent(
    options.agent.id,
    options.agent,
  );
  const { model } =
    await resolveExternalAgentAutocompleteModelRuntime(resolvedAgent);
  const prompt = normalizeLegacyCompletionPrompt(options.request.prompt);
  const suffix = options.request.suffix?.trim();
  const userPrompt = [
    "Complete the following code snippet.",
    "",
    "Prefix:",
    "```text",
    prompt,
    "```",
    suffix
      ? [
          "",
          "Suffix that must remain valid after your completion:",
          "```text",
          suffix,
          "```",
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return streamText({
    model,
    system: buildContinueAutocompleteSystemMessage(resolvedAgent.name),
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
    abortSignal: options.abortSignal,
    maxRetries: 2,
    temperature: options.request.temperature,
    topP: options.request.top_p,
    maxOutputTokens: options.request.max_tokens,
    stopSequences: Array.isArray(options.request.stop)
      ? options.request.stop
      : options.request.stop
        ? [options.request.stop]
        : undefined,
  });
}

export async function getCopilotNativeMcpResources(agent: ExternalAccessAgent) {
  const workflowMentionIds = Array.from(
    new Set(
      (agent.instructions?.mentions ?? [])
        .filter((mention) => mention.type === "workflow")
        .map((mention) => mention.workflowId),
    ),
  );

  const [subAgents, workflows, knowledgeGroups] = await Promise.all([
    agent.subAgentsEnabled
      ? subAgentRepository.selectSubAgentsByAgentId(agent.id)
      : Promise.resolve([]),
    workflowMentionIds.length
      ? workflowRepository.selectToolByIds(workflowMentionIds)
      : Promise.resolve([]),
    knowledgeRepository.getGroupsByAgentId(agent.id),
  ]);

  return { subAgents, workflows, knowledgeGroups };
}

export function mapFinishReasonToOpenAi(finishReason: string | undefined) {
  if (finishReason === "tool-calls") return "tool_calls";
  if (finishReason === "length") return "length";
  if (finishReason === "content-filter") return "content_filter";
  return "stop";
}
