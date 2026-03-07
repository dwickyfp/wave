import {
  AGENT_CARD_PATH,
  type AgentCard,
  type Artifact,
  type Message,
  type Part,
  type Task,
  type TaskArtifactUpdateEvent,
  type TaskStatusUpdateEvent,
} from "@a2a-js/sdk";
import {
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  RestTransportFactory,
} from "@a2a-js/sdk/client";
import type { A2AAgentConfig, A2AAgentConfigSafe } from "app-types/a2a-agent";
import {
  A2AAgentCardSchema,
  A2AAgentConfigCreateSchema,
  A2AAgentDiscoverSchema,
} from "app-types/a2a-agent";
import { generateUUID } from "lib/utils";
import z from "zod";

export const A2A_REDACTED_SECRET = "••••••••";
export const A2A_PROTOCOL_VERSION = "0.3.0";

type A2AAuthInput = Pick<
  A2AAgentConfig,
  "authMode" | "authHeaderName" | "authSecret"
>;

export type A2AResolvedCardLookup = {
  normalizedInputUrl: string;
  agentCardUrl: string;
  clientBaseUrl: string;
  clientPath?: string;
};

export type A2ACardFetchAttempt = {
  url: string;
  status?: number;
  contentType?: string | null;
  reason: string;
};

export type A2AResponseEvent = {
  raw: Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;
  text: string;
  contextId?: string;
  taskId?: string;
};

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function isDirectAgentCardPath(pathname: string) {
  return (
    pathname === `/${AGENT_CARD_PATH}` ||
    pathname.endsWith(`/${AGENT_CARD_PATH}`)
  );
}

export function resolveA2ACardLookup(inputUrl: string): A2AResolvedCardLookup {
  const url = new URL(inputUrl.trim());
  const normalizedInputUrl = url.toString();

  if (isDirectAgentCardPath(url.pathname)) {
    return {
      normalizedInputUrl,
      agentCardUrl: normalizedInputUrl,
      clientBaseUrl: normalizedInputUrl,
      clientPath: "",
    };
  }

  const clientBaseUrl = trimTrailingSlash(normalizedInputUrl);
  return {
    normalizedInputUrl,
    agentCardUrl: `${clientBaseUrl}/${AGENT_CARD_PATH}`,
    clientBaseUrl,
  };
}

export function buildA2ACardUrlCandidates(inputUrl: string) {
  const normalizedInputUrl = new URL(inputUrl.trim()).toString();

  if (isDirectAgentCardPath(new URL(normalizedInputUrl).pathname)) {
    return [normalizedInputUrl];
  }

  return Array.from(
    new Set([
      normalizedInputUrl,
      `${trimTrailingSlash(normalizedInputUrl)}/${AGENT_CARD_PATH}`,
      new URL(AGENT_CARD_PATH, normalizedInputUrl).toString(),
      new URL(`/${AGENT_CARD_PATH}`, normalizedInputUrl).toString(),
    ]),
  );
}

function summarizeDiscoveryFailure(attempts: A2ACardFetchAttempt[]) {
  if (attempts.length === 0) {
    return "Unable to resolve an A2A agent card from the provided URL.";
  }

  const details = attempts
    .map((attempt) => {
      const status = attempt.status ? `status ${attempt.status}` : "no status";
      const type = attempt.contentType
        ? `, content-type ${attempt.contentType}`
        : "";
      return `${attempt.url} (${status}${type}): ${attempt.reason}`;
    })
    .join(" | ");

  return `Unable to resolve an A2A agent card. Tried: ${details}`;
}

export async function fetchA2AAgentCard(options: {
  inputUrl: string;
  fetchImpl: typeof fetch;
}) {
  const candidates = buildA2ACardUrlCandidates(options.inputUrl);
  const attempts: A2ACardFetchAttempt[] = [];

  for (const candidate of candidates) {
    try {
      const response = await options.fetchImpl(candidate, {
        headers: {
          Accept:
            "application/json, application/problem+json;q=0.9, text/plain;q=0.5, */*;q=0.1",
        },
      });
      const contentType = response.headers.get("content-type");

      if (!response.ok) {
        attempts.push({
          url: candidate,
          status: response.status,
          contentType,
          reason: "HTTP error",
        });
        continue;
      }

      const body = await response.text();
      const trimmedBody = body.trimStart();

      if (!trimmedBody) {
        attempts.push({
          url: candidate,
          status: response.status,
          contentType,
          reason: "Empty response body",
        });
        continue;
      }

      if (trimmedBody.startsWith("<")) {
        attempts.push({
          url: candidate,
          status: response.status,
          contentType,
          reason: "Returned HTML instead of an A2A agent card JSON document",
        });
        continue;
      }

      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        attempts.push({
          url: candidate,
          status: response.status,
          contentType,
          reason: "Returned non-JSON content",
        });
        continue;
      }

      const agentCard = A2AAgentCardSchema.parse(json);
      return {
        agentCard,
        agentCardUrl: candidate,
        attempts,
      };
    } catch (error) {
      attempts.push({
        url: candidate,
        reason: error instanceof Error ? error.message : "Unknown fetch error",
      });
    }
  }

  throw new Error(summarizeDiscoveryFailure(attempts));
}

