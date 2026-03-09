import { getSession } from "auth/server";
import {
  UIMessage,
  convertToModelMessages,
  smoothStream,
  streamText,
} from "ai";
import { getDbModel } from "lib/ai/provider-factory";
import globalLogger from "logger";
import { buildUserSystemPrompt } from "lib/ai/prompts";
import { mergeSystemPrompt } from "../shared.chat";
import { getLearnedPersonalizationPromptForUser } from "lib/self-learning/runtime";
import { getUserPreferences } from "lib/user/server";

import { colorize } from "consola/utils";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Temporary Chat API: `),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();

    const session = await getSession();
    if (!session) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { messages, chatModel, instructions } = json as {
      messages: UIMessage[];
      chatModel?: {
        provider: string;
        model: string;
      };
      instructions?: string;
    };
    logger.info(`model: ${chatModel?.provider}/${chatModel?.model}`);

    const dbModelResult = await getDbModel(chatModel);
    if (!dbModelResult) {
      return Response.json(
        {
          message: `Model "${chatModel?.model}" is not configured. Please set it up in Settings → AI Providers.`,
        },
        { status: 503 },
      );
    }

    const userPreferences =
      (await getUserPreferences(session.user.id)) || undefined;
    const learnedPersonalizationPrompt =
      await getLearnedPersonalizationPromptForUser(session.user.id);

    const modelMessages = await convertToModelMessages(messages);
    return streamText({
      model: dbModelResult.model,
      system: mergeSystemPrompt(
        buildUserSystemPrompt(session.user, userPreferences),
        learnedPersonalizationPrompt,
        instructions,
      ),
      messages: modelMessages,
      experimental_transform: smoothStream({ chunking: "word" }),
    }).toUIMessageStreamResponse();
  } catch (error: any) {
    logger.error(error);
    return new Response(error.message || "Oops, an error occured!", {
      status: 500,
    });
  }
}
