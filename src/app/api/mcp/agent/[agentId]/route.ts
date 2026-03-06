import {
  buildAgentSkillsSystemPrompt,
  buildParallelSubAgentSystemPrompt,
  buildUserSystemPrompt,
} from "lib/ai/prompts";
import { loadSubAgentTools } from "lib/ai/agent/subagent-loader";
import {
  loadAppDefaultTools,
  loadMcpTools,
  loadWorkFlowTools,
  mergeSystemPrompt,
} from "@/app/api/chat/shared.chat";
import {
  agentRepository,
  knowledgeRepository,
  settingsRepository,
  skillRepository,
  subAgentRepository,
} from "lib/db/repository";
import {
  createKnowledgeDocsTool,
  knowledgeDocsToolName,
} from "lib/ai/tools/knowledge-tool";
import {
  createLoadSkillTool,
  LOAD_SKILL_TOOL_NAME,
} from "lib/ai/tools/skill-tool";
import { getDbModel } from "lib/ai/provider-factory";
import { compare } from "bcrypt-ts";
import type { ChatModel } from "app-types/chat";
import {
  generateText,
  ModelMessage,
  stepCountIs,
  Tool,
  UIMessageStreamWriter,
} from "ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

interface Params {
  params: Promise<{ agentId: string }>;
}

const TOOL_RUN_AGENT = "wave_run_agent";
const MCP_PROTOCOL_VERSION = "2024-11-05";

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

const waveRunAgentSchema = z.object({
  task: z.string().min(1),
  messages: z.array(messageSchema).optional().default([]),
});

const WAVE_RUN_AGENT_TOOL = {
  name: TOOL_RUN_AGENT,
  description:
    "Run this Wave base agent with its configured capabilities (subagents, workflows, default tools, MCP tools, knowledge, and skills).",
  inputSchema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "The task or prompt to run with this Wave agent.",
      },
      messages: {
        type: "array",
        description:
          "Optional prior conversation history to provide additional context.",
        items: {
          type: "object",
          properties: {
            role: {
              type: "string",
              enum: ["user", "assistant", "system"],
            },
            content: {
              type: "string",
            },
          },
          required: ["role", "content"],
          additionalProperties: false,
        },
      },
    },
    required: ["task"],
    additionalProperties: false,
  },
} as const;

type JsonRpcResponsePayload =
  | { jsonrpc: "2.0"; id: unknown; result: unknown }
  | { jsonrpc: "2.0"; id: unknown; error: { code: number; message: string } };

type ActiveSseSession = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  keepAlive: ReturnType<typeof setInterval>;
};

const sseSessions = new Map<string, ActiveSseSession>();
const sseEncoder = new TextEncoder();
const SSE_KEEPALIVE_MS = 15000;

