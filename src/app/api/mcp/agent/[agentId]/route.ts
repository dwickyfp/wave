import { NextRequest, NextResponse } from "next/server";
import type { KnowledgeSummary } from "app-types/knowledge";
import type { SubAgent } from "app-types/subagent";
import { z } from "zod";
import {
  MCP_PRESENTATION_MODE_COPILOT_NATIVE,
  authenticateExternalAgentRequest,
  buildDynamicToolName,
  createUnauthorizedResponse,
  createProgressReporter,
  executeKnowledgeExternalTool,
  executeSubAgentExternalTool,
  executeEmmaRunAgent,
  executeWorkflowExternalTool,
  getAgentPresentationMode,
  getCopilotNativeMcpResources,
  knowledgeQuerySchema,
  loadExternalAccessAgent,
  type ExternalAccessAgent,
  emmaRunAgentSchema,
} from "lib/ai/agent/external-access";

interface Params {
  params: Promise<{ agentId: string }>;
}

const TOOL_RUN_AGENT = "emma_run_agent";
const MCP_PROTOCOL_VERSION = "2024-11-05";

type JsonRpcResponsePayload =
  | { jsonrpc: "2.0"; id: unknown; result: unknown }
  | { jsonrpc: "2.0"; id: unknown; error: { code: number; message: string } };

type JsonRpcNotificationPayload = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

type JsonRpcMessagePayload =
  | JsonRpcResponsePayload
  | JsonRpcNotificationPayload;

type ProgressToken = string | number;

type ActiveSseSession = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  keepAlive: ReturnType<typeof setInterval>;
};

type ToolExecutionContext = {
  agent: ExternalAccessAgent;
  abortSignal: AbortSignal;
  onProgress?: (progress: number, message: string) => void;
};

type McpRouteToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  validateInput?: (input: unknown) => unknown;
  execute: (input: unknown, context: ToolExecutionContext) => Promise<string>;
};

const WAVE_RUN_AGENT_TOOL = {
  name: TOOL_RUN_AGENT,
  description:
    "Run this Emma base agent with its configured capabilities (subagents, workflows, default tools, MCP tools, knowledge, and skills). In Copilot Native mode, prefer direct emma_subagent_*, emma_workflow_*, and emma_knowledge_* tools when you want separate top-level tool sections. For coding workflows, pass file context and optionally request unified_diff output so Copilot can apply changes with native file tools.",
  inputSchema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "The task or prompt to run with this Emma agent.",
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
      files: {
        type: "array",
        description:
          "Optional file context to help coding tasks (for example files read from workspace by Copilot).",
        items: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Workspace path for the file.",
            },
            content: {
              type: "string",
              description: "Current file content.",
            },
            language: {
              type: "string",
              description: "Optional language hint (for example python).",
            },
          },
          required: ["path", "content"],
          additionalProperties: false,
        },
      },
      responseMode: {
        type: "string",
        enum: ["text", "unified_diff"],
        description:
          "Response format. Use unified_diff for patch output that can be applied to files.",
      },
    },
    required: ["task"],
    additionalProperties: false,
  },
} as const;

const sseSessions = new Map<string, ActiveSseSession>();
const inFlightRequests = new Map<string, AbortController>();
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

function mcpSseHeaders() {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "mcp-protocol-version": MCP_PROTOCOL_VERSION,
  };
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
  payload: JsonRpcMessagePayload,
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

function createStreamablePostSseResponse(
  execute: (send: (payload: JsonRpcMessagePayload) => void) => Promise<void>,
) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encodeSseBlock({ comment: "keepalive" }));
        } catch {}
      }, SSE_KEEPALIVE_MS);

      const send = (payload: JsonRpcMessagePayload) => {
        try {
          controller.enqueue(
            encodeSseBlock({
              data: JSON.stringify(payload),
            }),
          );
        } catch {}
      };

      void (async () => {
        try {
          await execute(send);
        } finally {
          clearInterval(keepAlive);
          try {
            controller.close();
          } catch {}
        }
      })();
    },
    cancel() {},
  });

  return new NextResponse(stream, {
    headers: mcpSseHeaders(),
  });
}

function getInFlightRequestKey(agentId: string, requestId: unknown): string {
  return `${agentId}:${JSON.stringify(requestId)}`;
}

function extractProgressToken(reqParams: unknown): ProgressToken | undefined {
  if (!reqParams || typeof reqParams !== "object" || Array.isArray(reqParams)) {
    return;
  }

  const meta =
    "_meta" in reqParams ? (reqParams as { _meta?: unknown })._meta : undefined;

  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return;
  }

  const progressToken =
    "progressToken" in meta
      ? (meta as { progressToken?: unknown }).progressToken
      : undefined;

  if (typeof progressToken === "string" || typeof progressToken === "number") {
    return progressToken;
  }
}

