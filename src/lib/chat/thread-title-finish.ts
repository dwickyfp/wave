import { type TextUIPart, type UIMessage } from "ai";
import { truncateString } from "lib/utils";

type ThreadListItem = {
  id: string;
  title?: string | null;
};

export type ThreadTitleFinishAction =
  | {
      type: "generate";
      prompt: string;
    }
  | {
      type: "refresh-list";
    }
  | {
      type: "none";
    };

export function resolveThreadTitleFinishAction(input: {
  threadId: string;
  messages: UIMessage[];
  threadList: ThreadListItem[];
}): ThreadTitleFinishAction {
  const { threadId, messages, threadList } = input;
  const previousThread = threadList.find((value) => value.id === threadId);
  const dialogueMessages = messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );
  const isNewThread =
    !previousThread?.title &&
    dialogueMessages.filter((message) => message.role === "user").length ===
      1 &&
    dialogueMessages.some((message) => message.role === "assistant");

  if (isNewThread) {
    const promptParts = dialogueMessages
      .flatMap((message) =>
        message.parts
          .filter((part): part is TextUIPart => part.type === "text")
          .map(
            (part) =>
              `${message.role}: ${truncateString((part.text || "").trim(), 500)}`,
          )
          .filter((text) => text.trim().length > 0),
      )
      .slice(0, 2);

    if (promptParts.length > 0) {
      return {
        type: "generate",
        prompt: promptParts.join("\n\n"),
      };
    }

    return { type: "none" };
  }

  if (threadList[0]?.id !== threadId) {
    return { type: "refresh-list" };
  }

  return { type: "none" };
}
