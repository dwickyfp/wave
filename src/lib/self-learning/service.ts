import { generateText, Output } from "ai";
import type {
  EvaluationJudgeModelConfig,
  SelfLearningEvaluation,
  SelfLearningEmbeddingModelConfig,
  SelfLearningEligibilitySummary,
  SelfLearningMemory,
  SelfLearningOverview,
  SelfLearningRunDiagnostics,
  SelfLearningRunTrigger,
  SelfLearningSignalEvent,
  SelfLearningSignalType,
  SelfLearningSystemConfig,
  SelfLearningUserConfig,
  SelfLearningUserRow,
  SelfLearningUsersPage,
} from "app-types/self-learning";
import {
  EVALUATION_JUDGE_MODEL_KEY,
  EvaluationJudgeModelConfigZodSchema,
  SELF_LEARNING_EMBEDDING_MODEL_KEY,
  SELF_LEARNING_SYSTEM_KEY,
  SelfLearningEmbeddingModelConfigZodSchema,
  SelfLearningSystemConfigZodSchema,
  isAutoSafeMemoryCategory,
} from "app-types/self-learning";
import { z } from "zod";
import {
  chatRepository,
  knowledgeRepository,
  selfLearningRepository,
  settingsRepository,
} from "lib/db/repository";
import { runIngestPipeline } from "lib/knowledge/ingest-pipeline";
import { pgDb as db } from "lib/db/pg/db.pg";
import { KnowledgeGroupTable } from "lib/db/pg/schema.pg";
import { and, eq } from "drizzle-orm";
import { getDbModel } from "lib/ai/provider-factory";
import {
  buildContradictionFingerprint,
  buildMemoryFingerprint,
  computeCompositeScore,
  getImplicitSignalScore,
  renderLearnedUserPersonalizationPrompt,
  renderPersonalizationKnowledgeMarkdown,
} from "./logic";
import {
  type CandidateContext,
  SELF_LEARNING_MAX_CANDIDATES_PER_RUN,
  SELF_LEARNING_PASSIVE_THREAD_LIMIT,
  SELF_LEARNING_PROPOSAL_THRESHOLD,
  buildCandidateContextFromSignal,
  buildPassiveHistoryCandidateSelection,
  buildRecentUserMessageSnapshot,
} from "./candidates";

const JUDGE_SCHEMA = z.object({
  rubricVersion: z.number().int().min(1).max(10),
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1),
  score: z.number().min(0).max(1),
  category: z.enum([
    "preference",
    "style",
    "format",
    "avoidance",
    "workflow",
    "factual",
    "policy",
  ]),
  shouldProposeMemory: z.boolean(),
  directPersonalizationSignal: z.boolean().default(false),
  memoryTitle: z.string().min(1),
  memoryContent: z.string().min(1),
  contradictionFingerprint: z.string().optional().nullable(),
  evidence: z.array(z.string()).default([]),
  reasoning: z.array(z.string()).default([]),
});

type JudgeOutput = z.infer<typeof JUDGE_SCHEMA>;

type EvaluationCandidateSelection = {
  signals: SelfLearningSignalEvent[];
  candidates: CandidateContext[];
  eligibility: SelfLearningEligibilitySummary;
  diagnostics: SelfLearningRunDiagnostics;
};

