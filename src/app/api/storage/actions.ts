"use server";

import { getStorageDriver } from "lib/file-storage";
import { IS_VERCEL_ENV } from "lib/const";

/**
 * Get storage configuration info.
 * Used by clients to determine upload strategy.
 */
export async function getStorageInfoAction() {
  const storageDriver = await getStorageDriver();
  return {
    type: storageDriver,
    supportsDirectUpload:
      storageDriver === "vercel-blob" || storageDriver === "s3",
  };
}

interface StorageCheckResult {
  isValid: boolean;
  error?: string;
  solution?: string;
}

/**
 * Check if storage is properly configured.
 * Returns detailed error messages with solutions.
 */
export async function checkStorageAction(): Promise<StorageCheckResult> {
  const storageDriver = await getStorageDriver();

  // 1. Check Vercel Blob configuration
  if (storageDriver === "vercel-blob") {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return {
        isValid: false,
        error: "BLOB_READ_WRITE_TOKEN is not set",
        solution:
          "Please add Vercel Blob to your project:\n" +
          "1. Go to your Vercel Dashboard\n" +
          "2. Navigate to Storage tab\n" +
          "3. Create a new Blob Store\n" +
          "4. Connect it to your project\n" +
          (IS_VERCEL_ENV
            ? "5. Redeploy your application"
            : "5. Run 'vercel env pull' to get the token locally"),
      };
    }
  }

  // 2. Check S3 configuration
  if (storageDriver === "s3") {
    const envBucket = process.env.FILE_STORAGE_S3_BUCKET;
    const envRegion =
      process.env.FILE_STORAGE_S3_REGION || process.env.AWS_REGION;

    // If env vars are incomplete, check whether DB settings cover them
    if (!envBucket || !envRegion) {
      try {
        const { pgSettingsRepository } = await import(
          "lib/db/pg/repositories/settings-repository.pg"
        );
        const minio = (await pgSettingsRepository.getSetting("minio")) as {
          bucket?: string;
          region?: string;
        } | null;

        const hasBucket = !!envBucket || !!minio?.bucket;
        // DB MinIO config defaults region to "us-east-1" when omitted
        const hasRegion = !!envRegion || !!minio?.region || !!minio?.bucket;

        if (!hasBucket || !hasRegion) {
          const missing: string[] = [];
          if (!hasBucket)
            missing.push(
              "FILE_STORAGE_S3_BUCKET (or configure bucket in Settings → Storage)",
            );
          if (!hasRegion)
            missing.push(
              "FILE_STORAGE_S3_REGION / AWS_REGION (or configure region in Settings → Storage)",
            );
          return {
            isValid: false,
            error: `Missing S3 configuration: ${missing.join(", ")}`,
            solution:
              "Configure S3/MinIO storage in Settings → Storage, or add environment variables:\n" +
              "- FILE_STORAGE_S3_BUCKET=your-bucket\n" +
              "- FILE_STORAGE_S3_REGION=your-region (e.g., us-east-1)\n" +
              "(Optional) FILE_STORAGE_S3_ENDPOINT for S3-compatible stores (e.g., MinIO)\n" +
              "(Optional) FILE_STORAGE_S3_FORCE_PATH_STYLE=1 for path-style endpoints",
          };
        }
      } catch {
        const missing: string[] = [];
        if (!envBucket) missing.push("FILE_STORAGE_S3_BUCKET");
        if (!envRegion) missing.push("FILE_STORAGE_S3_REGION or AWS_REGION");
        return {
          isValid: false,
          error: `Missing S3 configuration: ${missing.join(", ")}`,
          solution:
            "Add required env vars for S3 file storage:\n" +
            "- FILE_STORAGE_TYPE=s3\n" +
            "- FILE_STORAGE_S3_BUCKET=your-bucket\n" +
            "- FILE_STORAGE_S3_REGION=your-region (e.g., us-east-1)\n" +
            "(Optional) FILE_STORAGE_S3_PUBLIC_BASE_URL=https://cdn.example.com\n" +
            "(Optional) FILE_STORAGE_S3_ENDPOINT for S3-compatible stores (e.g., MinIO)\n" +
            "(Optional) FILE_STORAGE_S3_FORCE_PATH_STYLE=1 for path-style endpoints",
        };
      }
    }

    // Warn if neither a public base URL nor a public bucket policy is set.
    // We can't reliably detect bucket policy here; we just pass validation.
    return { isValid: true };
  }

  // 3. Validate storage driver
  if (!["vercel-blob", "s3"].includes(storageDriver)) {
    return {
      isValid: false,
      error: `Invalid storage driver: ${storageDriver}`,
      solution:
        "FILE_STORAGE_TYPE must be one of:\n" +
        "- 'vercel-blob' (default)\n" +
        "- 's3' (coming soon)",
    };
  }

  return {
    isValid: true,
  };
}