export function buildA2AAuthHeaders(input: A2AAuthInput): Headers {
  const headers = new Headers();
  if (input.authMode === "none" || !input.authSecret?.trim()) {
    return headers;
  }

  if (input.authMode === "bearer") {
    headers.set("Authorization", `Bearer ${input.authSecret.trim()}`);
    return headers;
  }

  const headerName = input.authHeaderName?.trim();
  if (headerName) {
    headers.set(headerName, input.authSecret.trim());
  }

  return headers;
}

export function createA2AFetch(input: A2AAuthInput): typeof fetch {
  const authHeaders = buildA2AAuthHeaders(input);

  return async (resource, init) => {
    const headers = new Headers(init?.headers);
    authHeaders.forEach((value, key) => {
      if (!headers.has(key)) headers.set(key, value);
    });

    return fetch(resource, {
      ...init,
      headers,
    });
  };
}

function createA2AClientFactory(fetchImpl: typeof fetch) {
  return new ClientFactory({
    transports: [
      new JsonRpcTransportFactory({ fetchImpl }),
      new RestTransportFactory({ fetchImpl }),
    ],
    cardResolver: new DefaultAgentCardResolver({ fetchImpl }),
  });
}

export async function discoverA2AAgent(
  input: z.input<typeof A2AAgentDiscoverSchema>,
): Promise<z.infer<typeof A2AAgentConfigCreateSchema>> {
  const data = A2AAgentDiscoverSchema.parse(input);
  const fetchImpl = createA2AFetch(data);
  const lookup = resolveA2ACardLookup(data.url);
  const { agentCard, agentCardUrl } = await fetchA2AAgentCard({
    inputUrl: data.url,
    fetchImpl,
  });

  return {
    inputUrl: lookup.normalizedInputUrl,
    agentCardUrl,
    rpcUrl: agentCard.url,
    authMode: data.authMode,
    authHeaderName: data.authHeaderName?.trim() || undefined,
    authSecret: data.authSecret?.trim() || undefined,
    agentCard,
    lastDiscoveredAt: new Date(),
  };
}

export function toSafeA2AConfig(config: A2AAgentConfig): A2AAgentConfigSafe {
  return {
    ...config,
    authHeaderName: config.authHeaderName ?? undefined,
    authSecret: config.authSecret ? A2A_REDACTED_SECRET : "",
    hasAuthSecret: Boolean(config.authSecret),
  };
}

export function extractTextFromA2AParts(parts: Part[] | undefined): string {
  if (!parts?.length) return "";

  return parts
    .flatMap((part) => {
      if (part.kind === "text") return [part.text];
      return [];
    })
    .join("");
}

function extractTextFromArtifact(artifact: Artifact | undefined): string {
  if (!artifact) return "";
  return extractTextFromA2AParts(artifact.parts);
}

export function extractA2AEventText(
  event: Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent,
): string {
  switch (event.kind) {
    case "message":
      return extractTextFromA2AParts(event.parts);
    case "task":
      return [
        extractTextFromA2AParts(event.status.message?.parts),
        ...(event.artifacts ?? []).map(extractTextFromArtifact),
      ]
        .filter(Boolean)
        .join("\n");
    case "status-update":
      return extractTextFromA2AParts(event.status.message?.parts);
    case "artifact-update":
      return extractTextFromArtifact(event.artifact);
    default:
      return "";
  }
}

export function extractA2AEventState(
  event: Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent,
): Pick<A2AResponseEvent, "contextId" | "taskId"> {
  switch (event.kind) {
    case "message":
      return {
        contextId: event.contextId ?? undefined,
        taskId: event.taskId ?? undefined,
      };
    case "task":
      return {
        contextId: event.contextId,
        taskId: event.id,
      };
    case "status-update":
    case "artifact-update":
      return {
        contextId: event.contextId,
        taskId: event.taskId,
      };
    default:
      return {};
  }
}

export async function createA2AClient(config: A2AAgentConfig) {
  const fetchImpl = createA2AFetch(config);
  const factory = createA2AClientFactory(fetchImpl);

  return factory.createFromAgentCard(config.agentCard as AgentCard);
}

export async function* streamA2AAgentResponse(options: {
  config: A2AAgentConfig;
  text: string;
  contextId?: string | null;
  taskId?: string | null;
}) {
  const client = await createA2AClient(options.config);

  for await (const raw of client.sendMessageStream({
    message: {
      kind: "message",
      messageId: generateUUID(),
      role: "user",
      parts: [{ kind: "text", text: options.text }],
      contextId: options.contextId ?? undefined,
      taskId: options.taskId ?? undefined,
    },
    configuration: {
      blocking: true,
      acceptedOutputModes: ["text"],
    },
  })) {
    yield {
      raw,
      text: extractA2AEventText(raw),
      ...extractA2AEventState(raw),
    } satisfies A2AResponseEvent;
  }
}

export async function collectA2AAgentResponse(options: {
  config: A2AAgentConfig;
  text: string;
  contextId?: string | null;
  taskId?: string | null;
}) {
  let contextId = options.contextId ?? undefined;
  let taskId = options.taskId ?? undefined;
  const chunks: string[] = [];

  for await (const event of streamA2AAgentResponse(options)) {
    if (event.text) chunks.push(event.text);
    contextId = event.contextId ?? contextId;
    taskId = event.taskId ?? taskId;
  }

  return {
    text: chunks.join(""),
    contextId,
    taskId,
  };
}
