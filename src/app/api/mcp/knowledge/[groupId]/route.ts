import { NextRequest, NextResponse } from "next/server";
import { knowledgeRepository } from "lib/db/repository";
import {
  queryKnowledgeAsDocs,
  formatDocsAsText,
} from "lib/knowledge/retriever";
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
    name: "get_docs",
    description: `Get documentation from the "${groupName}" knowledge base. Uses semantic search (embedding + BM25 + reranking) to identify the most relevant documents, then returns their full markdown content. Use this to find comprehensive information from the knowledge base.`,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to find relevant documents",
        },
        tokens: {
          type: "number",
          description:
            "Maximum token budget for the response (default: 10000). Higher values return more content.",
          minimum: 500,
          maximum: 50000,
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

    if (name === "get_docs") {
      const parsed = z
        .object({
          query: z.string(),
          tokens: z.number().min(500).max(50000).optional(),
        })
        .parse(args);
      const docs = await queryKnowledgeAsDocs(group, parsed.query, {
        tokens: parsed.tokens ?? 10000,
        source: "mcp",
      });
      const text = formatDocsAsText(group.name, docs, parsed.query);
      return jsonRpcResult(id, { content: [{ type: "text", text }] });
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
