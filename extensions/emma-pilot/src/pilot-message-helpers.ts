import type { ToolUIPart, UIMessage } from "ai";
import { getToolName, isToolUIPart } from "./pilot-ui-message";

const HIDDEN_PILOT_TOOL_NAMES = new Set(["mini-javascript-execution"]);
const REDACTED_REASONING_LINE_PATTERN = /^\[?redacted\]?$/i;

export type PilotProposalLike = {
  id: string;
  kind: string;
  label: string;
  explanation: string;
  elementId?: string;
  url?: string;
  value?: string;
  checked?: boolean;
  fields?: Array<{
    elementId: string;
    value: string;
  }>;
  requiresApproval?: boolean;
  isSensitive?: boolean;
};

export function extractPilotProposalsFromMessage(
  message?: UIMessage | null,
): PilotProposalLike[] {
  if (!message) {
    return [];
  }

  return message.parts
    .filter((part): part is ToolUIPart => isToolUIPart(part))
    .filter((part) => getToolName(part).startsWith("pilot_propose_"))
    .flatMap((part) => {
      if (part.state !== "output-available") {
        return [];
      }

      const output = part.output;
      if (!output || typeof output !== "object" || !("id" in output)) {
        return [];
      }

      return [output as PilotProposalLike];
    });
}

export function upsertStreamedMessage<T extends UIMessage>(
  messages: T[],
  nextMessage: T,
) {
  const existingIndex = messages.findIndex(
    (message) => message.id === nextMessage.id,
  );

  if (existingIndex === -1) {
    return [...messages, nextMessage];
  }

  return messages.map((message, index) =>
    index === existingIndex ? nextMessage : message,
  );
}

export function withStableMessageId<T extends UIMessage>(
  message: T,
  fallbackId: string,
) {
  const stableId = message.id?.trim() || fallbackId;
  if (message.id === stableId) {
    return message;
  }

  return {
    ...message,
    id: stableId,
  };
}

export function getToolStateLabel(part: ToolUIPart) {
  switch (part.state) {
    case "input-streaming":
      return "Preparing";
    case "input-available":
      return "Running";
    case "output-available":
      return (part as { preliminary?: boolean }).preliminary
        ? "Streaming"
        : "Done";
    case "output-error":
      return "Failed";
    default:
      return "Pending";
  }
}

export function getStableStreamItemKey(input: {
  messageId?: string | null;
  preferredKey?: string | null;
  fallbackLabel?: string | null;
  index: number;
}) {
  const preferred = input.preferredKey?.trim();
  if (preferred) {
    return preferred;
  }

  const messageId = input.messageId?.trim() || "pilot-message";
  const label = input.fallbackLabel?.trim() || "item";
  return `${messageId}-${label}-${input.index}`;
}

export function shouldHidePilotToolPart(
  part: Parameters<typeof getToolName>[0],
) {
  return HIDDEN_PILOT_TOOL_NAMES.has(getToolName(part));
}

export function normalizePilotReasoningText(text: string) {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return "";
  }

  const visibleLines = normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => !REDACTED_REASONING_LINE_PATTERN.test(line.trim()));

  return visibleLines.join("\n").trim();
}
