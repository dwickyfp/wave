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

export type MaterializeDocumentVersionJob = {
  type: "materialize-document-version";
  versionId: string;
  expectedActiveVersionId?: string | null;
};

export type RollbackDocumentVersionJob = {
  type: "rollback-document-version";
  versionId: string;
  expectedActiveVersionId?: string | null;
};

export type KnowledgeJob =
  | IngestDocumentJob
  | ReembedGroupJob
  | MaterializeDocumentVersionJob
  | RollbackDocumentVersionJob;

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

export async function enqueueMaterializeDocumentVersion(args: {
  versionId: string;
  expectedActiveVersionId?: string | null;
}): Promise<void> {
  const queue = await getKnowledgeQueue();
  await queue.add(
    "materialize-document-version",
    {
      type: "materialize-document-version",
      versionId: args.versionId,
      expectedActiveVersionId: args.expectedActiveVersionId ?? null,
    } satisfies KnowledgeJob,
    { jobId: `materialize-version-${args.versionId}` },
  );
}

export async function enqueueRollbackDocumentVersion(args: {
  versionId: string;
  expectedActiveVersionId?: string | null;
}): Promise<void> {
  const queue = await getKnowledgeQueue();
  await queue.add(
    "rollback-document-version",
    {
      type: "rollback-document-version",
      versionId: args.versionId,
      expectedActiveVersionId: args.expectedActiveVersionId ?? null,
    } satisfies KnowledgeJob,
    { jobId: `rollback-version-${args.versionId}` },
  );
}
