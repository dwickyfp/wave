import { type ToolUIPart, type UIMessage, getToolName, isToolUIPart } from "ai";
import type { ChatKnowledgeImage } from "app-types/chat";
import { DefaultToolName, ImageToolName } from "lib/ai/tools";
import { getMessageKnowledgeImages } from "lib/chat/knowledge-sources";

export type VoiceTurnToolState = {
  id: string;
  name: string;
  state: ToolUIPart["state"];
  messageId: string;
};

export type VoiceRenderableArtifact =
  | {
      kind: "tool";
      id: string;
      messageId: string;
      part: ToolUIPart;
    }
  | {
      kind: "knowledge-images";
      id: string;
      messageId: string;
      images: ChatKnowledgeImage[];
    }
  | {
      kind: "markdown-table";
      id: string;
      messageId: string;
      markdown: string;
    }
  | {
      kind: "image-file";
      id: string;
      messageId: string;
      part: Extract<UIMessage["parts"][number], { type: "file" }>;
    }
  | {
      kind: "image-source-url";
      id: string;
      messageId: string;
      part: {
        type: "source-url";
        url: string;
        title?: string;
        mediaType?: string;
      };
    };

export type VoiceLatestTurnModel = {
  latestUserMessage?: UIMessage;
  floatingPromptText: string;
  assistantMessages: UIMessage[];
  hiddenAssistantText: string;
  renderableArtifacts: VoiceRenderableArtifact[];
  hasRenderableArtifacts: boolean;
  runningToolStates: VoiceTurnToolState[];
};

export type VoiceArtifactGridLayout = {
  desktopColumns: 1 | 2 | 3;
  desktopRows: 0 | 1 | 2;
  overflow: boolean;
};

const PRESENTABLE_TOOL_NAMES = new Set<string>([
  DefaultToolName.CreatePieChart,
  DefaultToolName.CreateBarChart,
  DefaultToolName.CreateLineChart,
  DefaultToolName.CreateTable,
  ImageToolName,
]);

const IMAGE_FILE_PATTERN = /\.(avif|bmp|gif|jpe?g|png|svg|webp)(\?.*)?$/i;

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

function isMarkdownTableSeparatorLine(line: string) {
  const trimmed = line.trim();
  return /^\|?(?:\s*:?-{3,}:?\s*\|)+(?:\s*:?-{3,}:?\s*)\|?$/.test(trimmed);
}

function isMarkdownTableRowLine(line: string) {
  const trimmed = line.trim();
  return (
    Boolean(trimmed) && trimmed.includes("|") && !trimmed.startsWith("```")
  );
}

export function extractMarkdownTableBlocks(text: string) {
  const lines = text.split("\n");
  const tables: string[] = [];
  let index = 0;
  let inCodeFence = false;

  while (index < lines.length) {
    const currentLine = lines[index] ?? "";
    const trimmedLine = currentLine.trim();

    if (trimmedLine.startsWith("```")) {
      inCodeFence = !inCodeFence;
      index += 1;
      continue;
    }

    if (
      !inCodeFence &&
      isMarkdownTableRowLine(currentLine) &&
      isMarkdownTableSeparatorLine(lines[index + 1] ?? "")
    ) {
      const startIndex = index;
      let endIndex = index + 2;

      while (
        endIndex < lines.length &&
        isMarkdownTableRowLine(lines[endIndex] ?? "")
      ) {
        endIndex += 1;
      }

      tables.push(lines.slice(startIndex, endIndex).join("\n").trim());
      index = endIndex;
      continue;
    }

    index += 1;
  }

  return tables;
}

function isImageLikeSourceUrl(part: {
  url: string;
  mediaType?: string;
}) {
  return (
    part.mediaType?.startsWith("image/") ||
    IMAGE_FILE_PATTERN.test(part.url ?? "")
  );
}

function isPresentableToolPart(part: ToolUIPart) {
  return (
    part.state.startsWith("output") &&
    PRESENTABLE_TOOL_NAMES.has(getToolName(part))
  );
}

function buildRenderableArtifacts(
  message: UIMessage,
): VoiceRenderableArtifact[] {
  const artifacts: VoiceRenderableArtifact[] = [];

  message.parts.forEach((part, index) => {
    if (part.type === "text") {
      extractMarkdownTableBlocks(part.text).forEach((markdown, tableIndex) => {
        artifacts.push({
          kind: "markdown-table",
          id: `${message.id}-markdown-table-${index}-${tableIndex}`,
          messageId: message.id,
          markdown,
        });
      });
      return;
    }

    if (isToolUIPart(part) && isPresentableToolPart(part as ToolUIPart)) {
      artifacts.push({
        kind: "tool",
        id: `${message.id}-tool-${part.toolCallId}`,
        messageId: message.id,
        part: part as ToolUIPart,
      });
      return;
    }

    if (part.type === "file" && part.mediaType?.startsWith("image/")) {
      artifacts.push({
        kind: "image-file",
        id: `${message.id}-image-file-${index}`,
        messageId: message.id,
        part,
      });
      return;
    }

    if (
      (part as { type?: string }).type === "source-url" &&
      isImageLikeSourceUrl(
        part as { url: string; mediaType?: string; type: "source-url" },
      )
    ) {
      artifacts.push({
        kind: "image-source-url",
        id: `${message.id}-image-source-${index}`,
        messageId: message.id,
        part: part as {
          type: "source-url";
          url: string;
          title?: string;
          mediaType?: string;
        },
      });
    }
  });

  const knowledgeImages = getMessageKnowledgeImages(message);
  if (knowledgeImages.length > 0) {
    artifacts.push({
      kind: "knowledge-images",
      id: `${message.id}-knowledge-images`,
      messageId: message.id,
      images: knowledgeImages,
    });
  }

  return artifacts;
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
      floatingPromptText: "",
      assistantMessages: [],
      hiddenAssistantText: "",
      renderableArtifacts: [],
      hasRenderableArtifacts: false,
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

  const renderableArtifacts = assistantMessages.flatMap((message) =>
    buildRenderableArtifacts(message),
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
    floatingPromptText: getMessageText(latestUserMessage),
    assistantMessages,
    hiddenAssistantText: getMessageText(latestSummarySource),
    renderableArtifacts,
    hasRenderableArtifacts: renderableArtifacts.length > 0,
    runningToolStates,
  };
}

export function getVoiceArtifactGridLayout(
  count: number,
): VoiceArtifactGridLayout {
  if (count <= 0) {
    return {
      desktopColumns: 1,
      desktopRows: 0,
      overflow: false,
    };
  }

  if (count === 1) {
    return {
      desktopColumns: 1,
      desktopRows: 1,
      overflow: false,
    };
  }

  if (count === 2) {
    return {
      desktopColumns: 2,
      desktopRows: 1,
      overflow: false,
    };
  }

  if (count === 3) {
    return {
      desktopColumns: 3,
      desktopRows: 1,
      overflow: false,
    };
  }

  return {
    desktopColumns: 3,
    desktopRows: 2,
    overflow: count > 6,
  };
}
