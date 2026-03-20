import { describe, expect, it } from "vitest";
import { isCreatorRole, parseRoleString } from "./types";

describe("auth role parsing", () => {
  it("detects admin from normalized single-role values", () => {
    expect(parseRoleString("admin")).toBe("admin");
    expect(parseRoleString("ADMIN")).toBe("admin");
    expect(parseRoleString(" admin ")).toBe("admin");
  });

  it("detects admin from provider-prefixed and multi-role values", () => {
    expect(parseRoleString("google:admin")).toBe("admin");
    expect(parseRoleString("user,admin")).toBe("admin");
    expect(parseRoleString("user, admin")).toBe("admin");
  });

  it("keeps non-admin roles scoped correctly", () => {
    expect(parseRoleString("creator")).toBe("creator");
    expect(parseRoleString("user")).toBe("user");
    expect(isCreatorRole("creator")).toBe(true);
    expect(isCreatorRole("admin")).toBe(true);
    expect(isCreatorRole("user")).toBe(false);
  });

  it("falls back to user for missing or invalid values", () => {
    expect(parseRoleString(undefined)).toBe("user");
    expect(parseRoleString(null)).toBe("user");
    expect(parseRoleString("")).toBe("user");
    expect(parseRoleString("unknown-role")).toBe("user");
  });
});
