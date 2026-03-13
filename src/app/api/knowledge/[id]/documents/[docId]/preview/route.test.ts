import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  knowledgeRepository: {
    selectGroupById: vi.fn(),
    selectDocumentById: vi.fn(),
    selectGroupSources: vi.fn(),
    getDocumentImages: vi.fn(),
    getDocumentImagesByVersion: vi.fn(),
  },
}));

vi.mock("lib/file-storage", () => ({
  serverFileStorage: {
    getDownloadUrl: vi.fn(),
    getSourceUrl: vi.fn(),
    download: vi.fn(),
  },
}));

vi.mock("lib/knowledge/versioning", () => ({
  listDocumentVersions: vi.fn(),
  getDocumentVersionContent: vi.fn(),
}));

const { getSession } = await import("auth/server");
const { knowledgeRepository } = await import("lib/db/repository");
const { serverFileStorage } = await import("lib/file-storage");
const { getDocumentVersionContent, listDocumentVersions } = await import(
  "lib/knowledge/versioning"
);
const { GET } = await import("./route");

function withParams(id: string, docId: string) {
  return {
    params: Promise.resolve({ id, docId }),
  } as {
    params: Promise<{ id: string; docId: string }>;
  };
}

function withRequest(url: string) {
  return {
    nextUrl: new URL(url),
  } as any;
}

