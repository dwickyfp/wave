import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockRerank = vi.fn();
const mockGenerateText = vi.fn();

vi.mock("ai", () => ({
  rerank: mockRerank,
  generateText: mockGenerateText,
  Output: {
    object: vi.fn((input) => input),
  },
}));

const mockRewriteKnowledgeQuery = vi.fn(async () => ({
  rewrites: [],
  entityTerms: [],
}));

vi.mock("./query-rewrite", () => ({
  rewriteKnowledgeQuery: mockRewriteKnowledgeQuery,
}));

vi.mock("lib/db/repository", () => ({
  knowledgeRepository: {
    selectRetrievalScopes: vi.fn(),
    vectorSearch: vi.fn(),
    vectorSearchByEmbeddingKind: vi.fn(),
    fullTextSearch: vi.fn(),
    vectorSearchSections: vi.fn(),
    fullTextSearchSections: vi.fn(),
    searchDocumentMetadata: vi.fn(),
    vectorSearchDocumentMetadata: vi.fn(),
    findDocumentIdsByRetrievalIdentity: vi.fn(),
    fullTextSearchImages: vi.fn(),
    vectorSearchImages: vi.fn(),
    getDocumentImages: vi.fn(),
    getAdjacentChunks: vi.fn(),
    getDocumentMetadataByIdsAcrossGroups: vi.fn(),
    getSectionsByIds: vi.fn(),
    getRelatedSections: vi.fn(),
    findSectionsByStructuredFilters: vi.fn(),
    getDocumentMarkdown: vi.fn(),
    insertUsageLog: vi.fn(),
  },
  settingsRepository: {
    getSetting: vi.fn(),
    getProviderByName: vi.fn(),
    getModelForChat: vi.fn(),
  },
  selfLearningRepository: {
    searchActiveMemoriesForUser: vi.fn(),
  },
}));

vi.mock("./embedder", () => ({
  embedSingleText: vi.fn(async () => [0.1, 0.2, 0.3]),
}));

const {
  formatDocsAsText,
  queryKnowledge,
  queryKnowledgeAsDocs,
  queryKnowledgeStructured,
  scoreRetrievedImageCandidate,
} = await import("./retriever");
const { knowledgeRepository, settingsRepository, selfLearningRepository } =
  await import("lib/db/repository");

const group = {
  id: "group-1",
  name: "Docs",
  embeddingModel: "embed-model",
  embeddingProvider: "openai",
  retrievalThreshold: 0,
};

function makeChunkHit(overrides: Partial<any> = {}) {
  return {
    chunk: {
      id: "chunk-1",
      documentId: "doc-1",
      groupId: "group-1",
      sectionId: "section-1",
      content: "Authentication content for the matched section.",
      contextSummary: "Authentication setup details.",
      chunkIndex: 0,
      tokenCount: 80,
      metadata: {
        headingPath: "Guide > Authentication",
        section: "Authentication",
      },
      createdAt: new Date("2026-01-01T00:00:00Z"),
      ...overrides.chunk,
    },
    documentName: "Guide",
    documentId: "doc-1",
    score: 0.91,
    ...overrides,
  };
}

function makeVariantIdentity(input: {
  familyKey: string;
  familyLabel: string;
  variantKey: string;
  variantLabel: string;
  axisKind: "period" | "version" | "effective_at";
  axisValue: string;
}) {
  const temporalHints =
    input.axisKind === "effective_at"
      ? {
          effectiveAt: input.axisValue,
          expiresAt: null,
          freshnessLabel: null,
        }
      : null;

  return {
    baseTitle: input.familyLabel,
    familyLabel: input.familyLabel,
    variantLabel: input.variantLabel,
    libraryId: input.familyLabel,
    libraryVersion: input.axisKind === "version" ? input.axisValue : null,
    temporalHints,
  };
}

function makeDocumentMetadataRow(input: {
  documentId: string;
  name: string;
  identity: ReturnType<typeof makeVariantIdentity>;
}) {
  return {
    documentId: input.documentId,
    groupId: "group-1",
    name: input.name,
    description: null,
    metadata: {
      sectionGraphVersion: 1,
      documentContext: {
        documentId: input.documentId,
        documentName: input.name,
        canonicalTitle: input.name,
        baseTitle: input.identity.baseTitle,
      },
      sourceContext: {
        libraryId: input.identity.libraryId,
        libraryVersion: input.identity.libraryVersion,
        sourcePath: null,
        sheetName: null,
        sourceGroupName: "Docs",
      },
      temporalHints: input.identity.temporalHints,
      display: {
        documentLabel: input.name,
        variantLabel: input.identity.variantLabel,
        topicLabel: null,
        locationLabel: null,
      },
    },
    activeVersionId: `${input.documentId}-version-1`,
    updatedAt: new Date("2026-02-01T00:00:00Z"),
  };
}

function makeSectionRow(input: {
  id: string;
  documentId: string;
  heading: string;
  headingPath: string;
  content: string;
  noteNumber?: string | null;
  noteTitle?: string | null;
  pageStart?: number;
  pageEnd?: number;
}) {
  return {
    id: input.id,
    documentId: input.documentId,
    groupId: "group-1",
    parentSectionId: null,
    prevSectionId: null,
    nextSectionId: null,
    heading: input.heading,
    headingPath: input.headingPath,
    level: 2,
    partIndex: 0,
    partCount: 1,
    content: input.content,
    summary: `${input.heading} summary.`,
    tokenCount: 120,
    pageStart: input.pageStart ?? 1,
    pageEnd: input.pageEnd ?? input.pageStart ?? 1,
    noteNumber: input.noteNumber ?? null,
    noteTitle: input.noteTitle ?? null,
    noteSubsection: null,
    continued: false,
    createdAt: new Date("2026-02-01T00:00:00Z"),
  };
}

function mockChunkSearchResults(hits: any[]) {
  const filterHits = (documentIds?: string[]) =>
    documentIds?.length
      ? hits.filter((hit) =>
          documentIds.includes(hit.documentId ?? hit.chunk?.documentId),
        )
      : hits;

  vi.mocked(knowledgeRepository.vectorSearch).mockImplementation(
    async (_groupId, _embedding, _limit, filters) =>
      filterHits(filters?.documentIds),
  );
  vi.mocked(knowledgeRepository.fullTextSearch).mockImplementation(
    async (_groupId, _query, _limit, filters) =>
      filterHits(filters?.documentIds),
  );
}

function mockRollout(
  partial: Partial<{
    coreRetrieval: boolean;
    multiVectorRead: boolean;
    graphRead: boolean;
    memoryFusion: boolean;
    llmRerankFallback: boolean;
    contentRouting: boolean;
    imageEvidenceRead: boolean;
    imageEvidenceContext: boolean;
  }> = {},
) {
  vi.mocked(settingsRepository.getSetting).mockImplementation(async (key) => {
    if (key !== "contextx-rollout") {
      return null;
    }

    return {
      coreRetrieval: true,
      multiVectorRead: false,
      graphRead: false,
      memoryFusion: false,
      llmRerankFallback: true,
      contentRouting: true,
      imageEvidenceRead: false,
      imageEvidenceContext: false,
      ...partial,
    };
  });
}

