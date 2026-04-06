import { getSession } from "auth/server";
import type { ChatMention } from "app-types/chat";
import type { AllowedMCPServer } from "app-types/mcp";
import { z } from "zod";
import {
  createNoopDataStream,
  loadWaveAgentBoundTools,
} from "lib/ai/agent/runtime";
import { executeBoundToolCall } from "lib/ai/tool-executor";
import {
  buildVoiceRealtimeToolDefinitions,
  summarizeToolOutputForVoice,
} from "lib/ai/speech/open-ai/realtime-voice-tools";
import { resolveVoiceAgentChatModel } from "lib/ai/speech/voice-agent-model";
import { ensureUserChatThread } from "lib/chat/chat-session";
import { rememberAgentAction } from "../../chat/actions";

const voiceToolExecRequestSchema = z.object({
  sessionId: z.string().min(1),
  callId: z.string().min(1),
  toolName: z.string().min(1),
  args: z.unknown(),
  threadId: z.string().min(1),
  agentId: z.string().optional(),
  mentions: z.array(z.any()).optional(),
  allowedMcpServers: z.record(z.string(), z.any()).optional(),
  allowedAppDefaultToolkit: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const {
    sessionId,
    callId,
    toolName,
    args,
    threadId,
    agentId,
    mentions = [],
    allowedMcpServers,
    allowedAppDefaultToolkit,
  } = voiceToolExecRequestSchema.parse(await request.json());

  await ensureUserChatThread({
    threadId,
    userId: session.user.id,
    historyMode: "compacted-tail",
  });

  const agent = await rememberAgentAction(agentId, session.user.id);
  if (agentId && !agent) {
    return Response.json(
      {
        error:
          "The selected agent is unavailable. Re-open voice chat from a valid agent.",
      },
      { status: 404 },
    );
  }

  const resolvedChatModel = await resolveVoiceAgentChatModel({
    agent,
  });

  if (!resolvedChatModel) {
    return Response.json(
      {
        error:
          "This agent does not support native voice tool execution in Realtime Voice V2.",
      },
      { status: 400 },
    );
  }

  const usageContext = {
    source: "chat" as const,
    actorUserId: session.user.id,
    agentId: agent?.id ?? null,
    threadId,
  };

  const toolset = await loadWaveAgentBoundTools({
    agent,
    userId: session.user.id,
    mentions: mentions as ChatMention[],
    allowedMcpServers: allowedMcpServers as
      | Record<string, AllowedMCPServer>
      | undefined,
    allowedAppDefaultToolkit,
    dataStream: createNoopDataStream(),
    abortSignal: request.signal,
    chatModel: resolvedChatModel,
    source: "agent",
    usageContext,
  });

  const voiceTools = buildVoiceRealtimeToolDefinitions(toolset);
  const voiceTool = voiceTools.find((tool) => tool.name === toolName);
  const tools = {
    ...toolset.mcpTools,
    ...toolset.workflowTools,
    ...toolset.appDefaultTools,
    ...toolset.subagentTools,
    ...toolset.knowledgeTools,
    ...toolset.skillTools,
  };

  const output = await executeBoundToolCall({
    toolName,
    tool: tools[toolName],
    args,
    toolCallId: callId,
    abortSignal: request.signal,
  });

  return Response.json(
    {
      ok: !((output as { isError?: boolean })?.isError ?? false),
      sessionId,
      callId,
      toolName,
      output,
      spokenSummary: voiceTool
        ? summarizeToolOutputForVoice({
            output,
            metadata: voiceTool,
          })
        : null,
      tool: voiceTool ?? null,
    },
    { status: 200 },
  );
}
