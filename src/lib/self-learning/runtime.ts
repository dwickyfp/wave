import {
  SELF_LEARNING_DEFAULTS,
  SELF_LEARNING_SYSTEM_KEY,
  SelfLearningSystemConfigZodSchema,
} from "app-types/self-learning";
import * as repositories from "lib/db/repository";
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

  const raw =
    settingsRepository && typeof settingsRepository.getSetting === "function"
      ? await settingsRepository.getSetting(SELF_LEARNING_SYSTEM_KEY)
      : null;
  const system = SelfLearningSystemConfigZodSchema.parse({
    ...SELF_LEARNING_DEFAULTS,
    ...(raw && typeof raw === "object" ? raw : {}),
  });
  const memories = await selfLearningRepository.listActiveMemoriesForUser(
    userId,
    system.maxActiveMemories,
  );

  return renderLearnedUserPersonalizationPrompt(
    memories,
    system.maxActiveMemories,
  );
}
