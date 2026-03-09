import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getRedisUrl } from "@/lib/knowledge/redis-url";

export type DailyBatchScanJob = {
  type: "daily-batch-scan";
};

export type EvaluateUserJob = {
  type: "evaluate-user";
  userId: string;
  trigger: "daily" | "manual";
  runId?: string;
  actorUserId?: string;
  bypassPause?: boolean;
};

export type RebuildPersonalizationKnowledgeJob = {
  type: "rebuild-personalization-knowledge";
  userId: string;
};

export type SelfLearningJob =
  | DailyBatchScanJob
  | EvaluateUserJob
  | RebuildPersonalizationKnowledgeJob;

export const SELF_LEARNING_QUEUE_NAME = "self-learning-evaluation";
const DAILY_SCHEDULER_ID = "self-learning-daily-batch";

let queuePromise: Promise<Queue<SelfLearningJob>> | null = null;

async function createQueue(): Promise<Queue<SelfLearningJob>> {
  const redisUrl = await getRedisUrl();
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  const queue = new Queue<SelfLearningJob>(SELF_LEARNING_QUEUE_NAME, {
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

async function getQueue(): Promise<Queue<SelfLearningJob>> {
  if (!queuePromise) {
    queuePromise = createQueue();
  }

  return queuePromise;
}

function todayKeyUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function ensureSelfLearningDailyScheduler(
  pattern: string,
): Promise<void> {
  const queue = await getQueue();
  const job = await queue.upsertJobScheduler(
    DAILY_SCHEDULER_ID,
    { pattern },
    {
      name: "daily-batch-scan",
      data: { type: "daily-batch-scan" },
    },
  );

  console.log(
    "[Self-Learning Queue] Daily scheduler ensured:",
    DAILY_SCHEDULER_ID,
    pattern,
    job?.id ?? "no-job-id",
  );
}

export async function enqueueEvaluateUser(input: {
  userId: string;
  trigger: "daily" | "manual";
  runId?: string;
  actorUserId?: string;
  bypassPause?: boolean;
}): Promise<void> {
  const queue = await getQueue();
  const jobId =
    input.trigger === "daily"
      ? `evaluate-${input.userId}-${todayKeyUtc()}`
      : input.runId
        ? `evaluate-${input.runId}`
        : `evaluate-${input.userId}-manual-${Date.now()}`;

  const job = await queue.add(
    "evaluate-user",
    {
      type: "evaluate-user",
      userId: input.userId,
      trigger: input.trigger,
      runId: input.runId,
      actorUserId: input.actorUserId,
      bypassPause: input.bypassPause ?? false,
    },
    { jobId },
  );

  console.log(
    "[Self-Learning Queue] Enqueued evaluate-user job:",
    job.id,
    "for user",
    input.userId,
    "trigger",
    input.trigger,
  );
}

export async function enqueueRebuildPersonalizationKnowledge(
  userId: string,
): Promise<void> {
  const queue = await getQueue();
  const job = await queue.add(
    "rebuild-personalization-knowledge",
    {
      type: "rebuild-personalization-knowledge",
      userId,
    },
    {
      jobId: `rebuild-personalization-knowledge-${userId}`,
    },
  );

  console.log(
    "[Self-Learning Queue] Enqueued rebuild-personalization-knowledge job:",
    job.id,
    "for user",
    userId,
  );
}

export async function getSelfLearningQueueCounts() {
  const queue = await getQueue();

  return queue.getJobCounts(
    "waiting",
    "active",
    "delayed",
    "paused",
    "completed",
    "failed",
  );
}

export async function hasSelfLearningJob(jobId: string): Promise<boolean> {
  const queue = await getQueue();
  const job = await queue.getJob(jobId);
  return Boolean(job);
}
