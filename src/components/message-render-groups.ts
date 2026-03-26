import { type ToolUIPart, type UIMessage, isToolUIPart } from "ai";
import type { ChatKnowledgeImage } from "app-types/chat";

export type RenderGroup =
  | { type: "single"; part: UIMessage["parts"][number]; index: number }
  | { type: "parallel-subagents"; parts: ToolUIPart[]; startIndex: number }
  | {
      type: "knowledge-images";
      images: ChatKnowledgeImage[];
      anchorIndex: number;
    };

function findAssistantAnswerTextPartIndex(parts: UIMessage["parts"]): number {
  let fallbackIndex = -1;

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part?.type !== "text") continue;

    fallbackIndex = index;
    if (part.text.trim().length > 0) {
      return index;
    }
  }

  return fallbackIndex;
}

export function buildRenderGroups(
  partsForDisplay: UIMessage["parts"],
  knowledgeImages: ChatKnowledgeImage[] = [],
): RenderGroup[] {
  const groups: RenderGroup[] = [];
  let stepSubagents: { part: ToolUIPart; index: number }[] = [];
  const knowledgeImageAnchorIndex = knowledgeImages.length
    ? findAssistantAnswerTextPartIndex(partsForDisplay)
    : -1;
  let insertedKnowledgeImages = false;

  const flush = () => {
    if (stepSubagents.length >= 2) {
      groups.push({
        type: "parallel-subagents",
        parts: stepSubagents.map((s) => s.part),
        startIndex: stepSubagents[0].index,
      });
    } else if (stepSubagents.length === 1) {
      groups.push({
        type: "single",
        part: stepSubagents[0].part,
        index: stepSubagents[0].index,
      });
    }
    stepSubagents = [];
  };

  const insertKnowledgeImages = (index: number) => {
    if (!knowledgeImages.length || insertedKnowledgeImages) return;
    if (knowledgeImageAnchorIndex !== index) return;

    flush();
    groups.push({
      type: "knowledge-images",
      images: knowledgeImages,
      anchorIndex: knowledgeImageAnchorIndex,
    });
    insertedKnowledgeImages = true;
  };

  partsForDisplay.forEach((part, index) => {
    insertKnowledgeImages(index);

    if (part.type === "step-start") {
      flush();
      return;
    }
    if (
      isToolUIPart(part) &&
      ((part as any).toolName as string | undefined)?.startsWith("subagent_")
    ) {
      stepSubagents.push({ part: part as ToolUIPart, index });
    } else {
      flush();
      groups.push({ type: "single", part, index });
    }
  });
  flush();

  if (knowledgeImages.length && !insertedKnowledgeImages) {
    groups.push({
      type: "knowledge-images",
      images: knowledgeImages,
      anchorIndex: knowledgeImageAnchorIndex,
    });
  }

  return groups;
}
