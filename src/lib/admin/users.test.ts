import { describe, expect, it } from "vitest";
import {
  buildAdminUsersPageUrl,
  buildAdminUsersQuery,
  parseAdminUsersSearchParams,
} from "./users";

describe("admin users helpers", () => {
  it("parses users page params into normalized state", () => {
    const result = parseAdminUsersSearchParams(
      new URLSearchParams({
        limit: "20",
        page: "3",
        query: "  alice@example.com  ",
        sortBy: "name",
        sortDirection: "asc",
      }),
      10,
    );

    expect(result).toEqual({
      limit: 20,
      offset: 40,
      page: 3,
      query: "alice@example.com",
      sortBy: "name",
      sortDirection: "asc",
    });

    expect(buildAdminUsersQuery(result)).toEqual({
      searchField: "email",
      searchOperator: "contains",
      searchValue: "alice@example.com",
      limit: 20,
      offset: 40,
      sortBy: "name",
      sortDirection: "asc",
    });
  });

  it("falls back to defaults and builds page urls", () => {
    const result = parseAdminUsersSearchParams(
      new URLSearchParams({
        limit: "0",
        page: "0",
        sortBy: "invalid",
        sortDirection: "invalid",
      }),
      10,
    );

    expect(result).toEqual({
      limit: 10,
      offset: 0,
      page: 1,
      query: undefined,
      sortBy: "createdAt",
      sortDirection: "desc",
    });

    expect(
      buildAdminUsersPageUrl({
        baseUrl: "/admin/users",
        limit: 10,
        page: 1,
        sortBy: "createdAt",
        sortDirection: "desc",
      }),
    ).toBe("/admin/users?limit=10");

    expect(
      buildAdminUsersPageUrl({
        baseUrl: "/admin/users",
        limit: 10,
        page: 2,
        query: "alice@example.com",
        sortBy: "role",
        sortDirection: "asc",
      }),
    ).toBe(
      "/admin/users?limit=10&page=2&query=alice%40example.com&sortBy=role&sortDirection=asc",
    );
  });
});
