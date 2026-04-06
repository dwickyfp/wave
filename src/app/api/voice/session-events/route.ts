import { getSession } from "auth/server";
import { colorize } from "consola/utils";
import globalLogger from "lib/logger";
import { ensureUserChatThread } from "lib/chat/chat-session";
import { deriveVoiceSessionMetrics } from "lib/ai/speech/voice-session-metrics";
import { z } from "zod";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Voice Session Events: `),
});

const sessionEventSchema = z.object({
  at: z.number(),
  type: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

const sessionEventsRequestSchema = z.object({
  sessionId: z.string().min(1),
  threadId: z.string().min(1),
  agentId: z.string().optional(),
  transport: z.enum(["webrtc", "websocket"]).nullable().optional(),
  events: z.array(sessionEventSchema).min(1),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = sessionEventsRequestSchema.parse(await request.json());

  await ensureUserChatThread({
    threadId: payload.threadId,
    userId: session.user.id,
    historyMode: "compacted-tail",
  });

  logger.info("batched voice events", {
    sessionId: payload.sessionId,
    threadId: payload.threadId,
    agentId: payload.agentId ?? null,
    transport: payload.transport ?? null,
    eventCount: payload.events.length,
    metrics: deriveVoiceSessionMetrics(payload.events),
  });

  return Response.json({ success: true });
}
