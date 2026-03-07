import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  mergeParsedMarkdownWindows,
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
});
