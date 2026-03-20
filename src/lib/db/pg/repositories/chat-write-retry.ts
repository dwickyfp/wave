type RetryableChatWriteOptions = {
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
  onRetry?: (input: {
    attempt: number;
    error: unknown;
    nextDelayMs: number;
  }) => void;
};

const RETRYABLE_CHAT_WRITE_CODES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "53300",
  "57P01",
  "57P02",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
]);

const RETRYABLE_CHAT_WRITE_PATTERNS = [
  "connection terminated due to connection timeout",
  "connection terminated unexpectedly",
  "connection ended unexpectedly",
  "terminating connection due to administrator command",
  "the database system is starting up",
  "too many clients already",
  "sorry, too many clients already",
  "timeout expired",
];

function collectErrorChain(error: unknown): Array<{
  message: string;
  code: string | null;
}> {
  const entries: Array<{
    message: string;
    code: string | null;
  }> = [];
  const visited = new Set<unknown>();
  const queue: unknown[] = [error];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null || visited.has(current)) continue;
    visited.add(current);

    if (current instanceof Error) {
      const code = (current as Error & { code?: unknown }).code;
      entries.push({
        message: current.message.toLowerCase(),
        code: typeof code === "string" ? code : null,
      });
      queue.push((current as Error & { cause?: unknown }).cause);
      continue;
    }

    if (typeof current === "object") {
      const maybeMessage =
        typeof (current as { message?: unknown }).message === "string"
          ? (current as { message: string }).message.toLowerCase()
          : "";
      const maybeCode =
        typeof (current as { code?: unknown }).code === "string"
          ? (current as { code: string }).code
          : null;
      entries.push({
        message: maybeMessage,
        code: maybeCode,
      });
      queue.push((current as { cause?: unknown }).cause);
    }
  }

  return entries;
}

export function isRetryableChatWriteError(error: unknown): boolean {
  return collectErrorChain(error).some(({ message, code }) => {
    if (code && RETRYABLE_CHAT_WRITE_CODES.has(code)) {
      return true;
    }

    return RETRYABLE_CHAT_WRITE_PATTERNS.some((pattern) =>
      message.includes(pattern),
    );
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetryableChatWrite<T>(
  operation: () => Promise<T>,
  options: RetryableChatWriteOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  let nextDelayMs = options.delayMs ?? 250;
  const backoffMultiplier = options.backoffMultiplier ?? 2;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableChatWriteError(error)) {
        throw error;
      }

      options.onRetry?.({
        attempt,
        error,
        nextDelayMs,
      });
      await sleep(nextDelayMs);
      nextDelayMs *= backoffMultiplier;
    }
  }

  throw new Error("Unreachable retry state for chat write.");
}
