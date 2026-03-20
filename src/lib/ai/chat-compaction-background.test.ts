import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("lib/db/repository", () => ({
  chatRepository: {
    selectThreadDetails: vi.fn(),
    selectLatestThreadChatModel: vi.fn(),
    upsertCompactionState: vi.fn(async (state: any) => ({
      id: state.id ?? "state-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...state,
    })),
    upsertCompactionCheckpoint: vi.fn(),
  },
}));

vi.mock("./provider-factory", () => ({
  getDbModel: vi.fn(),
}));

vi.mock("./chat-compaction-worker-client", () => ({
  enqueueChatCompaction: vi.fn(async () => {}),
}));

const { enqueueOrRunBackgroundThreadCompaction } = await import(
  "./chat-compaction-background"
);
const { chatRepository } = await import("lib/db/repository");
const { getDbModel } = await import("./provider-factory");
const { enqueueChatCompaction } = await import(
  "./chat-compaction-worker-client"
);

describe("chat-compaction-background", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(chatRepository.selectLatestThreadChatModel).mockResolvedValue({
      provider: "anthropic",
      model: "claude-sonnet-4",
    });
    vi.mocked(getDbModel).mockResolvedValue({
      model: {} as any,
      contextLength: 90_000,
      inputTokenPricePer1MUsd: 0,
      outputTokenPricePer1MUsd: 0,
      supportsTools: true,
      supportsGeneration: true,
      supportsImageInput: false,
      supportsFileInput: false,
    });
  });

  it("skips queueing when the thread is below the trigger threshold", async () => {
    vi.mocked(chatRepository.selectThreadDetails).mockResolvedValue({
      id: "thread-1",
      title: "Chat",
      userId: "user-1",
      createdAt: new Date(),
      messages: [
        {
          id: "m-1",
          role: "user",
          parts: [{ type: "text", text: "short question" }],
          createdAt: new Date(),
        },
      ],
      compactionCheckpoint: null,
      compactionState: null,
    } as any);

    await enqueueOrRunBackgroundThreadCompaction("thread-1");

    expect(enqueueChatCompaction).not.toHaveBeenCalled();
    expect(chatRepository.upsertCompactionState).not.toHaveBeenCalled();
  });

  it("queues background compaction when persisted history is already hot", async () => {
    vi.mocked(chatRepository.selectThreadDetails).mockResolvedValue({
      id: "thread-1",
      title: "Chat",
      userId: "user-1",
      createdAt: new Date(),
      messages: [
        {
          id: "m-1",
          role: "user",
          parts: [{ type: "text", text: "older turn".repeat(10_000) }],
          createdAt: new Date(),
        },
        {
          id: "m-2",
          role: "assistant",
          parts: [{ type: "text", text: "older answer".repeat(10_000) }],
          createdAt: new Date(),
        },
        {
          id: "m-3",
          role: "user",
          parts: [{ type: "text", text: "recent turn".repeat(8_000) }],
          createdAt: new Date(),
        },
      ],
      compactionCheckpoint: null,
      compactionState: null,
    } as any);

    await enqueueOrRunBackgroundThreadCompaction("thread-1");

    expect(chatRepository.upsertCompactionState).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        status: "queued",
        source: "background",
      }),
    );
    expect(enqueueChatCompaction).toHaveBeenCalledWith("thread-1");
  });

  it("marks compaction failed when queue submission fails", async () => {
    vi.mocked(chatRepository.selectThreadDetails).mockResolvedValue({
      id: "thread-1",
      title: "Chat",
      userId: "user-1",
      createdAt: new Date(),
      messages: [
        {
          id: "m-1",
          role: "user",
          parts: [{ type: "text", text: "older turn".repeat(10_000) }],
          createdAt: new Date(),
        },
        {
          id: "m-2",
          role: "assistant",
          parts: [{ type: "text", text: "older answer".repeat(10_000) }],
          createdAt: new Date(),
        },
        {
          id: "m-3",
          role: "user",
          parts: [{ type: "text", text: "recent turn".repeat(8_000) }],
          createdAt: new Date(),
        },
      ],
      compactionCheckpoint: null,
      compactionState: null,
    } as any);
    vi.mocked(enqueueChatCompaction).mockRejectedValue(
      new Error("redis unavailable"),
    );

    await expect(
      enqueueOrRunBackgroundThreadCompaction("thread-1"),
    ).rejects.toThrow("redis unavailable");

    expect(chatRepository.upsertCompactionState).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        status: "failed",
        failureCode: "queue_unavailable",
      }),
    );
  });
});
