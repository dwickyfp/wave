import { describe, expect, it } from "vitest";
import { resolveActiveAgentSkills } from "./skill-activation";

describe("resolveActiveAgentSkills", () => {
  it("activates a skill on exact title match", () => {
    const result = resolveActiveAgentSkills({
      skills: [
        {
          id: "skill-rfc",
          title: "Technical RFC Writer",
          description: "Draft engineering RFC documents",
          instructions: "## Workflow\n- Gather requirements\n- Write the RFC",
        },
      ],
      taskText: "Please follow the Technical RFC Writer process for this API.",
    });

    expect(result.activeSkillTitles).toEqual(["Technical RFC Writer"]);
    expect(result.activeSkills[0]?.exactTitleMatch).toBe(true);
    expect(result.activeSkillPrompt).toContain("selected automatically");
  });

  it("prioritizes title-token overlap above description-only overlap", () => {
    const result = resolveActiveAgentSkills({
      skills: [
        {
          id: "skill-sql-migration",
          title: "SQL Migration Planner",
          description: "Plan schema changes safely",
          instructions:
            "## Plan\n- Review tables\n- Stage migrations\n- Write rollout notes",
        },
        {
          id: "skill-release-helper",
          title: "Release Helper",
          description: "Helps with SQL migration planning and rollout notes",
          instructions:
            "## Support\n- Offer migration planning guidance\n- Draft release notes",
        },
      ],
      taskText: "Plan the SQL migration rollout for this schema change.",
    });

    expect(result.activeSkillTitles[0]).toBe("SQL Migration Planner");
  });

  it("returns no active skills for unrelated requests", () => {
    const result = resolveActiveAgentSkills({
      skills: [
        {
          id: "skill-rfc",
          title: "Technical RFC Writer",
          description: "Draft engineering RFC documents",
          instructions: "## Workflow\n- Gather requirements\n- Write the RFC",
        },
      ],
      taskText: "Summarize the weather forecast for tomorrow.",
    });

    expect(result.activeSkills).toEqual([]);
    expect(result.activeSkillPrompt).toBe("");
  });

  it("uses title ordering to break score ties", () => {
    const result = resolveActiveAgentSkills({
      skills: [
        {
          id: "skill-beta-review",
          title: "Beta Review",
          description: "Review pull requests",
          instructions: "## Review\n- Check tests\n- Check risks",
        },
        {
          id: "skill-alpha-review",
          title: "Alpha Review",
          description: "Review pull requests",
          instructions: "## Review\n- Check tests\n- Check risks",
        },
      ],
      taskText: "Review pull requests and check risks.",
    });

    expect(result.activeSkillTitles).toEqual(["Alpha Review", "Beta Review"]);
  });

  it("caps automatic activation at three skills", () => {
    const result = resolveActiveAgentSkills({
      skills: [
        {
          id: "workflow-one",
          title: "Workflow One",
          description: "Handle rollout workflow",
          instructions: "workflow rollout planning",
        },
        {
          id: "workflow-two",
          title: "Workflow Two",
          description: "Handle rollout workflow",
          instructions: "workflow rollout planning",
        },
        {
          id: "workflow-three",
          title: "Workflow Three",
          description: "Handle rollout workflow",
          instructions: "workflow rollout planning",
        },
        {
          id: "workflow-four",
          title: "Workflow Four",
          description: "Handle rollout workflow",
          instructions: "workflow rollout planning",
        },
      ],
      taskText: "Use the rollout workflow for this release.",
    });

    expect(result.activeSkills).toHaveLength(3);
  });

  it("truncates long instructions and keeps load_skill as the fallback note", () => {
    const longInstructions = [
      "## Workflow",
      ...Array.from({ length: 400 }, (_, index) => `- Step ${index}: review`),
    ].join("\n");

    const result = resolveActiveAgentSkills({
      skills: [
        {
          id: "review-workflow",
          title: "Review Workflow",
          description: "Review changes with a checklist",
          instructions: longInstructions,
        },
      ],
      taskText: "Use the review workflow for this pull request.",
    });

    expect(result.activeSkills[0]?.instructionsTruncated).toBe(true);
    expect(
      result.activeSkills[0]?.instructionsExcerpt.length,
    ).toBeLessThanOrEqual(2500);
    expect(result.activeSkillPrompt).toContain("load_skill");
  });
});
