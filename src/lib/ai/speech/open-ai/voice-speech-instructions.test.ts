import { describe, expect, it } from "vitest";
import { buildSpeechInstructions } from "./voice-speech-instructions";

describe("buildSpeechInstructions", () => {
  it("returns only control instructions for literal voice-over", () => {
    const instructions = buildSpeechInstructions("Halo, saya Emma.");

    expect(instructions).toContain(
      "Create an out-of-band audio-only response.",
    );
    expect(instructions).toContain("Do not answer the user.");
    expect(instructions).toContain("<speak>");
    expect(instructions).toContain("Halo, saya Emma.");
  });
});
