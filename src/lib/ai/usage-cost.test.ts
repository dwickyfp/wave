import { describe, expect, it } from "vitest";
import { buildUsageCostSnapshot } from "./usage-cost";

describe("buildUsageCostSnapshot", () => {
  it("computes input, output, and total USD cost from 1M-token prices", () => {
    const result = buildUsageCostSnapshot(
      {
        inputTokens: 250_000,
        outputTokens: 50_000,
      },
      {
        inputTokenPricePer1MUsd: 10,
        outputTokenPricePer1MUsd: 30,
      },
    );

    expect(result).toEqual({
      inputCostUsd: 2.5,
      outputCostUsd: 1.5,
      totalCostUsd: 4,
      inputTokenPricePer1MUsd: 10,
      outputTokenPricePer1MUsd: 30,
    });
  });

  it("defaults to zero cost when token prices are zero", () => {
    const result = buildUsageCostSnapshot(
      {
        inputTokens: 10_000,
        outputTokens: 20_000,
      },
      {
        inputTokenPricePer1MUsd: 0,
        outputTokenPricePer1MUsd: 0,
      },
    );

    expect(result.totalCostUsd).toBe(0);
  });
});
