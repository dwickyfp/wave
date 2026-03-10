import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("bcrypt-ts", () => ({
  compare: vi.fn(async () => true),
}));

vi.mock("lib/db/repository", () => ({
  mcpRepository: {
    selectById: vi.fn(),
  },
}));

vi.mock("lib/ai/mcp/mcp-manager", () => ({
  mcpClientsManager: {
    getClient: vi.fn(),
    refreshClient: vi.fn(),
    toolCall: vi.fn(),
  },
}));

const { POST } = await import("./route");
const { compare } = await import("bcrypt-ts");
const { mcpRepository } = await import("lib/db/repository");
const { mcpClientsManager } = await import("lib/ai/mcp/mcp-manager");

function withParams(id: string) {
  return {
    params: Promise.resolve({ id }),
  } as { params: Promise<{ id: string }> };
}

function makeRequest(body: unknown, init?: RequestInit): Request {
  const url = "http://localhost/api/mcp/published/server-1";
  return new Request(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...init?.headers,
    },
    body: JSON.stringify(body),
    ...init,
  });
}

const publishedServer = {
  id: "server-1",
  name: "remote-docs",
  config: { url: "https://example.com/mcp" },
  enabled: true,
  userId: "owner-1",
  visibility: "private",
  publishEnabled: true,
  publishAuthMode: "none",
  publishApiKeyHash: null,
  publishApiKeyPreview: null,
  toolInfo: [
    {
      name: "search_docs",
      description: "Search documents",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
  ],
};

describe("published mcp route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(compare).mockResolvedValue(true as any);
    vi.mocked(mcpRepository.selectById).mockResolvedValue(
      publishedServer as any,
    );
    vi.mocked(mcpClientsManager.getClient).mockResolvedValue({
      client: {
        status: "connected",
        toolInfo: publishedServer.toolInfo,
      },
    } as any);
    vi.mocked(mcpClientsManager.refreshClient).mockResolvedValue({
      client: {
        status: "connected",
        toolInfo: publishedServer.toolInfo,
      },
    } as any);
    vi.mocked(mcpClientsManager.toolCall).mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    } as any);
  });

  it("rejects when publishing is disabled", async () => {
    vi.mocked(mcpRepository.selectById).mockResolvedValue({
      ...publishedServer,
      publishEnabled: false,
    } as any);

    const res = await POST(
      makeRequest({
        jsonrpc: "2.0",
        id: "init-1",
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "tester", version: "1.0.0" },
        },
      }) as any,
      withParams("server-1"),
    );

    expect(res.status).toBe(403);
  });

  it("rejects bearer requests without a valid token", async () => {
    vi.mocked(mcpRepository.selectById).mockResolvedValue({
      ...publishedServer,
      publishAuthMode: "bearer",
      publishApiKeyHash: "hashed",
    } as any);
    vi.mocked(compare).mockResolvedValue(false as any);

    const res = await POST(
      makeRequest({
        jsonrpc: "2.0",
        id: "init-1",
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "tester", version: "1.0.0" },
        },
      }) as any,
      withParams("server-1"),
    );

    expect(res.status).toBe(401);
  });

  it("returns initialize payload", async () => {
    const res = await POST(
      makeRequest({
        jsonrpc: "2.0",
        id: "init-1",
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "tester", version: "1.0.0" },
        },
      }) as any,
      withParams("server-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.serverInfo.name).toBe("published-mcp-server-1");
  });

  it("lists published tools", async () => {
    const res = await POST(
      makeRequest({
        jsonrpc: "2.0",
        id: "tools-1",
        method: "tools/list",
        params: {},
      }) as any,
      withParams("server-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.tools).toHaveLength(1);
    expect(json.result.tools[0].name).toBe("search_docs");
  });

  it("forwards tool calls to the upstream mcp manager", async () => {
    const res = await POST(
      makeRequest({
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "search_docs",
          arguments: {
            query: "pricing",
          },
        },
      }) as any,
      withParams("server-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(vi.mocked(mcpClientsManager.toolCall)).toHaveBeenCalledWith(
      "server-1",
      "search_docs",
      {
        query: "pricing",
      },
    );
    expect(json.result.content[0].text).toBe("ok");
  });
});
