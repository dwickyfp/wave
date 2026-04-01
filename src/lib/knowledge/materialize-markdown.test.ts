import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  generateUUIDMock,
  chunkKnowledgeSectionsMock,
  enrichChunksWithContextMock,
  detectChunkLanguageMock,
  resolveContentKindMock,
  buildDocumentImageEmbeddingTextMock,
  buildKnowledgeBaseTitleMock,
  buildKnowledgeDisplayContextMock,
  buildKnowledgeLocationLabelMock,
  buildKnowledgeTopicLabelMock,
  buildKnowledgeVariantLabelMock,
  buildDocumentMetadataEmbeddingTextMock,
  buildDocumentCanonicalTitleMock,
  deriveKnowledgeTemporalHintsMock,
  extractAutoDocumentMetadataMock,
  generateDocumentMetadataMock,
  buildEntityEmbeddingTextMock,
  extractKnowledgeEntitiesMock,
  embedSingleTextWithUsageMock,
  embedTextsWithUsageMock,
  normalizeStructuredMarkdownMock,
  buildKnowledgeSectionGraphMock,
} = vi.hoisted(() => ({
  generateUUIDMock: vi.fn(),
  chunkKnowledgeSectionsMock: vi.fn(),
  enrichChunksWithContextMock: vi.fn(),
  detectChunkLanguageMock: vi.fn(),
  resolveContentKindMock: vi.fn(),
  buildDocumentImageEmbeddingTextMock: vi.fn(),
  buildKnowledgeBaseTitleMock: vi.fn(),
  buildKnowledgeDisplayContextMock: vi.fn(),
  buildKnowledgeLocationLabelMock: vi.fn(),
  buildKnowledgeTopicLabelMock: vi.fn(),
  buildKnowledgeVariantLabelMock: vi.fn(),
  buildDocumentMetadataEmbeddingTextMock: vi.fn(),
  buildDocumentCanonicalTitleMock: vi.fn(),
  deriveKnowledgeTemporalHintsMock: vi.fn(),
  extractAutoDocumentMetadataMock: vi.fn(),
  generateDocumentMetadataMock: vi.fn(),
  buildEntityEmbeddingTextMock: vi.fn(),
  extractKnowledgeEntitiesMock: vi.fn(),
  embedSingleTextWithUsageMock: vi.fn(),
  embedTextsWithUsageMock: vi.fn(),
  normalizeStructuredMarkdownMock: vi.fn(),
  buildKnowledgeSectionGraphMock: vi.fn(),
}));

vi.mock("lib/utils", () => ({
  generateUUID: generateUUIDMock,
}));

vi.mock("./chunker", () => ({
  chunkKnowledgeSections: chunkKnowledgeSectionsMock,
}));

vi.mock("./context-enricher", () => ({
  enrichChunksWithContext: enrichChunksWithContextMock,
}));

vi.mock("./content-routing", () => ({
  detectChunkLanguage: detectChunkLanguageMock,
  resolveContentKind: resolveContentKindMock,
}));

vi.mock("./document-images", () => ({
  buildDocumentImageEmbeddingText: buildDocumentImageEmbeddingTextMock,
}));

vi.mock("./document-metadata", () => ({
  buildKnowledgeBaseTitle: buildKnowledgeBaseTitleMock,
  buildKnowledgeDisplayContext: buildKnowledgeDisplayContextMock,
  buildKnowledgeLocationLabel: buildKnowledgeLocationLabelMock,
  buildKnowledgeTopicLabel: buildKnowledgeTopicLabelMock,
  buildKnowledgeVariantLabel: buildKnowledgeVariantLabelMock,
  buildDocumentMetadataEmbeddingText: buildDocumentMetadataEmbeddingTextMock,
  buildDocumentCanonicalTitle: buildDocumentCanonicalTitleMock,
  deriveKnowledgeTemporalHints: deriveKnowledgeTemporalHintsMock,
  extractAutoDocumentMetadata: extractAutoDocumentMetadataMock,
  generateDocumentMetadata: generateDocumentMetadataMock,
}));

vi.mock("./entities", () => ({
  buildEntityEmbeddingText: buildEntityEmbeddingTextMock,
  extractKnowledgeEntities: extractKnowledgeEntitiesMock,
}));

vi.mock("./embedder", () => ({
  embedSingleTextWithUsage: embedSingleTextWithUsageMock,
  embedTextsWithUsage: embedTextsWithUsageMock,
}));

vi.mock("./markdown-structurer", () => ({
  normalizeStructuredMarkdown: normalizeStructuredMarkdownMock,
}));

