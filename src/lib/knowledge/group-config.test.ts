import { describe, expect, it } from "vitest";
import {
  buildKnowledgeGroupPersistenceFields,
  resolveKnowledgeParseModel,
} from "./group-config";

describe("group-config", () => {
  it("preserves supported group persistence settings", () => {
    expect(
      buildKnowledgeGroupPersistenceFields({
        embeddingModel: "text-embedding-3-large",
        embeddingProvider: "openai",
        rerankingModel: "rerank-v1",
        rerankingProvider: "cohere",
        parsingModel: "gpt-4.1-mini",
        parsingProvider: "openai",
        retrievalThreshold: 0.42,
        chunkSize: 1024,
        chunkOverlapPercent: 12,
      }),
    ).toMatchObject({
      embeddingModel: "text-embedding-3-large",
      embeddingProvider: "openai",
      rerankingModel: "rerank-v1",
      rerankingProvider: "cohere",
      parsingModel: "gpt-4.1-mini",
      parsingProvider: "openai",
      retrievalThreshold: 0.42,
      chunkSize: 1024,
      chunkOverlapPercent: 12,
      parseMode: "always",
      contextMode: "auto-llm",
      imageMode: "auto",
    });
  });

  it("prefers a group-specific parse model over the global default", () => {
    expect(
      resolveKnowledgeParseModel({
        groupParsingProvider: "anthropic",
        groupParsingModel: "claude-3-7-sonnet",
        defaultParseModel: {
          provider: "openai",
          model: "gpt-4.1-mini",
        },
      }),
    ).toEqual({
      provider: "anthropic",
      model: "claude-3-7-sonnet",
    });
  });

  it("falls back to the global parse model when the group override is incomplete", () => {
    expect(
      resolveKnowledgeParseModel({
        groupParsingProvider: "openai",
        groupParsingModel: null,
        defaultParseModel: {
          provider: "openai",
          model: "gpt-4.1-mini",
        },
      }),
    ).toEqual({
      provider: "openai",
      model: "gpt-4.1-mini",
    });
  });
});
