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
import {
  buildSubAgentToolName,
  extractSubAgentNameFromToolName,
} from "./subagent-utils";

export { buildSubAgentToolName, extractSubAgentNameFromToolName };

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `SubAgent Loader: `),
});

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
            logger.info(
              `Delegating to subagent "${subagent.name}": ${task.slice(0, 100)}...`,
            );

            const streamResult = await subAgentLoopAgent.stream({
              prompt: task,
              abortSignal: toolAbortSignal ?? abortSignal,
            });

            for await (const message of readUIMessageStream({
              stream: streamResult.toUIMessageStream(),
            })) {
              yield message;
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
