import { Queue } from "bullmq";
import IORedis from "ioredis";

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

let _queue: Queue | null = null;
let _connection: IORedis | null = null;

function getConnection(): IORedis {
  if (!_connection) {
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    _connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }
  return _connection;
}

export function getKnowledgeQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, {
      connection: getConnection() as any,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return _queue;
}

export async function enqueueIngestDocument(
  documentId: string,
  groupId: string,
): Promise<void> {
  const queue = getKnowledgeQueue();
  await queue.add(
    "ingest-document",
    { type: "ingest-document", documentId, groupId } satisfies KnowledgeJob,
    { jobId: `ingest-${documentId}` },
  );
}

export async function enqueueReembedGroup(groupId: string): Promise<void> {
  const queue = getKnowledgeQueue();
  await queue.add(
    "reembed-group",
    { type: "reembed-group", groupId } satisfies KnowledgeJob,
    { jobId: `reembed-${groupId}-${Date.now()}` },
  );
}
