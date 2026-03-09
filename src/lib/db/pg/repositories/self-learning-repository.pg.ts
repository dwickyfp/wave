import type {
  SelfLearningAuditAction,
  SelfLearningAuditLog,
  SelfLearningEvaluation,
  SelfLearningEvaluationStatus,
  SelfLearningMemory,
  SelfLearningMemoryCategory,
  SelfLearningMemoryStatus,
  SelfLearningOverview,
  SelfLearningRun,
  SelfLearningRunStatus,
  SelfLearningRunTrigger,
  SelfLearningSignalEvent,
  SelfLearningSignalPayload,
  SelfLearningSignalType,
  SelfLearningSystemConfig,
  SelfLearningUserConfig,
  SelfLearningUserRow,
  SelfLearningUsersPage,
} from "app-types/self-learning";
import {
  SELF_LEARNING_DEFAULTS,
  SelfLearningSystemConfigZodSchema,
} from "app-types/self-learning";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { pgDb as db } from "../db.pg";
import {
  ChatMessageFeedbackTable,
  ChatMessageTable,
  ChatThreadTable,
  KnowledgeGroupTable,
  SelfLearningAuditLogTable,
  SelfLearningEvaluationTable,
  SelfLearningMemoryTable,
  SelfLearningRunTable,
  SelfLearningSignalEventTable,
  SelfLearningUserConfigTable,
  UserTable,
} from "../schema.pg";

function mapUserConfig(
  row: typeof SelfLearningUserConfigTable.$inferSelect,
): SelfLearningUserConfig {
  return row as SelfLearningUserConfig;
}

function mapRun(
  row: typeof SelfLearningRunTable.$inferSelect,
): SelfLearningRun {
  return row as SelfLearningRun;
}

function mapSignal(
  row: typeof SelfLearningSignalEventTable.$inferSelect,
): SelfLearningSignalEvent {
  return row as SelfLearningSignalEvent;
}

function mapEvaluation(
  row: typeof SelfLearningEvaluationTable.$inferSelect,
): SelfLearningEvaluation {
  return row as SelfLearningEvaluation;
}

function mapMemory(
  row: typeof SelfLearningMemoryTable.$inferSelect,
): SelfLearningMemory {
  return row as SelfLearningMemory;
}

function mapAudit(
  row: typeof SelfLearningAuditLogTable.$inferSelect,
): SelfLearningAuditLog {
  return row as SelfLearningAuditLog;
}

function mapEmptyReason(
  value?: string | null,
): SelfLearningUserRow["emptyReason"] {
  switch (value) {
    case "no_chat_history":
    case "no_assistant_turns":
    case "all_recent_turns_already_evaluated":
    case "only_low_value_small_talk":
    case "no_candidates_after_filters":
      return value;
    default:
      return null;
  }
}

function mapUserRow(row: {
  userId: string;
  name: string | null;
  email: string;
  personalizationEnabled: boolean;
  threadCount: number | null;
  assistantTurnCount: number | null;
  evaluatedAssistantTurnCount: number | null;
  signalCount: number | null;
  eligibleCandidateCount: number | null;
  emptyReason?: string | null;
  evaluationCount: number | null;
  activeMemoryCount: number | null;
  lastRunAt?: Date | null;
  lastEvaluatedAt?: Date | null;
}): SelfLearningUserRow {
  return {
    userId: row.userId,
    name: row.name,
    email: row.email,
    personalizationEnabled: row.personalizationEnabled,
    threadCount: Number(row.threadCount ?? 0),
    assistantTurnCount: Number(row.assistantTurnCount ?? 0),
    evaluatedAssistantTurnCount: Number(row.evaluatedAssistantTurnCount ?? 0),
    signalCount: Number(row.signalCount ?? 0),
    eligibleCandidateCount: Number(row.eligibleCandidateCount ?? 0),
    emptyReason: mapEmptyReason(row.emptyReason),
    evaluationCount: Number(row.evaluationCount ?? 0),
    activeMemoryCount: Number(row.activeMemoryCount ?? 0),
    lastRunAt: row.lastRunAt ?? null,
    lastEvaluatedAt: row.lastEvaluatedAt ?? null,
  };
}

function buildUserSearchWhereClause(query?: string) {
  const trimmedQuery = query?.trim();

  if (!trimmedQuery) {
    return undefined;
  }

  return or(
    ilike(UserTable.email, `%${trimmedQuery}%`),
    ilike(UserTable.name, `%${trimmedQuery}%`),
  );
}

