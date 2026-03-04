import { NextRequest, NextResponse } from "next/server";
import { knowledgeRepository } from "lib/db/repository";
import { queryKnowledgeAsText } from "lib/knowledge/retriever";
import { compare } from "bcrypt-ts";
import { z } from "zod";

interface Params {
  params: Promise<{ groupId: string }>;
}

async function authenticate(
  req: NextRequest,
  groupId: string,
): Promise<boolean> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;

  const rawKey = authHeader.slice(7);
  const groupInfo = await knowledgeRepository.getGroupByMcpKey(groupId);
  if (!groupInfo || !groupInfo.mcpEnabled || !groupInfo.mcpApiKeyHash)
    return false;

  return compare(rawKey, groupInfo.mcpApiKeyHash);
}

const TOOLS = (groupName: string) => [
  {
    name: "query_knowledge",
    description: `Search the "${groupName}" knowledge base for relevant information`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        topN: {
          type: "number",
          description: "Number of results (default: 10)",
          minimum: 1,
          maximum: 20,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_documents",
    description: `List all documents in the "${groupName}" knowledge base`,
    inputSchema: { type: "object", properties: {} },
  },
];

function jsonRpcError(id: unknown, code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } });
}

function jsonRpcResult(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, result });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { groupId } = await params;

  const isAuthorized = await authenticate(req, groupId);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const group = await knowledgeRepository.selectGroupById(groupId, "");
  if (!group || !group.mcpEnabled) {
    return NextResponse.json(
      { error: "MCP not enabled for this knowledge group" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  const {
    id,
    method,
    params: reqParams,
  } = body as { id: unknown; method: string; params?: unknown };

  if (method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: `contextx-${groupId}`, version: "1.0.0" },
    });
  }

  if (method === "tools/list") {
    return jsonRpcResult(id, { tools: TOOLS(group.name) });
  }

  if (method === "tools/call") {
    const { name, arguments: args } = reqParams as {
      name: string;
      arguments: unknown;
    };

    if (name === "query_knowledge") {
      const parsed = z
        .object({ query: z.string(), topN: z.number().optional() })
        .parse(args);
      const result = await queryKnowledgeAsText(group, parsed.query, {
        topN: parsed.topN ?? 10,
        source: "mcp",
      });
      return jsonRpcResult(id, { content: [{ type: "text", text: result }] });
    }

    if (name === "list_documents") {
      const docs = await knowledgeRepository.selectDocumentsByGroupId(groupId);
      const list = docs
        .map(
          (d) =>
            `- **${d.name}** (${d.fileType.toUpperCase()}, ${d.status}, ${d.chunkCount} chunks)`,
        )
        .join("\n");
      return jsonRpcResult(id, {
        content: [
          {
            type: "text",
            text: `Documents in "${group.name}":\n\n${list || "No documents found"}`,
          },
        ],
      });
    }

    return jsonRpcError(id, -32601, `Unknown tool: ${name}`);
  }

  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

export async function GET(req: NextRequest, { params }: Params) {
  const { groupId } = await params;

  const isAuthorized = await authenticate(req, groupId);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const group = await knowledgeRepository.selectGroupById(groupId, "");
  if (!group || !group.mcpEnabled) {
    return NextResponse.json({ error: "MCP not enabled" }, { status: 403 });
  }

  return NextResponse.json({
    name: `contextx-${groupId}`,
    version: "1.0.0",
    description: `ContextX MCP server for "${group.name}"`,
    tools: TOOLS(group.name),
  });
}
