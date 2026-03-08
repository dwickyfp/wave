import type { LanguageModelUsage } from "ai";

type UsageCostSnapshot = {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  inputTokenPricePer1MUsd: number;
  outputTokenPricePer1MUsd: number;
};

type UsagePricing = {
  inputTokenPricePer1MUsd: number;
  outputTokenPricePer1MUsd: number;
};

function roundUsd(value: number) {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

export function buildUsageCostSnapshot(
  usage: Pick<LanguageModelUsage, "inputTokens" | "outputTokens">,
  pricing: UsagePricing,
): UsageCostSnapshot {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const inputCostUsd =
    (inputTokens / 1_000_000) * (pricing.inputTokenPricePer1MUsd ?? 0);
  const outputCostUsd =
    (outputTokens / 1_000_000) * (pricing.outputTokenPricePer1MUsd ?? 0);

  return {
    inputCostUsd: roundUsd(inputCostUsd),
    outputCostUsd: roundUsd(outputCostUsd),
    totalCostUsd: roundUsd(inputCostUsd + outputCostUsd),
    inputTokenPricePer1MUsd: pricing.inputTokenPricePer1MUsd ?? 0,
    outputTokenPricePer1MUsd: pricing.outputTokenPricePer1MUsd ?? 0,
  };
}
