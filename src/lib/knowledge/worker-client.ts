import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getRedisUrl } from "./redis-url";

export type IngestDocumentJob = {
  type: "ingest-document";
  documentId: string;
  groupId: string;
};

export type ReembedGroupJob = {
  type: "reembed-group";
  groupId: string;
};

export type KnowledgeJob = IngestDocumentJob | ReembedGroupJob;

const QUEUE_NAME = "contextx-ingest";

// Singleton promise – ensures only one Queue is created per process
// even if enqueue functions are called concurrently before init completes.
let _queuePromise: Promise<Queue> | null = null;

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

function getKnowledgeQueue(): Promise<Queue> {
  if (!_queuePromise) {
    _queuePromise = createQueue();
  }
  return _queuePromise;
}

export async function enqueueIngestDocument(
  documentId: string,
  groupId: string,
): Promise<void> {
  const queue = await getKnowledgeQueue();
  await queue.add(
    "ingest-document",
    { type: "ingest-document", documentId, groupId } satisfies KnowledgeJob,
    { jobId: `ingest-${documentId}-${Date.now()}` },
  );
}

export async function enqueueReembedGroup(groupId: string): Promise<void> {
  const queue = await getKnowledgeQueue();
  await queue.add(
    "reembed-group",
    { type: "reembed-group", groupId } satisfies KnowledgeJob,
    { jobId: `reembed-${groupId}-${Date.now()}` },
  );
}
