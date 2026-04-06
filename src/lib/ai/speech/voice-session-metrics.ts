import type { VoiceTimelineEntry } from "./index";

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function deriveVoiceSessionMetrics(events: VoiceTimelineEntry[]) {
  const toolDurations = events
    .filter((event) => event.type === "tool_finished")
    .map((event) => toNumber(event.details?.durationMs))
    .filter((value): value is number => value !== null);

  const userTurnAudioLatencies = events
    .filter((event) => event.type === "assistant_audio_started")
    .filter((event) => event.details?.source === "user_turn")
    .map((event) => toNumber(event.details?.latencyMs))
    .filter((value): value is number => value !== null);

  const toolAckLatencies = events
    .filter((event) => event.type === "tool_progress_requested")
    .map((event) => toNumber(event.details?.elapsedMs))
    .filter((value): value is number => value !== null);

  return {
    eventCount: events.length,
    bargeInCount: events.filter((event) => event.type === "barge_in").length,
    toolCallCount: events.filter((event) => event.type === "tool_started")
      .length,
    toolProgressCount: events.filter(
      (event) => event.type === "tool_progress_requested",
    ).length,
    userTurnCount: events.filter(
      (event) => event.type === "user_transcript_final",
    ).length,
    firstAssistantAudioLatencyMs: userTurnAudioLatencies[0] ?? null,
    firstToolProgressLatencyMs: toolAckLatencies[0] ?? null,
    averageToolDurationMs:
      toolDurations.length > 0
        ? Math.round(
            toolDurations.reduce((sum, duration) => sum + duration, 0) /
              toolDurations.length,
          )
        : null,
    maxToolDurationMs:
      toolDurations.length > 0 ? Math.max(...toolDurations) : null,
  };
}
