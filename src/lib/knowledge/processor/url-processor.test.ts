import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { safeOutboundFetchMock, convertHtmlFragmentToProcessedDocumentMock } =
  vi.hoisted(() => ({
    safeOutboundFetchMock: vi.fn(),
    convertHtmlFragmentToProcessedDocumentMock: vi.fn(),
  }));

vi.mock("lib/network/safe-outbound-fetch", () => ({
  safeOutboundFetch: safeOutboundFetchMock,
}));

vi.mock("./image-markdown", () => ({
  convertHtmlFragmentToProcessedDocument:
    convertHtmlFragmentToProcessedDocumentMock,
}));

const { processUrl } = await import("./url-processor");
const { MAX_REMOTE_HTML_BYTES } = await import("./remote-fetch");

describe("url-processor", () => {
  it("uses safe outbound fetch for remote pages", async () => {
    safeOutboundFetchMock.mockResolvedValue(
      new Response(
        "<html><head><title>Quarterly Report</title></head><body><main>Body</main></body></html>",
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        },
      ),
    );
    convertHtmlFragmentToProcessedDocumentMock.mockResolvedValue({
      markdown: "Body",
      imageBlocks: [],
      images: [],
    });

    const processed = await processUrl("https://example.com/report");

    expect(safeOutboundFetchMock).toHaveBeenCalledWith(
      "https://example.com/report",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(processed.markdown).toContain("# Quarterly Report");
    expect(processed.markdown).toContain("Source: https://example.com/report");
  });

  it("rejects non-html responses", async () => {
    safeOutboundFetchMock.mockResolvedValue(
      new Response("not html", {
        status: 200,
        headers: {
          "content-type": "application/pdf",
        },
      }),
    );

    await expect(processUrl("https://example.com/file.pdf")).rejects.toThrow(
      /Unsupported URL content type/,
    );
  });

  it("rejects oversized html responses", async () => {
    safeOutboundFetchMock.mockResolvedValue(
      new Response("<html></html>", {
        status: 200,
        headers: {
          "content-type": "text/html",
          "content-length": String(MAX_REMOTE_HTML_BYTES + 1),
        },
      }),
    );

    await expect(processUrl("https://example.com/huge")).rejects.toThrow(
      /Remote HTML response exceeds maximum size/,
    );
  });
});
