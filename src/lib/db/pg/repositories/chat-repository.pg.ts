import {
  ChatModel,
  ChatThreadCompactionCheckpoint,
  ChatThreadCompactionState,
  ChatMessage,
  ChatMessageFeedback,
  ChatFeedbackType,
  ChatRepository,
  ChatThreadDetails,
  ChatThread,
  PaginatedChatThreads,
  ChatThreadListItem,
} from "app-types/chat";

import { pgDb as db } from "../db.pg";
import {
  ChatMessageTable,
  ChatThreadTable,
  UserTable,
  ArchiveItemTable,
  ChatMessageFeedbackTable,
  ChatThreadCompactionCheckpointTable,
  ChatThreadCompactionStateTable,
} from "../schema.pg";

import { and, count, desc, eq, gte, sql } from "drizzle-orm";

async function invalidateCheckpointIfMessageIsCompacted(messageId: string) {
  const [message] = await db
    .select({
      id: ChatMessageTable.id,
      threadId: ChatMessageTable.threadId,
    })
    .from(ChatMessageTable)
    .where(eq(ChatMessageTable.id, messageId));

  if (!message) return;

  const checkpoint = await pgChatRepository.selectCompactionCheckpoint(
    message.threadId,
  );
  if (!checkpoint || checkpoint.compactedMessageCount < 1) return;

  const orderedMessageIds = await db
    .select({ id: ChatMessageTable.id })
    .from(ChatMessageTable)
    .where(eq(ChatMessageTable.threadId, message.threadId))
    .orderBy(ChatMessageTable.createdAt, ChatMessageTable.id);

  const messageIndex = orderedMessageIds.findIndex(
    (item) => item.id === message.id,
  );
  if (messageIndex !== -1 && messageIndex < checkpoint.compactedMessageCount) {
    await pgChatRepository.deleteCompactionCheckpoint(message.threadId);
  }
}

