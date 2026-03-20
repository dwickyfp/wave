import "server-only";
import IORedis from "ioredis";
import { getRedisUrl } from "lib/knowledge/redis-url";

const USER_COUNTER_PREFIX = "chat:concurrency:user";
const GLOBAL_COUNTER_KEY = "chat:concurrency:global";
const DEFAULT_PER_USER_LIMIT = 2;
const DEFAULT_GLOBAL_LIMIT = 100;
const DEFAULT_SLOT_TTL_SECONDS = 15 * 60;

const ACQUIRE_COUNTER_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], tonumber(ARGV[2]))
end
if current > tonumber(ARGV[1]) then
  redis.call("DECR", KEYS[1])
  return 0
end
return current
`;

const RELEASE_COUNTER_SCRIPT = `
local current = redis.call("DECR", KEYS[1])
if current <= 0 then
  redis.call("DEL", KEYS[1])
  return 0
end
return current
`;

const inMemoryCounters = new Map<string, number>();

declare global {
  // eslint-disable-next-line no-var
  var __chatConcurrencyRedis__: Promise<IORedis> | undefined;
}

export type ChatConcurrencyLease = {
  release: () => Promise<void>;
};

type AcquireChatConcurrencyResult =
  | {
      ok: true;
      lease: ChatConcurrencyLease;
    }
  | {
      ok: false;
      status: number;
      code: "per_user_limit" | "global_limit" | "backend_unavailable";
      message: string;
    };

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getPerUserLimit(): number {
  return parsePositiveInt(
    process.env.CHAT_CONCURRENCY_PER_USER,
    DEFAULT_PER_USER_LIMIT,
  );
}

function getGlobalLimit(): number {
  return parsePositiveInt(
    process.env.CHAT_CONCURRENCY_GLOBAL,
    DEFAULT_GLOBAL_LIMIT,
  );
}

function getSlotTtlSeconds(): number {
  return parsePositiveInt(
    process.env.CHAT_CONCURRENCY_TTL_SECONDS,
    DEFAULT_SLOT_TTL_SECONDS,
  );
}

function canUseInMemoryFallback(): boolean {
  return process.env.NODE_ENV !== "production";
}

async function getRedisClient(): Promise<IORedis | null> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    if (canUseInMemoryFallback()) {
      return null;
    }
    return null;
  }

  if (!globalThis.__chatConcurrencyRedis__) {
    globalThis.__chatConcurrencyRedis__ = (async () => {
      const resolvedRedisUrl = await getRedisUrl();
      const redis = new IORedis(resolvedRedisUrl, {
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });
      await redis.ping();
      return redis;
    })();
  }

  try {
    return await globalThis.__chatConcurrencyRedis__;
  } catch {
    globalThis.__chatConcurrencyRedis__ = undefined;
    if (canUseInMemoryFallback()) {
      return null;
    }
    return null;
  }
}

async function acquireCounter(
  key: string,
  limit: number,
  ttlSeconds: number,
): Promise<boolean | null> {
  const redis = await getRedisClient();
  if (!redis) {
    if (!canUseInMemoryFallback()) return null;
    const next = (inMemoryCounters.get(key) ?? 0) + 1;
    if (next > limit) {
      return false;
    }
    inMemoryCounters.set(key, next);
    return true;
  }

  const result = await redis.eval(
    ACQUIRE_COUNTER_SCRIPT,
    1,
    key,
    String(limit),
    String(ttlSeconds),
  );
  return Number(result) > 0;
}

async function releaseCounter(key: string): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) {
    if (!canUseInMemoryFallback()) return;
    const current = inMemoryCounters.get(key) ?? 0;
    if (current <= 1) {
      inMemoryCounters.delete(key);
      return;
    }
    inMemoryCounters.set(key, current - 1);
    return;
  }

  await redis.eval(RELEASE_COUNTER_SCRIPT, 1, key);
}

export async function acquireChatConcurrencyLease(input: {
  userId: string;
}): Promise<AcquireChatConcurrencyResult> {
  const ttlSeconds = getSlotTtlSeconds();
  const userKey = `${USER_COUNTER_PREFIX}:${input.userId}`;
  const perUserLimit = getPerUserLimit();
  const globalLimit = getGlobalLimit();

  let userSlotAcquired = false;
  const userAcquireResult = await acquireCounter(
    userKey,
    perUserLimit,
    ttlSeconds,
  );
  if (userAcquireResult === null) {
    return {
      ok: false,
      status: 503,
      code: "backend_unavailable",
      message: "Chat capacity protection is unavailable. Please retry shortly.",
    };
  }
  if (!userAcquireResult) {
    return {
      ok: false,
      status: 429,
      code: "per_user_limit",
      message:
        "You already have too many active chat responses. Wait for one to finish and retry.",
    };
  }

  userSlotAcquired = true;

  const globalAcquireResult = await acquireCounter(
    GLOBAL_COUNTER_KEY,
    globalLimit,
    ttlSeconds,
  );
  if (globalAcquireResult === null) {
    await releaseCounter(userKey);
    return {
      ok: false,
      status: 503,
      code: "backend_unavailable",
      message: "Chat capacity protection is unavailable. Please retry shortly.",
    };
  }
  if (!globalAcquireResult) {
    await releaseCounter(userKey);
    return {
      ok: false,
      status: 429,
      code: "global_limit",
      message: "The chat system is busy. Please retry shortly.",
    };
  }

  let released = false;

  return {
    ok: true,
    lease: {
      release: async () => {
        if (released) return;
        released = true;

        await Promise.allSettled([
          releaseCounter(GLOBAL_COUNTER_KEY),
          userSlotAcquired ? releaseCounter(userKey) : Promise.resolve(),
        ]);
      },
    },
  };
}

export function __resetChatConcurrencyForTests() {
  inMemoryCounters.clear();
  globalThis.__chatConcurrencyRedis__ = undefined;
}
