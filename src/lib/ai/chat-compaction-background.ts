import { UIMessage } from "ai";
import { chatRepository } from "lib/db/repository";
import { getDbModel } from "./provider-factory";
import {
  buildPersistedHistoryCompactionCandidate,
  CONTEXT_COMPACTION_TRIGGER_RATIO,
  generateCompactionCheckpoint,
  stripAttachmentPreviewPartsFromMessages,
} from "./chat-compaction";
import { enqueueChatCompaction } from "./chat-compaction-worker-client";

export async function updateThreadCompactionState(input: {
  threadId: string;
  status: "queued" | "running" | "completed" | "failed";
  source: "background" | "pre-send";
  beforeTokens?: number | null;
  afterTokens?: number | null;
  failureCode?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}) {
  await chatRepository.upsertCompactionState({
    threadId: input.threadId,
    status: input.status,
    source: input.source,
    beforeTokens: input.beforeTokens ?? null,
    afterTokens: input.afterTokens ?? null,
    failureCode: input.failureCode ?? null,
    startedAt: input.startedAt ?? null,
    finishedAt: input.finishedAt ?? null,
  });
}

export async function runBackgroundThreadCompaction(
  threadId: string,
): Promise<void> {
  const thread = await chatRepository.selectThreadDetails(threadId);
  if (!thread) return;

  const chatModel = await chatRepository.selectLatestThreadChatModel(threadId);
  if (!chatModel) {
    await updateThreadCompactionState({
      threadId,
      source: "background",
      status: "failed",
      failureCode: "missing_chat_model",
      finishedAt: new Date(),
    });
    return;
  }

  const dbModelResult = await getDbModel(chatModel);
  if (!dbModelResult || dbModelResult.contextLength <= 0) {
    await updateThreadCompactionState({
      threadId,
      source: "background",
      status: "failed",
      failureCode: "model_without_context_window",
      finishedAt: new Date(),
    });
    return;
  }

  const persistedMessages = stripAttachmentPreviewPartsFromMessages(
    thread.messages as UIMessage[],
  );
  const candidate = buildPersistedHistoryCompactionCandidate({
    persistedMessages,
    checkpoint: thread.compactionCheckpoint ?? null,
    contextLength: dbModelResult.contextLength,
  });
  const beforeTokens = candidate.totalTokens;

  if (
    beforeTokens / dbModelResult.contextLength <
      CONTEXT_COMPACTION_TRIGGER_RATIO ||
    candidate.compactableMessages.length === 0
  ) {
    await updateThreadCompactionState({
      threadId,
      source: "background",
      status: "completed",
      beforeTokens,
      afterTokens: beforeTokens,
      failureCode:
        candidate.compactableMessages.length === 0
          ? "no_compactable_history"
          : "below_trigger",
      finishedAt: new Date(),
    });
    return;
  }

  const startedAt = new Date();
  await updateThreadCompactionState({
    threadId,
    source: "background",
    status: "running",
    beforeTokens,
    startedAt,
    finishedAt: null,
    failureCode: null,
  });

  try {
    const checkpoint = await generateCompactionCheckpoint({
      model: dbModelResult.model,
      chatModel,
      checkpoint: thread.compactionCheckpoint ?? null,
      compactableMessages: candidate.compactableMessages,
      summaryBudgetTokens: candidate.summaryBudgetTokens,
      contextLength: dbModelResult.contextLength,
    });

    const savedCheckpoint = await chatRepository.upsertCompactionCheckpoint({
      threadId,
      ...checkpoint,
    });

    const after = buildPersistedHistoryCompactionCandidate({
      persistedMessages,
      checkpoint: savedCheckpoint,
      contextLength: dbModelResult.contextLength,
    });

    await updateThreadCompactionState({
      threadId,
      source: "background",
      status: "completed",
      beforeTokens,
      afterTokens: after.totalTokens,
      failureCode: null,
      startedAt,
      finishedAt: new Date(),
    });
  } catch (error) {
    await updateThreadCompactionState({
      threadId,
      source: "background",
      status: "failed",
      beforeTokens,
      afterTokens: beforeTokens,
      failureCode: "background_compaction_failed",
      startedAt,
      finishedAt: new Date(),
    });
    throw error;
  }
}

export async function enqueueOrRunBackgroundThreadCompaction(
  threadId: string,
): Promise<void> {
  const thread = await chatRepository.selectThreadDetails(threadId);
  if (!thread) return;

  const chatModel = await chatRepository.selectLatestThreadChatModel(threadId);
  if (!chatModel) return;

  const dbModelResult = await getDbModel(chatModel);
  if (!dbModelResult || dbModelResult.contextLength <= 0) {
    return;
  }

  const persistedMessages = stripAttachmentPreviewPartsFromMessages(
    thread.messages as UIMessage[],
  );
  const candidate = buildPersistedHistoryCompactionCandidate({
    persistedMessages,
    checkpoint: thread.compactionCheckpoint ?? null,
    contextLength: dbModelResult.contextLength,
  });

  if (
    candidate.totalTokens / dbModelResult.contextLength <
      CONTEXT_COMPACTION_TRIGGER_RATIO ||
    candidate.compactableMessages.length === 0
  ) {
    return;
  }

  await updateThreadCompactionState({
    threadId,
    source: "background",
    status: "queued",
    beforeTokens: candidate.totalTokens,
    failureCode: null,
    finishedAt: null,
  });

  try {
    await enqueueChatCompaction(threadId);
  } catch {
    runBackgroundThreadCompaction(threadId).catch((error) => {
      console.error(
        "[Chat Compaction] Inline background compaction failed:",
        threadId,
        error,
      );
    });
  }
}