export const pgChatRepository: ChatRepository = {
  insertThread: async (
    thread: Omit<ChatThread, "createdAt">,
  ): Promise<ChatThread> => {
    const [result] = await db
      .insert(ChatThreadTable)
      .values({
        title: thread.title,
        userId: thread.userId,
        id: thread.id,
        snowflakeThreadId: thread.snowflakeThreadId ?? null,
        snowflakeParentMessageId: thread.snowflakeParentMessageId ?? null,
        a2aAgentId: thread.a2aAgentId ?? null,
        a2aContextId: thread.a2aContextId ?? null,
        a2aTaskId: thread.a2aTaskId ?? null,
        createdAt: new Date(),
      })
      .returning();
    return result;
  },

  deleteChatMessage: async (id: string): Promise<void> => {
    await invalidateCheckpointIfMessageIsCompacted(id);
    await db.delete(ChatMessageTable).where(eq(ChatMessageTable.id, id));
  },

  selectThread: async (id: string): Promise<ChatThread | null> => {
    const [result] = await db
      .select()
      .from(ChatThreadTable)
      .where(eq(ChatThreadTable.id, id));
    return result;
  },

  selectThreadDetails: async (
    id: string,
    options?: {
      messageOffset?: number;
      messageLimit?: number;
    },
  ): Promise<ChatThreadDetails | null> => {
    if (!id) {
      return null;
    }
    const [thread] = await db
      .select()
      .from(ChatThreadTable)
      .leftJoin(UserTable, eq(ChatThreadTable.userId, UserTable.id))
      .where(eq(ChatThreadTable.id, id));

    if (!thread) {
      return null;
    }

    const messages = await pgChatRepository.selectMessagesByThreadId(id, {
      offset: options?.messageOffset,
      limit: options?.messageLimit,
    });
    const compactionCheckpoint =
      await pgChatRepository.selectCompactionCheckpoint(id);
    const compactionState = await pgChatRepository.selectCompactionState(id);
    return {
      id: thread.chat_thread.id,
      title: thread.chat_thread.title,
      userId: thread.chat_thread.userId,
      createdAt: thread.chat_thread.createdAt,
      snowflakeThreadId: thread.chat_thread.snowflakeThreadId,
      snowflakeParentMessageId: thread.chat_thread.snowflakeParentMessageId,
      a2aAgentId: thread.chat_thread.a2aAgentId,
      a2aContextId: thread.chat_thread.a2aContextId,
      a2aTaskId: thread.chat_thread.a2aTaskId,
      userPreferences: thread.user?.preferences ?? undefined,
      messages,
      compactionCheckpoint,
      compactionState,
    };
  },

  selectMessagesByThreadId: async (
    threadId: string,
    options?: {
      offset?: number;
      limit?: number;
    },
  ): Promise<ChatMessage[]> => {
    let query = db
      .select()
      .from(ChatMessageTable)
      .where(eq(ChatMessageTable.threadId, threadId))
      .orderBy(ChatMessageTable.createdAt, ChatMessageTable.id);
    if (options?.offset && options.offset > 0) {
      query = query.offset(options.offset) as typeof query;
    }
    if (options?.limit && options.limit > 0) {
      query = query.limit(options.limit) as typeof query;
    }
    const result = await query;
    return result as ChatMessage[];
  },

  selectMessageById: async (messageId: string): Promise<ChatMessage | null> => {
    const [result] = await db
      .select()
      .from(ChatMessageTable)
      .where(eq(ChatMessageTable.id, messageId));

    return (result as ChatMessage | undefined) ?? null;
  },

  selectCompactionCheckpoint: async (
    threadId: string,
  ): Promise<ChatThreadCompactionCheckpoint | null> => {
    const [checkpoint] = await db
      .select()
      .from(ChatThreadCompactionCheckpointTable)
      .where(eq(ChatThreadCompactionCheckpointTable.threadId, threadId));

    return (checkpoint as ChatThreadCompactionCheckpoint | undefined) ?? null;
  },

  selectCompactionState: async (
    threadId: string,
  ): Promise<ChatThreadCompactionState | null> => {
    const [state] = await db
      .select()
      .from(ChatThreadCompactionStateTable)
      .where(eq(ChatThreadCompactionStateTable.threadId, threadId));

    return (state as ChatThreadCompactionState | undefined) ?? null;
  },

  selectLatestThreadChatModel: async (
    threadId: string,
  ): Promise<ChatModel | null> => {
    const messages = await db
      .select({
        metadata: ChatMessageTable.metadata,
      })
      .from(ChatMessageTable)
      .where(eq(ChatMessageTable.threadId, threadId))
      .orderBy(desc(ChatMessageTable.createdAt), desc(ChatMessageTable.id));

    for (const message of messages) {
      const chatModel = (message.metadata as ChatMessage["metadata"])
        ?.chatModel as ChatModel | undefined;
      if (chatModel?.provider && chatModel?.model) {
        return chatModel;
      }
    }

    return null;
  },

  selectThreadsByUserId: async (
    userId: string,
  ): Promise<ChatThreadListItem[]> => {
    const page = await pgChatRepository.selectThreadsPageByUserId(userId, {
      limit: 500,
      offset: 0,
    });
    return page.items;
  },

  selectThreadsPageByUserId: async (
    userId: string,
    input: {
      limit: number;
      offset: number;
    },
  ): Promise<PaginatedChatThreads> => {
    const limit = Math.max(1, Math.min(input.limit, 100));
    const offset = Math.max(0, input.offset);
    const threadWithLatestMessage = await db
      .select({
        threadId: ChatThreadTable.id,
        title: ChatThreadTable.title,
        createdAt: ChatThreadTable.createdAt,
        userId: ChatThreadTable.userId,
        lastMessageAt:
          sql<string>`COALESCE(MAX(${ChatMessageTable.createdAt}), ${ChatThreadTable.createdAt})`.as(
            "last_message_at",
          ),
      })
      .from(ChatThreadTable)
      .leftJoin(
        ChatMessageTable,
        eq(ChatThreadTable.id, ChatMessageTable.threadId),
      )
      .where(eq(ChatThreadTable.userId, userId))
      .groupBy(ChatThreadTable.id)
      .orderBy(
        desc(
          sql`COALESCE(MAX(${ChatMessageTable.createdAt}), ${ChatThreadTable.createdAt})`,
        ),
      )
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({
        total: count(ChatThreadTable.id),
      })
      .from(ChatThreadTable)
      .where(eq(ChatThreadTable.userId, userId));

    const items = threadWithLatestMessage.map((row) => {
      return {
        id: row.threadId,
        title: row.title,
        userId: row.userId,
        createdAt: row.createdAt,
        lastMessageAt: row.lastMessageAt
          ? new Date(row.lastMessageAt).getTime()
          : new Date(row.createdAt).getTime(),
      };
    });

    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    };
  },

  updateThread: async (
    id: string,
    thread: Partial<Omit<ChatThread, "id" | "createdAt">>,
  ): Promise<ChatThread> => {
    // Build the set object using explicit Drizzle column references so the ORM
    // correctly maps each field to its SQL column name.  A plain
    // Record<string,unknown> is NOT processed by Drizzle — it silently ignores
    // keys it cannot type-check against the table schema.
    const set: Partial<typeof ChatThreadTable.$inferInsert> = {};
    if (thread.title !== undefined) set.title = thread.title;
    if (thread.snowflakeThreadId !== undefined)
      set.snowflakeThreadId = thread.snowflakeThreadId;
    if (thread.snowflakeParentMessageId !== undefined)
      set.snowflakeParentMessageId = thread.snowflakeParentMessageId;
    if (thread.a2aAgentId !== undefined) set.a2aAgentId = thread.a2aAgentId;
    if (thread.a2aContextId !== undefined)
      set.a2aContextId = thread.a2aContextId;
    if (thread.a2aTaskId !== undefined) set.a2aTaskId = thread.a2aTaskId;

    const [result] = await db
      .update(ChatThreadTable)
      .set(set)
      .where(eq(ChatThreadTable.id, id))
      .returning();
    return result;
  },
  upsertThread: async (
    thread: Omit<ChatThread, "createdAt">,
  ): Promise<ChatThread> => {
    const [result] = await db
      .insert(ChatThreadTable)
      .values(thread)
      .onConflictDoUpdate({
        target: [ChatThreadTable.id],
        set: {
          title: thread.title,
          snowflakeThreadId: thread.snowflakeThreadId ?? null,
          snowflakeParentMessageId: thread.snowflakeParentMessageId ?? null,
          a2aAgentId: thread.a2aAgentId ?? null,
          a2aContextId: thread.a2aContextId ?? null,
          a2aTaskId: thread.a2aTaskId ?? null,
        },
      })
      .returning();
    return result;
  },

  deleteThread: async (id: string): Promise<void> => {
    // 1. Delete all messages in the thread
    await db.delete(ChatMessageTable).where(eq(ChatMessageTable.threadId, id));

    // 2. Remove thread from all archives
    await db.delete(ArchiveItemTable).where(eq(ArchiveItemTable.itemId, id));

    // 3. Delete the thread itself
    await db.delete(ChatThreadTable).where(eq(ChatThreadTable.id, id));
  },

  insertMessage: async (
    message: Omit<ChatMessage, "createdAt">,
  ): Promise<ChatMessage> => {
    const entity = {
      ...message,
      id: message.id,
    };
    const [result] = await db
      .insert(ChatMessageTable)
      .values(entity)
      .returning();
    return result as ChatMessage;
  },

  upsertMessage: async (
    message: Omit<ChatMessage, "createdAt">,
  ): Promise<ChatMessage> => {
    const result = await db
      .insert(ChatMessageTable)
      .values(message)
      .onConflictDoUpdate({
        target: [ChatMessageTable.id],
        set: {
          parts: message.parts,
          metadata: message.metadata,
        },
      })
      .returning();
    return result[0] as ChatMessage;
  },

  upsertCompactionCheckpoint: async (
    checkpoint,
  ): Promise<ChatThreadCompactionCheckpoint> => {
    const values = {
      id: checkpoint.id,
      threadId: checkpoint.threadId,
      schemaVersion: checkpoint.schemaVersion,
      summaryJson: checkpoint.summaryJson,
      summaryText: checkpoint.summaryText,
      compactedMessageCount: checkpoint.compactedMessageCount,
      sourceTokenCount: checkpoint.sourceTokenCount,
      summaryTokenCount: checkpoint.summaryTokenCount,
      modelProvider: checkpoint.modelProvider,
      modelName: checkpoint.modelName,
      updatedAt: new Date(),
    };

    const [result] = await db
      .insert(ChatThreadCompactionCheckpointTable)
      .values(values)
      .onConflictDoUpdate({
        target: [ChatThreadCompactionCheckpointTable.threadId],
        set: {
          schemaVersion: values.schemaVersion,
          summaryJson: values.summaryJson,
          summaryText: values.summaryText,
          compactedMessageCount: values.compactedMessageCount,
          sourceTokenCount: values.sourceTokenCount,
          summaryTokenCount: values.summaryTokenCount,
          modelProvider: values.modelProvider,
          modelName: values.modelName,
          updatedAt: values.updatedAt,
        },
      })
      .returning();

    return result as ChatThreadCompactionCheckpoint;
  },

  upsertCompactionState: async (state): Promise<ChatThreadCompactionState> => {
    const values = {
      id: state.id,
      threadId: state.threadId,
      status: state.status,
      source: state.source,
      beforeTokens: state.beforeTokens ?? null,
      afterTokens: state.afterTokens ?? null,
      failureCode: state.failureCode ?? null,
      startedAt: state.startedAt ?? null,
      finishedAt: state.finishedAt ?? null,
      updatedAt: new Date(),
    };

    const [result] = await db
      .insert(ChatThreadCompactionStateTable)
      .values(values)
      .onConflictDoUpdate({
        target: [ChatThreadCompactionStateTable.threadId],
        set: {
          status: values.status,
          source: values.source,
          beforeTokens: values.beforeTokens,
          afterTokens: values.afterTokens,
          failureCode: values.failureCode,
          startedAt: values.startedAt,
          finishedAt: values.finishedAt,
          updatedAt: values.updatedAt,
        },
      })
      .returning();

    return result as ChatThreadCompactionState;
  },

  deleteCompactionCheckpoint: async (threadId: string): Promise<void> => {
    await db
      .delete(ChatThreadCompactionCheckpointTable)
      .where(eq(ChatThreadCompactionCheckpointTable.threadId, threadId));
  },

  copyCompactionCheckpoint: async (
    sourceThreadId: string,
    targetThreadId: string,
  ): Promise<ChatThreadCompactionCheckpoint | null> => {
    const checkpoint =
      await pgChatRepository.selectCompactionCheckpoint(sourceThreadId);

    if (!checkpoint) return null;

    return await pgChatRepository.upsertCompactionCheckpoint({
      threadId: targetThreadId,
      schemaVersion: checkpoint.schemaVersion,
      summaryJson: checkpoint.summaryJson,
      summaryText: checkpoint.summaryText,
      compactedMessageCount: checkpoint.compactedMessageCount,
      sourceTokenCount: checkpoint.sourceTokenCount,
      summaryTokenCount: checkpoint.summaryTokenCount,
      modelProvider: checkpoint.modelProvider,
      modelName: checkpoint.modelName,
    });
  },

  deleteMessagesByChatIdAfterTimestamp: async (
    messageId: string,
  ): Promise<void> => {
    await invalidateCheckpointIfMessageIsCompacted(messageId);

    const [message] = await db
      .select()
      .from(ChatMessageTable)
      .where(eq(ChatMessageTable.id, messageId));
    if (!message) {
      return;
    }
    // Delete messages that are in the same thread AND created before or at the same time as the target message
    await db
      .delete(ChatMessageTable)
      .where(
        and(
          eq(ChatMessageTable.threadId, message.threadId),
          gte(ChatMessageTable.createdAt, message.createdAt),
        ),
      );
  },

  selectThreadIdByMessageId: async (
    messageId: string,
  ): Promise<string | null> => {
    const [result] = await db
      .select({ threadId: ChatMessageTable.threadId })
      .from(ChatMessageTable)
      .where(eq(ChatMessageTable.id, messageId));

    return result?.threadId ?? null;
  },

  deleteAllThreads: async (userId: string): Promise<void> => {
    const threadIds = await db
      .select({ id: ChatThreadTable.id })
      .from(ChatThreadTable)
      .where(eq(ChatThreadTable.userId, userId));
    await Promise.all(
      threadIds.map((threadId) => pgChatRepository.deleteThread(threadId.id)),
    );
  },

  deleteUnarchivedThreads: async (userId: string): Promise<void> => {
    const unarchivedThreadIds = await db
      .select({ id: ChatThreadTable.id })
      .from(ChatThreadTable)
      .leftJoin(
        ArchiveItemTable,
        eq(ChatThreadTable.id, ArchiveItemTable.itemId),
      )
      .where(
        and(
          eq(ChatThreadTable.userId, userId),
          sql`${ArchiveItemTable.id} IS NULL`,
        ),
      );

    await Promise.all(
      unarchivedThreadIds.map((threadId) =>
        pgChatRepository.deleteThread(threadId.id),
      ),
    );
  },

  insertMessages: async (
    messages: PartialBy<ChatMessage, "createdAt">[],
  ): Promise<ChatMessage[]> => {
    const result = await db
      .insert(ChatMessageTable)
      .values(messages)
      .returning();
    return result as ChatMessage[];
  },

  checkAccess: async (id: string, userId: string): Promise<boolean> => {
    const [result] = await db
      .select({
        userId: ChatThreadTable.userId,
      })
      .from(ChatThreadTable)
      .where(
        and(eq(ChatThreadTable.id, id), eq(ChatThreadTable.userId, userId)),
      );
    return Boolean(result);
  },

  upsertMessageFeedback: async (
    messageId: string,
    userId: string,
    type: ChatFeedbackType,
    reason?: string,
  ): Promise<ChatMessageFeedback> => {
    const [result] = await db
      .insert(ChatMessageFeedbackTable)
      .values({
        messageId,
        userId,
        type,
        reason: reason ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          ChatMessageFeedbackTable.messageId,
          ChatMessageFeedbackTable.userId,
        ],
        set: {
          type,
          reason: reason ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result as ChatMessageFeedback;
  },

  getMessageFeedback: async (
    messageId: string,
    userId: string,
  ): Promise<ChatMessageFeedback | null> => {
    const [result] = await db
      .select()
      .from(ChatMessageFeedbackTable)
      .where(
        and(
          eq(ChatMessageFeedbackTable.messageId, messageId),
          eq(ChatMessageFeedbackTable.userId, userId),
        ),
      );
    return (result as ChatMessageFeedback) ?? null;
  },

  deleteMessageFeedback: async (
    messageId: string,
    userId: string,
  ): Promise<void> => {
    await db
      .delete(ChatMessageFeedbackTable)
      .where(
        and(
          eq(ChatMessageFeedbackTable.messageId, messageId),
          eq(ChatMessageFeedbackTable.userId, userId),
        ),
      );
  },
};
