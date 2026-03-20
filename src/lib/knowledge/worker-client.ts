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
  const queue = new Queue(QUEUE_NAME, {
    connection: connection as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });
  await queue.waitUntilReady();
  return queue;
}

function getKnowledgeQueue(): Promise<Queue> {
  if (!_queuePromise) {
    _queuePromise = createQueue();
  }
  return _queuePromise;
}

export function resetKnowledgeQueueForTests() {
  _queuePromise = null;
}

function getIngestDocumentJobId(documentId: string) {
  return `ingest-${documentId}`;
}

function isMatchingIngestDocumentJob(
  job: {
    name?: string;
    data?: Partial<IngestDocumentJob> | null;
  },
  documentId: string,
): boolean {
  return (
    job.name === "ingest-document" &&
    job.data?.type === "ingest-document" &&
    job.data.documentId === documentId
  );
}

export async function enqueueIngestDocument(
  documentId: string,
  groupId: string,
): Promise<void> {
  const queue = await getKnowledgeQueue();
  const jobId = getIngestDocumentJobId(documentId);
  const existingJob = await queue.getJob(jobId);

  if (existingJob) {
    const state = await existingJob.getState();
    if (state === "completed" || state === "failed") {
      await existingJob.remove().catch((error) => {
        console.warn(
          `[ContextX Queue] Failed to clear completed ingest job ${jobId} for document ${documentId}:`,
          error,
        );
      });
    } else {
      return;
    }
  }

  await queue.add(
    "ingest-document",
    { type: "ingest-document", documentId, groupId } satisfies KnowledgeJob,
    { jobId },
  );
}

export async function cancelIngestDocument(documentId: string): Promise<{
  removed: number;
  active: number;
}> {
  const queue = await getKnowledgeQueue();
  const removableJobs = await queue.getJobs([
    "waiting",
    "delayed",
    "prioritized",
    "paused",
  ]);
  const matchingRemovableJobs = removableJobs.filter((job) =>
    isMatchingIngestDocumentJob(job as any, documentId),
  );
  await Promise.all(
    matchingRemovableJobs.map((job) =>
      job.remove().catch((error) => {
        console.warn(
          `[ContextX Queue] Failed to remove ingest job ${job.id} for document ${documentId}:`,
          error,
        );
      }),
    ),
  );

  const activeJobs = await queue.getJobs(["active"]);
  const active = activeJobs.filter((job) =>
    isMatchingIngestDocumentJob(job as any, documentId),
  ).length;

  return {
    removed: matchingRemovableJobs.length,
    active,
  };
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

export async function getKnowledgeQueueCounts() {
  const queue = await getKnowledgeQueue();

  return queue.getJobCounts(
    "waiting",
    "active",
    "delayed",
    "paused",
    "completed",
    "failed",
  );
}
