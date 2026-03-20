import { MemoryCache } from "./memory-cache";
import { SafeRedisCache } from "./safe-redis-cache";

import { Cache } from "./cache.interface";
import { IS_DEV } from "lib/const";
import logger from "logger";

declare global {
  // eslint-disable-next-line no-var
  var __server__cache__: Cache | undefined;
}

const createCache = () => {
  const redisUrl = process.env.REDIS_URL;

  if (IS_DEV) {
    logger.info("Using MemoryCache for development");
    return new MemoryCache();
  }

  if (redisUrl) {
    logger.info("Using SafeRedisCache with memory fallback");
    return new SafeRedisCache({
      redisUrl,
      fallbackToMemory: true,
      keyPrefix: "server-cache:",
      redisOptions: {
        retryStrategy: (times) => {
          if (times > 3) {
            logger.error("Redis connection failed after 3 retries");
            return null;
          }
          return Math.min(times * 1000, 3000);
        },
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
        connectTimeout: 5000,
        commandTimeout: 5000,
        lazyConnect: true,
      },
    });
  }

  throw new Error(
    "REDIS_URL is required in production for shared cache and queue-backed features.",
  );
};

const serverCache = globalThis.__server__cache__ || createCache();

globalThis.__server__cache__ = serverCache;

export { serverCache };
