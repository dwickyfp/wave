import { describe, expect, it } from "vitest";
import { pickPreferredModelConfig } from "./model-config-match";

describe("pickPreferredModelConfig", () => {
  it("prefers a ui name match over an api name match", () => {
    const result = pickPreferredModelConfig("Claude Sonnet 4", [
      {
        apiName: "Claude Sonnet 4",
        uiName: "claude-sonnet-4",
        inputTokenPricePer1MUsd: 3,
      },
      {
        apiName: "claude-sonnet-4",
        uiName: "Claude Sonnet 4",
        inputTokenPricePer1MUsd: 6,
      },
    ]);

    expect(result?.inputTokenPricePer1MUsd).toBe(6);
  });

  it("falls back to an api name match when no ui name matches", () => {
    const result = pickPreferredModelConfig("gpt-5.4", [
      {
        apiName: "gpt-5.4",
        uiName: "GPT-5.4",
      },
    ]);

    expect(result).toEqual({
      apiName: "gpt-5.4",
      uiName: "GPT-5.4",
    });
  });

  it("returns null when the model is not configured", () => {
    expect(
      pickPreferredModelConfig("unknown-model", [
        {
          apiName: "gpt-5.4",
          uiName: "GPT-5.4",
        },
      ]),
    ).toBeNull();
  });
});
