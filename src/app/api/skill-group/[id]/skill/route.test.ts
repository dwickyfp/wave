import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  skillGroupRepository: {
    selectGroupById: vi.fn(),
    addSkillToGroup: vi.fn(),
    removeSkillFromGroup: vi.fn(),
    getSkillsByGroupId: vi.fn(),
  },
  skillRepository: {
    selectSkillById: vi.fn(),
  },
}));

const { POST, DELETE } = await import("./route");
const { getSession } = await import("auth/server");
const { skillGroupRepository, skillRepository } = await import(
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

describe("skill group member route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "user-1" },
    } as any);
    vi.mocked(skillGroupRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
      visibility: "public",
    } as any);
  });

  it("rejects adding a private skill to a public group", async () => {
    vi.mocked(skillRepository.selectSkillById).mockResolvedValue({
      id: "skill-1",
      visibility: "private",
    } as any);

    const response = await POST(
      makeNextRequest("http://localhost/api/skill-group/group-1/skill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skillId: "skill-1" }),
      }),
      withParams("group-1"),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Read-only or public"),
    });
    expect(skillGroupRepository.addSkillToGroup).not.toHaveBeenCalled();
  });

  it("adds a compatible skill to the group", async () => {
    vi.mocked(skillRepository.selectSkillById).mockResolvedValue({
      id: "skill-2",
      visibility: "readonly",
    } as any);

    const response = await POST(
      makeNextRequest("http://localhost/api/skill-group/group-1/skill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skillId: "skill-2" }),
      }),
      withParams("group-1"),
    );

    expect(response.status).toBe(200);
    expect(skillGroupRepository.addSkillToGroup).toHaveBeenCalledWith(
      "group-1",
      "skill-2",
    );
  });

  it("removes a skill from the group", async () => {
    const response = await DELETE(
      makeNextRequest("http://localhost/api/skill-group/group-1/skill", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skillId: "skill-2" }),
      }),
      withParams("group-1"),
    );

    expect(response.status).toBe(200);
    expect(skillGroupRepository.removeSkillFromGroup).toHaveBeenCalledWith(
      "group-1",
      "skill-2",
    );
  });
});