function buildUserRowSelect() {
  const signalCounts = db
    .select({
      userId: SelfLearningSignalEventTable.userId,
      signalCount:
        sql<number>`cast(count(${SelfLearningSignalEventTable.id}) as int)`.as(
          "signal_count",
        ),
    })
    .from(SelfLearningSignalEventTable)
    .groupBy(SelfLearningSignalEventTable.userId)
    .as("signal_counts");

  const pendingSignalCounts = db
    .select({
      userId: SelfLearningSignalEventTable.userId,
      pendingSignalCount:
        sql<number>`cast(count(${SelfLearningSignalEventTable.id}) as int)`.as(
          "pending_signal_count",
        ),
    })
    .from(SelfLearningSignalEventTable)
    .leftJoin(
      SelfLearningEvaluationTable,
      eq(
        SelfLearningEvaluationTable.signalEventId,
        SelfLearningSignalEventTable.id,
      ),
    )
    .where(isNull(SelfLearningEvaluationTable.id))
    .groupBy(SelfLearningSignalEventTable.userId)
    .as("pending_signal_counts");

  const threadCounts = db
    .select({
      userId: ChatThreadTable.userId,
      threadCount: sql<number>`cast(count(${ChatThreadTable.id}) as int)`.as(
        "thread_count",
      ),
    })
    .from(ChatThreadTable)
    .groupBy(ChatThreadTable.userId)
    .as("thread_counts");

  const assistantTurnCounts = db
    .select({
      userId: ChatThreadTable.userId,
      assistantTurnCount:
        sql<number>`cast(count(${ChatMessageTable.id}) as int)`.as(
          "assistant_turn_count",
        ),
    })
    .from(ChatThreadTable)
    .innerJoin(
      ChatMessageTable,
      and(
        eq(ChatMessageTable.threadId, ChatThreadTable.id),
        eq(ChatMessageTable.role, "assistant"),
      ),
    )
    .groupBy(ChatThreadTable.userId)
    .as("assistant_turn_counts");

  const evaluatedAssistantTurnCounts = db
    .select({
      userId: SelfLearningEvaluationTable.userId,
      evaluatedAssistantTurnCount:
        sql<number>`cast(count(distinct ${SelfLearningEvaluationTable.messageId}) as int)`.as(
          "evaluated_assistant_turn_count",
        ),
    })
    .from(SelfLearningEvaluationTable)
    .where(sql`${SelfLearningEvaluationTable.messageId} is not null`)
    .groupBy(SelfLearningEvaluationTable.userId)
    .as("evaluated_assistant_turn_counts");

  const evaluationCounts = db
    .select({
      userId: SelfLearningEvaluationTable.userId,
      evaluationCount:
        sql<number>`cast(count(${SelfLearningEvaluationTable.id}) as int)`.as(
          "evaluation_count",
        ),
    })
    .from(SelfLearningEvaluationTable)
    .groupBy(SelfLearningEvaluationTable.userId)
    .as("evaluation_counts");

  const activeMemoryCounts = db
    .select({
      userId: SelfLearningMemoryTable.userId,
      activeMemoryCount:
        sql<number>`cast(count(${SelfLearningMemoryTable.id}) as int)`.as(
          "active_memory_count",
        ),
    })
    .from(SelfLearningMemoryTable)
    .where(eq(SelfLearningMemoryTable.status, "active"))
    .groupBy(SelfLearningMemoryTable.userId)
    .as("active_memory_counts");

  const lastRuns = db
    .select({
      userId: SelfLearningRunTable.userId,
      lastRunAt: sql<Date>`max(${SelfLearningRunTable.createdAt})`.as(
        "last_run_at",
      ),
    })
    .from(SelfLearningRunTable)
    .groupBy(SelfLearningRunTable.userId)
    .as("last_runs");

  const estimatedEligibleCandidateCount = sql<number>`
    greatest(
      coalesce(${pendingSignalCounts.pendingSignalCount}, 0) +
      coalesce(${assistantTurnCounts.assistantTurnCount}, 0) -
      coalesce(${evaluatedAssistantTurnCounts.evaluatedAssistantTurnCount}, 0),
      0
    )
  `;

  return {
    query: db
      .select({
        userId: UserTable.id,
        name: UserTable.name,
        email: UserTable.email,
        personalizationEnabled: sql<boolean>`COALESCE(${SelfLearningUserConfigTable.personalizationEnabled}, true)`,
        threadCount: sql<number>`COALESCE(${threadCounts.threadCount}, 0)`,
        assistantTurnCount: sql<number>`COALESCE(${assistantTurnCounts.assistantTurnCount}, 0)`,
        evaluatedAssistantTurnCount: sql<number>`COALESCE(${evaluatedAssistantTurnCounts.evaluatedAssistantTurnCount}, 0)`,
        signalCount: sql<number>`COALESCE(${signalCounts.signalCount}, 0)`,
        eligibleCandidateCount: estimatedEligibleCandidateCount.as(
          "eligible_candidate_count",
        ),
        emptyReason: sql<string | null>`null`.as("empty_reason"),
        evaluationCount: sql<number>`COALESCE(${evaluationCounts.evaluationCount}, 0)`,
        activeMemoryCount: sql<number>`COALESCE(${activeMemoryCounts.activeMemoryCount}, 0)`,
        lastRunAt: lastRuns.lastRunAt,
        lastEvaluatedAt: SelfLearningUserConfigTable.lastEvaluatedAt,
      })
      .from(UserTable)
      .leftJoin(
        SelfLearningUserConfigTable,
        eq(SelfLearningUserConfigTable.userId, UserTable.id),
      )
      .leftJoin(threadCounts, eq(threadCounts.userId, UserTable.id))
      .leftJoin(
        assistantTurnCounts,
        eq(assistantTurnCounts.userId, UserTable.id),
      )
      .leftJoin(
        evaluatedAssistantTurnCounts,
        eq(evaluatedAssistantTurnCounts.userId, UserTable.id),
      )
      .leftJoin(signalCounts, eq(signalCounts.userId, UserTable.id))
      .leftJoin(
        pendingSignalCounts,
        eq(pendingSignalCounts.userId, UserTable.id),
      )
      .leftJoin(evaluationCounts, eq(evaluationCounts.userId, UserTable.id))
      .leftJoin(activeMemoryCounts, eq(activeMemoryCounts.userId, UserTable.id))
      .leftJoin(lastRuns, eq(lastRuns.userId, UserTable.id)),
    orderBy: {
      estimatedEligibleCandidateCount,
      threadCount: sql<number>`COALESCE(${threadCounts.threadCount}, 0)`,
      signalCount: sql<number>`COALESCE(${signalCounts.signalCount}, 0)`,
      displayName: sql`
        lower(
          coalesce(
            nullif(trim(${UserTable.name}), ''),
            ${UserTable.email}
          )
        )
      `,
    },
  };
}

