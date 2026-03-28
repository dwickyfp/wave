import { describe, expect, it } from "vitest";

import { sanitizeThreadTitle } from "./thread-title";

describe("sanitizeThreadTitle", () => {
  it("strips markdown headings and symbols", () => {
    expect(sanitizeThreadTitle("### Fix login redirect loop #urgent")).toBe(
      "Fix login redirect loop urgent",
    );
  });

  it("extracts a plain-text title from labeled multiline output", () => {
    expect(sanitizeThreadTitle('Title:\n\n## "Next.js + AI SDK" setup')).toBe(
      "Next js AI SDK setup",
    );
  });

  it("removes numbered list prefixes", () => {
    expect(sanitizeThreadTitle("1. Improve upload error handling")).toBe(
      "Improve upload error handling",
    );
  });

  it("caps titles without adding punctuation", () => {
    const title = sanitizeThreadTitle(`Title: ${"a".repeat(120)}`);

    expect(title).toHaveLength(80);
    expect(title).toBe("a".repeat(80));
  });
});
