import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  composePageText,
  processPdf,
  selectImageAnchor,
  shouldKeepPdfImageCandidate,
} from "./pdf-processor";

const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse") as {
  PDFParse: new (opts: { data: Uint8Array }) => {
    load(): Promise<unknown>;
    getImage(opts?: { imageThreshold?: number }): Promise<unknown>;
    destroy(): Promise<void>;
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pdf-processor image anchoring", () => {
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlAbWQAAAAASUVORK5CYII=",
    "base64",
  );

  it("anchors a figure after the nearest preceding paragraph instead of section top", () => {
    const lines = [
      {
        text: "Overview",
        xMin: 20,
        xMax: 180,
        yMin: 20,
        yMax: 34,
        breakBefore: false,
      },
      {
        text: "Revenue increased in Q3 after the pricing change.",
        xMin: 20,
        xMax: 340,
        yMin: 60,
        yMax: 74,
        breakBefore: true,
      },
      {
        text: "Figure 1. Revenue by region.",
        xMin: 20,
        xMax: 260,
        yMin: 120,
        yMax: 134,
        breakBefore: true,
      },
      {
        text: "The Asia-Pacific line leads the rebound.",
        xMin: 20,
        xMax: 320,
        yMin: 160,
        yMax: 174,
        breakBefore: true,
      },
    ];

    const anchor = selectImageAnchor(lines, 1, {
      left: 24,
      right: 250,
      top: 86,
      bottom: 112,
    });

    expect(anchor).toMatchObject({
      pageNumber: 1,
      blockIndex: 2,
      placement: "after",
      source: "caption",
    });
  });

  it("keeps inline image markers between neighboring paragraphs", () => {
    const markdown = composePageText(
      [
        {
          text: "Revenue increased in Q3 after the pricing change.",
          xMin: 20,
          xMax: 340,
          yMin: 60,
          yMax: 74,
          breakBefore: false,
        },
        {
          text: "The Asia-Pacific line leads the rebound.",
          xMin: 20,
          xMax: 320,
          yMin: 120,
          yMax: 134,
          breakBefore: true,
        },
      ],
      [
        {
          marker: "CTX_IMAGE_1",
          anchor: {
            pageNumber: 1,
            blockIndex: 0,
            anchorText: "Revenue increased in Q3 after the pricing change.",
            precedingText: "Revenue increased in Q3 after the pricing change.",
            followingText: "The Asia-Pacific line leads the rebound.",
            placement: "after",
            source: "pdf-layout",
            confidence: 0.8,
          },
        },
      ],
    );

    expect(markdown).toContain(
      "Revenue increased in Q3 after the pricing change.\n\nCTX_IMAGE_1\n\nThe Asia-Pacific line leads the rebound.",
    );
  });

  it("continues processing when pdf image extraction fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(PDFParse.prototype as any, "load").mockResolvedValue({
      numPages: 1,
      async getPage() {
        return {
          async getTextContent() {
            return {
              items: [
                {
                  str: "Quarterly revenue summary",
                  transform: [1, 0, 0, 1, 20, 700],
                  width: 140,
                  height: 12,
                  hasEOL: true,
                },
              ],
            };
          },
          getViewport() {
            return {
              transform: [1, 0, 0, 1, 0, 0],
              convertToViewportPoint: (x: number, y: number) =>
                [x, y] as [number, number],
            };
          },
          async getOperatorList() {
            return { fnArray: [], argsArray: [] };
          },
          cleanup() {},
        };
      },
    });
    vi.spyOn(PDFParse.prototype as any, "getImage").mockRejectedValue(
      new Error("Image object img_p11_2 not found"),
    );
    vi.spyOn(PDFParse.prototype as any, "destroy").mockResolvedValue(undefined);

    const result = await processPdf(Buffer.from("fake-pdf"));

    expect(result.markdown).toContain("Quarterly revenue summary");
    expect(result.pages).toHaveLength(1);
    expect(result.images).toEqual([]);
    expect(result.imageBlocks).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "[ContextX] Failed to extract embedded PDF images; continuing with text-only PDF ingestion:",
      expect.any(Error),
    );
  });

  it("filters page-sized PDF scan images instead of indexing full document pages as images", () => {
    expect(
      shouldKeepPdfImageCandidate({
        lines: [
          {
            text: "PERATURAN MENTERI KEUANGAN REPUBLIK INDONESIA",
            xMin: 60,
            xMax: 420,
            yMin: 70,
            yMax: 88,
            breakBefore: false,
          },
        ],
        placement: {
          left: 0,
          right: 595,
          top: 0,
          bottom: 842,
        },
        pageWidth: 595,
        pageHeight: 842,
        imageWidth: 2400,
        imageHeight: 3400,
      }),
    ).toBe(false);
  });

  it("keeps medium figure-like PDF images with nearby captions", async () => {
    vi.spyOn(PDFParse.prototype as any, "load").mockResolvedValue({
      numPages: 1,
      async getPage() {
        return {
          async getTextContent() {
            return {
              items: [
                {
                  str: "Revenue by region",
                  transform: [1, 0, 0, 1, 40, 180],
                  width: 120,
                  height: 12,
                  hasEOL: true,
                },
                {
                  str: "Figure 1. Revenue by region.",
                  transform: [1, 0, 0, 1, 40, 348],
                  width: 160,
                  height: 12,
                  hasEOL: true,
                },
              ],
            };
          },
          getViewport() {
            return {
              transform: [1, 0, 0, 1, 0, 0],
              convertToViewportPoint: (x: number, y: number) =>
                [x, y] as [number, number],
              width: 600,
              height: 800,
            };
          },
          async getOperatorList() {
            return {
              fnArray: [12, 85],
              argsArray: [[180, 0, 0, 120, 40, 220], ["img1"]],
            };
          },
          cleanup() {},
        };
      },
    });
    vi.spyOn(PDFParse.prototype as any, "getImage").mockResolvedValue({
      pages: [
        {
          pageNumber: 1,
          images: [
            {
              data: tinyPng,
              name: "img1",
              width: 180,
              height: 120,
              dataUrl: "data:image/png;base64," + tinyPng.toString("base64"),
            },
          ],
        },
      ],
    });
    vi.spyOn(PDFParse.prototype as any, "destroy").mockResolvedValue(undefined);

    const result = await processPdf(Buffer.from("fake-pdf"));

    expect(result.images).toHaveLength(1);
    expect(result.images?.[0]?.label).toContain("Figure 1");
  });
});
