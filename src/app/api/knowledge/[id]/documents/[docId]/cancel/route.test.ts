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
    updateDocumentStatus: vi.fn(),
  },
}));

vi.mock("lib/knowledge/worker-client", () => ({
  cancelIngestDocument: vi.fn(),
}));

const { getSession } = await import("auth/server");
const { knowledgeRepository } = await import("lib/db/repository");
const { cancelIngestDocument } = await import("lib/knowledge/worker-client");
const { POST } = await import("./route");

function withParams(id: string, docId: string) {
  return {
    params: Promise.resolve({ id, docId }),
  } as {
    params: Promise<{ id: string; docId: string }>;
  };
}

describe("knowledge document cancel route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "user-1" },
    } as any);
    vi.mocked(knowledgeRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);
  });

  it("cancels a processing document and returns the updated document state", async () => {
    vi.mocked(knowledgeRepository.selectDocumentById).mockResolvedValue({
      id: "doc-1",
      groupId: "group-1",
      userId: "user-1",
      name: "Q4 Report",
      originalFilename: "q4-report.pdf",
      fileType: "pdf",
      status: "processing",
      processingProgress: 48,
      errorMessage: null,
      chunkCount: 0,
      tokenCount: 0,
      createdAt: new Date("2026-03-10T01:00:00.000Z"),
      updatedAt: new Date("2026-03-10T01:00:00.000Z"),
    } as any);
    vi.mocked(cancelIngestDocument).mockResolvedValue({
      removed: 1,
      active: 0,
    });

    const response = await POST(
      new Request(
        "http://localhost/api/knowledge/group-1/documents/doc-1/cancel",
        {
          method: "POST",
        },
      ) as any,
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(200);
    expect(knowledgeRepository.updateDocumentStatus).toHaveBeenCalledWith(
      "doc-1",
      "failed",
      {
        errorMessage: "Canceled by user",
      },
    );
    expect(cancelIngestDocument).toHaveBeenCalledWith("doc-1");
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      queueCancellation: {
        removed: 1,
        active: 0,
      },
      doc: {
        id: "doc-1",
        status: "failed",
        errorMessage: "Canceled by user",
        processingProgress: null,
      },
    });
  });

  it("rejects cancellation for documents that are not processing", async () => {
    vi.mocked(knowledgeRepository.selectDocumentById).mockResolvedValue({
      id: "doc-1",
      groupId: "group-1",
      userId: "user-1",
      status: "ready",
    } as any);

    const response = await POST(
      new Request(
        "http://localhost/api/knowledge/group-1/documents/doc-1/cancel",
        {
          method: "POST",
        },
      ) as any,
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(409);
    expect(knowledgeRepository.updateDocumentStatus).not.toHaveBeenCalled();
    expect(cancelIngestDocument).not.toHaveBeenCalled();
  });
});
