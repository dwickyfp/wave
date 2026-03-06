import "server-only";
import { settingsRepository } from "lib/db/repository";

/**
 * Resolve the Redis connection URL.
 *
 * Priority:
 * 1. `redis-config` key stored in system_settings (configured via Settings page)
 * 2. `REDIS_URL` environment variable
 * 3. Hard-coded local default: redis://localhost:6379
 */
export async function getRedisUrl(): Promise<string> {
  try {
    const config = (await settingsRepository.getSetting("redis-config")) as {
      url?: string;
    } | null;
    if (config?.url?.trim()) {
      return config.url.trim();
    }
  } catch {
    // DB not available – fall back to env
  }
  return process.env.REDIS_URL || "redis://localhost:6379";
}
