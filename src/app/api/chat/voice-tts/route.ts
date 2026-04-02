import { getSession } from "auth/server";
import { settingsRepository } from "lib/db/repository";
import { buildSpeechStyleInstructions } from "lib/ai/speech/open-ai/voice-speech-instructions";
import { z } from "zod";

const VOICE_TTS_MODEL = "gpt-4o-mini-tts";

const voiceTtsRequestSchema = z.object({
  text: z.string().trim().min(1).max(4_000),
  voice: z.string().trim().min(1),
});

function normalizeOpenAiBaseUrl(baseUrl?: string | null) {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return "https://api.openai.com/v1";
  }

  return trimmed.replace(/\/$/, "");
}

async function readOpenAiProviderConfig() {
  const providerConfig = await settingsRepository.getProviderByName("openai");
  const enabled = providerConfig?.enabled ?? true;
  const apiKey = providerConfig?.apiKey?.trim() || process.env.OPENAI_API_KEY;

  return {
    enabled,
    apiKey: apiKey?.trim() || "",
    baseUrl: normalizeOpenAiBaseUrl(
      providerConfig?.baseUrl || process.env.OPENAI_BASE_URL,
    ),
  };
}

function buildSpeechApiUrl(baseUrl: string) {
  return new URL("audio/speech", `${baseUrl.replace(/\/$/, "")}/`).toString();
}

function createErrorResponse(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user.id) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { text, voice } = voiceTtsRequestSchema.parse(await request.json());
    const providerConfig = await readOpenAiProviderConfig();

    if (!providerConfig.enabled || !providerConfig.apiKey) {
      return createErrorResponse(
        503,
        "Exact voice playback requires an enabled OpenAI provider API key.",
      );
    }

    const speechResponse = await fetch(
      buildSpeechApiUrl(providerConfig.baseUrl),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${providerConfig.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: VOICE_TTS_MODEL,
          voice,
          input: text,
          instructions: buildSpeechStyleInstructions(text),
          response_format: "wav",
        }),
        cache: "no-store",
      },
    );

    if (!speechResponse.ok) {
      const errorText = await speechResponse.text();

      let errorMessage = errorText || "Exact voice playback failed.";
      try {
        const parsed = JSON.parse(errorText);
        errorMessage =
          typeof parsed?.error === "string"
            ? parsed.error
            : parsed?.error?.message || errorMessage;
      } catch {}

      return createErrorResponse(speechResponse.status, errorMessage);
    }

    return new Response(speechResponse.body, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type":
          speechResponse.headers.get("Content-Type") || "audio/wav",
      },
    });
  } catch (error: any) {
    return createErrorResponse(
      500,
      error?.message || "Exact voice playback failed.",
    );
  }
}
