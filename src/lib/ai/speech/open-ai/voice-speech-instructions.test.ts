import { describe, expect, it } from "vitest";
import {
  buildSpeechInstructions,
  buildSpeechStyleInstructions,
} from "./voice-speech-instructions";

describe("buildSpeechStyleInstructions", () => {
  it("returns the calmer base speaking style for general text", () => {
    const instructions = buildSpeechStyleInstructions("Halo, saya Emma.");

    expect(instructions).toContain(
      "Voice Affect: Calm, composed, and reassuring.",
    );
    expect(instructions).toContain(
      "Tone: Sincere, empathetic, and professional.",
    );
    expect(instructions).not.toContain("Pacing:");
    expect(instructions).not.toContain("Pauses:");
  });

  it("adds apology pacing guidance only when the text needs it", () => {
    const instructions = buildSpeechStyleInstructions(
      "Maaf, refund Anda sudah kami proses. Terima kasih atas kesabaran Anda.",
    );

    expect(instructions).toContain(
      "Pacing: Slightly slower around apologies or sensitive details.",
    );
    expect(instructions).toContain(
      "Pauses: Use a brief natural pause before and after an apology.",
    );
  });
});

describe("buildSpeechInstructions", () => {
  it("keeps realtime fallback instructions focused on verbatim playback", () => {
    const instructions = buildSpeechInstructions("Saya Emma.");

    expect(instructions).toContain(
      "Read the provided text aloud exactly as written.",
    );
    expect(instructions).toContain(
      "Do not add, remove, summarize, paraphrase, or reorder any words.",
    );
    expect(instructions).toContain("Saya Emma.");
  });
});
