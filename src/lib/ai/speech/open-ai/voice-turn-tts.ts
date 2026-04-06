"use client";

import { isToolUIPart, type UIMessage } from "ai";

const MIN_STREAMING_CHUNK_CHARS = 16;
const FALLBACK_STREAMING_CHUNK_TRIGGER_CHARS = 96;
const FALLBACK_STREAMING_CHUNK_TARGET_CHARS = 140;

const PREFERRED_BOUNDARY_CHARACTERS = new Set([".", "?", "!", ":", "\n"]);
const FALLBACK_BOUNDARY_CHARACTERS = new Set([",", ";"]);

export type VoiceTurnTtsState = {
  lastObservedText: string;
  scheduledText: string;
  spokenText: string;
  queue: string[];
  inFlightChunk: string | null;
  rewriteFallback: boolean;
  streamCompleted: boolean;
};

export function createVoiceTurnTtsState(): VoiceTurnTtsState {
  return {
    lastObservedText: "",
    scheduledText: "",
    spokenText: "",
    queue: [],
    inFlightChunk: null,
    rewriteFallback: false,
    streamCompleted: false,
  };
}

function advanceBoundaryThroughWhitespace(text: string, index: number) {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function findPreferredChunkBoundary(text: string) {
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (!PREFERRED_BOUNDARY_CHARACTERS.has(character ?? "")) {
      continue;
    }

    const boundary = advanceBoundaryThroughWhitespace(text, index + 1);
    if (boundary >= MIN_STREAMING_CHUNK_CHARS) {
      return boundary;
    }
  }

  return -1;
}

function findFallbackChunkBoundary(text: string) {
  if (text.length < FALLBACK_STREAMING_CHUNK_TRIGGER_CHARS) {
    return -1;
  }

  const upperBound = Math.min(
    text.length,
    FALLBACK_STREAMING_CHUNK_TARGET_CHARS,
  );
  let fallbackBoundary = -1;

  for (let index = 0; index < upperBound; index += 1) {
    const character = text[index];
    if (
      !FALLBACK_BOUNDARY_CHARACTERS.has(character ?? "") &&
      !/\s/.test(character ?? "")
    ) {
      continue;
    }

    const boundary = advanceBoundaryThroughWhitespace(text, index + 1);
    if (boundary >= MIN_STREAMING_CHUNK_CHARS) {
      fallbackBoundary = boundary;
    }
  }

  return fallbackBoundary;
}

function extractNextSpeechChunk(
  text: string,
  isStreamFinished: boolean,
): {
  chunk: string;
  usedFallback: boolean;
} | null {
  if (!text) {
    return null;
  }

  const preferredBoundary = findPreferredChunkBoundary(text);
  if (preferredBoundary > 0) {
    return {
      chunk: text.slice(0, preferredBoundary),
      usedFallback: false,
    };
  }

  const fallbackBoundary = findFallbackChunkBoundary(text);
  if (fallbackBoundary > 0) {
    return {
      chunk: text.slice(0, fallbackBoundary),
      usedFallback: true,
    };
  }

  if (!isStreamFinished) {
    return null;
  }

  return {
    chunk: text,
    usedFallback: false,
  };
}

function getCommonPrefixLength(left: string, right: string) {
  const maxLength = Math.min(left.length, right.length);
  let index = 0;

  while (index < maxLength && left[index] === right[index]) {
    index += 1;
  }

  return index;
}

function getSpeechBasePrefix(state: VoiceTurnTtsState) {
  return `${state.spokenText}${state.inFlightChunk ?? ""}`;
}

export function hasPendingVoiceToolCalls(messages: UIMessage[]) {
  const lastMessage = messages.at(-1);

  if (!lastMessage || lastMessage.role !== "assistant") {
    return false;
  }

  const lastStepStartIndex = lastMessage.parts.reduce(
    (lastIndex, part, index) => {
      return part.type === "step-start" ? index : lastIndex;
    },
    -1,
  );

  const lastStepToolInvocations = lastMessage.parts
    .slice(lastStepStartIndex + 1)
    .filter(isToolUIPart)
    .filter((part) => !part.providerExecuted);

  return (
    lastStepToolInvocations.length > 0 &&
    lastStepToolInvocations.some(
      (part) =>
        part.state !== "output-available" && part.state !== "output-error",
    )
  );
}

