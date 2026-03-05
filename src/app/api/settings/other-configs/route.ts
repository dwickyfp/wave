import { getSession } from "auth/server";
import { settingsRepository } from "lib/db/repository";
import { OtherConfigZodSchema } from "app-types/settings";
import { NextResponse } from "next/server";

const OTHER_CONFIGS_KEY = "other-configs";

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

    const config = await settingsRepository.getSetting(OTHER_CONFIGS_KEY);
    if (!config) {
      return NextResponse.json(null);
    }
    // Mask the API key in GET response
    const cfg = config as any;
    return NextResponse.json({
      ...cfg,
      exaApiKey: cfg.exaApiKey ? "••••••••" : "",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to get other configs" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const json = await request.json();
    const config = OtherConfigZodSchema.parse(json);

    // If the key is masked (not changed by user), preserve the existing value
    if (config.exaApiKey === "••••••••") {
      const existing = (await settingsRepository.getSetting(
        OTHER_CONFIGS_KEY,
      )) as any;
      config.exaApiKey = existing?.exaApiKey ?? "";
    }

    await settingsRepository.upsertSetting(OTHER_CONFIGS_KEY, config);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to save other configs" },
      { status: 500 },
    );
  }
}
