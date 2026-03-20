import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  __resetChatConcurrencyForTests,
  acquireChatConcurrencyLease,
} from "./chat-concurrency";

describe("chat concurrency", () => {
  const originalRedisUrl = process.env.REDIS_URL;
  const originalPerUserLimit = process.env.CHAT_CONCURRENCY_PER_USER;
  const originalGlobalLimit = process.env.CHAT_CONCURRENCY_GLOBAL;

  beforeEach(() => {
    __resetChatConcurrencyForTests();
    delete process.env.REDIS_URL;
    delete process.env.CHAT_CONCURRENCY_PER_USER;
    delete process.env.CHAT_CONCURRENCY_GLOBAL;
  });

  afterEach(() => {
    __resetChatConcurrencyForTests();
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
    if (originalPerUserLimit === undefined) {
      delete process.env.CHAT_CONCURRENCY_PER_USER;
    } else {
      process.env.CHAT_CONCURRENCY_PER_USER = originalPerUserLimit;
    }
    if (originalGlobalLimit === undefined) {
      delete process.env.CHAT_CONCURRENCY_GLOBAL;
    } else {
      process.env.CHAT_CONCURRENCY_GLOBAL = originalGlobalLimit;
    }
    vi.restoreAllMocks();
  });

  it("enforces the per-user active stream limit", async () => {
    process.env.CHAT_CONCURRENCY_PER_USER = "1";

    const first = await acquireChatConcurrencyLease({ userId: "user-1" });
    const second = await acquireChatConcurrencyLease({ userId: "user-1" });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({
      ok: false,
      code: "per_user_limit",
      status: 429,
    });

    if (first.ok) {
      await first.lease.release();
    }
  });

  it("releases capacity back to the pool", async () => {
    process.env.CHAT_CONCURRENCY_PER_USER = "1";

    const first = await acquireChatConcurrencyLease({ userId: "user-1" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    await first.lease.release();

    const second = await acquireChatConcurrencyLease({ userId: "user-1" });
    expect(second.ok).toBe(true);
    if (second.ok) {
      await second.lease.release();
    }
  });

  it("enforces the global active stream limit", async () => {
    process.env.CHAT_CONCURRENCY_PER_USER = "2";
    process.env.CHAT_CONCURRENCY_GLOBAL = "1";

    const first = await acquireChatConcurrencyLease({ userId: "user-1" });
    const second = await acquireChatConcurrencyLease({ userId: "user-2" });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({
      ok: false,
      code: "global_limit",
      status: 429,
    });

    if (first.ok) {
      await first.lease.release();
    }
  });
});