async function buildMcpToolRegistry(
  agent: ExternalAccessAgent,
): Promise<Map<string, McpRouteToolDefinition>> {
  const registry = new Map<string, McpRouteToolDefinition>();
  const usedNames = new Set<string>([TOOL_RUN_AGENT]);

  registry.set(TOOL_RUN_AGENT, {
    ...WAVE_RUN_AGENT_TOOL,
    validateInput: (input) => emmaRunAgentSchema.parse(input),
    execute: (input, context) =>
      executeEmmaRunAgent(input as z.infer<typeof emmaRunAgentSchema>, context),
  });

  if (
    getAgentPresentationMode(agent) !== MCP_PRESENTATION_MODE_COPILOT_NATIVE
  ) {
    return registry;
  }

  const { subAgents, workflows, knowledgeGroups } =
    await getCopilotNativeMcpResources(agent);

  subAgents
    .filter((subagent) => subagent.enabled)
    .forEach((subagent: SubAgent) => {
      const toolName = buildDynamicToolName(
        "emma_subagent",
        subagent.name,
        subagent.id,
        usedNames,
      );

      registry.set(toolName, {
        name: toolName,
        description:
          subagent.description?.trim() ||
          `Run the ${subagent.name} Emma subagent directly. Use this instead of emma_run_agent when you want a dedicated Copilot tool section.`,
        inputSchema: WAVE_RUN_AGENT_TOOL.inputSchema,
        validateInput: (input) => emmaRunAgentSchema.parse(input),
        execute: (input, context) =>
          executeSubAgentExternalTool(subagent, input, context),
      });
    });

  workflows.forEach((workflow) => {
    const toolName = buildDynamicToolName(
      "emma_workflow",
      workflow.name,
      workflow.id,
      usedNames,
    );

    registry.set(toolName, {
      name: toolName,
      description:
        workflow.description?.trim() ||
        `Run the ${workflow.name} workflow directly on the Emma server.`,
      inputSchema: workflow.schema as Record<string, unknown>,
      validateInput: (input) => {
        if (!input || typeof input !== "object" || Array.isArray(input)) {
          return {};
        }
        return input;
      },
      execute: (input, context) =>
        executeWorkflowExternalTool(
          {
            ...workflow,
            schema: workflow.schema as Record<string, unknown>,
          },
          input,
          context,
        ),
    });
  });

  knowledgeGroups.forEach((group: KnowledgeSummary) => {
    const toolName = buildDynamicToolName(
      "emma_knowledge",
      group.name,
      group.id,
      usedNames,
    );

    registry.set(toolName, {
      name: toolName,
      description:
        group.description?.trim() ||
        `Search the ${group.name} knowledge base directly from Emma.`,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to run against this knowledge base.",
          },
          tokens: {
            type: "number",
            description: "Optional token budget for returned document content.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      validateInput: (input) => knowledgeQuerySchema.parse(input),
      execute: (input, context) =>
        executeKnowledgeExternalTool(group, input, context),
    });
  });

  return registry;
}