async function judgeCandidate(
  judgeModel: EvaluationJudgeModelConfig,
  candidate: CandidateContext,
): Promise<JudgeOutput> {
  const dbModel = await getDbModel(judgeModel);
  if (!dbModel) {
    throw new Error("Evaluation judge model is not configured or unavailable.");
  }

  const prompt = `
You evaluate whether a conversation reveals a stable per-user learning that Emma should remember for future chats.

Rules:
- Return a memory only if it is specific to this user and likely reusable.
- Prefer concise guidance about style, format, preferences, avoidances, or stable workflow habits.
- Do not propose memories that override safety, policies, or live user instructions.
- Do not store one-off task details, secrets, temporary project state, or transient facts.
- You may infer recurring work materials, toolchains, or user habits only when they appear durable across the recent user message snapshot.
- If the previous user message directly states a durable preference, interest, domain focus, or working identity, treat that as strong evidence for a reusable memory when it is safe.
- Set directPersonalizationSignal=true when the user directly states a durable preference, interest, identity, role, working style, or habit in any language.
- If the evidence only reflects one-off task content, set shouldProposeMemory=false.
- score should reflect how strong and reusable the proposed memory is.
- confidence should reflect certainty in the judgment.
- contradictionFingerprint should group mutually exclusive memories when relevant.

Candidate source: ${candidate.sourceType}
Source reason: ${candidate.sourceReason ?? "None"}

Recent user message snapshot across chats:
${candidate.recentUserMessageSnapshot || "N/A"}

Previous user message:
${candidate.precedingUserPrompt || "N/A"}

Assistant response:
${candidate.assistantResponse}

Next user message or reaction:
${candidate.nextUserMessage || "N/A"}
`.trim();

  const { output } = await generateText({
    model: dbModel.model,
    temperature: 0,
    output: Output.object({
      schema: JUDGE_SCHEMA,
      name: "self_learning_judgment",
      description: "Structured judgment for user-personalization learning",
    }),
    prompt,
  });

  return output;
}

async function buildEvaluationCandidateSelectionForUser(
  userId: string,
  seedUserRow?: SelfLearningUserRow | null,
): Promise<EvaluationCandidateSelection> {
  const [signals, userRow] = await Promise.all([
    selfLearningRepository.listSignalsForEvaluation(
      userId,
      SELF_LEARNING_MAX_CANDIDATES_PER_RUN,
    ),
    seedUserRow === undefined
      ? selfLearningRepository.getUserRow(userId)
      : Promise.resolve(seedUserRow),
  ]);
  const recentThreads = (
    await chatRepository.selectThreadsByUserId(userId)
  ).slice(0, SELF_LEARNING_PASSIVE_THREAD_LIMIT);

  const threadIds = Array.from(
    new Set([
      ...recentThreads.map((thread) => thread.id),
      ...signals
        .map((signal) => signal.threadId)
        .filter((threadId): threadId is string => Boolean(threadId)),
    ]),
  );

  const threadMessagesEntries = await Promise.all(
    threadIds.map(
      async (threadId) =>
        [
          threadId,
          await chatRepository.selectMessagesByThreadId(threadId),
        ] as const,
    ),
  );
  const threadMessagesById = new Map(threadMessagesEntries);

  const recentUserMessageSnapshot = buildRecentUserMessageSnapshot(
    recentThreads
      .map((thread) => threadMessagesById.get(thread.id) ?? [])
      .filter((messages) => messages.length > 0),
  );

  const signalCandidates = signals
    .map((signal) => {
      if (!signal.threadId) {
        return null;
      }

      return buildCandidateContextFromSignal(
        signal,
        threadMessagesById.get(signal.threadId) ?? [],
        recentUserMessageSnapshot,
      );
    })
    .filter((candidate): candidate is CandidateContext => Boolean(candidate))
    .slice(0, SELF_LEARNING_MAX_CANDIDATES_PER_RUN);

  const reservedMessageIds = new Set(
    signalCandidates.map((candidate) => candidate.messageId),
  );

  const recentAssistantMessageIds = recentThreads.flatMap((thread) =>
    (threadMessagesById.get(thread.id) ?? [])
      .filter((message) => message.role === "assistant")
      .map((message) => message.id),
  );

  const evaluatedMessageIds = new Set(
    await selfLearningRepository.listEvaluatedMessageIdsForUser(
      userId,
      recentAssistantMessageIds,
    ),
  );

  const passiveHistorySelection = buildPassiveHistoryCandidateSelection({
    threadMessagesByThread: recentThreads.map((thread) => ({
      threadId: thread.id,
      messages: threadMessagesById.get(thread.id) ?? [],
    })),
    excludedMessageIds: new Set([
      ...reservedMessageIds,
      ...evaluatedMessageIds,
    ]),
    recentUserMessageSnapshot,
    limit: SELF_LEARNING_MAX_CANDIDATES_PER_RUN - signalCandidates.length,
  });

  const candidates = [
    ...signalCandidates,
    ...passiveHistorySelection.candidates,
  ].slice(0, SELF_LEARNING_MAX_CANDIDATES_PER_RUN);
  const emptyReason =
    candidates.length > 0
      ? null
      : signals.length > 0
        ? "no_candidates_after_filters"
        : (passiveHistorySelection.diagnostics.emptyReason ?? null);

  const eligibility: SelfLearningEligibilitySummary = {
    threadCount: userRow?.threadCount ?? recentThreads.length,
    signalCount: userRow?.signalCount ?? signals.length,
    assistantTurnCount: passiveHistorySelection.diagnostics.assistantTurnsSeen,
    evaluatedAssistantTurnCount: evaluatedMessageIds.size,
    eligibleCandidateCount: candidates.length,
    emptyReason,
  };

  const diagnostics: SelfLearningRunDiagnostics = {
    ...eligibility,
    threadCountLoaded: recentThreads.length,
    signalsLoaded: signals.length,
    assistantTurnsSeen: passiveHistorySelection.diagnostics.assistantTurnsSeen,
    alreadyEvaluatedExcluded:
      passiveHistorySelection.diagnostics.alreadyEvaluatedExcluded,
    smallTalkExcluded: passiveHistorySelection.diagnostics.smallTalkExcluded,
    missingPrecedingUserExcluded:
      passiveHistorySelection.diagnostics.missingPrecedingUserExcluded,
    finalCandidateCount: candidates.length,
  };

  return {
    signals,
    candidates,
    eligibility,
    diagnostics,
  };
}

