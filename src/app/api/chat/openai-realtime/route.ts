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

      const apiKey =
        azureProviderConfig?.apiKey || process.env.AZURE_API_KEY || "";
      const settings = azureProviderConfig?.settings ?? {};
      const baseUrl = azureProviderConfig?.baseUrl ?? null;

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

      const resolvedEndpoint = configuredBaseUrl
        ? configuredBaseUrl.replace(/\/$/, "")
        : configuredResourceName
          ? `https://${configuredResourceName}.openai.azure.com`
          : null;

      if (!resolvedEndpoint) {
        return new Response(
          JSON.stringify({
            error:
              "Azure OpenAI endpoint is not configured. Please set Base URL or Resource Name in Settings → Providers.",
          }),
          { status: 500 },
        );
      }

      const apiVersion =
        (settings["apiVersion"] as string | undefined)?.trim() ||
        process.env.AZURE_OPENAI_API_VERSION ||
        "2025-01-01-preview";

      const sessionUrl = `${resolvedEndpoint}/openai/realtime/sessions?api-version=${apiVersion}`;
      const realtimeEndpointUrl = `${resolvedEndpoint}/openai/realtime?api-version=${apiVersion}`;

      const r = await fetch(sessionUrl, {
        method: "POST",
        headers: { "api-key": apiKey, "Content-Type": "application/json" },
        body: sessionBody,
      });

      const sessionData = await r.json();
      return Response.json(
        { ...sessionData, realtimeEndpointUrl },
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
