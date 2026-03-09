import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  knowledgeRepository: {
    selectGroupById: vi.fn(),
    selectDocumentById: vi.fn(),
    selectGroupSources: vi.fn(),
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
}));

const { getSession } = await import("auth/server");
const { knowledgeRepository } = await import("lib/db/repository");
const { listDocumentVersions } = await import("lib/knowledge/versioning");
const { GET } = await import("./route");

function withParams(id: string, docId: string) {
  return {
    params: Promise.resolve({ id, docId }),
  } as {
    params: Promise<{ id: string; docId: string }>;
  };
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
        markdownContent: "# Draft",
        resolvedTitle: "Legal Draft",
        resolvedDescription: "Processed markdown",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
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
      new Request(
        "http://localhost/api/knowledge/group-1/documents/doc-1/preview",
      ) as any,
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      activeVersionId: "version-2",
      activeVersionNumber: 2,
      versions: [
        {
          id: "version-2",
          versionNumber: 2,
          isActive: true,
        },
      ],
      doc: {
        activeVersionId: "version-2",
        latestVersionNumber: 2,
      },
    });
  });
});
