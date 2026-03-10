import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getNextReservedVersionNumber } from "./versioning";

describe("getNextReservedVersionNumber", () => {
  it("uses the highest existing version number, not just latest active version", () => {
    expect(
      getNextReservedVersionNumber({
        latestVersionNumber: 4,
        maxExistingVersionNumber: 5,
      }),
    ).toBe(6);
  });

  it("starts at version one when no versions exist yet", () => {
    expect(
      getNextReservedVersionNumber({
        latestVersionNumber: 0,
        maxExistingVersionNumber: 0,
      }),
    ).toBe(1);
  });
});
