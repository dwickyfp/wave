import { getSession } from "auth/server";
import { settingsRepository } from "lib/db/repository";
import { MinioConfigZodSchema } from "app-types/settings";
import { NextResponse } from "next/server";

const MINIO_KEY = "minio";

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

    const config = await settingsRepository.getSetting(MINIO_KEY);
    if (!config) {
      return NextResponse.json(null);
    }
    // Mask the secret key in GET response
    const cfg = config as any;
    return NextResponse.json({
      ...cfg,
      secretKey: cfg.secretKey ? "••••••••" : "",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to get Minio config" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const json = await request.json();
    const config = MinioConfigZodSchema.parse(json);
    await settingsRepository.upsertSetting(MINIO_KEY, config);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to save Minio config" },
      { status: 500 },
    );
  }
}
