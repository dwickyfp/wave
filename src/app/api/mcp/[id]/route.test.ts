import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/mcp/access", () => ({
  getAccessibleMcpServerOrThrow: vi.fn(),
}));

vi.mock("lib/ai/mcp/mcp-manager", () => ({
  mcpClientsManager: {
    getClient: vi.fn(),
  },
}));

const { GET } = await import("./route");
const { getSession } = await import("auth/server");
const { getAccessibleMcpServerOrThrow } = await import("lib/mcp/access");
const { mcpClientsManager } = await import("lib/ai/mcp/mcp-manager");

function withParams(id: string) {
  return {
    params: Promise.resolve({ id }),
  } as { params: Promise<{ id: string }> };
}

function makeNextRequest(url: string, init?: RequestInit): Request {
  return Object.assign(new Request(url, init), {
    nextUrl: new URL(url),
  });
}

describe("mcp detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when session is missing", async () => {
    vi.mocked(getSession).mockResolvedValue(null as any);

    const res = await GET(
      makeNextRequest("http://localhost/api/mcp/server-1") as any,
      withParams("server-1"),
    );

    expect(res.status).toBe(401);
  });

  it("hides config and publish metadata for read-only viewers", async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "viewer-1", role: "user" },
    } as any);
    vi.mocked(getAccessibleMcpServerOrThrow).mockResolvedValue({
      currentUser: { id: "viewer-1", role: "user" },
      isOwner: false,
      server: {
        id: "server-1",
        name: "remote-docs",
        config: { url: "https://example.com/mcp" },
        enabled: true,
        userId: "owner-1",
        visibility: "public",
        toolInfo: [{ name: "search", description: "Search docs" }],
        publishEnabled: true,
        publishAuthMode: "bearer",
        publishApiKeyPreview: "1234",
      },
    } as any);
    vi.mocked(mcpClientsManager.getClient).mockResolvedValue({
      client: {
        getInfo: () => ({
          status: "connected",
          enabled: true,
          toolInfo: [{ name: "search", description: "Search docs" }],
        }),
      },
    } as any);

    const res = await GET(
      makeNextRequest("http://localhost/api/mcp/server-1") as any,
      withParams("server-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.config).toBeUndefined();
    expect(json.publishEnabled).toBeUndefined();
    expect(json.publishAuthMode).toBeUndefined();
    expect(json.publishApiKeyPreview).toBeUndefined();
    expect(json.publishedUrl).toBeUndefined();
    expect(json.canManage).toBe(false);
  });

  it("returns full manage detail payload for owners", async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "owner-1", role: "creator" },
    } as any);
    vi.mocked(getAccessibleMcpServerOrThrow).mockResolvedValue({
      currentUser: { id: "owner-1", role: "creator" },
      isOwner: true,
      server: {
        id: "server-1",
        name: "remote-docs",
        config: { url: "https://example.com/mcp" },
        enabled: true,
        userId: "owner-1",
        visibility: "private",
        toolInfo: [{ name: "search", description: "Search docs" }],
        publishEnabled: true,
        publishAuthMode: "bearer",
        publishApiKeyPreview: "1234",
      },
    } as any);
    vi.mocked(mcpClientsManager.getClient).mockResolvedValue({
      client: {
        getInfo: () => ({
          status: "connected",
          enabled: true,
          toolInfo: [{ name: "search", description: "Search docs" }],
        }),
      },
    } as any);

    const res = await GET(
      makeNextRequest("http://localhost/api/mcp/server-1") as any,
      withParams("server-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.config).toEqual({ url: "https://example.com/mcp" });
    expect(json.publishEnabled).toBe(true);
    expect(json.publishAuthMode).toBe("bearer");
    expect(json.publishApiKeyPreview).toBe("1234");
    expect(json.publishedUrl).toBe(
      "http://localhost/api/mcp/published/server-1",
    );
    expect(json.canManage).toBe(true);
  });
});
