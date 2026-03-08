import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("lib/pilot/request-user", () => ({
  resolvePilotAuthorizedUserId: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  chatRepository: {
    checkAccess: vi.fn(),
    deleteMessageFeedback: vi.fn(),
    getMessageFeedback: vi.fn(),
    selectThreadIdByMessageId: vi.fn(),
    upsertMessageFeedback: vi.fn(),
  },
}));

const { GET, PUT, DELETE } = await import("./route");
const { chatRepository } = await import("lib/db/repository");
const { resolvePilotAuthorizedUserId } = await import("lib/pilot/request-user");

function withParams(messageId: string) {
  return {
    params: Promise.resolve({ messageId }),
  } as {
    params: Promise<{
      messageId: string;
    }>;
  };
}

describe("pilot message feedback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolvePilotAuthorizedUserId).mockResolvedValue("user-1");
    vi.mocked(chatRepository.selectThreadIdByMessageId).mockResolvedValue(
      "thread-1",
    );
    vi.mocked(chatRepository.checkAccess).mockResolvedValue(true);
  });

  it("returns existing feedback for an accessible message", async () => {
    vi.mocked(chatRepository.getMessageFeedback).mockResolvedValue({
      id: "feedback-1",
      messageId: "message-1",
      userId: "user-1",
      type: "like",
      reason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const response = await GET(
      new Request("http://localhost/api/pilot/message-feedback/message-1"),
      withParams("message-1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      type: "like",
      reason: null,
    });
  });

  it("upserts pilot feedback", async () => {
    vi.mocked(chatRepository.upsertMessageFeedback).mockResolvedValue({
      type: "dislike",
      reason: null,
    } as any);

    const response = await PUT(
      new Request("http://localhost/api/pilot/message-feedback/message-1", {
        method: "PUT",
        body: JSON.stringify({
          type: "dislike",
        }),
        headers: {
          "content-type": "application/json",
        },
      }),
      withParams("message-1"),
    );

    expect(response.status).toBe(200);
    expect(chatRepository.upsertMessageFeedback).toHaveBeenCalledWith(
      "message-1",
      "user-1",
      "dislike",
      undefined,
    );
  });

  it("deletes pilot feedback", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/pilot/message-feedback/message-1", {
        method: "DELETE",
      }),
      withParams("message-1"),
    );

    expect(response.status).toBe(200);
    expect(chatRepository.deleteMessageFeedback).toHaveBeenCalledWith(
      "message-1",
      "user-1",
    );
  });

  it("returns 401 when auth resolution fails", async () => {
    vi.mocked(resolvePilotAuthorizedUserId).mockRejectedValue(
      new Error("Unauthorized"),
    );

    const response = await GET(
      new Request("http://localhost/api/pilot/message-feedback/message-1"),
      withParams("message-1"),
    );

    expect(response.status).toBe(401);
  });
});
