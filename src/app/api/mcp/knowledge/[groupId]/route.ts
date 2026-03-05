import { compare } from "bcrypt-ts";
import { knowledgeRepository } from "lib/db/repository";
import {
  formatDocsAsText,
  queryKnowledge,
  queryKnowledgeAsDocs,
} from "lib/knowledge/retriever";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

interface Params {
  params: Promise<{ groupId: string }>;
}

type LibraryCandidate = {
  libraryId: string;
  score: number;
  hits: number;
  versions: string[];
  examples: string[];
};

const TOOL_RESOLVE_LIBRARY_ID = "resolve-library-id";
const TOOL_QUERY_DOCS = "query-docs";
const TOOL_GET_DOCS = "get_docs";
const MCP_PROTOCOL_VERSION = "2024-11-05";

const resolveLibraryIdSchema = z.object({
  query: z.string().min(1),
  libraryName: z.string().min(1),
  topK: z.number().int().min(1).max(10).optional(),
});

const queryDocsSchema = z.object({
  libraryId: z.string().min(1),
  query: z.string().min(1),
  version: z.string().optional(),
  tokens: z.number().min(500).max(50000).optional(),
  maxDocs: z.number().int().min(1).max(12).optional(),
});

async function authenticate(
  req: NextRequest,
  groupId: string,
): Promise<boolean> {
  const rawContextxApiKey =
    req.headers.get("contextx_api_key") ||
    req.headers.get("contextx-api-key") ||
    req.headers.get("x-contextx-api-key");
  const contextxApiKey = rawContextxApiKey?.trim();

  const authHeader = req.headers.get("authorization");
  const bearerKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  const rawKey = contextxApiKey || bearerKey;
  if (!rawKey) return false;

  const groupInfo = await knowledgeRepository.getGroupByMcpKey(groupId);
  if (!groupInfo || !groupInfo.mcpEnabled || !groupInfo.mcpApiKeyHash)
    return false;

  return compare(rawKey, groupInfo.mcpApiKeyHash);
}

function normalizeLibraryId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/\s+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/-+/g, "-");
}

function toCanonicalLibraryId(value: string): string {
  const normalized = normalizeLibraryId(value);
  return normalized ? `/${normalized}` : "";
}

