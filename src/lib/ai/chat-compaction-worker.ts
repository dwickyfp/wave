import { Job, Worker } from "bullmq";
import IORedis from "ioredis";
import { getRedisUrl } from "@/lib/knowledge/redis-url";
import { ChatCompactionJob } from "./chat-compaction-worker-client";
import { runBackgroundThreadCompaction } from "./chat-compaction-background";

const QUEUE_NAME = "chat-compaction";

async function main() {
  const redisUrl = await getRedisUrl();
  console.log(`[Chat Compaction Worker] Connecting to Redis: ${redisUrl}`);

  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker<ChatCompactionJob>(
    QUEUE_NAME,
    async (job: Job<ChatCompactionJob>) => {
      if (job.data.type === "compact-thread") {
        await runBackgroundThreadCompaction(job.data.threadId);
      }
    },
    {
      connection: connection as any,
      concurrency: 3,
    },
  );

  worker.on("completed", (job) => {
    console.log(`[Chat Compaction Worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[Chat Compaction Worker] Job ${job?.id} failed:`, err);
  });

  console.log(
    "[Chat Compaction Worker] Started, listening on queue:",
    QUEUE_NAME,
  );
}

main().catch((error) => {
  console.error("[Chat Compaction Worker] Fatal startup error:", error);
  process.exit(1);
});
