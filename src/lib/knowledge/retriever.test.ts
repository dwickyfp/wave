import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("ai", () => ({
  rerank: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  knowledgeRepository: {
    selectRetrievalScopes: vi.fn(),
    vectorSearch: vi.fn(),
    fullTextSearch: vi.fn(),
    searchDocumentMetadata: vi.fn(),
    vectorSearchDocumentMetadata: vi.fn(),
    fullTextSearchImages: vi.fn(),
    vectorSearchImages: vi.fn(),
    getDocumentImages: vi.fn(),
    getAdjacentChunks: vi.fn(),
    getDocumentMetadataByIdsAcrossGroups: vi.fn(),
    getSectionsByIds: vi.fn(),
    getRelatedSections: vi.fn(),
    getDocumentMarkdown: vi.fn(),
    insertUsageLog: vi.fn(),
  },
  settingsRepository: {
    getProviderByName: vi.fn(),
  },
}));

vi.mock("./embedder", () => ({
  embedSingleText: vi.fn(async () => [0.1, 0.2, 0.3]),
}));

const { queryKnowledgeAsDocs } = await import("./retriever");
const { knowledgeRepository } = await import("lib/db/repository");

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

describe("queryKnowledgeAsDocs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(knowledgeRepository.selectRetrievalScopes).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.fullTextSearch).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.searchDocumentMetadata).mockResolvedValue([]);
    vi.mocked(
      knowledgeRepository.vectorSearchDocumentMetadata,
    ).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.getAdjacentChunks).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.fullTextSearchImages).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.vectorSearchImages).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.getDocumentImages).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.getSectionsByIds).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.getRelatedSections).mockResolvedValue([]);
    vi.mocked(knowledgeRepository.getDocumentMarkdown).mockResolvedValue(null);
    vi.mocked(knowledgeRepository.insertUsageLog).mockResolvedValue(undefined);
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

    const docs = await queryKnowledgeAsDocs(group, "auth setup", {
      tokens: 5000,
    });

    expect(docs).toHaveLength(1);
    expect(docs[0]?.markdown).toContain(
      "### Guide > Authentication (Part 1/2)",
    );
    expect(docs[0]?.markdown).toContain("Parent context:");
    expect(docs[0]?.markdown).toContain("#### Next Part");
    expect(knowledgeRepository.getDocumentMarkdown).not.toHaveBeenCalled();
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

  it("falls back to full-doc retrieval for legacy documents without section graphs", async () => {
    vi.mocked(knowledgeRepository.vectorSearch).mockResolvedValue([
      makeChunkHit({ chunk: { sectionId: null } }),
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

  it("attaches matched images scoped to the returned documents", async () => {
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

  it("falls back to renderable doc images when hybrid image search misses", async () => {
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
});