async function ensureHiddenKnowledgeTargets(userId: string): Promise<{
  groupId: string;
  documentId: string;
  config: SelfLearningUserConfig;
}> {
  const config = await selfLearningRepository.ensureUserConfig(userId);
  const embeddingConfig = await getSelfLearningEmbeddingModelConfig();

  let group: Awaited<
    ReturnType<typeof knowledgeRepository.insertGroup>
  > | null = null;

  if (config.hiddenKnowledgeGroupId) {
    group = await knowledgeRepository.selectGroupById(
      config.hiddenKnowledgeGroupId,
      userId,
    );
  }

  if (!group) {
    const [existingByPurpose] = await db
      .select({ id: KnowledgeGroupTable.id })
      .from(KnowledgeGroupTable)
      .where(
        and(
          eq(KnowledgeGroupTable.userId, userId),
          eq(KnowledgeGroupTable.purpose, "personalization"),
        ),
      );

    group = existingByPurpose
      ? await knowledgeRepository.selectGroupById(existingByPurpose.id, userId)
      : null;

    if (!group) {
      group = await knowledgeRepository.insertGroup({
        userId,
        name: "Emma Personalization Memory",
        description: "System-managed per-user personalization memory.",
        visibility: "private",
        purpose: "personalization",
        isSystemManaged: true,
        ...(embeddingConfig
          ? {
              embeddingProvider: embeddingConfig.provider,
              embeddingModel: embeddingConfig.model,
            }
          : {}),
      });
    }
  }

  if (!group) {
    throw new Error("Failed to resolve personalization knowledge group.");
  }

  if (
    embeddingConfig &&
    (group.embeddingProvider !== embeddingConfig.provider ||
      group.embeddingModel !== embeddingConfig.model)
  ) {
    group = await knowledgeRepository.updateGroup(group.id, userId, {
      embeddingProvider: embeddingConfig.provider,
      embeddingModel: embeddingConfig.model,
    });
  }

  const documentId = config.hiddenKnowledgeDocumentId ?? null;
  let document =
    documentId && (await knowledgeRepository.selectDocumentById(documentId));

  if (!document || document.groupId !== group.id) {
    const docs = await knowledgeRepository.selectDocumentsByGroupId(group.id);
    document =
      docs.find(
        (doc) => doc.originalFilename === "self-learning-personalization.md",
      ) ??
      docs[0] ??
      null;
  }

  if (!document) {
    document = await knowledgeRepository.insertDocument({
      groupId: group.id,
      userId,
      name: "Emma Personalization Memory",
      originalFilename: "self-learning-personalization.md",
      fileType: "md",
    });
  }

  const nextConfig = await selfLearningRepository.upsertUserConfig(userId, {
    hiddenKnowledgeGroupId: group.id,
    hiddenKnowledgeDocumentId: document.id,
  });

  return {
    groupId: group.id,
    documentId: document.id,
    config: nextConfig,
  };
}

