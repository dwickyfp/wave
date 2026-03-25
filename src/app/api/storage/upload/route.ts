import { NextResponse } from "next/server";
import { getSession } from "auth/server";
import { serverFileStorage, getStorageDriver } from "lib/file-storage";
import { getContentTypeFromFilename } from "lib/file-storage/storage-utils";
import {
  assertAllowedUserUpload,
  assertUserScopedUploadPath,
  resolveUserScopedUploadPath,
  StorageUploadPolicyError,
} from "lib/file-storage/upload-policy";
import { checkStorageAction } from "../actions";

export async function POST(request: Request) {
  const session = await getSession();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check storage configuration first
  const storageCheck = await checkStorageAction();
  if (!storageCheck.isValid) {
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

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const pathname = formData.get("pathname");

    if (!file) {
      return NextResponse.json(
        { error: "No file provided. Use 'file' field in FormData." },
        { status: 400 },
      );
    }

    const contentType =
      file.type ||
      getContentTypeFromFilename(file.name) ||
      "application/octet-stream";

    assertAllowedUserUpload({
      contentType,
      size: file.size,
    });

    const resolvedPath =
      typeof pathname === "string" && pathname.trim().length > 0
        ? assertUserScopedUploadPath(session.user.id, pathname)
        : resolveUserScopedUploadPath(session.user.id, file.name);

    // Upload to storage (works with any storage backend)
    const result = await serverFileStorage.upload(file.stream(), {
      filename: resolvedPath,
      contentType,
    });

    return NextResponse.json({
      success: true,
      key: result.key,
      url: result.sourceUrl,
      metadata: result.metadata,
    });
  } catch (error) {
    if (error instanceof StorageUploadPolicyError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("Failed to upload file", error);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 },
    );
  }
}
