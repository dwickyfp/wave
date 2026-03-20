import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  knowledgeRepository: {
    selectGroupById: vi.fn(),
    selectDocumentById: vi.fn(),
    getDocumentImages: vi.fn(),
  },
}));

vi.mock("lib/knowledge/versioning", () => ({
  createImageAnnotationEditVersion: vi.fn(),
  isKnowledgeVersionConflictError: vi.fn(),
  markDocumentVersionFailed: vi.fn(),
}));

vi.mock("lib/knowledge/worker-client", () => ({
  enqueueMaterializeDocumentVersion: vi.fn(),
}));

const { getSession } = await import("auth/server");
const { knowledgeRepository } = await import("lib/db/repository");
const { createImageAnnotationEditVersion, isKnowledgeVersionConflictError } =
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

describe("knowledge image annotations route", () => {
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
      markdownContent:
        "# Tutorial\n\n[image 1]\nLabel : Old label\nDescription : Old description\n",
    } as any);
    vi.mocked(knowledgeRepository.getDocumentImages).mockResolvedValue([
      {
        id: "11111111-1111-4111-8111-111111111111",
        documentId: "doc-1",
        groupId: "group-1",
        versionId: "version-1",
        kind: "embedded",
        ordinal: 1,
        marker: "CTX_IMAGE_1",
        label: "Old label",
        description: "Old description",
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
    vi.mocked(isKnowledgeVersionConflictError).mockReturnValue(false);
  });

  it("queues a versioned image annotation edit", async () => {
    vi.mocked(createImageAnnotationEditVersion).mockResolvedValue({
      id: "version-2",
    } as any);

    const response = await POST(
      new Request(
        "http://localhost/api/knowledge/group-1/documents/doc-1/images/annotations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedActiveVersionId: "22222222-2222-4222-8222-222222222222",
            images: [
              {
                imageId: "11111111-1111-4111-8111-111111111111",
                label: "Updated label",
                description: "Updated description",
                stepHint: "Click the settings panel.",
              },
            ],
          }),
        },
      ) as any,
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(202);
    expect(createImageAnnotationEditVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-1",
        actorUserId: "user-1",
        imageOverrides: [
          {
            imageId: "11111111-1111-4111-8111-111111111111",
            label: "Updated label",
            description: "Updated description",
            stepHint: "Click the settings panel.",
          },
        ],
      }),
    );
    expect(enqueueMaterializeDocumentVersion).toHaveBeenCalledWith({
      versionId: "version-2",
      expectedActiveVersionId: "22222222-2222-4222-8222-222222222222",
    });
  });
});
