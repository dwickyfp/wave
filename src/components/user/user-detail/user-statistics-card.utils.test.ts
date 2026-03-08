import { describe, expect, it } from "vitest";
import {
  type UserModelStat,
  getTopModelPieData,
  sortUserModelStats,
} from "./user-statistics-card.utils";

const MODEL_STATS: UserModelStat[] = [
  {
    model: "Claude Sonnet 4.6",
    messageCount: 1,
    totalTokens: 0,
    provider: "anthropic",
  },
  {
    model: "Claude Sonnet 4",
    messageCount: 53,
    totalTokens: 0,
    provider: "anthropic",
  },
  {
    model: "Grok-4.1-fast",
    messageCount: 16,
    totalTokens: 710990,
    provider: "xai",
  },
  {
    model: "Gpt-5.4",
    messageCount: 2,
    totalTokens: 3303,
    provider: "openai",
  },
];

describe("user statistics card helpers", () => {
  it("sorts model stats by tokens first and message count second", () => {
    expect(sortUserModelStats(MODEL_STATS).map((item) => item.model)).toEqual([
      "Grok-4.1-fast",
      "Gpt-5.4",
      "Claude Sonnet 4",
      "Claude Sonnet 4.6",
    ]);
  });

  it("builds top model pie data from non-zero token models only", () => {
    expect(getTopModelPieData(MODEL_STATS)).toEqual([
      { label: "Grok-4.1-fast", value: 710990 },
      { label: "Gpt-5.4", value: 3303 },
    ]);
  });
});
