import { describe, expect, it } from "vitest";
import { mergeDiscoverableAgents, shouldSyncAgentStore } from "./discovery";

describe("agent discovery helpers", () => {
  it("deduplicates merged agent lists while preserving order", () => {
    const merged = mergeDiscoverableAgents(
      [
        { id: "mine-1", name: "Mine" },
        { id: "shared-1", name: "Bookmarked Shared" },
      ] as any,
      [
        { id: "shared-1", name: "Bookmarked Shared" },
        { id: "shared-2", name: "Readonly Shared" },
      ] as any,
    );

    expect(merged.map((agent) => agent.id)).toEqual([
      "mine-1",
      "shared-1",
      "shared-2",
    ]);
  });

  it("only syncs the mention store for full discovery queries", () => {
    expect(shouldSyncAgentStore(["all"])).toBe(true);
    expect(shouldSyncAgentStore(["mine", "bookmarked"])).toBe(false);
    expect(shouldSyncAgentStore(["shared"])).toBe(false);
  });
});
