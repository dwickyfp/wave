import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("lib/knowledge/retriever", () => ({
  queryKnowledgeAsDocs: vi.fn(async () => []),
  formatDocsAsText: vi.fn(() => "formatted knowledge"),
}));

const { createKnowledgeDocsTool } = await import("./knowledge-tool");
const { queryKnowledgeAsDocs, formatDocsAsText } = await import(
  "lib/knowledge/retriever"
);

describe("knowledge-tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to section-first mode with a 5000 token budget", async () => {
    const tool = createKnowledgeDocsTool({
      id: "group-1",
      name: "Product Docs",
      userId: "user-1",
      visibility: "private",
      purpose: "default",
      isSystemManaged: false,
      embeddingModel: "embed",
      embeddingProvider: "openai",
      rerankingModel: null,
      rerankingProvider: null,
      parsingModel: null,
      parsingProvider: null,
      retrievalThreshold: 0,
      mcpEnabled: false,
      documentCount: 1,
      chunkCount: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await tool.execute?.({ query: "how to sign in" }, {
      toolCallId: "call-1",
      messages: [],
    } as any);

    expect(queryKnowledgeAsDocs).toHaveBeenCalledWith(
      expect.objectContaining({ id: "group-1" }),
      "how to sign in",
      expect.objectContaining({
        source: "agent",
        tokens: 5000,
        resultMode: "section-first",
      }),
    );
    expect(formatDocsAsText).toHaveBeenCalled();
    expect(result).toBe("formatted knowledge");
  });

  it("passes through explicit full-doc mode", async () => {
    const tool = createKnowledgeDocsTool({
      id: "group-1",
      name: "Product Docs",
      userId: "user-1",
      visibility: "private",
      purpose: "default",
      isSystemManaged: false,
      embeddingModel: "embed",
      embeddingProvider: "openai",
      rerankingModel: null,
      rerankingProvider: null,
      parsingModel: null,
      parsingProvider: null,
      retrievalThreshold: 0,
      mcpEnabled: false,
      documentCount: 1,
      chunkCount: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await tool.execute?.(
      { query: "read everything", mode: "full-doc", tokens: 9000 },
      { toolCallId: "call-2", messages: [] } as any,
    );

    expect(queryKnowledgeAsDocs).toHaveBeenCalledWith(
      expect.anything(),
      "read everything",
      expect.objectContaining({
        tokens: 9000,
        resultMode: "full-doc",
      }),
    );
  });
});