async function applyMemoryFromEvaluation(input: {
  userId: string;
  evaluation: SelfLearningEvaluation;
  judge: JudgeOutput;
  systemConfig: SelfLearningSystemConfig;
  allowApply: boolean;
  trigger: SelfLearningRunTrigger;
}): Promise<{
  memory: SelfLearningMemory;
  applied: boolean;
  supersededIds: string[];
  activationReason: "bias_guard" | "direct_user_declaration" | "inactive";
}> {
  const fingerprint = buildMemoryFingerprint({
    category: input.judge.category,
    title: input.judge.memoryTitle,
    content: input.judge.memoryContent,
  });

  const supportStats = await selfLearningRepository.getSupportStats(
    input.userId,
    fingerprint,
  );

  const meetsBiasGuard =
    input.allowApply &&
    isAutoSafeMemoryCategory(input.judge.category) &&
    supportStats.supportCount >= input.systemConfig.biasGuardMinimumEvals &&
    supportStats.distinctThreadCount >= input.systemConfig.minDistinctThreads;
  const activatesFromDirectDeclaration =
    input.allowApply &&
    input.trigger === "manual" &&
    input.judge.directPersonalizationSignal &&
    isAutoSafeMemoryCategory(input.judge.category) &&
    (input.judge.category === "preference" ||
      input.judge.category === "workflow") &&
    input.judge.confidence >= 0.6;
  const shouldActivate = meetsBiasGuard || activatesFromDirectDeclaration;
  const activationReason = shouldActivate
    ? meetsBiasGuard
      ? "bias_guard"
      : "direct_user_declaration"
    : "inactive";

  const contradictionFingerprint = buildContradictionFingerprint({
    category: input.judge.category,
    hint: input.judge.contradictionFingerprint ?? input.judge.memoryTitle,
    title: input.judge.memoryTitle,
  });

  const memory = await selfLearningRepository.upsertMemory({
    userId: input.userId,
    category: input.judge.category,
    status: shouldActivate ? "active" : "inactive",
    isAutoSafe: isAutoSafeMemoryCategory(input.judge.category),
    fingerprint,
    contradictionFingerprint,
    title: input.judge.memoryTitle.trim(),
    content: input.judge.memoryContent.trim(),
    supportCount: supportStats.supportCount,
    distinctThreadCount: supportStats.distinctThreadCount,
    sourceEvaluationId: input.evaluation.id,
    lastAppliedAt: shouldActivate ? new Date() : null,
  });

  const supersededIds: string[] = [];

  if (shouldActivate) {
    const conflicts =
      await selfLearningRepository.listContradictingActiveMemories(
        input.userId,
        contradictionFingerprint,
        memory.id,
      );

    for (const conflict of conflicts) {
      await selfLearningRepository.updateMemory(conflict.id, {
        status: "superseded",
        supersededByMemoryId: memory.id,
      });
      supersededIds.push(conflict.id);
      await selfLearningRepository.insertAuditLog({
        userId: input.userId,
        evaluationId: input.evaluation.id,
        memoryId: conflict.id,
        action: "memory_superseded",
        details: {
          replacementMemoryId: memory.id,
        },
      });
    }
  }

  return {
    memory,
    applied: shouldActivate,
    supersededIds,
    activationReason,
  };
}

export async function getSelfLearningSystemConfig(): Promise<SelfLearningSystemConfig> {
  const raw = await settingsRepository.getSetting(SELF_LEARNING_SYSTEM_KEY);
  return SelfLearningSystemConfigZodSchema.parse({
    isRunning: false,
    biasGuardMinimumEvals: 5,
    minDistinctThreads: 3,
    maxActiveMemories: 5,
    dailySchedulerPattern: "0 5 * * *",
    ...(raw && typeof raw === "object" ? raw : {}),
  });
}

