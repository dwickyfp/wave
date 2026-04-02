import { describe, expect, it } from "vitest";
import { buildSpeechInstructions } from "./voice-speech-instructions";

describe("buildSpeechInstructions", () => {
  it("includes the configured voice vibe while preserving exact-text output", () => {
    const instructions = buildSpeechInstructions("Your refund is approved.");

    expect(instructions).toContain(
      "Voice Affect: Calm, composed, and reassuring.",
    );
    expect(instructions).toContain(
      "Tone: Sincere, empathetic, with genuine concern for the customer",
    );
    expect(instructions).toContain(
      "Do not add, remove, summarize, or paraphrase any words.",
    );
    expect(instructions).toContain("Your refund is approved.");
  });
});
