import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  knowledgeRepository: {
    selectGroupById: vi.fn(),
    selectDocumentById: vi.fn(),
    selectGroupSources: vi.fn(),
    updateDocumentProcessing: vi.fn(),
    updateDocumentStatus: vi.fn(),
    updateDocumentMetadata: vi.fn(),
  },
}));

vi.mock("lib/knowledge/worker-client", () => ({
  enqueueIngestDocument: vi.fn(),
  cancelIngestDocument: vi.fn(),
}));

vi.mock("lib/knowledge/versioning", () => ({
  reconcileDocumentIngestFailure: vi.fn(),
}));

const { getSession } = await import("auth/server");
const { knowledgeRepository } = await import("lib/db/repository");
const { enqueueIngestDocument } = await import("lib/knowledge/worker-client");
const { reconcileDocumentIngestFailure } = await import(
  "lib/knowledge/versioning"
);
const { POST } = await import("./route");

function withParams(id: string, docId: string) {
  return {
    params: Promise.resolve({ id, docId }),
  } as {
    params: Promise<{ id: string; docId: string }>;
  };
}

describe("knowledge document route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "user-1" },
    } as any);
    vi.mocked(knowledgeRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);
    vi.mocked(knowledgeRepository.selectGroupSources).mockResolvedValue([]);
    vi.mocked(enqueueIngestDocument).mockResolvedValue(undefined);
  });

  it("reconciles the document state when re-ingest enqueueing fails", async () => {
    vi.mocked(knowledgeRepository.selectDocumentById).mockResolvedValue({
      id: "doc-1",
      groupId: "group-1",
      userId: "user-1",
      status: "ready",
      activeVersionId: "version-live",
    } as any);
    vi.mocked(enqueueIngestDocument).mockRejectedValue(
      new Error("redis unavailable"),
    );

    const response = await POST(
      new Request("http://localhost/api/knowledge/group-1/documents/doc-1", {
        method: "POST",
      }) as any,
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(503);
    expect(knowledgeRepository.updateDocumentProcessing).toHaveBeenCalledWith(
      "doc-1",
      {
        errorMessage: null,
        processingProgress: 0,
        processingState: { stage: "extracting" },
      },
    );
    expect(reconcileDocumentIngestFailure).toHaveBeenCalledWith({
      documentId: "doc-1",
      errorMessage: "Failed to enqueue ingest job: redis unavailable",
    });
    await expect(response.json()).resolves.toMatchObject({
      documentId: "doc-1",
      error: expect.stringContaining("workers are unavailable"),
    });
  });

  it("queues a re-ingest for documents without an active version", async () => {
    vi.mocked(knowledgeRepository.selectDocumentById).mockResolvedValue({
      id: "doc-2",
      groupId: "group-1",
      userId: "user-1",
      status: "failed",
      activeVersionId: null,
    } as any);

    const response = await POST(
      new Request("http://localhost/api/knowledge/group-1/documents/doc-2", {
        method: "POST",
      }) as any,
      withParams("group-1", "doc-2"),
    );

    expect(response.status).toBe(200);
    expect(knowledgeRepository.updateDocumentStatus).toHaveBeenCalledWith(
      "doc-2",
      "pending",
      {
        processingProgress: null,
        processingState: null,
      },
    );
    expect(enqueueIngestDocument).toHaveBeenCalledWith("doc-2", "group-1");
  });
});