export async function setSelfLearningSystemConfig(
  input: Partial<SelfLearningSystemConfig>,
): Promise<SelfLearningSystemConfig> {
  const current = await getSelfLearningSystemConfig();
  const next = SelfLearningSystemConfigZodSchema.parse({
    ...current,
    ...input,
  });
  await settingsRepository.upsertSetting(SELF_LEARNING_SYSTEM_KEY, next);
  return next;
}

export async function getEvaluationJudgeModelConfig(): Promise<EvaluationJudgeModelConfig | null> {
  const raw = await settingsRepository.getSetting(EVALUATION_JUDGE_MODEL_KEY);
  if (!raw) return null;
  return EvaluationJudgeModelConfigZodSchema.parse(raw);
}

export async function setEvaluationJudgeModelConfig(
  config: EvaluationJudgeModelConfig | null,
): Promise<void> {
  await settingsRepository.upsertSetting(EVALUATION_JUDGE_MODEL_KEY, config);
}

export async function getSelfLearningEmbeddingModelConfig(): Promise<SelfLearningEmbeddingModelConfig | null> {
  const raw = await settingsRepository.getSetting(
    SELF_LEARNING_EMBEDDING_MODEL_KEY,
  );
  if (!raw) return null;
  return SelfLearningEmbeddingModelConfigZodSchema.parse(raw);
}

export async function setSelfLearningEmbeddingModelConfig(
  config: SelfLearningEmbeddingModelConfig | null,
): Promise<void> {
  await settingsRepository.upsertSetting(
    SELF_LEARNING_EMBEDDING_MODEL_KEY,
    config,
  );
}

export async function listSelfLearningUsers(input?: {
  limit?: number;
  offset?: number;
  query?: string;
}): Promise<SelfLearningUsersPage> {
  const usersPage = await selfLearningRepository.listUserRowsPage(input);
  const users = await Promise.all(
    usersPage.users.map(async (user) => {
      const eligibility = await getSelfLearningUserEligibility(
        user.userId,
        user,
      );
      return {
        ...user,
        assistantTurnCount: eligibility.assistantTurnCount,
        evaluatedAssistantTurnCount: eligibility.evaluatedAssistantTurnCount,
        eligibleCandidateCount: eligibility.eligibleCandidateCount,
        emptyReason: eligibility.emptyReason ?? null,
      };
    }),
  );

  users.sort((left, right) => {
    if (right.eligibleCandidateCount !== left.eligibleCandidateCount) {
      return right.eligibleCandidateCount - left.eligibleCandidateCount;
    }

    if (right.threadCount !== left.threadCount) {
      return right.threadCount - left.threadCount;
    }

    if (right.signalCount !== left.signalCount) {
      return right.signalCount - left.signalCount;
    }

    const leftDisplay = (left.name?.trim() || left.email).toLowerCase();
    const rightDisplay = (right.name?.trim() || right.email).toLowerCase();

    if (leftDisplay !== rightDisplay) {
      return leftDisplay.localeCompare(rightDisplay);
    }

    return left.email.toLowerCase().localeCompare(right.email.toLowerCase());
  });

  return {
    ...usersPage,
    users,
  };
}

export async function getSelfLearningOverview(): Promise<SelfLearningOverview> {
  const system = await getSelfLearningSystemConfig();
  const judgeModel = await getEvaluationJudgeModelConfig();
  const overview = await selfLearningRepository.getOverview(system);
  return {
    ...overview,
    judgeModel,
  };
}

export async function getSelfLearningUserDetail(userId: string) {
  const [config, user, runs, evaluations, memories, auditLogs] =
    await Promise.all([
      selfLearningRepository.ensureUserConfig(userId),
      selfLearningRepository.getUserRow(userId),
      selfLearningRepository.listRunsForUser(userId, 20),
      selfLearningRepository.listEvaluationsForUser(userId, 50),
      selfLearningRepository.listMemoriesForUser(userId, {
        includeDeleted: true,
        limit: 50,
      }),
      selfLearningRepository.listAuditLogsForUser(userId, 100),
    ]);
  const eligibility = await getSelfLearningUserEligibility(userId, user);

  return {
    user: user
      ? {
          ...user,
          assistantTurnCount: eligibility.assistantTurnCount,
          evaluatedAssistantTurnCount: eligibility.evaluatedAssistantTurnCount,
          eligibleCandidateCount: eligibility.eligibleCandidateCount,
          emptyReason: eligibility.emptyReason ?? null,
        }
      : null,
    eligibility,
    config,
    runs,
    evaluations,
    memories,
    auditLogs,
  };
}

