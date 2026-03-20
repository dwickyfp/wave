import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("lib/self-learning/runtime", () => ({
  getLearnedPersonalizationPromptForUser: vi.fn(async () => "learned prompt"),
}));

const { getLearnedPersonalizationPromptForUser } = await import(
  "lib/self-learning/runtime"
);
const { resolveAgentPersonalizationPrompt } = await import("./personalization");

describe("agent personalization policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads personalization for platform chat by platform user", async () => {
    const prompt = await resolveAgentPersonalizationPrompt({
      surface: "platform_chat",
      platformUserId: "user-1",
    });

    expect(prompt).toBe("learned prompt");
    expect(getLearnedPersonalizationPromptForUser).toHaveBeenCalledWith(
      "user-1",
    );
  });

  it("skips platform chat personalization when the agent disables it", async () => {
    const prompt = await resolveAgentPersonalizationPrompt({
      surface: "platform_chat",
      platformUserId: "user-1",
      agent: {
        chatPersonalizationEnabled: false,
      },
    });

    expect(prompt).toBe(false);
    expect(getLearnedPersonalizationPromptForUser).not.toHaveBeenCalled();
  });

  it("skips personalization for external access transports", async () => {
    const prompt = await resolveAgentPersonalizationPrompt({
      surface: "external_access",
      agent: {
        chatPersonalizationEnabled: true,
      },
    });

    expect(prompt).toBe(false);
    expect(getLearnedPersonalizationPromptForUser).not.toHaveBeenCalled();
  });

  it("skips personalization for a2a execution", async () => {
    const prompt = await resolveAgentPersonalizationPrompt({
      surface: "a2a",
      agent: {
        chatPersonalizationEnabled: true,
      },
    });

    expect(prompt).toBe(false);
    expect(getLearnedPersonalizationPromptForUser).not.toHaveBeenCalled();
  });
});
