import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  chatRepository: {
    checkAccess: vi.fn(),
    selectThreadIdByMessageId: vi.fn(),
  },
}));

const { getSession } = await import("auth/server");
const { chatRepository } = await import("lib/db/repository");
const {
  requireAuthenticatedChatUserId,
  requireMessageAccess,
  requireThreadAccess,
} = await import("./access");

describe("chat access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires an authenticated user", async () => {
    vi.mocked(getSession).mockResolvedValue(null as any);

    await expect(requireAuthenticatedChatUserId()).rejects.toThrow(
      "Unauthorized",
    );
  });

  it("verifies thread ownership", async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "user-1" },
    } as any);
    vi.mocked(chatRepository.checkAccess).mockResolvedValue(true as any);

    await expect(requireThreadAccess("thread-1")).resolves.toBe("user-1");
  });

  it("rejects message mutations for foreign threads", async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "user-1" },
    } as any);
    vi.mocked(chatRepository.selectThreadIdByMessageId).mockResolvedValue(
      "thread-2" as any,
    );
    vi.mocked(chatRepository.checkAccess).mockResolvedValue(false as any);

    await expect(requireMessageAccess("message-1")).rejects.toThrow(
      "Unauthorized",
    );
  });
});
