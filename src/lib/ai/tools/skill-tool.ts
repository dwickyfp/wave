import "server-only";

import { tool } from "ai";
import { SkillSummary } from "app-types/skill";
import { z } from "zod";

export const LOAD_SKILL_TOOL_NAME = "load_skill";

type SkillToolPayload = Pick<
  SkillSummary,
  "id" | "title" | "description" | "instructions"
>;

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export function createLoadSkillTool(skills: SkillToolPayload[]) {
  return tool({
    description:
      "Load full instructions for one attached skill by title before executing that skill workflow.",
    inputSchema: z.object({
      title: z
        .string()
        .describe("Skill title to load (exact title is recommended)"),
    }),
    execute: async ({ title }) => {
      const normalizedTitle = normalize(title);
      const exactMatch = skills.find(
        (skill) => normalize(skill.title) === normalizedTitle,
      );

      const fuzzyMatch =
        exactMatch ??
        skills.find((skill) =>
          normalize(skill.title).includes(normalizedTitle),
        );

      if (!fuzzyMatch) {
        return {
          found: false,
          guidance: `No attached skill matched "${title}". Try one of the available skill titles.`,
          availableSkills: skills.map((skill) => skill.title),
        };
      }

      return {
        found: true,
        title: fuzzyMatch.title,
        description: fuzzyMatch.description ?? "",
        instructions: fuzzyMatch.instructions,
      };
    },
  });
}