describe("queryKnowledgeAsDocs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRerank.mockReset();
    mockGenerateText.mockReset();
    mockRewriteKnowledgeQuery.mockResolvedValue({
      rewrites: [],
      entityTerms: [],
    });
    vi.mocked(knowledgeRepository.selectRetrievalScopes).mockResolvedValue([]);
    vi.mocked(
      knowledgeRepository.vectorSearchByEmbeddingKind,
    ).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.fullTextSearch).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.fullTextSearchSections).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.vectorSearchSections).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([
      { documentId: "doc-1", score: 0.9 },
    ]);
    vi.mocked(
      knowledgeRepository.vectorSearchDocumentMetadata,
    ).mockResolvedValue([]);
    vi.mocked(
      knowledgeRepository.findDocumentIdsByRetrievalIdentity,
    ).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.getAdjacentChunks).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.fullTextSearchImages).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.vectorSearchImages).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.getDocumentImages).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.getSectionsByIds).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.getRelatedSections).mockResolvedValue([]);
    vi.mocked(
      knowledgeRepository.findSectionsByStructuredFilters,
    ).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.getDocumentMarkdown).mockResolvedValue(null);
    vi.mocked(knowledgeRepository.insertUsageLog).mockResolvedValue(undefined);
    vi.mocked(settingsRepository.getSetting).mockResolvedValue(null);
    vi.mocked(settingsRepository.getProviderByName).mockResolvedValue(null);
    vi.mocked(settingsRepository.getModelForChat).mockResolvedValue(null);
    vi.mocked(
      selfLearningRepository.searchActiveMemoriesForUser,
    ).mockResolvedValue([]);
  });

  it("rejects a weak top-ranked hit when calibrated confidence stays below the threshold", async () => {
    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([
      { documentId: "doc-1", score: 0.9 },
    ]);
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([
      makeChunkHit({ score: 0.29 }),
    ]);

    const results = await queryKnowledge(
      {
        ...group,
        retrievalThreshold: 0.7,
      },
      "authentication",
      { topN: 3 },
    );

    expect(results).toEqual([]);
  });

  it("keeps neighbor context inline on the primary hit instead of returning extra zero-score rows", async () => {
    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([
      { documentId: "doc-1", score: 0.9 },
    ]);
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([
      makeChunkHit({ chunk: { chunkIndex: 1 } }),
    ]);
    vi.mocked(knowledgeRepository.getAdjacentChunks).mockResolvedValue([
      makeChunkHit({
        chunk: {
          id: "chunk-0",
          chunkIndex: 0,
          content: "Previous authentication context.",
        },
      }),
      makeChunkHit({
        chunk: {
          id: "chunk-2",
          chunkIndex: 2,
          content: "Next authentication context.",
        },
      }),
    ]);

    const results = await queryKnowledge(group, "authentication", { topN: 1 });

    expect(results).toHaveLength(1);
    expect(results[0]?.neighborContext).toEqual({
      previous: "Previous authentication context.",
      next: "Next authentication context.",
    });
  });

  it("constrains chunk retrieval to shortlisted sections when section matches are available", async () => {
    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([
      { documentId: "doc-1", score: 0.9 },
    ]);
    vi.mocked(knowledgeRepository.fullTextSearchSections).mockResolvedValue([
      {
        section: {
          id: "section-1",
          documentId: "doc-1",
          groupId: "group-1",
          parentSectionId: null,
          prevSectionId: null,
          nextSectionId: null,
          heading: "Authentication",
          headingPath: "Guide > Authentication",
          level: 2,
          partIndex: 0,
          partCount: 1,
          content: "Authentication section.",
          summary: "Authentication summary.",
          tokenCount: 100,
          createdAt: new Date("2026-02-01T00:00:00Z"),
        },
        documentId: "doc-1",
        documentName: "Guide",
        score: 1.8,
      },
    ]);
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([
      makeChunkHit(),
    ]);

    await queryKnowledge(group, "authentication", { topN: 3 });

    expect(knowledgeRepository.vectorSearch).toHaveBeenCalledWith(
      "group-1",
      [0.1, 0.2, 0.3],
      expect.any(Number),
      { sectionIds: ["section-1"] },
    );
  });

  it("uses lexical-only multilingual matches when semantic search is empty", async () => {
    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([
      { documentId: "doc-1", score: 0.9 },
    ]);
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.fullTextSearch).mockResolvedValue([
      makeChunkHit({ score: 1.6 }),
    ]);

    const results = await queryKnowledge(group, "登录 设置", { topN: 3 });

    expect(results).toHaveLength(1);
    expect(results[0]?.documentId).toBe("doc-1");
  });

  it("still retrieves chunk matches when document metadata returns no candidates", async () => {
    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([]);
    vi.mocked(
      knowledgeRepository.vectorSearchDocumentMetadata,
    ).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([
      makeChunkHit({ score: 0.74 }),
    ]);

    const results = await queryKnowledge(group, "authentication", { topN: 3 });

    expect(results).toHaveLength(1);
    expect(knowledgeRepository.vectorSearch).toHaveBeenCalledWith(
      "group-1",
      [0.1, 0.2, 0.3],
      expect.any(Number),
      undefined,
    );
  });

  it("uses multi-vector chunk search arms when the rollout enables them", async () => {
    mockRollout({ multiVectorRead: true });
    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([]);
    vi.mocked(
      knowledgeRepository.vectorSearchDocumentMetadata,
    ).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([]);
    vi.mocked(
      knowledgeRepository.vectorSearchByEmbeddingKind,
    ).mockImplementation(async (_groupId, _embedding, _limit, kind) =>
      kind === "identity" ? [makeChunkHit({ score: 0.68 })] : [],
    );

    const results = await queryKnowledge(group, "authentication", { topN: 3 });

    expect(results).toHaveLength(1);
    expect(
      knowledgeRepository.vectorSearchByEmbeddingKind,
    ).toHaveBeenCalledTimes(4);
    expect(results[0]?.documentId).toBe("doc-1");
  });

  it("falls back to LLM listwise reranking when no native reranker is configured", async () => {
    vi.mocked(settingsRepository.getSetting).mockImplementation(async (key) => {
      if (key === "contextx-rollout") {
        return {
          coreRetrieval: true,
          multiVectorRead: false,
          graphRead: false,
          memoryFusion: false,
          llmRerankFallback: true,
          contentRouting: true,
          imageEvidenceRead: false,
          imageEvidenceContext: false,
        };
      }
      if (key === "knowledge-context-model") {
        return {
          provider: "openai",
          model: "gpt-4.1-mini",
        };
      }
      return null;
    });
    vi.mocked(settingsRepository.getProviderByName).mockResolvedValue({
      enabled: true,
      apiKey: "test-key",
      baseUrl: null,
      settings: {},
    } as any);
    vi.mocked(settingsRepository.getModelForChat).mockResolvedValue({
      apiName: "gpt-4.1-mini",
    } as any);
    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([]);
    vi.mocked(
      knowledgeRepository.vectorSearchDocumentMetadata,
    ).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([
      makeChunkHit({
        chunk: { id: "chunk-1", content: "Generic onboarding instructions." },
        score: 0.88,
      }),
      makeChunkHit({
        chunk: {
          id: "chunk-2",
          content: "Configure SSO with the SAML identity provider.",
        },
        score: 0.84,
      }),
    ]);
    mockGenerateText.mockResolvedValue({
      output: {
        ranking: [
          { index: 2, score: 0.97 },
          { index: 1, score: 0.31 },
        ],
      },
    });

    const results = await queryKnowledge(group, "configure sso", { topN: 2 });

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(results[0]?.chunk.id).toBe("chunk-2");
  });

  it("uses user memory variants only for chat and agent retrieval", async () => {
    mockRollout({ memoryFusion: true });
    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([]);
    vi.mocked(
      knowledgeRepository.vectorSearchDocumentMetadata,
    ).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([]);
    vi.mocked(
      selfLearningRepository.searchActiveMemoriesForUser,
    ).mockResolvedValue([
      {
        id: "mem-1",
        userId: "user-1",
        category: "workflow",
        status: "active",
        isAutoSafe: true,
        fingerprint: "fp-1",
        title: "Enterprise login",
        content: "Use the SAML identity provider setup for SSO.",
        supportCount: 1,
        distinctThreadCount: 1,
        createdAt: new Date("2026-02-01T00:00:00Z"),
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      },
    ] as any);
    vi.mocked(knowledgeRepository.fullTextSearch).mockImplementation(
      async (_groupId, queryVariant) =>
        queryVariant.includes("SAML identity provider")
          ? [
              makeChunkHit({
                score: 1.7,
                chunk: {
                  content: "Use the SAML identity provider setup for SSO.",
                },
              }),
            ]
          : [],
    );

    const results = await queryKnowledge(
      group,
      "how do I configure enterprise login",
      {
        topN: 3,
        userId: "user-1",
        source: "chat",
      },
    );

    expect(
      selfLearningRepository.searchActiveMemoriesForUser,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        query: "how do I configure enterprise login",
      }),
    );
    expect(results).toHaveLength(1);
  });

  it("never uses user memory variants for MCP retrieval", async () => {
    mockRollout({ memoryFusion: true });

    await queryKnowledge(group, "enterprise login", {
      topN: 3,
      userId: "user-1",
      source: "mcp",
    });

    expect(
      selfLearningRepository.searchActiveMemoriesForUser,
    ).not.toHaveBeenCalled();
  });

  it("returns hits across multiple documents when diversity is needed", async () => {
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([
      makeChunkHit({
        documentId: "doc-1",
        chunk: {
          documentId: "doc-1",
          id: "chunk-1",
          metadata: { headingPath: "Guide > Authentication" },
        },
        score: 0.92,
      }),
      makeChunkHit({
        documentId: "doc-2",
        chunk: {
          documentId: "doc-2",
          id: "chunk-3",
          metadata: { headingPath: "Guide > Authorization" },
        },
        score: 0.88,
        documentName: "Guide 2",
      }),
    ]);

    const results = await queryKnowledge(
      group,
      "authentication authorization",
      {
        topN: 2,
      },
    );

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.documentId)).toContain("doc-1");
    expect(results.map((r) => r.documentId)).toContain("doc-2");
  });

  it("uses structured section filters for exact page queries", async () => {
    vi.mocked(
      knowledgeRepository.findSectionsByStructuredFilters,
    ).mockResolvedValue([
      {
        section: {
          id: "section-page-100",
          documentId: "doc-1",
          groupId: "group-1",
          parentSectionId: null,
          prevSectionId: null,
          nextSectionId: null,
          heading: "38. LIABILITAS IMBALAN PASCA-KERJA",
          headingPath: "38. LIABILITAS IMBALAN PASCA-KERJA",
          level: 2,
          partIndex: 0,
          partCount: 1,
          content: "Matched page section.",
          summary: "Matched page summary.",
          tokenCount: 80,
          pageStart: 100,
          pageEnd: 100,
          noteNumber: "38",
          noteTitle: "LIABILITAS IMBALAN PASCA-KERJA",
          noteSubsection: null,
          continued: false,
          createdAt: new Date("2026-02-01T00:00:00Z"),
        },
        documentId: "doc-1",
        documentName: "BBCA Statements",
      },
    ]);
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([
      makeChunkHit({ chunk: { sectionId: "section-page-100" } }),
    ]);

    await queryKnowledge(group, "BBCA halaman 100 liabilitas", { topN: 3 });

    expect(
      knowledgeRepository.findSectionsByStructuredFilters,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "group-1",
        page: 100,
      }),
    );
    expect(knowledgeRepository.vectorSearch).toHaveBeenCalledWith(
      "group-1",
      [0.1, 0.2, 0.3],
      expect.any(Number),
      { sectionIds: ["section-page-100"] },
    );
  });

  it("returns section-first bundles with parent and continuation context", async () => {
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([
      makeChunkHit(),
    ]);
    vi.mocked(
      knowledgeRepository.getDocumentMetadataByIdsAcrossGroups,
    ).mockResolvedValue([
      {
        documentId: "doc-1",
        groupId: "group-1",
        name: "Guide",
        description: null,
        metadata: { sectionGraphVersion: 1 },
        activeVersionId: "version-1",
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    vi.mocked(knowledgeRepository.getSectionsByIds).mockResolvedValue([
      {
        id: "section-1",
        documentId: "doc-1",
        groupId: "group-1",
        parentSectionId: "parent-1",
        prevSectionId: null,
        nextSectionId: "section-2",
        heading: "Authentication",
        headingPath: "Guide > Authentication",
        level: 2,
        partIndex: 0,
        partCount: 2,
        content: "Matched authentication section content.",
        summary: "Authentication section summary.",
        tokenCount: 120,
        pageStart: 7,
        pageEnd: 8,
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    vi.mocked(knowledgeRepository.getRelatedSections).mockResolvedValue([
      {
        id: "parent-1",
        documentId: "doc-1",
        groupId: "group-1",
        parentSectionId: null,
        prevSectionId: null,
        nextSectionId: "section-1",
        heading: "Guide",
        headingPath: "Guide",
        level: 1,
        partIndex: 0,
        partCount: 1,
        content: "Guide intro",
        summary: "Guide parent summary.",
        tokenCount: 40,
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
      {
        id: "section-2",
        documentId: "doc-1",
        groupId: "group-1",
        parentSectionId: "parent-1",
        prevSectionId: "section-1",
        nextSectionId: null,
        heading: "Authentication",
        headingPath: "Guide > Authentication",
        level: 2,
        partIndex: 1,
        partCount: 2,
        content: "Continuation content for the next part.",
        summary: "Authentication continuation summary.",
        tokenCount: 80,
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    vi.mocked(knowledgeRepository.getDocumentMarkdown).mockResolvedValue({
      name: "Guide",
      description: null,
      markdown: [
        "<!--CTX_PAGE:7-->",
        "# Guide",
        "",
        "Guide intro",
        "",
        "<!--CTX_PAGE:8-->",
        "Authentication content for the matched section.",
        "",
        "Continuation content for the next part.",
      ].join("\n"),
    });

    const docs = await queryKnowledgeAsDocs(group, "auth setup", {
      tokens: 5000,
    });

    expect(docs).toHaveLength(1);
    expect(docs[0]?.markdown).toContain(
      "### Guide > Authentication (Part 1/2)",
    );
    expect(docs[0]?.citationCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          versionId: "version-1",
          sectionId: "section-1",
          sectionHeading: "Guide > Authentication",
          pageStart: 8,
          pageEnd: 8,
          excerpt: "Authentication content for the matched section.",
        }),
      ]),
    );
    expect(docs[0]?.markdown).toContain("Parent context:");
    expect(docs[0]?.markdown).toContain("#### Next Part");
    expect(knowledgeRepository.getDocumentMarkdown).toHaveBeenCalledTimes(1);
    expect(knowledgeRepository.insertUsageLog).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          resultMode: "section-first",
          sectionCount: 1,
          fallbackUsed: false,
        }),
      }),
    );
  });

  it("refines section-first citation pages from document page markers for multi-page sections", async () => {
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([
      makeChunkHit({
        chunk: {
          content:
            "Vape products become taxable under the updated reporting framework.",
          metadata: {
            headingPath: "PMK 161 > Pasal 3",
            section: "Pasal 3",
            pageStart: 1,
            pageEnd: 12,
          },
        },
      }),
    ]);
    vi.mocked(
      knowledgeRepository.getDocumentMetadataByIdsAcrossGroups,
    ).mockResolvedValue([
      {
        documentId: "doc-1",
        groupId: "group-1",
        name: "PMK 161",
        description: null,
        metadata: { sectionGraphVersion: 1 },
        activeVersionId: "version-1",
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    vi.mocked(knowledgeRepository.getSectionsByIds).mockResolvedValue([
      {
        id: "section-1",
        documentId: "doc-1",
        groupId: "group-1",
        parentSectionId: null,
        prevSectionId: null,
        nextSectionId: null,
        heading: "Pasal 3",
        headingPath: "PMK 161 > Pasal 3",
        level: 2,
        partIndex: 0,
        partCount: 1,
        content:
          "This legal section spans multiple pages and starts on page one.",
        summary: "Taxable goods reporting requirements.",
        tokenCount: 180,
        pageStart: 1,
        pageEnd: 12,
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    vi.mocked(knowledgeRepository.getRelatedSections).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.getDocumentMarkdown).mockResolvedValue({
      name: "PMK 161",
      description: null,
      markdown: [
        "<!--CTX_PAGE:1-->",
        "# PMK 161",
        "",
        "Opening page.",
        "",
        "<!--CTX_PAGE:5-->",
        "Vape products become taxable under the updated reporting framework.",
        "",
        "Further details for the same requirement.",
      ].join("\n"),
    });

    const docs = await queryKnowledgeAsDocs(group, "vape cukai", {
      tokens: 5000,
    });

    expect(docs[0]?.citationCandidates).toEqual([
      expect.objectContaining({
        pageStart: 5,
        pageEnd: 5,
      }),
    ]);
  });

  it("keeps multiple chunk-level citations for a single matched section when pages differ", async () => {
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([
      makeChunkHit({
        chunk: {
          id: "chunk-1",
          content: "2018 regulation created the earlier excise reporting path.",
          metadata: {
            headingPath: "PMK 161 > Pasal 3",
            section: "Pasal 3",
            pageStart: 3,
            pageEnd: 3,
          },
        },
        score: 0.91,
      }),
      makeChunkHit({
        chunk: {
          id: "chunk-2",
          content:
            "Vape products were integrated into Hasil Tembakau reporting in 2022.",
          metadata: {
            headingPath: "PMK 161 > Pasal 3",
            section: "Pasal 3",
            pageStart: 6,
            pageEnd: 6,
          },
        },
        score: 0.89,
      }),
    ]);
    vi.mocked(
      knowledgeRepository.getDocumentMetadataByIdsAcrossGroups,
    ).mockResolvedValue([
      {
        documentId: "doc-1",
        groupId: "group-1",
        name: "PMK 161",
        description: null,
        metadata: { sectionGraphVersion: 1 },
        activeVersionId: "version-1",
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    vi.mocked(knowledgeRepository.getSectionsByIds).mockResolvedValue([
      {
        id: "section-1",
        documentId: "doc-1",
        groupId: "group-1",
        parentSectionId: null,
        prevSectionId: null,
        nextSectionId: null,
        heading: "Pasal 3",
        headingPath: "PMK 161 > Pasal 3",
        level: 2,
        partIndex: 0,
        partCount: 1,
        content: "This legal section spans multiple pages and multiple rules.",
        summary: "Taxable goods reporting requirements.",
        tokenCount: 180,
        pageStart: 3,
        pageEnd: 6,
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    vi.mocked(knowledgeRepository.getRelatedSections).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.getDocumentMarkdown).mockResolvedValue({
      name: "PMK 161",
      description: null,
      markdown: [
        "<!--CTX_PAGE:3-->",
        "2018 regulation created the earlier excise reporting path.",
        "",
        "<!--CTX_PAGE:6-->",
        "Vape products were integrated into Hasil Tembakau reporting in 2022.",
      ].join("\n"),
    });

    const docs = await queryKnowledgeAsDocs(group, "vape cukai", {
      tokens: 5000,
    });

    expect(docs[0]?.citationCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pageStart: 3,
          pageEnd: 3,
          excerpt: "2018 regulation created the earlier excise reporting path.",
        }),
        expect.objectContaining({
          pageStart: 6,
          pageEnd: 6,
          excerpt:
            "Vape products were integrated into Hasil Tembakau reporting in 2022.",
        }),
      ]),
    );
  });

  it("falls back to full-doc retrieval for legacy documents without section graphs", async () => {
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([
      makeChunkHit({
        chunk: {
          sectionId: null,
          metadata: {
            headingPath: "Legacy Guide > Authentication",
            section: "Authentication",
            pageStart: 11,
            pageEnd: 12,
          },
        },
      }),
    ]);
    vi.mocked(
      knowledgeRepository.getDocumentMetadataByIdsAcrossGroups,
    ).mockResolvedValue([
      {
        documentId: "doc-1",
        groupId: "group-1",
        name: "Legacy Guide",
        description: null,
        metadata: null,
        activeVersionId: "legacy-version-1",
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    vi.mocked(knowledgeRepository.getDocumentMarkdown).mockResolvedValue({
      name: "Legacy Guide",
      description: null,
      markdown: "# Legacy Guide\n\nFull legacy document content.",
    });

    const docs = await queryKnowledgeAsDocs(group, "legacy auth", {
      tokens: 5000,
    });

    expect(docs).toHaveLength(1);
    expect(docs[0]?.markdown).toContain("Full legacy document content.");
    expect(docs[0]?.citationCandidates).toEqual([
      expect.objectContaining({
        versionId: "legacy-version-1",
        sectionId: null,
        sectionHeading: "Legacy Guide > Authentication",
        pageStart: 11,
        pageEnd: 12,
      }),
    ]);
    expect(knowledgeRepository.getDocumentMarkdown).toHaveBeenCalledTimes(1);
    expect(knowledgeRepository.insertUsageLog).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          resultMode: "section-first",
          fallbackUsed: true,
        }),
      }),
    );
  });

  it("backfills chunk evidence for metadata-only full-doc results so citations keep exact pages", async () => {
    vi.mocked(knowledgeRepository.vectorSearch).mockImplementation(
      async (_groupId, _embedding, _limit, filters) => {
        if (filters?.documentIds?.includes("doc-1")) {
          return [
            makeChunkHit({
              chunk: {
                content:
                  "Vape products become taxable under the updated reporting framework.",
                metadata: {
                  headingPath: "PMK 161 > Pasal 3",
                  section: "Pasal 3",
                  pageStart: 2,
                  pageEnd: 2,
                },
              },
              score: 0.88,
            }),
          ];
        }

        return [];
      },
    );
    vi.mocked(knowledgeRepository.fullTextSearch).mockResolvedValue([]);
    vi.mocked(
      knowledgeRepository.getDocumentMetadataByIdsAcrossGroups,
    ).mockResolvedValue([
      {
        documentId: "doc-1",
        groupId: "group-1",
        name: "PMK 161",
        description: null,
        metadata: null,
        activeVersionId: "version-1",
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    vi.mocked(knowledgeRepository.getDocumentMarkdown).mockResolvedValue({
      name: "PMK 161",
      description: null,
      markdown: [
        "<!--CTX_PAGE:1-->",
        "# PMK 161",
        "",
        "Opening page.",
        "",
        "<!--CTX_PAGE:2-->",
        "Vape products become taxable under the updated reporting framework.",
      ].join("\n"),
    });

    const docs = await queryKnowledgeAsDocs(group, "vape cukai", {
      tokens: 5000,
      resultMode: "full-doc",
    });

    expect(docs[0]?.citationCandidates).toEqual([
      expect.objectContaining({
        pageStart: 2,
        pageEnd: 2,
      }),
    ]);
    expect(knowledgeRepository.vectorSearch).toHaveBeenCalledWith(
      "group-1",
      [0.1, 0.2, 0.3],
      expect.any(Number),
      { documentIds: ["doc-1"] },
    );
  });

  it("keeps distinct legal article citation candidates from PMK 161 in full-doc mode", async () => {
    vi.mocked(knowledgeRepository.vectorSearch).mockImplementation(
      async (_groupId, _embedding, _limit, filters) => {
        if (filters?.documentIds?.includes("doc-1")) {
          return [
            makeChunkHit({
              chunk: {
                id: "chunk-pasal-3a",
                content:
                  "Pengusaha Pabrik wajib memberitahukan secara berkala kepada Kepala Kantor mengenai barang kena cukai yang selesai dibuat.",
                metadata: {
                  headingPath: "161_PMK.04_2022 > Pasal 3",
                  section: "Pasal 3",
                  pageStart: 6,
                  pageEnd: 6,
                },
              },
              score: 0.94,
            }),
            makeChunkHit({
              chunk: {
                id: "chunk-pasal-3b",
                content:
                  "Barang kena cukai yang selesai dibuat diberitahukan sebagaimana dimaksud pada ayat (1).",
                metadata: {
                  headingPath: "161_PMK.04_2022 > Pasal 3",
                  section: "Pasal 3",
                  pageStart: 6,
                  pageEnd: 6,
                },
              },
              score: 0.92,
            }),
            makeChunkHit({
              chunk: {
                id: "chunk-pasal-7",
                content:
                  "Pemberitahuan bulanan disampaikan oleh Pengusaha Pabrik paling lambat pada tanggal 10 (sepuluh) bulan berikutnya.",
                metadata: {
                  headingPath: "161_PMK.04_2022 > Pasal 7",
                  section: "Pasal 7",
                  pageStart: 7,
                  pageEnd: 7,
                },
              },
              score: 0.91,
            }),
            makeChunkHit({
              chunk: {
                id: "chunk-pasal-13",
                content:
                  "Pengusaha Pabrik yang tidak menyampaikan pemberitahuan dikenai sanksi administrasi sesuai ketentuan peraturan perundang-undangan di bidang cukai.",
                metadata: {
                  headingPath: "161_PMK.04_2022 > Pasal 13",
                  section: "Pasal 13",
                  pageStart: 10,
                  pageEnd: 10,
                },
              },
              score: 0.9,
            }),
          ];
        }

        return [];
      },
    );
    vi.mocked(knowledgeRepository.fullTextSearch).mockResolvedValue([]);
    vi.mocked(
      knowledgeRepository.getDocumentMetadataByIdsAcrossGroups,
    ).mockResolvedValue([
      {
        documentId: "doc-1",
        groupId: "group-1",
        name: "161_PMK.04_2022.pdf",
        description: null,
        metadata: null,
        activeVersionId: "version-161",
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    vi.mocked(knowledgeRepository.getDocumentMarkdown).mockResolvedValue({
      name: "161_PMK.04_2022.pdf",
      description: null,
      markdown: [
        "<!--CTX_PAGE:6-->",
        "Pasal 3",
        "Pengusaha Pabrik wajib memberitahukan secara berkala kepada Kepala Kantor mengenai barang kena cukai yang selesai dibuat.",
        "",
        "<!--CTX_PAGE:7-->",
        "Pasal 7",
        "Pemberitahuan bulanan disampaikan oleh Pengusaha Pabrik paling lambat pada tanggal 10 (sepuluh) bulan berikutnya.",
        "",
        "<!--CTX_PAGE:10-->",
        "Pasal 13",
        "Pengusaha Pabrik yang tidak menyampaikan pemberitahuan dikenai sanksi administrasi sesuai ketentuan peraturan perundang-undangan di bidang cukai.",
      ].join("\n"),
    });

    const docs = await queryKnowledgeAsDocs(group, "PMK 161 pasal 3 pasal 7", {
      tokens: 5000,
      resultMode: "full-doc",
    });

    expect(docs[0]?.citationCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sectionHeading: "161_PMK.04_2022 > Pasal 3",
          pageStart: 6,
          pageEnd: 6,
        }),
        expect.objectContaining({
          sectionHeading: "161_PMK.04_2022 > Pasal 7",
          pageStart: 7,
          pageEnd: 7,
        }),
        expect.objectContaining({
          sectionHeading: "161_PMK.04_2022 > Pasal 13",
          pageStart: 10,
          pageEnd: 10,
        }),
      ]),
    );
  });

  it("keeps distinct non-legal section citation candidates in full-doc mode", async () => {
    vi.mocked(knowledgeRepository.vectorSearch).mockImplementation(
      async (_groupId, _embedding, _limit, filters) => {
        if (filters?.documentIds?.includes("doc-1")) {
          return [
            makeChunkHit({
              chunk: {
                id: "chunk-install-1",
                content:
                  "Install the desktop app from the downloads page and sign in.",
                metadata: {
                  headingPath: "Product Manual > Installation",
                  section: "Installation",
                  pageStart: 2,
                  pageEnd: 2,
                },
              },
              score: 0.95,
            }),
            makeChunkHit({
              chunk: {
                id: "chunk-install-2",
                content:
                  "After installation, connect the device to power and network.",
                metadata: {
                  headingPath: "Product Manual > Installation",
                  section: "Installation",
                  pageStart: 2,
                  pageEnd: 2,
                },
              },
              score: 0.94,
            }),
            makeChunkHit({
              chunk: {
                id: "chunk-settings",
                content:
                  "To enable automatic backup, open Settings > Backup and toggle Auto Backup.",
                metadata: {
                  headingPath: "Product Manual > Workspace Settings",
                  section: "Workspace Settings",
                  pageStart: 5,
                  pageEnd: 5,
                },
              },
              score: 0.91,
            }),
            makeChunkHit({
              chunk: {
                id: "chunk-troubleshooting",
                content:
                  "If the backup fails, restart the device and retry the sync.",
                metadata: {
                  headingPath: "Product Manual > Troubleshooting",
                  section: "Troubleshooting",
                  pageStart: 8,
                  pageEnd: 8,
                },
              },
              score: 0.9,
            }),
          ];
        }

        return [];
      },
    );
    vi.mocked(knowledgeRepository.fullTextSearch).mockResolvedValue([]);
    vi.mocked(
      knowledgeRepository.getDocumentMetadataByIdsAcrossGroups,
    ).mockResolvedValue([
      {
        documentId: "doc-1",
        groupId: "group-1",
        name: "Product Manual",
        description: null,
        metadata: null,
        activeVersionId: "version-1",
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    vi.mocked(knowledgeRepository.getDocumentMarkdown).mockResolvedValue({
      name: "Product Manual",
      description: null,
      markdown: [
        "<!--CTX_PAGE:2-->",
        "Installation",
        "Install the desktop app from the downloads page and sign in.",
        "",
        "<!--CTX_PAGE:5-->",
        "Workspace Settings",
        "To enable automatic backup, open Settings > Backup and toggle Auto Backup.",
        "",
        "<!--CTX_PAGE:8-->",
        "Troubleshooting",
        "If the backup fails, restart the device and retry the sync.",
      ].join("\n"),
    });

    const docs = await queryKnowledgeAsDocs(group, "enable automatic backup", {
      tokens: 5000,
      resultMode: "full-doc",
    });

    expect(docs[0]?.citationCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sectionHeading: "Product Manual > Installation",
          pageStart: 2,
          pageEnd: 2,
        }),
        expect.objectContaining({
          sectionHeading: "Product Manual > Workspace Settings",
          pageStart: 5,
          pageEnd: 5,
        }),
        expect.objectContaining({
          sectionHeading: "Product Manual > Troubleshooting",
          pageStart: 8,
          pageEnd: 8,
        }),
      ]),
    );
  });

  it("attaches matched images scoped to the returned documents", async () => {
    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([
      { documentId: "doc-1", score: 0.9 },
    ]);
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([
      makeChunkHit(),
    ]);
    vi.mocked(
      knowledgeRepository.getDocumentMetadataByIdsAcrossGroups,
    ).mockResolvedValue([
      {
        documentId: "doc-1",
        groupId: "group-1",
        name: "Guide",
        description: null,
        metadata: { sectionGraphVersion: 1 },
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    vi.mocked(knowledgeRepository.getSectionsByIds).mockResolvedValue([
      {
        id: "section-1",
        documentId: "doc-1",
        groupId: "group-1",
        parentSectionId: null,
        prevSectionId: null,
        nextSectionId: null,
        heading: "Authentication",
        headingPath: "Guide > Authentication",
        level: 2,
        partIndex: 0,
        partCount: 1,
        content: "Matched authentication section content.",
        summary: "Authentication section summary.",
        tokenCount: 120,
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    vi.mocked(knowledgeRepository.getRelatedSections).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.vectorSearchImages).mockResolvedValue([
      {
        id: "image-1",
        documentId: "doc-1",
        groupId: "group-1",
        versionId: "version-1",
        kind: "embedded",
        ordinal: 1,
        marker: "CTX_IMAGE_1",
        label: "Authentication settings",
        description: "Screenshot of the authentication settings panel.",
        headingPath: "Guide > Authentication",
        stepHint: "Open the authentication settings panel.",
        sourceUrl: "https://example.com/image-1.png",
        storagePath: "knowledge-images/doc-1/version-1/image-1.png",
        mediaType: "image/png",
        pageNumber: 2,
        width: 800,
        height: 600,
        altText: null,
        caption: null,
        surroundingText: null,
        isRenderable: true,
        manualLabel: false,
        manualDescription: false,
        embedding: null,
        createdAt: new Date("2026-02-01T00:00:00Z"),
        updatedAt: new Date("2026-02-01T00:00:00Z"),
        score: 0.91,
      },
    ]);

    const docs = await queryKnowledgeAsDocs(group, "auth setup", {
      tokens: 5000,
    });

    expect(docs[0]?.matchedImages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "image-1",
          label: "Authentication settings",
          headingPath: "Guide > Authentication",
        }),
      ]),
    );
  });

  it("recalls a document from image OCR evidence and injects compact image context", async () => {
    mockRollout({ imageEvidenceRead: true, imageEvidenceContext: true });
    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([]);
    vi.mocked(
      knowledgeRepository.vectorSearchDocumentMetadata,
    ).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.fullTextSearch).mockResolvedValue([]);
    vi.mocked(
      knowledgeRepository.getDocumentMetadataByIdsAcrossGroups,
    ).mockResolvedValue([
      {
        documentId: "doc-1",
        groupId: "group-1",
        name: "Quarterly Report",
        description: null,
        metadata: { sectionGraphVersion: 1 },
        activeVersionId: "version-1",
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    vi.mocked(knowledgeRepository.getDocumentMarkdown).mockResolvedValue({
      name: "Quarterly Report",
      description: null,
      markdown: "# Quarterly Report\n\nRevenue trends and commentary.",
    });
    vi.mocked(knowledgeRepository.fullTextSearchImages).mockResolvedValue([
      {
        id: "image-ocr-1",
        documentId: "doc-1",
        groupId: "group-1",
        versionId: "version-1",
        kind: "embedded",
        ordinal: 1,
        marker: "CTX_IMAGE_1",
        label: "Quarterly revenue chart",
        description: "Bar chart of quarterly revenue.",
        headingPath: "Quarterly Report > Revenue",
        stepHint: null,
        sourceUrl: "https://example.com/chart.png",
        storagePath: "knowledge-images/doc-1/version-1/chart.png",
        mediaType: "image/png",
        pageNumber: 5,
        width: 1024,
        height: 768,
        altText: null,
        caption: "Figure 1. Revenue by quarter",
        surroundingText: "Revenue continues to rise through Q4.",
        precedingText: null,
        followingText: null,
        imageType: "chart",
        ocrText: "Q1 12.4\nQ2 13.8\nQ3 15.1\nQ4 16.2",
        ocrConfidence: 0.91,
        exactValueSnippets: ["Q4 revenue: 16.2T", "YoY growth: 14%"],
        structuredData: {
          chartData: {
            chartType: "bar chart",
            xAxisLabel: "Quarter",
            yAxisLabel: "Revenue (Rp trillion)",
            summary: "Revenue rises each quarter.",
          },
        },
        isRenderable: true,
        manualLabel: false,
        manualDescription: false,
        embedding: null,
        createdAt: new Date("2026-02-01T00:00:00Z"),
        updatedAt: new Date("2026-02-01T00:00:00Z"),
        score: 1.7,
      },
    ]);
    vi.mocked(knowledgeRepository.vectorSearchImages).mockResolvedValue([]);

    const docs = await queryKnowledgeAsDocs(group, "what is q4 revenue 16.2", {
      tokens: 5000,
      resultMode: "full-doc",
    });

    expect(docs).toHaveLength(1);
    expect(docs[0]?.documentId).toBe("doc-1");
    expect(docs[0]?.markdown).toContain("### Image Evidence");
    expect(docs[0]?.markdown).toContain("Q4 revenue: 16.2T");
    expect(docs[0]?.citationCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pageStart: 5,
          excerpt: "Q4 revenue: 16.2T",
        }),
      ]),
    );
    expect(docs[0]?.matchedImages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "image-ocr-1",
          label: "Quarterly revenue chart",
        }),
      ]),
    );
    expect((docs[0]?.matchedImages?.[0] as any)?.ocrText).toBeUndefined();
  });

  it("falls back to renderable doc images when hybrid image search misses", async () => {
    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([
      { documentId: "doc-1", score: 0.9 },
    ]);
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([
      makeChunkHit(),
    ]);
    vi.mocked(
      knowledgeRepository.getDocumentMetadataByIdsAcrossGroups,
    ).mockResolvedValue([
      {
        documentId: "doc-1",
        groupId: "group-1",
        name: "Guide",
        description: null,
        metadata: { sectionGraphVersion: 1 },
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    vi.mocked(knowledgeRepository.getSectionsByIds).mockResolvedValue([
      {
        id: "section-1",
        documentId: "doc-1",
        groupId: "group-1",
        parentSectionId: null,
        prevSectionId: null,
        nextSectionId: null,
        heading: "Authentication",
        headingPath: "Guide > Authentication",
        level: 2,
        partIndex: 0,
        partCount: 1,
        content: "Matched authentication section content.",
        summary: "Authentication section summary.",
        tokenCount: 120,
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    vi.mocked(knowledgeRepository.getRelatedSections).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.vectorSearchImages).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.fullTextSearchImages).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.getDocumentImages).mockResolvedValue([
      {
        id: "image-2",
        documentId: "doc-1",
        groupId: "group-1",
        versionId: "version-1",
        kind: "embedded",
        ordinal: 2,
        marker: "CTX_IMAGE_2",
        label: "Authentication setup screen",
        description:
          "Screenshot showing the authentication configuration form.",
        headingPath: "Guide > Authentication",
        stepHint: "Configure authentication settings.",
        sourceUrl: "https://example.com/image-2.png",
        storagePath: "knowledge-images/doc-1/version-1/image-2.png",
        mediaType: "image/png",
        pageNumber: 3,
        width: 800,
        height: 600,
        altText: null,
        caption: null,
        surroundingText: "Use this screen during authentication setup.",
        isRenderable: true,
        manualLabel: true,
        manualDescription: true,
        embedding: null,
        createdAt: new Date("2026-02-01T00:00:00Z"),
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      },
      {
        id: "image-3",
        documentId: "doc-1",
        groupId: "group-1",
        versionId: "version-1",
        kind: "embedded",
        ordinal: 3,
        marker: "CTX_IMAGE_3",
        label: "Company overview",
        description: "Corporate overview slide.",
        headingPath: "Guide > Overview",
        stepHint: "Review the company background.",
        sourceUrl: "https://example.com/image-3.png",
        storagePath: "knowledge-images/doc-1/version-1/image-3.png",
        mediaType: "image/png",
        pageNumber: 4,
        width: 800,
        height: 600,
        altText: null,
        caption: null,
        surroundingText: null,
        isRenderable: true,
        manualLabel: false,
        manualDescription: false,
        embedding: null,
        createdAt: new Date("2026-02-01T00:00:00Z"),
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);

    const docs = await queryKnowledgeAsDocs(group, "auth setup", {
      tokens: 5000,
    });

    expect(docs[0]?.matchedImages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "image-2",
          label: "Authentication setup screen",
          headingPath: "Guide > Authentication",
        }),
      ]),
    );
  });

  it("uses before and after image context to recover relevant fallback images", async () => {
    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([
      { documentId: "doc-1", score: 0.9 },
    ]);
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([
      makeChunkHit(),
    ]);
    vi.mocked(
      knowledgeRepository.getDocumentMetadataByIdsAcrossGroups,
    ).mockResolvedValue([
      {
        documentId: "doc-1",
        groupId: "group-1",
        name: "Guide",
        description: null,
        metadata: { sectionGraphVersion: 1 },
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    vi.mocked(knowledgeRepository.getSectionsByIds).mockResolvedValue([
      {
        id: "section-1",
        documentId: "doc-1",
        groupId: "group-1",
        parentSectionId: null,
        prevSectionId: null,
        nextSectionId: null,
        heading: "Authentication",
        headingPath: "Guide > Authentication",
        level: 2,
        partIndex: 0,
        partCount: 1,
        content: "Matched authentication section content.",
        summary: "Authentication section summary.",
        tokenCount: 120,
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    vi.mocked(knowledgeRepository.getRelatedSections).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.vectorSearchImages).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.fullTextSearchImages).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.getDocumentImages).mockResolvedValue([
      {
        id: "image-4",
        documentId: "doc-1",
        groupId: "group-1",
        versionId: "version-1",
        kind: "embedded",
        ordinal: 4,
        marker: "CTX_IMAGE_4",
        label: "Security screen",
        description: "Screenshot of a security settings page.",
        headingPath: "Guide > Authentication",
        stepHint: "Open the security settings page.",
        sourceUrl: "https://example.com/image-4.png",
        storagePath: "knowledge-images/doc-1/version-1/image-4.png",
        mediaType: "image/png",
        pageNumber: 5,
        width: 800,
        height: 600,
        altText: null,
        caption: null,
        surroundingText: null,
        precedingText:
          "Open Security Settings before starting passkey enrollment.",
        followingText: "Use this screen to confirm the passkey setup flow.",
        isRenderable: true,
        manualLabel: false,
        manualDescription: false,
        embedding: null,
        createdAt: new Date("2026-02-01T00:00:00Z"),
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);

    const docs = await queryKnowledgeAsDocs(group, "passkey setup", {
      tokens: 5000,
    });

    expect(docs[0]?.matchedImages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "image-4",
          label: "Security screen",
        }),
      ]),
    );
  });

  it("prefers same-section and same-page images over unrelated higher-scoring candidates", async () => {
    const matchContext = {
      matchedSectionHeadings: ["Guide > Authentication"],
      matchedSectionTerms: ["guide", "authentication"],
      matchedPages: [2],
      hasAnchors: true,
    };

    const unrelatedScore = scoreRetrievedImageCandidate({
      image: {
        id: "image-unrelated",
        documentId: "doc-1",
        groupId: "group-1",
        versionId: "version-1",
        kind: "embedded",
        ordinal: 2,
        marker: "CTX_IMAGE_2",
        label: "Company overview",
        description: "Corporate overview slide.",
        headingPath: "Guide > Overview",
        stepHint: "Review the company background.",
        sourceUrl: "https://example.com/image-2.png",
        storagePath: "knowledge-images/doc-1/version-1/image-2.png",
        mediaType: "image/png",
        pageNumber: 8,
        width: 800,
        height: 600,
        altText: null,
        caption: null,
        surroundingText: null,
        precedingText: null,
        followingText: null,
        isRenderable: true,
        manualLabel: false,
        manualDescription: false,
        embedding: null,
        createdAt: new Date("2026-02-01T00:00:00Z"),
        updatedAt: new Date("2026-02-01T00:00:00Z"),
        score: 0.98,
      },
      docScore: 0.8,
      matchContext,
    });

    const relevantScore = scoreRetrievedImageCandidate({
      image: {
        id: "image-relevant",
        documentId: "doc-1",
        groupId: "group-1",
        versionId: "version-1",
        kind: "embedded",
        ordinal: 1,
        marker: "CTX_IMAGE_1",
        label: "Authentication settings",
        description: "Screenshot of the authentication settings panel.",
        headingPath: "Guide > Authentication",
        stepHint: "Open the authentication settings panel.",
        sourceUrl: "https://example.com/image-1.png",
        storagePath: "knowledge-images/doc-1/version-1/image-1.png",
        mediaType: "image/png",
        pageNumber: 2,
        width: 800,
        height: 600,
        altText: null,
        caption: null,
        surroundingText: null,
        precedingText: null,
        followingText: null,
        isRenderable: true,
        manualLabel: false,
        manualDescription: false,
        embedding: null,
        createdAt: new Date("2026-02-01T00:00:00Z"),
        updatedAt: new Date("2026-02-01T00:00:00Z"),
        score: 0.9,
      },
      docScore: 0.8,
      matchContext,
    });

    expect(relevantScore).toBeGreaterThan(unrelatedScore);
  });

  it("groups same-family quarterly financial statements by period instead of flattening them", async () => {
    const q1Identity = makeVariantIdentity({
      familyKey: "finance:bank-abc",
      familyLabel: "Bank ABC · Financial Statements",
      variantKey: "finance:bank-abc:q1-2025",
      variantLabel: "Q1 2025",
      axisKind: "period",
      axisValue: "Q1 2025",
    });
    const q2Identity = makeVariantIdentity({
      familyKey: "finance:bank-abc",
      familyLabel: "Bank ABC · Financial Statements",
      variantKey: "finance:bank-abc:q2-2025",
      variantLabel: "Q2 2025",
      axisKind: "period",
      axisValue: "Q2 2025",
    });
    const q3Identity = makeVariantIdentity({
      familyKey: "finance:bank-abc",
      familyLabel: "Bank ABC · Financial Statements",
      variantKey: "finance:bank-abc:q3-2025",
      variantLabel: "Q3 2025",
      axisKind: "period",
      axisValue: "Q3 2025",
    });
    const q4Identity = makeVariantIdentity({
      familyKey: "finance:bank-abc",
      familyLabel: "Bank ABC · Financial Statements",
      variantKey: "finance:bank-abc:q4-2025",
      variantLabel: "Q4 2025",
      axisKind: "period",
      axisValue: "Q4 2025",
    });

    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([
      { documentId: "doc-q1", score: 0.95 },
      { documentId: "doc-q2", score: 0.94 },
      { documentId: "doc-q3", score: 0.93 },
      { documentId: "doc-q4", score: 0.92 },
    ]);
    mockChunkSearchResults([
      makeChunkHit({
        documentId: "doc-q1",
        documentName: "Bank ABC Q1",
        score: 0.95,
        chunk: {
          id: "chunk-q1",
          documentId: "doc-q1",
          sectionId: "section-q1",
          content: "Profit for Q1 2025 was 10.",
          metadata: {
            headingPath: "Financial Statements > Profit",
            section: "Profit",
            noteNumber: "24",
            noteTitle: "Profit",
          },
        },
      }),
      makeChunkHit({
        documentId: "doc-q2",
        documentName: "Bank ABC Q2",
        score: 0.94,
        chunk: {
          id: "chunk-q2",
          documentId: "doc-q2",
          sectionId: "section-q2",
          content: "Profit for Q2 2025 was 12.",
          metadata: {
            headingPath: "Financial Statements > Profit",
            section: "Profit",
            noteNumber: "24",
            noteTitle: "Profit",
          },
        },
      }),
      makeChunkHit({
        documentId: "doc-q3",
        documentName: "Bank ABC Q3",
        score: 0.93,
        chunk: {
          id: "chunk-q3",
          documentId: "doc-q3",
          sectionId: "section-q3",
          content: "Profit for Q3 2025 was 14.",
          metadata: {
            headingPath: "Financial Statements > Profit",
            section: "Profit",
            noteNumber: "24",
            noteTitle: "Profit",
          },
        },
      }),
      makeChunkHit({
        documentId: "doc-q4",
        documentName: "Bank ABC Q4",
        score: 0.92,
        chunk: {
          id: "chunk-q4",
          documentId: "doc-q4",
          sectionId: "section-q4",
          content: "Profit for Q4 2025 was 16.",
          metadata: {
            headingPath: "Financial Statements > Profit",
            section: "Profit",
            noteNumber: "24",
            noteTitle: "Profit",
          },
        },
      }),
    ]);
    vi.mocked(
      knowledgeRepository.getDocumentMetadataByIdsAcrossGroups,
    ).mockResolvedValue([
      makeDocumentMetadataRow({
        documentId: "doc-q1",
        name: "Bank ABC Financial Statements Q1 2025",
        identity: q1Identity,
      }),
      makeDocumentMetadataRow({
        documentId: "doc-q2",
        name: "Bank ABC Financial Statements Q2 2025",
        identity: q2Identity,
      }),
      makeDocumentMetadataRow({
        documentId: "doc-q3",
        name: "Bank ABC Financial Statements Q3 2025",
        identity: q3Identity,
      }),
      makeDocumentMetadataRow({
        documentId: "doc-q4",
        name: "Bank ABC Financial Statements Q4 2025",
        identity: q4Identity,
      }),
    ]);
    vi.mocked(knowledgeRepository.getSectionsByIds).mockResolvedValue([
      makeSectionRow({
        id: "section-q1",
        documentId: "doc-q1",
        heading: "Profit",
        headingPath: "Financial Statements > Profit",
        content: "Profit for Q1 2025 was 10.",
        noteNumber: "24",
        noteTitle: "Profit",
        pageStart: 10,
      }),
      makeSectionRow({
        id: "section-q2",
        documentId: "doc-q2",
        heading: "Profit",
        headingPath: "Financial Statements > Profit",
        content: "Profit for Q2 2025 was 12.",
        noteNumber: "24",
        noteTitle: "Profit",
        pageStart: 11,
      }),
      makeSectionRow({
        id: "section-q3",
        documentId: "doc-q3",
        heading: "Profit",
        headingPath: "Financial Statements > Profit",
        content: "Profit for Q3 2025 was 14.",
        noteNumber: "24",
        noteTitle: "Profit",
        pageStart: 12,
      }),
      makeSectionRow({
        id: "section-q4",
        documentId: "doc-q4",
        heading: "Profit",
        headingPath: "Financial Statements > Profit",
        content: "Profit for Q4 2025 was 16.",
        noteNumber: "24",
        noteTitle: "Profit",
        pageStart: 13,
      }),
    ]);
    vi.mocked(knowledgeRepository.getRelatedSections).mockResolvedValue([]);

    const envelope = await queryKnowledgeStructured(
      group,
      "what about profit in q1, q2, q3, q4 for bank abc",
      { tokens: 5000 },
    );

    expect(envelope.queryAnalysis.intent).toBe("compare");
    expect(envelope.comparisonGroups).toHaveLength(1);
    expect(envelope.comparisonGroups[0]?.axisKind).toBe("period");
    expect(
      envelope.comparisonGroups[0]?.variants.map(
        (variant) => variant.variantLabel,
      ),
    ).toEqual(["Q1 2025", "Q2 2025", "Q3 2025", "Q4 2025"]);

    const formatted = formatDocsAsText(
      group.name,
      envelope.docs,
      "what about profit in q1, q2, q3, q4 for bank abc",
    );
    expect(formatted).toContain("## Comparison");
    expect(formatted).toContain("Q1 2025");
    expect(formatted).toContain("Q4 2025");
  });

  it("groups versioned docs by version when headings are identical", async () => {
    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([
      { documentId: "doc-v1", score: 0.95 },
      { documentId: "doc-v2", score: 0.94 },
      { documentId: "doc-v3", score: 0.93 },
    ]);
    mockChunkSearchResults([
      makeChunkHit({
        documentId: "doc-v1",
        documentName: "Auth Guide v1",
        chunk: {
          id: "chunk-v1",
          documentId: "doc-v1",
          sectionId: "section-v1",
          content: "Authentication setup in v1 uses API keys.",
          metadata: {
            headingPath: "Guide > Authentication",
            section: "Authentication",
          },
        },
      }),
      makeChunkHit({
        documentId: "doc-v2",
        documentName: "Auth Guide v2",
        chunk: {
          id: "chunk-v2",
          documentId: "doc-v2",
          sectionId: "section-v2",
          content: "Authentication setup in v2 uses PAT tokens.",
          metadata: {
            headingPath: "Guide > Authentication",
            section: "Authentication",
          },
        },
      }),
      makeChunkHit({
        documentId: "doc-v3",
        documentName: "Auth Guide v3",
        chunk: {
          id: "chunk-v3",
          documentId: "doc-v3",
          sectionId: "section-v3",
          content: "Authentication setup in v3 uses OAuth.",
          metadata: {
            headingPath: "Guide > Authentication",
            section: "Authentication",
          },
        },
      }),
    ]);
    vi.mocked(
      knowledgeRepository.getDocumentMetadataByIdsAcrossGroups,
    ).mockResolvedValue([
      makeDocumentMetadataRow({
        documentId: "doc-v1",
        name: "Auth Guide v1",
        identity: makeVariantIdentity({
          familyKey: "docs:auth-guide",
          familyLabel: "Auth Guide",
          variantKey: "docs:auth-guide:v1",
          variantLabel: "v1",
          axisKind: "version",
          axisValue: "v1",
        }),
      }),
      makeDocumentMetadataRow({
        documentId: "doc-v2",
        name: "Auth Guide v2",
        identity: makeVariantIdentity({
          familyKey: "docs:auth-guide",
          familyLabel: "Auth Guide",
          variantKey: "docs:auth-guide:v2",
          variantLabel: "v2",
          axisKind: "version",
          axisValue: "v2",
        }),
      }),
      makeDocumentMetadataRow({
        documentId: "doc-v3",
        name: "Auth Guide v3",
        identity: makeVariantIdentity({
          familyKey: "docs:auth-guide",
          familyLabel: "Auth Guide",
          variantKey: "docs:auth-guide:v3",
          variantLabel: "v3",
          axisKind: "version",
          axisValue: "v3",
        }),
      }),
    ]);
    vi.mocked(knowledgeRepository.getSectionsByIds).mockResolvedValue([
      makeSectionRow({
        id: "section-v1",
        documentId: "doc-v1",
        heading: "Authentication",
        headingPath: "Guide > Authentication",
        content: "Authentication setup in v1 uses API keys.",
      }),
      makeSectionRow({
        id: "section-v2",
        documentId: "doc-v2",
        heading: "Authentication",
        headingPath: "Guide > Authentication",
        content: "Authentication setup in v2 uses PAT tokens.",
      }),
      makeSectionRow({
        id: "section-v3",
        documentId: "doc-v3",
        heading: "Authentication",
        headingPath: "Guide > Authentication",
        content: "Authentication setup in v3 uses OAuth.",
      }),
    ]);
    vi.mocked(knowledgeRepository.getRelatedSections).mockResolvedValue([]);

    const envelope = await queryKnowledgeStructured(
      group,
      "compare authentication setup in v1, v2, and v3",
      { tokens: 5000 },
    );

    expect(envelope.queryAnalysis.intent).toBe("compare");
    expect(envelope.comparisonGroups[0]?.axisKind).toBe("version");
    expect(
      envelope.comparisonGroups[0]?.variants.map(
        (variant) => variant.variantLabel,
      ),
    ).toEqual(["v1", "v2", "v3"]);
  });

  it("groups effective-dated regulations by effective date", async () => {
    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([
      { documentId: "doc-jan", score: 0.94 },
      { documentId: "doc-mar", score: 0.93 },
    ]);
    mockChunkSearchResults([
      makeChunkHit({
        documentId: "doc-jan",
        documentName: "Policy Effective 1 January 2025",
        chunk: {
          id: "chunk-jan",
          documentId: "doc-jan",
          sectionId: "section-jan",
          content: "Pasal 3 effective 1 January 2025 requires disclosure A.",
          metadata: {
            headingPath: "Policy > Pasal 3",
            section: "Pasal 3",
          },
        },
      }),
      makeChunkHit({
        documentId: "doc-mar",
        documentName: "Policy Effective 1 March 2025",
        chunk: {
          id: "chunk-mar",
          documentId: "doc-mar",
          sectionId: "section-mar",
          content: "Pasal 3 effective 1 March 2025 requires disclosure B.",
          metadata: {
            headingPath: "Policy > Pasal 3",
            section: "Pasal 3",
          },
        },
      }),
    ]);
    vi.mocked(
      knowledgeRepository.getDocumentMetadataByIdsAcrossGroups,
    ).mockResolvedValue([
      makeDocumentMetadataRow({
        documentId: "doc-jan",
        name: "Policy Effective 1 January 2025",
        identity: makeVariantIdentity({
          familyKey: "reg:policy-pasal-3",
          familyLabel: "Policy Pasal 3",
          variantKey: "reg:policy-pasal-3:jan-2025",
          variantLabel: "1 January 2025",
          axisKind: "effective_at",
          axisValue: "1 January 2025",
        }),
      }),
      makeDocumentMetadataRow({
        documentId: "doc-mar",
        name: "Policy Effective 1 March 2025",
        identity: makeVariantIdentity({
          familyKey: "reg:policy-pasal-3",
          familyLabel: "Policy Pasal 3",
          variantKey: "reg:policy-pasal-3:mar-2025",
          variantLabel: "1 March 2025",
          axisKind: "effective_at",
          axisValue: "1 March 2025",
        }),
      }),
    ]);
    vi.mocked(knowledgeRepository.getSectionsByIds).mockResolvedValue([
      makeSectionRow({
        id: "section-jan",
        documentId: "doc-jan",
        heading: "Pasal 3",
        headingPath: "Policy > Pasal 3",
        content: "Pasal 3 effective 1 January 2025 requires disclosure A.",
      }),
      makeSectionRow({
        id: "section-mar",
        documentId: "doc-mar",
        heading: "Pasal 3",
        headingPath: "Policy > Pasal 3",
        content: "Pasal 3 effective 1 March 2025 requires disclosure B.",
      }),
    ]);
    vi.mocked(knowledgeRepository.getRelatedSections).mockResolvedValue([]);

    const envelope = await queryKnowledgeStructured(
      group,
      "compare pasal 3 effective 1 january 2025 and 1 march 2025",
      { tokens: 5000 },
    );

    expect(envelope.queryAnalysis.intent).toBe("compare");
    expect(envelope.comparisonGroups[0]?.axisKind).toBe("effective_at");
    expect(
      envelope.comparisonGroups[0]?.variants.map(
        (variant) => variant.variantLabel,
      ),
    ).toEqual(["1 January 2025", "1 March 2025"]);
  });

  it("supports section-level period overrides inside a single document", async () => {
    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([
      { documentId: "doc-1", score: 0.95 },
    ]);
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([
      makeChunkHit({
        chunk: {
          id: "chunk-q1",
          sectionId: "section-q1",
          content: "Profit for Q1 2025 was 10.",
          metadata: {
            headingPath: "Notes > Profit",
            section: "Profit",
            noteNumber: "24",
            noteTitle: "Profit",
          },
        },
      }),
      makeChunkHit({
        chunk: {
          id: "chunk-q2",
          sectionId: "section-q2",
          content: "Profit for Q2 2025 was 12.",
          metadata: {
            headingPath: "Notes > Profit",
            section: "Profit",
            noteNumber: "24",
            noteTitle: "Profit",
          },
        },
        score: 0.89,
      }),
    ]);
    vi.mocked(
      knowledgeRepository.getDocumentMetadataByIdsAcrossGroups,
    ).mockResolvedValue([
      makeDocumentMetadataRow({
        documentId: "doc-1",
        name: "Bank ABC Consolidated Financial Statements",
        identity: makeVariantIdentity({
          familyKey: "finance:bank-abc",
          familyLabel: "Bank ABC · Financial Statements",
          variantKey: "finance:bank-abc:default",
          variantLabel: "Bank ABC",
          axisKind: "period",
          axisValue: "Q0 2025",
        }),
      }),
    ]);
    vi.mocked(knowledgeRepository.getSectionsByIds).mockResolvedValue([
      makeSectionRow({
        id: "section-q1",
        documentId: "doc-1",
        heading: "Profit",
        headingPath: "Notes > Profit",
        content: "Profit for Q1 2025 was 10.",
        noteNumber: "24",
        noteTitle: "Profit",
      }),
      makeSectionRow({
        id: "section-q2",
        documentId: "doc-1",
        heading: "Profit",
        headingPath: "Notes > Profit",
        content: "Profit for Q2 2025 was 12.",
        noteNumber: "24",
        noteTitle: "Profit",
      }),
    ]);
    vi.mocked(knowledgeRepository.getRelatedSections).mockResolvedValue([]);

    const envelope = await queryKnowledgeStructured(
      group,
      "compare q1 and q2 profit for bank abc",
      { tokens: 5000 },
    );

    expect(envelope.comparisonGroups).toHaveLength(1);
    expect(
      envelope.comparisonGroups[0]?.variants.map(
        (variant) => variant.variantLabel,
      ),
    ).toEqual(["Q1 2025", "Q2 2025"]);
  });

  it("does not force compare mode for heterogeneous documents", async () => {
    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([
      { documentId: "doc-auth", score: 0.95 },
      { documentId: "doc-tax", score: 0.94 },
    ]);
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([
      makeChunkHit({
        documentId: "doc-auth",
        documentName: "Authentication Guide",
        chunk: {
          id: "chunk-auth",
          documentId: "doc-auth",
          sectionId: "section-auth",
          content: "Authentication setup uses passkeys.",
          metadata: {
            headingPath: "Guide > Authentication",
            section: "Authentication",
          },
        },
      }),
      makeChunkHit({
        documentId: "doc-tax",
        documentName: "Tax Guide",
        chunk: {
          id: "chunk-tax",
          documentId: "doc-tax",
          sectionId: "section-tax",
          content: "Tax handling is defined elsewhere.",
          metadata: {
            headingPath: "Guide > Tax",
            section: "Tax",
          },
        },
      }),
    ]);
    vi.mocked(
      knowledgeRepository.getDocumentMetadataByIdsAcrossGroups,
    ).mockResolvedValue([
      makeDocumentMetadataRow({
        documentId: "doc-auth",
        name: "Authentication Guide",
        identity: makeVariantIdentity({
          familyKey: "guide:auth",
          familyLabel: "Authentication Guide",
          variantKey: "guide:auth:default",
          variantLabel: "Authentication Guide",
          axisKind: "version",
          axisValue: "v1",
        }),
      }),
      makeDocumentMetadataRow({
        documentId: "doc-tax",
        name: "Tax Guide",
        identity: makeVariantIdentity({
          familyKey: "guide:tax",
          familyLabel: "Tax Guide",
          variantKey: "guide:tax:default",
          variantLabel: "Tax Guide",
          axisKind: "version",
          axisValue: "v1",
        }),
      }),
    ]);
    vi.mocked(knowledgeRepository.getSectionsByIds).mockResolvedValue([
      makeSectionRow({
        id: "section-auth",
        documentId: "doc-auth",
        heading: "Authentication",
        headingPath: "Guide > Authentication",
        content: "Authentication setup uses passkeys.",
      }),
      makeSectionRow({
        id: "section-tax",
        documentId: "doc-tax",
        heading: "Tax",
        headingPath: "Guide > Tax",
        content: "Tax handling is defined elsewhere.",
      }),
    ]);
    vi.mocked(knowledgeRepository.getRelatedSections).mockResolvedValue([]);

    const envelope = await queryKnowledgeStructured(group, "auth setup", {
      tokens: 5000,
    });

    expect(envelope.queryAnalysis.intent).toBe("lookup");
    expect(envelope.comparisonGroups).toEqual([]);
    expect(
      formatDocsAsText(group.name, envelope.docs, "auth setup"),
    ).not.toContain("## Comparison");
  });
});
