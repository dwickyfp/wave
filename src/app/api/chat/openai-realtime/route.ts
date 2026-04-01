import { NextRequest } from "next/server";
import { getSession } from "auth/server";
import { VercelAIMcpTool } from "app-types/mcp";
import {
  filterMcpServerCustomizations,
  loadMcpTools,
  mergeSystemPrompt,
} from "../shared.chat";
import {
  buildMcpServerCustomizationsSystemPrompt,
  buildSpeechSystemPrompt,
} from "lib/ai/prompts";
import { resolveAgentPersonalizationPrompt } from "lib/ai/agent/personalization";

import { safe } from "ts-safe";
import { DEFAULT_VOICE_TOOLS } from "lib/ai/speech";
import {
  rememberAgentAction,
  rememberMcpServerCustomizationsAction,
} from "../actions";
import globalLogger from "lib/logger";
import { colorize } from "consola/utils";
import { getUserPreferences } from "lib/user/server";
import { ChatMention } from "app-types/chat";
import { settingsRepository } from "lib/db/repository";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `OpenAI Realtime API: `),
});

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

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session?.user.id) {
      return new Response("Unauthorized", { status: 401 });
    }

    const {
      voice,
      mentions = [],
      agentId,
    } = (await request.json()) as {
      voice?: string;
      agentId?: string;
      mentions?: ChatMention[];
    };

    // ── Shared: agent, MCP tools, system prompt ──────────────────────────────
    const agent = await rememberAgentAction(agentId, session.user.id);

    agentId && logger.info(`[${agentId}] Agent: ${agent?.name}`);

    const enabledMentions = agent ? agent.instructions.mentions : mentions;

    const allowedMcpTools = await loadMcpTools({
      mentions: enabledMentions,
      userId: session.user.id,
    });

    const toolNames = Object.keys(allowedMcpTools ?? {});
    if (toolNames.length > 0) {
      logger.info(`${toolNames.length} tools found`);
    } else {
      logger.info(`No tools found`);
    }

    const userPreferences = await getUserPreferences(session.user.id);
    const learnedPersonalizationPrompt =
      await resolveAgentPersonalizationPrompt({
        surface: "platform_chat",
        platformUserId: session.user.id,
        agent,
      });

    const mcpServerCustomizations = await safe()
      .map(() => {
        if (Object.keys(allowedMcpTools ?? {}).length === 0)
          throw new Error("No tools found");
        return rememberMcpServerCustomizationsAction(session.user.id);
      })
      .map((v) => filterMcpServerCustomizations(allowedMcpTools!, v))
      .orElse({});

    const openAITools = Object.entries(allowedMcpTools ?? {}).map(
      ([name, tool]) => vercelAIToolToOpenAITool(tool, name),
    );

    const systemPrompt = mergeSystemPrompt(
      buildSpeechSystemPrompt(
        session.user,
        userPreferences ?? undefined,
        agent,
      ),
      learnedPersonalizationPrompt,
      buildMcpServerCustomizationsSystemPrompt(mcpServerCustomizations),
    );

    const bindingTools = [...openAITools, ...DEFAULT_VOICE_TOOLS];
    const resolvedVoice = voice || "alloy";
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

    const pendingSessionUpdate = {
      voice: resolvedVoice,
      instructions: systemPrompt,
      tools: bindingTools,
      input_audio_transcription: { model: "whisper-1" },
    };

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
          pendingSessionUpdate,
        },
        { status: 200 },
      );
    };

    try {
      const gaSessionUrl = `${gaEndpoint}/openai/v1/realtime/client_secrets`;
      const gaRealtimeEndpointUrl = `${gaEndpoint}/openai/v1/realtime/calls?webrtcfilter=on`;
      const gaBody = JSON.stringify({
        session: {
          type: "realtime",
          model: deploymentName,
          instructions: systemPrompt,
          audio: { output: { voice: resolvedVoice } },
        },
      });

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
          sdpAuthHeader: "Authorization",
          pendingSessionUpdate: {
            tools: bindingTools,
            input_audio_transcription: { model: "whisper-1" },
          },
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

function vercelAIToolToOpenAITool(tool: VercelAIMcpTool, name: string) {
  return {
    name,
    type: "function",
    description: tool.description,
    parameters: (tool.inputSchema as any).jsonSchema ?? {
      type: "object",
      properties: {},
      required: [],
    },
  };
}
