import type { UIMessage } from "ai";

export type StoredDashboardOpenAiToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type StoredDashboardOpenAiMessage = {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content?:
    | string
    | Array<{
        type: string;
        text?: string;
      }>
    | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: StoredDashboardOpenAiToolCall[];
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stringifyStructuredValue(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") {
      return parsed;
    }

    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

function normalizeStoredContent(
  content: StoredDashboardOpenAiMessage["content"],
) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
      .join("");
  }

  return "";
}

function formatToolCalls(toolCalls: StoredDashboardOpenAiToolCall[]) {
  if (!toolCalls.length) return "";

  return [
    "Tool calls:",
    ...toolCalls.map((toolCall) => {
      const formattedArgs = stringifyStructuredValue(
        toolCall.function.arguments,
      );
      return `- ${toolCall.function.name}\n\`\`\`json\n${formattedArgs}\n\`\`\``;
    }),
  ].join("\n");
}

function toDisplayText(message: StoredDashboardOpenAiMessage) {
  if (message.role === "system" || message.role === "developer") {
    return null;
  }

  const baseContent = normalizeStoredContent(message.content).trim();

  if (message.role === "assistant") {
    const toolCallText = formatToolCalls(message.tool_calls ?? []);
    return [baseContent, toolCallText].filter(Boolean).join("\n\n").trim();
  }

  if (message.role === "tool") {
    const label = message.name
      ? `Tool result: ${message.name}`
      : message.tool_call_id
        ? `Tool result: ${message.tool_call_id}`
        : "Tool result";
    const formattedContent = baseContent
      ? `\`\`\`\n${stringifyStructuredValue(baseContent)}\n\`\`\``
      : "";
    return [label, formattedContent].filter(Boolean).join("\n\n").trim();
  }

  return baseContent;
}

function toUiMessage(
  prefix: string,
  index: number,
  message: StoredDashboardOpenAiMessage,
): UIMessage | null {
  const text = toDisplayText(message);
  if (!text) return null;

  return {
    id: `${prefix}-${index}`,
    role:
      message.role === "user" || message.role === "system"
        ? message.role
        : "assistant",
    parts: [{ type: "text", text }],
  };
}

export function buildExternalChatTranscriptFromSnapshot(options: {
  requestMessages: StoredDashboardOpenAiMessage[];
  responseMessage?: StoredDashboardOpenAiMessage | null;
}): UIMessage[] {
  const messages = options.requestMessages
    .map((message, index) => toUiMessage("external-request", index, message))
    .filter((message): message is UIMessage => !!message);

  if (options.responseMessage) {
    const responseMessage = toUiMessage(
      "external-response",
      messages.length,
      options.responseMessage,
    );
    if (responseMessage) {
      messages.push(responseMessage);
    }
  }

  return messages;
}

export function buildExternalChatTranscriptFromPreviews(
  turns: Array<{
    id: string;
    requestPreview: string | null;
    responsePreview: string | null;
  }>,
): UIMessage[] {
  return turns.flatMap((turn, index) => {
    const previewMessages: UIMessage[] = [];

    const requestText = normalizeWhitespace(turn.requestPreview ?? "");
    if (requestText) {
      previewMessages.push({
        id: `${turn.id}-request-${index}`,
        role: "user",
        parts: [{ type: "text", text: requestText }],
      });
    }

    const responseText = normalizeWhitespace(turn.responsePreview ?? "");
    if (responseText) {
      previewMessages.push({
        id: `${turn.id}-response-${index}`,
        role: "assistant",
        parts: [{ type: "text", text: responseText }],
      });
    }

    return previewMessages;
  });
}
