import type { ChatMessage } from "app-types/chat";
import type {
  SelfLearningEmptyReason,
  SelfLearningRunDiagnostics,
  SelfLearningSignalEvent,
  SelfLearningSignalType,
} from "app-types/self-learning";
import { getImplicitSignalScore, normalizeLearningText } from "./logic";

export const SELF_LEARNING_PROPOSAL_THRESHOLD = 0.4;
export const SELF_LEARNING_MAX_CANDIDATES_PER_RUN = 25;
export const SELF_LEARNING_PASSIVE_THREAD_LIMIT = 12;
export const SELF_LEARNING_PASSIVE_CANDIDATES_PER_THREAD = 2;
export const SELF_LEARNING_USER_SNAPSHOT_LIMIT = 8;

const PASSIVE_HISTORY_BASE_SCORE = 0.2;
const PASSIVE_HISTORY_FOLLOW_UP_SCORE = 0.35;
const MAX_SNAPSHOT_SNIPPET_LENGTH = 220;
const LOW_VALUE_PROMPT_PATTERNS = [
  /^(hi+|hello+|halo+|hey+|hai+|yo+|test(ing)?)\b[!. ]*$/i,
  /^(how are you|apa kabar|gimana kabarnya)\b[?.! ]*$/i,
  /^(who are you|what are you|what can you do)\b[?.! ]*$/i,
  /^(siapa kamu|kamu siapa|kamu ini siapa|perkenalan( dengan emma)?|kenalin diri(kamu)?|apa yang bisa kamu lakukan)\b[?.! ]*$/i,
  /^(what day is it|what time is it|hari ini hari apa|jam berapa|tanggal berapa)\b[?.! ]*$/i,
  /^(thanks|thank you|terima kasih|makasih)\b[!. ]*$/i,
];
const TASK_HINT_PATTERNS = [
  /\b(add|analy[sz]e|audit|build|check|compare|create|debug|design|document|explain|find|fix|implement|improve|investigate|make|optimi[sz]e|refactor|review|search|sort|summari[sz]e|trace|update|write)\b/i,
  /\b(agent|api|bug|bullmq|chat|code|database|docker|evaluation|feature|file|flow|knowledge|llm|memory|message|page|pagination|personalization|prompt|queue|redis|route|schema|self-learning|table|ui|worker)\b/i,
  /\b(analisa|buat|cari|cek|debug|desain|implementasi|perbaiki|ringkas|tambah(kan)?|ubah|urutkan)\b/i,
];

export type SelfLearningCandidateSourceType =
  | SelfLearningSignalType
  | "passive_history";

export type CandidateContext = {
  threadId: string;
  messageId: string;
  signalEventId?: string | null;
  assistantResponse: string;
  precedingUserPrompt: string;
  nextUserMessage: string;
  sourceType: SelfLearningCandidateSourceType;
  sourceReason?: string | null;
  recentUserMessageSnapshot?: string;
  sourceMetricScore: number;
};

export type PassiveHistoryCandidateSelection = {
  candidates: CandidateContext[];
  diagnostics: Pick<
    SelfLearningRunDiagnostics,
    | "assistantTurnsSeen"
    | "alreadyEvaluatedExcluded"
    | "smallTalkExcluded"
    | "missingPrecedingUserExcluded"
    | "finalCandidateCount"
  > & {
    emptyReason?: SelfLearningEmptyReason | null;
  };
};

