import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getSession } from "auth/server";
import { getFileStorage, getStorageDriver } from "lib/file-storage";
import {
  assertAllowedUserUpload,
  assertUserScopedUploadPath,
  MAX_USER_UPLOAD_BYTES,
  resolveUserScopedUploadPath,
  StorageUploadPolicyError,
  USER_UPLOAD_ALLOWED_CONTENT_TYPES,
} from "lib/file-storage/upload-policy";
import globalLogger from "lib/logger";
import { colorize } from "consola/utils";
import { checkStorageAction } from "../actions";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", "[Storage Upload URL API]"),
});

// Constants
const DEFAULT_UPLOAD_EXPIRES_SECONDS = 3600; // 1 hour
const FALLBACK_UPLOAD_URL = "/api/storage/upload";

// Types
interface GenericUploadRequest {
  filename?: string;
  contentType?: string;
}

interface FallbackResponse {
  directUploadSupported: false;
  fallbackUrl: string;
  message: string;
}

// Helpers
function createFallbackResponse(): FallbackResponse {
  return {
    directUploadSupported: false,
    fallbackUrl: FALLBACK_UPLOAD_URL,
    message: "Use multipart/form-data upload to fallbackUrl",
  };
}

function isVercelBlobRequest(body: unknown): body is HandleUploadBody {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as HandleUploadBody).type === "blob.generate-client-token"
  );
}

/**
 * Handles Vercel Blob client upload flow.
 * Generates client token and handles upload completion webhook.
 */
async function handleVercelBlobUpload(
  body: HandleUploadBody,
  request: Request,
  userId: string,
) {
  const jsonResponse = await handleUpload({
    body,
    request,
    onBeforeGenerateToken: async (pathname) => {
      assertUserScopedUploadPath(userId, pathname);
      return {
        allowedContentTypes: [...USER_UPLOAD_ALLOWED_CONTENT_TYPES],
        maximumSizeInBytes: MAX_USER_UPLOAD_BYTES,
        addRandomSuffix: true, // Prevent filename collisions
        tokenPayload: JSON.stringify({
          userId,
          uploadedAt: new Date().toISOString(),
        }),
      };
    },
    onUploadCompleted: async ({ blob, tokenPayload }) => {
      logger.info("Upload completed", {
        url: blob.url,
        pathname: blob.pathname,
        tokenPayload,
      });

      try {
        // TODO: Add custom logic here (save to database, send notification, etc.)
        // const { userId } = JSON.parse(tokenPayload);
        // await db.files.create({ url: blob.url, userId });
      } catch (error) {
        logger.error("Error in onUploadCompleted callback", error);
      }
    },
  });

  return NextResponse.json(jsonResponse);
}

/**
 * Handles generic upload URL request (S3, Local FS, etc.).
 * Returns presigned URL if supported, otherwise returns fallback response.
 */
async function handleGenericUpload(request: GenericUploadRequest) {
  const storage = await getFileStorage();

  // Check if storage backend supports direct upload
  if (typeof storage.createUploadUrl !== "function") {
    logger.info("Storage doesn't support createUploadUrl, using fallback");
    return NextResponse.json(createFallbackResponse());
  }

  const uploadUrl = await storage.createUploadUrl({
    filename: request.filename || "file",
    contentType: request.contentType || "application/octet-stream",
    expiresInSeconds: DEFAULT_UPLOAD_EXPIRES_SECONDS,
  });

  if (!uploadUrl) {
    logger.info("Storage returned null, using fallback");
    return NextResponse.json(createFallbackResponse());
  }

  // Provide a public source URL for clients to reference after successful PUT
  const sourceUrl = await storage.getSourceUrl(uploadUrl.key);

  return NextResponse.json({
    directUploadSupported: true,
    ...uploadUrl,
    sourceUrl,
  });
}

/**
 * Upload URL endpoint.
 *
 * Provides optimal upload method based on storage backend:
 * - Vercel Blob: Client token for direct upload
 * - S3: Presigned URL (future)
 * - Local FS: Fallback to server upload
 */
export async function POST(request: Request) {
  // Authenticate
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check storage configuration first
  const storageCheck = await checkStorageAction();
  if (!storageCheck.isValid) {
    logger.error("Storage configuration error", {
      error: storageCheck.error,
      solution: storageCheck.solution,
    });

    const storageDriver = await getStorageDriver();
    return NextResponse.json(
      {
        error: storageCheck.error,
        solution: storageCheck.solution,
        storageDriver,
      },
      { status: 500 },
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    // Route to appropriate handler
    if (isVercelBlobRequest(body)) {
      return await handleVercelBlobUpload(body, request, session.user.id);
    }

    const genericRequest = body as GenericUploadRequest;
    const contentType =
      genericRequest.contentType || "application/octet-stream";

    assertAllowedUserUpload({
      contentType,
      size: 0,
    });

    return await handleGenericUpload({
      ...genericRequest,
      filename: resolveUserScopedUploadPath(
        session.user.id,
        genericRequest.filename || "file",
      ),
      contentType,
    });
  } catch (error) {
    if (error instanceof StorageUploadPolicyError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    logger.error("Upload URL generation failed", error);
    return NextResponse.json(
      { error: "Failed to create upload URL" },
      { status: 500 },
    );
  }
}
