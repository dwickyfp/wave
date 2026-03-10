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
  getDocumentVersionContent: vi.fn(),
}));

const { getSession } = await import("auth/server");
const { knowledgeRepository } = await import("lib/db/repository");
const { getDocumentVersionContent } = await import("lib/knowledge/versioning");
const { GET } = await import("./route");

function withParams(id: string, docId: string, versionId: string) {
  return {
    params: Promise.resolve({ id, docId, versionId }),
  } as {
    params: Promise<{ id: string; docId: string; versionId: string }>;
  };
}

describe("knowledge document version content route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "user-1" },
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
  });

  it("returns raw markdown for the requested version", async () => {
    vi.mocked(getDocumentVersionContent).mockResolvedValue({
      versionId: "version-2",
      markdownContent: "# Version 2",
    });

    const response = await GET(
      new Request(
        "http://localhost/api/knowledge/group-1/documents/doc-1/versions/version-2/content",
      ) as any,
      withParams("group-1", "doc-1", "version-2"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      versionId: "version-2",
      markdownContent: "# Version 2",
    });
  });
});
