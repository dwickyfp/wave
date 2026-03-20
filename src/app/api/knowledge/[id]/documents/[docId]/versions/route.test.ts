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

vi.mock("lib/knowledge/versioning", () => ({
  createMarkdownEditVersion: vi.fn(),
  isKnowledgeVersionConflictError: vi.fn(),
  markDocumentVersionFailed: vi.fn(),
}));

vi.mock("lib/knowledge/worker-client", () => ({
  enqueueMaterializeDocumentVersion: vi.fn(),
}));

const { getSession } = await import("auth/server");
const { knowledgeRepository } = await import("lib/db/repository");
const { createMarkdownEditVersion, isKnowledgeVersionConflictError } =
  await import("lib/knowledge/versioning");
const { enqueueMaterializeDocumentVersion } = await import(
  "lib/knowledge/worker-client"
);
const { POST } = await import("./route");

function withParams(id: string, docId: string) {
  return {
    params: Promise.resolve({ id, docId }),
  } as {
    params: Promise<{ id: string; docId: string }>;
  };
}

describe("knowledge document versions route", () => {
  const activeVersionId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      user: {
        id: "user-1",
      },
    } as any);
    vi.mocked(knowledgeRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);
    vi.mocked(knowledgeRepository.selectDocumentById).mockResolvedValue({
      id: "doc-1",
      groupId: "group-1",
      userId: "user-1",
    } as any);
    vi.mocked(isKnowledgeVersionConflictError).mockReturnValue(false);
  });

  it("queues a markdown edit version", async () => {
    vi.mocked(createMarkdownEditVersion).mockResolvedValue({
      id: "version-3",
      versionNumber: 3,
    } as any);

    const response = await POST(
      new Request(
        "http://localhost/api/knowledge/group-1/documents/doc-1/versions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            markdownContent: "# Updated",
            expectedActiveVersionId: activeVersionId,
          }),
        },
      ) as any,
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(202);
    expect(createMarkdownEditVersion).toHaveBeenCalledWith({
      documentId: "doc-1",
      actorUserId: "user-1",
      markdownContent: "# Updated",
      expectedActiveVersionId: activeVersionId,
    });
    expect(enqueueMaterializeDocumentVersion).toHaveBeenCalledWith({
      versionId: "version-3",
      expectedActiveVersionId: activeVersionId,
    });
  });

  it("returns 409 when the active version changed", async () => {
    const conflict = new Error("version_conflict");
    vi.mocked(createMarkdownEditVersion).mockRejectedValue(conflict);
    vi.mocked(isKnowledgeVersionConflictError).mockReturnValue(true);

    const response = await POST(
      new Request(
        "http://localhost/api/knowledge/group-1/documents/doc-1/versions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            markdownContent: "# Updated",
            expectedActiveVersionId: activeVersionId,
          }),
        },
      ) as any,
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Document version changed. Refresh and try again.",
    });
  });
});