function jsonRpcErrorPayload(
  id: unknown,
  code: number,
  message: string,
): JsonRpcResponsePayload {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function jsonRpcResultPayload(
  id: unknown,
  result: unknown,
): JsonRpcResponsePayload {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcResponse(payload: JsonRpcResponsePayload) {
  return NextResponse.json(payload, {
    headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
  });
}

function acceptedResponse() {
  return new NextResponse(null, {
    status: 202,
    headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
  });
}

function encodeSseBlock(input: {
  event?: string;
  data?: string;
  comment?: string;
}): Uint8Array {
  const lines: string[] = [];

  if (input.comment) {
    lines.push(`: ${input.comment}`);
  }

  if (input.event) {
    lines.push(`event: ${input.event}`);
  }

  if (typeof input.data === "string") {
    for (const line of input.data.split(/\r?\n/)) {
      lines.push(`data: ${line}`);
    }
  }

  lines.push("");
  return sseEncoder.encode(`${lines.join("\n")}\n`);
}

function cleanupSseSession(sessionId: string) {
  const session = sseSessions.get(sessionId);
  if (!session) return;
  clearInterval(session.keepAlive);
  sseSessions.delete(sessionId);
}

function sendSseEndpointEvent(sessionId: string, endpoint: string): boolean {
  const session = sseSessions.get(sessionId);
  if (!session) return false;

  try {
    session.controller.enqueue(
      encodeSseBlock({
        event: "endpoint",
        data: endpoint,
      }),
    );
    return true;
  } catch {
    cleanupSseSession(sessionId);
    return false;
  }
}

function sendSseRpcMessage(
  sessionId: string,
  payload: JsonRpcResponsePayload,
): boolean {
  const session = sseSessions.get(sessionId);
  if (!session) return false;

  try {
    session.controller.enqueue(
      encodeSseBlock({
        data: JSON.stringify(payload),
      }),
    );
    return true;
  } catch {
    cleanupSseSession(sessionId);
    return false;
  }
}

async function authenticate(
  req: NextRequest,
  agentId: string,
): Promise<boolean> {
  const rawWaveAgentKey =
    req.headers.get("emma_agent_key") ||
    req.headers.get("EMMA_AGENT_KEY") ||
    req.headers.get("wave_agent_api_key") ||
    req.headers.get("x-wave-agent-api-key");
  const waveAgentKey = rawWaveAgentKey?.trim();

  const authHeader = req.headers.get("authorization");
  const bearerKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  const rawKey = waveAgentKey || bearerKey;
  if (!rawKey) return false;

  const agentInfo = await agentRepository.getAgentByMcpKey(agentId);
  if (!agentInfo || !agentInfo.mcpApiKeyHash) {
    return false;
  }

  return compare(rawKey, agentInfo.mcpApiKeyHash);
}

function isToolCapableLlmModel(candidate: {
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

async function resolveAgentMcpModel(agent: {
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

async function executeWaveRunAgent(
  input: z.infer<typeof waveRunAgentSchema>,
  {
    agentId,
    abortSignal,
  }: {
    agentId: string;
    abortSignal: AbortSignal;
  },
): Promise<string> {
  const agent = await agentRepository.selectAgentByIdForMcp(agentId);
  if (!agent) {
    throw new Error("Agent not found");
  }
  if (agent.agentType === "snowflake_cortex") {
    throw new Error("Snowflake agents are not supported on this endpoint");
  }
  if (!agent.mcpEnabled) {
    throw new Error("MCP is not enabled for this agent");
  }

  const chatModel = await resolveAgentMcpModel(agent);
  if (!chatModel) {
    throw new Error(
      "No enabled tool-capable chat model is configured. Configure one in Settings > AI Providers.",
    );
  }

  const dbModelResult = await getDbModel(chatModel);
  if (!dbModelResult) {
    throw new Error(
      "Configured chat model is not available. Verify provider key/model settings.",
    );
  }

  const toolMentions = agent.instructions?.mentions ?? [];
  const noopDataStream = {
    write() {},
    merge() {},
  } as unknown as UIMessageStreamWriter;

  const [mcpTools, workflowTools, appDefaultTools] = await Promise.all([
    loadMcpTools({ mentions: toolMentions }),
    loadWorkFlowTools({
      mentions: toolMentions,
      dataStream: noopDataStream,
    }),
    toolMentions.length
      ? loadAppDefaultTools({ mentions: toolMentions })
      : loadAppDefaultTools({ allowedAppDefaultToolkit: [] }),
  ]);

  const subAgents = agent.subAgentsEnabled
    ? await subAgentRepository.selectSubAgentsByAgentId(agent.id)
    : [];
  const subagentTools = agent.subAgentsEnabled
    ? await loadSubAgentTools(
        {
          ...agent,
          subAgents,
        },
        noopDataStream,
        abortSignal,
        chatModel,
      )
    : {};

  const knowledgeGroups = await knowledgeRepository.getGroupsByAgentId(
    agent.id,
  );
  const knowledgeTools = knowledgeGroups.reduce(
    (acc, group) => {
      acc[knowledgeDocsToolName(group.id)] = createKnowledgeDocsTool(group, {
        userId: agent.userId,
        source: "mcp",
      });
      return acc;
    },
    {} as Record<string, Tool>,
  );

  const attachedSkills = await skillRepository.getSkillsByAgentId(agent.id);
  const skillTools: Record<string, Tool> = attachedSkills.length
    ? {
        [LOAD_SKILL_TOOL_NAME]: createLoadSkillTool(attachedSkills),
      }
    : {};

  const systemPrompt = mergeSystemPrompt(
    buildUserSystemPrompt(undefined, undefined, agent),
    buildParallelSubAgentSystemPrompt(subAgents),
    buildAgentSkillsSystemPrompt(attachedSkills),
  );

  const modelMessages: ModelMessage[] = [
    ...input.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    {
      role: "user",
      content: input.task,
    },
  ];

  const result = await generateText({
    model: dbModelResult.model,
    system: systemPrompt,
    messages: modelMessages,
    tools: {
      ...mcpTools,
      ...workflowTools,
      ...subagentTools,
      ...knowledgeTools,
      ...skillTools,
      ...appDefaultTools,
    },
    stopWhen: stepCountIs(10),
    toolChoice: "auto",
    maxRetries: 2,
    abortSignal,
  });

  const finalText = result.text?.trim();
  return finalText || "Task completed.";
}

async function handleJsonRpcRequest(
  agentId: string,
  body: unknown,
  abortSignal: AbortSignal,
): Promise<JsonRpcResponsePayload | null> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonRpcErrorPayload(null, -32600, "Invalid Request");
  }

  const hasId = Object.prototype.hasOwnProperty.call(body, "id");
  const {
    id,
    method,
    params: reqParams,
  } = body as { id: unknown; method?: unknown; params?: unknown };

  if (typeof method !== "string") {
    return jsonRpcErrorPayload(hasId ? id : null, -32600, "Invalid Request");
  }

  if (method === "notifications/initialized") {
    return null;
  }

  if (method === "ping") {
    return jsonRpcResultPayload(id, {});
  }

  if (method === "initialize") {
    return jsonRpcResultPayload(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: `wave-agent-${agentId}`, version: "1.0.0" },
    });
  }

  if (method === "tools/list") {
    return jsonRpcResultPayload(id, { tools: [WAVE_RUN_AGENT_TOOL] });
  }

  if (method === "tools/call") {
    const callRequest = z
      .object({
        name: z.string(),
        arguments: z.unknown().optional(),
      })
      .parse(reqParams);

    if (callRequest.name !== TOOL_RUN_AGENT) {
      return jsonRpcErrorPayload(
        id,
        -32601,
        `Unknown tool: ${callRequest.name}`,
      );
    }

    const parsedInput = waveRunAgentSchema.parse(callRequest.arguments ?? {});
    const text = await executeWaveRunAgent(parsedInput, {
      agentId,
      abortSignal,
    });

    return jsonRpcResultPayload(id, {
      content: [
        {
          type: "text",
          text,
        },
      ],
    });
  }

  if (!hasId) {
    return null;
  }

  return jsonRpcErrorPayload(id, -32601, `Method not found: ${method}`);
}

export async function POST(req: NextRequest, { params }: Params) {
  const { agentId } = await params;

  const isAuthorized = await authenticate(req, agentId);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agent = await agentRepository.selectAgentByIdForMcp(agentId);
  if (!agent || !agent.mcpEnabled || agent.agentType === "snowflake_cortex") {
    return NextResponse.json(
      { error: "MCP not enabled for this base agent" },
      { status: 403 },
    );
  }

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (sessionId && !sseSessions.has(sessionId)) {
    return NextResponse.json(
      { error: "SSE session not found" },
      { status: 404 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const payload = jsonRpcErrorPayload(null, -32700, "Parse error");
    if (sessionId) {
      sendSseRpcMessage(sessionId, payload);
      return acceptedResponse();
    }
    return jsonRpcResponse(payload);
  }

  let payload: JsonRpcResponsePayload | null;
  try {
    payload = await handleJsonRpcRequest(agentId, body, req.signal);
  } catch (error: any) {
    const id =
      body && typeof body === "object" && !Array.isArray(body) && "id" in body
        ? (body as { id: unknown }).id
        : null;
    if (error instanceof z.ZodError) {
      payload = jsonRpcErrorPayload(
        id,
        -32602,
        `Invalid params: ${error.issues.map((issue) => issue.message).join("; ")}`,
      );
    } else {
      payload = jsonRpcErrorPayload(
        id,
        -32603,
        error?.message || "Internal error",
      );
    }
  }

  if (sessionId) {
    if (payload && !sendSseRpcMessage(sessionId, payload)) {
      return NextResponse.json(
        { error: "Failed to deliver SSE response" },
        { status: 410 },
      );
    }
    return acceptedResponse();
  }

  if (!payload) {
    return acceptedResponse();
  }

  return jsonRpcResponse(payload);
}

export async function GET(req: NextRequest, { params }: Params) {
  const { agentId } = await params;

  const isAuthorized = await authenticate(req, agentId);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agent = await agentRepository.selectAgentByIdForMcp(agentId);
  if (!agent || !agent.mcpEnabled || agent.agentType === "snowflake_cortex") {
    return NextResponse.json({ error: "MCP not enabled" }, { status: 403 });
  }

  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream")) {
    const sessionId = crypto.randomUUID();
    const endpoint = `${req.nextUrl.pathname}?sessionId=${sessionId}`;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const keepAlive = setInterval(() => {
          try {
            controller.enqueue(encodeSseBlock({ comment: "keepalive" }));
          } catch {
            cleanupSseSession(sessionId);
          }
        }, SSE_KEEPALIVE_MS);

        sseSessions.set(sessionId, { controller, keepAlive });
        if (!sendSseEndpointEvent(sessionId, endpoint)) {
          cleanupSseSession(sessionId);
          try {
            controller.close();
          } catch {}
        }
      },
      cancel() {
        cleanupSseSession(sessionId);
      },
    });

    return new NextResponse(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      },
    });
  }

  return NextResponse.json({
    name: `wave-agent-${agentId}`,
    version: "1.0.0",
    description: `Wave MCP endpoint for "${agent.name}"`,
    tools: [WAVE_RUN_AGENT_TOOL],
  });
}
