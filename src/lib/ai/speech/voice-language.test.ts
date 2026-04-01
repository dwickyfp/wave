import { describe, expect, it } from "vitest";
import {
  buildVoiceTranscriptionBias,
  getVoiceLanguageDisplayName,
  isTranscriptCompatibleWithLanguage,
  normalizeVoiceLanguage,
  pickVoiceLanguageHint,
} from "./voice-language";

describe("voice-language helpers", () => {
  it("normalizes locale tags to the base language code", () => {
    expect(normalizeVoiceLanguage("id-ID")).toBe("id");
    expect(normalizeVoiceLanguage("EN_us")).toBe("en");
    expect(normalizeVoiceLanguage("  ko-KR ")).toBe("ko");
  });

  it("prefers Indonesian when it is present in the browser language list", () => {
    expect(
      pickVoiceLanguageHint({
        candidates: ["en-US", "id-ID", "en"],
        timeZone: "Asia/Jakarta",
      }),
    ).toBe("id");
  });

  it("falls back to Indonesian for Indonesian time zones when only English is present", () => {
    expect(
      pickVoiceLanguageHint({
        candidates: ["en-US"],
        timeZone: "Asia/Jakarta",
      }),
    ).toBe("id");
  });

  it("builds an Indonesian transcription prompt", () => {
    expect(buildVoiceTranscriptionBias("id-ID")).toEqual({
      language: "id",
      prompt: expect.stringContaining("bahasa indonesia"),
    });
  });

  it("rejects wrong-script transcripts for Latin-based voice languages", () => {
    expect(
      isTranscriptCompatibleWithLanguage("Halo, saya butuh data.", "id"),
    ).toBe(true);
    expect(isTranscriptCompatibleWithLanguage("됐다", "id")).toBe(false);
  });

  it("allows Korean transcripts when the call language is Korean", () => {
    expect(isTranscriptCompatibleWithLanguage("됐다", "ko")).toBe(true);
  });

  it("maps voice language display names for prompt pinning", () => {
    expect(getVoiceLanguageDisplayName("id-ID")).toBe("Indonesian");
    expect(getVoiceLanguageDisplayName("ko")).toBe("Korean");
  });
});
