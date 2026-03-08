import type { ChatFeedbackType } from "../../../src/types/chat";

export function resolveNextPilotFeedback(
  current: ChatFeedbackType | null | undefined,
  requested: ChatFeedbackType,
) {
  return current === requested ? null : requested;
}

export function shouldFetchPilotFeedback(
  messageId: string | null | undefined,
  feedbackByMessageId: Record<string, ChatFeedbackType | null>,
) {
  const normalizedId = messageId?.trim();
  if (!normalizedId) {
    return false;
  }

  return !(normalizedId in feedbackByMessageId);
}
