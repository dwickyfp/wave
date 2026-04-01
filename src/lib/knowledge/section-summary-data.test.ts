import { describe, expect, it } from "vitest";
import { buildKnowledgeSectionSummaryData } from "./section-summary-data";

describe("section-summary-data", () => {
  it("preserves continuation, table details, numeric values, and image values", () => {
    const summaries = buildKnowledgeSectionSummaryData(
      [
        {
          id: "section-1",
          heading: "Results",
          headingPath: "Annual Report > Results",
          parentSectionId: null,
          prevSectionId: null,
          nextSectionId: "section-2",
          partIndex: 0,
          partCount: 2,
          content: [
            "Revenue increased to 120.5 billion while net income reached 30.2 billion.",
            "",
            "| Metric | Value |",
            "| --- | --- |",
            "| Revenue | 120.5 |",
            "| Net income | 30.2 |",
            "| Total assets | 980.0 |",
          ].join("\n"),
          pageStart: 10,
          pageEnd: 10,
          noteNumber: null,
          noteTitle: null,
          noteSubsection: null,
          continued: false,
        },
        {
          id: "section-2",
          heading: "Results",
          headingPath: "Annual Report > Results",
          parentSectionId: null,
          prevSectionId: "section-1",
          nextSectionId: null,
          partIndex: 1,
          partCount: 2,
          content:
            "Study results reported n = 1200 participants, p = 0.03, and accuracy improved to 94.5%.",
          pageStart: 11,
          pageEnd: 11,
          noteNumber: null,
          noteTitle: null,
          noteSubsection: null,
          continued: true,
        },
      ],
      [
        {
          kind: "embedded",
          marker: "CTX_IMAGE_1",
          index: 1,
          label: "Results table",
          description: "Table summarizing research metrics.",
          pageNumber: 11,
          exactValueSnippets: ["Confidence interval 95% CI 0.81-0.90"],
          structuredData: {
            tableData: {
              headers: ["Metric", "Value"],
              rows: [
                ["Participants", "1200"],
                ["Accuracy", "94.5%"],
              ],
              summary: "Research metrics table.",
            },
          },
        },
      ] as any,
    );

    const partOne = summaries.get("section-1");
    const partTwo = summaries.get("section-2");

    expect(partOne?.logicalSectionKey).toBe("Annual Report > Results::::");
    expect(partOne?.continuation.usesNextPart).toBe(true);
    expect(partTwo?.continuation.usesPrevPart).toBe(true);
    expect(partOne?.coverageFlags.hasContinuation).toBe(true);
    expect(partOne?.coverageFlags.hasTable).toBe(true);
    expect(partOne?.coverageFlags.hasDenseNumbers).toBe(true);
    expect(partOne?.coverageFlags.hasResearchResults).toBe(true);
    expect(partOne?.partSummary).toContain("adjacent continuation parts");
    expect(partOne?.logicalSectionSummary).toContain("120.5");
    expect(partOne?.logicalSectionSummary).toContain("94.5%");
    expect(partOne?.valueDigest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining("Revenue increased to 120.5 billion"),
        }),
        expect.objectContaining({
          text: expect.stringContaining("p = 0.03"),
        }),
        expect.objectContaining({
          text: expect.stringContaining("Confidence interval 95% CI 0.81-0.90"),
        }),
      ]),
    );
    expect(partOne?.tableDigest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "markdown",
          headers: ["Metric", "Value"],
        }),
        expect.objectContaining({
          source: "image",
          headers: ["Metric", "Value"],
        }),
      ]),
    );
  });
});
