import "server-only";

import { getSession } from "auth/server";
import { pgDb as db } from "lib/db/pg/db.pg";
import {
  LlmProviderConfigTable,
  LlmModelConfigTable,
} from "lib/db/pg/schema.pg";
import { settingsRepository } from "lib/db/repository";
import { eq } from "drizzle-orm";
import {
  LlmModelConfigZodSchema,
  LlmProviderUpsertZodSchema,
  MinioConfigZodSchema,
  OtherConfigZodSchema,
} from "app-types/settings";
import { NextResponse } from "next/server";
import { z } from "zod";

async function requireAdmin() {
  const session = await getSession();
  if (!session?.user?.id) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (session.user.role !== "admin") {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { session };
}

// ─── Export (GET) ─────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    // Query providers with raw API keys (bypasses repository masking)
    const providerRows = await db
      .select()
      .from(LlmProviderConfigTable)
      .orderBy(LlmProviderConfigTable.displayName);

    const providers = await Promise.all(
      providerRows.map(async (p) => {
        const models = await db
          .select()
          .from(LlmModelConfigTable)
          .where(eq(LlmModelConfigTable.providerId, p.id))
          .orderBy(LlmModelConfigTable.sortOrder, LlmModelConfigTable.uiName);

        return {
          name: p.name,
          displayName: p.displayName,
          apiKey: p.apiKey,
          baseUrl: p.baseUrl,
          enabled: p.enabled,
          models: models.map((m) => ({
            apiName: m.apiName,
            uiName: m.uiName,
            enabled: m.enabled,
            supportsTools: m.supportsTools,
            supportsImageInput: m.supportsImageInput,
            supportsImageGeneration: m.supportsImageGeneration,
            supportsFileInput: m.supportsFileInput,
            modelType: m.modelType,
            sortOrder: m.sortOrder,
          })),
        };
      }),
    );

    const minio = await settingsRepository.getSetting("minio");
    const otherConfigs = await settingsRepository.getSetting("other-configs");

    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      providers,
      minio: minio ?? null,
      otherConfigs: otherConfigs ?? null,
    };

    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="settings-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to export settings" },
      { status: 500 },
    );
  }
}

// ─── Import (POST) ────────────────────────────────────────────────────────────

const BackupModelSchema = LlmModelConfigZodSchema.extend({
  uiName: z.string().min(1),
  apiName: z.string().min(1),
});

const BackupProviderSchema = LlmProviderUpsertZodSchema.extend({
  models: z.array(BackupModelSchema).optional().default([]),
});

const BackupSchema = z.object({
  version: z.number().optional(),
  providers: z.array(BackupProviderSchema).optional().default([]),
  minio: MinioConfigZodSchema.optional().nullable(),
  otherConfigs: OtherConfigZodSchema.optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const json = await request.json();
    const backup = BackupSchema.parse(json);

    const stats = { providers: 0, modelsAdded: 0 };

    for (const providerData of backup.providers) {
      const { models, ...providerInput } = providerData;

      // Upsert provider (creates or updates, preserves existing key if not provided)
      const upserted = await settingsRepository.upsertProvider(providerInput);
      stats.providers++;

      // Add only models that don't already exist (by uiName)
      if (models && models.length > 0) {
        const existingModels = await settingsRepository.getModelsByProvider(
          upserted.id,
        );
        const existingUiNames = new Set(existingModels.map((m) => m.uiName));

        for (const model of models) {
          if (!existingUiNames.has(model.uiName)) {
            await settingsRepository.createModel(upserted.id, model);
            stats.modelsAdded++;
          }
        }
      }
    }

    if (backup.minio) {
      await settingsRepository.upsertSetting("minio", backup.minio);
    }

    if (backup.otherConfigs) {
      await settingsRepository.upsertSetting(
        "other-configs",
        backup.otherConfigs,
      );
    }

    return NextResponse.json({ success: true, ...stats });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to import settings" },
      { status: 500 },
    );
  }
}
