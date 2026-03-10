import { compare } from "bcrypt-ts";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type {
  CallToolResult,
  MCPToolInfo,
  McpServerSelect,
} from "app-types/mcp";
import { mcpClientsManager } from "lib/ai/mcp/mcp-manager";
import { BASE_URL } from "lib/const";

const LOCAL_ORIGINS = new Set([BASE_URL]);

function normalizeTextValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeInputSchema(tool: MCPToolInfo) {
  if (!tool.inputSchema) {
    return {
      type: "object",
      properties: {},
      additionalProperties: false,
    };
  }

  return {
    additionalProperties: false,
    ...tool.inputSchema,
    properties: tool.inputSchema.properties ?? {},
  };
}

function normalizeCallToolResult(
  result: CallToolResult | Record<string, unknown>,
) {
  const callResult = result as CallToolResult & {
    error?: { message?: string } | string;
  };

  const content = Array.isArray(callResult.content)
    ? callResult.content.map((item) => {
        if (item?.type === "text") {
          return {
            ...item,
            text: normalizeTextValue(item.text),
          };
        }

        return item;
      })
    : [];

  if (callResult.isError && content.length === 0) {
    const message =
      typeof callResult.error === "string"
        ? callResult.error
        : callResult.error?.message || "Upstream MCP tool call failed";

    return {
      content: [{ type: "text" as const, text: message }],
      isError: true,
    };
  }

  return {
    _meta: callResult._meta,
    content,
    structuredContent: callResult.structuredContent,
    isError: callResult.isError,
  };
}

function getExpectedOrigins(requestUrl: string) {
  const origins = new Set<string>();

  try {
    origins.add(new URL(requestUrl).origin);
  } catch {}

  try {
    origins.add(new URL(BASE_URL).origin);
  } catch {}

  LOCAL_ORIGINS.forEach((origin) => {
    try {
      origins.add(new URL(origin).origin);
    } catch {}
  });

  return origins;
}

function extractBearerToken(headers: Headers): string | null {
  const authorization = headers.get("authorization")?.trim();
  if (!authorization) return null;

  const matched = authorization.match(/^Bearer\s+(.+)$/i);
  return matched?.[1]?.trim() || null;
}

export function validatePublishedMcpOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin")?.trim();
  if (!origin) return null;

  const allowedOrigins = getExpectedOrigins(request.url);
  if (allowedOrigins.has(origin)) return null;

  return Response.json({ error: "Invalid origin" }, { status: 403 });
}

export async function authenticatePublishedMcpRequest(
  headers: Headers,
  server: McpServerSelect,
): Promise<boolean> {
  if (!server.publishEnabled) return false;
  if (server.publishAuthMode !== "bearer") return true;
  if (!server.publishApiKeyHash) return false;

  const token = extractBearerToken(headers);
  if (!token) return false;

  return compare(token, server.publishApiKeyHash);
}

export function createPublishedMcpUnauthorizedResponse(
  server: McpServerSelect,
) {
  const headers =
    server.publishAuthMode === "bearer"
      ? { "WWW-Authenticate": 'Bearer realm="mcp-published-server"' }
      : undefined;

  return Response.json({ error: "Unauthorized" }, { status: 401, headers });
}

async function resolvePublishedToolInfo(server: McpServerSelect) {
  const currentClient = await mcpClientsManager
    .getClient(server.id)
    .catch(() => null);

  if (
    currentClient?.client.status === "connected" &&
    currentClient.client.toolInfo.length > 0
  ) {
    return currentClient.client.toolInfo;
  }

  const refreshedClient = await mcpClientsManager
    .refreshClient(server.id)
    .catch(() => null);

  if (refreshedClient?.client.status === "connected") {
    if (refreshedClient.client.toolInfo.length > 0) {
      return refreshedClient.client.toolInfo;
    }
  }

  if (refreshedClient?.client.status === "authorizing") {
    throw new Error(
      "This MCP server requires owner authorization before it can be published.",
    );
  }

  if (Array.isArray(server.toolInfo) && server.toolInfo.length > 0) {
    return server.toolInfo;
  }

  throw new Error(
    "Published MCP server is unavailable because no tools are ready.",
  );
}

async function callPublishedTool(
  server: McpServerSelect,
  toolName: string,
  input: unknown,
) {
  const currentClient = await mcpClientsManager
    .getClient(server.id)
    .catch(() => null);

  if (currentClient?.client.status !== "connected") {
    const refreshedClient = await mcpClientsManager
      .refreshClient(server.id)
      .catch(() => null);

    if (refreshedClient?.client.status === "authorizing") {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "This MCP server requires owner authorization before it can be published.",
          },
        ],
      };
    }
  }

  return mcpClientsManager.toolCall(server.id, toolName, input);
}

export async function createPublishedMcpResponse(
  request: Request,
  server: McpServerSelect,
): Promise<Response> {
  const tools = await resolvePublishedToolInfo(server);

  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const mcpServer = new Server({
    name: `published-mcp-${server.id}`,
    version: "1.0.0",
  });

  mcpServer.registerCapabilities({
    tools: {
      listChanged: true,
    },
  });

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: normalizeInputSchema(tool),
    })),
  }));

  mcpServer.setRequestHandler(CallToolRequestSchema, async (rpcRequest) => {
    const requestedTool = toolMap.get(rpcRequest.params.name);

    if (!requestedTool) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Tool ${rpcRequest.params.name} not found`,
      );
    }

    const result = await callPublishedTool(
      server,
      requestedTool.name,
      rpcRequest.params.arguments,
    );

    return normalizeCallToolResult(result as CallToolResult);
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });

  await mcpServer.connect(transport);
  return transport.handleRequest(request);
}

export function buildPublishedMcpUrl(origin: string, id: string) {
  return `${origin.replace(/\/+$/, "")}/api/mcp/published/${id}`;
}
