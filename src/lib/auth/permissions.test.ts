import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks
vi.mock("./auth-instance", () => ({
  getSession: vi.fn(),
}));

// server-only is used inside the module; stub it for tests
vi.mock("server-only", () => ({}));

const { getSession } = await import("./auth-instance");

describe("auth/permissions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("hasAdminPermission returns true when user is admin", async () => {
    const permissions = await import("./permissions");
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    } as any);

    await expect(permissions.hasAdminPermission()).resolves.toBe(true);
  });

  it("hasAdminPermission returns false when no session", async () => {
    const permissions = await import("./permissions");
    vi.mocked(getSession).mockResolvedValue(null as any);

    await expect(permissions.hasAdminPermission()).resolves.toBe(false);
  });

  it("canManageUsers equals hasAdminPermission", async () => {
    const permissions = await import("./permissions");
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "u1", role: "user" },
    } as any);

    await expect(permissions.canManageUsers()).resolves.toBe(false);

    vi.mocked(getSession).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    } as any);
    await expect(permissions.canManageUsers()).resolves.toBe(true);
  });

  it("canManageUser returns true for self regardless of admin", async () => {
    const permissions = await import("./permissions");
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "self", role: "user" },
    } as any);

    await expect(permissions.canManageUser("self")).resolves.toBe(true);
  });

  it("canManageUser returns true for others if admin", async () => {
    const permissions = await import("./permissions");
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    } as any);

    await expect(permissions.canManageUser("other")).resolves.toBe(true);
  });

  it("requireAdminPermission throws when not admin", async () => {
    const permissions = await import("./permissions");
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "u1", role: "user" },
    } as any);

    await expect(
      permissions.requireAdminPermission("do admin thing"),
    ).rejects.toThrow(/Admin access required/);
  });

  it("requireUserManagePermissionFor throws when cannot manage target", async () => {
    const permissions = await import("./permissions");
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "u1", role: "user" },
    } as any);

    await expect(
      permissions.requireUserManagePermissionFor("u2", "manage this user"),
    ).rejects.toThrow(/Permission required/);
  });

  it("canManageMCPServer allows owners to manage public servers", async () => {
    const permissions = await import("./permissions");
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "owner-1", role: "user" },
    } as any);

    await expect(
      permissions.canManageMCPServer("owner-1", "public"),
    ).resolves.toBe(true);
  });

  it("canCreateTeam allows creators", async () => {
    const permissions = await import("./permissions");
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "u1", role: "creator" },
    } as any);

    await expect(permissions.canCreateTeam()).resolves.toBe(true);
  });

  it("canCreateTeam rejects plain users", async () => {
    const permissions = await import("./permissions");
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "u1", role: "user" },
    } as any);

    await expect(permissions.canCreateTeam()).resolves.toBe(false);
  });
});
