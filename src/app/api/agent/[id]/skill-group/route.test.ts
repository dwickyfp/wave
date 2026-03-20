import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  agentRepository: {
    checkAccess: vi.fn(),
  },
  skillGroupRepository: {
    getGroupsByAgentId: vi.fn(),
    selectGroupById: vi.fn(),
    linkAgentToGroup: vi.fn(),
    unlinkAgentFromGroup: vi.fn(),
  },
}));

const { GET, POST, DELETE } = await import("./route");
const { getSession } = await import("auth/server");
const { agentRepository, skillGroupRepository } = await import(
  "lib/db/repository"
);

function withParams(id: string) {
  return {
    params: Promise.resolve({ id }),
  } as { params: Promise<{ id: string }> };
}

function makeNextRequest(url: string, init: RequestInit) {
  return Object.assign(new Request(url, init), {
    nextUrl: new URL(url),
  }) as any;
}

describe("agent skill-group route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "user-1" },
    } as any);
    vi.mocked(agentRepository.checkAccess).mockResolvedValue(true);
  });

  it("lists attached skill groups", async () => {
    vi.mocked(skillGroupRepository.getGroupsByAgentId).mockResolvedValue([
      {
        id: "group-1",
        name: "Case Group",
      },
    ] as any);

    const response = await GET(
      makeNextRequest("http://localhost/api/agent/agent-1/skill-group", {}),
      withParams("agent-1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toHaveLength(1);
  });

  it("attaches a skill group to the agent", async () => {
    vi.mocked(skillGroupRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);

    const response = await POST(
      makeNextRequest("http://localhost/api/agent/agent-1/skill-group", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId: "group-1" }),
      }),
      withParams("agent-1"),
    );

    expect(response.status).toBe(200);
    expect(skillGroupRepository.linkAgentToGroup).toHaveBeenCalledWith(
      "agent-1",
      "group-1",
    );
  });

  it("detaches a skill group from the agent", async () => {
    const response = await DELETE(
      makeNextRequest("http://localhost/api/agent/agent-1/skill-group", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId: "group-1" }),
      }),
      withParams("agent-1"),
    );

    expect(response.status).toBe(200);
    expect(skillGroupRepository.unlinkAgentFromGroup).toHaveBeenCalledWith(
      "agent-1",
      "group-1",
    );
  });
});
