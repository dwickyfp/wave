import { describe, expect, it } from "vitest";
import {
  isLikelyEchoTranscript,
  isLikelyGhostTranscript,
  shouldIgnoreShortAutoResumeTranscript,
} from "./voice-transcript-guard";

describe("isLikelyEchoTranscript", () => {
  it("detects direct transcript excerpts from the assistant reply", () => {
    expect(
      isLikelyEchoTranscript(
        "sampai jumpa dwicky",
        "Baik, sampai jumpa Dwicky. Kalau perlu lagi, panggil saya saja.",
      ),
    ).toBe(true);
  });

  it("detects short assistant-like overlaps after playback", () => {
    expect(
      isLikelyEchoTranscript(
        "baik dwicky",
        "Baik, Dwicky, saya buatkan bar chart sekarang.",
      ),
    ).toBe(true);
  });

  it("does not mark a different follow-up request as assistant echo", () => {
    expect(
      isLikelyEchoTranscript(
        "buat bar chart",
        "Ada yang ingin dianalisis lebih lanjut dari line chart ini?",
      ),
    ).toBe(false);
  });
});

describe("isLikelyGhostTranscript", () => {
  it("detects repeated short filler transcripts", () => {
    expect(
      isLikelyGhostTranscript("ya ya", {
        maxChars: 16,
        maxWords: 2,
      }),
    ).toBe(true);
  });
});

describe("shouldIgnoreShortAutoResumeTranscript", () => {
  it("ignores a one-word transcript immediately after auto-resume", () => {
    expect(
      shouldIgnoreShortAutoResumeTranscript({
        transcript: "ya",
        assistantText: "Baik, saya buatkan sekarang.",
        speechDurationMs: 800,
      }),
    ).toBe(true);
  });

  it("ignores short transcripts that strongly overlap the assistant reply", () => {
    expect(
      shouldIgnoreShortAutoResumeTranscript({
        transcript: "baik dwicky",
        assistantText: "Baik, Dwicky, saya buatkan chart sekarang.",
        speechDurationMs: 900,
      }),
    ).toBe(true);
  });

  it("keeps short but different follow-up requests", () => {
    expect(
      shouldIgnoreShortAutoResumeTranscript({
        transcript: "buat chart",
        assistantText: "Apakah datanya ingin saya analisis juga?",
        speechDurationMs: 1_000,
      }),
    ).toBe(false);
  });
});