vi.mock("./section-graph", () => ({
  buildKnowledgeSectionGraph: buildKnowledgeSectionGraphMock,
  SECTION_GRAPH_VERSION: 1,
}));

const { materializeDocumentMarkdown } = await import("./materialize-markdown");

describe("materialize-markdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    let uuidCounter = 0;
    generateUUIDMock.mockImplementation(() => `generated-${++uuidCounter}`);
    normalizeStructuredMarkdownMock.mockImplementation(
      (markdown: string) => markdown,
    );
    extractAutoDocumentMetadataMock.mockReturnValue({
      title: "Bank ABC Q4 2025",
      description: null,
    });
    generateDocumentMetadataMock.mockResolvedValue({
      title: "Bank ABC Q4 2025",
      description: null,
    });
    buildDocumentCanonicalTitleMock.mockReturnValue("Bank ABC Q4 2025");
    deriveKnowledgeTemporalHintsMock.mockReturnValue({
      effectiveAt: "2025-12-31",
    });
    buildKnowledgeBaseTitleMock.mockReturnValue("Bank ABC");
    buildKnowledgeDisplayContextMock.mockImplementation(
      (value: Record<string, unknown>) => value,
    );
    buildKnowledgeVariantLabelMock.mockReturnValue("Q4 2025");
    buildKnowledgeTopicLabelMock.mockReturnValue("Profit");
    buildKnowledgeLocationLabelMock.mockReturnValue("Page 63");
    buildDocumentMetadataEmbeddingTextMock.mockReturnValue("");
    resolveContentKindMock.mockReturnValue("document");
    detectChunkLanguageMock.mockReturnValue("en");
    buildDocumentImageEmbeddingTextMock.mockReturnValue("");
    extractKnowledgeEntitiesMock.mockReturnValue([]);
    buildEntityEmbeddingTextMock.mockReturnValue("");
    embedSingleTextWithUsageMock.mockResolvedValue({
      embedding: [0.01, 0.02],
      usageTokens: 1,
    });

    buildKnowledgeSectionGraphMock.mockReturnValue([
      {
        id: "section-1",
        heading: "Profit",
        headingPath: "Bank ABC > Profit",
        level: 1,
        partIndex: 0,
        partCount: 1,
        content: "Profit before tax",
        summary: "Profit summary",
        parentSectionId: null,
        canonicalTitle: "Bank ABC Q4 2025",
        pageStart: 63,
        pageEnd: 63,
        noteNumber: null,
        noteTitle: null,
        noteSubsection: null,
        sourcePath: "/reports/bank-abc-q4-2025.pdf",
        libraryId: null,
        libraryVersion: null,
      },
    ]);

    const chunkMetadata = {
      headingPath: "Bank ABC > Profit",
      sectionTitle: "Profit",
      pageStart: 63,
      pageEnd: 63,
      documentContext: {
        documentId: "doc-1",
        documentName: "Bank ABC Q4 2025",
        canonicalTitle: "Bank ABC Q4 2025",
        baseTitle: "Bank ABC",
      },
      sourceContext: {
        libraryId: null,
        libraryVersion: null,
        sourcePath: "/reports/bank-abc-q4-2025.pdf",
        sheetName: null,
        sourceGroupName: "Reports",
      },
      display: {
        documentLabel: "Bank ABC Q4 2025",
        variantLabel: "Q4 2025",
        topicLabel: "Profit",
        locationLabel: "Page 63",
      },
      temporalHints: {
        effectiveAt: "2025-12-31",
      },
    };

    chunkKnowledgeSectionsMock.mockReturnValue([
      {
        sectionId: "section-1",
        content: "Profit before tax",
        chunkIndex: 0,
        tokenCount: 12,
        metadata: chunkMetadata,
      },
    ]);

    enrichChunksWithContextMock.mockResolvedValue([
      {
        sectionId: "section-1",
        content: "Profit before tax",
        chunkIndex: 0,
        tokenCount: 12,
        metadata: chunkMetadata,
        contextSummary: "Profit context",
        embeddingText: "Profit context\nProfit before tax",
      },
    ]);
  });

  it("keeps materialization running when one chunk embedding pass fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let embedCall = 0;
    embedTextsWithUsageMock.mockImplementation(async () => {
      embedCall += 1;
      switch (embedCall) {
        case 1:
          return {
            embeddings: [[0.1, 0.1]],
            usageTokens: 10,
          };
        case 2:
          throw new Error("legacy embedding failure");
        case 3:
          return {
            embeddings: [[0.2, 0.2]],
            usageTokens: 20,
          };
        case 4:
          return {
            embeddings: [[0.3, 0.3]],
            usageTokens: 30,
          };
        case 5:
          return {
            embeddings: [[0.4, 0.4]],
            usageTokens: 40,
          };
        case 6:
          return {
            embeddings: [[0.5, 0.5]],
            usageTokens: 50,
          };
        default:
          return {
            embeddings: [[0.9, 0.9]],
            usageTokens: 0,
          };
      }
    });

    try {
      const result = await materializeDocumentMarkdown({
        documentId: "doc-1",
        groupId: "group-1",
        documentTitle: "Bank ABC Q4 2025",
        doc: {
          id: "doc-1",
          groupId: "group-1",
          userId: "user-1",
          name: "Bank ABC Q4 2025",
          description: null,
          descriptionManual: false,
          titleManual: false,
          originalFilename: "bank-abc-q4-2025.pdf",
          fileType: "pdf",
          status: "processing",
          chunkCount: 0,
          tokenCount: 0,
          embeddingTokenCount: 0,
          metadata: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
        group: {
          id: "group-1",
          name: "Reports",
          userId: "user-1",
          visibility: "private",
          purpose: "default",
          isSystemManaged: false,
          embeddingModel: "text-embedding-3-small",
          embeddingProvider: "openai",
          parseMode: "always",
          parseRepairPolicy: "section-safe-reorder",
          contextMode: "deterministic",
          imageMode: "off",
          lazyRefinementEnabled: false,
          retrievalThreshold: 0.3,
          mcpEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
        markdown: "# Profit\n\nProfit before tax",
        pages: [
          {
            pageNumber: 63,
            rawText: "Profit before tax",
            normalizedText: "Profit before tax",
            markdown: "Profit before tax",
            fingerprint: "page-63",
            qualityScore: 0.4,
            extractionMode: "refined",
            repairReason: null,
          },
        ],
      });

      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0]?.embedding).toEqual([0.2, 0.2]);
      expect(result.chunks[0]?.contentEmbedding).toEqual([0.2, 0.2]);
      expect(result.chunks[0]?.contextEmbedding).toEqual([0.3, 0.3]);
      expect(result.chunks[0]?.identityEmbedding).toEqual([0.4, 0.4]);
      expect(result.chunks[0]?.entityEmbedding).toEqual([0.5, 0.5]);
      expect(result.embeddingUsage.chunkTokens).toBe(140);
      expect(
        (result.metadata.embeddingWarnings as Array<{ stage: string }>)[0],
      ).toMatchObject({
        stage: "legacy_chunk",
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("fails materialization when no usable chunk embedding remains", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let embedCall = 0;
    embedTextsWithUsageMock.mockImplementation(async () => {
      embedCall += 1;
      switch (embedCall) {
        case 1:
          return {
            embeddings: [[0.1, 0.1]],
            usageTokens: 10,
          };
        case 2:
        case 3:
        case 4:
        case 5:
        case 6:
          throw new Error(`chunk embedding failure ${embedCall}`);
        default:
          return {
            embeddings: [],
            usageTokens: 0,
          };
      }
    });

    try {
      await expect(
        materializeDocumentMarkdown({
          documentId: "doc-1",
          groupId: "group-1",
          documentTitle: "Bank ABC Q4 2025",
          doc: {
            id: "doc-1",
            groupId: "group-1",
            userId: "user-1",
            name: "Bank ABC Q4 2025",
            description: null,
            descriptionManual: false,
            titleManual: false,
            originalFilename: "bank-abc-q4-2025.pdf",
            fileType: "pdf",
            status: "processing",
            chunkCount: 0,
            tokenCount: 0,
            embeddingTokenCount: 0,
            metadata: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
          group: {
            id: "group-1",
            name: "Reports",
            userId: "user-1",
            visibility: "private",
            purpose: "default",
            isSystemManaged: false,
            embeddingModel: "text-embedding-3-small",
            embeddingProvider: "openai",
            parseMode: "always",
            parseRepairPolicy: "section-safe-reorder",
            contextMode: "deterministic",
            imageMode: "off",
            lazyRefinementEnabled: false,
            retrievalThreshold: 0.3,
            mcpEnabled: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
          markdown: "# Profit\n\nProfit before tax",
          pages: [
            {
              pageNumber: 63,
              rawText: "Profit before tax",
              normalizedText: "Profit before tax",
              markdown: "Profit before tax",
              fingerprint: "page-63",
              qualityScore: 0.4,
              extractionMode: "refined",
              repairReason: null,
            },
          ],
        }),
      ).rejects.toThrow(/Chunk embeddings unavailable/);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
