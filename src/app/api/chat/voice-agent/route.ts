import { getSession } from "auth/server";
import {
  ChatMentionSchema,
  chatApiSchemaRequestBodySchema,
} from "app-types/chat";
import { rememberAgentAction } from "../actions";
import { resolveVoiceAgentChatModel } from "lib/ai/speech/voice-agent-model";
import { z } from "zod";

const voiceAgentRequestSchema = chatApiSchemaRequestBodySchema
  .omit({
    chatModel: true,
    toolChoice: true,
    imageTool: true,
    attachments: true,
  })
  .extend({
    agentId: z.string().optional(),
    mentions: z.array(ChatMentionSchema).optional(),
  });

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const {
    id,
    message,
    mentions = [],
    agentId,
    responseLanguageHint,
    allowedAppDefaultToolkit,
    allowedMcpServers,
  } = voiceAgentRequestSchema.parse(await request.json());

  const agent = await rememberAgentAction(agentId, session.user.id);
  if (agentId && !agent) {
    return Response.json(
      {
        message:
          "The selected agent is unavailable. Re-open voice chat from a valid agent.",
      },
      { status: 404 },
    );
  }

  const resolvedChatModel = await resolveVoiceAgentChatModel({
    agent,
  });

  const forwardedMentions = agent
    ? [
        {
          type: "agent" as const,
          name: agent.name,
          description: agent.description,
          agentId: agent.id,
          icon: agent.icon,
        },
        ...mentions.filter((mention) => mention.type !== "agent"),
      ]
    : mentions;

  const chatUrl = new URL("/api/chat", request.url);

  return fetch(chatUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(request.headers.get("cookie")
        ? { cookie: request.headers.get("cookie") as string }
        : {}),
    },
    body: JSON.stringify({
      id,
      message,
      responseMode: "voice",
      responseLanguageHint,
      mentions: forwardedMentions,
      allowedAppDefaultToolkit,
      allowedMcpServers,
      toolChoice: "auto",
      ...(resolvedChatModel ? { chatModel: resolvedChatModel } : {}),
    }),
    signal: request.signal,
    cache: "no-store",
  });
}
