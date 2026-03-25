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

function expectKnowledgeToolResult<T>(
  result: T | AsyncIterable<unknown> | undefined,
): Exclude<T, AsyncIterable<unknown> | undefined> {
  expect(result).toBeDefined();
  expect(
    typeof (result as { [Symbol.asyncIterator]?: unknown })?.[
      Symbol.asyncIterator
    ],
  ).toBe("undefined");
  return result as Exclude<T, AsyncIterable<unknown> | undefined>;
}

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
      parseMode: "auto",
      parseRepairPolicy: "section-safe-reorder",
      contextMode: "deterministic",
      imageMode: "auto",
      lazyRefinementEnabled: true,
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
    expect(result).toMatchObject({
      source: "attached_agent_knowledge",
      groupId: "group-1",
      groupName: "Product Docs",
      query: "how to sign in",
      contextText: "formatted knowledge",
      citations: [],
      evidencePack: null,
      hasResults: false,
    });
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
      parseMode: "auto",
      parseRepairPolicy: "section-safe-reorder",
      contextMode: "deterministic",
      imageMode: "auto",
      lazyRefinementEnabled: true,
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

  it("passes structured issuer and page filters through to retrieval", async () => {
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
      parseMode: "auto",
      parseRepairPolicy: "section-safe-reorder",
      contextMode: "deterministic",
      imageMode: "auto",
      lazyRefinementEnabled: true,
      retrievalThreshold: 0,
      mcpEnabled: false,
      documentCount: 1,
      chunkCount: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await tool.execute?.(
      {
        query: "BBCA halaman 100",
        ticker: "BBCA",
        page: 100,
        strictEntityMatch: true,
      },
      { toolCallId: "call-structured", messages: [] } as any,
    );

    expect(queryKnowledgeAsDocs).toHaveBeenCalledWith(
      expect.anything(),
      "BBCA halaman 100",
      expect.objectContaining({
        ticker: "BBCA",
        page: 100,
        strictEntityMatch: true,
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
        parseMode: "auto",
        parseRepairPolicy: "section-safe-reorder",
        contextMode: "deterministic",
        imageMode: "auto",
        lazyRefinementEnabled: true,
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
      contextText: "formatted knowledge",
    });
  });

  it("returns stable citation payload from the callback for the model to cite", async () => {
    const docs = [
      {
        documentId: "doc-1",
        documentName: "Tax Guide",
        versionId: "version-1",
        relevanceScore: 0.93,
        chunkHits: 2,
        markdown: "## Vape tax\n\nVape is taxed.",
        matchedSections: [{ heading: "Vape tax", score: 0.93 }],
        citationCandidates: [
          {
            versionId: "version-1",
            sectionId: "section-1",
            sectionHeading: "Vape tax",
            pageStart: 12,
            pageEnd: 12,
            excerpt: "Vape is taxed.",
            relevanceScore: 0.93,
          },
        ],
      },
    ];
    vi.mocked(queryKnowledgeAsDocs).mockResolvedValue(docs as any);

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
        parseMode: "auto",
        parseRepairPolicy: "section-safe-reorder",
        contextMode: "deterministic",
        imageMode: "auto",
        lazyRefinementEnabled: true,
        retrievalThreshold: 0,
        mcpEnabled: false,
        documentCount: 1,
        chunkCount: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        onRetrieved: () => ({
          citations: [
            {
              number: 4,
              groupId: "group-1",
              groupName: "Product Docs",
              documentId: "doc-1",
              documentName: "Tax Guide",
              versionId: "version-1",
              sectionId: "section-1",
              sectionHeading: "Vape tax",
              pageStart: 12,
              pageEnd: 12,
              excerpt: "Vape is taxed.",
              relevanceScore: 0.93,
            },
          ],
          evidencePack:
            "<knowledge_evidence_pack>\n\n[4] Tax Guide\nSection: Vape tax\nPage 12\nExcerpt: Vape is taxed.\n\n</knowledge_evidence_pack>",
        }),
      },
    );

    const result = await tool.execute?.({ query: "is vape taxed?" }, {
      toolCallId: "call-4",
      messages: [],
    } as any);
    const typedResult = expectKnowledgeToolResult(result);

    expect(typedResult).toMatchObject({
      hasResults: true,
      contextText: "formatted knowledge",
      evidencePack: expect.stringContaining("[4] Tax Guide"),
      citations: [
        {
          number: 4,
          pageStart: 12,
          sectionHeading: "Vape tax",
        },
      ],
    });
    expect(typedResult.citationInstructions).toContain('"[n]"');
  });

  it("falls back to retrieval-derived citations when the callback does not provide them", async () => {
    const docs = [
      {
        documentId: "doc-1",
        documentName: "Tax Guide",
        versionId: "version-1",
        relevanceScore: 0.93,
        chunkHits: 2,
        markdown: "## Vape tax\n\nVape is taxed.",
        matchedSections: [{ heading: "Vape tax", score: 0.93 }],
        citationCandidates: [
          {
            versionId: "version-1",
            sectionId: "section-1",
            sectionHeading: "Vape tax",
            pageStart: 12,
            pageEnd: 12,
            excerpt: "Vape is taxed.",
            relevanceScore: 0.93,
          },
        ],
      },
    ];
    vi.mocked(queryKnowledgeAsDocs).mockResolvedValue(docs as any);

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
      parseMode: "auto",
      parseRepairPolicy: "section-safe-reorder",
      contextMode: "deterministic",
      imageMode: "auto",
      lazyRefinementEnabled: true,
      retrievalThreshold: 0,
      mcpEnabled: false,
      documentCount: 1,
      chunkCount: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await tool.execute?.({ query: "is vape taxed?" }, {
      toolCallId: "call-5",
      messages: [],
    } as any);
    const typedResult = expectKnowledgeToolResult(result);

    expect(typedResult).toMatchObject({
      hasResults: true,
      citations: [
        {
          number: 1,
          documentId: "doc-1",
          pageStart: 12,
          sectionHeading: "Vape tax",
        },
      ],
    });
    expect(typedResult.evidencePack).toContain("[1] Tax Guide");
    expect(typedResult.citationInstructions).toContain(
      "Uncited factual claims",
    );
  });

  it("includes a compact related image payload for persisted tool outputs", async () => {
    const docs = [
      {
        documentId: "doc-1",
        documentName: "Sign-in Guide",
        versionId: "version-1",
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
        citationCandidates: [
          {
            versionId: "version-1",
            sectionId: "section-1",
            sectionHeading: "Authentication",
            pageStart: 2,
            pageEnd: 2,
            excerpt: "Use the sign-in form.",
            relevanceScore: 0.92,
          },
        ],
      },
    ];
    vi.mocked(queryKnowledgeAsDocs).mockResolvedValue(docs as any);

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
      parseMode: "auto",
      parseRepairPolicy: "section-safe-reorder",
      contextMode: "deterministic",
      imageMode: "auto",
      lazyRefinementEnabled: true,
      retrievalThreshold: 0,
      mcpEnabled: false,
      documentCount: 1,
      chunkCount: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await tool.execute?.({ query: "show me the sign-in UI" }, {
      toolCallId: "call-6",
      messages: [],
    } as any);
    const typedResult = expectKnowledgeToolResult(result);

    expect(typedResult.images).toEqual([
      {
        groupId: "group-1",
        groupName: "Product Docs",
        documentId: "doc-1",
        documentName: "Sign-in Guide",
        imageId: "image-1",
        versionId: "version-1",
        label: "Sign-in screen",
        description: "Screenshot of the sign-in form.",
        headingPath: "Guide > Authentication",
        stepHint: "Open the sign-in screen.",
        pageNumber: 2,
        assetUrl:
          "/api/knowledge/group-1/documents/doc-1/images/image-1/asset?versionId=version-1",
      },
    ]);
  });
});
