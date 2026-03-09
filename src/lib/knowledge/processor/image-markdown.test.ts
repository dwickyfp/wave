import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  applyContextImageBlocks,
  convertHtmlFragmentToProcessedDocument,
} from "./image-markdown";

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sXl16sAAAAASUVORK5CYII=";

describe("image-markdown", () => {
  it("replaces image markers and appends missing blocks", () => {
    const result = applyContextImageBlocks(
      "# Report\n\nCTX_IMAGE_1\n\nSummary",
      [
        {
          marker: "CTX_IMAGE_1",
          index: 1,
          markdown: "[image 1]\nDescription : Revenue chart.",
        },
        {
          marker: "CTX_IMAGE_2",
          index: 2,
          markdown: "[image 2]\nDescription : Product photo.",
        },
      ],
    );

    expect(result).toContain("[image 1]\nDescription : Revenue chart.");
    expect(result).toContain("[image 2]\nDescription : Product photo.");
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
    expect(markdown).toContain("Description :");
    expect(markdown).toContain("Embedded alt text: Revenue chart.");
    expect(markdown).toContain(
      "Caption or nearby label: Quarterly revenue by region from Q1 to Q4.",
    );
    expect(markdown).toContain("North America grows fastest");
  });
});
