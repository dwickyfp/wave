import { getSession } from "auth/server";
import { settingsRepository } from "lib/db/repository";
import { NextResponse } from "next/server";
import { z } from "zod";

const KNOWLEDGE_IMAGE_NEIGHBOR_CONTEXT_KEY =
  "knowledge-image-neighbor-context-enabled";

async function requireAdmin() {
  const session = await getSession();
  if (!session?.user?.id) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (session.user.role !== "admin") {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { session };
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const config = await settingsRepository.getSetting(
      KNOWLEDGE_IMAGE_NEIGHBOR_CONTEXT_KEY,
    );
    return NextResponse.json(typeof config === "boolean" ? config : true);
  } catch (error: any) {
    return NextResponse.json(
      {
        error:
          error.message ||
          "Failed to get knowledge image neighbor context setting",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const enabled = z.boolean().parse(await request.json());
    await settingsRepository.upsertSetting(
      KNOWLEDGE_IMAGE_NEIGHBOR_CONTEXT_KEY,
      enabled,
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      {
        error:
          error.message ||
          "Failed to update knowledge image neighbor context setting",
      },
      { status: 500 },
    );
  }
}
