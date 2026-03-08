import { NextResponse } from "next/server";
import { getStorageDriver, serverFileStorage } from "lib/file-storage";
import { getContentTypeFromFilename } from "lib/file-storage/storage-utils";
import {
  assertAllowedUserUpload,
  resolveUserScopedUploadPath,
  StorageUploadPolicyError,
} from "lib/file-storage/upload-policy";
import { checkStorageAction } from "@/app/api/storage/actions";
import { requirePilotExtensionSession } from "lib/pilot/auth";

export async function POST(request: Request) {
  try {
    const pilotSession = await requirePilotExtensionSession(request.headers);
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

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

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

    const result = await serverFileStorage.upload(file.stream(), {
      filename: resolveUserScopedUploadPath(pilotSession.userId, file.name),
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

    const message = (error as Error).message || "Failed to upload file";
    const status =
      message.includes("token") || message.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
