import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  agentRepository: {
    checkAccess: vi.fn(),
  },
  knowledgeRepository: {
    getGroupsByAgentId: vi.fn(),
    selectGroupById: vi.fn(),
    linkAgentToGroup: vi.fn(),
    unlinkAgentFromGroup: vi.fn(),
  },
}));

const { GET, POST, DELETE } = await import("./route");
const { getSession } = await import("auth/server");
const { agentRepository, knowledgeRepository } = await import(
  "lib/db/repository"
);

function withParams(id: string) {
  return {
    params: Promise.resolve({ id }),
  } as { params: Promise<{ id: string }> };
}

function makeNextRequest(url: string, init: RequestInit = {}) {
  return Object.assign(new Request(url, init), {
    nextUrl: new URL(url),
  }) as any;
}

describe("agent knowledge route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "user-1" },
    } as any);
    vi.mocked(agentRepository.checkAccess).mockResolvedValue(true);
  });

  it("lists attached knowledge groups when the user can access the agent", async () => {
    vi.mocked(knowledgeRepository.getGroupsByAgentId).mockResolvedValue([
      { id: "group-1", name: "Knowledge" },
    ] as any);

    const response = await GET(
      makeNextRequest("http://localhost/api/agent/agent-1/knowledge"),
      withParams("agent-1"),
    );

    expect(response.status).toBe(200);
    expect(agentRepository.checkAccess).toHaveBeenCalledWith(
      "agent-1",
      "user-1",
      false,
    );
    await expect(response.json()).resolves.toHaveLength(1);
  });

  it("rejects GET access when the user cannot access the agent", async () => {
    vi.mocked(agentRepository.checkAccess).mockResolvedValue(false);

    const response = await GET(
      makeNextRequest("http://localhost/api/agent/agent-1/knowledge"),
      withParams("agent-1"),
    );

    expect(response.status).toBe(403);
    expect(knowledgeRepository.getGroupsByAgentId).not.toHaveBeenCalled();
  });

  it("attaches a knowledge group to the agent", async () => {
    vi.mocked(knowledgeRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);

    const response = await POST(
      makeNextRequest("http://localhost/api/agent/agent-1/knowledge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId: "group-1" }),
      }),
      withParams("agent-1"),
    );

    expect(response.status).toBe(200);
    expect(knowledgeRepository.linkAgentToGroup).toHaveBeenCalledWith(
      "agent-1",
      "group-1",
    );
  });

  it("detaches a knowledge group from the agent", async () => {
    const response = await DELETE(
      makeNextRequest("http://localhost/api/agent/agent-1/knowledge", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId: "group-1" }),
      }),
      withParams("agent-1"),
    );

    expect(response.status).toBe(200);
    expect(knowledgeRepository.unlinkAgentFromGroup).toHaveBeenCalledWith(
      "agent-1",
      "group-1",
    );
  });
});
