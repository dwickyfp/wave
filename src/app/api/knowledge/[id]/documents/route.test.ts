import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  knowledgeRepository: {
    selectGroupById: vi.fn(),
    selectDocumentsByGroupScope: vi.fn(),
    selectDocumentsPageByGroupScope: vi.fn(),
    selectDocumentByFingerprint: vi.fn(),
    selectUrlDocumentBySourceUrl: vi.fn(),
    selectFileDocumentByNameAndSize: vi.fn(),
    insertDocument: vi.fn(),
    updateDocumentStatus: vi.fn(),
  },
}));

vi.mock("lib/file-storage", () => ({
  serverFileStorage: {
    upload: vi.fn(),
  },
}));

vi.mock("lib/knowledge/worker-client", () => ({
  enqueueIngestDocument: vi.fn(),
}));

vi.mock("lib/knowledge/ingest-pipeline", () => ({
  runIngestPipeline: vi.fn(),
}));

vi.mock("lib/knowledge/versioning", () => ({
  reconcileDocumentIngestFailure: vi.fn(),
}));

const { getSession } = await import("auth/server");
const { knowledgeRepository } = await import("lib/db/repository");
const { serverFileStorage } = await import("lib/file-storage");
const { enqueueIngestDocument } = await import("lib/knowledge/worker-client");
const { reconcileDocumentIngestFailure } = await import(
  "lib/knowledge/versioning"
);
const { POST } = await import("./route");

function withParams(id: string) {
  return {
    params: Promise.resolve({ id }),
  } as {
    params: Promise<{ id: string }>;
  };
}

