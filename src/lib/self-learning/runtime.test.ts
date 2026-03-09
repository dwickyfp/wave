import { beforeEach, describe, expect, it, vi } from "vitest";

const mockListActiveMemoriesForUser = vi.fn();
const mockGetSetting = vi.fn();
const mockWarn = vi.fn();

vi.mock("lib/db/repository", () => ({
  selfLearningRepository: {
    listActiveMemoriesForUser: mockListActiveMemoriesForUser,
  },
  settingsRepository: {
    getSetting: mockGetSetting,
  },
}));

vi.mock("logger", () => ({
  default: {
    warn: mockWarn,
  },
}));

describe("getLearnedPersonalizationPromptForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when repository access fails", async () => {
    mockGetSetting.mockResolvedValueOnce({
      maxActiveMemories: 5,
    });
    mockListActiveMemoriesForUser.mockRejectedValueOnce(
      new Error("db unavailable"),
    );

    const { getLearnedPersonalizationPromptForUser } = await import(
      "./runtime"
    );

    await expect(
      getLearnedPersonalizationPromptForUser("user-1"),
    ).resolves.toBe(false);
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });

  it("falls back to defaults when settings are invalid", async () => {
    mockGetSetting.mockResolvedValueOnce({
      maxActiveMemories: "five",
    });
    mockListActiveMemoriesForUser.mockResolvedValueOnce([
      {
        title: "Python preference",
        content: "User likes Python and data engineering.",
      },
    ]);

    const { getLearnedPersonalizationPromptForUser } = await import(
      "./runtime"
    );

    const prompt = await getLearnedPersonalizationPromptForUser("user-2");

    expect(typeof prompt).toBe("string");
    expect(mockListActiveMemoriesForUser).toHaveBeenCalledWith("user-2", 5);
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });
});
