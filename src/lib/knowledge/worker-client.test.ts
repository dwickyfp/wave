import { beforeEach, describe, expect, it, vi } from "vitest";

const { queueMock, QueueMock, RedisMock } = vi.hoisted(() => ({
  queueMock: {
    waitUntilReady: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockResolvedValue(null),
    getJobs: vi.fn().mockResolvedValue([]),
    getJobCounts: vi.fn().mockResolvedValue({}),
  },
  QueueMock: vi.fn(),
  RedisMock: vi.fn(),
}));

QueueMock.mockImplementation(() => queueMock);

vi.mock("bullmq", () => ({
  Queue: QueueMock,
}));

vi.mock("ioredis", () => ({
  default: RedisMock,
}));

vi.mock("./redis-url", () => ({
  getRedisUrl: vi.fn().mockResolvedValue("redis://localhost:6379"),
}));

const { enqueueIngestDocument, resetKnowledgeQueueForTests } = await import(
  "./worker-client"
);

describe("worker-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueMock.waitUntilReady.mockResolvedValue(undefined);
    queueMock.add.mockResolvedValue(undefined);
    queueMock.getJob.mockResolvedValue(null);
    queueMock.getJobs.mockResolvedValue([]);
    resetKnowledgeQueueForTests();
  });

  it("skips enqueueing a duplicate ingest job while one is already active", async () => {
    queueMock.getJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue("active"),
      remove: vi.fn(),
    });

    await enqueueIngestDocument("doc-1", "group-1");

    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it("replaces a completed ingest job before enqueueing a new one", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    queueMock.getJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue("completed"),
      remove,
    });

    await enqueueIngestDocument("doc-1", "group-1");

    expect(remove).toHaveBeenCalled();
    expect(queueMock.add).toHaveBeenCalledWith(
      "ingest-document",
      {
        type: "ingest-document",
        documentId: "doc-1",
        groupId: "group-1",
      },
      { jobId: "ingest-doc-1" },
    );
  });
});
