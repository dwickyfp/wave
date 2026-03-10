import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  knowledgeRepository: {
    selectGroupById: vi.fn(),
    selectDocumentsByGroupScope: vi.fn(),
    selectDocumentsByGroupId: vi.fn(),
    selectDocumentByFingerprint: vi.fn(),
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

const { getSession } = await import("auth/server");
const { knowledgeRepository } = await import("lib/db/repository");
const { serverFileStorage } = await import("lib/file-storage");
const { enqueueIngestDocument } = await import("lib/knowledge/worker-client");
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
      user: { id: "user-1" },
    } as any);
    vi.mocked(knowledgeRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);
    vi.mocked(knowledgeRepository.selectDocumentsByGroupId).mockResolvedValue(
      [],
    );
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
});
