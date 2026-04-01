import { type ToolUIPart, type UIMessage, isToolUIPart, getToolName } from "ai";
import type { ChatKnowledgeImage } from "app-types/chat";
import { getMessageKnowledgeImages } from "lib/chat/knowledge-sources";

export type VoiceTurnToolState = {
  id: string;
  name: string;
  state: ToolUIPart["state"];
  messageId: string;
};

export type VoiceArtifactEntry = {
  message: UIMessage;
  parts: UIMessage["parts"];
  knowledgeImages: ChatKnowledgeImage[];
};

export type VoiceLatestTurnModel = {
  latestUserMessage?: UIMessage;
  latestUserText: string;
  assistantMessages: UIMessage[];
  assistantSummaryText: string;
  artifactEntries: VoiceArtifactEntry[];
  runningToolStates: VoiceTurnToolState[];
};

export function getMessageText(message?: UIMessage) {
  if (!message) {
    return "";
  }

  return message.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function buildArtifactParts(message: UIMessage) {
  return message.parts.filter(
    (part) => part.type !== "text" && part.type !== "reasoning",
  );
}

export function buildVoiceLatestTurnModel(
  messages: UIMessage[],
): VoiceLatestTurnModel {
  const latestUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );

  if (latestUserIndex < 0) {
    return {
      latestUserMessage: undefined,
      latestUserText: "",
      assistantMessages: [],
      assistantSummaryText: "",
      artifactEntries: [],
      runningToolStates: [],
    };
  }

  const latestUserMessage = messages[latestUserIndex];
  const assistantMessages = messages
    .slice(latestUserIndex + 1)
    .filter((message) => message.role === "assistant");

  const latestSummarySource = [...assistantMessages]
    .reverse()
    .find((message) => getMessageText(message));

  const artifactEntries = assistantMessages
    .map((message) => ({
      message,
      parts: buildArtifactParts(message),
      knowledgeImages: getMessageKnowledgeImages(message),
    }))
    .filter(
      (entry) =>
        entry.parts.some((part) => part.type !== "step-start") ||
        entry.knowledgeImages.length > 0,
    );

  const runningToolStates = Array.from(
    new Map(
      assistantMessages
        .flatMap((message) =>
          message.parts
            .filter(isToolUIPart)
            .filter(
              (part) =>
                !part.providerExecuted && !part.state.startsWith("output"),
            )
            .map((part) => ({
              id: part.toolCallId,
              name: getToolName(part),
              state: part.state,
              messageId: message.id,
            })),
        )
        .map((toolState) => [toolState.id, toolState]),
    ).values(),
  );

  return {
    latestUserMessage,
    latestUserText: getMessageText(latestUserMessage),
    assistantMessages,
    assistantSummaryText: getMessageText(latestSummarySource),
    artifactEntries,
    runningToolStates,
  };
}
