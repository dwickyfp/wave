import { describe, expect, it } from "vitest";
import {
  appendOrReplaceRealtimeMessageText,
  getLatestVoiceTurnMessages,
  upsertRealtimeToolPart,
} from "./realtime-voice-state";

describe("realtime voice state helpers", () => {
  it("creates and appends assistant transcript text in place", () => {
    const initial = appendOrReplaceRealtimeMessageText({
      messages: [],
      messageId: "assistant-1",
      role: "assistant",
      text: "Hello",
    });

    const next = appendOrReplaceRealtimeMessageText({
      messages: initial,
      messageId: "assistant-1",
      role: "assistant",
      text: " there",
      append: true,
    });

    expect(next).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello there" }],
      },
    ]);
  });

  it("upserts realtime tool progress and stores errors as errorText", () => {
    const withInput = upsertRealtimeToolPart({
      messages: [],
      part: {
        messageId: "assistant-2",
        toolName: "webSearch",
        toolCallId: "call-1",
        input: { query: "weather" },
        state: "input-available",
      },
    });

    const withError = upsertRealtimeToolPart({
      messages: withInput,
      part: {
        messageId: "assistant-2",
        toolName: "webSearch",
        toolCallId: "call-1",
        input: { query: "weather" },
        state: "output-error",
        output: {
          error: "network timeout",
        },
      },
    });

    expect(withError[0]?.parts).toEqual([
      expect.objectContaining({
        type: "tool-webSearch",
        toolCallId: "call-1",
        state: "output-error",
        errorText: "network timeout",
      }),
    ]);
  });

  it("returns only the latest voice turn from the latest user message onward", () => {
    const messages = [
      {
        id: "assistant-older",
        role: "assistant",
        parts: [{ type: "text", text: "Older turn" }],
      },
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Latest prompt" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Latest answer" }],
      },
    ] as const;

    expect(getLatestVoiceTurnMessages(messages as any)).toEqual([
      messages[1],
      messages[2],
    ]);
  });
});
