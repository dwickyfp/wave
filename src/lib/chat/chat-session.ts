import type { ChatAttachment, ChatThreadDetails } from "app-types/chat";
import type { UIMessage } from "ai";
import { buildCsvIngestionPreviewParts } from "@/lib/ai/ingest/csv-ingest";
import { chatRepository } from "lib/db/repository";
import { serverFileStorage } from "lib/file-storage";
import { isUserOwnedStorageKey } from "lib/file-storage/upload-policy";

export async function ensureUserChatThread(input: {
  threadId: string;
  userId: string;
  historyMode?: "full" | "compacted-tail";
}): Promise<ChatThreadDetails> {
  const messageOffset =
    input.historyMode === "full"
      ? undefined
      : (await chatRepository.selectCompactionCheckpoint(input.threadId))
          ?.compactedMessageCount;

  let thread = await chatRepository.selectThreadDetails(input.threadId, {
    messageOffset,
  });

  if (!thread) {
    const newThread = await chatRepository.insertThread({
      id: input.threadId,
      title: "",
      userId: input.userId,
    });
    thread = await chatRepository.selectThreadDetails(newThread.id, {
      messageOffset,
    });
  }

  if (!thread) {
    throw new Error("Failed to initialize chat thread.");
  }

  if (thread.userId !== input.userId) {
    throw new Error("Forbidden");
  }

  return thread;
}

export async function applyChatAttachmentsToMessage(input: {
  message: UIMessage;
  attachments: ChatAttachment[];
  userId: string;
}) {
  const { message, attachments, userId } = input;
  const ingestionPreviewParts = await buildCsvIngestionPreviewParts(
    attachments,
    (key) => {
      if (!isUserOwnedStorageKey(key, userId)) {
        throw new Error("Unauthorized attachment");
      }
      return serverFileStorage.download(key);
    },
  );

  if (ingestionPreviewParts.length) {
    const baseParts = [...message.parts];
    let insertionIndex = -1;
    for (let i = baseParts.length - 1; i >= 0; i -= 1) {
      if (baseParts[i]?.type === "text") {
        insertionIndex = i;
        break;
      }
    }
    if (insertionIndex !== -1) {
      baseParts.splice(insertionIndex, 0, ...ingestionPreviewParts);
      message.parts = baseParts;
    } else {
      message.parts = [...baseParts, ...ingestionPreviewParts];
    }
  }

  if (!attachments.length) return;

  const firstTextIndex = message.parts.findIndex(
    (part: any) => part?.type === "text",
  );
  const attachmentParts: any[] = [];

  attachments.forEach((attachment) => {
    const exists = message.parts.some(
      (part: any) =>
        part?.type === attachment.type && part?.url === attachment.url,
    );
    if (exists) return;

    if (attachment.type === "file") {
      attachmentParts.push({
        type: "file",
        url: attachment.url,
        mediaType: attachment.mediaType,
        filename: attachment.filename,
      });
    } else if (attachment.type === "source-url") {
      attachmentParts.push({
        type: "source-url",
        url: attachment.url,
        mediaType: attachment.mediaType,
        title: attachment.filename,
      });
    }
  });

  if (!attachmentParts.length) return;

  if (firstTextIndex >= 0) {
    message.parts = [
      ...message.parts.slice(0, firstTextIndex),
      ...attachmentParts,
      ...message.parts.slice(firstTextIndex),
    ];
  } else {
    message.parts = [...message.parts, ...attachmentParts];
  }
}
