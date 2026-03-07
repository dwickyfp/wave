import {
  AssistantModelMessage,
  ModelMessage,
  Tool,
  ToolModelMessage,
} from "ai";

interface SanitizeProviderMessagesInput {
  provider?: string | null;
  messages: ModelMessage[];
  tools?: Record<string, Tool>;
}

interface SanitizeProviderMessagesResult {
  messages: ModelMessage[];
  removedMessages: number;
  removedToolParts: number;
}

/**
 * Snowflake rejects historical tool_use/tool_result blocks unless the current
 * request also includes matching tool definitions. When the active toolset
 * changes across turns, prune only the stale tool history for Snowflake.
 */
export function sanitizeModelMessagesForProvider(
  input: SanitizeProviderMessagesInput,
): SanitizeProviderMessagesResult {
  if (input.provider !== "snowflake") {
    return {
      messages: input.messages,
      removedMessages: 0,
      removedToolParts: 0,
    };
  }

  const allowedToolNames = new Set(Object.keys(input.tools ?? {}));
  const keptToolCallIds = new Set<string>();
  const keptApprovalIds = new Set<string>();
  let removedMessages = 0;
  let removedToolParts = 0;

  const messages = input.messages.reduce<ModelMessage[]>((acc, message) => {
    if (message.role === "assistant") {
      const nextMessage = sanitizeAssistantMessage(
        message,
        allowedToolNames,
        keptToolCallIds,
        keptApprovalIds,
      );

      removedToolParts += nextMessage.removedToolParts;
      if (!nextMessage.message) {
        removedMessages += 1;
        return acc;
      }

      acc.push(nextMessage.message);
      return acc;
    }

    if (message.role === "tool") {
      const nextMessage = sanitizeToolMessage(
        message,
        allowedToolNames,
        keptToolCallIds,
        keptApprovalIds,
      );

      removedToolParts += nextMessage.removedToolParts;
      if (!nextMessage.message) {
        removedMessages += 1;
        return acc;
      }

      acc.push(nextMessage.message);
      return acc;
    }

    acc.push(message);
    return acc;
  }, []);

  return {
    messages,
    removedMessages,
    removedToolParts,
  };
}

function sanitizeAssistantMessage(
  message: AssistantModelMessage,
  allowedToolNames: Set<string>,
  keptToolCallIds: Set<string>,
  keptApprovalIds: Set<string>,
): {
  message: AssistantModelMessage | null;
  removedToolParts: number;
} {
  if (!Array.isArray(message.content)) {
    return {
      message,
      removedToolParts: 0,
    };
  }

  let removedToolParts = 0;
  const content = message.content.filter((part) => {
    switch (part.type) {
      case "tool-call": {
        const keep = allowedToolNames.has(part.toolName);
        if (!keep) {
          removedToolParts += 1;
          return false;
        }

        keptToolCallIds.add(part.toolCallId);
        return true;
      }

      case "tool-result": {
        const keep =
          allowedToolNames.has(part.toolName) &&
          keptToolCallIds.has(part.toolCallId);
        if (!keep) {
          removedToolParts += 1;
          return false;
        }

        return true;
      }

      case "tool-approval-request": {
        const keep = keptToolCallIds.has(part.toolCallId);
        if (!keep) {
          removedToolParts += 1;
          return false;
        }

        keptApprovalIds.add(part.approvalId);
        return true;
      }

      default:
        return true;
    }
  });

  if (content.length === 0) {
    return {
      message: null,
      removedToolParts,
    };
  }

  return {
    message: {
      ...message,
      content,
    },
    removedToolParts,
  };
}

function sanitizeToolMessage(
  message: ToolModelMessage,
  allowedToolNames: Set<string>,
  keptToolCallIds: Set<string>,
  keptApprovalIds: Set<string>,
): {
  message: ToolModelMessage | null;
  removedToolParts: number;
} {
  let removedToolParts = 0;
  const content = message.content.filter((part) => {
    switch (part.type) {
      case "tool-result": {
        const keep =
          allowedToolNames.has(part.toolName) &&
          keptToolCallIds.has(part.toolCallId);
        if (!keep) {
          removedToolParts += 1;
          return false;
        }

        return true;
      }

      case "tool-approval-response": {
        const keep = keptApprovalIds.has(part.approvalId);
        if (!keep) {
          removedToolParts += 1;
          return false;
        }

        return true;
      }

      default:
        return true;
    }
  });

  if (content.length === 0) {
    return {
      message: null,
      removedToolParts,
    };
  }

  return {
    message: {
      ...message,
      content,
    },
    removedToolParts,
  };
}

export function shouldSendToolDefinitionsToProvider(options: {
  provider?: string | null;
  tools: Record<string, Tool>;
}) {
  if (options.provider === "snowflake") {
    return Object.keys(options.tools).length > 0;
  }

  return true;
}
