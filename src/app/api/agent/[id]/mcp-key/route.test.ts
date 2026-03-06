import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  agentRepository: {
    selectAgentById: vi.fn(),
    setMcpApiKey: vi.fn(),
    setMcpEnabled: vi.fn(),
    setMcpModel: vi.fn(),
  },
  settingsRepository: {
    getProviders: vi.fn(),
  },
}));

vi.mock("bcrypt-ts", () => ({
  hash: vi.fn(async () => "hashed-key"),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "abcdefghijklmnopqrstuvwxyz1234567890"),
}));

const { POST, PUT } = await import("./route");
const { getSession } = await import("auth/server");
const { agentRepository, settingsRepository } = await import(
  "lib/db/repository"
);

function withParams(id: string) {
  return {
    params: Promise.resolve({ id }),
  } as { params: Promise<{ id: string }> };
}

describe("agent mcp key route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settingsRepository.getProviders).mockResolvedValue([
      {
        name: "openai",
        models: [
          {
            enabled: true,
            supportsTools: true,
            modelType: "llm",
            uiName: "gpt-4.1-mini",
            apiName: "gpt-4.1-mini",
          },
        ],
      },
    ] as any);
  });

  it("returns 401 when session is missing", async () => {
    vi.mocked(getSession).mockResolvedValue(null as any);

    const res = await POST(
      new Request("http://localhost/api/agent/a1/mcp-key", {
        method: "POST",
        body: JSON.stringify({ action: "generate" }),
      }) as any,
      withParams("a1"),
    );

    expect(res.status).toBe(401);
  });

  it("returns 403 when requester is not owner", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as any);
    vi.mocked(agentRepository.selectAgentById).mockResolvedValue({
      id: "a1",
      userId: "u2",
      agentType: "standard",
    } as any);

    const res = await POST(
      new Request("http://localhost/api/agent/a1/mcp-key", {
        method: "POST",
        body: JSON.stringify({ action: "generate" }),
      }) as any,
      withParams("a1"),
    );

    expect(res.status).toBe(403);
  });

  it("rejects snowflake agents", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as any);
    vi.mocked(agentRepository.selectAgentById).mockResolvedValue({
      id: "a1",
      userId: "u1",
      agentType: "snowflake_cortex",
    } as any);

    const res = await POST(
      new Request("http://localhost/api/agent/a1/mcp-key", {
        method: "POST",
        body: JSON.stringify({ action: "generate" }),
      }) as any,
      withParams("a1"),
    );

    expect(res.status).toBe(400);
  });

  it("generates and stores mcp key", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as any);
    vi.mocked(agentRepository.selectAgentById).mockResolvedValue({
      id: "a1",
      userId: "u1",
      agentType: "standard",
    } as any);

    const res = await POST(
      new Request("http://localhost/api/agent/a1/mcp-key", {
        method: "POST",
        body: JSON.stringify({ action: "generate" }),
      }) as any,
      withParams("a1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.key).toContain("wavea_");
    expect(json.preview).toBeTypeOf("string");
    expect(vi.mocked(agentRepository.setMcpApiKey)).toHaveBeenCalledOnce();
  });

  it("revokes key with empty persisted values", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as any);
    vi.mocked(agentRepository.selectAgentById).mockResolvedValue({
      id: "a1",
      userId: "u1",
      agentType: "standard",
    } as any);

    const res = await POST(
      new Request("http://localhost/api/agent/a1/mcp-key", {
        method: "POST",
        body: JSON.stringify({ action: "revoke" }),
      }) as any,
      withParams("a1"),
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(agentRepository.setMcpApiKey)).toHaveBeenCalledWith(
      "a1",
      "u1",
      null,
      null,
    );
  });

  it("updates mcp enabled flag", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as any);
    vi.mocked(agentRepository.selectAgentById).mockResolvedValue({
      id: "a1",
      userId: "u1",
      agentType: "standard",
    } as any);

    const res = await PUT(
      new Request("http://localhost/api/agent/a1/mcp-key", {
        method: "PUT",
        body: JSON.stringify({ enabled: true }),
      }) as any,
      withParams("a1"),
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(agentRepository.setMcpEnabled)).toHaveBeenCalledWith(
      "a1",
      "u1",
      true,
    );
  });

  it("returns 400 on invalid payload", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as any);

    const res = await PUT(
      new Request("http://localhost/api/agent/a1/mcp-key", {
        method: "PUT",
        body: JSON.stringify({ enabled: "yes" }),
      }) as any,
      withParams("a1"),
    );

    expect(res.status).toBe(400);
  });

  it("updates manual mcp model", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as any);
    vi.mocked(agentRepository.selectAgentById).mockResolvedValue({
      id: "a1",
      userId: "u1",
      agentType: "standard",
    } as any);

    const res = await PUT(
      new Request("http://localhost/api/agent/a1/mcp-key", {
        method: "PUT",
        body: JSON.stringify({
          model: { provider: "openai", model: "gpt-4.1-mini" },
        }),
      }) as any,
      withParams("a1"),
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(agentRepository.setMcpModel)).toHaveBeenCalledWith(
      "a1",
      "u1",
      "openai",
      "gpt-4.1-mini",
    );
  });

  it("clears manual mcp model to auto", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as any);
    vi.mocked(agentRepository.selectAgentById).mockResolvedValue({
      id: "a1",
      userId: "u1",
      agentType: "standard",
    } as any);

    const res = await PUT(
      new Request("http://localhost/api/agent/a1/mcp-key", {
        method: "PUT",
        body: JSON.stringify({
          model: null,
        }),
      }) as any,
      withParams("a1"),
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(agentRepository.setMcpModel)).toHaveBeenCalledWith(
      "a1",
      "u1",
      null,
      null,
    );
  });

  it("rejects unsupported manual mcp model", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as any);
    vi.mocked(agentRepository.selectAgentById).mockResolvedValue({
      id: "a1",
      userId: "u1",
      agentType: "standard",
    } as any);

    const res = await PUT(
      new Request("http://localhost/api/agent/a1/mcp-key", {
        method: "PUT",
        body: JSON.stringify({
          model: { provider: "openai", model: "not-existing" },
        }),
      }) as any,
      withParams("a1"),
    );

    expect(res.status).toBe(400);
  });
});
