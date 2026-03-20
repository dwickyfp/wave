import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  knowledgeRepository: {
    selectGroupById: vi.fn(),
    selectDocumentById: vi.fn(),
    selectGroupSources: vi.fn(),
    getDocumentImages: vi.fn(),
    getDocumentImagesByVersion: vi.fn(),
  },
}));

const { getSession } = await import("auth/server");
const { knowledgeRepository } = await import("lib/db/repository");
const { GET } = await import("./route");

function withParams(id: string, docId: string) {
  return {
    params: Promise.resolve({ id, docId }),
  } as {
    params: Promise<{ id: string; docId: string }>;
  };
}

describe("knowledge document images route", () => {
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
    } as any);
  });

  it("returns active document images with stable asset urls", async () => {
    vi.mocked(knowledgeRepository.getDocumentImages).mockResolvedValue([
      {
        id: "image-1",
        documentId: "doc-1",
        groupId: "group-1",
        versionId: "version-1",
        kind: "embedded",
        ordinal: 1,
        marker: "CTX_IMAGE_1",
        label: "Tutorial screenshot",
        description: "Screenshot for the tutorial.",
        headingPath: "Tutorial > Step 1",
        stepHint: "Open the settings panel.",
        sourceUrl: "https://example.com/image-1.png",
        storagePath: null,
        mediaType: "image/png",
        pageNumber: 1,
        width: 800,
        height: 600,
        altText: null,
        caption: null,
        surroundingText: null,
        isRenderable: true,
        manualLabel: false,
        manualDescription: false,
        embedding: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as any);

    const response = await GET(
      new Request(
        "http://localhost/api/knowledge/group-1/documents/doc-1/images",
      ) as any,
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      images: [
        {
          id: "image-1",
          assetUrl:
            "/api/knowledge/group-1/documents/doc-1/images/image-1/asset?versionId=version-1",
        },
      ],
    });
  });
});
