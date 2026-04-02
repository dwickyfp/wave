import { describe, expect, it } from "vitest";
import {
  VOICE_MIN_COMMIT_AUDIO_MS,
  getVoiceInputBufferAction,
} from "./voice-input-buffer";

describe("getVoiceInputBufferAction", () => {
  it("clears empty buffers instead of committing them", () => {
    expect(
      getVoiceInputBufferAction({
        bufferedSamples: 0,
        sampleRate: 24_000,
      }),
    ).toBe("clear");
  });

  it("clears buffers smaller than the realtime minimum", () => {
    expect(
      getVoiceInputBufferAction({
        bufferedSamples: 2_000,
        sampleRate: 24_000,
      }),
    ).toBe("clear");
  });

  it("commits buffers once they reach 100ms of audio", () => {
    expect(
      getVoiceInputBufferAction({
        bufferedSamples: (VOICE_MIN_COMMIT_AUDIO_MS / 1000) * 24_000,
        sampleRate: 24_000,
      }),
    ).toBe("commit");
  });
});
