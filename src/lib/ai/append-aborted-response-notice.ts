import { UIMessage } from "ai";

export const ABORTED_RESPONSE_NOTICE = "*Response stopped by user*";

function hasAbortNotice(text: string) {
  return text.trimEnd().endsWith(ABORTED_RESPONSE_NOTICE);
}

function appendAbortNotice(text: string) {
  if (hasAbortNotice(text)) {
    return text;
  }

  if (text.trim().length === 0) {
    return ABORTED_RESPONSE_NOTICE;
  }

  return `${text.trimEnd()}\n\n${ABORTED_RESPONSE_NOTICE}`;
}

export function appendAbortedResponseNotice<T extends UIMessage>(
  message: T,
): T {
  if (message.role !== "assistant") {
    return message;
  }

  const normalizedMessage = structuredClone(message) as T;

  normalizedMessage.parts = normalizedMessage.parts.map((part) => {
    if (part.type === "text" || part.type === "reasoning") {
      return {
        ...part,
        state: "done",
      };
    }

    return part;
  }) as T["parts"];

  let lastActionableIndex = -1;
  for (let i = normalizedMessage.parts.length - 1; i >= 0; i--) {
    const part = normalizedMessage.parts[i];
    if (part.type === "reasoning" || part.type === "step-start") {
      continue;
    }

    lastActionableIndex = i;
    break;
  }

  if (
    lastActionableIndex >= 0 &&
    normalizedMessage.parts[lastActionableIndex]?.type === "text"
  ) {
    const part = normalizedMessage.parts[lastActionableIndex] as Extract<
      T["parts"][number],
      { type: "text" }
    >;

    part.text = appendAbortNotice(part.text);
    part.state = "done";

    return normalizedMessage;
  }

  const lastPart = normalizedMessage.parts.at(-1);
  if (lastPart?.type === "text" && hasAbortNotice(lastPart.text)) {
    return normalizedMessage;
  }

  normalizedMessage.parts.push({
    type: "text",
    text: ABORTED_RESPONSE_NOTICE,
    state: "done",
  } as T["parts"][number]);

  return normalizedMessage;
}
