import { streamObject } from "ai";
import {
  AgentInstructionEnhanceRequestSchema,
  AgentInstructionEnhanceResponseSchema,
} from "app-types/agent";
import { ChatModel } from "app-types/chat";
import { getSession } from "auth/server";
import { buildAgentInstructionEnhancementPrompt } from "lib/ai/prompts";
import { getDbModel } from "lib/ai/provider-factory";
import { z } from "zod";

function buildEnhancementPrompt({
  changePrompt,
  currentInstructions,
  agentContext,
}: {
  changePrompt: string;
  currentInstructions: string;
  agentContext?: {
    name?: string;
    description?: string;
    role?: string;
  };
}) {
  const contextLines = [
    agentContext?.name ? `Name: ${agentContext.name}` : null,
    agentContext?.description
      ? `Description: ${agentContext.description}`
      : null,
    agentContext?.role ? `Role: ${agentContext.role}` : null,
  ].filter(Boolean);

  return [
    contextLines.length > 0
      ? `<agent_context>\n${contextLines.join("\n")}\n</agent_context>`
      : null,
    `<current_instructions>\n${currentInstructions || "(empty)"}\n</current_instructions>`,
    `<requested_change>\n${changePrompt}\n</requested_change>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const json = await request.json();
    const { changePrompt, currentInstructions, chatModel, agentContext } =
      AgentInstructionEnhanceRequestSchema.parse(json) as {
        changePrompt: string;
        currentInstructions: string;
        chatModel?: ChatModel;
        agentContext?: {
          name?: string;
          description?: string;
          role?: string;
        };
      };

    const dbModelResult = await getDbModel(chatModel);
    if (!dbModelResult) {
      return Response.json(
        {
          message:
            "Model is not configured. Please set it up in Settings -> AI Providers.",
        },
        { status: 503 },
      );
    }
    if (!dbModelResult.supportsGeneration) {
      return Response.json(
        {
          message:
            "Selected model cannot generate instructions. Enable Generate Capabilities in Settings -> AI Providers.",
        },
        { status: 400 },
      );
    }

    const result = streamObject({
      model: dbModelResult.model,
      system: buildAgentInstructionEnhancementPrompt(),
      prompt: buildEnhancementPrompt({
        changePrompt,
        currentInstructions,
        agentContext,
      }),
      schema: AgentInstructionEnhanceResponseSchema,
    });

    return result.toTextStreamResponse();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error: "Invalid input",
          details: error.message,
        },
        { status: 400 },
      );
    }

    return Response.json(
      { error: "Failed to enhance instructions" },
      { status: 500 },
    );
  }
}
