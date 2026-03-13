import { describe, expect, it } from "vitest";
import { chunkKnowledgeSections } from "./chunker";

describe("chunkKnowledgeSections page anchoring", () => {
  it("refines chunk page metadata from the source markdown markers", () => {
    const sourceMarkdown = [
      "<!--CTX_PAGE:1-->",
      "# PMK 161",
      "",
      "Page one opening text.",
      "",
      "<!--CTX_PAGE:2-->",
      "Vape products become taxable under the updated reporting framework.",
      "",
      "The answer paragraph lives on page two only.",
      "",
      "<!--CTX_PAGE:3-->",
      "Closing appendix text.",
    ].join("\n");

    const chunks = chunkKnowledgeSections(
      [
        {
          id: "section-1",
          heading: "Pasal 3",
          headingPath: "PMK 161 > Pasal 3",
          level: 2,
          content:
            "Vape products become taxable under the updated reporting framework.\n\nThe answer paragraph lives on page two only.",
          pageStart: 1,
          pageEnd: 3,
        },
      ],
      200,
      10,
      { sourceMarkdown },
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain(
      "Vape products become taxable under the updated reporting framework.",
    );
    expect(chunks[0]?.metadata.pageStart).toBe(2);
    expect(chunks[0]?.metadata.pageEnd).toBe(2);
    expect(chunks[0]?.metadata.pageNumber).toBe(2);
  });

  it("keeps fallback page ranges when no source markdown is provided", () => {
    const chunks = chunkKnowledgeSections(
      [
        {
          id: "section-1",
          heading: "Pasal 3",
          headingPath: "PMK 161 > Pasal 3",
          level: 2,
          content:
            "Vape products become taxable under the updated reporting framework.",
          pageStart: 1,
          pageEnd: 3,
        },
      ],
      200,
      10,
    );

    expect(chunks[0]?.metadata.pageStart).toBe(1);
    expect(chunks[0]?.metadata.pageEnd).toBe(3);
    expect(chunks[0]?.metadata.pageNumber).toBeUndefined();
  });
});
