import { NextRequest } from "next/server";
import { getSession } from "auth/server";
import { settingsRepository } from "lib/db/repository";
import globalLogger from "lib/logger";
import { colorize } from "consola/utils";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `OpenAI Realtime SDP Proxy: `),
});

// Re-use the same TLS-skip helper pattern as the main realtime route
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

/**
 * POST /api/chat/openai-realtime-sdp
 *
 * Server-side proxy for the WebRTC SDP exchange with Azure OpenAI.
 * The browser cannot call Azure directly because:
 *  1. The `api-key` header is blocked by CORS from browser contexts.
 *  2. The Azure endpoint requires server-side authentication.
 *
 * Body: raw SDP offer text (Content-Type: application/sdp)
 * Query params:
 *  - endpoint: the full Azure realtime WebRTC URL (including api-version & deployment)
 *
 * Returns the SDP answer from Azure as plain text.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user.id) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const endpoint = searchParams.get("endpoint");
    if (!endpoint) {
      return new Response("Missing ?endpoint query parameter", { status: 400 });
    }

    // Validate endpoint is an Azure OpenAI host to prevent SSRF
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(endpoint);
    } catch {
      return new Response("Invalid endpoint URL", { status: 400 });
    }

    const host = parsedUrl.hostname.toLowerCase();
    const isAzureHost =
      host.endsWith(".openai.azure.com") ||
      host.endsWith(".cognitiveservices.azure.com") ||
      host.endsWith(".azure.com");

    if (!isAzureHost) {
      logger.warn(`Rejected non-Azure SDP proxy target: ${host}`);
      return new Response("Endpoint must be an Azure OpenAI host", {
        status: 400,
      });
    }

    // Read the API key from the dedicated Azure Voice config in DB
    const azureVoiceConfig = (await settingsRepository.getSetting(
      "voice-chat-azure",
    )) as { apiKey?: string } | null;

    const azureProviderConfig =
      await settingsRepository.getProviderByName("azure");

    const apiKey =
      azureVoiceConfig?.apiKey ||
      azureProviderConfig?.apiKey ||
      process.env.AZURE_API_KEY ||
      "";

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Azure API key is not configured" }),
        { status: 500 },
      );
    }

    const sdpOffer = await request.text();
    logger.info(`Proxying SDP offer to: ${endpoint}`);

    const azureResponse = await azureFetch(endpoint, {
      method: "POST",
      body: sdpOffer,
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/sdp",
      },
    });

    const responseText = await azureResponse.text();

    if (!azureResponse.ok) {
      logger.error(
        `Azure SDP proxy error (${azureResponse.status}): ${responseText}`,
      );
      return new Response(responseText, { status: azureResponse.status });
    }

    logger.info(`SDP answer received (${responseText.length} bytes)`);
    return new Response(responseText, {
      status: 200,
      headers: { "Content-Type": "application/sdp" },
    });
  } catch (error: any) {
    logger.error(`SDP proxy error: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }
}
