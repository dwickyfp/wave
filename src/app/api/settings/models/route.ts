import { getSession } from "auth/server";
import { settingsRepository } from "lib/db/repository";
import { LlmModelConfigZodSchema } from "app-types/settings";
import { NextResponse } from "next/server";
import { z } from "zod";

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

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("providerId");
    if (!providerId) {
      return NextResponse.json(
        { error: "providerId query param required" },
        { status: 400 },
      );
    }
    const models = await settingsRepository.getModelsByProvider(providerId);
    return NextResponse.json(models);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to get models" },
      { status: 500 },
    );
  }
}

const CreateModelSchema = LlmModelConfigZodSchema.extend({
  providerId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const json = await request.json();
    const { providerId, ...data } = CreateModelSchema.parse(json);
    const model = await settingsRepository.createModel(providerId, data);
    return NextResponse.json(model, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create model" },
      { status: 500 },
    );
  }
}
