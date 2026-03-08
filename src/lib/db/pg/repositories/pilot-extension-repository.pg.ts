import type { PilotBrowser } from "app-types/pilot";
import type {
  ChatMetadata,
  ChatModel,
  ChatThreadDetails,
} from "app-types/chat";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { generateUUID } from "lib/utils";
import { pgDb as db } from "../db.pg";
import {
  ChatMessageTable,
  ChatThreadTable,
  PilotExtensionAuthCodeTable,
  PilotExtensionSessionTable,
} from "../schema.pg";
import { pgChatRepository } from "./chat-repository.pg";

type PilotAuthCodeRow = typeof PilotExtensionAuthCodeTable.$inferSelect;
type PilotExtensionSessionRow = typeof PilotExtensionSessionTable.$inferSelect;
type PilotThreadSummaryRow = {
  id: string;
  title: string;
  createdAt: Date;
  lastMessageAt: Date;
  lastChatModel: ChatModel | null;
  lastAgentId: string | null;
};

export const pgPilotExtensionRepository = {
  async selectLatestThreadSelections(threadId: string): Promise<{
    lastChatModel: ChatModel | null;
    lastAgentId: string | null;
  }> {
    const messages = await db
      .select({
        metadata: ChatMessageTable.metadata,
      })
      .from(ChatMessageTable)
      .where(eq(ChatMessageTable.threadId, threadId))
      .orderBy(desc(ChatMessageTable.createdAt), desc(ChatMessageTable.id))
      .limit(25);

    let lastChatModel: ChatModel | null = null;
    let lastAgentId: string | null = null;

    for (const message of messages) {
      const metadata = message.metadata as ChatMetadata | null;
      if (!lastChatModel && metadata?.chatModel) {
        lastChatModel = metadata.chatModel;
      }
      if (!lastAgentId && metadata?.agentId) {
        lastAgentId = metadata.agentId;
      }
      if (lastChatModel && lastAgentId) {
        break;
      }
    }

    return {
      lastChatModel,
      lastAgentId,
    };
  },

  async createAuthCode(input: {
    userId: string;
    extensionId: string;
    browser: PilotBrowser;
    browserVersion?: string | null;
    codeHash: string;
    expiresAt: Date;
  }): Promise<PilotAuthCodeRow> {
    const [row] = await db
      .insert(PilotExtensionAuthCodeTable)
      .values({
        id: generateUUID(),
        userId: input.userId,
        extensionId: input.extensionId,
        browser: input.browser,
        browserVersion: input.browserVersion ?? null,
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
      })
      .returning();

    return row;
  },

  async consumeAuthCode(input: {
    codeHash: string;
    extensionId: string;
  }): Promise<PilotAuthCodeRow | null> {
    const now = new Date();
    const [row] = await db
      .update(PilotExtensionAuthCodeTable)
      .set({
        usedAt: now,
      })
      .where(
        and(
          eq(PilotExtensionAuthCodeTable.codeHash, input.codeHash),
          eq(PilotExtensionAuthCodeTable.extensionId, input.extensionId),
          isNull(PilotExtensionAuthCodeTable.usedAt),
          gt(PilotExtensionAuthCodeTable.expiresAt, now),
        ),
      )
      .returning();

    return row ?? null;
  },

  async createSession(input: {
    userId: string;
    extensionId: string;
    browser: PilotBrowser;
    browserVersion?: string | null;
    accessTokenHash: string;
    refreshTokenHash: string;
    accessTokenExpiresAt: Date;
    refreshTokenExpiresAt: Date;
  }): Promise<PilotExtensionSessionRow> {
    const now = new Date();
    const [row] = await db
      .insert(PilotExtensionSessionTable)
      .values({
        id: generateUUID(),
        userId: input.userId,
        extensionId: input.extensionId,
        browser: input.browser,
        browserVersion: input.browserVersion ?? null,
        accessTokenHash: input.accessTokenHash,
        refreshTokenHash: input.refreshTokenHash,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        refreshTokenExpiresAt: input.refreshTokenExpiresAt,
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return row;
  },

  async selectActiveSessionByAccessTokenHash(
    accessTokenHash: string,
  ): Promise<PilotExtensionSessionRow | null> {
    const now = new Date();
    const [row] = await db
      .select()
      .from(PilotExtensionSessionTable)
      .where(
        and(
          eq(PilotExtensionSessionTable.accessTokenHash, accessTokenHash),
          isNull(PilotExtensionSessionTable.revokedAt),
          gt(PilotExtensionSessionTable.accessTokenExpiresAt, now),
        ),
      );

    return row ?? null;
  },

  async touchSession(id: string): Promise<void> {
    const now = new Date();
    await db
      .update(PilotExtensionSessionTable)
      .set({
        lastUsedAt: now,
        updatedAt: now,
      })
      .where(eq(PilotExtensionSessionTable.id, id));
  },

  async selectActiveSessionByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<PilotExtensionSessionRow | null> {
    const now = new Date();
    const [row] = await db
      .select()
      .from(PilotExtensionSessionTable)
      .where(
        and(
          eq(PilotExtensionSessionTable.refreshTokenHash, refreshTokenHash),
          isNull(PilotExtensionSessionTable.revokedAt),
          gt(PilotExtensionSessionTable.refreshTokenExpiresAt, now),
        ),
      );

    return row ?? null;
  },

  async rotateSessionTokens(
    id: string,
    input: {
      accessTokenHash: string;
      refreshTokenHash: string;
      accessTokenExpiresAt: Date;
      refreshTokenExpiresAt: Date;
    },
  ): Promise<PilotExtensionSessionRow | null> {
    const now = new Date();
    const [row] = await db
      .update(PilotExtensionSessionTable)
      .set({
        accessTokenHash: input.accessTokenHash,
        refreshTokenHash: input.refreshTokenHash,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        refreshTokenExpiresAt: input.refreshTokenExpiresAt,
        lastUsedAt: now,
        updatedAt: now,
      })
      .where(eq(PilotExtensionSessionTable.id, id))
      .returning();

    return row ?? null;
  },

  async revokeSessionById(id: string): Promise<void> {
    const now = new Date();
    await db
      .update(PilotExtensionSessionTable)
      .set({
        revokedAt: now,
        updatedAt: now,
      })
      .where(eq(PilotExtensionSessionTable.id, id));
  },

  async revokeSessionsByUserId(userId: string): Promise<void> {
    const now = new Date();
    await db
      .update(PilotExtensionSessionTable)
      .set({
        revokedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(PilotExtensionSessionTable.userId, userId),
          isNull(PilotExtensionSessionTable.revokedAt),
        ),
      );
  },

  async revokeSessionByUserAndId(userId: string, id: string): Promise<void> {
    const now = new Date();
    await db
      .update(PilotExtensionSessionTable)
      .set({
        revokedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(PilotExtensionSessionTable.userId, userId),
          eq(PilotExtensionSessionTable.id, id),
        ),
      );
  },

  async listSessionsByUserId(
    userId: string,
  ): Promise<PilotExtensionSessionRow[]> {
    return await db
      .select()
      .from(PilotExtensionSessionTable)
      .where(eq(PilotExtensionSessionTable.userId, userId))
      .orderBy(desc(PilotExtensionSessionTable.lastUsedAt));
  },

  async selectPilotThreadsByUserId(
    userId: string,
  ): Promise<PilotThreadSummaryRow[]> {
    const pilotThreadIds = await db
      .select({
        threadId: ChatMessageTable.threadId,
      })
      .from(ChatMessageTable)
      .innerJoin(
        ChatThreadTable,
        eq(ChatMessageTable.threadId, ChatThreadTable.id),
      )
      .where(
        and(
          eq(ChatThreadTable.userId, userId),
          sql`COALESCE(${ChatMessageTable.metadata} ->> 'source', 'chat') = 'emma_pilot'`,
        ),
      )
      .groupBy(ChatMessageTable.threadId);

    if (!pilotThreadIds.length) {
      return [];
    }

    const threadIds = pilotThreadIds.map((row) => row.threadId);
    const threads = await db
      .select({
        id: ChatThreadTable.id,
        title: ChatThreadTable.title,
        createdAt: ChatThreadTable.createdAt,
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
      .where(inArray(ChatThreadTable.id, threadIds))
      .groupBy(ChatThreadTable.id)
      .orderBy(
        desc(
          sql`COALESCE(MAX(${ChatMessageTable.createdAt}), ${ChatThreadTable.createdAt})`,
        ),
      );

    return await Promise.all(
      threads.map(async (thread) => {
        const selections =
          await pgPilotExtensionRepository.selectLatestThreadSelections(
            thread.id,
          );
        return {
          id: thread.id,
          title: thread.title,
          createdAt: thread.createdAt,
          lastMessageAt: new Date(thread.lastMessageAt),
          lastChatModel: selections.lastChatModel,
          lastAgentId: selections.lastAgentId,
        };
      }),
    );
  },

  async selectPilotThreadDetailsByUserId(
    userId: string,
    threadId: string,
  ): Promise<
    | (ChatThreadDetails & {
        lastChatModel: ChatModel | null;
        lastAgentId: string | null;
      })
    | null
  > {
    const thread = await pgChatRepository.selectThreadDetails(threadId);
    if (!thread || thread.userId !== userId) {
      return null;
    }

    const [pilotMarker] = await db
      .select({
        id: ChatMessageTable.id,
      })
      .from(ChatMessageTable)
      .where(
        and(
          eq(ChatMessageTable.threadId, threadId),
          sql`COALESCE(${ChatMessageTable.metadata} ->> 'source', 'chat') = 'emma_pilot'`,
        ),
      )
      .limit(1);

    if (!pilotMarker) {
      return null;
    }

    const selections =
      await pgPilotExtensionRepository.selectLatestThreadSelections(threadId);

    return {
      ...thread,
      lastChatModel: selections.lastChatModel,
      lastAgentId: selections.lastAgentId,
    };
  },

  async selectLatestPilotThreadByUserId(userId: string): Promise<{
    id: string;
    title: string;
    createdAt: Date;
    lastMessageAt: Date;
  } | null> {
    const [row] = await db
      .select({
        id: ChatThreadTable.id,
        title: ChatThreadTable.title,
        createdAt: ChatThreadTable.createdAt,
        lastMessageAt: ChatMessageTable.createdAt,
      })
      .from(ChatThreadTable)
      .innerJoin(
        ChatMessageTable,
        eq(ChatThreadTable.id, ChatMessageTable.threadId),
      )
      .where(
        and(
          eq(ChatThreadTable.userId, userId),
          sql`COALESCE(${ChatMessageTable.metadata} ->> 'source', 'chat') = 'emma_pilot'`,
        ),
      )
      .orderBy(desc(ChatMessageTable.createdAt))
      .limit(1);

    return row ?? null;
  },
};
