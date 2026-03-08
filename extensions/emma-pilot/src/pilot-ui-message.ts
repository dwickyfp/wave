import type { ToolUIPart, UIMessage } from "ai";

type UnknownRecord = Record<string, unknown>;

type PilotStreamChunk = UnknownRecord & {
  type: string;
};

type StreamingPilotState<UI_MESSAGE extends UIMessage> = {
  message: UI_MESSAGE;
  activeTextParts: Record<string, UnknownRecord>;
  activeReasoningParts: Record<string, UnknownRecord>;
  partialToolCalls: Record<
    string,
    {
      text: string;
      toolName: string;
      dynamic?: boolean;
      title?: string;
    }
  >;
};

function isPlainObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergePilotMetadata(
  currentValue: unknown,
  nextValue: unknown,
): unknown {
  if (!isPlainObject(currentValue) || !isPlainObject(nextValue)) {
    return nextValue;
  }

  const merged: UnknownRecord = { ...currentValue };
  for (const [key, value] of Object.entries(nextValue)) {
    merged[key] =
      key in merged ? mergePilotMetadata(merged[key], value) : value;
  }

  return merged;
}

function tryParseToolInput(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function createStreamingPilotState<UI_MESSAGE extends UIMessage>(options: {
  lastMessage?: UI_MESSAGE | null;
  messageId?: string;
}) {
  return {
    message:
      options.lastMessage?.role === "assistant"
        ? structuredClone(options.lastMessage)
        : ({
            id: options.messageId ?? "",
            role: "assistant",
            metadata: undefined,
            parts: [],
          } as unknown as UI_MESSAGE),
    activeTextParts: {},
    activeReasoningParts: {},
    partialToolCalls: {},
  } satisfies StreamingPilotState<UI_MESSAGE>;
}

export function isToolUIPart(part: unknown): part is ToolUIPart {
  return (
    isPlainObject(part) &&
    typeof part.type === "string" &&
    (part.type === "dynamic-tool" || part.type.startsWith("tool-")) &&
    typeof part.toolCallId === "string"
  );
}

export function getToolName(part: unknown) {
  if (!isPlainObject(part) || typeof part.type !== "string") {
    return "";
  }

  if (part.type === "dynamic-tool" && typeof part.toolName === "string") {
    return part.toolName;
  }

  return part.type.startsWith("tool-") ? part.type.slice(5) : part.type;
}

function getToolPartById(parts: UIMessage["parts"], toolCallId: string) {
  return parts.find(
    (part) => isToolUIPart(part) && part.toolCallId === toolCallId,
  ) as UnknownRecord | undefined;
}

function upsertToolPart<UI_MESSAGE extends UIMessage>(
  state: StreamingPilotState<UI_MESSAGE>,
  options: {
    toolCallId: string;
    toolName: string;
    dynamic?: boolean;
    title?: string;
    providerExecuted?: boolean;
    providerMetadata?: unknown;
    state:
      | "input-streaming"
      | "input-available"
      | "output-available"
      | "output-error";
    input?: unknown;
    output?: unknown;
    rawInput?: unknown;
    errorText?: string;
    preliminary?: boolean;
  },
) {
  const existingPart = getToolPartById(state.message.parts, options.toolCallId);

  if (existingPart) {
    existingPart.state = options.state;
    existingPart.input = options.input;
    existingPart.output = options.output;
    existingPart.rawInput = options.rawInput ?? existingPart.rawInput;
    existingPart.errorText = options.errorText;
    existingPart.preliminary = options.preliminary;
    existingPart.providerExecuted =
      options.providerExecuted ?? existingPart.providerExecuted;

    if (options.title !== undefined) {
      existingPart.title = options.title;
    }

    if (options.providerMetadata != null) {
      existingPart.callProviderMetadata = options.providerMetadata;
    }

    if (existingPart.type === "dynamic-tool") {
      existingPart.toolName = options.toolName;
    }

    return;
  }

  state.message.parts.push({
    type: options.dynamic ? "dynamic-tool" : `tool-${options.toolName}`,
    ...(options.dynamic ? { toolName: options.toolName } : {}),
    toolCallId: options.toolCallId,
    state: options.state,
    title: options.title,
    input: options.input,
    output: options.output,
    rawInput: options.rawInput,
    errorText: options.errorText,
    providerExecuted: options.providerExecuted,
    preliminary: options.preliminary,
    ...(options.providerMetadata != null
      ? { callProviderMetadata: options.providerMetadata }
      : {}),
  } as UI_MESSAGE["parts"][number]);
}

function emitMessage<UI_MESSAGE extends UIMessage>(
  state: StreamingPilotState<UI_MESSAGE>,
  onMessage: (message: UI_MESSAGE) => void,
) {
  onMessage(structuredClone(state.message));
}

async function* iteratePilotJsonEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const parseEventBlock = (block: string) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();

    if (!data || data === "[DONE]") {
      return null;
    }

    return JSON.parse(data);
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n?/g, "\n");

    let boundaryIndex = buffer.indexOf("\n\n");
    while (boundaryIndex >= 0) {
      const block = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      const event = parseEventBlock(block);
      if (event != null) {
        yield event;
      }
      boundaryIndex = buffer.indexOf("\n\n");
    }

    if (done) {
      const trailingEvent = parseEventBlock(buffer);
      if (trailingEvent != null) {
        yield trailingEvent;
      }
      return;
    }
  }
}

