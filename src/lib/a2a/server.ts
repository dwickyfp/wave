import "server-only";

import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  JsonRpcTransportHandler,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
  type TaskStore,
} from "@a2a-js/sdk/server";
import type {
  AgentCard,
  AgentSkill,
  Message,
  Task,
  TaskArtifactUpdateEvent,
  TaskStatusUpdateEvent,
  JSONRPCResponse,
} from "@a2a-js/sdk";
import { compare } from "bcrypt-ts";
import { stepCountIs, streamText, type ModelMessage, type Tool } from "ai";
import type { Agent } from "app-types/agent";
import type { A2AAgentConfig, A2AAgentCard } from "app-types/a2a-agent";
import {
  createNoopDataStream,
  buildWaveAgentSystemPrompt,
  loadWaveAgentBoundTools,
} from "lib/ai/agent/runtime";
import { resolveExternalAgentModelRuntime } from "lib/ai/agent/external-access";
import {
  sanitizeModelMessagesForProvider,
  shouldSendToolDefinitionsToProvider,
} from "lib/ai/provider-compatibility";
import {
  agentRepository,
  a2aAgentRepository,
  snowflakeAgentRepository,
} from "lib/db/repository";
import {
  callSnowflakeCortexStream,
  createSnowflakeThread,
  type SnowflakeCortexMessage,
} from "lib/snowflake/client";
import logger from "logger";
import { generateUUID } from "lib/utils";
import {
  A2A_PROTOCOL_VERSION,
  extractTextFromA2AParts,
  streamA2AAgentResponse,
} from "./client";

const A2A_ARTIFACT_ID = "wave-response";
const A2A_METADATA_KEY = "waveA2A";
const A2A_SSE_HEADERS = {
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "Content-Type": "text/event-stream",
  "X-Accel-Buffering": "no",
} as const;
const A2A_SECURITY_SCHEME_NAME = "bearerAuth";

type PublishedA2AMetadata = {
  agentId: string;
  agentType: NonNullable<Agent["agentType"]>;
  snowflakeThreadId?: string | null;
  snowflakeParentMessageId?: number | null;
  remoteContextId?: string | null;
  remoteTaskId?: string | null;
};

type PublishedAgentRuntime = {
  taskStore: TaskStore;
  executor: WavePublishedA2AExecutor;
};

const publishedAgentRuntimeMap = new Map<string, PublishedAgentRuntime>();

function nowIso() {
  return new Date().toISOString();
}

function normalizeAgentType(agent: Agent) {
  return agent.agentType ?? "standard";
}

function buildAgentSkill(agent: Agent) {
  return {
    id: `wave-agent-${agent.id}`,
    name: agent.name,
    description: agent.description ?? "Chat with this Wave agent.",
    tags: ["chat", normalizeAgentType(agent)],
    inputModes: ["text"],
    outputModes: ["text"],
  };
}

function normalizeAgentSkills(
  skills: A2AAgentCard["skills"] | undefined,
): AgentSkill[] {
  if (!skills?.length) return [];

  return skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description ?? "",
    tags: skill.tags ?? [],
    examples: skill.examples ?? [],
    inputModes: skill.inputModes ?? ["text"],
    outputModes: skill.outputModes ?? ["text"],
  }));
}

function buildCardIconUrl(agent: Agent, remoteCard?: A2AAgentCard | null) {
  const iconValue = agent.icon?.value?.trim();
  if (iconValue?.startsWith("http://") || iconValue?.startsWith("https://")) {
    return iconValue;
  }

  return remoteCard?.iconUrl;
}

function toModelMessagesFromTaskHistory(task?: Task): ModelMessage[] {
  if (!task?.history?.length) return [];

  return task.history.reduce<ModelMessage[]>((messages, message) => {
    const content = extractTextFromA2AParts(message.parts).trim();
    if (!content) return messages;

    messages.push({
      role:
        message.role === "agent" ? ("assistant" as const) : ("user" as const),
      content,
    });

    return messages;
  }, []);
}

function buildStandardAgentMessages(requestContext: RequestContext) {
  const messages = toModelMessagesFromTaskHistory(requestContext.task);
  const latestUserText = extractTextFromA2AParts(
    requestContext.userMessage.parts,
  ).trim();

  if (latestUserText) {
    messages.push({
      role: "user",
      content: latestUserText,
    });
  }

  return messages;
}

