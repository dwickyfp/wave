import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/mcp/access", () => ({
  getAccessibleMcpServerOrThrow: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  mcpRepository: {
    selectById: vi.fn(),
    updatePublishState: vi.fn(),
    setPublishApiKey: vi.fn(),
  },
}));

vi.mock("bcrypt-ts", () => ({
  hash: vi.fn(async () => "hashed-publish-key"),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "abcdefghijklmnopqrstuvwxyz1234567890"),
}));

const { PUT, POST } = await import("./route");
const { getSession } = await import("auth/server");
const { getAccessibleMcpServerOrThrow } = await import("lib/mcp/access");
const { mcpRepository } = await import("lib/db/repository");

function withParams(id: string) {
  return {
    params: Promise.resolve({ id }),
  } as { params: Promise<{ id: string }> };
}

describe("mcp publish route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccessibleMcpServerOrThrow).mockResolvedValue({
      currentUser: { id: "owner-1", role: "editor" },
      isOwner: true,
      server: { id: "server-1" },
    } as any);
  });

  it("returns 401 when session is missing", async () => {
    vi.mocked(getSession).mockResolvedValue(null as any);

    const res = await PUT(
      new Request("http://localhost/api/mcp/server-1/publish", {
        method: "PUT",
        body: JSON.stringify({ enabled: true, authMode: "none" }),
      }) as any,
      withParams("server-1"),
    );

    expect(res.status).toBe(401);
  });

  it("updates publish state", async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "owner-1", role: "editor" },
    } as any);

    const res = await PUT(
      new Request("http://localhost/api/mcp/server-1/publish", {
        method: "PUT",
        body: JSON.stringify({ enabled: true, authMode: "none" }),
      }) as any,
      withParams("server-1"),
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(mcpRepository.updatePublishState)).toHaveBeenCalledWith(
      "server-1",
      {
        enabled: true,
        authMode: "none",
      },
    );
  });

  it("rejects enabling bearer mode without a stored key", async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "owner-1", role: "editor" },
    } as any);
    vi.mocked(mcpRepository.selectById).mockResolvedValue({
      id: "server-1",
      publishApiKeyHash: null,
    } as any);

    const res = await PUT(
      new Request("http://localhost/api/mcp/server-1/publish", {
        method: "PUT",
        body: JSON.stringify({ enabled: true, authMode: "bearer" }),
      }) as any,
      withParams("server-1"),
    );

    expect(res.status).toBe(400);
  });

  it("generates a publish key", async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "owner-1", role: "editor" },
    } as any);

    const res = await POST(
      new Request("http://localhost/api/mcp/server-1/publish", {
        method: "POST",
        body: JSON.stringify({ action: "generate" }),
      }) as any,
      withParams("server-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.key).toContain("mcp_");
    expect(json.preview).toBeTypeOf("string");
    expect(vi.mocked(mcpRepository.setPublishApiKey)).toHaveBeenCalledWith(
      "server-1",
      "hashed-publish-key",
      expect.any(String),
    );
  });

  it("revokes publish key and disables publishing", async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "owner-1", role: "editor" },
    } as any);

    const res = await POST(
      new Request("http://localhost/api/mcp/server-1/publish", {
        method: "POST",
        body: JSON.stringify({ action: "revoke" }),
      }) as any,
      withParams("server-1"),
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(mcpRepository.setPublishApiKey)).toHaveBeenCalledWith(
      "server-1",
      null,
      null,
    );
    expect(vi.mocked(mcpRepository.updatePublishState)).toHaveBeenCalledWith(
      "server-1",
      {
        enabled: false,
        authMode: "bearer",
      },
    );
  });

  it("returns 403 for manage access failures", async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "viewer-1", role: "user" },
    } as any);
    vi.mocked(getAccessibleMcpServerOrThrow).mockRejectedValue(
      new Error("Unauthorized"),
    );

    const res = await PUT(
      new Request("http://localhost/api/mcp/server-1/publish", {
        method: "PUT",
        body: JSON.stringify({ enabled: true, authMode: "none" }),
      }) as any,
      withParams("server-1"),
    );

    expect(res.status).toBe(403);
  });
});