describe("knowledge documents route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "user-1", role: "creator" },
    } as any);
    vi.mocked(knowledgeRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);
    vi.mocked(
      knowledgeRepository.selectUrlDocumentBySourceUrl,
    ).mockResolvedValue(null);
    vi.mocked(
      knowledgeRepository.selectFileDocumentByNameAndSize,
    ).mockResolvedValue(null);
    vi.mocked(
      knowledgeRepository.selectDocumentByFingerprint,
    ).mockResolvedValue(null);
  });

  it("returns the existing document for duplicate URLs instead of inserting a new one", async () => {
    vi.mocked(
      knowledgeRepository.selectDocumentByFingerprint,
    ).mockResolvedValue({
      id: "doc-1",
      groupId: "group-1",
      userId: "user-1",
      name: "example.com",
      originalFilename: "https://example.com/report",
      fileType: "url",
      sourceUrl: "https://example.com/report",
      fingerprint: "fingerprint-1",
      status: "processing",
      chunkCount: 0,
      tokenCount: 0,
      createdAt: new Date("2026-03-10T00:00:00.000Z"),
      updatedAt: new Date("2026-03-10T00:00:00.000Z"),
    } as any);

    const response = await POST(
      new Request("http://localhost/api/knowledge/group-1/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: "https://example.com/report" }),
      }) as any,
      withParams("group-1"),
    );

    expect(response.status).toBe(200);
    expect(knowledgeRepository.insertDocument).not.toHaveBeenCalled();
    expect(enqueueIngestDocument).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      id: "doc-1",
      duplicate: true,
    });
  });

  it("returns the existing document for duplicate files instead of uploading and inserting again", async () => {
    vi.mocked(
      knowledgeRepository.selectDocumentByFingerprint,
    ).mockResolvedValue({
      id: "doc-2",
      groupId: "group-1",
      userId: "user-1",
      name: "BBCA_Q4_2025",
      originalFilename: "BBCA_Q4_2025.pdf",
      fileType: "pdf",
      fileSize: 1234,
      fingerprint: "fingerprint-2",
      status: "ready",
      chunkCount: 10,
      tokenCount: 1000,
      createdAt: new Date("2026-03-10T00:00:00.000Z"),
      updatedAt: new Date("2026-03-10T00:00:00.000Z"),
    } as any);

    const form = new FormData();
    form.append(
      "file",
      new File(["same-pdf-content"], "BBCA_Q4_2025.pdf", {
        type: "application/pdf",
      }),
    );
    form.append("name", "BBCA_Q4_2025");

    const response = await POST(
      new Request("http://localhost/api/knowledge/group-1/documents", {
        method: "POST",
        body: form,
      }) as any,
      withParams("group-1"),
    );

    expect(response.status).toBe(200);
    expect(serverFileStorage.upload).not.toHaveBeenCalled();
    expect(knowledgeRepository.insertDocument).not.toHaveBeenCalled();
    expect(enqueueIngestDocument).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      id: "doc-2",
      duplicate: true,
    });
  });

  it("stores uploaded files in structured user and knowledge folders", async () => {
    vi.mocked(serverFileStorage.upload).mockResolvedValue({
      key: "uploads/user-content/user-1/knowledge/documents/group-1/uuid-BBCA_Q4_2025.pdf",
      sourceUrl: "https://example.com/uploads/report.pdf",
      metadata: {
        key: "uploads/user-content/user-1/knowledge/documents/group-1/uuid-BBCA_Q4_2025.pdf",
        filename: "uuid-BBCA_Q4_2025.pdf",
        contentType: "application/pdf",
        size: 16,
      },
    } as any);
    vi.mocked(knowledgeRepository.insertDocument).mockResolvedValue({
      id: "doc-structured",
      groupId: "group-1",
      userId: "user-1",
      name: "BBCA_Q4_2025",
      originalFilename: "BBCA_Q4_2025.pdf",
      fileType: "pdf",
      fileSize: 16,
      storagePath:
        "uploads/user-content/user-1/knowledge/documents/group-1/uuid-BBCA_Q4_2025.pdf",
      fingerprint: "fingerprint-structured",
      status: "pending",
      chunkCount: 0,
      tokenCount: 0,
      createdAt: new Date("2026-03-10T00:00:00.000Z"),
      updatedAt: new Date("2026-03-10T00:00:00.000Z"),
    } as any);
    vi.mocked(enqueueIngestDocument).mockResolvedValue(undefined);

    const form = new FormData();
    form.append(
      "file",
      new File(["new-pdf-content"], "BBCA_Q4_2025.pdf", {
        type: "application/pdf",
      }),
    );
    form.append("name", "BBCA_Q4_2025");

    const response = await POST(
      new Request("http://localhost/api/knowledge/group-1/documents", {
        method: "POST",
        body: form,
      }) as any,
      withParams("group-1"),
    );

    expect(response.status).toBe(201);
    expect(serverFileStorage.upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        filename:
          "user-content/user-1/knowledge/documents/group-1/BBCA_Q4_2025.pdf",
        contentType: "application/pdf",
      }),
    );
  });

  it("marks the document failed when enqueueing ingestion fails", async () => {
    vi.mocked(knowledgeRepository.insertDocument).mockResolvedValue({
      id: "doc-3",
      groupId: "group-1",
      userId: "user-1",
      name: "example.com",
      originalFilename: "https://example.com/report",
      fileType: "url",
      sourceUrl: "https://example.com/report",
      fingerprint: "fingerprint-3",
      status: "pending",
      chunkCount: 0,
      tokenCount: 0,
      createdAt: new Date("2026-03-10T00:00:00.000Z"),
      updatedAt: new Date("2026-03-10T00:00:00.000Z"),
    } as any);
    vi.mocked(enqueueIngestDocument).mockRejectedValue(
      new Error("redis unavailable"),
    );

    const response = await POST(
      new Request("http://localhost/api/knowledge/group-1/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: "https://example.com/report" }),
      }) as any,
      withParams("group-1"),
    );

    expect(response.status).toBe(503);
    expect(reconcileDocumentIngestFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-3",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("workers are unavailable"),
      documentId: "doc-3",
    });
  });
});