describe("knowledge document preview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      user: {
        id: "user-1",
      },
    } as any);
  });

  it("returns version metadata for a previewable document", async () => {
    vi.mocked(knowledgeRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);
    vi.mocked(knowledgeRepository.selectDocumentById).mockResolvedValue({
      id: "doc-1",
      groupId: "group-1",
      userId: "user-1",
      name: "Legal Draft",
      description: "Processed markdown",
      originalFilename: "draft.txt",
      fileType: "txt",
      fileSize: 128,
      storagePath: null,
      sourceUrl: "https://example.com/draft",
      markdownContent: "# Draft",
      activeVersionId: "version-2",
      latestVersionNumber: 2,
    } as any);
    vi.mocked(listDocumentVersions).mockResolvedValue([
      {
        id: "version-2",
        versionNumber: 2,
        status: "ready",
        changeType: "edit",
        isActive: true,
        resolvedTitle: "Legal Draft",
        resolvedDescription: "Processed markdown",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        embeddingTokenCount: 42,
        chunkCount: 3,
        tokenCount: 120,
        sourceVersionId: "version-1",
        createdByUserId: "user-1",
        createdAt: new Date("2026-03-09T08:00:00.000Z"),
        updatedAt: new Date("2026-03-09T08:00:00.000Z"),
        canRollback: false,
        rollbackBlockedReason: null,
      },
    ]);
    vi.mocked(knowledgeRepository.getDocumentImagesByVersion).mockResolvedValue(
      [
        {
          id: "image-1",
          documentId: "doc-1",
          groupId: "group-1",
          versionId: "version-2",
          kind: "embedded",
          ordinal: 1,
          marker: "CTX_IMAGE_1",
          label: "Legal clause screenshot",
          description: "Screenshot for the legal clause walkthrough.",
          headingPath: "Draft > Clause review",
          stepHint: "Review the legal clause screenshot.",
          sourceUrl: "https://example.com/image-1.png",
          storagePath: "knowledge-images/doc-1/version-2/image-1.png",
          mediaType: "image/png",
          pageNumber: 1,
          width: 640,
          height: 480,
          altText: null,
          caption: null,
          surroundingText: null,
          isRenderable: true,
          manualLabel: false,
          manualDescription: false,
          embedding: null,
          createdAt: new Date("2026-03-09T08:00:00.000Z"),
          updatedAt: new Date("2026-03-09T08:00:00.000Z"),
        },
      ] as any,
    );

    const response = await GET(
      withRequest(
        "http://localhost/api/knowledge/group-1/documents/doc-1/preview",
      ),
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      activeVersionId: "version-2",
      activeVersionNumber: 2,
      content: "# Draft",
      versions: [
        {
          id: "version-2",
          versionNumber: 2,
          isActive: true,
        },
      ],
      images: [
        {
          id: "image-1",
          label: "Legal clause screenshot",
          assetUrl:
            "/api/knowledge/group-1/documents/doc-1/images/image-1/asset?versionId=version-2",
        },
      ],
      doc: {
        activeVersionId: "version-2",
        latestVersionNumber: 2,
      },
      markdownAvailable: true,
    });
  });

  it("returns version-aware asset metadata for historical previews", async () => {
    vi.mocked(knowledgeRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);
    vi.mocked(knowledgeRepository.selectDocumentById).mockResolvedValue({
      id: "doc-1",
      groupId: "group-1",
      userId: "user-1",
      name: "Annual Report",
      description: "Processed markdown",
      originalFilename: "report.pdf",
      fileType: "pdf",
      fileSize: 2048,
      storagePath: "knowledge/doc-1/report.pdf",
      sourceUrl: null,
      markdownContent: "# Active report",
      activeVersionId: "version-2",
      latestVersionNumber: 2,
    } as any);
    vi.mocked(listDocumentVersions).mockResolvedValue([
      {
        id: "version-1",
        versionNumber: 1,
        status: "ready",
        changeType: "initial_ingest",
        isActive: false,
        resolvedTitle: "Annual Report",
        resolvedDescription: "Archived source",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        embeddingTokenCount: 42,
        chunkCount: 3,
        tokenCount: 120,
        sourceVersionId: null,
        createdByUserId: "user-1",
        createdAt: new Date("2026-03-08T08:00:00.000Z"),
        updatedAt: new Date("2026-03-08T08:00:00.000Z"),
        canRollback: true,
        rollbackBlockedReason: null,
      },
      {
        id: "version-2",
        versionNumber: 2,
        status: "ready",
        changeType: "edit",
        isActive: true,
        resolvedTitle: "Annual Report",
        resolvedDescription: "Current source",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        embeddingTokenCount: 42,
        chunkCount: 3,
        tokenCount: 120,
        sourceVersionId: "version-1",
        createdByUserId: "user-1",
        createdAt: new Date("2026-03-09T08:00:00.000Z"),
        updatedAt: new Date("2026-03-09T08:00:00.000Z"),
        canRollback: false,
        rollbackBlockedReason: null,
      },
    ]);
    vi.mocked(getDocumentVersionContent).mockResolvedValue({
      documentId: "doc-1",
      versionId: "version-1",
      markdownContent: "# Historical report",
      title: "Annual Report",
      description: "Archived source",
      createdAt: new Date("2026-03-08T08:00:00.000Z"),
      updatedAt: new Date("2026-03-08T08:00:00.000Z"),
    } as any);
    vi.mocked(knowledgeRepository.getDocumentImagesByVersion).mockResolvedValue(
      [],
    );
    vi.mocked(knowledgeRepository.getDocumentImages).mockResolvedValue([]);
    vi.mocked(serverFileStorage.getDownloadUrl!).mockResolvedValue(
      "https://storage.example/report.pdf",
    );

    const response = await GET(
      withRequest(
        "http://localhost/api/knowledge/group-1/documents/doc-1/preview?versionId=version-1",
      ),
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      requestedVersionId: "version-1",
      resolvedVersionId: "version-1",
      binaryMatchesRequestedVersion: false,
      fallbackWarning: expect.stringContaining("historical file snapshots"),
      assetUrl:
        "/api/knowledge/group-1/documents/doc-1/asset?versionId=version-1",
      content: "# Historical report",
    });
  });

  it("returns 404 when the requested version does not exist", async () => {
    vi.mocked(knowledgeRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);
    vi.mocked(knowledgeRepository.selectDocumentById).mockResolvedValue({
      id: "doc-1",
      groupId: "group-1",
      userId: "user-1",
      name: "Annual Report",
      description: "Processed markdown",
      originalFilename: "report.pdf",
      fileType: "pdf",
      fileSize: 2048,
      storagePath: "knowledge/doc-1/report.pdf",
      sourceUrl: null,
      markdownContent: "# Active report",
      activeVersionId: "version-2",
      latestVersionNumber: 2,
    } as any);
    vi.mocked(listDocumentVersions).mockResolvedValue([
      {
        id: "version-2",
        versionNumber: 2,
        status: "ready",
        changeType: "edit",
        isActive: true,
        resolvedTitle: "Annual Report",
        resolvedDescription: "Current source",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        embeddingTokenCount: 42,
        chunkCount: 3,
        tokenCount: 120,
        sourceVersionId: "version-1",
        createdByUserId: "user-1",
        createdAt: new Date("2026-03-09T08:00:00.000Z"),
        updatedAt: new Date("2026-03-09T08:00:00.000Z"),
        canRollback: false,
        rollbackBlockedReason: null,
      },
    ]);

    const response = await GET(
      withRequest(
        "http://localhost/api/knowledge/group-1/documents/doc-1/preview?versionId=missing-version",
      ),
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(404);
  });
});