async function handleJsonRpcRequest(
  agentId: string,
  agent: ExternalAccessAgent,
  body: unknown,
  context: {
    abortSignal: AbortSignal;
    sendNotification?: (payload: JsonRpcNotificationPayload) => void;
  },
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

  if (method === "notifications/cancelled") {
    const params = z
      .object({
        requestId: z.unknown().optional(),
        reason: z.string().optional(),
      })
      .catch({ requestId: undefined, reason: undefined })
      .parse(reqParams);

    if (params.requestId !== undefined) {
      const key = getInFlightRequestKey(agentId, params.requestId);
      const requestController = inFlightRequests.get(key);
      if (requestController) {
        requestController.abort(
          params.reason
            ? new Error(params.reason)
            : new Error("Cancelled by MCP client"),
        );
      }
    }

    return null;
  }

  if (method === "ping") {
    return jsonRpcResultPayload(id, {});
  }

  if (method === "initialize") {
    return jsonRpcResultPayload(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: `emma-agent-${agentId}`, version: "1.0.0" },
    });
  }

  if (method === "tools/list") {
    const toolRegistry = await buildMcpToolRegistry(agent);
    return jsonRpcResultPayload(id, {
      tools: Array.from(toolRegistry.values()).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
  }

  if (method === "tools/call") {
    const callRequest = z
      .object({
        name: z.string(),
        arguments: z.unknown().optional(),
        _meta: z
          .object({
            progressToken: z.union([z.string(), z.number()]).optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .parse(reqParams);

    const toolRegistry = await buildMcpToolRegistry(agent);
    const selectedTool = toolRegistry.get(callRequest.name);
    if (!selectedTool) {
      return jsonRpcErrorPayload(
        id,
        -32601,
        `Unknown tool: ${callRequest.name}`,
      );
    }

    const progressToken =
      callRequest._meta?.progressToken ?? extractProgressToken(reqParams);
    const reportProgress = createProgressReporter({
      progressToken,
      emit: context.sendNotification,
    });

    const requestAbortController = new AbortController();
    if (context.abortSignal.aborted) {
      requestAbortController.abort(context.abortSignal.reason);
    } else {
      context.abortSignal.addEventListener(
        "abort",
        () => {
          requestAbortController.abort(context.abortSignal.reason);
        },
        { once: true },
      );
    }

    const requestKey = hasId ? getInFlightRequestKey(agentId, id) : null;
    if (requestKey) {
      inFlightRequests.set(requestKey, requestAbortController);
    }

    const parsedInput = selectedTool.validateInput
      ? selectedTool.validateInput(callRequest.arguments ?? {})
      : (callRequest.arguments ?? {});

    let text = "";
    try {
      text = await selectedTool.execute(parsedInput, {
        agent,
        abortSignal: requestAbortController.signal,
        onProgress: reportProgress,
      });
    } finally {
      if (requestKey) {
        inFlightRequests.delete(requestKey);
      }
    }

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

  const isAuthorized = await authenticateExternalAgentRequest(
    req.headers,
    agentId,
  );
  if (!isAuthorized) {
    return createUnauthorizedResponse();
  }

  const agent = await loadExternalAccessAgent(agentId);
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

  const supportsStreamableSse =
    !sessionId &&
    (req.headers.get("accept") ?? "").includes("text/event-stream");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const payload = jsonRpcErrorPayload(null, -32700, "Parse error");
    if (sessionId) {
      sendSseRpcMessage(sessionId, payload);
      return acceptedResponse();
    }
    if (supportsStreamableSse) {
      return createStreamablePostSseResponse(async (send) => {
        send(payload);
      });
    }
    return jsonRpcResponse(payload);
  }

  if (sessionId) {
    let payload: JsonRpcResponsePayload | null;
    try {
      payload = await handleJsonRpcRequest(agentId, agent, body, {
        abortSignal: req.signal,
        sendNotification: (notification) => {
          if (!sendSseRpcMessage(sessionId, notification)) {
            throw new Error("Failed to deliver SSE notification");
          }
        },
      });
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

    if (payload && !sendSseRpcMessage(sessionId, payload)) {
      return NextResponse.json(
        { error: "Failed to deliver SSE response" },
        { status: 410 },
      );
    }
    return acceptedResponse();
  }

  if (supportsStreamableSse) {
    return createStreamablePostSseResponse(async (send) => {
      let payload: JsonRpcResponsePayload | null;
      try {
        payload = await handleJsonRpcRequest(agentId, agent, body, {
          abortSignal: req.signal,
          sendNotification: send,
        });
      } catch (error: any) {
        const id =
          body &&
          typeof body === "object" &&
          !Array.isArray(body) &&
          "id" in body
            ? (body as { id: unknown }).id
            : null;

        if (error instanceof z.ZodError) {
          payload = jsonRpcErrorPayload(
            id,
            -32602,
            `Invalid params: ${error.issues
              .map((issue) => issue.message)
              .join("; ")}`,
          );
        } else {
          payload = jsonRpcErrorPayload(
            id,
            -32603,
            error?.message || "Internal error",
          );
        }
      }

      if (payload) {
        send(payload);
      }
    });
  }

  let payload: JsonRpcResponsePayload | null;
  try {
    payload = await handleJsonRpcRequest(agentId, agent, body, {
      abortSignal: req.signal,
    });
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

  if (!payload) {
    return acceptedResponse();
  }

  return jsonRpcResponse(payload);
}

export async function GET(req: NextRequest, { params }: Params) {
  const { agentId } = await params;

  const isAuthorized = await authenticateExternalAgentRequest(
    req.headers,
    agentId,
  );
  if (!isAuthorized) {
    return createUnauthorizedResponse();
  }

  const agent = await loadExternalAccessAgent(agentId);
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
      headers: mcpSseHeaders(),
    });
  }

  return NextResponse.json({
    name: `emma-agent-${agentId}`,
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: {} },
  });
}
