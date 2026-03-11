import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("lib/db/repository", () => ({
  skillRepository: {
    getSkillsByAgentId: vi.fn(),
  },
  skillGroupRepository: {
    getGroupsByAgentId: vi.fn(),
    getSkillsByAgentGroupId: vi.fn(),
  },
}));

const { skillRepository, skillGroupRepository } = await import(
  "lib/db/repository"
);
const { getAgentAttachedSkills } = await import("./attached-skills");

describe("getAgentAttachedSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dedupes group skills behind direct skills while preserving attached groups", async () => {
    vi.mocked(skillRepository.getSkillsByAgentId).mockResolvedValue([
      {
        id: "skill-1",
        title: "Direct Skill",
      },
    ] as any);
    vi.mocked(skillGroupRepository.getGroupsByAgentId).mockResolvedValue([
      {
        id: "group-1",
        name: "Case Group",
      },
    ] as any);
    vi.mocked(skillGroupRepository.getSkillsByAgentGroupId).mockResolvedValue([
      {
        id: "skill-1",
        title: "Direct Skill Duplicate",
      },
      {
        id: "skill-2",
        title: "Group Skill",
      },
    ] as any);

    const result = await getAgentAttachedSkills("agent-1");

    expect(result.skillGroups).toHaveLength(1);
    expect(result.attachedSkills.map((skill) => skill.id)).toEqual([
      "skill-1",
      "skill-2",
    ]);
    expect(result.attachedSkills[0]?.title).toBe("Direct Skill");
  });
});
