/**
 * ContextX Knowledge Ingestion Worker
 * Run with: pnpm worker:knowledge-win / worker:knowledge-mac
 *
 * Redis URL resolution priority:
 * 1. `redis-config` key in system_settings DB (Settings → Other Configurations)
 * 2. REDIS_URL environment variable
 * 3. redis://localhost:6379
 */
import { Job, Worker } from "bullmq";
import IORedis from "ioredis";
import { knowledgeRepository } from "lib/db/repository";
import { runIngestPipeline } from "./ingest-pipeline";
import { getRedisUrl } from "./redis-url";
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
    }
  });

  console.log("[ContextX Worker] Started, listening on queue:", QUEUE_NAME);
}

main().catch((err) => {
  console.error("[ContextX Worker] Fatal startup error:", err);
  process.exit(1);
});
