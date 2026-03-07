import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("lib/auth/permissions", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  mcpRepository: {
    selectAllForUser: vi.fn(),
    selectById: vi.fn(),
    selectByServerName: vi.fn(),
  },
}));

vi.mock("lib/user/utils", () => ({
  getIsUserAdmin: vi.fn(),
}));

const { getCurrentUser } = await import("lib/auth/permissions");
const { mcpRepository } = await import("lib/db/repository");
const { getIsUserAdmin } = await import("lib/user/utils");
const { getAccessibleMcpServerByNameOrThrow, getAccessibleMcpServerOrThrow } =
  await import("./access");

describe("mcp access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows owners to manage their servers", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "user-1",
      role: "user",
    } as any);
    vi.mocked(getIsUserAdmin).mockReturnValue(false);
    vi.mocked(mcpRepository.selectById).mockResolvedValue({
      id: "server-1",
      userId: "user-1",
      visibility: "public",
    } as any);

    await expect(
      getAccessibleMcpServerOrThrow("server-1", "manage"),
    ).resolves.toMatchObject({
      isOwner: true,
    });
  });

  it("allows reads of public servers", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "user-1",
      role: "user",
    } as any);
    vi.mocked(getIsUserAdmin).mockReturnValue(false);
    vi.mocked(mcpRepository.selectByServerName).mockResolvedValue({
      id: "server-1",
      userId: "user-2",
      visibility: "public",
    } as any);

    await expect(
      getAccessibleMcpServerByNameOrThrow("public-server", "read"),
    ).resolves.toMatchObject({
      isOwner: false,
    });
  });

  it("rejects manage access for non-owners", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "user-1",
      role: "user",
    } as any);
    vi.mocked(getIsUserAdmin).mockReturnValue(false);
    vi.mocked(mcpRepository.selectById).mockResolvedValue({
      id: "server-1",
      userId: "user-2",
      visibility: "public",
    } as any);

    await expect(
      getAccessibleMcpServerOrThrow("server-1", "manage"),
    ).rejects.toThrow("Unauthorized");
  });
});
