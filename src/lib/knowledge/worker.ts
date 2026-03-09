/**
 * ContextX Knowledge Ingestion Worker
 * Run with: pnpm worker:knowledge-win / worker:knowledge-mac
 *
 * Redis connection is configured through the REDIS_URL environment variable.
 */
import { Job, Worker } from "bullmq";
import IORedis from "ioredis";
import { knowledgeRepository } from "lib/db/repository";
import { runIngestPipeline } from "./ingest-pipeline";
import { getRedisUrl } from "./redis-url";
import {
  markDocumentVersionFailed,
  runMarkdownEditVersion,
  runRollbackVersion,
} from "./versioning";
import { KnowledgeJob } from "./worker-client";

const QUEUE_NAME = "contextx-ingest";

async function handleReembedGroup(groupId: string): Promise<void> {
  const docs = await knowledgeRepository.selectDocumentsByGroupId(groupId);
  const readyDocs = docs.filter((d) => d.status === "ready");

  for (const doc of readyDocs) {
    try {
      await runIngestPipeline(doc.id, groupId);
    } catch (err) {
      console.error(
        `[ContextX Worker] Failed to re-embed document ${doc.id}:`,
        err,
      );
      await knowledgeRepository.updateDocumentStatus(doc.id, "failed", {
        errorMessage: String(err),
      });
    }
  }
}

async function main() {
  const redisUrl = await getRedisUrl();
  console.log(`[ContextX Worker] Connecting to Redis: ${redisUrl}`);

  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker<KnowledgeJob>(
    QUEUE_NAME,
    async (job: Job<KnowledgeJob>) => {
      const data = job.data;

      if (data.type === "ingest-document") {
        await runIngestPipeline(data.documentId, data.groupId);
      } else if (data.type === "reembed-group") {
        await handleReembedGroup(data.groupId);
      } else if (data.type === "materialize-document-version") {
        await runMarkdownEditVersion({
          versionId: data.versionId,
          expectedActiveVersionId: data.expectedActiveVersionId ?? null,
        });
      } else if (data.type === "rollback-document-version") {
        await runRollbackVersion({
          versionId: data.versionId,
          expectedActiveVersionId: data.expectedActiveVersionId ?? null,
        });
      }
    },
    {
      connection: connection as any,
      concurrency: 5,
    },
  );

  worker.on("completed", (job) => {
    console.log(`[ContextX Worker] Job ${job.id} completed`);
  });

  worker.on("failed", async (job, err) => {
    console.error(`[ContextX Worker] Job ${job?.id} failed:`, err);
    if (job?.data?.type === "ingest-document") {
      await knowledgeRepository
        .updateDocumentStatus((job.data as any).documentId, "failed", {
          errorMessage: String(err),
        })
        .catch(() => {});
    } else if (
      job?.data?.type === "materialize-document-version" ||
      job?.data?.type === "rollback-document-version"
    ) {
      await markDocumentVersionFailed({
        versionId: job.data.versionId,
        errorMessage: String(err),
        updateDocumentStatus: false,
      }).catch(() => {});
    }
  });

  console.log("[ContextX Worker] Started, listening on queue:", QUEUE_NAME);
}

main().catch((err) => {
  console.error("[ContextX Worker] Fatal startup error:", err);
  process.exit(1);
});
