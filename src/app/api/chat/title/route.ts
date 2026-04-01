import { smoothStream, streamText } from "ai";

import { getDbModel } from "lib/ai/provider-factory";
import { CREATE_THREAD_TITLE_PROMPT } from "lib/ai/prompts";
import { sanitizeThreadTitle } from "lib/chat/thread-title";
import globalLogger from "logger";
import { ChatModel } from "app-types/chat";
import { chatRepository } from "lib/db/repository";
import { getSession } from "auth/server";
import { colorize } from "consola/utils";
import { handleError } from "../shared.chat";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Title API: `),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();

    const {
      chatModel,
      message = "hello",
      threadId,
    } = json as {
      chatModel?: ChatModel;
      message: string;
      threadId: string;
    };

    const session = await getSession();
    if (!session) {
      return new Response("Unauthorized", { status: 401 });
    }

    logger.info(
      `chatModel: ${chatModel?.provider}/${chatModel?.model}, threadId: ${threadId}`,
    );

    const dbModelResult = await getDbModel(chatModel);
    if (!dbModelResult) {
      // Title generation is optional — skip silently if model not configured
      return new Response("", { status: 200 });
    }

    const result = streamText({
      model: dbModelResult.model,
      system: CREATE_THREAD_TITLE_PROMPT,
      experimental_transform: smoothStream({ chunking: "word" }),
      prompt: message,
      abortSignal: request.signal,
      onFinish: (ctx) => {
        const title = sanitizeThreadTitle(ctx.text);
        if (!title) return;

        chatRepository
          .upsertThread({
            id: threadId,
            title,
            userId: session.user.id,
          })
          .catch((err) => logger.error(err));
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    return new Response(handleError(err), { status: 500 });
  }
}
