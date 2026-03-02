import { streamObject } from "ai";

import { customModelProvider } from "lib/ai/models";
import {
  buildAgentGenerationPrompt,
  buildAgentWithSubAgentsGenerationPrompt,
} from "lib/ai/prompts";
import globalLogger from "logger";
import { ChatModel } from "app-types/chat";

import { getSession } from "auth/server";
import { colorize } from "consola/utils";
import { AgentGenerateSchema } from "app-types/agent";
import { z } from "zod";
import { loadAppDefaultTools } from "../../chat/shared.chat";
import { workflowRepository } from "lib/db/repository";
import { safe } from "ts-safe";
import { objectFlow } from "lib/utils";
import { mcpClientsManager } from "lib/ai/mcp/mcp-manager";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Agent Generate API: `),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();

    const {
      chatModel,
      message = "hello",
      enableSubAgents = false,
    } = json as {
      chatModel?: ChatModel;
      message: string;
      enableSubAgents?: boolean;
    };

    logger.info(
      `chatModel: ${chatModel?.provider}/${chatModel?.model} enableSubAgents: ${enableSubAgents}`,
    );

    const session = await getSession();
    if (!session) {
      return new Response("Unauthorized", { status: 401 });
    }

    const toolNames = new Set<string>();

    await safe(loadAppDefaultTools)
      .ifOk((appTools) => {
        objectFlow(appTools).forEach((_, toolName) => {
          toolNames.add(toolName);
        });
      })
      .unwrap();

    await safe(mcpClientsManager.tools())
      .ifOk((tools) => {
        objectFlow(tools).forEach((mcp) => {
          toolNames.add(mcp._originToolName);
        });
      })
      .unwrap();

    await safe(workflowRepository.selectExecuteAbility(session.user.id))
      .ifOk((tools) => {
        tools.forEach((tool) => {
          toolNames.add(tool.name);
        });
      })
      .unwrap();

    const toolNamesArray = Array.from(toolNames);
    const toolEnum =
      toolNamesArray.length > 0
        ? z.enum([toolNamesArray[0], ...toolNamesArray.slice(1)] as [
            string,
            ...string[],
          ])
        : z.enum([""] as [string]);

    const dynamicAgentTable = AgentGenerateSchema.extend({
      tools: z
        .array(toolEnum)
        .describe("Agent allowed tools name")
        .nullable()
        .default([]),
      ...(enableSubAgents
        ? {
            subAgentsEnabled: z.literal(true).default(true),
            subAgents: z
              .array(
                z.object({
                  name: z.string().describe("Subagent name"),
                  description: z
                    .string()
                    .describe("What this subagent specializes in"),
                  instructions: z
                    .string()
                    .describe("Subagent system instructions"),
                  tools: z
                    .array(toolEnum)
                    .describe("Required tool names for this subagent")
                    .nullable()
                    .default([]),
                }),
              )
              .describe("Specialized subagents for this orchestrator")
              .default([]),
          }
        : {}),
    });

    const system = enableSubAgents
      ? buildAgentWithSubAgentsGenerationPrompt(toolNamesArray)
      : buildAgentGenerationPrompt(toolNamesArray);

    const result = streamObject({
      model: customModelProvider.getModel(chatModel),
      system,
      prompt: message,
      schema: dynamicAgentTable,
    });

    return result.toTextStreamResponse();
  } catch (error) {
    logger.error(error);
  }
}
