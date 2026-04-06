import type { UIMessage } from "ai";

type UIMessagePart = UIMessage["parts"][number];
type UITextPart = Extract<UIMessagePart, { type: "text" }>;
type UIToolPart = Extract<UIMessagePart, { type: `tool-${string}` }>;

type RealtimeToolPartInput = {
  messageId: string;
  toolName: string;
  toolCallId: string;
  input: unknown;
  state:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error";
  output?: unknown;
  providerExecuted?: boolean;
};

function ensureAssistantMessage(messages: UIMessage[], messageId: string) {
  const nextMessages = [...messages];
  const index = nextMessages.findIndex((message) => message.id === messageId);

  if (index >= 0) {
    const message = nextMessages[index];
    if (message.role === "assistant") {
      return { index, nextMessages };
    }
  }

  nextMessages.push({
    id: messageId,
    role: "assistant",
    parts: [],
  });

  return {
    index: nextMessages.length - 1,
    nextMessages,
  };
}

export function appendOrReplaceRealtimeMessageText(input: {
  messages: UIMessage[];
  messageId: string;
  role: UIMessage["role"];
  text: string;
  append?: boolean;
}) {
  const { messages, messageId, role, text, append = true } = input;
  const nextMessages = [...messages];
  const index = nextMessages.findIndex((message) => message.id === messageId);

  if (index === -1) {
    const textPart: UITextPart = { type: "text", text };
    nextMessages.push({
      id: messageId,
      role,
      parts: [textPart],
    });
    return nextMessages;
  }

  const current = nextMessages[index];
  const textPartIndex = current.parts.findIndex((part) => part.type === "text");
  const nextText =
    textPartIndex >= 0 && append
      ? `${(current.parts[textPartIndex] as { text: string }).text}${text}`
      : text;

  const nextParts = (
    textPartIndex >= 0
      ? current.parts.map((part, partIndex) =>
          partIndex === textPartIndex ? { ...part, text: nextText } : part,
        )
      : [...current.parts, { type: "text", text: nextText } as UITextPart]
  ) as UIMessage["parts"];

  nextMessages[index] = {
    ...current,
    role,
    parts: nextParts,
  };

  return nextMessages;
}

export function upsertRealtimeToolPart(input: {
  messages: UIMessage[];
  part: RealtimeToolPartInput;
}) {
  const { messages, part } = input;
  const { index, nextMessages } = ensureAssistantMessage(
    messages,
    part.messageId,
  );
  const message = nextMessages[index];
  const toolPartType = `tool-${part.toolName}`;
  const existingIndex = message.parts.findIndex(
    (messagePart) =>
      (messagePart as { toolCallId?: string }).toolCallId === part.toolCallId,
  );
  const nextPart = (
    part.state === "output-error"
      ? {
          type: toolPartType,
          toolCallId: part.toolCallId,
          state: part.state,
          input: part.input,
          errorText:
            typeof part.output === "string"
              ? part.output
              : (
                  part.output as {
                    error?: string;
                    statusMessage?: string;
                  } | null
                )?.error ||
                (
                  part.output as {
                    error?: string;
                    statusMessage?: string;
                  } | null
                )?.statusMessage ||
                "Tool execution failed.",
          providerExecuted: part.providerExecuted ?? false,
        }
      : {
          type: toolPartType,
          toolCallId: part.toolCallId,
          state: part.state,
          input: part.input,
          ...(part.output !== undefined ? { output: part.output } : {}),
          providerExecuted: part.providerExecuted ?? false,
        }
  ) as UIToolPart;

  const nextParts = (
    existingIndex >= 0
      ? message.parts.map((messagePart, messagePartIndex) =>
          messagePartIndex === existingIndex
            ? ({
                ...messagePart,
                ...nextPart,
              } as UIToolPart)
            : messagePart,
        )
      : [...message.parts, nextPart]
  ) as UIMessage["parts"];

  nextMessages[index] = {
    ...message,
    parts: nextParts,
  };

  return nextMessages;
}

export function getLatestVoiceTurnMessages(messages: UIMessage[]) {
  const latestUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );

  if (latestUserIndex < 0) {
    return [];
  }

  return messages.slice(latestUserIndex);
}