function messageToText(message: ChatMessage | undefined): string {
  if (!message) return "";

  return message.parts
    .filter(
      (part): part is Extract<typeof part, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function truncateSnippet(
  text: string,
  maxLength = MAX_SNAPSHOT_SNIPPET_LENGTH,
) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function normalizeMessageText(text: string | undefined): string {
  return text?.replace(/\s+/g, " ").trim() ?? "";
}

function findPrecedingUserPrompt(
  messages: ChatMessage[],
  assistantIndex: number,
) {
  return messageToText(
    [...messages.slice(0, assistantIndex)]
      .reverse()
      .find((message) => message.role === "user"),
  );
}

function findNextUserMessage(messages: ChatMessage[], assistantIndex: number) {
  return messageToText(
    messages
      .slice(assistantIndex + 1)
      .find((message) => message.role === "user"),
  );
}

function isLowValueSmallTalkPrompt(text: string): boolean {
  const normalized = normalizeMessageText(text);
  if (!normalized) {
    return true;
  }

  if (TASK_HINT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  return LOW_VALUE_PROMPT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function rankPassiveHistoryCandidate(
  candidate: CandidateContext,
  threadLength: number,
) {
  const normalizedPrompt = normalizeMessageText(candidate.precedingUserPrompt);
  const normalizedNextMessage = normalizeMessageText(candidate.nextUserMessage);
  let score = candidate.sourceMetricScore;

  if (TASK_HINT_PATTERNS.some((pattern) => pattern.test(normalizedPrompt))) {
    score += 0.45;
  }

  if (normalizedPrompt.length >= 48) {
    score += 0.15;
  }

  if (normalizedNextMessage) {
    score += 0.1;
  }

  if (threadLength >= 4) {
    score += 0.05;
  }

  return score;
}

export function buildRecentUserMessageSnapshot(
  threadMessagesCollection: ChatMessage[][],
): string | undefined {
  const snippets: string[] = [];
  const seen = new Set<string>();

  for (const messages of threadMessagesCollection) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== "user") {
        continue;
      }

      const text = messageToText(message);
      if (!text) {
        continue;
      }

      const normalized = normalizeLearningText(text);
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      snippets.push(truncateSnippet(text));

      if (snippets.length >= SELF_LEARNING_USER_SNAPSHOT_LIMIT) {
        return snippets.map((snippet) => `- ${snippet}`).join("\n");
      }
    }
  }

  if (snippets.length === 0) {
    return undefined;
  }

  return snippets.map((snippet) => `- ${snippet}`).join("\n");
}

export function buildCandidateContextFromMessage(input: {
  threadId: string;
  messageId: string;
  messages: ChatMessage[];
  sourceType: SelfLearningCandidateSourceType;
  signalEventId?: string | null;
  sourceReason?: string | null;
  recentUserMessageSnapshot?: string;
}): CandidateContext | null {
  const targetIndex = input.messages.findIndex(
    (message) => message.id === input.messageId && message.role === "assistant",
  );
  if (targetIndex === -1) {
    return null;
  }

  const assistantResponse = messageToText(input.messages[targetIndex]);
  const precedingUserPrompt = findPrecedingUserPrompt(
    input.messages,
    targetIndex,
  );
  const nextUserMessage = findNextUserMessage(input.messages, targetIndex);

  if (!assistantResponse || !precedingUserPrompt) {
    return null;
  }

  const sourceMetricScore =
    input.sourceType === "passive_history"
      ? nextUserMessage
        ? PASSIVE_HISTORY_FOLLOW_UP_SCORE
        : PASSIVE_HISTORY_BASE_SCORE
      : getImplicitSignalScore(input.sourceType);

  return {
    threadId: input.threadId,
    messageId: input.messageId,
    signalEventId: input.signalEventId ?? null,
    assistantResponse,
    precedingUserPrompt,
    nextUserMessage,
    sourceType: input.sourceType,
    sourceReason: input.sourceReason ?? null,
    recentUserMessageSnapshot: input.recentUserMessageSnapshot,
    sourceMetricScore,
  };
}

export function buildCandidateContextFromSignal(
  signal: SelfLearningSignalEvent,
  messages: ChatMessage[],
  recentUserMessageSnapshot?: string,
): CandidateContext | null {
  if (!signal.threadId || !signal.messageId) {
    return null;
  }

  const payload = signal.payload as { reason?: string | null } | null;

  return buildCandidateContextFromMessage({
    threadId: signal.threadId,
    messageId: signal.messageId,
    messages,
    sourceType: signal.signalType,
    signalEventId: signal.id,
    sourceReason: payload?.reason ?? null,
    recentUserMessageSnapshot,
  });
}

export function buildPassiveHistoryCandidates(input: {
  threadMessagesByThread: Array<{
    threadId: string;
    messages: ChatMessage[];
  }>;
  excludedMessageIds?: Set<string>;
  recentUserMessageSnapshot?: string;
  limit?: number;
  maxPerThread?: number;
}): CandidateContext[] {
  return buildPassiveHistoryCandidateSelection(input).candidates;
}

export function buildPassiveHistoryCandidateSelection(input: {
  threadMessagesByThread: Array<{
    threadId: string;
    messages: ChatMessage[];
  }>;
  excludedMessageIds?: Set<string>;
  recentUserMessageSnapshot?: string;
  limit?: number;
  maxPerThread?: number;
}): PassiveHistoryCandidateSelection {
  const limit = input.limit ?? SELF_LEARNING_MAX_CANDIDATES_PER_RUN;
  const maxPerThread =
    input.maxPerThread ?? SELF_LEARNING_PASSIVE_CANDIDATES_PER_THREAD;
  const excludedMessageIds = input.excludedMessageIds ?? new Set<string>();
  const rankedCandidates: Array<{
    candidate: CandidateContext;
    rank: number;
    threadId: string;
    messageIndex: number;
  }> = [];
  let assistantTurnsSeen = 0;
  let alreadyEvaluatedExcluded = 0;
  let smallTalkExcluded = 0;
  let missingPrecedingUserExcluded = 0;

  for (const thread of input.threadMessagesByThread) {
    for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
      const message = thread.messages[index];
      if (message.role !== "assistant") {
        continue;
      }

      assistantTurnsSeen += 1;

      if (excludedMessageIds.has(message.id)) {
        alreadyEvaluatedExcluded += 1;
        continue;
      }

      const precedingUserPrompt = findPrecedingUserPrompt(
        thread.messages,
        index,
      );
      if (!precedingUserPrompt) {
        missingPrecedingUserExcluded += 1;
        continue;
      }

      if (isLowValueSmallTalkPrompt(precedingUserPrompt)) {
        smallTalkExcluded += 1;
        continue;
      }

      const candidate = buildCandidateContextFromMessage({
        threadId: thread.threadId,
        messageId: message.id,
        messages: thread.messages,
        sourceType: "passive_history",
        sourceReason:
          "Passive history scan from recent chat turns to learn durable habits, materials, and workflow preferences.",
        recentUserMessageSnapshot: input.recentUserMessageSnapshot,
      });

      if (!candidate) {
        continue;
      }

      rankedCandidates.push({
        candidate,
        rank: rankPassiveHistoryCandidate(candidate, thread.messages.length),
        threadId: thread.threadId,
        messageIndex: index,
      });
    }
  }

  rankedCandidates.sort((left, right) => {
    if (right.rank !== left.rank) {
      return right.rank - left.rank;
    }

    return right.messageIndex - left.messageIndex;
  });

  const candidates: CandidateContext[] = [];
  const perThreadCounts = new Map<string, number>();

  for (const item of rankedCandidates) {
    if (candidates.length >= limit) {
      break;
    }

    const currentThreadCount = perThreadCounts.get(item.threadId) ?? 0;
    if (currentThreadCount >= maxPerThread) {
      continue;
    }

    candidates.push(item.candidate);
    perThreadCounts.set(item.threadId, currentThreadCount + 1);
  }

  let emptyReason: SelfLearningEmptyReason | null = null;

  if (input.threadMessagesByThread.length === 0) {
    emptyReason = "no_chat_history";
  } else if (assistantTurnsSeen === 0) {
    emptyReason = "no_assistant_turns";
  } else if (candidates.length > 0) {
    emptyReason = null;
  } else if (assistantTurnsSeen === alreadyEvaluatedExcluded) {
    emptyReason = "all_recent_turns_already_evaluated";
  } else if (
    assistantTurnsSeen ===
    alreadyEvaluatedExcluded + smallTalkExcluded + missingPrecedingUserExcluded
  ) {
    emptyReason =
      smallTalkExcluded > 0
        ? "only_low_value_small_talk"
        : "no_candidates_after_filters";
  } else {
    emptyReason = "no_candidates_after_filters";
  }

  return {
    candidates,
    diagnostics: {
      assistantTurnsSeen,
      alreadyEvaluatedExcluded,
      smallTalkExcluded,
      missingPrecedingUserExcluded,
      finalCandidateCount: candidates.length,
      emptyReason,
    },
  };
}
