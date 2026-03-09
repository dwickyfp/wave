import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMessageAccess = vi.fn();
const getMessageFeedback = vi.fn();
const loggerWarn = vi.fn();

vi.mock("lib/chat/access", () => ({
  requireAuthenticatedChatUserId: vi.fn(),
  requireMessageAccess,
  requireThreadAccess: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  agentRepository: {},
  chatExportRepository: {},
  chatRepository: {
    getMessageFeedback,
  },
  mcpMcpToolCustomizationRepository: {},
  mcpServerCustomizationRepository: {},
}));

vi.mock("lib/ai/provider-factory", () => ({
  getDbModel: vi.fn(),
}));

vi.mock("lib/utils", () => ({
  generateUUID: vi.fn(),
  toAny: vi.fn((value) => value),
}));

vi.mock("lib/cache", () => ({
  serverCache: {
    clear: vi.fn(),
    del: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("lib/cache/cache-keys", () => ({
  CacheKeys: {},
}));

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: loggerWarn,
  },
}));

vi.mock("lib/self-learning/service", () => ({
  recordSelfLearningSignal: vi.fn(),
  syncExplicitFeedbackSignal: vi.fn(),
}));

describe("chat feedback action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns feedback when access succeeds", async () => {
    requireMessageAccess.mockResolvedValueOnce({
      userId: "user-1",
      threadId: "thread-1",
    });
    getMessageFeedback.mockResolvedValueOnce({
      id: "feedback-1",
      messageId: "message-1",
      userId: "user-1",
      type: "like",
      reason: null,
    });

    const { getMessageFeedbackAction } = await import("./actions");

    await expect(getMessageFeedbackAction("message-1")).resolves.toEqual({
      id: "feedback-1",
      messageId: "message-1",
      userId: "user-1",
      type: "like",
      reason: null,
    });
  });

  it("returns null instead of throwing for passive feedback lookups", async () => {
    requireMessageAccess.mockRejectedValueOnce(new Error("Unauthorized"));

    const { getMessageFeedbackAction } = await import("./actions");

    await expect(getMessageFeedbackAction("message-2")).resolves.toBeNull();
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(getMessageFeedback).not.toHaveBeenCalled();
  });
});
