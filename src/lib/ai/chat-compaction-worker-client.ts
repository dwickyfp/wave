import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getRedisUrl } from "@/lib/knowledge/redis-url";

export type CompactThreadJob = {
  type: "compact-thread";
  threadId: string;
};

export type ChatCompactionJob = CompactThreadJob;

const QUEUE_NAME = "chat-compaction";

let queuePromise: Promise<Queue> | null = null;

async function createQueue(): Promise<Queue> {
  const redisUrl = await getRedisUrl();
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  return new Queue(QUEUE_NAME, {
    connection: connection as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });
}

function getChatCompactionQueue(): Promise<Queue> {
  if (!queuePromise) {
    queuePromise = createQueue();
  }

  return queuePromise;
}

export async function enqueueChatCompaction(threadId: string): Promise<void> {
  const queue = await getChatCompactionQueue();
  await queue.add(
    "compact-thread",
    { type: "compact-thread", threadId } satisfies ChatCompactionJob,
    { jobId: `compact-thread-${threadId}` },
  );
}