function extractHeadingRoot(headingPath?: string): string | null {
  if (!headingPath) return null;
  const root = headingPath
    .split(">")
    .map((s) => s.trim())
    .find(Boolean);
  return root ?? null;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9./\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchSignal(
  libraryName: string,
  ...texts: Array<string | undefined>
): number {
  const name = normalizeText(libraryName);
  if (!name) return 0;

  const tokens = name.split(/[\s./-]+/).filter((t) => t.length >= 2);
  const haystack = normalizeText(texts.filter(Boolean).join(" "));
  if (!haystack) return 0;

  let score = 0;
  if (haystack.includes(name) || name.includes(haystack)) score += 0.8;
  if (tokens.length > 0) {
    const hits = tokens.filter((t) => haystack.includes(t)).length;
    score += (hits / tokens.length) * 0.8;
  }
  return Math.min(1.6, score);
}

function resolveCandidatesFromHits(
  hits: Awaited<ReturnType<typeof queryKnowledge>>,
  libraryName: string,
  topK: number,
): LibraryCandidate[] {
  const map = new Map<
    string,
    {
      score: number;
      hits: number;
      versions: Set<string>;
      examples: Set<string>;
    }
  >();

  for (const hit of hits) {
    const metadata = hit.chunk.metadata;
    const rawLibraryId =
      metadata?.libraryId || extractHeadingRoot(metadata?.headingPath);
    if (!rawLibraryId) continue;

    const canonicalId = toCanonicalLibraryId(rawLibraryId);
    if (!canonicalId) continue;

    const lexicalSignal = matchSignal(
      libraryName,
      canonicalId,
      hit.documentName,
      metadata?.headingPath,
      metadata?.sectionTitle,
      metadata?.section,
    );
    if (lexicalSignal < 0.12) continue;

    const weightedScore =
      Math.max(0, hit.rerankScore ?? hit.score) * (0.45 + lexicalSignal);
    const existing = map.get(canonicalId);
    if (existing) {
      existing.score += weightedScore;
      existing.hits += 1;
      if (metadata?.libraryVersion)
        existing.versions.add(metadata.libraryVersion);
      existing.examples.add(hit.documentName);
    } else {
      map.set(canonicalId, {
        score: weightedScore,
        hits: 1,
        versions: new Set(
          metadata?.libraryVersion ? [metadata.libraryVersion] : [],
        ),
        examples: new Set([hit.documentName]),
      });
    }
  }

  return Array.from(map.entries())
    .map(([libraryId, row]) => ({
      libraryId,
      score: row.score + Math.min(1.2, row.hits * 0.08),
      hits: row.hits,
      versions: Array.from(row.versions).slice(0, 5),
      examples: Array.from(row.examples).slice(0, 3),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function resolveCandidatesFromDocuments(
  docs: Awaited<
    ReturnType<typeof knowledgeRepository.selectDocumentsByGroupId>
  >,
  libraryName: string,
  topK: number,
): LibraryCandidate[] {
  const candidates = docs
    .filter((doc) => doc.status === "ready")
    .map((doc) => {
      const metadataLibraryId =
        doc.metadata &&
        typeof doc.metadata === "object" &&
        typeof (doc.metadata as any).libraryId === "string"
          ? ((doc.metadata as any).libraryId as string)
          : null;
      const canonicalId = toCanonicalLibraryId(metadataLibraryId || doc.name);
      const signal = matchSignal(
        libraryName,
        canonicalId,
        doc.name,
        doc.description ?? undefined,
        doc.originalFilename,
      );
      return {
        libraryId: canonicalId,
        score: signal,
        hits: doc.chunkCount || 1,
        versions: [],
        examples: [doc.name],
      };
    })
    .filter((c) => c.libraryId && c.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return candidates;
}

function formatResolvedLibrariesText(input: {
  groupName: string;
  libraryName: string;
  query: string;
  candidates: LibraryCandidate[];
}): string {
  const { groupName, libraryName, query, candidates } = input;
  if (candidates.length === 0) {
    return [
      `[ContextX Library Resolver: ${groupName}]`,
      `No library ID candidates found for "${libraryName}".`,
      `Query: ${query}`,
      "",
      `Try a broader libraryName (for example: "next", "react", "mongodb").`,
    ].join("\n");
  }

  const rows = candidates.map((c, i) => {
    const versions =
      c.versions.length > 0 ? `, versions: ${c.versions.join(", ")}` : "";
    const examples =
      c.examples.length > 0 ? `, docs: ${c.examples.join(" | ")}` : "";
    return `${i + 1}. ${c.libraryId} (score: ${c.score.toFixed(3)}, hits: ${c.hits}${versions}${examples})`;
  });

  return [
    `[ContextX Library Resolver: ${groupName}]`,
    `Resolved "${libraryName}" for task: ${query}`,
    "",
    ...rows,
    "",
    `Use "${TOOL_QUERY_DOCS}" with one of these libraryId values.`,
  ].join("\n");
}

const TOOLS = (groupName: string) => [
  {
    name: TOOL_RESOLVE_LIBRARY_ID,
    description: `Resolve a library/package name into ContextX-compatible library IDs for "${groupName}". Call this before query-docs.`,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "User task/question. Used to rank which library ID is most relevant.",
        },
        libraryName: {
          type: "string",
          description:
            'Library/package name to resolve (e.g. "next.js", "react", "mongodb").',
        },
        topK: {
          type: "number",
          minimum: 1,
          maximum: 10,
          description: "How many candidate library IDs to return (default: 5).",
        },
      },
      required: ["query", "libraryName"],
    },
  },
  {
    name: TOOL_QUERY_DOCS,
    description: `Query relevant documentation sections for a specific library ID in "${groupName}".`,
    inputSchema: {
      type: "object",
      properties: {
        libraryId: {
          type: "string",
          description:
            'Resolved library ID from resolve-library-id (e.g. "/vercel/next.js").',
        },
        query: {
          type: "string",
          description: "Question/topic to retrieve relevant documentation.",
        },
        version: {
          type: "string",
          description: "Optional library version constraint (e.g. 14, 5.2.1).",
        },
        tokens: {
          type: "number",
          description:
            "Maximum token budget for the response (default: 10000).",
          minimum: 500,
          maximum: 50000,
        },
        maxDocs: {
          type: "number",
          description: "Maximum number of documents to return (default: 8).",
          minimum: 1,
          maximum: 12,
        },
      },
      required: ["libraryId", "query"],
    },
  },
  {
    name: TOOL_GET_DOCS,
    description: `Get documentation from the "${groupName}" knowledge base (legacy tool). Uses semantic search (embedding + BM25 + reranking) to identify relevant documents.`,
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

async function handleJsonRpcRequest(
  groupId: string,
  group: NonNullable<
    Awaited<ReturnType<typeof knowledgeRepository.selectGroupById>>
  >,
  body: unknown,
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
    // Legacy SSE and streamable clients send this notification during handshake.
    return null;
  }

  if (method === "ping") {
    return jsonRpcResultPayload(id, {});
  }

  if (method === "initialize") {
    return jsonRpcResultPayload(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: `contextx-${groupId}`, version: "1.0.0" },
    });
  }

  if (method === "tools/list") {
    return jsonRpcResultPayload(id, { tools: TOOLS(group.name) });
  }

  if (method === "tools/call") {
    const { name, arguments: args } = reqParams as {
      name: string;
      arguments: unknown;
    };

    if (name === TOOL_RESOLVE_LIBRARY_ID || name === "resolve_library_id") {
      const parsed = resolveLibraryIdSchema.parse(args);
      const topK = parsed.topK ?? 5;

      const resolveQuery = `${parsed.libraryName}\n${parsed.query}`;
      const hits = await queryKnowledge(group, resolveQuery, {
        topN: 40,
        source: "mcp",
        skipLogging: true,
      }).catch(() => []);

      let candidates = resolveCandidatesFromHits(
        hits,
        parsed.libraryName,
        topK,
      );
      if (candidates.length === 0) {
        const docs =
          await knowledgeRepository.selectDocumentsByGroupId(groupId);
        candidates = resolveCandidatesFromDocuments(
          docs,
          parsed.libraryName,
          topK,
        );
      }

      const text = formatResolvedLibrariesText({
        groupName: group.name,
        libraryName: parsed.libraryName,
        query: parsed.query,
        candidates,
      });
      return jsonRpcResultPayload(id, {
        content: [{ type: "text", text }],
        libraryIds: candidates,
      });
    }

    if (
      name === TOOL_QUERY_DOCS ||
      name === "query_docs" ||
      name === "get-library-docs" ||
      name === "get_library_docs"
    ) {
      const parsed = queryDocsSchema.parse(args);
      const scopedQuery = `${parsed.libraryId}\n${parsed.query}`;
      const docs = await queryKnowledgeAsDocs(group, scopedQuery, {
        tokens: parsed.tokens ?? 10000,
        maxDocs: parsed.maxDocs ?? 8,
        resultMode: "matched-sections",
        libraryId: parsed.libraryId,
        libraryVersion: parsed.version,
        source: "mcp",
      });

      if (docs.length === 0) {
        const text = [
          `[ContextX Docs: ${group.name}]`,
          `No relevant docs found for libraryId "${parsed.libraryId}"${parsed.version ? ` @ ${parsed.version}` : ""}.`,
          `Query: ${parsed.query}`,
          "",
          `Tip: call "${TOOL_RESOLVE_LIBRARY_ID}" first, then retry with the returned libraryId.`,
        ].join("\n");
        return jsonRpcResultPayload(id, { content: [{ type: "text", text }] });
      }

      const text = [
        `[ContextX Docs: ${group.name}]`,
        `Library: ${parsed.libraryId}${parsed.version ? ` @ ${parsed.version}` : ""}`,
        `Query: ${parsed.query}`,
        "",
        formatDocsAsText(group.name, docs, parsed.query),
      ].join("\n");
      return jsonRpcResultPayload(id, { content: [{ type: "text", text }] });
    }

    if (name === TOOL_GET_DOCS) {
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
      return jsonRpcResultPayload(id, { content: [{ type: "text", text }] });
    }

    if (name === "list_documents") {
      const docs = await knowledgeRepository.selectDocumentsByGroupId(groupId);
      const list = docs
        .map(
          (d) =>
            `- **${d.name}** (${d.fileType.toUpperCase()}, ${d.status}, ${d.chunkCount} chunks)`,
        )
        .join("\n");
      return jsonRpcResultPayload(id, {
        content: [
          {
            type: "text",
            text: `Documents in "${group.name}":\n\n${list || "No documents found"}`,
          },
        ],
      });
    }

    return jsonRpcErrorPayload(id, -32601, `Unknown tool: ${name}`);
  }

  if (!hasId) {
    return null;
  }

  return jsonRpcErrorPayload(id, -32601, `Method not found: ${method}`);
}

export async function POST(req: NextRequest, { params }: Params) {
  const { groupId } = await params;

  const isAuthorized = await authenticate(req, groupId);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const group = await knowledgeRepository.selectGroupByIdForMcp(groupId);
  if (!group || !group.mcpEnabled) {
    return NextResponse.json(
      { error: "MCP not enabled for this knowledge group" },
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
    payload = await handleJsonRpcRequest(groupId, group, body);
  } catch (error: any) {
    const id =
      body && typeof body === "object" && !Array.isArray(body) && "id" in body
        ? (body as { id: unknown }).id
        : null;
    payload = jsonRpcErrorPayload(
      id,
      -32603,
      error?.message || "Internal error",
    );
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
  const { groupId } = await params;

  const isAuthorized = await authenticate(req, groupId);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const group = await knowledgeRepository.selectGroupByIdForMcp(groupId);
  if (!group || !group.mcpEnabled) {
    return NextResponse.json({ error: "MCP not enabled" }, { status: 403 });
  }

  // Legacy SSE transport support:
  // - open an event stream and send "endpoint" event with POST URL.
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
    name: `contextx-${groupId}`,
    version: "1.0.0",
    description: `ContextX MCP server for "${group.name}"`,
    tools: TOOLS(group.name),
  });
}
