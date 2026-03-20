import type {
  SelfLearningMemory,
  SelfLearningSignalType,
} from "app-types/self-learning";
import { createHash } from "node:crypto";

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function normalizeLearningText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function buildMemoryFingerprint(input: {
  category: string;
  title: string;
  content: string;
}): string {
  return createHash("sha256")
    .update(
      [
        input.category.trim().toLowerCase(),
        normalizeLearningText(input.title),
        normalizeLearningText(input.content),
      ].join("|"),
    )
    .digest("hex");
}

export function buildContradictionFingerprint(input: {
  category: string;
  hint?: string | null;
  title: string;
}): string {
  const seed = normalizeLearningText(input.hint || input.title);
  return createHash("sha256")
    .update(`${input.category.trim().toLowerCase()}|${seed}`)
    .digest("hex");
}

export function getImplicitSignalScore(
  signalType: SelfLearningSignalType,
): number {
  switch (signalType) {
    case "feedback_like":
    case "feedback_dislike":
      return 1;
    case "regenerate_response":
      return 0.9;
    case "delete_response":
      return 0.75;
    case "branch_from_response":
      return 0.55;
    case "follow_up_continue":
      return 0.35;
    default:
      return 0;
  }
}

export function computeCompositeScore(input: {
  explicitScore: number;
  implicitScore: number;
  llmScore: number;
}): number {
  const explicit = clamp01(input.explicitScore);
  const implicit = clamp01(input.implicitScore);
  const llm = clamp01(input.llmScore);

  return Number((explicit * 0.45 + llm * 0.4 + implicit * 0.15).toFixed(4));
}

export function renderLearnedUserPersonalizationPrompt(
  memories: Pick<SelfLearningMemory, "title" | "content">[],
  maxMemories = 5,
): string | false {
  const limited = memories
    .filter((memory) => memory.content.trim().length > 0)
    .slice(0, maxMemories);

  if (limited.length === 0) return false;

  return `
<learned_user_personalization>
Use these learned personalization hints when they fit the current request.
They are secondary to the user's live instructions, system rules, and safety policies.

${limited
  .map(
    (memory, index) =>
      `${index + 1}. ${memory.title.trim()}: ${memory.content.trim()}`,
  )
  .join("\n")}
</learned_user_personalization>`.trim();
}

export function renderPersonalizationKnowledgeMarkdown(
  memories: Pick<SelfLearningMemory, "title" | "content" | "category">[],
): string {
  const body =
    memories.length === 0
      ? "No active personalized learning has been approved yet."
      : memories
          .map(
            (memory) =>
              `## ${memory.title}\n\n- Category: ${memory.category}\n- Guidance: ${memory.content}`,
          )
          .join("\n\n");

  return `# Emma Personalization Memory\n\n${body}\n`;
}