function buildInitialTask(input: {
  requestContext: RequestContext;
  agent: Agent;
}): Task {
  const metadata =
    input.requestContext.task?.metadata?.[A2A_METADATA_KEY] &&
    typeof input.requestContext.task.metadata[A2A_METADATA_KEY] === "object"
      ? {
          [A2A_METADATA_KEY]:
            input.requestContext.task.metadata[A2A_METADATA_KEY],
        }
      : {
          [A2A_METADATA_KEY]: {
            agentId: input.agent.id,
            agentType: normalizeAgentType(input.agent),
          } satisfies PublishedA2AMetadata,
        };

  return {
    kind: "task",
    id: input.requestContext.taskId,
    contextId: input.requestContext.contextId,
    status: {
      state: "submitted",
      timestamp: nowIso(),
    },
    history: [input.requestContext.userMessage],
    metadata,
  };
}

async function updateStoredTask(
  taskStore: TaskStore,
  taskId: string,
  updater: (task: Task) => Task,
) {
  const task = await taskStore.load(taskId);
  if (!task) return;

  await taskStore.save(updater(task));
}

function buildArtifactEvent(input: {
  taskId: string;
  contextId: string;
  text: string;
  append: boolean;
  lastChunk?: boolean;
}): TaskArtifactUpdateEvent {
  return {
    kind: "artifact-update",
    taskId: input.taskId,
    contextId: input.contextId,
    append: input.append,
    lastChunk: input.lastChunk,
    artifact: {
      artifactId: A2A_ARTIFACT_ID,
      name: "response.txt",
      parts: [{ kind: "text", text: input.text }],
    },
  };
}

function buildFinalStatusEvent(input: {
  taskId: string;
  contextId: string;
  state: TaskStatusUpdateEvent["status"]["state"];
  final: boolean;
  message?: string;
}): TaskStatusUpdateEvent {
  return {
    kind: "status-update",
    taskId: input.taskId,
    contextId: input.contextId,
    final: input.final,
    status: {
      state: input.state,
      timestamp: nowIso(),
      ...(input.message
        ? {
            message: {
              kind: "message",
              messageId: generateUUID(),
              role: "agent",
              taskId: input.taskId,
              contextId: input.contextId,
              parts: [{ kind: "text", text: input.message }],
            } satisfies Message,
          }
        : {}),
    },
  };
}

async function persistTaskCompletion(input: {
  taskStore: TaskStore;
  taskId: string;
  finalText: string;
  metadata: PublishedA2AMetadata;
  contextId: string;
}) {
  await updateStoredTask(input.taskStore, input.taskId, (task) => {
    const history = [...(task.history ?? [])];
    const assistantMessage: Message = {
      kind: "message",
      messageId: generateUUID(),
      role: "agent",
      taskId: task.id,
      contextId: input.contextId,
      parts: [{ kind: "text", text: input.finalText }],
    };

    history.push(assistantMessage);

    return {
      ...task,
      history,
      metadata: {
        ...(task.metadata ?? {}),
        [A2A_METADATA_KEY]: input.metadata,
      },
    };
  });
}

function getStoredA2AMetadata(task?: Task): PublishedA2AMetadata | null {
  const value = task?.metadata?.[A2A_METADATA_KEY];
  if (!value || typeof value !== "object") return null;

  return value as PublishedA2AMetadata;
}

async function streamStandardAgentRun(input: {
  agent: Agent;
  requestContext: RequestContext;
  abortSignal: AbortSignal;
  eventBus: ExecutionEventBus;
}): Promise<{ finalText: string; metadata: PublishedA2AMetadata }> {
  const { chatModel, model } = await resolveExternalAgentModelRuntime(
    input.agent as any,
  );
  const dataStream = createNoopDataStream();
  const toolset = await loadWaveAgentBoundTools({
    agent: input.agent,
    userId: input.agent.userId,
    mentions: input.agent.instructions?.mentions ?? [],
    dataStream,
    abortSignal: input.abortSignal,
    chatModel,
    source: "mcp",
  });
  const tools: Record<string, Tool> = {
    ...toolset.mcpTools,
    ...toolset.workflowTools,
    ...toolset.subagentTools,
    ...toolset.knowledgeTools,
    ...toolset.skillTools,
    ...toolset.appDefaultTools,
  };
  const messages = buildStandardAgentMessages(input.requestContext);
  const compatibleMessages = sanitizeModelMessagesForProvider({
    provider: chatModel.provider,
    messages,
    tools,
  });
  const sendToolDefinitions = shouldSendToolDefinitionsToProvider({
    provider: chatModel.provider,
    tools,
  });
  const run = streamText({
    model,
    system: buildWaveAgentSystemPrompt({
      agent: input.agent,
      subAgents: toolset.subAgents,
      attachedSkills: toolset.attachedSkills,
    }),
    messages: compatibleMessages.messages,
    stopWhen: stepCountIs(10),
    maxRetries: 2,
    abortSignal: input.abortSignal,
    ...(sendToolDefinitions ? { tools, toolChoice: "auto" as const } : {}),
  });

  let finalText = "";
  let append = false;
  for await (const delta of run.textStream) {
    if (!delta) continue;

    finalText += delta;
    input.eventBus.publish(
      buildArtifactEvent({
        taskId: input.requestContext.taskId,
        contextId: input.requestContext.contextId,
        text: delta,
        append,
      }),
    );
    append = true;
  }

  finalText =
    finalText.trim() || ((await run.text)?.trim() ?? "Task completed.");

  return {
    finalText,
    metadata: {
      agentId: input.agent.id,
      agentType: "standard",
    },
  };
}

