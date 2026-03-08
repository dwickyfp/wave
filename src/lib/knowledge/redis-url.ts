import "server-only";

export async function getRedisUrl(): Promise<string> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error(
      "REDIS_URL is not configured. Set REDIS_URL in the environment for the app and knowledge worker.",
    );
  }

  return redisUrl;
}
