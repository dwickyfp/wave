import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  mergeParsedMarkdownWindows,
  parseDocumentToMarkdown,
  splitRawTextIntoWindows,
} from "./markdown-parser";

describe("markdown-parser", () => {
  it("keeps tail content beyond the old single-window limit", () => {
    const rawText = [
      "# Intro\n",
      "A".repeat(50_000),
      "\n## Middle\n",
      "B".repeat(50_000),
      "\n## Tail\n",
      "TAIL-CONTENT",
      "C".repeat(35_000),
    ].join("");

    const windows = splitRawTextIntoWindows(rawText);

    expect(windows.length).toBeGreaterThan(1);
    expect(
      windows.some((windowText) => windowText.includes("TAIL-CONTENT")),
    ).toBe(true);
  });

  it("merges parsed windows without duplicating overlapped headings", () => {
    const merged = mergeParsedMarkdownWindows([
      "# Intro\n\nAlpha\n\n## Install\n\nRun setup",
      "## Install\n\nRun setup\n\n## Usage\n\nRun app",
      "## Usage\n\nRun app\n\n## Tail\n\nDone",
    ]);

    expect(merged).toContain("## Install\n\nRun setup");
    expect(merged).toContain("## Usage\n\nRun app");
    expect(merged.match(/## Install/g)).toHaveLength(1);
    expect(merged.match(/## Usage/g)).toHaveLength(1);
    expect(merged).toContain("## Tail\n\nDone");
  });

  it("preserves page markers and skips parsing work when parse mode is off", async () => {
    const result = await parseDocumentToMarkdown({
      pages: [
        {
          pageNumber: 1,
          rawText: "Page one raw text",
          normalizedText: "Page one markdown",
          markdown: "Page one markdown",
          fingerprint: "page-1",
          qualityScore: 0.9,
          extractionMode: "normalized",
          repairReason: null,
        },
        {
          pageNumber: 2,
          rawText: "Page two raw text",
          normalizedText: "Page two markdown",
          markdown: "Page two markdown",
          fingerprint: "page-2",
          qualityScore: 0.4,
          extractionMode: "normalized",
          repairReason: "fragmented_lines",
        },
      ],
      documentTitle: "Guide",
      parsingProvider: "openai",
      parsingModel: "gpt-4.1-mini",
      mode: "off",
      repairPolicy: "section-safe-reorder",
    });

    expect(result.markdown).toContain("<!--CTX_PAGE:1-->");
    expect(result.markdown).toContain("<!--CTX_PAGE:2-->");
    expect(result.pages[1]?.extractionMode).toBe("normalized");
  });
});
