import { describe, expect, it } from "vitest";

import {
  filterSelectedUserIds,
  serializeSelectedUserIds,
  toggleAllSelectedUserIds,
  toggleSelectedUserId,
} from "./users-table.utils";

describe("users table selection helpers", () => {
  it("adds and removes a single selected user id", () => {
    expect(toggleSelectedUserId([], "user-1", true)).toEqual(["user-1"]);
    expect(toggleSelectedUserId(["user-1"], "user-1", false)).toEqual([]);
  });

  it("toggles all selected user ids for the current page", () => {
    expect(
      toggleAllSelectedUserIds(["user-9"], ["user-1", "user-2"], true),
    ).toEqual(["user-9", "user-1", "user-2"]);

    expect(
      toggleAllSelectedUserIds(
        ["user-9", "user-1", "user-2"],
        ["user-1", "user-2"],
        false,
      ),
    ).toEqual(["user-9"]);
  });

  it("filters selected user ids down to the available page ids", () => {
    expect(
      filterSelectedUserIds(
        ["user-1", "user-2", "user-3"],
        ["user-2", "user-3"],
      ),
    ).toEqual(["user-2", "user-3"]);
  });

  it("serializes selected user ids for the bulk delete form", () => {
    expect(serializeSelectedUserIds(["user-1", "user-2"])).toBe(
      '["user-1","user-2"]',
    );
  });
});
