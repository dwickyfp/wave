import { Job, QueueEvents, Worker } from "bullmq";
import IORedis from "ioredis";
import { getRedisUrl } from "@/lib/knowledge/redis-url";
import { selfLearningRepository } from "lib/db/repository";
import {
  getSelfLearningSystemConfig,
  rebuildPersonalizationKnowledge,
  runSelfLearningEvaluationForUser,
} from "./service";
import {
  SELF_LEARNING_QUEUE_NAME,
  SelfLearningJob,
  ensureSelfLearningDailyScheduler,
  enqueueEvaluateUser,
  enqueueRebuildPersonalizationKnowledge,
  getSelfLearningQueueCounts,
  hasSelfLearningJob,
} from "./worker-client";

const QUEUED_RUN_RECOVERY_INTERVAL_MS = 30_000;

async function handleDailyBatchScan() {
  const system = await getSelfLearningSystemConfig();
  await ensureSelfLearningDailyScheduler(system.dailySchedulerPattern);

  if (!system.isRunning) return;

  const userIds = await selfLearningRepository.listEligibleUserIds();
  await Promise.all(
    userIds.map((userId) =>
      enqueueEvaluateUser({
        userId,
        trigger: "daily",
      }),
    ),
  );
}

async function recoverQueuedRuns() {
  const queuedRuns = await selfLearningRepository.listQueuedRuns(50);

  if (queuedRuns.length === 0) {
    return;
  }

  for (const run of queuedRuns) {
    if (run.trigger !== "manual" && run.trigger !== "daily") {
      continue;
    }

    const jobId = `evaluate-${run.id}`;
    const jobExists = await hasSelfLearningJob(jobId);

    if (jobExists) {
      continue;
    }

    const metadata = (run.metadata ?? {}) as {
      bypassPause?: boolean;
      queuedBy?: string;
    };

    console.log(
      `[Self-Learning Worker] Recovering queued run ${run.id} for user ${run.userId}`,
    );

    await enqueueEvaluateUser({
      userId: run.userId,
      trigger: run.trigger,
      runId: run.id,
      actorUserId: metadata.queuedBy,
      bypassPause: Boolean(metadata.bypassPause),
    });
  }
}

async function main() {
  const redisUrl = await getRedisUrl();
  console.log(`[Self-Learning Worker] Connecting to Redis: ${redisUrl}`);

  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
  });
  connection.on("ready", () => {
    console.log("[Self-Learning Worker] Redis connection ready");
  });
  connection.on("error", (error) => {
    console.error("[Self-Learning Worker] Redis connection error:", error);
  });

  const system = await getSelfLearningSystemConfig();
  await ensureSelfLearningDailyScheduler(system.dailySchedulerPattern);

  const queueEvents = new QueueEvents(SELF_LEARNING_QUEUE_NAME, {
    connection: connection.duplicate() as any,
  });

  const worker = new Worker<SelfLearningJob>(
    SELF_LEARNING_QUEUE_NAME,
    async (job: Job<SelfLearningJob>) => {
      console.log(
        `[Self-Learning Worker] Processing job ${job.id} (${job.name})`,
      );

      if (job.data.type === "daily-batch-scan") {
        await handleDailyBatchScan();
        return;
      }

      if (job.data.type === "evaluate-user") {
        const result = await runSelfLearningEvaluationForUser({
          userId: job.data.userId,
          trigger: job.data.trigger,
          runId: job.data.runId,
          actorUserId: job.data.actorUserId,
          bypassPause: job.data.bypassPause,
        });

        if (result.appliedMemoryIds.length > 0) {
          await enqueueRebuildPersonalizationKnowledge(job.data.userId);
        }
        return;
      }

      if (job.data.type === "rebuild-personalization-knowledge") {
        await rebuildPersonalizationKnowledge(job.data.userId);
      }
    },
    {
      connection: connection as any,
      concurrency: 3,
    },
  );

  worker.on("ready", () => {
    console.log("[Self-Learning Worker] Worker ready");
  });
  worker.on("active", (job) => {
    console.log(`[Self-Learning Worker] Job ${job.id} is active`);
  });
  worker.on("error", (error) => {
    console.error("[Self-Learning Worker] Worker error:", error);
  });
  worker.on("stalled", (jobId) => {
    console.warn(`[Self-Learning Worker] Job ${jobId} stalled`);
  });

  worker.on("completed", (job) => {
    console.log(`[Self-Learning Worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[Self-Learning Worker] Job ${job?.id} failed:`, error);
  });

  queueEvents.on("waiting", ({ jobId }) => {
    console.log(`[Self-Learning Worker] Job ${jobId} waiting in Redis`);
  });
  queueEvents.on("active", ({ jobId }) => {
    console.log(`[Self-Learning Worker] Job ${jobId} moved to active`);
  });
  queueEvents.on("completed", ({ jobId }) => {
    console.log(`[Self-Learning Worker] Job ${jobId} completed in Redis`);
  });
  queueEvents.on("failed", ({ jobId, failedReason }) => {
    console.error(
      `[Self-Learning Worker] Job ${jobId} failed in Redis: ${failedReason}`,
    );
  });

  await Promise.all([worker.waitUntilReady(), queueEvents.waitUntilReady()]);

  await recoverQueuedRuns();

  console.log(
    "[Self-Learning Worker] Initial queue counts:",
    await getSelfLearningQueueCounts(),
  );

  const recoveryInterval = setInterval(() => {
    recoverQueuedRuns().catch((error) => {
      console.error(
        "[Self-Learning Worker] Queued run recovery failed:",
        error,
      );
    });
  }, QUEUED_RUN_RECOVERY_INTERVAL_MS);
  recoveryInterval.unref();

  console.log(
    "[Self-Learning Worker] Started, listening on queue:",
    SELF_LEARNING_QUEUE_NAME,
  );
}

main().catch((error) => {
  console.error("[Self-Learning Worker] Fatal startup error:", error);
  process.exit(1);
});
