import { getSession } from "auth/server";
import { NextRequest } from "next/server";
import { colorize } from "consola/utils";
import { resolveVoiceAgentChatModel } from "lib/ai/speech/voice-agent-model";
import { settingsRepository } from "lib/db/repository";
import globalLogger from "lib/logger";
import { rememberAgentAction } from "../actions";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `OpenAI Realtime API: `),
});

const VOICE_AUDIO_SAMPLE_RATE = 24_000;

// When AZURE_VOICE_SKIP_TLS_VERIFY=true the Azure Voice fetch calls bypass
// TLS certificate verification. Use this only in environments where the network
// proxy presents a self-signed certificate (e.g. corporate SSL inspection).
const skipTls = process.env.AZURE_VOICE_SKIP_TLS_VERIFY === "true";

async function azureFetch(url: string, init: RequestInit): Promise<Response> {
  if (!skipTls) return fetch(url, init);
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    return await fetch(url, init);
  } finally {
    if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
  }
}

function normalizeAzureVoiceEndpoint(
  endpoint: string,
  preferOpenAIHost: boolean,
) {
  const url = new URL(endpoint.trim());
  url.pathname = "";
  url.search = "";
  url.hash = "";

  if (
    preferOpenAIHost &&
    url.hostname.endsWith(".cognitiveservices.azure.com")
  ) {
    url.hostname = url.hostname.replace(
      /\.cognitiveservices\.azure\.com$/,
      ".openai.azure.com",
    );
  }

  return url.toString().replace(/\/$/, "");
}

function buildVoiceTurnDetection() {
  return {
    type: "server_vad" as const,
    threshold: 0.4,
    prefix_padding_ms: 500,
    silence_duration_ms: 900,
    create_response: false,
    interrupt_response: false,
  };
}

const TRANSPORT_ONLY_INSTRUCTIONS =
  "You are Emma's realtime voice transport. Transcribe the user's speech accurately. Do not create responses automatically. Only speak when the client explicitly asks you to generate audio output.";

function buildLegacyVoiceSessionConfig({ voice }: { voice: string }) {
  return {
    modalities: ["text", "audio"],
    voice,
    instructions: TRANSPORT_ONLY_INSTRUCTIONS,
    input_audio_format: "pcm16",
    output_audio_format: "pcm16",
    input_audio_transcription: { model: "whisper-1" },
    turn_detection: buildVoiceTurnDetection(),
  };
}

function buildGaVoiceSessionConfig({ voice }: { voice: string }) {
  return {
    type: "realtime",
    instructions: TRANSPORT_ONLY_INSTRUCTIONS,
    output_modalities: ["audio"],
    audio: {
      input: {
        transcription: { model: "whisper-1" },
        format: {
          type: "audio/pcm",
          rate: VOICE_AUDIO_SAMPLE_RATE,
        },
        turn_detection: buildVoiceTurnDetection(),
      },
      output: {
        voice,
        format: {
          type: "audio/pcm",
          rate: VOICE_AUDIO_SAMPLE_RATE,
        },
      },
    },
  };
}

