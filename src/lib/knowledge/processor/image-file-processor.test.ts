import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createContextImageMarkerMock, generateContextImageArtifactsMock } =
  vi.hoisted(() => ({
    createContextImageMarkerMock: vi.fn(),
    generateContextImageArtifactsMock: vi.fn(),
  }));

vi.mock("./image-markdown", () => ({
  createContextImageMarker: createContextImageMarkerMock,
  generateContextImageArtifacts: generateContextImageArtifactsMock,
}));

const { processImageFile } = await import("./image-file-processor");

describe("image-file-processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createContextImageMarkerMock.mockReturnValue("CTX_IMAGE_1");
    generateContextImageArtifactsMock.mockResolvedValue([
      {
        kind: "embedded",
        marker: "CTX_IMAGE_1",
        index: 1,
        label: "Invoice scan",
        description: "Scanned invoice with totals and due date.",
        ocrText: "Invoice #1001",
      },
    ]);
  });

  it("always runs required caption-plus-ocr image analysis for standalone images", async () => {
    const buffer = Buffer.from("fake-image");
    const processed = await processImageFile("png", buffer, {
      documentTitle: "Invoice Upload",
      imageAnalysis: {
        provider: "openai",
        model: "vision-1",
      },
      imageNeighborContextEnabled: true,
      imageMode: "off",
    });

    expect(generateContextImageArtifactsMock).toHaveBeenCalledWith(
      [
        {
          index: 1,
          marker: "CTX_IMAGE_1",
          buffer,
          mediaType: "image/png",
          pageNumber: 1,
        },
      ],
      expect.objectContaining({
        documentTitle: "Invoice Upload",
        imageAnalysisRequired: true,
        imageMode: "always",
        imageNeighborContextEnabled: false,
      }),
    );
    expect(processed).toMatchObject({
      markdown: "# Invoice Upload\n\nCTX_IMAGE_1",
      images: [
        expect.objectContaining({
          label: "Invoice scan",
          ocrText: "Invoice #1001",
        }),
      ],
    });
  });
});
