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
  createRollbackVersion: vi.fn(),
  isKnowledgeRollbackModelMismatchError: vi.fn(),
  isKnowledgeVersionConflictError: vi.fn(),
  markDocumentVersionFailed: vi.fn(),
}));

vi.mock("lib/knowledge/worker-client", () => ({
  enqueueRollbackDocumentVersion: vi.fn(),
}));

const { getSession } = await import("auth/server");
const { knowledgeRepository } = await import("lib/db/repository");
const {
  createRollbackVersion,
  isKnowledgeRollbackModelMismatchError,
  isKnowledgeVersionConflictError,
} = await import("lib/knowledge/versioning");
const { enqueueRollbackDocumentVersion } = await import(
  "lib/knowledge/worker-client"
);
const { POST } = await import("./route");

function withParams(id: string, docId: string, versionId: string) {
  return {
    params: Promise.resolve({ id, docId, versionId }),
  } as {
    params: Promise<{ id: string; docId: string; versionId: string }>;
  };
}

describe("knowledge rollback version route", () => {
  const rollbackSourceVersionId = "22222222-2222-4222-8222-222222222222";
  const activeVersionId = "33333333-3333-4333-8333-333333333333";

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
    vi.mocked(isKnowledgeRollbackModelMismatchError).mockReturnValue(false);
  });

  it("queues a rollback-derived latest version", async () => {
    vi.mocked(createRollbackVersion).mockResolvedValue({
      id: "version-4",
      versionNumber: 4,
    } as any);

    const response = await POST(
      new Request(
        `http://localhost/api/knowledge/group-1/documents/doc-1/versions/${rollbackSourceVersionId}/rollback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedActiveVersionId: activeVersionId,
          }),
        },
      ) as any,
      withParams("group-1", "doc-1", rollbackSourceVersionId),
    );

    expect(response.status).toBe(202);
    expect(createRollbackVersion).toHaveBeenCalledWith({
      documentId: "doc-1",
      actorUserId: "user-1",
      rollbackFromVersionId: rollbackSourceVersionId,
      expectedActiveVersionId: activeVersionId,
    });
    expect(enqueueRollbackDocumentVersion).toHaveBeenCalledWith({
      versionId: "version-4",
      expectedActiveVersionId: activeVersionId,
    });
  });

  it("returns 422 when the selected version uses a different embedding model", async () => {
    const mismatch = new Error("rollback_model_mismatch");
    vi.mocked(createRollbackVersion).mockRejectedValue(mismatch);
    vi.mocked(isKnowledgeRollbackModelMismatchError).mockReturnValue(true);

    const response = await POST(
      new Request(
        `http://localhost/api/knowledge/group-1/documents/doc-1/versions/${rollbackSourceVersionId}/rollback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedActiveVersionId: activeVersionId,
          }),
        },
      ) as any,
      withParams("group-1", "doc-1", rollbackSourceVersionId),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error:
        "Rollback is blocked because the selected version uses a different embedding model than the current knowledge group.",
    });
  });
});
