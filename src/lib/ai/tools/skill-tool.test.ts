import { describe, expect, it, vi } from "vitest";
import { createLoadSkillTool } from "./skill-tool";

vi.mock("server-only", () => ({}));

const skills = [
  {
    id: "1",
    title: "Technical RFC Writer",
    description: "Drafts engineering RFCs with structured sections",
    instructions: "## Workflow\n- Gather requirements\n- Write RFC",
  },
  {
    id: "2",
    title: "PR Review Assistant",
    description: "Reviews pull requests for quality and risk",
    instructions: "## Review\n- Check regressions\n- Check tests",
  },
];

describe("createLoadSkillTool", () => {
  it("loads a skill by title (case-insensitive)", async () => {
    const tool = createLoadSkillTool(skills as any);
    const result = await (tool.execute as any)({
      title: "technical rfc writer",
    });

    expect(result).toMatchObject({
      found: true,
      title: "Technical RFC Writer",
      description: "Drafts engineering RFCs with structured sections",
      instructions: "## Workflow\n- Gather requirements\n- Write RFC",
    });
  });

  it("returns guidance when no attached skill matches", async () => {
    const tool = createLoadSkillTool(skills as any);
    const result = await (tool.execute as any)({ title: "Unknown Skill" });

    expect(result).toMatchObject({
      found: false,
    });
    expect(result.availableSkills).toEqual([
      "Technical RFC Writer",
      "PR Review Assistant",
    ]);
    expect(result.guidance).toContain("Unknown Skill");
  });
});