export async function getSelfLearningUserEligibility(
  userId: string,
  seedUserRow?: SelfLearningUserRow | null,
): Promise<SelfLearningEligibilitySummary> {
  const selection = await buildEvaluationCandidateSelectionForUser(
    userId,
    seedUserRow,
  );

  return selection.eligibility;
}

export async function recordSelfLearningSignal(input: {
  userId: string;
  threadId?: string | null;
  messageId?: string | null;
  signalType: SelfLearningSignalType;
  value?: number;
  payload?: { reason?: string | null; source?: string };
}): Promise<SelfLearningSignalEvent> {
  await selfLearningRepository.ensureUserConfig(input.userId);
  const signal = await selfLearningRepository.insertSignal({
    userId: input.userId,
    threadId: input.threadId ?? null,
    messageId: input.messageId ?? null,
    signalType: input.signalType,
    value: input.value ?? getImplicitSignalScore(input.signalType),
    payload: input.payload ?? null,
  });

  await selfLearningRepository.insertAuditLog({
    userId: input.userId,
    action: "signal_recorded",
    details: {
      signalId: signal.id,
      signalType: signal.signalType,
      threadId: signal.threadId,
      messageId: signal.messageId,
    },
  });

  return signal;
}

export async function syncExplicitFeedbackSignal(input: {
  userId: string;
  messageId: string;
  threadId: string;
  type?: "like" | "dislike";
  reason?: string;
}): Promise<void> {
  await selfLearningRepository.clearExplicitSignals(
    input.userId,
    input.messageId,
  );

  if (!input.type) return;

  await recordSelfLearningSignal({
    userId: input.userId,
    threadId: input.threadId,
    messageId: input.messageId,
    signalType: input.type === "like" ? "feedback_like" : "feedback_dislike",
    value: 1,
    payload: {
      reason: input.reason ?? null,
      source: "chat_feedback",
    },
  });
}

export async function getLearnedPersonalizationPromptForUser(
  userId: string,
): Promise<string | false> {
  const system = await getSelfLearningSystemConfig();
  const memories = await selfLearningRepository.listActiveMemoriesForUser(
    userId,
    system.maxActiveMemories,
  );
  return renderLearnedUserPersonalizationPrompt(
    memories,
    system.maxActiveMemories,
  );
}

export async function rebuildPersonalizationKnowledge(
  userId: string,
): Promise<void> {
  const { groupId, documentId } = await ensureHiddenKnowledgeTargets(userId);
  const memories = await selfLearningRepository.listActiveMemoriesForUser(
    userId,
    100,
  );
  const markdown = renderPersonalizationKnowledgeMarkdown(memories);
  await runIngestPipeline(documentId, groupId, Buffer.from(markdown, "utf8"));
}

export async function setUserPersonalizationEnabled(input: {
  userId: string;
  enabled: boolean;
  actorUserId?: string;
}): Promise<SelfLearningUserConfig> {
  const config = await selfLearningRepository.upsertUserConfig(input.userId, {
    personalizationEnabled: input.enabled,
  });

  await selfLearningRepository.insertAuditLog({
    userId: input.userId,
    actorUserId: input.actorUserId ?? null,
    action: "user_toggle_updated",
    details: {
      personalizationEnabled: input.enabled,
    },
  });

  return config;
}

