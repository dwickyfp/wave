import { describe, expect, it, vi } from "vitest";

import {
  isRetryableChatWriteError,
  withRetryableChatWrite,
} from "./chat-write-retry";

describe("chat write retry", () => {
  it("detects retryable nested connection timeout errors", () => {
    const error = new Error("failed to persist chat message", {
      cause: new Error("Connection terminated due to connection timeout"),
    });

    expect(isRetryableChatWriteError(error)).toBe(true);
  });

  it("retries retryable writes and eventually succeeds", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Connection terminated unexpectedly"))
      .mockResolvedValueOnce("ok");
    const onRetry = vi.fn();

    await expect(
      withRetryableChatWrite(operation, {
        delayMs: 0,
        onRetry,
      }),
    ).resolves.toBe("ok");

    expect(operation).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-retryable errors", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error("invalid input syntax for type uuid"));

    await expect(
      withRetryableChatWrite(operation, {
        delayMs: 0,
      }),
    ).rejects.toThrow("invalid input syntax for type uuid");

    expect(operation).toHaveBeenCalledTimes(1);
  });
});
