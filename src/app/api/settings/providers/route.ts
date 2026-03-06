import { getSession } from "auth/server";
import { settingsRepository } from "lib/db/repository";
import { LlmProviderUpsertZodSchema } from "app-types/settings";
import { validateRequiredProviderSettings } from "lib/settings/provider-custom-fields";
import { NextResponse } from "next/server";

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

    const providers = await settingsRepository.getProviders();
    return NextResponse.json(providers);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to get providers" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const json = await request.json();
    const data = LlmProviderUpsertZodSchema.parse(json);
    const existingProvider = await settingsRepository.getProviderByName(
      data.name,
    );
    const mergedSettings = data.settings ?? existingProvider?.settings ?? {};
    const settingErrors = validateRequiredProviderSettings(
      data.name,
      mergedSettings,
    );
    if (settingErrors.length > 0) {
      return NextResponse.json({ error: settingErrors[0] }, { status: 400 });
    }

    const provider = await settingsRepository.upsertProvider(data);
    return NextResponse.json(provider, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create provider" },
      { status: 500 },
    );
  }
}
