import {
  SELF_LEARNING_DEFAULTS,
  SELF_LEARNING_SYSTEM_KEY,
  SelfLearningSystemConfigZodSchema,
} from "app-types/self-learning";
import * as repositories from "lib/db/repository";
import logger from "logger";
import { renderLearnedUserPersonalizationPrompt } from "./logic";

type SelfLearningRepositoryLike = {
  listActiveMemoriesForUser: (
    userId: string,
    limit: number,
  ) => Promise<Array<{ title: string; content: string }>>;
};

type SettingsRepositoryLike = {
  getSetting: (key: string) => Promise<unknown>;
};

export async function getLearnedPersonalizationPromptForUser(
  userId: string,
): Promise<string | false> {
  let selfLearningRepository: SelfLearningRepositoryLike | undefined;
  let settingsRepository: SettingsRepositoryLike | undefined;

  try {
    selfLearningRepository = (repositories as Record<string, unknown>)
      .selfLearningRepository as SelfLearningRepositoryLike | undefined;
    settingsRepository = (repositories as Record<string, unknown>)
      .settingsRepository as SettingsRepositoryLike | undefined;
  } catch {
    return false;
  }

  if (
    !selfLearningRepository ||
    typeof selfLearningRepository.listActiveMemoriesForUser !== "function"
  ) {
    return false;
  }

  try {
    const raw =
      settingsRepository && typeof settingsRepository.getSetting === "function"
        ? await settingsRepository.getSetting(SELF_LEARNING_SYSTEM_KEY)
        : null;
    const parsedSystem = SelfLearningSystemConfigZodSchema.safeParse({
      ...SELF_LEARNING_DEFAULTS,
      ...(raw && typeof raw === "object" ? raw : {}),
    });
    if (!parsedSystem.success) {
      logger.warn(
        `[Self-Learning Runtime] Invalid system config for user ${userId}; falling back to defaults: ${parsedSystem.error.message}`,
      );
    }
    const system = parsedSystem.success
      ? parsedSystem.data
      : SELF_LEARNING_DEFAULTS;
    const memories = await selfLearningRepository.listActiveMemoriesForUser(
      userId,
      system.maxActiveMemories,
    );

    return renderLearnedUserPersonalizationPrompt(
      memories,
      system.maxActiveMemories,
    );
  } catch (error) {
    logger.warn(
      `[Self-Learning Runtime] Failed to load personalization prompt for user ${userId}: ${error}`,
    );
    return false;
  }
}