async function streamSnowflakeAgentRun(input: {
  agent: Agent;
  requestContext: RequestContext;
  abortSignal: AbortSignal;
  eventBus: ExecutionEventBus;
}): Promise<{ finalText: string; metadata: PublishedA2AMetadata }> {
  const config = await snowflakeAgentRepository.selectSnowflakeConfigByAgentId(
    input.agent.id,
  );
  if (!config) {
    throw new Error("Snowflake configuration not found for this agent.");
  }

  const stored = getStoredA2AMetadata(input.requestContext.task);
  let snowflakeThreadId = stored?.snowflakeThreadId || null;
  let snowflakeParentMessageId = stored?.snowflakeParentMessageId ?? 0;

  if (!snowflakeThreadId) {
    snowflakeThreadId = await createSnowflakeThread(config);
    snowflakeParentMessageId = 0;
  }

  const userText = extractTextFromA2AParts(
    input.requestContext.userMessage.parts,
  ).trim();
  const messages: SnowflakeCortexMessage[] = userText
    ? [
        {
          role: "user",
          content: [{ type: "text", text: userText }],
        },
      ]
    : [];

  let finalText = "";
  let append = false;

  for await (const event of callSnowflakeCortexStream({
    config,
    messages,
    threadId: snowflakeThreadId,
    parentMessageId: snowflakeParentMessageId,
  })) {
    if (input.abortSignal.aborted) {
      break;
    }

    switch (event.type) {
      case "text-delta":
        finalText += event.delta;
        input.eventBus.publish(
          buildArtifactEvent({
            taskId: input.requestContext.taskId,
            contextId: input.requestContext.contextId,
            text: event.delta,
            append,
          }),
        );
        append = true;
        break;
      case "table":
        finalText += event.markdown;
        input.eventBus.publish(
          buildArtifactEvent({
            taskId: input.requestContext.taskId,
            contextId: input.requestContext.contextId,
            text: event.markdown,
            append,
          }),
        );
        append = true;
        break;
      case "chart": {
        const chartBlock = `\n\`\`\`vegalite\n${event.spec}\n\`\`\`\n`;
        finalText += chartBlock;
        input.eventBus.publish(
          buildArtifactEvent({
            taskId: input.requestContext.taskId,
            contextId: input.requestContext.contextId,
            text: chartBlock,
            append,
          }),
        );
        append = true;
        break;
      }
      case "thread-message-ids":
        snowflakeParentMessageId = event.assistantMessageId;
        break;
      default:
        break;
    }
  }

  return {
    finalText: finalText.trim() || "Task completed.",
    metadata: {
      agentId: input.agent.id,
      agentType: "snowflake_cortex",
      snowflakeThreadId,
      snowflakeParentMessageId,
    },
  };
}

async function streamRemoteA2AAgentRun(input: {
  agent: Agent;
  requestContext: RequestContext;
  abortSignal: AbortSignal;
  eventBus: ExecutionEventBus;
}): Promise<{ finalText: string; metadata: PublishedA2AMetadata }> {
  const config = await a2aAgentRepository.selectA2AConfigByAgentId(
    input.agent.id,
  );
  if (!config) {
    throw new Error("A2A configuration not found for this agent.");
  }

  const stored = getStoredA2AMetadata(input.requestContext.task);
  const text = extractTextFromA2AParts(
    input.requestContext.userMessage.parts,
  ).trim();

  let finalText = "";
  let append = false;
  let remoteContextId = stored?.remoteContextId ?? null;
  let remoteTaskId = stored?.remoteTaskId ?? null;

  for await (const event of streamA2AAgentResponse({
    config,
    text,
    contextId: remoteContextId,
    taskId: remoteTaskId,
  })) {
    if (input.abortSignal.aborted) {
      break;
    }

    if (event.text) {
      finalText += event.text;
      input.eventBus.publish(
        buildArtifactEvent({
          taskId: input.requestContext.taskId,
          contextId: input.requestContext.contextId,
          text: event.text,
          append,
        }),
      );
      append = true;
    }

    remoteContextId = event.contextId ?? remoteContextId;
    remoteTaskId = event.taskId ?? remoteTaskId;
  }

  return {
    finalText: finalText.trim() || "Task completed.",
    metadata: {
      agentId: input.agent.id,
      agentType: "a2a_remote",
      remoteContextId,
      remoteTaskId,
    },
  };
}

