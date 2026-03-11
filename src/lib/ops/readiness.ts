import "server-only";
import IORedis from "ioredis";
import { sql } from "drizzle-orm";
import { getChatCompactionQueueCounts } from "lib/ai/chat-compaction-worker-client";
import { pgDb } from "lib/db/pg/db.pg";
import { getFileStorage, getStorageDriver } from "lib/file-storage";
import { getRedisUrl } from "lib/knowledge/redis-url";
import { getKnowledgeQueueCounts } from "lib/knowledge/worker-client";
import { getSelfLearningQueueCounts } from "lib/self-learning/worker-client";

type ReadinessCheck = {
  ok: boolean;
  latencyMs: number;
  details?: unknown;
  error?: string;
};

type ReadinessReport = {
  ok: boolean;
  timestamp: string;
  checks: {
    db: ReadinessCheck;
    redis: ReadinessCheck;
    storage: ReadinessCheck;
    queues: {
      knowledge: ReadinessCheck;
      chatCompaction: ReadinessCheck;
      selfLearning: ReadinessCheck;
    };
  };
};

async function measureCheck<T>(
  run: () => Promise<T>,
  mapDetails?: (value: T) => unknown,
): Promise<ReadinessCheck> {
  const startedAt = Date.now();

  try {
    const value = await run();
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      details: mapDetails ? mapDetails(value) : value,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function pingRedis(): Promise<string> {
  const redisUrl = await getRedisUrl();
  const redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  try {
    return await redis.ping();
  } finally {
    redis.disconnect();
  }
}

async function checkStorage() {
  const driver = await getStorageDriver();
  if (driver === "none") {
    throw new Error("Shared file storage is not configured.");
  }

  const storage = await getFileStorage();
  await storage.exists("__healthcheck__/storage-probe");

  return { driver };
}

export async function getReadinessReport(): Promise<ReadinessReport> {
  const [
    db,
    redis,
    storage,
    knowledgeQueue,
    chatCompactionQueue,
    selfLearning,
  ] = await Promise.all([
    measureCheck(async () => {
      await pgDb.execute(sql`select 1`);
      return "ok";
    }),
    measureCheck(pingRedis),
    measureCheck(checkStorage),
    measureCheck(getKnowledgeQueueCounts),
    measureCheck(getChatCompactionQueueCounts),
    measureCheck(getSelfLearningQueueCounts),
  ]);

  const report: ReadinessReport = {
    ok:
      db.ok &&
      redis.ok &&
      storage.ok &&
      knowledgeQueue.ok &&
      chatCompactionQueue.ok &&
      selfLearning.ok,
    timestamp: new Date().toISOString(),
    checks: {
      db,
      redis,
      storage,
      queues: {
        knowledge: knowledgeQueue,
        chatCompaction: chatCompactionQueue,
        selfLearning,
      },
    },
  };

  return report;
}