export function stripMarkdownForSpeech(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^\|/gm, "")
    .replace(/\|$/gm, "")
    .replace(/\|/g, ", ")
    .replace(/^\s*[-:,\s]+\s*$/gm, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/~~/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getAssistantSpeechText(message?: UIMessage | null) {
  if (!message) {
    return "";
  }

  const rawText = message.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text || "")
    .join("\n\n");

  const speechText = stripMarkdownForSpeech(rawText);
  return speechText.slice(0, 12_000).trim();
}

export function getLatestTurnAssistantSpeechText(messages: UIMessage[]) {
  const latestUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );

  if (latestUserIndex < 0) {
    return "";
  }

  const latestAssistantMessage = [...messages.slice(latestUserIndex + 1)]
    .reverse()
    .find((message) => message.role === "assistant");

  return getAssistantSpeechText(latestAssistantMessage);
}

export function deriveVoiceTurnTtsState(input: {
  state: VoiceTurnTtsState;
  assistantText: string;
  shouldHoldForTools: boolean;
  isStreamFinished: boolean;
}): VoiceTurnTtsState {
  const nextState: VoiceTurnTtsState = {
    ...input.state,
    queue: [...input.state.queue],
    streamCompleted: input.isStreamFinished && !input.shouldHoldForTools,
  };

  if (input.shouldHoldForTools || !input.assistantText) {
    return nextState;
  }

  if (
    nextState.lastObservedText &&
    !input.assistantText.startsWith(nextState.lastObservedText)
  ) {
    nextState.rewriteFallback = true;
  }

  nextState.lastObservedText = input.assistantText;

  let unscheduledText = "";

  if (input.assistantText.startsWith(nextState.scheduledText)) {
    unscheduledText = input.assistantText.slice(nextState.scheduledText.length);
  } else {
    nextState.rewriteFallback = true;
    if (!input.isStreamFinished) {
      return nextState;
    }

    nextState.queue = [];
    const basePrefix = getSpeechBasePrefix(nextState);
    const safePrefixLength = input.assistantText.startsWith(basePrefix)
      ? basePrefix.length
      : getCommonPrefixLength(input.assistantText, basePrefix);
    nextState.scheduledText = input.assistantText.slice(0, safePrefixLength);
    unscheduledText = input.assistantText.slice(safePrefixLength);
  }

  while (unscheduledText) {
    const nextChunk = extractNextSpeechChunk(
      unscheduledText,
      input.isStreamFinished,
    );

    if (!nextChunk) {
      break;
    }

    nextState.queue.push(nextChunk.chunk);
    nextState.scheduledText += nextChunk.chunk;
    unscheduledText = unscheduledText.slice(nextChunk.chunk.length);

    if (!input.isStreamFinished && nextChunk.usedFallback) {
      break;
    }
  }

  return nextState;
}

export function shiftVoiceTurnTtsQueue(state: VoiceTurnTtsState) {
  if (state.inFlightChunk || state.queue.length === 0) {
    return state;
  }

  const [nextChunk, ...remainingQueue] = state.queue;

  return {
    ...state,
    inFlightChunk: nextChunk ?? null,
    queue: remainingQueue,
  };
}

export function completeVoiceTurnTtsChunk(state: VoiceTurnTtsState) {
  if (!state.inFlightChunk) {
    return state;
  }

  return {
    ...state,
    spokenText: `${state.spokenText}${state.inFlightChunk}`,
    inFlightChunk: null,
  };
}

export function clearVoiceTurnTtsState() {
  return createVoiceTurnTtsState();
}

export function hasActiveVoiceTurnTtsWork(state: VoiceTurnTtsState) {
  return Boolean(state.inFlightChunk) || state.queue.length > 0;
}

export function shouldFinishVoiceTurnTts(state: VoiceTurnTtsState) {
  return state.streamCompleted && !hasActiveVoiceTurnTtsWork(state);
}
