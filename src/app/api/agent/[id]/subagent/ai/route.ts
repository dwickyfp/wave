import { streamText, Output } from "ai";
import { getDbModel } from "lib/ai/provider-factory";
import { buildSubAgentGenerationPrompt } from "lib/ai/prompts";
import globalLogger from "logger";
import { ChatModel } from "app-types/chat";
import { getSession } from "auth/server";
import { colorize } from "consola/utils";
import { SubAgentGenerateSchema } from "app-types/subagent";
import { z } from "zod";
import { loadAppDefaultTools } from "@/app/api/chat/shared.chat";
import { workflowRepository, agentRepository } from "lib/db/repository";
import { safe } from "ts-safe";
import { objectFlow } from "lib/utils";
import { mcpClientsManager } from "lib/ai/mcp/mcp-manager";
import { canEditAgent } from "lib/auth/permissions";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `SubAgent Generate API: `),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const json = await request.json();

    const { chatModel, message = "hello" } = json as {
      chatModel?: ChatModel;
      message: string;
    };

    logger.info(`chatModel: ${chatModel?.provider}/${chatModel?.model}`);

    const session = await getSession();
    if (!session) {
      return new Response("Unauthorized", { status: 401 });
    }

    const canEdit = await canEditAgent();
    if (!canEdit) {
      return Response.json(
        { error: "Only editors and admins can generate subagents" },
        { status: 403 },
      );
    }

    const { id } = await params;

    const hasAccess = await agentRepository.checkAccess(id, session.user.id);
    if (!hasAccess) {
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

    const dynamicSubAgentSchema = SubAgentGenerateSchema.extend({
      tools: z
        .array(
          z.enum(
            Array.from(toolNames).length > 0
              ? ([
                  Array.from(toolNames)[0],
                  ...Array.from(toolNames).slice(1),
                ] as [string, ...string[]])
              : ([""] as [string]),
          ),
        )
        .describe("Required tool names")
        .nullable()
        .default([]),
    });

    const system = buildSubAgentGenerationPrompt(Array.from(toolNames));

    const dbModelResult = await getDbModel(chatModel);
    if (!dbModelResult) {
      return Response.json(
        {
          message:
            "Model is not configured. Please set it up in Settings → AI Providers.",
        },
        { status: 503 },
      );
    }

    const result = streamText({
      model: dbModelResult.model,
      system,
      prompt: message,
      output: Output.object({ schema: dynamicSubAgentSchema }),
    });

    return result.toTextStreamResponse();
  } catch (error) {
    logger.error(error);
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
