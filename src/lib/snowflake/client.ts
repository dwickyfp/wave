import { generateSnowflakeJwt } from "./auth";
import type { SnowflakeAgentConfig } from "app-types/snowflake-agent";

export type SnowflakeCortexMessage = {
  role: "user" | "assistant";
  content: Array<{ type: "text"; text: string }>;
};

export type SnowflakeCortexCallOptions = {
  config: SnowflakeAgentConfig;
  messages: SnowflakeCortexMessage[];
};

export type SnowflakeCortexResult = {
  text: string;
};

/**
 * Builds the Snowflake Cortex Agent API URL from the config.
 * Uses the full account format (MYORG-MYACCOUNT) for the URL host.
 */
export function buildCortexApiUrl(config: SnowflakeAgentConfig): string {
  const { account, database, schema, cortexAgentName } = config;
  return `https://${account}.snowflakecomputing.com/api/v2/databases/${database}/schemas/${schema}/agents/${cortexAgentName}:run`;
}

/**
 * Parses a Server-Sent Events (SSE) streaming response body from Snowflake Cortex
 * and collects all text deltas into a single string.
 * Ported from executor.py::_parse_sse_response.
 */
async function parseSseResponseStream(
  body: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // Keep the last partial line in buffer
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) {
        const raw = trimmed.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const data = JSON.parse(raw);
          // Snowflake Cortex SSE events contain a "text" field for response deltas
          if (typeof data.text === "string") {
            fullText += data.text;
          }
        } catch {
          // Ignore malformed JSON lines
        }
      }
    }
  }

  // Process any remaining buffer
  if (buffer.trim().startsWith("data:")) {
    const raw = buffer.trim().slice(5).trim();
    if (raw && raw !== "[DONE]") {
      try {
        const data = JSON.parse(raw);
        if (typeof data.text === "string") {
          fullText += data.text;
        }
      } catch {
        // Ignore
      }
    }
  }

  return fullText.trim();
}

/**
 * Parses a non-streaming JSON response from Snowflake Cortex.
 * Looks for the last assistant/analyst message in the messages array.
 */
function parseJsonResponse(data: unknown): string {
  if (
    data &&
    typeof data === "object" &&
    "messages" in data &&
    Array.isArray((data as any).messages)
  ) {
    const messages = (data as any).messages as any[];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant" || msg.role === "analyst") {
        for (const content of msg.content ?? []) {
          if (content.type === "text" && typeof content.text === "string") {
            return content.text;
          }
        }
      }
    }
  }
  return "I could not retrieve an answer from the Cortex Agent.";
}

/**
 * Calls the Snowflake Cortex Agent API and returns the complete response text.
 * Supports both streaming (SSE) and non-streaming responses.
 *
 * Ported from executor.py::execute
 */
export async function callSnowflakeCortex(
  options: SnowflakeCortexCallOptions,
): Promise<SnowflakeCortexResult> {
  const { config, messages } = options;

  const token = generateSnowflakeJwt(
    config.accountLocator,
    config.snowflakeUser,
    config.privateKeyPem,
  );

  const apiUrl = buildCortexApiUrl(config);

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
      Accept: "application/json",
    },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Snowflake Cortex API error ${response.status}: ${errorBody}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";

  let text: string;
  if (contentType.includes("text/event-stream")) {
    if (!response.body) {
      throw new Error("Snowflake returned SSE response without a body stream");
    }
    text = await parseSseResponseStream(response.body);
  } else {
    const data = await response.json();
    text = parseJsonResponse(data);
  }

  if (!text) {
    text = "I could not retrieve an answer from the Cortex Agent.";
  }

  return { text };
}

/**
 * Calls the Snowflake Cortex Agent API with streaming support.
 * Yields text chunks as they arrive from the SSE stream.
 */
export async function* callSnowflakeCortexStream(
  options: SnowflakeCortexCallOptions,
): AsyncGenerator<string> {
  const { config, messages } = options;

  const token = generateSnowflakeJwt(
    config.accountLocator,
    config.snowflakeUser,
    config.privateKeyPem,
  );

  const apiUrl = buildCortexApiUrl(config);

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Snowflake Cortex API error ${response.status}: ${errorBody}`,
    );
  }

  if (!response.body) {
    throw new Error("Snowflake returned response without a body stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) {
        const raw = trimmed.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const data = JSON.parse(raw);
          if (typeof data.text === "string" && data.text) {
            yield data.text;
          }
        } catch {
          // Ignore malformed JSON lines
        }
      }
    }
  }
}
