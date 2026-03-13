import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  generateTextMock,
  getProviderByNameMock,
  getModelForChatMock,
  createModelFromConfigMock,
  optimizeKnowledgeImageBufferMock,
} = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  getProviderByNameMock: vi.fn(),
  getModelForChatMock: vi.fn(),
  createModelFromConfigMock: vi.fn(),
  optimizeKnowledgeImageBufferMock: vi.fn(),
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateText: generateTextMock,
  };
});

vi.mock("lib/db/repository", () => ({
  settingsRepository: {
    getProviderByName: getProviderByNameMock,
    getModelForChat: getModelForChatMock,
  },
}));

vi.mock("lib/ai/provider-factory", () => ({
  createModelFromConfig: createModelFromConfigMock,
}));

vi.mock("./image-optimization", () => ({
  optimizeKnowledgeImageBuffer: optimizeKnowledgeImageBufferMock,
}));

import {
  applyContextImageBlocks,
  convertHtmlFragmentToProcessedDocument,
  generateContextImageArtifacts,
  resolveContextImageLocations,
} from "./image-markdown";

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sXl16sAAAAASUVORK5CYII=";

describe("image-markdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProviderByNameMock.mockResolvedValue(null);
    getModelForChatMock.mockResolvedValue(null);
    createModelFromConfigMock.mockReturnValue({});
    optimizeKnowledgeImageBufferMock.mockImplementation(
      async ({ buffer, mediaType }) => ({
        buffer,
        mediaType: mediaType ?? null,
        width: null,
        height: null,
        optimized: false,
      }),
    );
  });

  it("replaces image markers and appends missing blocks", () => {
    const result = applyContextImageBlocks(
      "# Report\n\nCTX_IMAGE_1\n\nSummary",
      [
        {
          marker: "CTX_IMAGE_1",
          index: 1,
          markdown:
            "[image 1]\nLabel : Revenue chart\nDescription : Revenue chart.",
        },
        {
          marker: "CTX_IMAGE_2",
          index: 2,
          markdown:
            "[image 2]\nLabel : Product photo\nDescription : Product photo.",
        },
      ],
    );

    expect(result).toContain(
      "[image 1]\nLabel : Revenue chart\nDescription : Revenue chart.",
    );
    expect(result).toContain(
      "[image 2]\nLabel : Product photo\nDescription : Product photo.",
    );
    expect(result).not.toContain("CTX_IMAGE_1");
  });

  it("turns html images into markdown image blocks with contextual fallback", async () => {
    const processed = await convertHtmlFragmentToProcessedDocument(
      `
        <article>
          <p>Revenue by quarter</p>
          <figure>
            <img
              src="${TINY_PNG_DATA_URL}"
              alt="Revenue chart"
              width="640"
              height="480"
            />
            <figcaption>Quarterly revenue by region from Q1 to Q4.</figcaption>
          </figure>
          <p>North America grows fastest in the second half.</p>
        </article>
      `,
      { documentTitle: "Quarterly report" },
    );

    const markdown = applyContextImageBlocks(
      processed.markdown,
      processed.imageBlocks,
    );

    expect(markdown).toContain("[image 1]");
    expect(markdown).toContain("Label :");
    expect(markdown).toContain("Description :");
    expect(markdown).toContain("Embedded alt text: Revenue chart.");
    expect(markdown).toContain(
      "Caption or nearby label: Quarterly revenue by region from Q1 to Q4.",
    );
    expect(markdown).toContain("North America grows fastest");
  });

  it("resolves image markers to heading and nearby step context without reusing marker tokens", () => {
    const resolved = resolveContextImageLocations(
      "# Tutorial\n\n## Step 1\n\n1. Open the settings panel.\n\nCTX_IMAGE_1\n\nCTX_IMAGE_2\n",
      [
        {
          kind: "embedded",
          marker: "CTX_IMAGE_1",
          index: 1,
          label: "Settings panel",
          description: "Screenshot of the settings panel.",
        },
      ],
    );

    expect(resolved[0]).toMatchObject({
      headingPath: "Tutorial > Step 1",
      stepHint: "1. Open the settings panel.",
    });
  });

  it("avoids hallucinated text-only image analysis when the configured model lacks image input", async () => {
    getProviderByNameMock.mockResolvedValue({
      enabled: true,
      apiKey: "test-key",
      baseUrl: null,
      settings: null,
    });
    getModelForChatMock.mockResolvedValue({
      apiName: "test-model",
      supportsImageInput: false,
    });

    const images = await generateContextImageArtifacts(
      [
        {
          index: 1,
          marker: "CTX_IMAGE_1",
          buffer: Buffer.from("image-one"),
          mediaType: "image/png",
          altText: "Signed financial statement",
          pageNumber: 2,
        },
      ],
      {
        documentTitle: "Financial statement",
        imageAnalysis: {
          provider: "openai",
          model: "test-model",
        },
      },
    );

    expect(generateTextMock).not.toHaveBeenCalled();
    expect(images[0]).toMatchObject({
      label: "Signed financial statement",
    });
    expect(images[0].description).toContain(
      "Embedded alt text: Signed financial statement.",
    );
  });

  it("falls back to per-image metadata when the model repeats the same analysis for distinct images", async () => {
    getProviderByNameMock.mockResolvedValue({
      enabled: true,
      apiKey: "test-key",
      baseUrl: null,
      settings: null,
    });
    getModelForChatMock.mockResolvedValue({
      apiName: "vision-model",
      supportsImageInput: true,
    });
    generateTextMock.mockResolvedValue({
      text: "Label: Net Interest Margin chart\nDescription: A bar chart showing quarterly NIM percentages for BCA.",
    });

    const images = await generateContextImageArtifacts(
      [
        {
          index: 1,
          marker: "CTX_IMAGE_1",
          buffer: Buffer.from("image-one"),
          mediaType: "image/png",
          altText: "Net Interest Margin chart",
          pageNumber: 1,
        },
        {
          index: 2,
          marker: "CTX_IMAGE_2",
          buffer: Buffer.from("image-two"),
          mediaType: "image/png",
          altText: "Signed financial statement",
          pageNumber: 2,
        },
      ],
      {
        documentTitle: "Bank report",
        imageAnalysis: {
          provider: "openai",
          model: "vision-model",
        },
      },
    );

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(images[0]).toMatchObject({
      label: "Net Interest Margin chart",
      description: "A bar chart showing quarterly NIM percentages for BCA.",
    });
    expect(images[1]).toMatchObject({
      label: "Signed financial statement",
    });
    expect(images[1].description).toContain(
      "Embedded alt text: Signed financial statement.",
    );
    expect(images[1].description).toContain("Extracted image index: 2.");
  });

  it("includes explicit before and after text in the image prompt when neighbor context is enabled", async () => {
    getProviderByNameMock.mockResolvedValue({
      enabled: true,
      apiKey: "test-key",
      baseUrl: null,
      settings: null,
    });
    getModelForChatMock.mockResolvedValue({
      apiName: "vision-model",
      supportsImageInput: true,
    });
    generateTextMock.mockResolvedValue({
      text: "Label: Passkey setup screen\nDescription: UI screenshot showing the passkey setup screen.",
    });

    await generateContextImageArtifacts(
      [
        {
          index: 1,
          marker: "CTX_IMAGE_1",
          buffer: Buffer.from("image-one"),
          mediaType: "image/png",
          pageNumber: 4,
          precedingText: "Open Security Settings before enabling passkeys.",
          followingText: "Use this screen to confirm the passkey enrollment.",
          surroundingText: "Security setup flow",
        },
      ],
      {
        documentTitle: "Security Guide",
        imageAnalysis: {
          provider: "openai",
          model: "vision-model",
        },
        imageNeighborContextEnabled: true,
      },
    );

    const promptText =
      generateTextMock.mock.calls[0]?.[0]?.messages?.[0]?.content?.[0]?.text;
    expect(promptText).toContain("Text immediately before image:");
    expect(promptText).toContain(
      "Open Security Settings before enabling passkeys.",
    );
    expect(promptText).toContain("Text immediately after image:");
    expect(promptText).toContain(
      "Use this screen to confirm the passkey enrollment.",
    );
    expect(promptText).toContain(
      "add at most one short context sentence to the description",
    );
  });

  it("omits before and after prompt sections when neighbor context is disabled", async () => {
    getProviderByNameMock.mockResolvedValue({
      enabled: true,
      apiKey: "test-key",
      baseUrl: null,
      settings: null,
    });
    getModelForChatMock.mockResolvedValue({
      apiName: "vision-model",
      supportsImageInput: true,
    });
    generateTextMock.mockResolvedValue({
      text: "Label: Passkey setup screen\nDescription: UI screenshot showing the passkey setup screen.",
    });

    await generateContextImageArtifacts(
      [
        {
          index: 1,
          marker: "CTX_IMAGE_1",
          buffer: Buffer.from("image-one"),
          mediaType: "image/png",
          pageNumber: 4,
          precedingText: "Open Security Settings before enabling passkeys.",
          followingText: "Use this screen to confirm the passkey enrollment.",
          surroundingText: "Security setup flow",
        },
      ],
      {
        documentTitle: "Security Guide",
        imageAnalysis: {
          provider: "openai",
          model: "vision-model",
        },
        imageNeighborContextEnabled: false,
      },
    );

    const promptText =
      generateTextMock.mock.calls[0]?.[0]?.messages?.[0]?.content?.[0]?.text;
    expect(promptText).not.toContain("Text immediately before image:");
    expect(promptText).not.toContain("Text immediately after image:");
    expect(promptText).toContain(
      "Do not add context sentences from nearby document text unless they are directly visible in the image.",
    );
  });

  it("still attempts the vision call in required mode when model metadata says image input is unsupported", async () => {
    getProviderByNameMock.mockResolvedValue({
      enabled: true,
      apiKey: "test-key",
      baseUrl: null,
      settings: null,
    });
    getModelForChatMock.mockResolvedValue({
      apiName: "vision-model",
      supportsImageInput: false,
    });
    generateTextMock.mockResolvedValue({
      text: "Label: Enrollment screen\nDescription: UI screenshot showing the passkey enrollment confirmation screen.",
    });

    const images = await generateContextImageArtifacts(
      [
        {
          index: 1,
          marker: "CTX_IMAGE_1",
          buffer: Buffer.from("image-one"),
          mediaType: "image/png",
          altText: "Passkey enrollment",
          pageNumber: 2,
        },
      ],
      {
        documentTitle: "Security Guide",
        imageAnalysis: {
          provider: "openai",
          model: "vision-model",
        },
        imageAnalysisRequired: true,
      },
    );

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(images[0]).toMatchObject({
      label: "Enrollment screen",
    });
  });

  it("uses optimized image payloads before vision analysis and persistence", async () => {
    getProviderByNameMock.mockResolvedValue({
      enabled: true,
      apiKey: "test-key",
      baseUrl: null,
      settings: null,
    });
    getModelForChatMock.mockResolvedValue({
      apiName: "vision-model",
      supportsImageInput: true,
    });
    generateTextMock.mockResolvedValue({
      text: "Label: Architecture diagram\nDescription: Diagram showing the service flow.",
    });
    optimizeKnowledgeImageBufferMock.mockResolvedValue({
      buffer: Buffer.from("optimized-image"),
      mediaType: "image/webp",
      width: 320,
      height: 180,
      optimized: true,
    });

    const images = await generateContextImageArtifacts(
      [
        {
          index: 1,
          marker: "CTX_IMAGE_1",
          buffer: Buffer.from("original-image"),
          mediaType: "image/png",
          pageNumber: 2,
        },
      ],
      {
        documentTitle: "System Design",
        imageAnalysis: {
          provider: "openai",
          model: "vision-model",
        },
      },
    );

    const imagePart =
      generateTextMock.mock.calls[0]?.[0]?.messages?.[0]?.content?.[1];

    expect(optimizeKnowledgeImageBufferMock).toHaveBeenCalledTimes(1);
    expect(imagePart).toMatchObject({
      type: "image",
      image: Buffer.from("optimized-image"),
      mediaType: "image/webp",
    });
    expect(images[0]).toMatchObject({
      mediaType: "image/webp",
      width: 320,
      height: 180,
    });
  });
});
