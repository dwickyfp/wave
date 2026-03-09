import { describe, expect, it } from "vitest";
import {
  SELF_LEARNING_USER_LIST_LIMIT,
  buildSelfLearningUsersApiUrl,
  buildSelfLearningUsersPageUrl,
  parseSelfLearningUsersSearchParams,
} from "./admin";

describe("self-learning admin pagination", () => {
  it("parses page and query while enforcing the fixed page size", () => {
    const state = parseSelfLearningUsersSearchParams({
      page: "3",
      limit: "100",
      query: "  emma user  ",
    });

    expect(state).toEqual({
      page: 3,
      limit: SELF_LEARNING_USER_LIST_LIMIT,
      offset: SELF_LEARNING_USER_LIST_LIMIT * 2,
      query: "emma user",
    });
  });

  it("builds admin evaluation urls without leaking the fixed limit", () => {
    expect(
      buildSelfLearningUsersPageUrl({
        page: 2,
        query: "admin",
      }),
    ).toBe("/admin/evaluation?page=2&query=admin");

    expect(
      buildSelfLearningUsersApiUrl({
        page: 1,
      }),
    ).toBe("/api/admin/evaluation");
  });
});
