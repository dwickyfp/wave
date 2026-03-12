import { describe, expect, it } from "vitest";

import { buildInstructionDiff } from "./instruction-diff";

describe("buildInstructionDiff", () => {
  it("returns no highlights for unchanged content", () => {
    const diff = buildInstructionDiff(
      "You are helpful.\nAnswer clearly.",
      "You are helpful.\nAnswer clearly.",
    );

    expect(diff.hasChanges).toBe(false);
    expect(diff.addedCount).toBe(0);
    expect(diff.removedCount).toBe(0);
    expect(diff.lines.map((line) => line.type)).toEqual([
      "unchanged",
      "unchanged",
    ]);
  });

  it("marks appended lines as additions", () => {
    const diff = buildInstructionDiff(
      "You are helpful.",
      "You are helpful.\nAlways show examples.",
    );

    expect(diff.hasChanges).toBe(true);
    expect(diff.addedCount).toBe(1);
    expect(diff.removedCount).toBe(0);
    expect(diff.lines.map((line) => [line.type, line.text])).toEqual([
      ["unchanged", "You are helpful."],
      ["added", "Always show examples."],
    ]);
  });

  it("shows modified lines as removed plus added", () => {
    const diff = buildInstructionDiff(
      "You are helpful.\nAnswer briefly.",
      "You are helpful.\nAnswer with concise bullets.",
    );

    expect(diff.hasChanges).toBe(true);
    expect(diff.addedCount).toBe(1);
    expect(diff.removedCount).toBe(1);
    expect(diff.lines.map((line) => [line.type, line.text])).toEqual([
      ["unchanged", "You are helpful."],
      ["removed", "Answer briefly."],
      ["added", "Answer with concise bullets."],
    ]);
  });
});
