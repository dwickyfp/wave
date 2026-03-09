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
  getDocumentHistory: vi.fn(),
}));

const { getSession } = await import("auth/server");
const { knowledgeRepository } = await import("lib/db/repository");
const { getDocumentHistory } = await import("lib/knowledge/versioning");
const { GET } = await import("./route");

function withParams(id: string, docId: string) {
  return {
    params: Promise.resolve({ id, docId }),
  } as {
    params: Promise<{ id: string; docId: string }>;
  };
}

describe("knowledge document history route", () => {
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
  });

  it("returns ordered history events", async () => {
    vi.mocked(getDocumentHistory).mockResolvedValue([
      {
        id: "event-1",
        documentId: "doc-1",
        eventType: "edited",
        toVersionNumber: 3,
      },
    ] as any);

    const response = await GET(
      new Request(
        "http://localhost/api/knowledge/group-1/documents/doc-1/history",
      ) as any,
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      history: [
        {
          id: "event-1",
          documentId: "doc-1",
          eventType: "edited",
          toVersionNumber: 3,
        },
      ],
    });
  });
});