export const pgSelfLearningRepository = {
  async getSystemConfig(raw: unknown): Promise<SelfLearningSystemConfig> {
    return SelfLearningSystemConfigZodSchema.parse({
      ...SELF_LEARNING_DEFAULTS,
      ...(raw && typeof raw === "object" ? raw : {}),
    });
  },

  async ensureUserConfig(userId: string): Promise<SelfLearningUserConfig> {
    const existing = await this.getUserConfig(userId);
    if (existing) return existing;

    const [row] = await db
      .insert(SelfLearningUserConfigTable)
      .values({
        userId,
        personalizationEnabled: true,
        updatedAt: new Date(),
      })
      .returning();

    return mapUserConfig(row);
  },

  async getUserConfig(userId: string): Promise<SelfLearningUserConfig | null> {
    const [row] = await db
      .select()
      .from(SelfLearningUserConfigTable)
      .where(eq(SelfLearningUserConfigTable.userId, userId));

    return row ? mapUserConfig(row) : null;
  },

  async upsertUserConfig(
    userId: string,
    data: Partial<
      Omit<SelfLearningUserConfig, "id" | "userId" | "createdAt" | "updatedAt">
    >,
  ): Promise<SelfLearningUserConfig> {
    const [row] = await db
      .insert(SelfLearningUserConfigTable)
      .values({
        userId,
        personalizationEnabled: data.personalizationEnabled ?? true,
        hiddenKnowledgeGroupId: data.hiddenKnowledgeGroupId ?? null,
        hiddenKnowledgeDocumentId: data.hiddenKnowledgeDocumentId ?? null,
        lastManualRunAt: data.lastManualRunAt ?? null,
        lastEvaluatedAt: data.lastEvaluatedAt ?? null,
        lastResetAt: data.lastResetAt ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: SelfLearningUserConfigTable.userId,
        set: {
          ...(data.personalizationEnabled !== undefined
            ? {
                personalizationEnabled: data.personalizationEnabled,
              }
            : {}),
          ...(data.hiddenKnowledgeGroupId !== undefined
            ? { hiddenKnowledgeGroupId: data.hiddenKnowledgeGroupId }
            : {}),
          ...(data.hiddenKnowledgeDocumentId !== undefined
            ? { hiddenKnowledgeDocumentId: data.hiddenKnowledgeDocumentId }
            : {}),
          ...(data.lastManualRunAt !== undefined
            ? { lastManualRunAt: data.lastManualRunAt }
            : {}),
          ...(data.lastEvaluatedAt !== undefined
            ? { lastEvaluatedAt: data.lastEvaluatedAt }
            : {}),
          ...(data.lastResetAt !== undefined
            ? { lastResetAt: data.lastResetAt }
            : {}),
          updatedAt: new Date(),
        },
      })
      .returning();

    return mapUserConfig(row);
  },

  async insertSignal(data: {
    userId: string;
    threadId?: string | null;
    messageId?: string | null;
    signalType: SelfLearningSignalType;
    value: number;
    payload?: SelfLearningSignalPayload | null;
  }): Promise<SelfLearningSignalEvent> {
    const [row] = await db
      .insert(SelfLearningSignalEventTable)
      .values({
        userId: data.userId,
        threadId: data.threadId ?? null,
        messageId: data.messageId ?? null,
        signalType: data.signalType,
        value: data.value,
        payload: data.payload ?? null,
      })
      .returning();

    return mapSignal(row);
  },

  async clearExplicitSignals(userId: string, messageId: string): Promise<void> {
    await db
      .delete(SelfLearningSignalEventTable)
      .where(
        and(
          eq(SelfLearningSignalEventTable.userId, userId),
          eq(SelfLearningSignalEventTable.messageId, messageId),
          inArray(SelfLearningSignalEventTable.signalType, [
            "feedback_like",
            "feedback_dislike",
          ]),
        ),
      );
  },

  async listSignalsForEvaluation(
    userId: string,
    limit = 25,
  ): Promise<SelfLearningSignalEvent[]> {
    const rows = await db
      .select({
        id: SelfLearningSignalEventTable.id,
        userId: SelfLearningSignalEventTable.userId,
        threadId: SelfLearningSignalEventTable.threadId,
        messageId: SelfLearningSignalEventTable.messageId,
        signalType: SelfLearningSignalEventTable.signalType,
        value: SelfLearningSignalEventTable.value,
        payload: SelfLearningSignalEventTable.payload,
        createdAt: SelfLearningSignalEventTable.createdAt,
      })
      .from(SelfLearningSignalEventTable)
      .leftJoin(
        SelfLearningEvaluationTable,
        eq(
          SelfLearningEvaluationTable.signalEventId,
          SelfLearningSignalEventTable.id,
        ),
      )
      .where(
        and(
          eq(SelfLearningSignalEventTable.userId, userId),
          isNull(SelfLearningEvaluationTable.id),
        ),
      )
      .orderBy(desc(SelfLearningSignalEventTable.createdAt))
      .limit(limit);

    return rows.map((row) => row as SelfLearningSignalEvent);
  },

  async createRun(data: {
    userId: string;
    trigger: SelfLearningRunTrigger;
    status?: SelfLearningRunStatus;
    metadata?: Record<string, unknown> | null;
  }): Promise<SelfLearningRun> {
    const [row] = await db
      .insert(SelfLearningRunTable)
      .values({
        userId: data.userId,
        trigger: data.trigger,
        status: data.status ?? "queued",
        metadata: data.metadata ?? null,
        updatedAt: new Date(),
      })
      .returning();

    return mapRun(row);
  },

  async updateRun(
    runId: string,
    data: Partial<
      Omit<SelfLearningRun, "id" | "userId" | "trigger" | "createdAt">
    >,
  ): Promise<SelfLearningRun | null> {
    const [row] = await db
      .update(SelfLearningRunTable)
      .set({
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.startedAt !== undefined ? { startedAt: data.startedAt } : {}),
        ...(data.finishedAt !== undefined
          ? { finishedAt: data.finishedAt }
          : {}),
        ...(data.totalCandidates !== undefined
          ? { totalCandidates: data.totalCandidates }
          : {}),
        ...(data.processedCandidates !== undefined
          ? { processedCandidates: data.processedCandidates }
          : {}),
        ...(data.appliedMemoryCount !== undefined
          ? { appliedMemoryCount: data.appliedMemoryCount }
          : {}),
        ...(data.skippedMemoryCount !== undefined
          ? { skippedMemoryCount: data.skippedMemoryCount }
          : {}),
        ...(data.errorMessage !== undefined
          ? { errorMessage: data.errorMessage }
          : {}),
        ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
        updatedAt: new Date(),
      })
      .where(eq(SelfLearningRunTable.id, runId))
      .returning();

    return row ? mapRun(row) : null;
  },

  async listRecentRuns(limit = 10): Promise<SelfLearningRun[]> {
    const rows = await db
      .select({
        run: SelfLearningRunTable,
        userName: UserTable.name,
        userEmail: UserTable.email,
      })
      .from(SelfLearningRunTable)
      .leftJoin(UserTable, eq(UserTable.id, SelfLearningRunTable.userId))
      .orderBy(desc(SelfLearningRunTable.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      ...mapRun(row.run),
      userName: row.userName,
      userEmail: row.userEmail,
    }));
  },

  async listRunsForUser(
    userId: string,
    limit = 20,
  ): Promise<SelfLearningRun[]> {
    const rows = await db
      .select({
        run: SelfLearningRunTable,
        userName: UserTable.name,
        userEmail: UserTable.email,
      })
      .from(SelfLearningRunTable)
      .leftJoin(UserTable, eq(UserTable.id, SelfLearningRunTable.userId))
      .where(eq(SelfLearningRunTable.userId, userId))
      .orderBy(desc(SelfLearningRunTable.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      ...mapRun(row.run),
      userName: row.userName,
      userEmail: row.userEmail,
    }));
  },

  async listQueuedRuns(limit = 50): Promise<SelfLearningRun[]> {
    const rows = await db
      .select()
      .from(SelfLearningRunTable)
      .where(eq(SelfLearningRunTable.status, "queued"))
      .orderBy(desc(SelfLearningRunTable.createdAt))
      .limit(limit);

    return rows.map(mapRun);
  },

  async insertEvaluation(data: {
    runId: string;
    userId: string;
    threadId?: string | null;
    messageId?: string | null;
    signalEventId?: string | null;
    status?: SelfLearningEvaluationStatus;
    explicitScore: number;
    implicitScore: number;
    llmScore: number;
    compositeScore: number;
    confidence: number;
    category?: SelfLearningMemoryCategory | null;
    candidateFingerprint?: string | null;
    candidateTitle?: string | null;
    candidateContent?: string | null;
    judgeOutput?: SelfLearningEvaluation["judgeOutput"];
    metrics?: Record<string, unknown> | null;
    appliedMemoryId?: string | null;
  }): Promise<SelfLearningEvaluation> {
    const [row] = await db
      .insert(SelfLearningEvaluationTable)
      .values({
        runId: data.runId,
        userId: data.userId,
        threadId: data.threadId ?? null,
        messageId: data.messageId ?? null,
        signalEventId: data.signalEventId ?? null,
        status: data.status ?? "proposed",
        explicitScore: data.explicitScore,
        implicitScore: data.implicitScore,
        llmScore: data.llmScore,
        compositeScore: data.compositeScore,
        confidence: data.confidence,
        category: data.category ?? null,
        candidateFingerprint: data.candidateFingerprint ?? null,
        candidateTitle: data.candidateTitle ?? null,
        candidateContent: data.candidateContent ?? null,
        judgeOutput: data.judgeOutput ?? null,
        metrics: data.metrics ?? null,
        appliedMemoryId: data.appliedMemoryId ?? null,
        updatedAt: new Date(),
      })
      .returning();

    return mapEvaluation(row);
  },

  async updateEvaluation(
    evaluationId: string,
    data: Partial<
      Omit<
        SelfLearningEvaluation,
        "id" | "runId" | "userId" | "threadId" | "messageId" | "createdAt"
      >
    >,
  ): Promise<SelfLearningEvaluation | null> {
    const [row] = await db
      .update(SelfLearningEvaluationTable)
      .set({
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.explicitScore !== undefined
          ? { explicitScore: data.explicitScore }
          : {}),
        ...(data.implicitScore !== undefined
          ? { implicitScore: data.implicitScore }
          : {}),
        ...(data.llmScore !== undefined ? { llmScore: data.llmScore } : {}),
        ...(data.compositeScore !== undefined
          ? { compositeScore: data.compositeScore }
          : {}),
        ...(data.confidence !== undefined
          ? { confidence: data.confidence }
          : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.candidateFingerprint !== undefined
          ? { candidateFingerprint: data.candidateFingerprint }
          : {}),
        ...(data.candidateTitle !== undefined
          ? { candidateTitle: data.candidateTitle }
          : {}),
        ...(data.candidateContent !== undefined
          ? { candidateContent: data.candidateContent }
          : {}),
        ...(data.judgeOutput !== undefined
          ? { judgeOutput: data.judgeOutput }
          : {}),
        ...(data.metrics !== undefined ? { metrics: data.metrics } : {}),
        ...(data.appliedMemoryId !== undefined
          ? { appliedMemoryId: data.appliedMemoryId }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(SelfLearningEvaluationTable.id, evaluationId))
      .returning();

    return row ? mapEvaluation(row) : null;
  },

  async listEvaluationsForUser(
    userId: string,
    limit = 50,
  ): Promise<SelfLearningEvaluation[]> {
    const rows = await db
      .select()
      .from(SelfLearningEvaluationTable)
      .where(eq(SelfLearningEvaluationTable.userId, userId))
      .orderBy(desc(SelfLearningEvaluationTable.createdAt))
      .limit(limit);

    return rows.map(mapEvaluation);
  },

  async listEvaluatedMessageIdsForUser(
    userId: string,
    messageIds: string[],
  ): Promise<string[]> {
    const filteredMessageIds = messageIds.filter(Boolean);

    if (filteredMessageIds.length === 0) {
      return [];
    }

    const rows = await db
      .select({
        messageId: SelfLearningEvaluationTable.messageId,
      })
      .from(SelfLearningEvaluationTable)
      .where(
        and(
          eq(SelfLearningEvaluationTable.userId, userId),
          inArray(SelfLearningEvaluationTable.messageId, filteredMessageIds),
        ),
      );

    return rows
      .map((row) => row.messageId)
      .filter((messageId): messageId is string => Boolean(messageId));
  },

  async getSupportStats(
    userId: string,
    fingerprint: string,
  ): Promise<{
    supportCount: number;
    distinctThreadCount: number;
  }> {
    const [row] = await db
      .select({
        supportCount: sql<number>`cast(count(${SelfLearningEvaluationTable.id}) as int)`,
        distinctThreadCount: sql<number>`cast(count(distinct ${SelfLearningEvaluationTable.threadId}) as int)`,
      })
      .from(SelfLearningEvaluationTable)
      .where(
        and(
          eq(SelfLearningEvaluationTable.userId, userId),
          eq(SelfLearningEvaluationTable.candidateFingerprint, fingerprint),
          inArray(SelfLearningEvaluationTable.status, [
            "proposed",
            "applied",
            "skipped",
          ]),
        ),
      );

    return {
      supportCount: Number(row?.supportCount ?? 0),
      distinctThreadCount: Number(row?.distinctThreadCount ?? 0),
    };
  },

  async getMemoryByFingerprint(
    userId: string,
    fingerprint: string,
  ): Promise<SelfLearningMemory | null> {
    const [row] = await db
      .select()
      .from(SelfLearningMemoryTable)
      .where(
        and(
          eq(SelfLearningMemoryTable.userId, userId),
          eq(SelfLearningMemoryTable.fingerprint, fingerprint),
        ),
      );

    return row ? mapMemory(row) : null;
  },

  async upsertMemory(data: {
    userId: string;
    category: SelfLearningMemoryCategory;
    status: SelfLearningMemoryStatus;
    isAutoSafe: boolean;
    fingerprint: string;
    contradictionFingerprint?: string | null;
    title: string;
    content: string;
    supportCount: number;
    distinctThreadCount: number;
    sourceEvaluationId?: string | null;
    supersededByMemoryId?: string | null;
    lastAppliedAt?: Date | null;
  }): Promise<SelfLearningMemory> {
    const [row] = await db
      .insert(SelfLearningMemoryTable)
      .values({
        userId: data.userId,
        category: data.category,
        status: data.status,
        isAutoSafe: data.isAutoSafe,
        fingerprint: data.fingerprint,
        contradictionFingerprint: data.contradictionFingerprint ?? null,
        title: data.title,
        content: data.content,
        supportCount: data.supportCount,
        distinctThreadCount: data.distinctThreadCount,
        sourceEvaluationId: data.sourceEvaluationId ?? null,
        supersededByMemoryId: data.supersededByMemoryId ?? null,
        lastAppliedAt: data.lastAppliedAt ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          SelfLearningMemoryTable.userId,
          SelfLearningMemoryTable.fingerprint,
        ],
        set: {
          category: data.category,
          status: data.status,
          isAutoSafe: data.isAutoSafe,
          contradictionFingerprint: data.contradictionFingerprint ?? null,
          title: data.title,
          content: data.content,
          supportCount: data.supportCount,
          distinctThreadCount: data.distinctThreadCount,
          sourceEvaluationId: data.sourceEvaluationId ?? null,
          supersededByMemoryId: data.supersededByMemoryId ?? null,
          lastAppliedAt: data.lastAppliedAt ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    return mapMemory(row);
  },

  async updateMemory(
    memoryId: string,
    data: Partial<
      Omit<SelfLearningMemory, "id" | "userId" | "fingerprint" | "createdAt">
    >,
  ): Promise<SelfLearningMemory | null> {
    const [row] = await db
      .update(SelfLearningMemoryTable)
      .set({
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.isAutoSafe !== undefined
          ? { isAutoSafe: data.isAutoSafe }
          : {}),
        ...(data.contradictionFingerprint !== undefined
          ? { contradictionFingerprint: data.contradictionFingerprint }
          : {}),
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.content !== undefined ? { content: data.content } : {}),
        ...(data.supportCount !== undefined
          ? { supportCount: data.supportCount }
          : {}),
        ...(data.distinctThreadCount !== undefined
          ? { distinctThreadCount: data.distinctThreadCount }
          : {}),
        ...(data.sourceEvaluationId !== undefined
          ? { sourceEvaluationId: data.sourceEvaluationId }
          : {}),
        ...(data.supersededByMemoryId !== undefined
          ? { supersededByMemoryId: data.supersededByMemoryId }
          : {}),
        ...(data.lastAppliedAt !== undefined
          ? { lastAppliedAt: data.lastAppliedAt }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(SelfLearningMemoryTable.id, memoryId))
      .returning();

    return row ? mapMemory(row) : null;
  },

  async listMemoriesForUser(
    userId: string,
    options: { includeDeleted?: boolean; limit?: number } = {},
  ): Promise<SelfLearningMemory[]> {
    const where = options.includeDeleted
      ? eq(SelfLearningMemoryTable.userId, userId)
      : and(
          eq(SelfLearningMemoryTable.userId, userId),
          or(
            eq(SelfLearningMemoryTable.status, "active"),
            eq(SelfLearningMemoryTable.status, "inactive"),
            eq(SelfLearningMemoryTable.status, "superseded"),
          ),
        );

    const rows = await db
      .select()
      .from(SelfLearningMemoryTable)
      .where(where)
      .orderBy(desc(SelfLearningMemoryTable.updatedAt))
      .limit(options.limit ?? 100);

    return rows.map(mapMemory);
  },

  async listActiveMemoriesForUser(
    userId: string,
    limit = 5,
  ): Promise<SelfLearningMemory[]> {
    const rows = await db
      .select()
      .from(SelfLearningMemoryTable)
      .where(
        and(
          eq(SelfLearningMemoryTable.userId, userId),
          eq(SelfLearningMemoryTable.status, "active"),
        ),
      )
      .orderBy(
        desc(SelfLearningMemoryTable.supportCount),
        desc(SelfLearningMemoryTable.lastAppliedAt),
        desc(SelfLearningMemoryTable.updatedAt),
      )
      .limit(limit);

    return rows.map(mapMemory);
  },

  async listContradictingActiveMemories(
    userId: string,
    contradictionFingerprint: string,
    excludeMemoryId?: string,
  ): Promise<SelfLearningMemory[]> {
    const whereClause = excludeMemoryId
      ? and(
          eq(SelfLearningMemoryTable.userId, userId),
          eq(SelfLearningMemoryTable.status, "active"),
          eq(
            SelfLearningMemoryTable.contradictionFingerprint,
            contradictionFingerprint,
          ),
          sql`${SelfLearningMemoryTable.id} <> ${excludeMemoryId}`,
        )
      : and(
          eq(SelfLearningMemoryTable.userId, userId),
          eq(SelfLearningMemoryTable.status, "active"),
          eq(
            SelfLearningMemoryTable.contradictionFingerprint,
            contradictionFingerprint,
          ),
        );

    const rows = await db
      .select()
      .from(SelfLearningMemoryTable)
      .where(whereClause);

    return rows.map(mapMemory);
  },

  async insertAuditLog(data: {
    userId: string;
    actorUserId?: string | null;
    runId?: string | null;
    evaluationId?: string | null;
    memoryId?: string | null;
    action: SelfLearningAuditAction;
    details?: Record<string, unknown> | null;
  }): Promise<SelfLearningAuditLog> {
    const [row] = await db
      .insert(SelfLearningAuditLogTable)
      .values({
        userId: data.userId,
        actorUserId: data.actorUserId ?? null,
        runId: data.runId ?? null,
        evaluationId: data.evaluationId ?? null,
        memoryId: data.memoryId ?? null,
        action: data.action,
        details: data.details ?? null,
      })
      .returning();

    return mapAudit(row);
  },

  async listAuditLogsForUser(
    userId: string,
    limit = 100,
  ): Promise<SelfLearningAuditLog[]> {
    const rows = await db
      .select()
      .from(SelfLearningAuditLogTable)
      .where(eq(SelfLearningAuditLogTable.userId, userId))
      .orderBy(desc(SelfLearningAuditLogTable.createdAt))
      .limit(limit);

    return rows.map(mapAudit);
  },

  async listUserRowsPage(input?: {
    limit?: number;
    offset?: number;
    query?: string;
  }): Promise<SelfLearningUsersPage> {
    const limit = Math.max(1, input?.limit ?? 10);
    const offset = Math.max(0, input?.offset ?? 0);
    const whereClause = buildUserSearchWhereClause(input?.query);
    const userRows = buildUserRowSelect();

    const [rows, countRows] = await Promise.all([
      userRows.query
        .where(whereClause)
        .orderBy(
          desc(userRows.orderBy.estimatedEligibleCandidateCount),
          desc(userRows.orderBy.threadCount),
          desc(userRows.orderBy.signalCount),
          asc(userRows.orderBy.displayName),
          asc(sql`lower(${UserTable.email})`),
          asc(UserTable.id),
        )
        .limit(limit)
        .offset(offset),
      db
        .select({
          count: sql<number>`cast(count(${UserTable.id}) as int)`,
        })
        .from(UserTable)
        .where(whereClause),
    ]);

    return {
      users: rows.map(mapUserRow),
      total: Number(countRows[0]?.count ?? 0),
      limit,
      offset,
    };
  },

  async getUserRow(userId: string): Promise<SelfLearningUserRow | null> {
    const userRows = buildUserRowSelect();
    const [row] = await userRows.query.where(eq(UserTable.id, userId)).limit(1);

    return row ? mapUserRow(row) : null;
  },

  async getOverview(
    config: SelfLearningSystemConfig,
  ): Promise<SelfLearningOverview> {
    const [signals, evaluations, activeMemories, enabledUsers] =
      await Promise.all([
        db
          .select({
            count: sql<number>`cast(count(${SelfLearningSignalEventTable.id}) as int)`,
          })
          .from(SelfLearningSignalEventTable),
        db
          .select({
            count: sql<number>`cast(count(${SelfLearningEvaluationTable.id}) as int)`,
          })
          .from(SelfLearningEvaluationTable),
        db
          .select({
            count: sql<number>`cast(count(${SelfLearningMemoryTable.id}) as int)`,
          })
          .from(SelfLearningMemoryTable)
          .where(eq(SelfLearningMemoryTable.status, "active")),
        db
          .select({
            count: sql<number>`cast(count(${SelfLearningUserConfigTable.id}) as int)`,
          })
          .from(SelfLearningUserConfigTable)
          .where(eq(SelfLearningUserConfigTable.personalizationEnabled, true)),
      ]);

    return {
      system: config,
      judgeModel: null,
      totalSignals: Number(signals[0]?.count ?? 0),
      totalEvaluations: Number(evaluations[0]?.count ?? 0),
      totalActiveMemories: Number(activeMemories[0]?.count ?? 0),
      enabledUsers: Number(enabledUsers[0]?.count ?? 0),
      recentRuns: await this.listRecentRuns(10),
    };
  },

  async listEligibleUserIds(): Promise<string[]> {
    const [signalRows, threadRows] = await Promise.all([
      db
        .select({
          userId: SelfLearningSignalEventTable.userId,
        })
        .from(SelfLearningSignalEventTable)
        .leftJoin(
          SelfLearningUserConfigTable,
          eq(
            SelfLearningUserConfigTable.userId,
            SelfLearningSignalEventTable.userId,
          ),
        )
        .where(
          or(
            isNull(SelfLearningUserConfigTable.id),
            eq(SelfLearningUserConfigTable.personalizationEnabled, true),
          ),
        )
        .groupBy(SelfLearningSignalEventTable.userId),
      db
        .select({
          userId: ChatThreadTable.userId,
        })
        .from(ChatThreadTable)
        .leftJoin(
          SelfLearningUserConfigTable,
          eq(SelfLearningUserConfigTable.userId, ChatThreadTable.userId),
        )
        .where(
          or(
            isNull(SelfLearningUserConfigTable.id),
            eq(SelfLearningUserConfigTable.personalizationEnabled, true),
          ),
        )
        .groupBy(ChatThreadTable.userId),
    ]);

    return Array.from(
      new Set([
        ...signalRows.map((row) => row.userId),
        ...threadRows.map((row) => row.userId),
      ]),
    );
  },

  async deleteLearningDataForUser(userId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(ChatMessageFeedbackTable)
        .where(eq(ChatMessageFeedbackTable.userId, userId));
      await tx
        .delete(SelfLearningAuditLogTable)
        .where(eq(SelfLearningAuditLogTable.userId, userId));
      await tx
        .delete(SelfLearningEvaluationTable)
        .where(eq(SelfLearningEvaluationTable.userId, userId));
      await tx
        .delete(SelfLearningMemoryTable)
        .where(eq(SelfLearningMemoryTable.userId, userId));
      await tx
        .delete(SelfLearningRunTable)
        .where(eq(SelfLearningRunTable.userId, userId));
      await tx
        .delete(SelfLearningSignalEventTable)
        .where(eq(SelfLearningSignalEventTable.userId, userId));
      await tx
        .delete(SelfLearningUserConfigTable)
        .where(eq(SelfLearningUserConfigTable.userId, userId));
      await tx
        .delete(KnowledgeGroupTable)
        .where(
          and(
            eq(KnowledgeGroupTable.userId, userId),
            eq(KnowledgeGroupTable.purpose, "personalization"),
          ),
        );
    });
  },
};
