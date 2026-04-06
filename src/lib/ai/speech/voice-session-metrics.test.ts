import { describe, expect, it } from "vitest";
import { deriveVoiceSessionMetrics } from "./voice-session-metrics";

describe("voice session metrics", () => {
  it("derives useful latency and tool timing summaries from a voice session", () => {
    const summary = deriveVoiceSessionMetrics([
      {
        at: 100,
        type: "user_transcript_final",
      },
      {
        at: 280,
        type: "assistant_audio_started",
        details: {
          source: "user_turn",
          latencyMs: 180,
        },
      },
      {
        at: 400,
        type: "tool_started",
      },
      {
        at: 620,
        type: "tool_progress_requested",
        details: {
          elapsedMs: 220,
          stage: "ack",
        },
      },
      {
        at: 2100,
        type: "tool_finished",
        details: {
          durationMs: 1700,
        },
      },
      {
        at: 2200,
        type: "barge_in",
      },
    ]);

    expect(summary).toEqual({
      eventCount: 6,
      bargeInCount: 1,
      toolCallCount: 1,
      toolProgressCount: 1,
      userTurnCount: 1,
      firstAssistantAudioLatencyMs: 180,
      firstToolProgressLatencyMs: 220,
      averageToolDurationMs: 1700,
      maxToolDurationMs: 1700,
    });
  });
});
