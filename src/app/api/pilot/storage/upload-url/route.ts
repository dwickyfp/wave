import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePilotExtensionSession } from "lib/pilot/auth";
import { assertAllowedUserUpload } from "lib/file-storage/upload-policy";

const bodySchema = z.object({
  filename: z.string().optional(),
  contentType: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    await requirePilotExtensionSession(request.headers);
    const body = bodySchema.parse(await request.json());

    assertAllowedUserUpload({
      contentType: body.contentType,
      size: 0,
    });

    return NextResponse.json({
      directUploadSupported: false,
      fallbackUrl: "/api/pilot/storage/upload",
      message: "Use multipart/form-data upload to fallbackUrl",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: (error as Error).message || "Unauthorized" },
      { status: 401 },
    );
  }
}
