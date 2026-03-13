import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canManageTeamMember } from "./access";

describe("teams access", () => {
  it("lets owners manage admins and members", () => {
    expect(canManageTeamMember("owner", "admin")).toBe(true);
    expect(canManageTeamMember("owner", "member")).toBe(true);
  });

  it("never lets anyone manage the owner role", () => {
    expect(canManageTeamMember("owner", "owner")).toBe(false);
    expect(canManageTeamMember("admin", "owner")).toBe(false);
    expect(canManageTeamMember("member", "owner")).toBe(false);
  });

  it("lets admins manage members only", () => {
    expect(canManageTeamMember("admin", "member")).toBe(true);
    expect(canManageTeamMember("admin", "admin")).toBe(false);
  });

  it("does not let members manage anyone", () => {
    expect(canManageTeamMember("member", "member")).toBe(false);
    expect(canManageTeamMember("member", "admin")).toBe(false);
  });
});
