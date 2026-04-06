import type { ChatMention } from "app-types/chat";
import type { AllowedMCPServer } from "app-types/mcp";
import { getSession } from "auth/server";
import { colorize } from "consola/utils";
import {
  buildWaveAgentSystemPrompt,
  createNoopDataStream,
  loadWaveAgentBoundTools,
} from "lib/ai/agent/runtime";
import {
  OPENAI_REALTIME_URL,
  type OpenAIRealtimeSession,
} from "lib/ai/speech/open-ai/openai-realtime-event";
import { buildVoiceRealtimeToolDefinitions } from "lib/ai/speech/open-ai/realtime-voice-tools";
import { resolveVoiceAgentChatModel } from "lib/ai/speech/voice-agent-model";
import { buildVoiceTranscriptionBias } from "lib/ai/speech/voice-language";
import { buildVoiceResponseStylePrompt } from "lib/ai/speech/voice-response-style";
import { ensureUserChatThread } from "lib/chat/chat-session";
import { settingsRepository } from "lib/db/repository";
import globalLogger from "lib/logger";
import { NextRequest } from "next/server";
import { rememberAgentAction } from "../actions";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `OpenAI Realtime API: `),
});

const VOICE_AUDIO_SAMPLE_RATE = 24_000;
const VOICE_FILLER_DELAY_MS = 200;
const VOICE_PROGRESS_DELAY_MS = 1_800;
const VOICE_LONG_PROGRESS_DELAY_MS = 4_500;
const DEFAULT_OPENAI_REALTIME_MODEL = "gpt-realtime-1.5";
const OPENAI_REALTIME_FALLBACK_MODEL = "gpt-realtime-mini";

type VoiceBootstrapRequest = {
  voice?: string;
  agentId?: string;
  threadId?: string;
  transcriptionLanguage?: string;
  mentions?: ChatMention[];
  allowedMcpServers?: Record<string, AllowedMCPServer>;
  allowedAppDefaultToolkit?: string[];
};

type VoiceSessionBaseConfig = {
  voice: string;
  transcriptionLanguage?: string;
};

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

function buildLegacyVoiceTurnDetection() {
  return {
    type: "server_vad" as const,
    threshold: 0.55,
    prefix_padding_ms: 450,
    silence_duration_ms: 1_200,
    create_response: false,
    interrupt_response: false,
  };
}

function buildNativeVoiceTurnDetection() {
  return {
    type: "server_vad" as const,
    threshold: 0.5,
    prefix_padding_ms: 300,
    silence_duration_ms: 550,
    create_response: true,
    interrupt_response: true,
  };
}

const TRANSPORT_ONLY_INSTRUCTIONS =
  "You are Emma's realtime voice transport. Transcribe the user's speech accurately. Do not create responses automatically. Only speak when the client explicitly asks you to generate audio output.";

function buildLegacyVoiceSessionConfig({
  voice,
  transcriptionLanguage,
}: VoiceSessionBaseConfig) {
  const transcriptionBias = buildVoiceTranscriptionBias(transcriptionLanguage);

  return {
    modalities: ["text", "audio"],
    voice,
    instructions: TRANSPORT_ONLY_INSTRUCTIONS,
    input_audio_format: "pcm16",
    output_audio_format: "pcm16",
    input_audio_transcription: {
      model: "whisper-1",
      ...(transcriptionBias ?? {}),
    },
    turn_detection: buildLegacyVoiceTurnDetection(),
  };
}

