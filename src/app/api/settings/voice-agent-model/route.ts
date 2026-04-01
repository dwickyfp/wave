import { getSession } from "auth/server";
import { settingsRepository } from "lib/db/repository";
import { NextResponse } from "next/server";
import {
  VOICE_AGENT_MODEL_KEY,
  VoiceAgentModelConfigSchema,
} from "lib/ai/speech/voice-agent-model";

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

    const config = await settingsRepository.getSetting(VOICE_AGENT_MODEL_KEY);
    return NextResponse.json(config ?? null);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to get default voice agent model." },
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
      await settingsRepository.upsertSetting(VOICE_AGENT_MODEL_KEY, null);
      return NextResponse.json({ success: true });
    }

    const config = VoiceAgentModelConfigSchema.parse(json);
    await settingsRepository.upsertSetting(VOICE_AGENT_MODEL_KEY, config);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message || "Failed to update default voice agent model.",
      },
      { status: 500 },
    );
  }
}
