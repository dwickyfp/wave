import { getSession } from "auth/server";
import { settingsRepository } from "lib/db/repository";
import { RedisConfigZodSchema } from "app-types/settings";
import { NextResponse } from "next/server";

const REDIS_KEY = "redis-config";

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

    const config = await settingsRepository.getSetting(REDIS_KEY);
    if (!config) {
      return NextResponse.json(null);
    }
    return NextResponse.json(config);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to get Redis config" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const json = await request.json();
    const config = RedisConfigZodSchema.parse(json);
    await settingsRepository.upsertSetting(REDIS_KEY, config);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to save Redis config" },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    await settingsRepository.upsertSetting(REDIS_KEY, null);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to clear Redis config" },
      { status: 500 },
    );
  }
}