function buildGaClientSecretRequest({
  voice,
  deploymentName,
}: {
  voice: string;
  deploymentName: string;
}) {
  return {
    session: {
      type: "realtime",
      model: deploymentName,
      instructions: TRANSPORT_ONLY_INSTRUCTIONS,
      audio: {
        output: {
          voice,
        },
      },
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session?.user.id) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { voice, agentId } = (await request.json()) as {
      voice?: string;
      agentId?: string;
    };

    const agent = await rememberAgentAction(agentId, session.user.id);

    if (agentId && !agent) {
      return new Response(
        JSON.stringify({
          error:
            "The selected agent is unavailable. Re-open voice chat from a valid agent.",
        }),
        { status: 404 },
      );
    }

    await resolveVoiceAgentChatModel({ agent }).catch((error: Error) => {
      throw error;
    });

    agentId && logger.info(`[${agentId}] Agent: ${agent?.name}`);

    const resolvedVoice = voice || "alloy";
    const legacySessionConfig = buildLegacyVoiceSessionConfig({
      voice: resolvedVoice,
    });
    const gaSessionConfig = buildGaVoiceSessionConfig({
      voice: resolvedVoice,
    });
    const azureVoiceConfig = (await settingsRepository.getSetting(
      "voice-chat-azure",
    )) as {
      baseUrl?: string;
      apiVersion?: string;
      deploymentName?: string;
      apiKey?: string;
    } | null;

    const configuredEndpoint = azureVoiceConfig?.baseUrl?.trim();
    const resolvedEndpoint = configuredEndpoint
      ? normalizeAzureVoiceEndpoint(configuredEndpoint, false)
      : null;
    const gaEndpoint = configuredEndpoint
      ? normalizeAzureVoiceEndpoint(configuredEndpoint, true)
      : null;
    const deploymentName = azureVoiceConfig?.deploymentName?.trim();
    const apiVersion =
      azureVoiceConfig?.apiVersion?.trim() ||
      process.env.AZURE_OPENAI_API_VERSION ||
      "2024-10-01-preview";

    if (!resolvedEndpoint || !deploymentName) {
      return new Response(
        JSON.stringify({
          error:
            "Azure Voice (Direct) is not configured. Add Base URL, Deployment Name, and API Version in Emma Model Setup before starting voice chat.",
        }),
        { status: 500 },
      );
    }

    const azureProviderConfig =
      await settingsRepository.getProviderByName("azure");
    const apiKey =
      azureVoiceConfig?.apiKey?.trim() ||
      azureProviderConfig?.apiKey ||
      process.env.AZURE_API_KEY ||
      "";

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error:
            "Azure OpenAI API key is not configured. Add it in Azure Voice (Direct) or Settings → Providers.",
        }),
        { status: 500 },
      );
    }

    logger.info(
      `Using Azure Voice Direct config: ${resolvedEndpoint} / ${deploymentName}`,
    );

    const websocketBase = gaEndpoint?.replace(/^https:/, "wss:");
    const isGaDeployment = deploymentName.startsWith("gpt-realtime");
    const websocketEndpointUrl = isGaDeployment
      ? `${websocketBase}/openai/v1/realtime?model=${encodeURIComponent(deploymentName)}&api-key=${encodeURIComponent(apiKey)}`
      : `${resolvedEndpoint.replace(/^https:/, "wss:")}/openai/realtime?api-version=${encodeURIComponent(apiVersion)}&deployment=${encodeURIComponent(deploymentName)}&api-key=${encodeURIComponent(apiKey)}`;

    const runLegacyPreview = async (reason?: string) => {
      if (reason) {
        logger.info(`Using Azure legacy preview realtime (${reason})`);
      }

      const realtimeEndpointUrl = `${resolvedEndpoint}/openai/realtime?api-version=${apiVersion}&deployment=${encodeURIComponent(deploymentName)}`;
      const proxySdpUrl = `/api/chat/openai-realtime-sdp?endpoint=${encodeURIComponent(realtimeEndpointUrl)}`;

      return Response.json(
        {
          client_secret: {
            value: "proxy",
            expires_at: 0,
          },
          realtimeEndpointUrl,
          proxySdpUrl,
          websocketEndpointUrl,
          pendingSessionUpdate: legacySessionConfig,
          websocketSessionUpdate: legacySessionConfig,
        },
        { status: 200 },
      );
    };

    try {
      const gaSessionUrl = `${gaEndpoint}/openai/v1/realtime/client_secrets`;
      const gaRealtimeEndpointUrl = `${gaEndpoint}/openai/v1/realtime/calls?webrtcfilter=on`;
      const gaBody = JSON.stringify(
        buildGaClientSecretRequest({
          voice: resolvedVoice,
          deploymentName,
        }),
      );

      if (gaEndpoint !== resolvedEndpoint) {
        logger.info(
          `Normalized Azure Voice host for GA realtime: ${resolvedEndpoint} -> ${gaEndpoint}`,
        );
      }

      const gaRes = await azureFetch(gaSessionUrl, {
        method: "POST",
        headers: { "api-key": apiKey, "Content-Type": "application/json" },
        body: gaBody,
      });
      const gaText = await gaRes.text();
      const gaData = gaText ? JSON.parse(gaText) : null;

      if (!gaRes.ok) {
        const errorCode: string = gaData?.error?.code ?? "";
        const errorMessage =
          gaData?.error?.message ||
          gaData?.message ||
          gaText ||
          "Unknown error";

        if (
          errorCode === "OperationNotSupported" ||
          errorCode === "OpperationNotSupported" ||
          gaRes.status === 404
        ) {
          logger.warn(
            `Azure GA realtime unavailable (${gaRes.status} ${errorCode || errorMessage}); falling back to legacy preview`,
          );
          return runLegacyPreview(
            `GA unavailable: ${gaRes.status} ${errorCode || errorMessage}`,
          );
        }

        logger.error(`Azure GA session error: ${gaText}`);
        return Response.json(
          { error: gaData?.error ?? errorMessage },
          { status: gaRes.status },
        );
      }

      if (!gaData?.value) {
        logger.error(`Azure GA session returned no client secret: ${gaText}`);
        return Response.json(
          { error: "Azure realtime session did not return a client secret" },
          { status: 502 },
        );
      }

      return Response.json(
        {
          client_secret: {
            value: gaData.value,
            expires_at: gaData.expires_at ?? 0,
          },
          realtimeEndpointUrl: gaRealtimeEndpointUrl,
          websocketEndpointUrl,
          sdpAuthHeader: "Authorization",
          pendingSessionUpdate: gaSessionConfig,
          websocketSessionUpdate: gaSessionConfig,
        },
        { status: 200 },
      );
    } catch (error: any) {
      logger.warn(
        `Azure GA realtime negotiation failed; falling back to legacy preview: ${error.message}`,
      );
      return runLegacyPreview(`GA negotiation error: ${error.message}`);
    }
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }
}
