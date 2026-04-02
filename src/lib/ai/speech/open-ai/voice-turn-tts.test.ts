import { describe, expect, it } from "vitest";
import {
  clearVoiceTurnTtsState,
  completeVoiceTurnTtsChunk,
  createVoiceTurnTtsState,
  deriveVoiceTurnTtsState,
  getLatestTurnAssistantSpeechText,
  shiftVoiceTurnTtsQueue,
  shouldFinishVoiceTurnTts,
} from "./voice-turn-tts";

describe("deriveVoiceTurnTtsState", () => {
  it("emits complete sentence chunks before the stream finishes", () => {
    const state = deriveVoiceTurnTtsState({
      state: createVoiceTurnTtsState(),
      assistantText: "Here is your answer.",
      shouldHoldForTools: false,
      isStreamFinished: false,
    });

    expect(state.queue).toEqual(["Here is your answer."]);
    expect(state.streamCompleted).toBe(false);
  });

  it("uses fallback chunking for long punctuation-free text", () => {
    const state = deriveVoiceTurnTtsState({
      state: createVoiceTurnTtsState(),
      assistantText:
        "This response keeps going without sentence punctuation so the voice layer still needs a stable place to start speaking before the agent fully finishes streaming the rest of the answer",
      shouldHoldForTools: false,
      isStreamFinished: false,
    });

    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]?.length).toBeGreaterThanOrEqual(32);
    expect(state.queue[0]?.length).toBeLessThan(
      "This response keeps going without sentence punctuation so the voice layer still needs a stable place to start speaking before the agent fully finishes streaming the rest of the answer"
        .length,
    );
  });

  it("does not duplicate already scheduled speech", () => {
    const initial = deriveVoiceTurnTtsState({
      state: createVoiceTurnTtsState(),
      assistantText: "First sentence. ",
      shouldHoldForTools: false,
      isStreamFinished: false,
    });

    const repeated = deriveVoiceTurnTtsState({
      state: initial,
      assistantText: "First sentence. ",
      shouldHoldForTools: false,
      isStreamFinished: false,
    });

    expect(repeated.queue).toEqual(["First sentence. "]);

    const appended = deriveVoiceTurnTtsState({
      state: repeated,
      assistantText: "First sentence. Second sentence.",
      shouldHoldForTools: false,
      isStreamFinished: false,
    });

    expect(appended.queue).toEqual(["First sentence. ", "Second sentence."]);
  });

  it("flushes the trailing remainder when the stream completes", () => {
    const partial = deriveVoiceTurnTtsState({
      state: createVoiceTurnTtsState(),
      assistantText: "This tail has no ending punctuation yet",
      shouldHoldForTools: false,
      isStreamFinished: false,
    });

    expect(partial.queue).toEqual([]);

    const flushed = deriveVoiceTurnTtsState({
      state: partial,
      assistantText: "This tail has no ending punctuation yet",
      shouldHoldForTools: false,
      isStreamFinished: true,
    });

    expect(flushed.queue).toEqual(["This tail has no ending punctuation yet"]);
    expect(flushed.streamCompleted).toBe(true);
  });

  it("suppresses speech chunks while tool work is still active", () => {
    const blocked = deriveVoiceTurnTtsState({
      state: createVoiceTurnTtsState(),
      assistantText: "Let me check that.",
      shouldHoldForTools: true,
      isStreamFinished: false,
    });

    expect(blocked.queue).toEqual([]);

    const unblocked = deriveVoiceTurnTtsState({
      state: blocked,
      assistantText: "Let me check that.",
      shouldHoldForTools: false,
      isStreamFinished: false,
    });

    expect(unblocked.queue).toEqual(["Let me check that."]);
  });
});

describe("voice turn tts orchestration", () => {
  it("queues the first chunk before finish and advances in order across completions", () => {
    const streamingState = deriveVoiceTurnTtsState({
      state: createVoiceTurnTtsState(),
      assistantText: "First sentence. ",
      shouldHoldForTools: false,
      isStreamFinished: false,
    });

    expect(streamingState.queue).toEqual(["First sentence. "]);
    expect(shouldFinishVoiceTurnTts(streamingState)).toBe(false);

    const inFlight = shiftVoiceTurnTtsQueue(streamingState);
    expect(inFlight.inFlightChunk).toBe("First sentence. ");

    const afterFirstAudio = completeVoiceTurnTtsChunk(inFlight);
    const withSecondSentence = deriveVoiceTurnTtsState({
      state: afterFirstAudio,
      assistantText: "First sentence. Second sentence.",
      shouldHoldForTools: false,
      isStreamFinished: true,
    });

    expect(withSecondSentence.queue).toEqual(["Second sentence."]);
    const secondInFlight = shiftVoiceTurnTtsQueue(withSecondSentence);
    const finished = completeVoiceTurnTtsChunk(secondInFlight);

    expect(finished.spokenText).toBe("First sentence. Second sentence.");
    expect(shouldFinishVoiceTurnTts(finished)).toBe(true);
  });

  it("clears all queued speech when the turn is aborted or stopped", () => {
    const state = deriveVoiceTurnTtsState({
      state: createVoiceTurnTtsState(),
      assistantText: "A ready response chunk.",
      shouldHoldForTools: false,
      isStreamFinished: false,
    });

    expect(state.queue).toEqual(["A ready response chunk."]);
    expect(clearVoiceTurnTtsState()).toEqual(createVoiceTurnTtsState());
  });
});

describe("getLatestTurnAssistantSpeechText", () => {
  it("reads only the latest assistant reply after the latest user turn", () => {
    const text = getLatestTurnAssistantSpeechText([
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "old prompt" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "old answer" }],
      },
      {
        id: "u2",
        role: "user",
        parts: [{ type: "text", text: "new prompt" }],
      },
      {
        id: "a2",
        role: "assistant",
        parts: [{ type: "text", text: "Latest **answer**." }],
      },
    ] as any);

    expect(text).toBe("Latest answer.");
  });
});
