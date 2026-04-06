import { getSession } from "auth/server";
import type { UIMessage } from "ai";
import type { ChatMetadata } from "app-types/chat";
import { z } from "zod";
import { chatRepository } from "lib/db/repository";
import { convertToSavePart } from "../../chat/shared.chat";
import { ensureUserChatThread } from "lib/chat/chat-session";

const persistVoiceTurnRequestSchema = z.object({
  threadId: z.string().min(1),
  messages: z.array(z.any()).min(1),
  metadata: z
    .object({
      assistant: z.record(z.string(), z.unknown()).optional(),
      user: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { threadId, messages, metadata } = persistVoiceTurnRequestSchema.parse(
    await request.json(),
  );

  const thread = await ensureUserChatThread({
    threadId,
    userId: session.user.id,
    historyMode: "compacted-tail",
  });

  await Promise.all(
    (messages as UIMessage[]).map((message) =>
      chatRepository.upsertMessage({
        threadId: thread.id,
        id: message.id,
        role: message.role,
        parts: message.parts.map(convertToSavePart),
        metadata:
          message.role === "assistant"
            ? (metadata?.assistant as ChatMetadata | undefined)
            : (metadata?.user as ChatMetadata | undefined),
      }),
    ),
  );

  return Response.json({ success: true });
}