function applyPilotStreamChunk<UI_MESSAGE extends UIMessage>(options: {
  chunk: PilotStreamChunk;
  state: StreamingPilotState<UI_MESSAGE>;
  onMessage: (message: UI_MESSAGE) => void;
}) {
  const { chunk, state, onMessage } = options;

  switch (chunk.type) {
    case "text-start": {
      const textPart = {
        type: "text",
        text: "",
        state: "streaming",
        providerMetadata: chunk.providerMetadata,
      };
      state.activeTextParts[String(chunk.id ?? "")] = textPart;
      state.message.parts.push(textPart as UI_MESSAGE["parts"][number]);
      emitMessage(state, onMessage);
      return;
    }

    case "text-delta": {
      const part = state.activeTextParts[String(chunk.id ?? "")];
      if (part) {
        part.text = `${String(part.text ?? "")}${String(chunk.delta ?? "")}`;
        part.providerMetadata = chunk.providerMetadata ?? part.providerMetadata;
        emitMessage(state, onMessage);
      }
      return;
    }

    case "text-end": {
      const part = state.activeTextParts[String(chunk.id ?? "")];
      if (part) {
        part.state = "done";
        part.providerMetadata = chunk.providerMetadata ?? part.providerMetadata;
        delete state.activeTextParts[String(chunk.id ?? "")];
        emitMessage(state, onMessage);
      }
      return;
    }

    case "reasoning-start": {
      const reasoningPart = {
        type: "reasoning",
        text: "",
        state: "streaming",
        providerMetadata: chunk.providerMetadata,
      };
      state.activeReasoningParts[String(chunk.id ?? "")] = reasoningPart;
      state.message.parts.push(reasoningPart as UI_MESSAGE["parts"][number]);
      emitMessage(state, onMessage);
      return;
    }

    case "reasoning-delta": {
      const part = state.activeReasoningParts[String(chunk.id ?? "")];
      if (part) {
        part.text = `${String(part.text ?? "")}${String(chunk.delta ?? "")}`;
        part.providerMetadata = chunk.providerMetadata ?? part.providerMetadata;
        emitMessage(state, onMessage);
      }
      return;
    }

    case "reasoning-end": {
      const part = state.activeReasoningParts[String(chunk.id ?? "")];
      if (part) {
        part.state = "done";
        part.providerMetadata = chunk.providerMetadata ?? part.providerMetadata;
        delete state.activeReasoningParts[String(chunk.id ?? "")];
        emitMessage(state, onMessage);
      }
      return;
    }

    case "file": {
      state.message.parts.push({
        type: "file",
        url: String(chunk.url ?? ""),
        mediaType: String(chunk.mediaType ?? ""),
      } as UI_MESSAGE["parts"][number]);
      emitMessage(state, onMessage);
      return;
    }

    case "source-url": {
      state.message.parts.push({
        type: "source-url",
        sourceId: String(chunk.sourceId ?? ""),
        url: String(chunk.url ?? ""),
        title: typeof chunk.title === "string" ? chunk.title : undefined,
        providerMetadata: chunk.providerMetadata,
      } as UI_MESSAGE["parts"][number]);
      emitMessage(state, onMessage);
      return;
    }

    case "source-document": {
      state.message.parts.push({
        type: "source-document",
        sourceId: String(chunk.sourceId ?? ""),
        mediaType: String(chunk.mediaType ?? ""),
        title: String(chunk.title ?? ""),
        filename:
          typeof chunk.filename === "string" ? chunk.filename : undefined,
        providerMetadata: chunk.providerMetadata,
      } as UI_MESSAGE["parts"][number]);
      emitMessage(state, onMessage);
      return;
    }

    case "tool-input-start": {
      state.partialToolCalls[String(chunk.toolCallId ?? "")] = {
        text: "",
        toolName: String(chunk.toolName ?? ""),
        dynamic: Boolean(chunk.dynamic),
        title: typeof chunk.title === "string" ? chunk.title : undefined,
      };
      upsertToolPart(state, {
        toolCallId: String(chunk.toolCallId ?? ""),
        toolName: String(chunk.toolName ?? ""),
        dynamic: Boolean(chunk.dynamic),
        state: "input-streaming",
        input: undefined,
        providerExecuted:
          typeof chunk.providerExecuted === "boolean"
            ? chunk.providerExecuted
            : undefined,
        providerMetadata: chunk.providerMetadata,
        title: typeof chunk.title === "string" ? chunk.title : undefined,
      });
      emitMessage(state, onMessage);
      return;
    }

    case "tool-input-delta": {
      const partial = state.partialToolCalls[String(chunk.toolCallId ?? "")];
      if (!partial) {
        return;
      }

      partial.text += String(chunk.inputTextDelta ?? "");
      upsertToolPart(state, {
        toolCallId: String(chunk.toolCallId ?? ""),
        toolName: partial.toolName,
        dynamic: partial.dynamic,
        state: "input-streaming",
        input: tryParseToolInput(partial.text),
        title: partial.title,
      });
      emitMessage(state, onMessage);
      return;
    }

    case "tool-input-available": {
      upsertToolPart(state, {
        toolCallId: String(chunk.toolCallId ?? ""),
        toolName: String(chunk.toolName ?? ""),
        dynamic: Boolean(chunk.dynamic),
        state: "input-available",
        input: chunk.input,
        providerExecuted:
          typeof chunk.providerExecuted === "boolean"
            ? chunk.providerExecuted
            : undefined,
        providerMetadata: chunk.providerMetadata,
        title: typeof chunk.title === "string" ? chunk.title : undefined,
      });
      emitMessage(state, onMessage);
      return;
    }

    case "tool-input-error": {
      upsertToolPart(state, {
        toolCallId: String(chunk.toolCallId ?? ""),
        toolName: String(chunk.toolName ?? ""),
        dynamic: Boolean(chunk.dynamic),
        state: "output-error",
        input: chunk.input,
        rawInput: chunk.input,
        errorText: String(chunk.errorText ?? "Tool input failed."),
        providerExecuted:
          typeof chunk.providerExecuted === "boolean"
            ? chunk.providerExecuted
            : undefined,
        providerMetadata: chunk.providerMetadata,
        title: typeof chunk.title === "string" ? chunk.title : undefined,
      });
      emitMessage(state, onMessage);
      return;
    }

    case "tool-approval-request": {
      const part = getToolPartById(
        state.message.parts,
        String(chunk.toolCallId ?? ""),
      );
      if (part) {
        part.state = "approval-requested";
        part.approval = {
          id: String(chunk.approvalId ?? ""),
        };
        emitMessage(state, onMessage);
      }
      return;
    }

    case "tool-output-denied": {
      const part = getToolPartById(
        state.message.parts,
        String(chunk.toolCallId ?? ""),
      );
      if (part) {
        part.state = "output-denied";
        emitMessage(state, onMessage);
      }
      return;
    }

    case "tool-output-available": {
      const part = getToolPartById(
        state.message.parts,
        String(chunk.toolCallId ?? ""),
      );
      upsertToolPart(state, {
        toolCallId: String(chunk.toolCallId ?? ""),
        toolName: part ? getToolName(part) : "",
        dynamic: part?.type === "dynamic-tool",
        state: "output-available",
        input: part?.input,
        output: chunk.output,
        providerExecuted:
          typeof chunk.providerExecuted === "boolean"
            ? chunk.providerExecuted
            : undefined,
        preliminary:
          typeof chunk.preliminary === "boolean"
            ? chunk.preliminary
            : undefined,
        title: typeof part?.title === "string" ? part.title : undefined,
      });
      emitMessage(state, onMessage);
      return;
    }

    case "tool-output-error": {
      const part = getToolPartById(
        state.message.parts,
        String(chunk.toolCallId ?? ""),
      );
      upsertToolPart(state, {
        toolCallId: String(chunk.toolCallId ?? ""),
        toolName: part ? getToolName(part) : "",
        dynamic: part?.type === "dynamic-tool",
        state: "output-error",
        input: part?.input,
        rawInput: part?.rawInput,
        errorText: String(chunk.errorText ?? "Tool execution failed."),
        providerExecuted:
          typeof chunk.providerExecuted === "boolean"
            ? chunk.providerExecuted
            : undefined,
        title: typeof part?.title === "string" ? part.title : undefined,
      });
      emitMessage(state, onMessage);
      return;
    }

    case "start-step": {
      state.message.parts.push({
        type: "step-start",
      } as UI_MESSAGE["parts"][number]);
      emitMessage(state, onMessage);
      return;
    }

    case "finish-step": {
      state.activeTextParts = {};
      state.activeReasoningParts = {};
      return;
    }

    case "start": {
      if (typeof chunk.messageId === "string" && chunk.messageId) {
        state.message.id = chunk.messageId;
      }

      if (chunk.messageMetadata !== undefined) {
        state.message.metadata = mergePilotMetadata(
          state.message.metadata,
          chunk.messageMetadata,
        ) as UI_MESSAGE["metadata"];
      }

      emitMessage(state, onMessage);
      return;
    }

    case "finish":
    case "message-metadata": {
      if (chunk.messageMetadata !== undefined) {
        state.message.metadata = mergePilotMetadata(
          state.message.metadata,
          chunk.messageMetadata,
        ) as UI_MESSAGE["metadata"];
        emitMessage(state, onMessage);
      }
      return;
    }

    case "error":
      throw new Error(String(chunk.errorText ?? "Emma Pilot stream failed."));

    default: {
      if (chunk.type.startsWith("data-")) {
        if (chunk.transient) {
          return;
        }

        const existingIndex =
          typeof chunk.id === "string"
            ? state.message.parts.findIndex(
                (part) =>
                  isPlainObject(part) &&
                  part.type === chunk.type &&
                  "id" in part &&
                  part.id === chunk.id,
              )
            : -1;

        const nextPart = {
          type: chunk.type,
          ...(typeof chunk.id === "string" ? { id: chunk.id } : {}),
          data: chunk.data,
        } as UI_MESSAGE["parts"][number];

        if (existingIndex >= 0) {
          state.message.parts[existingIndex] = nextPart;
        } else {
          state.message.parts.push(nextPart);
        }

        emitMessage(state, onMessage);
      }
    }
  }
}

export async function consumePilotUIMessageStream<
  UI_MESSAGE extends UIMessage,
>(options: {
  response: Response;
  message?: UI_MESSAGE | null;
  onMessage: (message: UI_MESSAGE) => void;
}) {
  if (!options.response.ok) {
    const payload = await options.response.json().catch(() => ({}));
    throw new Error(
      (isPlainObject(payload) &&
        (typeof payload.error === "string"
          ? payload.error
          : typeof payload.message === "string"
            ? payload.message
            : undefined)) ||
        "Request failed.",
    );
  }

  if (!options.response.body) {
    throw new Error("Emma Pilot response stream is empty.");
  }

  const state = createStreamingPilotState<UI_MESSAGE>({
    lastMessage: options.message,
    messageId: options.message?.id,
  });

  for await (const chunk of iteratePilotJsonEvents(options.response.body)) {
    if (!isPlainObject(chunk) || typeof chunk.type !== "string") {
      continue;
    }

    applyPilotStreamChunk({
      chunk: chunk as PilotStreamChunk,
      state,
      onMessage: options.onMessage,
    });
  }

  return structuredClone(state.message);
}