class WavePublishedA2AExecutor implements AgentExecutor {
  private readonly activeControllers = new Map<string, AbortController>();

  constructor(
    private readonly agentId: string,
    private readonly taskStore: TaskStore,
  ) {}

  async cancelTask(taskId: string): Promise<void> {
    this.activeControllers.get(taskId)?.abort();
  }

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const abortController = new AbortController();
    this.activeControllers.set(requestContext.taskId, abortController);

    try {
      const agent = await agentRepository.selectAgentByIdForMcp(this.agentId);
      if (!agent || !agent.a2aEnabled) {
        throw new Error("A2A publishing is not enabled for this agent.");
      }

      if (!requestContext.task) {
        eventBus.publish(buildInitialTask({ requestContext, agent }));
      }

      eventBus.publish(
        buildFinalStatusEvent({
          taskId: requestContext.taskId,
          contextId: requestContext.contextId,
          state: "working",
          final: false,
        }),
      );

      let result:
        | Awaited<ReturnType<typeof streamStandardAgentRun>>
        | Awaited<ReturnType<typeof streamSnowflakeAgentRun>>
        | Awaited<ReturnType<typeof streamRemoteA2AAgentRun>>;

      switch (normalizeAgentType(agent)) {
        case "snowflake_cortex":
          result = await streamSnowflakeAgentRun({
            agent,
            requestContext,
            abortSignal: abortController.signal,
            eventBus,
          });
          break;
        case "a2a_remote":
          result = await streamRemoteA2AAgentRun({
            agent,
            requestContext,
            abortSignal: abortController.signal,
            eventBus,
          });
          break;
        default:
          result = await streamStandardAgentRun({
            agent,
            requestContext,
            abortSignal: abortController.signal,
            eventBus,
          });
          break;
      }

      eventBus.publish(
        buildFinalStatusEvent({
          taskId: requestContext.taskId,
          contextId: requestContext.contextId,
          state: "completed",
          final: true,
        }),
      );
      eventBus.finished();

      await persistTaskCompletion({
        taskStore: this.taskStore,
        taskId: requestContext.taskId,
        finalText: result.finalText,
        metadata: result.metadata,
        contextId: requestContext.contextId,
      });
    } catch (error) {
      const isAborted = abortController.signal.aborted;
      logger.error(error);

      eventBus.publish(
        buildFinalStatusEvent({
          taskId: requestContext.taskId,
          contextId: requestContext.contextId,
          state: isAborted ? "canceled" : "failed",
          final: true,
          message: isAborted
            ? "Task canceled."
            : error instanceof Error
              ? error.message
              : "Task failed.",
        }),
      );
      eventBus.finished();
    } finally {
      this.activeControllers.delete(requestContext.taskId);
    }
  }
}

function getOrCreatePublishedAgentRuntime(
  agentId: string,
): PublishedAgentRuntime {
  const existing = publishedAgentRuntimeMap.get(agentId);
  if (existing) return existing;

  const taskStore = new InMemoryTaskStore();
  const runtime = {
    taskStore,
    executor: new WavePublishedA2AExecutor(agentId, taskStore),
  };
  publishedAgentRuntimeMap.set(agentId, runtime);
  return runtime;
}

export async function authenticatePublishedA2ARequest(
  headers: Headers,
  agentId: string,
) {
  const authHeader = headers.get("authorization");
  if (!authHeader?.trim()) return false;

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const agentInfo = await agentRepository.getAgentByA2aKey(agentId);
  if (!agentInfo?.a2aEnabled || !agentInfo.a2aApiKeyHash) {
    return false;
  }

  return compare(token, agentInfo.a2aApiKeyHash);
}

export async function loadPublishedA2AAgent(agentId: string) {
  const agent = await agentRepository.selectAgentByIdForMcp(agentId);
  if (!agent || !agent.a2aEnabled) {
    return null;
  }

  return agent;
}

