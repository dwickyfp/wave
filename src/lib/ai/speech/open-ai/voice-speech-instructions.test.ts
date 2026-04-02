import { describe, expect, it } from "vitest";
import { buildSpeechInstructions } from "./voice-speech-instructions";

describe("buildSpeechInstructions", () => {
  it("passes through the agent response without adding any extra prompt text", () => {
    expect(buildSpeechInstructions("  Halo, saya Emma.  ")).toBe(
      "Halo, saya Emma.",
    );
  });
});