export async function resetUserPersonalization(input: {
  userId: string;
  actorUserId?: string;
}): Promise<void> {
  const memories = await selfLearningRepository.listMemoriesForUser(
    input.userId,
    {
      includeDeleted: false,
      limit: 500,
    },
  );

  await Promise.all(
    memories
      .filter((memory) => memory.status === "active")
      .map((memory) =>
        selfLearningRepository.updateMemory(memory.id, {
          status: "inactive",
          lastAppliedAt: null,
        }),
      ),
  );

  await selfLearningRepository.upsertUserConfig(input.userId, {
    lastResetAt: new Date(),
  });
  await rebuildPersonalizationKnowledge(input.userId);
  await selfLearningRepository.insertAuditLog({
    userId: input.userId,
    actorUserId: input.actorUserId ?? null,
    action: "personalization_reset",
    details: {
      resetMemoryCount: memories.length,
    },
  });
}

export async function deleteUserLearningData(input: {
  userId: string;
  actorUserId?: string;
}): Promise<void> {
  await selfLearningRepository.deleteLearningDataForUser(input.userId);
}

export async function runSelfLearningEvaluationForUser(input: {
  userId: string;
  trigger: SelfLearningRunTrigger;
  runId?: string;
  actorUserId?: string;
  bypassPause?: boolean;
}): Promise<{
  runId: string;
  appliedMemoryIds: string[];
}> {
  const system = await getSelfLearningSystemConfig();
  const judgeModel = await getEvaluationJudgeModelConfig();
  const userConfig = await selfLearningRepository.ensureUserConfig(
    input.userId,
  );

  const run = input.runId
    ? {
        id: input.runId,
      }
    : await selfLearningRepository.createRun({
        userId: input.userId,
        trigger: input.trigger,
        status: "queued",
        metadata: {
          bypassPause: Boolean(input.bypassPause),
        },
      });

  if (input.trigger === "manual" && !input.runId) {
    await selfLearningRepository.insertAuditLog({
      userId: input.userId,
      actorUserId: input.actorUserId ?? null,
      runId: run.id,
      action: "manual_run_requested",
      details: {
        bypassPause: Boolean(input.bypassPause),
      },
    });
  }

  if (!userConfig.personalizationEnabled) {
    await selfLearningRepository.updateRun(run.id, {
      status: "completed",
      finishedAt: new Date(),
      metadata: {
        skippedReason: "user_personalization_disabled",
      },
    });
    return { runId: run.id, appliedMemoryIds: [] };
  }

  if (!system.isRunning && !input.bypassPause) {
    await selfLearningRepository.updateRun(run.id, {
      status: "completed",
      finishedAt: new Date(),
      metadata: {
        skippedReason: "system_paused",
      },
    });
    return { runId: run.id, appliedMemoryIds: [] };
  }

  if (!judgeModel) {
    await selfLearningRepository.updateRun(run.id, {
      status: "failed",
      finishedAt: new Date(),
      errorMessage: "Evaluation judge model is not configured.",
    });
    throw new Error("Evaluation judge model is not configured.");
  }

  await selfLearningRepository.updateRun(run.id, {
    status: "running",
    startedAt: new Date(),
  });

  const appliedMemoryIds: string[] = [];

  try {
    const selection = await buildEvaluationCandidateSelectionForUser(
      input.userId,
    );
    const { candidates, diagnostics } = selection;

    let skippedCount = 0;
    let processedCount = 0;

    for (const candidate of candidates) {
      processedCount += 1;

      const judge = await judgeCandidate(judgeModel, candidate);
      const explicitScore =
        candidate.sourceType === "feedback_like" ||
        candidate.sourceType === "feedback_dislike" ||
        judge.directPersonalizationSignal
          ? 1
          : 0;
      const implicitScore = candidate.sourceMetricScore;
      const llmScore = judge.score;
      const compositeScore = computeCompositeScore({
        explicitScore,
        implicitScore,
        llmScore,
      });

      const fingerprint = buildMemoryFingerprint({
        category: judge.category,
        title: judge.memoryTitle,
        content: judge.memoryContent,
      });

      const evaluation = await selfLearningRepository.insertEvaluation({
        runId: run.id,
        userId: input.userId,
        threadId: candidate.threadId,
        messageId: candidate.messageId ?? null,
        signalEventId: candidate.signalEventId ?? null,
        status:
          judge.shouldProposeMemory &&
          compositeScore >= SELF_LEARNING_PROPOSAL_THRESHOLD
            ? "proposed"
            : "rejected",
        explicitScore,
        implicitScore,
        llmScore,
        compositeScore,
        confidence: judge.confidence,
        category: judge.category,
        candidateFingerprint: fingerprint,
        candidateTitle: judge.memoryTitle,
        candidateContent: judge.memoryContent,
        judgeOutput: judge,
        metrics: {
          sourceType: candidate.sourceType,
          sourceMetricScore: candidate.sourceMetricScore,
          directPersonalizationSignal: judge.directPersonalizationSignal,
          recentUserSnapshotIncluded: Boolean(
            candidate.recentUserMessageSnapshot,
          ),
        },
      });

      if (
        !judge.shouldProposeMemory ||
        compositeScore < SELF_LEARNING_PROPOSAL_THRESHOLD
      ) {
        skippedCount += 1;
        continue;
      }

      const applied = await applyMemoryFromEvaluation({
        userId: input.userId,
        evaluation,
        judge,
        systemConfig: system,
        allowApply: userConfig.personalizationEnabled,
        trigger: input.trigger,
      });

      await selfLearningRepository.updateEvaluation(evaluation.id, {
        status: applied.applied ? "applied" : "skipped",
        appliedMemoryId: applied.memory.id,
      });

      await selfLearningRepository.insertAuditLog({
        userId: input.userId,
        actorUserId: input.actorUserId ?? null,
        runId: run.id,
        evaluationId: evaluation.id,
        memoryId: applied.memory.id,
        action: applied.applied ? "memory_applied" : "memory_skipped",
        details: {
          supportCount: applied.memory.supportCount,
          distinctThreadCount: applied.memory.distinctThreadCount,
          supersededIds: applied.supersededIds,
          activationReason: applied.activationReason,
          directPersonalizationSignal: judge.directPersonalizationSignal,
        },
      });

      if (applied.applied) {
        appliedMemoryIds.push(applied.memory.id);
      } else {
        skippedCount += 1;
      }
    }

    await selfLearningRepository.upsertUserConfig(input.userId, {
      lastEvaluatedAt: new Date(),
      lastManualRunAt: input.trigger === "manual" ? new Date() : undefined,
    });

    await selfLearningRepository.updateRun(run.id, {
      status: "completed",
      totalCandidates: candidates.length,
      processedCandidates: processedCount,
      appliedMemoryCount: appliedMemoryIds.length,
      skippedMemoryCount: skippedCount,
      finishedAt: new Date(),
      metadata: {
        bypassPause: Boolean(input.bypassPause),
        actorUserId: input.actorUserId ?? null,
        diagnostics,
      },
    });

    await selfLearningRepository.insertAuditLog({
      userId: input.userId,
      actorUserId: input.actorUserId ?? null,
      runId: run.id,
      action: "run_completed",
      details: {
        processedCount,
        appliedMemoryCount: appliedMemoryIds.length,
        skippedMemoryCount: skippedCount,
        diagnostics,
      },
    });

    return { runId: run.id, appliedMemoryIds };
  } catch (error: any) {
    await selfLearningRepository.updateRun(run.id, {
      status: "failed",
      finishedAt: new Date(),
      errorMessage: error?.message ?? "Unknown self-learning failure",
      metadata: {
        bypassPause: Boolean(input.bypassPause),
        actorUserId: input.actorUserId ?? null,
      },
    });

    await selfLearningRepository.insertAuditLog({
      userId: input.userId,
      actorUserId: input.actorUserId ?? null,
      runId: run.id,
      action: "run_failed",
      details: {
        error: error?.message ?? String(error),
      },
    });

    throw error;
  }
}

export async function getUserLearningDeletionStatus(userId: string) {
  const config = await selfLearningRepository.getUserConfig(userId);
  const memories = await selfLearningRepository.listMemoriesForUser(userId, {
    includeDeleted: true,
    limit: 10,
  });
  return {
    hasLearningData: Boolean(config) || memories.length > 0,
    activeMemoryCount: memories.filter((memory) => memory.status === "active")
      .length,
  };
}
