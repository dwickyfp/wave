import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { composePageText, selectImageAnchor } from "./pdf-processor";

describe("pdf-processor image anchoring", () => {
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
});
