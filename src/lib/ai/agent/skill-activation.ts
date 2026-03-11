import type { SkillSummary } from "app-types/skill";
import { buildActiveAgentSkillsSystemPrompt } from "lib/ai/prompts";

const SKILL_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "into",
  "your",
  "about",
  "using",
  "use",
]);

const MAX_ACTIVE_SKILLS = 3;
const MIN_SKILL_SCORE = 40;
const TITLE_EXACT_MATCH_SCORE = 120;
const TITLE_TOKEN_MATCH_SCORE = 20;
const DESCRIPTION_TOKEN_MATCH_SCORE = 8;
const INSTRUCTION_TOKEN_MATCH_SCORE = 3;
const INSTRUCTIONS_SCORING_LIMIT = 1200;
const INSTRUCTIONS_PROMPT_LIMIT = 2500;

export type ActiveAgentSkill = Pick<
  SkillSummary,
  "title" | "description" | "instructions"
> & {
  instructionsExcerpt: string;
  instructionsTruncated: boolean;
  score: number;
  exactTitleMatch: boolean;
};

function tokenize(value: string) {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (token) => token.length > 1 && !SKILL_STOP_WORDS.has(token),
  );
}

function toTokenSet(value: string) {
  return new Set(tokenize(value));
}

function normalizePhrase(value: string) {
  return tokenize(value).join(" ");
}

function countOverlap(tokens: Set<string>, candidate: Set<string>) {
  let count = 0;

  for (const token of candidate) {
    if (tokens.has(token)) {
      count += 1;
    }
  }

  return count;
}

function buildInstructionsExcerpt(instructions: string) {
  if (instructions.length <= INSTRUCTIONS_PROMPT_LIMIT) {
    return {
      excerpt: instructions.trim(),
      truncated: false,
    };
  }

  const sliced = instructions.slice(0, INSTRUCTIONS_PROMPT_LIMIT);
  const lastNewlineIndex = sliced.lastIndexOf("\n");
  const excerpt =
    lastNewlineIndex > 0
      ? sliced.slice(0, lastNewlineIndex).trimEnd()
      : sliced.trimEnd();

  return {
    excerpt,
    truncated: true,
  };
}

export function stringifyMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";

      const candidate = part as {
        type?: string;
        text?: unknown;
      };

      if (
        typeof candidate.text === "string" &&
        (!candidate.type ||
          candidate.type === "text" ||
          candidate.type === "input_text" ||
          candidate.type === "output_text")
      ) {
        return candidate.text;
      }

      return "";
    })
    .join(" ")
    .trim();
}

export function getLatestUserMessageText(
  messages: Array<{ role: string; content?: unknown }>,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;

    const text = stringifyMessageText(message.content);
    if (text) {
      return text;
    }
  }

  return "";
}

export function resolveActiveAgentSkills(options: {
  skills: Array<Pick<SkillSummary, "title" | "description" | "instructions">>;
  taskText?: string;
  contextText?: string;
}) {
  const taskText = options.taskText?.trim() ?? "";
  const contextText = options.contextText?.trim() ?? "";
  const searchableText = [taskText, contextText].filter(Boolean).join("\n\n");

  if (!options.skills.length || !searchableText) {
    return {
      activeSkills: [] as ActiveAgentSkill[],
      activeSkillTitles: [] as string[],
      activeSkillPrompt: "",
    };
  }

  const searchableTokens = toTokenSet(searchableText);
  const normalizedTaskText = normalizePhrase(taskText);

  const scoredSkills = options.skills
    .map((skill) => {
      const normalizedTitle = normalizePhrase(skill.title);
      const exactTitleMatch = Boolean(
        normalizedTitle && normalizedTaskText.includes(normalizedTitle),
      );
      const titleTokens = toTokenSet(skill.title);
      const descriptionTokens = toTokenSet(skill.description ?? "");
      const instructionTokens = toTokenSet(
        skill.instructions.slice(0, INSTRUCTIONS_SCORING_LIMIT),
      );

      const score =
        (exactTitleMatch ? TITLE_EXACT_MATCH_SCORE : 0) +
        countOverlap(searchableTokens, titleTokens) * TITLE_TOKEN_MATCH_SCORE +
        countOverlap(searchableTokens, descriptionTokens) *
          DESCRIPTION_TOKEN_MATCH_SCORE +
        countOverlap(searchableTokens, instructionTokens) *
          INSTRUCTION_TOKEN_MATCH_SCORE;

      if (score < MIN_SKILL_SCORE) {
        return null;
      }

      const excerpt = buildInstructionsExcerpt(skill.instructions);

      return {
        ...skill,
        instructionsExcerpt: excerpt.excerpt,
        instructionsTruncated: excerpt.truncated,
        score,
        exactTitleMatch,
      } satisfies ActiveAgentSkill;
    })
    .filter((skill): skill is ActiveAgentSkill => Boolean(skill))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (left.exactTitleMatch !== right.exactTitleMatch) {
        return left.exactTitleMatch ? -1 : 1;
      }

      return left.title.localeCompare(right.title);
    })
    .slice(0, MAX_ACTIVE_SKILLS);

  return {
    activeSkills: scoredSkills,
    activeSkillTitles: scoredSkills.map((skill) => skill.title),
    activeSkillPrompt: buildActiveAgentSkillsSystemPrompt(scoredSkills),
  };
}
