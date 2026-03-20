import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  skillRepository: {
    selectSkillById: vi.fn(),
    updateSkill: vi.fn(),
    deleteSkill: vi.fn(),
  },
  skillGroupRepository: {
    getSharedGroupsBySkillId: vi.fn(),
  },
}));

const { PUT } = await import("./route");
const { getSession } = await import("auth/server");
const { skillRepository, skillGroupRepository } = await import(
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

describe("skill route visibility guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "user-1" },
    } as any);
  });

  it("rejects making a skill private while it belongs to shared groups", async () => {
    vi.mocked(skillGroupRepository.getSharedGroupsBySkillId).mockResolvedValue([
      {
        id: "group-1",
        name: "Case Group",
      },
    ] as any);

    const response = await PUT(
      makeNextRequest("http://localhost/api/skill/skill-1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: "private" }),
      }),
      withParams("skill-1"),
    );

    expect(response.status).toBe(409);
    expect(skillRepository.updateSkill).not.toHaveBeenCalled();
  });

  it("updates the skill when no shared groups block the visibility change", async () => {
    vi.mocked(skillGroupRepository.getSharedGroupsBySkillId).mockResolvedValue(
      [],
    );
    vi.mocked(skillRepository.updateSkill).mockResolvedValue({
      id: "skill-1",
      visibility: "private",
    } as any);

    const response = await PUT(
      makeNextRequest("http://localhost/api/skill/skill-1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: "private" }),
      }),
      withParams("skill-1"),
    );

    expect(response.status).toBe(200);
    expect(skillRepository.updateSkill).toHaveBeenCalledWith(
      "skill-1",
      "user-1",
      { visibility: "private" },
    );
  });
});
