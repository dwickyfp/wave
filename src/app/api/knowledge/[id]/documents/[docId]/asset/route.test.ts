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
    download: vi.fn(),
  },
}));

vi.mock("lib/knowledge/versioning", () => ({
  listDocumentVersions: vi.fn(),
}));

const { getSession } = await import("auth/server");
const { knowledgeRepository } = await import("lib/db/repository");
const { serverFileStorage } = await import("lib/file-storage");
const { listDocumentVersions } = await import("lib/knowledge/versioning");
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

describe("knowledge document asset route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      user: {
        id: "user-1",
      },
    } as any);
  });

  it("serves the document asset with inline headers", async () => {
    vi.mocked(knowledgeRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);
    vi.mocked(knowledgeRepository.selectDocumentById).mockResolvedValue({
      id: "doc-1",
      groupId: "group-1",
      storagePath: "knowledge/doc-1/report.pdf",
      originalFilename: "report.pdf",
      fileType: "pdf",
    } as any);
    vi.mocked(listDocumentVersions).mockResolvedValue([
      {
        id: "version-1",
        isActive: false,
      },
      {
        id: "version-2",
        isActive: true,
      },
    ] as any);
    vi.mocked(serverFileStorage.download).mockResolvedValue(
      Buffer.from("%PDF-test%"),
    );

    const response = await GET(
      withRequest(
        "http://localhost/api/knowledge/group-1/documents/doc-1/asset?versionId=version-1",
      ),
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain(
      "inline; filename*=",
    );
    await expect(response.text()).resolves.toBe("%PDF-test%");
  });

  it("returns 404 for an unknown version", async () => {
    vi.mocked(knowledgeRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);
    vi.mocked(knowledgeRepository.selectDocumentById).mockResolvedValue({
      id: "doc-1",
      groupId: "group-1",
      storagePath: "knowledge/doc-1/report.pdf",
      originalFilename: "report.pdf",
      fileType: "pdf",
    } as any);
    vi.mocked(listDocumentVersions).mockResolvedValue([
      {
        id: "version-2",
        isActive: true,
      },
    ] as any);

    const response = await GET(
      withRequest(
        "http://localhost/api/knowledge/group-1/documents/doc-1/asset?versionId=missing-version",
      ),
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(404);
  });
});