export function buildPublishedA2AAgentCard(input: {
  agent: Agent;
  origin: string;
  remoteConfig?: A2AAgentConfig | null;
}): AgentCard {
  const rpcUrl = `${input.origin}/api/a2a/agent/${input.agent.id}`;
  const streamUrl = `${rpcUrl}/stream`;
  const remoteCard = input.remoteConfig?.agentCard;
  const name = input.agent.name || remoteCard?.name || "Wave Agent";
  const description =
    input.agent.description ||
    remoteCard?.description ||
    `Published Wave agent wrapper for ${name}.`;

  return {
    name,
    description,
    protocolVersion: A2A_PROTOCOL_VERSION,
    version: remoteCard?.version || "1.0.0",
    url: rpcUrl,
    preferredTransport: "JSONRPC",
    skills:
      normalizeAgentType(input.agent) === "a2a_remote" &&
      remoteCard?.skills?.length
        ? normalizeAgentSkills(remoteCard.skills)
        : [buildAgentSkill(input.agent)],
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: remoteCard?.defaultInputModes ?? ["text"],
    defaultOutputModes: remoteCard?.defaultOutputModes ?? ["text"],
    additionalInterfaces: [{ transport: "JSONRPC", url: streamUrl }],
    iconUrl: buildCardIconUrl(input.agent, remoteCard),
    documentationUrl: remoteCard?.documentationUrl,
    provider: remoteCard?.provider,
    ...(input.agent.a2aEnabled
      ? {
          securitySchemes: {
            [A2A_SECURITY_SCHEME_NAME]: {
              type: "http",
              scheme: "Bearer",
              bearerFormat: "API Key",
              description: "Use the Wave A2A API key as a bearer token.",
            },
          },
          security: [{ [A2A_SECURITY_SCHEME_NAME]: [] }],
        }
      : {}),
  };
}

function formatSseEvent(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function isAsyncGenerator(
  value: JSONRPCResponse | AsyncGenerator<JSONRPCResponse, void, undefined>,
): value is AsyncGenerator<JSONRPCResponse, void, undefined> {
  return (
    typeof (value as AsyncGenerator<JSONRPCResponse>)?.[
      Symbol.asyncIterator
    ] === "function"
  );
}

async function createPublishedRequestHandler(input: {
  agent: Agent;
  origin: string;
}) {
  const runtime = getOrCreatePublishedAgentRuntime(input.agent.id);
  const remoteConfig =
    normalizeAgentType(input.agent) === "a2a_remote"
      ? await a2aAgentRepository.selectA2AConfigByAgentId(input.agent.id)
      : null;
  const card = buildPublishedA2AAgentCard({
    agent: input.agent,
    origin: input.origin,
    remoteConfig,
  });

  return new DefaultRequestHandler(card, runtime.taskStore, runtime.executor);
}

export async function buildPublishedA2ACardForRequest(
  agentId: string,
  request: Request,
) {
  const agent = await loadPublishedA2AAgent(agentId);
  if (!agent) return null;

  const origin = new URL(request.url).origin;
  const remoteConfig =
    normalizeAgentType(agent) === "a2a_remote"
      ? await a2aAgentRepository.selectA2AConfigByAgentId(agent.id)
      : null;

  return buildPublishedA2AAgentCard({ agent, origin, remoteConfig });
}

export async function handlePublishedA2AJsonRpcRequest(input: {
  agentId: string;
  request: Request;
}) {
  const agent = await loadPublishedA2AAgent(input.agentId);
  if (!agent) {
    return Response.json({ error: "A2A agent not found" }, { status: 404 });
  }

  const isAuthorized = await authenticatePublishedA2ARequest(
    input.request.headers,
    input.agentId,
  );
  if (!isAuthorized) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await input.request.json();
  const handler = await createPublishedRequestHandler({
    agent,
    origin: new URL(input.request.url).origin,
  });
  const transport = new JsonRpcTransportHandler(handler);
  const responseOrStream = await transport.handle(body);

  if (isAsyncGenerator(responseOrStream)) {
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of responseOrStream) {
            controller.enqueue(formatSseEvent(event));
          }
        } catch (error) {
          controller.enqueue(
            formatSseEvent({
              jsonrpc: "2.0",
              id: body?.id ?? null,
              error: {
                code: -32603,
                message:
                  error instanceof Error ? error.message : "Streaming failed",
              },
            }),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: A2A_SSE_HEADERS,
    });
  }

  return Response.json(responseOrStream, { status: 200 });
}
