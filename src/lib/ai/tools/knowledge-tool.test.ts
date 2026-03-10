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

  it("reports retrieved docs through the callback", async () => {
    const docs = [
      {
        documentId: "doc-1",
        documentName: "Sign-in Guide",
        relevanceScore: 0.92,
        chunkHits: 2,
        markdown: "## Authentication\n\nUse the sign-in form.",
        matchedSections: [{ heading: "Authentication", score: 0.92 }],
        matchedImages: [
          {
            id: "image-1",
            documentId: "doc-1",
            groupId: "group-1",
            versionId: "version-1",
            ordinal: 1,
            label: "Sign-in screen",
            description: "Screenshot of the sign-in form.",
            headingPath: "Guide > Authentication",
            stepHint: "Open the sign-in screen.",
            pageNumber: 2,
            mediaType: "image/png",
            sourceUrl: "https://example.com/image-1.png",
            storagePath: "knowledge-images/doc-1/version-1/image-1.png",
            isRenderable: true,
            relevanceScore: 0.88,
          },
        ],
      },
    ];
    vi.mocked(queryKnowledgeAsDocs).mockResolvedValue(docs as any);
    const onRetrieved = vi.fn();
    const tool = createKnowledgeDocsTool(
      {
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
      },
      { onRetrieved },
    );

    await tool.execute?.({ query: "how to sign in" }, {
      toolCallId: "call-3",
      messages: [],
    } as any);

    expect(onRetrieved).toHaveBeenCalledWith({
      groupId: "group-1",
      groupName: "Product Docs",
      query: "how to sign in",
      docs,
    });
  });
});
