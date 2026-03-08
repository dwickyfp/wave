import { describe, expect, it } from "vitest";
import {
  allocateSequentialKnowledgeTokens,
  CHAT_KNOWLEDGE_CONTEXT_TOKENS,
  estimateKnowledgePromptTokens,
} from "./token-budget";

describe("token-budget", () => {
  it("splits the remaining chat knowledge budget evenly", () => {
    expect(
      allocateSequentialKnowledgeTokens(CHAT_KNOWLEDGE_CONTEXT_TOKENS, 2),
    ).toBe(2500);
    expect(allocateSequentialKnowledgeTokens(2000, 4)).toBe(500);
  });

  it("never allocates more than the remaining budget", () => {
    expect(allocateSequentialKnowledgeTokens(320, 3)).toBe(320);
    expect(allocateSequentialKnowledgeTokens(0, 3)).toBe(0);
  });

  it("estimates prompt tokens with the shared 4 chars per token heuristic", () => {
    expect(estimateKnowledgePromptTokens("12345678")).toBe(2);
  });
});
