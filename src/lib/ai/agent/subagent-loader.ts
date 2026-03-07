import {
  ToolLoopAgent,
  tool,
  readUIMessageStream,
  stepCountIs,
  UIMessageStreamWriter,
  Tool,
} from "ai";
import { z } from "zod";
import { Agent } from "app-types/agent";
import { SubAgent } from "app-types/subagent";
import { ChatModel } from "app-types/chat";
import { getDbModel } from "lib/ai/provider-factory";
import {
  loadMcpTools,
  loadWorkFlowTools,
  loadAppDefaultTools,
} from "@/app/api/chat/shared.chat";
import globalLogger from "logger";
import { colorize } from "consola/utils";
import { errorToString, safeJSONParse } from "lib/utils";
import {
  buildSubAgentToolName,
  extractSubAgentNameFromToolName,
} from "./subagent-utils";

export { buildSubAgentToolName, extractSubAgentNameFromToolName };

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `SubAgent Loader: `),
});

const SUBAGENT_MAX_ATTEMPTS = 3;
const SUBAGENT_RETRY_DELAYS_MS = [1000, 2500];

function toAbortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  return reason instanceof Error ? reason : new Error("Aborted");
}

function collectErrorMessages(error: unknown): string[] {
  const values = new Set<string>();

  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      values.add(value.trim());
    }
  };

  push(errorToString(error));

  if (error && typeof error === "object" && "message" in error) {
    push((error as { message?: unknown }).message);
  }

  return Array.from(values);
}

function extractHttpStatus(error: unknown): number | null {
  const queue = collectErrorMessages(error);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    const parsed = safeJSONParse<Record<string, unknown>>(current);
    if (!parsed.success || !parsed.value || typeof parsed.value !== "object") {
      continue;
    }

    const httpStatus = parsed.value.httpStatus;
    if (typeof httpStatus === "number") {
      return httpStatus;
    }

    if (typeof parsed.value.message === "string") {
      queue.push(parsed.value.message);
    }
  }

  return null;
}

function isTransientSubagentError(error: unknown): boolean {
  const httpStatus = extractHttpStatus(error);
  if (httpStatus && [429, 500, 502, 503, 504].includes(httpStatus)) {
    return true;
  }

  const message = collectErrorMessages(error).join(" ").toLowerCase();
  return [
    "provider_unavailable",
    "service temporarily unavailable",
    "temporarily unavailable",
    "at capacity",
    "try again later",
    "rate limit",
    "too many requests",
    "timeout",
    "timed out",
    "econnreset",
    "gateway",
  ].some((pattern) => message.includes(pattern));
}

async function waitForRetryDelay(delayMs: number, signal?: AbortSignal) {
  if (!delayMs) return;
  if (signal?.aborted) {
    throw toAbortError(signal);
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      reject(toAbortError(signal));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Convert the agent's subagents into Vercel AI SDK tool definitions.
 * Each subagent becomes a streaming tool that the parent agent can delegate to.
 *
 * Returns a map of { toolName → tool } plus a lookup map for UI display.
 */
export async function loadSubAgentTools(
  agent: Agent & { subAgents?: SubAgent[] },
  dataStream: UIMessageStreamWriter,
  abortSignal: AbortSignal,
  chatModel: ChatModel,
): Promise<Record<string, Tool>> {
  const subAgents = agent.subAgents ?? [];
  const enabledSubAgents = subAgents.filter((sa) => sa.enabled);

  if (enabledSubAgents.length === 0) return {};

  const result: Record<string, Tool> = {};

  await Promise.all(
    enabledSubAgents.map(async (subagent) => {
      try {
        const toolName = buildSubAgentToolName(subagent);

        // Load subagent's tools using its configured mentions
        const [mcpTools, workflowTools, appDefaultTools] = await Promise.all([
          loadMcpTools({ mentions: subagent.tools }),
          loadWorkFlowTools({
            mentions: subagent.tools,
            dataStream,
          }),
          loadAppDefaultTools({ mentions: subagent.tools }),
        ]);

        const subAgentTools = {
          ...mcpTools,
          ...workflowTools,
          ...appDefaultTools,
        };

        const dbModelResult = await getDbModel(chatModel);
        if (!dbModelResult) {
          logger.error(
            `Model "${chatModel?.model}" not configured, skipping subagent "${subagent.name}"`,
          );
          return;
        }

        const instructions =
          subagent.instructions ||
          `You are a specialized assistant called "${subagent.name}". Complete the given task autonomously and thoroughly.

When you have finished, write a clear summary of your findings as your final response. This summary will be returned to the parent agent, so include all relevant information.`;

        const subAgentLoopAgent = new ToolLoopAgent({
          model: dbModelResult.model,
          instructions,
          tools: subAgentTools,
          stopWhen: stepCountIs(10),
          maxRetries: 4,
        });

        const description =
          subagent.description ||
          `Delegate a task to the ${subagent.name} subagent. It will work autonomously using its specialized tools and return a summary.`;

        result[toolName] = tool({
          description,
          inputSchema: z.object({
            task: z
              .string()
              .describe(
                `The specific task to delegate to ${subagent.name}. Be detailed and explicit.`,
              ),
          }),
          execute: async function* (
            { task },
            { abortSignal: toolAbortSignal },
          ) {
            const effectiveAbortSignal = toolAbortSignal ?? abortSignal;
            logger.info(
              `Delegating to subagent "${subagent.name}": ${task.slice(0, 100)}...`,
            );

            for (let attempt = 1; attempt <= SUBAGENT_MAX_ATTEMPTS; attempt++) {
              let yieldedAny = false;

              try {
                const streamResult = await subAgentLoopAgent.stream({
                  prompt: task,
                  abortSignal: effectiveAbortSignal,
                });

                for await (const message of readUIMessageStream({
                  stream: streamResult.toUIMessageStream(),
                })) {
                  yieldedAny = true;
                  yield message;
                }

                return;
              } catch (error) {
                if (
                  effectiveAbortSignal?.aborted ||
                  yieldedAny ||
                  attempt >= SUBAGENT_MAX_ATTEMPTS ||
                  !isTransientSubagentError(error)
                ) {
                  throw error;
                }

                const delayMs = SUBAGENT_RETRY_DELAYS_MS[attempt - 1] ?? 2500;
                logger.warn(
                  `Transient provider failure in subagent "${subagent.name}" (attempt ${attempt}/${SUBAGENT_MAX_ATTEMPTS}): ${errorToString(error)}. Retrying in ${delayMs}ms.`,
                );
                await waitForRetryDelay(delayMs, effectiveAbortSignal);
              }
            }
          },
          toModelOutput: ({ output: message }) => {
            const lastTextPart = message?.parts?.findLast(
              (p: any) => p.type === "text",
            );
            return {
              type: "text",
              value: lastTextPart?.text ?? "Task completed.",
            };
          },
        });

        logger.info(`Loaded subagent tool: ${toolName} (${subagent.name})`);
      } catch (error) {
        logger.error(`Failed to load subagent "${subagent.name}":`, error);
      }
    }),
  );

  return result;
}

export { isSubAgentToolName } from "./subagent-utils";
