import { describe, expect, it } from "vitest";
import {
  buildAgentSkillsSystemPrompt,
  buildSkillGenerationPrompt,
} from "./prompts";

describe("skill prompts", () => {
  it("buildAgentSkillsSystemPrompt returns empty string when no skills", () => {
    const prompt = buildAgentSkillsSystemPrompt([]);
    expect(prompt).toBe("");
  });

  it("buildAgentSkillsSystemPrompt includes tool and skill names", () => {
    const prompt = buildAgentSkillsSystemPrompt([
      {
        title: "Technical RFC Writer",
        description: "Draft RFC documents",
      },
      {
        title: "PR Review Assistant",
        description: "Review pull requests",
      },
    ]);

    expect(prompt).toContain("load_skill");
    expect(prompt).toContain("Technical RFC Writer");
    expect(prompt).toContain("PR Review Assistant");
  });

  it("buildSkillGenerationPrompt includes local pattern hints", () => {
    const prompt = buildSkillGenerationPrompt(
      "- sample-skill: frontmatter=yes; headings=# Intro | ## Workflow",
    );

    expect(prompt).toContain("sample-skill");
    expect(prompt).toContain("SKILL.md style");
    expect(prompt).toContain("Do not include YAML frontmatter");
  });
});
