import "server-only";
import type { FileStorage } from "./file-storage.interface";
import { createS3FileStorage } from "./s3-file-storage";
import type { S3StorageConfig } from "./s3-file-storage";
import {
  createVercelBlobStorage,
  type VercelBlobStorageConfig,
} from "./vercel-blob-storage";
import logger from "logger";

export type FileStorageDriver = "vercel-blob" | "s3" | "none";

declare global {
  // eslint-disable-next-line no-var
  var __server__file_storage__: Promise<FileStorage> | undefined;
}

/**
 * Read unified storage config from the "file-storage-config" DB key.
 * Falls back to the legacy "minio" key for backward compatibility.
 * Returns null when no config is found.
 */
async function readDbStorageConfig(): Promise<{
  type: FileStorageDriver;
  s3?: Partial<S3StorageConfig>;
  vercelBlob?: Partial<VercelBlobStorageConfig>;
} | null> {
  try {
    const { pgSettingsRepository } = await import(
      "lib/db/pg/repositories/settings-repository.pg"
    );

    // Prefer the unified key
    const cfg = (await pgSettingsRepository.getSetting(
      "file-storage-config",
    )) as {
      type?: string;
      s3?: {
        bucket?: string;
        region?: string;
        endpoint?: string;
        accessKey?: string;
        secretKey?: string;
        publicBaseUrl?: string;
        forcePathStyle?: boolean;
      };
      vercelBlob?: { token?: string };
    } | null;

    if (cfg?.type && cfg.type !== "none") {
      const type = cfg.type as FileStorageDriver;
      return {
        type,
        s3:
          type === "s3" && cfg.s3
            ? {
                bucket: cfg.s3.bucket || undefined,
                region: cfg.s3.region || "us-east-1",
                endpoint: cfg.s3.endpoint || undefined,
                forcePathStyle: cfg.s3.forcePathStyle ?? !!cfg.s3.endpoint,
                publicBaseUrl: cfg.s3.publicBaseUrl || undefined,
                accessKeyId: cfg.s3.accessKey || undefined,
                secretAccessKey: cfg.s3.secretKey || undefined,
              }
            : undefined,
        vercelBlob:
          type === "vercel-blob" && cfg.vercelBlob
            ? { token: cfg.vercelBlob.token || undefined }
            : undefined,
      };
    }

    // Legacy fallback: read the old "minio" key
    const minio = (await pgSettingsRepository.getSetting("minio")) as {
      bucket?: string;
      region?: string;
      endpoint?: string;
      accessKey?: string;
      secretKey?: string;
    } | null;
    if (minio?.bucket) {
      return {
        type: "s3",
        s3: {
          bucket: minio.bucket,
          region: minio.region || "us-east-1",
          endpoint: minio.endpoint || undefined,
          forcePathStyle: !!minio.endpoint,
          accessKeyId: minio.accessKey || undefined,
          secretAccessKey: minio.secretKey || undefined,
        },
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function createFileStorage(): Promise<FileStorage> {
  const dbConfig = await readDbStorageConfig();

  // Determine driver: DB config > env var > default
  const envDriver = process.env.FILE_STORAGE_TYPE?.trim().toLowerCase();
  const driver: FileStorageDriver =
    dbConfig?.type ??
    (envDriver === "s3" || envDriver === "vercel-blob" ? envDriver : "none");

  logger.info(`Creating file storage: ${driver}`);

  switch (driver) {
    case "vercel-blob":
      return createVercelBlobStorage(dbConfig?.vercelBlob);

    case "s3": {
      // DB config takes precedence; env vars are used only when DB has no config
      const envBucket = process.env.FILE_STORAGE_S3_BUCKET;
      const hasEnvConfig = !!envBucket;
      const cfg = dbConfig?.s3 ?? (hasEnvConfig ? undefined : undefined);
      return createS3FileStorage(cfg);
    }

    case "none":
    default:
      // Return a stub that throws on all operations
      return new Proxy({} as FileStorage, {
        get(_, prop) {
          return () => {
            throw new Error(
              `File storage is not configured. Set FILE_STORAGE_TYPE or configure storage in Settings. (called: ${String(prop)})`,
            );
          };
        },
      });
  }
}

/**
 * Returns (and lazily initialises) the shared FileStorage instance.
 * Uses globalThis to survive hot-module reloads in dev mode.
 */
export function getFileStorage(): Promise<FileStorage> {
  if (!globalThis.__server__file_storage__) {
    globalThis.__server__file_storage__ = createFileStorage();
  }
  return globalThis.__server__file_storage__;
}

/**
 * Invalidate the cached storage instance (e.g. after settings change).
 */
export function resetFileStorage(): void {
  globalThis.__server__file_storage__ = undefined;
}

/**
 * Resolve the active storage driver without instantiating storage.
 * Async because it may read from the DB.
 */
export async function getStorageDriver(): Promise<FileStorageDriver> {
  const dbConfig = await readDbStorageConfig();
  if (dbConfig?.type) return dbConfig.type;
  const envDriver = process.env.FILE_STORAGE_TYPE?.trim().toLowerCase();
  if (envDriver === "s3" || envDriver === "vercel-blob") return envDriver;
  return "none";
}

/**
 * Backward-compatible proxy that forwards every method call to the
 * lazily-resolved storage instance.  All FileStorage methods return
 * Promises, so callers that do `await serverFileStorage.upload(…)`
 * continue to work without modification.
 */
export const serverFileStorage: FileStorage = new Proxy({} as FileStorage, {
  get(_, prop: string | symbol) {
    return (...args: unknown[]) =>
      getFileStorage().then((s) => (s as any)[prop](...args));
  },
});
