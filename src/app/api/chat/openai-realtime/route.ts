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
  // Temporarily disable TLS verification for this request only, then restore.
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    return await fetch(url, init);
  } finally {
    if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session?.user.id) {
      return new Response("Unauthorized", { status: 401 });
    }

    const {
      voice,
      mentions,
      agentId,
      provider: clientProvider = "openai",
      model: clientModel,
    } = (await request.json()) as {
      voice: string;
      model?: string;
      agentId?: string;
      mentions: ChatMention[];
      provider?: "openai" | "azure";
    };

    // ── Read DB voice-chat-model (set via Emma Model Setup) ───────────────────
    const voiceChatModelSetting = (await settingsRepository.getSetting(
      "voice-chat-model",
    )) as { provider?: string; model?: string } | null;

    // DB-configured provider wins over the client default ("openai");
    // explicit client choices (azure) still take precedence.
    const resolvedProvider: "openai" | "azure" =
      clientProvider === "azure"
        ? "azure"
        : ((voiceChatModelSetting?.provider as
            | "openai"
            | "azure"
            | undefined) ?? clientProvider);

    // ── Early key validation ─────────────────────────────────────────────────
    if (resolvedProvider === "azure") {
      const azureCheck = await settingsRepository.getProviderByName("azure");
      const hasKey = !!(azureCheck?.apiKey || process.env.AZURE_API_KEY);
      if (!hasKey) {
        return new Response(
          JSON.stringify({
            error:
              "Azure OpenAI API key is not configured. Please add it in Settings → Providers.",
          }),
          { status: 500 },
        );
      }
    } else if (!process.env.OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY is not set" }),
        { status: 500 },
      );
    }

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

    // Model: DB setting is authoritative; client-sent value is a hint/fallback only
    const resolvedModel =
      voiceChatModelSetting?.model || clientModel || "gpt-4o-realtime-preview";
    const resolvedVoice = voice || "alloy";

    const sessionBody = JSON.stringify({
      model: resolvedModel,
      voice: resolvedVoice,
      input_audio_transcription: { model: "whisper-1" },
      instructions: systemPrompt,
      tools: bindingTools,
    });

    // ── Provider-specific: create session ────────────────────────────────────
    if (resolvedProvider === "azure") {
      const azureProviderConfig =
        await settingsRepository.getProviderByName("azure");

      // Dedicated Azure Voice config (Emma Model Setup → Azure Voice Direct)
      // takes full precedence over the generic Azure provider settings.
      const azureVoiceConfig = (await settingsRepository.getSetting(
        "voice-chat-azure",
      )) as {
        baseUrl?: string;
        apiVersion?: string;
        deploymentName?: string;
        apiKey?: string;
      } | null;

      const isDedicatedConfig = !!(
        azureVoiceConfig?.baseUrl && azureVoiceConfig?.deploymentName
      );

      let apiKey: string;
      let resolvedEndpoint: string;
      let apiVersion: string;
      let effectiveModel: string;

      if (isDedicatedConfig) {
        // Use dedicated Azure Voice settings directly
        apiKey =
          azureVoiceConfig!.apiKey ||
          azureProviderConfig?.apiKey ||
          process.env.AZURE_API_KEY ||
          "";
        resolvedEndpoint = azureVoiceConfig!.baseUrl!.replace(/\/$/, "");
        apiVersion =
          azureVoiceConfig!.apiVersion?.trim() ||
          process.env.AZURE_OPENAI_API_VERSION ||
          "2024-10-01-preview";
        effectiveModel = azureVoiceConfig!.deploymentName!;
        logger.info(
          `Using dedicated Azure Voice config: ${resolvedEndpoint} / ${effectiveModel}`,
        );
      } else {
        // Fall back to generic Azure provider settings
        const settings = azureProviderConfig?.settings ?? {};
        const baseUrl = azureProviderConfig?.baseUrl ?? null;

        apiKey = azureProviderConfig?.apiKey || process.env.AZURE_API_KEY || "";

        const configuredBaseUrl =
          (settings["baseURL"] as string | undefined)?.trim() ||
          (settings["baseUrl"] as string | undefined)?.trim() ||
          (baseUrl && /^https?:\/\//.test(baseUrl) ? baseUrl : null);

        const configuredResourceName =
          (settings["resourceName"] as string | undefined)?.trim() ||
          (settings["resource"] as string | undefined)?.trim() ||
          (baseUrl && !/^https?:\/\//.test(baseUrl) ? baseUrl : null) ||
          process.env.AZURE_RESOURCE_NAME ||
          null;

        const ep = configuredBaseUrl
          ? configuredBaseUrl.replace(/\/$/, "")
          : configuredResourceName
            ? `https://${configuredResourceName}.openai.azure.com`
            : null;

        if (!ep) {
          return new Response(
            JSON.stringify({
              error:
                "Azure OpenAI endpoint is not configured. Please configure Azure Voice Direct in Emma Model Setup, or set Base URL / Resource Name in Settings → Providers.",
            }),
            { status: 500 },
          );
        }

        resolvedEndpoint = ep;
        apiVersion =
          (settings["apiVersion"] as string | undefined)?.trim() ||
          process.env.AZURE_OPENAI_API_VERSION ||
          "2025-04-01-preview";
        effectiveModel = resolvedModel;
      }

      // Build legacy-preview session body using effectiveModel
      const legacySessionBody = JSON.stringify({
        model: effectiveModel,
        voice: resolvedVoice,
        input_audio_transcription: { model: "whisper-1" },
        instructions: systemPrompt,
        tools: bindingTools,
      });

      // ── Determine protocol: GA (Foundry resources) vs legacy preview ────────
      // If dedicated config is set we always use legacy preview (the URL format
      // from the user's working URL matches the legacy /openai/realtime endpoint).
      // Otherwise: preview-named models → legacy preview, GA-named → try GA first.
      const isPreviewModelName =
        effectiveModel.startsWith("gpt-4o-realtime") ||
        effectiveModel.startsWith("gpt-4o-mini-realtime");

      const runLegacyPreview = async (reason?: string) => {
        if (reason)
          logger.info(
            `Using legacy preview protocol (${reason}) for model "${effectiveModel}"`,
          );
        // For cognitiveservices.azure.com endpoints the deployment name must be
        // a query parameter (&deployment=…), NOT just in the request body.
        const deploymentParam = isDedicatedConfig
          ? `&deployment=${encodeURIComponent(effectiveModel)}`
          : "";
        const realtimeEndpointUrl = `${resolvedEndpoint}/openai/realtime?api-version=${apiVersion}${deploymentParam}`;

        // For dedicated Azure Voice config (older api-versions like 2024-10-01-preview):
        // - No /sessions endpoint exists in these versions
        // - The browser cannot call Azure directly with api-key (CORS blocks custom headers)
        // - Solution: skip the session creation, return a server-side SDP proxy URL
        //   The hook will POST the SDP offer to our proxy, which forwards it to Azure
        //   with the api-key header server-side, and returns the SDP answer.
        if (isDedicatedConfig) {
          logger.info(
            `Skipping sessions endpoint for dedicated config (api-version: ${apiVersion}); using server-side SDP proxy`,
          );
          // proxySdpUrl: our server proxies the SDP POST to Azure with api-key
          const proxySdpUrl = `/api/chat/openai-realtime-sdp?endpoint=${encodeURIComponent(realtimeEndpointUrl)}`;
          return Response.json(
            {
              client_secret: { value: "proxy" }, // placeholder — token not used when proxySdpUrl is set
              realtimeEndpointUrl,
              proxySdpUrl,
            },
            { status: 200 },
          );
        }

        const sessionUrl = `${resolvedEndpoint}/openai/realtime/sessions?api-version=${apiVersion}`;
        const r = await azureFetch(sessionUrl, {
          method: "POST",
          headers: { "api-key": apiKey, "Content-Type": "application/json" },
          body: legacySessionBody,
        });
        const sessionData = await r.json();
        if (!r.ok) {
          logger.error(
            `Azure preview session error: ${JSON.stringify(sessionData)}`,
          );
          return Response.json(
            { error: sessionData.error ?? sessionData },
            { status: r.status },
          );
        }
        return Response.json(
          { ...sessionData, realtimeEndpointUrl },
          { status: 200 },
        );
      };

      // Dedicated config or preview model names always use legacy preview
      if (isDedicatedConfig || isPreviewModelName) {
        return runLegacyPreview(
          isDedicatedConfig
            ? "dedicated Azure Voice config"
            : "preview model name",
        );
      }

      // ── Try GA v1 protocol first (Foundry resources) ─────────────────────────
      const gaSessionUrl = `${resolvedEndpoint}/openai/v1/realtime/client_secrets`;
      const gaRealtimeEndpointUrl = `${resolvedEndpoint}/openai/v1/realtime/calls`;

      const gaBody = JSON.stringify({
        session: {
          type: "realtime",
          model: effectiveModel,
          instructions: systemPrompt,
          audio: { output: { voice: resolvedVoice } },
        },
      });

      const gaRes = await azureFetch(gaSessionUrl, {
        method: "POST",
        headers: { "api-key": apiKey, "Content-Type": "application/json" },
        body: gaBody,
      });

      const gaData = await gaRes.json();

      if (!gaRes.ok) {
        const errorCode: string = gaData?.error?.code ?? "";
        if (
          errorCode === "OperationNotSupported" ||
          errorCode === "OpperationNotSupported" ||
          gaRes.status === 404
        ) {
          logger.warn(
            `GA protocol not supported by this Azure resource (${errorCode}); falling back to legacy preview`,
          );
          return runLegacyPreview("GA not supported by resource");
        }
        logger.error(`Azure GA session error: ${JSON.stringify(gaData)}`);
        return Response.json(
          { error: gaData.error ?? gaData },
          { status: gaRes.status },
        );
      }

      return Response.json(
        {
          client_secret: { value: gaData.value },
          realtimeEndpointUrl: gaRealtimeEndpointUrl,
          pendingSessionUpdate: {
            tools: bindingTools,
            input_audio_transcription: { model: "whisper-1" },
          },
        },
        { status: 200 },
      );
    }

    // ── OpenAI path ───────────────────────────────────────────────────────────
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: sessionBody,
    });

    const sessionData = await r.json();
    return Response.json(
      {
        ...sessionData,
        realtimeEndpointUrl: "https://api.openai.com/v1/realtime",
      },
      { status: 200 },
    );
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
