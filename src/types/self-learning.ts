import { z } from "zod";

export const SELF_LEARNING_SYSTEM_KEY = "self-learning-system";
export const EVALUATION_JUDGE_MODEL_KEY = "evaluation-judge-model";

export const SELF_LEARNING_DEFAULTS = {
  isRunning: false,
  biasGuardMinimumEvals: 5,
  minDistinctThreads: 3,
  maxActiveMemories: 5,
  dailySchedulerPattern: "0 5 * * *",
} as const;

export type SelfLearningSystemConfig = {
  isRunning: boolean;
  biasGuardMinimumEvals: number;
  minDistinctThreads: number;
  maxActiveMemories: number;
  dailySchedulerPattern: string;
};

export const SelfLearningSystemConfigZodSchema = z.object({
  isRunning: z.boolean().default(SELF_LEARNING_DEFAULTS.isRunning),
  biasGuardMinimumEvals: z
    .number()
    .int()
    .min(1)
    .default(SELF_LEARNING_DEFAULTS.biasGuardMinimumEvals),
  minDistinctThreads: z
    .number()
    .int()
    .min(1)
    .default(SELF_LEARNING_DEFAULTS.minDistinctThreads),
  maxActiveMemories: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(SELF_LEARNING_DEFAULTS.maxActiveMemories),
  dailySchedulerPattern: z
    .string()
    .min(1)
    .default(SELF_LEARNING_DEFAULTS.dailySchedulerPattern),
});

export const EvaluationJudgeModelConfigZodSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
});

export type EvaluationJudgeModelConfig = z.infer<
  typeof EvaluationJudgeModelConfigZodSchema
>;

export type SelfLearningSignalType =
  | "feedback_like"
  | "feedback_dislike"
  | "regenerate_response"
  | "branch_from_response"
  | "delete_response"
  | "follow_up_continue";

export type SelfLearningEmptyReason =
  | "no_chat_history"
  | "no_assistant_turns"
  | "all_recent_turns_already_evaluated"
  | "only_low_value_small_talk"
  | "no_candidates_after_filters";

export type SelfLearningRunTrigger = "daily" | "manual" | "rebuild";

export type SelfLearningRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type SelfLearningMemoryCategory =
  | "preference"
  | "style"
  | "format"
  | "avoidance"
  | "workflow"
  | "factual"
  | "policy";

export type SelfLearningMemoryStatus =
  | "active"
  | "inactive"
  | "superseded"
  | "deleted";

export type SelfLearningEvaluationStatus =
  | "proposed"
  | "applied"
  | "skipped"
  | "rejected";

export type SelfLearningAuditAction =
  | "signal_recorded"
  | "manual_run_requested"
  | "run_completed"
  | "run_failed"
  | "memory_applied"
  | "memory_skipped"
  | "memory_superseded"
  | "personalization_reset"
  | "learning_deleted"
  | "user_toggle_updated"
  | "system_toggle_updated";

export type SelfLearningSignalPayload = {
  note?: string;
  reason?: string | null;
  actor?: "user" | "admin" | "system";
  source?: string;
};

export type SelfLearningSignalEvent = {
  id: string;
  userId: string;
  threadId?: string | null;
  messageId?: string | null;
  signalType: SelfLearningSignalType;
  value: number;
  payload?: SelfLearningSignalPayload | null;
  createdAt: Date;
};

export type SelfLearningRun = {
  id: string;
  userId: string;
  userName?: string | null;
  userEmail?: string | null;
  trigger: SelfLearningRunTrigger;
  status: SelfLearningRunStatus;
  queuedAt: Date;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  totalCandidates: number;
  processedCandidates: number;
  appliedMemoryCount: number;
  skippedMemoryCount: number;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SelfLearningJudgeOutput = {
  rubricVersion: number;
  summary: string;
  confidence: number;
  score: number;
  category: SelfLearningMemoryCategory;
  shouldProposeMemory: boolean;
  memoryTitle: string;
  memoryContent: string;
  contradictionFingerprint?: string | null;
  evidence: string[];
  reasoning: string[];
};

export type SelfLearningEvaluation = {
  id: string;
  runId: string;
  userId: string;
  threadId?: string | null;
  messageId?: string | null;
  signalEventId?: string | null;
  status: SelfLearningEvaluationStatus;
  explicitScore: number;
  implicitScore: number;
  llmScore: number;
  compositeScore: number;
  confidence: number;
  category?: SelfLearningMemoryCategory | null;
  candidateFingerprint?: string | null;
  candidateTitle?: string | null;
  candidateContent?: string | null;
  judgeOutput?: SelfLearningJudgeOutput | null;
  metrics?: Record<string, unknown> | null;
  appliedMemoryId?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SelfLearningMemory = {
  id: string;
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
  createdAt: Date;
  updatedAt: Date;
};

export type SelfLearningAuditLog = {
  id: string;
  userId: string;
  actorUserId?: string | null;
  runId?: string | null;
  evaluationId?: string | null;
  memoryId?: string | null;
  action: SelfLearningAuditAction;
  details?: Record<string, unknown> | null;
  createdAt: Date;
};

export type SelfLearningUserConfig = {
  id: string;
  userId: string;
  personalizationEnabled: boolean;
  hiddenKnowledgeGroupId?: string | null;
  hiddenKnowledgeDocumentId?: string | null;
  lastManualRunAt?: Date | null;
  lastEvaluatedAt?: Date | null;
  lastResetAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SelfLearningUserRow = {
  userId: string;
  name: string | null;
  email: string;
  personalizationEnabled: boolean;
  threadCount: number;
  assistantTurnCount: number;
  evaluatedAssistantTurnCount: number;
  signalCount: number;
  eligibleCandidateCount: number;
  emptyReason?: SelfLearningEmptyReason | null;
  evaluationCount: number;
  activeMemoryCount: number;
  lastRunAt?: Date | null;
  lastEvaluatedAt?: Date | null;
};

export type SelfLearningEligibilitySummary = {
  threadCount: number;
  signalCount: number;
  assistantTurnCount: number;
  evaluatedAssistantTurnCount: number;
  eligibleCandidateCount: number;
  emptyReason?: SelfLearningEmptyReason | null;
};

export type SelfLearningRunDiagnostics = SelfLearningEligibilitySummary & {
  threadCountLoaded: number;
  signalsLoaded: number;
  assistantTurnsSeen: number;
  alreadyEvaluatedExcluded: number;
  smallTalkExcluded: number;
  missingPrecedingUserExcluded: number;
  finalCandidateCount: number;
};

export type SelfLearningUsersPage = {
  users: SelfLearningUserRow[];
  total: number;
  limit: number;
  offset: number;
};

export type SelfLearningOverview = {
  system: SelfLearningSystemConfig;
  judgeModel: EvaluationJudgeModelConfig | null;
  totalSignals: number;
  totalEvaluations: number;
  totalActiveMemories: number;
  enabledUsers: number;
  recentRuns: SelfLearningRun[];
};

export function isAutoSafeMemoryCategory(
  category: SelfLearningMemoryCategory,
): boolean {
  return (
    category === "preference" ||
    category === "style" ||
    category === "format" ||
    category === "avoidance" ||
    category === "workflow"
  );
}
