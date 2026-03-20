import { formatDistanceToNow } from "date-fns";
import type {
  SelfLearningAuditLog,
  SelfLearningEvaluation,
  SelfLearningEligibilitySummary,
  SelfLearningMemory,
  SelfLearningRun,
  SelfLearningRunDiagnostics,
  SelfLearningUserConfig,
  SelfLearningUserRow,
} from "app-types/self-learning";

export type EvaluationUserDetail = {
  user: SelfLearningUserRow | null;
  eligibility: SelfLearningEligibilitySummary;
  config: SelfLearningUserConfig;
  runs: SelfLearningRun[];
  evaluations: SelfLearningEvaluation[];
  memories: SelfLearningMemory[];
  auditLogs: SelfLearningAuditLog[];
};

export function formatTimestamp(value?: Date | string | null) {
  if (!value) return "Never";
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  return `${date.toLocaleString()} (${formatDistanceToNow(date, {
    addSuffix: true,
  })})`;
}

export function statusVariant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "failed" || status === "rejected" || status === "deleted") {
    return "destructive";
  }

  if (
    status === "completed" ||
    status === "applied" ||
    status === "active" ||
    status === "running"
  ) {
    return "default";
  }

  if (status === "queued" || status === "proposed") {
    return "secondary";
  }

  return "outline";
}

export function formatEmptyReason(
  reason?: SelfLearningEligibilitySummary["emptyReason"] | null,
) {
  switch (reason) {
    case "no_chat_history":
      return "No chat history";
    case "no_assistant_turns":
      return "No assistant turns";
    case "all_recent_turns_already_evaluated":
      return "Recent turns already evaluated";
    case "only_low_value_small_talk":
      return "Only intro or small-talk chats";
    case "no_candidates_after_filters":
      return "No reusable candidates after filters";
    default:
      return "History available";
  }
}

export function getRunDiagnostics(
  run: SelfLearningRun,
): SelfLearningRunDiagnostics | null {
  const diagnostics = run.metadata?.diagnostics;

  if (!diagnostics || typeof diagnostics !== "object") {
    return null;
  }

  return diagnostics as SelfLearningRunDiagnostics;
}
