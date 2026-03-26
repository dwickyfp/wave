import { z } from "zod";
import { settingsRepository } from "lib/db/repository";

export const CONTEXTX_ROLLOUT_KEY = "contextx-rollout";

export const ContextXRolloutSchema = z.object({
  coreRetrieval: z.boolean().default(true),
  multiVectorRead: z.boolean().default(false),
  graphRead: z.boolean().default(false),
  memoryFusion: z.boolean().default(false),
  llmRerankFallback: z.boolean().default(true),
  contentRouting: z.boolean().default(true),
  imageEvidenceRead: z.boolean().default(false),
  imageEvidenceContext: z.boolean().default(false),
});

export type ContextXRollout = z.infer<typeof ContextXRolloutSchema>;

export const DEFAULT_CONTEXTX_ROLLOUT: ContextXRollout =
  ContextXRolloutSchema.parse({});

export async function getContextXRollout(): Promise<ContextXRollout> {
  const raw = await settingsRepository.getSetting?.(CONTEXTX_ROLLOUT_KEY);
  if (!raw) {
    return DEFAULT_CONTEXTX_ROLLOUT;
  }

  const parsed = ContextXRolloutSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }

  return DEFAULT_CONTEXTX_ROLLOUT;
}

export async function setContextXRollout(
  rollout: Partial<ContextXRollout> | null,
): Promise<void> {
  if (!rollout) {
    await settingsRepository.upsertSetting(
      CONTEXTX_ROLLOUT_KEY,
      DEFAULT_CONTEXTX_ROLLOUT,
    );
    return;
  }

  await settingsRepository.upsertSetting(
    CONTEXTX_ROLLOUT_KEY,
    ContextXRolloutSchema.parse({
      ...DEFAULT_CONTEXTX_ROLLOUT,
      ...rollout,
    }),
  );
}
