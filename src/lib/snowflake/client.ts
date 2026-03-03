import * as fs from "node:fs";
import * as path from "node:path";
import type { SnowflakeAgentConfig } from "app-types/snowflake-agent";
import { generateSnowflakeJwt } from "./auth";

/** Absolute path of the SSE log file written during every stream. */
const SSE_LOG_PATH = path.join(process.cwd(), "logs", "snowflake-sse.log");

/**
 * Appends a single SSE log entry to the log file.
 * The directory is created on demand so we never crash on a missing folder.
 */
function appendSseLog(eventType: string, rawData: string): void {
  try {
    const dir = path.dirname(SSE_LOG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const ts = new Date().toISOString();
    const line = `[${ts}] event=${eventType || "(none)"} data=${rawData}\n`;
    fs.appendFileSync(SSE_LOG_PATH, line, "utf8");
  } catch {
    // Best-effort — never let logging break the stream
  }
}

export type SnowflakeCortexMessage = {
  role: "user" | "assistant";
  content: Array<{ type: "text"; text: string }>;
};

export type SnowflakeCortexCallOptions = {
  config: SnowflakeAgentConfig;
  messages: SnowflakeCortexMessage[];
  /**
   * Snowflake Cortex thread UUID.  When provided the agent:run body will
   * include `thread_id` + `parent_message_id` so Snowflake tracks history
   * server-side and only the latest user message is sent in `messages`.
   */
  threadId?: string;
  /**
   * The last successful assistant message_id returned by Snowflake for this
   * thread.  Use 0 for the very first turn.  Required when `threadId` is set.
   */
  parentMessageId?: number;
};

export type SnowflakeCortexResult = {
  text: string;
};

/**
 * Builds the Snowflake Cortex Agent API URL from the config.
 * Uses the full account format (MYORG-MYACCOUNT) for the URL host.
 * Appends the optional role as a query parameter when provided.
 */
export function buildCortexApiUrl(config: SnowflakeAgentConfig): string {
  const { account, database, schema, cortexAgentName, snowflakeRole } = config;
  const base = `https://${account}.snowflakecomputing.com/api/v2/databases/${database}/schemas/${schema}/agents/${cortexAgentName}:run`;
  return snowflakeRole
    ? `${base}?role=${encodeURIComponent(snowflakeRole)}`
    : base;
}

/**
 * Builds the Snowflake Cortex Threads API base URL.
 */
export function buildThreadsApiUrl(config: SnowflakeAgentConfig): string {
  const { account } = config;
  return `https://${account}.snowflakecomputing.com/api/v2/cortex/threads`;
}

/**
 * Creates a new Snowflake Cortex thread and returns the thread_id string.
 * The thread is scoped to the calling user's Snowflake identity.
 *
 * @see https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-threads-rest-api
 */
export async function createSnowflakeThread(
  config: SnowflakeAgentConfig,
  originApplication = "wave",
): Promise<string> {
  const token = generateSnowflakeJwt(
    config.accountLocator,
    config.snowflakeUser,
    config.privateKeyPem,
    config.privateKeyPassphrase ?? undefined,
  );

  const url = buildThreadsApiUrl(config);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
    },
    body: JSON.stringify({ origin_application: originApplication }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Snowflake Threads API error ${response.status}: ${errorBody}`,
    );
  }

  // Snowflake returns the thread UUID as a bare JSON value — the docs show it
  // as a string but some API versions may return a number.  Normalise to string
  // for consistent DB storage; Number() coercion is applied when sending back.
  const raw: unknown = await response.json();
  const threadId = String(raw);
  return threadId;
}

/** Maximum rows to include in a rendered markdown table. */
const MAX_TABLE_ROWS = 1500;

/**
 * Converts a Snowflake result_set object (from a `response.table` SSE event)
 * into a GitHub-Flavored Markdown table string.
 */
function resultSetToMarkdown(resultSet: {
  data: string[][];
  resultSetMetaData?: {
    numRows?: number;
    rowType?: Array<{ name: string }>;
  };
}): string {
  const cols = resultSet.resultSetMetaData?.rowType?.map((c) => c.name) ?? [];
  const allRows = resultSet.data ?? [];
  const totalRows = resultSet.resultSetMetaData?.numRows ?? allRows.length;
  const rows = allRows.slice(0, MAX_TABLE_ROWS);

  if (cols.length === 0 || rows.length === 0) return "";

  const header = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((row) => `| ${row.map((v) => String(v ?? "")).join(" | ")} |`)
    .join("\n");

  let out = `\n${header}\n${sep}\n${body}\n`;
  if (totalRows > MAX_TABLE_ROWS) {
    out += `\n> Showing ${MAX_TABLE_ROWS} of ${totalRows} rows.\n`;
  }
  return out;
}

/**
 * Parses a Server-Sent Events (SSE) streaming response body from Snowflake Cortex
 * and collects only real answer text (skipping thinking/planning events).
 */
async function parseSseResponseStream(
  body: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let currentEventType = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("event:")) {
        currentEventType = trimmed.slice(6).trim();
      } else if (trimmed.startsWith("data:")) {
        const raw = trimmed.slice(5).trim();
        appendSseLog(currentEventType, raw);
        if (!raw || raw === "[DONE]") continue;
        try {
          const data = JSON.parse(raw);
          if (
            currentEventType === "response.text.delta" &&
            typeof data.text === "string"
          ) {
            fullText += data.text;
          } else if (currentEventType === "response.table" && data.result_set) {
            fullText += resultSetToMarkdown(data.result_set);
          }
        } catch {
          // Ignore malformed JSON lines
        }
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
    config.privateKeyPassphrase ?? undefined,
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
 * Discriminated union of every event that callSnowflakeCortexStream can yield.
 * The route handler uses the `type` to decide how to write to the DataStream.
 */
export type SnowflakeStreamEvent =
  /** Chunk of the real answer text */
  | { type: "text-delta"; delta: string }
  /** Chunk that belongs in the reasoning/thinking section */
  | { type: "reasoning-delta"; delta: string }
  /** Markdown table converted from a Snowflake result_set */
  | { type: "table"; markdown: string }
  /** Vega-Lite chart spec JSON string from a data_to_chart tool result */
  | { type: "chart"; spec: string }
  /** Token usage + model emitted at end of stream */
  | {
      type: "metadata";
      model: string;
      inputTokens: number;
      outputTokens: number;
    }
  /**
   * Snowflake thread message IDs — emitted once per turn when `thread_id` is
   * used.  The route handler should store `assistantMessageId` as the new
   * `snowflakeParentMessageId` for the next turn.
   */
  | {
      type: "thread-message-ids";
      userMessageId: number;
      assistantMessageId: number;
    };

/**
 * Calls the Snowflake Cortex Agent API with streaming support.
 * Yields typed SnowflakeStreamEvent objects as they arrive from the SSE stream.
 *
 * When `threadId` is provided the request body includes `thread_id` and
 * `parent_message_id`, and only the **latest user message** is sent in
 * `messages` (Snowflake owns the full history for that thread).
 * Without `threadId` the full `messages` array is sent as before (stateless).
 */
export async function* callSnowflakeCortexStream(
  options: SnowflakeCortexCallOptions,
): AsyncGenerator<SnowflakeStreamEvent> {
  const { config, messages, threadId, parentMessageId } = options;

  const token = generateSnowflakeJwt(
    config.accountLocator,
    config.snowflakeUser,
    config.privateKeyPem,
    config.privateKeyPassphrase ?? undefined,
  );

  const apiUrl = buildCortexApiUrl(config);

  // When using threads, send only the latest user message — Snowflake stores
  // the full history under the thread.  Otherwise send all messages.
  const messagesPayload = threadId
    ? messages.filter((m) => m.role === "user").slice(-1)
    : messages;

  const body: Record<string, unknown> = { messages: messagesPayload };
  if (threadId !== undefined) {
    // Snowflake expects thread_id as an integer, not a string.
    // createSnowflakeThread returns the raw JSON value (may be numeric string);
    // always coerce to number before sending.
    body.thread_id = Number(threadId);
    // parent_message_id: 0 = start of thread; subsequent turns use last
    // successful assistant message_id.
    body.parent_message_id = parentMessageId ?? 0;
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
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
  let currentEventType = "";

  // Capture thread message IDs from the SSE `metadata` events.
  // Snowflake emits one event per role: user then assistant.
  const threadMsgIds: { user?: number; assistant?: number } = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith("event:")) {
        // Track SSE event type — used to decide how to handle the next data: line
        currentEventType = trimmed.slice(6).trim();
      } else if (trimmed.startsWith("data:")) {
        const raw = trimmed.slice(5).trim();
        appendSseLog(currentEventType, raw);
        if (!raw || raw === "[DONE]") continue;
        try {
          const data = JSON.parse(raw);

          switch (currentEventType) {
            // ── Real answer text ─────────────────────────────────────
            case "response.text.delta":
              if (typeof data.text === "string" && data.text) {
                yield { type: "text-delta", delta: data.text };
              }
              break;

            // ── Table result ──────────────────────────────────────────
            case "response.table": {
              if (data.result_set) {
                const markdown = resultSetToMarkdown(data.result_set);
                if (markdown) yield { type: "table", markdown };
              }
              break;
            }

            // ── Thinking text chunks ──────────────────────────────────
            case "response.thinking.delta":
              if (typeof data.text === "string" && data.text) {
                yield { type: "reasoning-delta", delta: data.text };
              }
              break;

            // ── Status / planning steps ───────────────────────────────
            case "response.status":
              if (typeof data.message === "string" && data.message) {
                yield {
                  type: "reasoning-delta",
                  delta: `\n\n**${data.message}**\n`,
                };
              }
              break;

            // ── Tool execution status ─────────────────────────────────
            case "response.tool_result.status":
              if (typeof data.message === "string" && data.message) {
                yield {
                  type: "reasoning-delta",
                  delta: `\n_${data.message}_\n`,
                };
              }
              break;

            // ── Chart spec from data_to_chart tool ───────────────────
            case "response.chart": {
              const raw = data.chart_spec;
              if (typeof raw === "string" && raw.trim()) {
                yield { type: "chart", spec: raw };
              }
              break;
            }

            // ── Tool call info ────────────────────────────────────────
            case "response.tool_use": {
              const name = data.name ?? data.type ?? "tool";
              const query =
                data.input?.original_query ?? data.input?.query ?? "";
              yield {
                type: "reasoning-delta",
                delta: `\n🔧 **${name}**${query ? `: _"${query}"_` : ""}\n`,
              };
              break;
            }

            // ── Thread metadata — captures message_id per role ────────
            case "metadata": {
              if (typeof data.message_id === "number") {
                if (data.role === "user") {
                  threadMsgIds.user = data.message_id;
                } else if (data.role === "assistant") {
                  threadMsgIds.assistant = data.message_id;
                }
              }
              break;
            }

            // ── Final assembled message — extract token metadata ──────
            case "response": {
              const consumed = data.metadata?.usage?.tokens_consumed?.[0];
              if (consumed) {
                yield {
                  type: "metadata",
                  model: consumed.model_name ?? "",
                  inputTokens: consumed.input_tokens?.total ?? 0,
                  outputTokens: consumed.output_tokens?.total ?? 0,
                };
              }
              break;
            }

            // response.thinking (full), response.text (full — already
            // streamed via deltas), response.tool_result (raw data —
            // already rendered via response.table), done: all skipped.
            default:
              break;
          }
        } catch {
          // Ignore malformed JSON lines
        }
      }
    }
  }

  // Once the stream is exhausted, emit thread message IDs if we captured them.
  if (
    threadId !== undefined &&
    threadMsgIds.user !== undefined &&
    threadMsgIds.assistant !== undefined
  ) {
    yield {
      type: "thread-message-ids",
      userMessageId: threadMsgIds.user,
      assistantMessageId: threadMsgIds.assistant,
    };
  }
}
