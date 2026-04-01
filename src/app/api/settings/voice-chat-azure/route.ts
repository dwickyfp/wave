import { getSession } from "auth/server";
import { settingsRepository } from "lib/db/repository";
import { NextResponse } from "next/server";
import { z } from "zod";

export const VOICE_CHAT_AZURE_KEY = "voice-chat-azure";

export const VoiceChatAzureSchema = z.object({
  baseUrl: z.string().url("Must be a valid URL"),
  apiVersion: z.string().min(1, "API version is required"),
  deploymentName: z.string().min(1, "Deployment name is required"),
  apiKey: z.string(),
});

export type VoiceChatAzureConfig = z.infer<typeof VoiceChatAzureSchema>;

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

    const config = await settingsRepository.getSetting(VOICE_CHAT_AZURE_KEY);
    if (!config) return NextResponse.json(null);

    // Mask the API key before returning
    const masked = { ...(config as VoiceChatAzureConfig) };
    if (masked.apiKey) {
      masked.apiKey =
        masked.apiKey.slice(0, 4) +
        "•".repeat(Math.max(0, masked.apiKey.length - 4));
    }
    return NextResponse.json(masked);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to get Azure voice config" },
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
      await settingsRepository.upsertSetting(VOICE_CHAT_AZURE_KEY, null);
      return NextResponse.json({ success: true });
    }

    // If the apiKey looks masked (ends with bullets), keep the existing one
    if (typeof json.apiKey === "string" && json.apiKey.includes("•")) {
      const existing = (await settingsRepository.getSetting(
        VOICE_CHAT_AZURE_KEY,
      )) as VoiceChatAzureConfig | null;
      if (existing?.apiKey) json.apiKey = existing.apiKey;
    }

    const config = VoiceChatAzureSchema.parse(json);
    await settingsRepository.upsertSetting(VOICE_CHAT_AZURE_KEY, config);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update Azure voice config" },
      { status: 500 },
    );
  }
}
