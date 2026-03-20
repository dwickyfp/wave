import { getSession } from "auth/server";
import { settingsRepository } from "lib/db/repository";
import { NextResponse } from "next/server";
import { z } from "zod";

const KNOWLEDGE_PARSE_MODEL_KEY = "knowledge-parse-model";

const KnowledgeParseModelSchema = z.object({
  provider: z.string().min(1, "Provider is required"),
  model: z.string().min(1, "Model is required"),
});

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
      KNOWLEDGE_PARSE_MODEL_KEY,
    );
    return NextResponse.json(config ?? null);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to get knowledge parse model" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const json = await request.json();
    if (json === null) {
      await settingsRepository.upsertSetting(KNOWLEDGE_PARSE_MODEL_KEY, null);
      return NextResponse.json({ success: true });
    }

    const config = KnowledgeParseModelSchema.parse(json);
    await settingsRepository.upsertSetting(KNOWLEDGE_PARSE_MODEL_KEY, config);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update knowledge parse model" },
      { status: 500 },
    );
  }
}