function buildNativeVoiceSessionConfig(input: {
  voice: string;
  transcriptionLanguage?: string;
  instructions: string;
  tools: OpenAIRealtimeSession["voiceTools"];
}) {
  const transcriptionBias = buildVoiceTranscriptionBias(
    input.transcriptionLanguage,
  );

  return {
    type: "realtime",
    instructions: input.instructions,
    output_modalities: ["audio"],
    tool_choice: "auto",
    tools: (input.tools ?? []).map((tool) => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
    audio: {
      input: {
        transcription: {
          model: "whisper-1",
          ...(transcriptionBias ?? {}),
        },
        format: {
          type: "audio/pcm",
          rate: VOICE_AUDIO_SAMPLE_RATE,
        },
        turn_detection: buildNativeVoiceTurnDetection(),
      },
      output: {
        voice: input.voice,
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
      audio: {
        output: {
          voice,
        },
      },
    },
  };
}

async function buildNativeRuntimeConfig(input: {
  request: NextRequest;
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>;
  agentId?: string;
  threadId?: string;
  mentions?: ChatMention[];
  allowedMcpServers?: Record<string, AllowedMCPServer>;
  allowedAppDefaultToolkit?: string[];
  transcriptionLanguage?: string;
  voice: string;
}) {
  const agent = await rememberAgentAction(input.agentId, input.session.user.id);

  if (input.agentId && !agent) {
    throw new Error(
      "The selected agent is unavailable. Re-open voice chat from a valid agent.",
    );
  }

  if (input.threadId) {
    await ensureUserChatThread({
      threadId: input.threadId,
      userId: input.session.user.id,
      historyMode: "compacted-tail",
    });
  }

  const resolvedChatModel = await resolveVoiceAgentChatModel({
    agent,
  });

  const usageContext = {
    source: "chat" as const,
    actorUserId: input.session.user.id,
    agentId: agent?.id ?? null,
    threadId: input.threadId ?? null,
  };

  const toolset = resolvedChatModel
    ? await loadWaveAgentBoundTools({
        agent,
        userId: input.session.user.id,
        mentions: input.mentions,
        allowedMcpServers: input.allowedMcpServers,
        allowedAppDefaultToolkit: input.allowedAppDefaultToolkit,
        dataStream: createNoopDataStream(),
        abortSignal: input.request.signal,
        chatModel: resolvedChatModel,
        source: "agent",
        usageContext,
      })
    : {
        mcpTools: {},
        workflowTools: {},
        appDefaultTools: {},
        subagentTools: {},
        knowledgeTools: {},
        skillTools: {},
        subAgents: [],
        knowledgeGroups: [],
        attachedSkills: [],
      };

  const voiceTools = buildVoiceRealtimeToolDefinitions(toolset);
  const instructions = buildWaveAgentSystemPrompt({
    user: input.session.user as any,
    agent,
    subAgents: toolset.subAgents,
    attachedSkills: toolset.attachedSkills,
    extraPrompts: [
      buildVoiceResponseStylePrompt(input.transcriptionLanguage),
      "When you use a tool, keep the spoken acknowledgement short and natural.",
    ],
  });

  logger.info(
    `Voice native runtime prepared: tools=${voiceTools.length}, agent=${agent?.name ?? "none"}`,
  );

  return {
    agent,
    resolvedChatModel,
    instructions,
    voiceTools,
    nativeSessionConfig: buildNativeVoiceSessionConfig({
      voice: input.voice,
      transcriptionLanguage: input.transcriptionLanguage,
      instructions,
      tools: voiceTools,
    }),
    voicePolicy: {
      fillerDelayMs: VOICE_FILLER_DELAY_MS,
      progressDelayMs: VOICE_PROGRESS_DELAY_MS,
      longProgressDelayMs: VOICE_LONG_PROGRESS_DELAY_MS,
      allowBargeIn: true,
      preferAudioReplies: true,
    },
  };
}

async function buildDirectOpenAiRealtimeSession(input: {
  realtimeModel: string;
  voice: string;
  nativeSessionConfig: Record<string, unknown>;
  voiceTools: OpenAIRealtimeSession["voiceTools"];
  voicePolicy: OpenAIRealtimeSession["voicePolicy"];
}) {
  const openAiProviderConfig =
    await settingsRepository.getProviderByName("openai");
  const apiKey =
    openAiProviderConfig?.apiKey || process.env.OPENAI_API_KEY || "";

  if (!apiKey) {
    return null;
  }

  const response = await fetch(OPENAI_REALTIME_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.realtimeModel,
      ...input.nativeSessionConfig,
    }),
  });

  const rawBody = await response.text();
  const payload = rawBody ? JSON.parse(rawBody) : null;

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        payload?.message ||
        rawBody ||
        "OpenAI realtime session creation failed.",
    );
  }

  return {
    client_secret: payload?.client_secret,
    realtimeEndpointUrl: "https://api.openai.com/v1/realtime",
    sdpAuthHeader: "Authorization",
    pendingSessionUpdate: input.nativeSessionConfig,
    websocketSessionUpdate: input.nativeSessionConfig,
    voiceMode: "realtime_native" as const,
    voiceTools: input.voiceTools,
    voicePolicy: input.voicePolicy,
    model: input.realtimeModel,
  };
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session?.user.id) {
      return new Response("Unauthorized", { status: 401 });
    }

    const {
      voice,
      agentId,
      threadId,
      transcriptionLanguage,
      mentions,
      allowedMcpServers,
      allowedAppDefaultToolkit,
    } = (await request.json()) as VoiceBootstrapRequest;

    const resolvedVoice = voice || "alloy";
    const { voiceTools, nativeSessionConfig, voicePolicy } =
      await buildNativeRuntimeConfig({
        request,
        session,
        agentId,
        threadId,
        mentions,
        allowedMcpServers,
        allowedAppDefaultToolkit,
        transcriptionLanguage,
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
    const azureProviderConfig =
      await settingsRepository.getProviderByName("azure");
    const apiKey =
      azureVoiceConfig?.apiKey?.trim() ||
      azureProviderConfig?.apiKey ||
      process.env.AZURE_API_KEY ||
      "";
    const legacySessionConfig = buildLegacyVoiceSessionConfig({
      voice: resolvedVoice,
      transcriptionLanguage,
    });

    const buildDirectOpenAiFallback = async (preferredModel: string) => {
      const realtimeModel = process.env.OPENAI_REALTIME_MODEL || preferredModel;
      return buildDirectOpenAiRealtimeSession({
        realtimeModel,
        voice: resolvedVoice,
        nativeSessionConfig,
        voiceTools,
        voicePolicy,
      });
    };

    if (!resolvedEndpoint || !deploymentName || !apiKey) {
      const openAiSession =
        (await buildDirectOpenAiFallback(DEFAULT_OPENAI_REALTIME_MODEL)) ??
        (await buildDirectOpenAiFallback(OPENAI_REALTIME_FALLBACK_MODEL));

      if (openAiSession) {
        return Response.json(openAiSession, { status: 200 });
      }

      return new Response(
        JSON.stringify({
          error:
            "Neither Azure Voice Direct nor OpenAI realtime is configured. Configure one of them before starting voice chat.",
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

      const directOpenAiSession =
        (await buildDirectOpenAiFallback(DEFAULT_OPENAI_REALTIME_MODEL)) ??
        (await buildDirectOpenAiFallback(OPENAI_REALTIME_FALLBACK_MODEL));

      if (directOpenAiSession) {
        logger.info("Falling back to direct OpenAI realtime voice runtime.");
        return Response.json(directOpenAiSession, { status: 200 });
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
          voiceMode: "legacy",
          voiceTools: [],
          voicePolicy,
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
            `Azure GA realtime unavailable (${gaRes.status} ${errorCode || errorMessage}); falling back`,
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
          pendingSessionUpdate: nativeSessionConfig,
          websocketSessionUpdate: nativeSessionConfig,
          voiceMode: "realtime_native",
          voiceTools,
          voicePolicy,
          model: deploymentName,
        },
        { status: 200 },
      );
    } catch (error: any) {
      logger.warn(
        `Azure GA realtime negotiation failed; falling back: ${error.message}`,
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
