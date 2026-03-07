import {
  LlmModelConfig,
  LlmModelConfigInput,
  LlmProviderConfig,
  ProviderSettings,
  LlmProviderUpsertInput,
  ModelType,
} from "app-types/settings";
import { and, eq, or } from "drizzle-orm";
import { pgDb as db } from "../db.pg";
import {
  LlmModelConfigTable,
  LlmProviderConfigTable,
  SystemSettingsTable,
} from "../schema.pg";

const MASKED_KEY = "••••••••";

function maskApiKey(key: string | null | undefined): string | null {
  if (!key) return null;
  return MASKED_KEY;
}

function normalizeProviderSettings(value: unknown): ProviderSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: ProviderSettings = {};
  for (const [key, raw] of Object.entries(value)) {
    if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean" ||
      raw === null
    ) {
      normalized[key] = raw;
    }
  }
  return normalized;
}

function mapModelRow(
  row: typeof LlmModelConfigTable.$inferSelect,
): LlmModelConfig {
  return {
    id: row.id,
    providerId: row.providerId,
    apiName: row.apiName,
    uiName: row.uiName,
    enabled: row.enabled,
    contextLength: row.contextLength,
    inputTokenPricePer1MUsd: row.inputTokenPricePer1MUsd,
    outputTokenPricePer1MUsd: row.outputTokenPricePer1MUsd,
    supportsTools: row.supportsTools,
    supportsGeneration: row.supportsGeneration,
    supportsImageInput: row.supportsImageInput,
    supportsImageGeneration: row.supportsImageGeneration,
    supportsFileInput: row.supportsFileInput,
    modelType: (row.modelType as ModelType) ?? "llm",
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sanitizeModelConfigInput<
  T extends Partial<LlmModelConfigInput> & { modelType?: ModelType },
>(data: T, modelType: ModelType): T {
  if (modelType === "llm") {
    return data;
  }

  return {
    ...data,
    contextLength: 0,
    inputTokenPricePer1MUsd: 0,
    outputTokenPricePer1MUsd: 0,
    supportsGeneration: false,
  };
}

export const pgSettingsRepository = {
  // ─── Providers ──────────────────────────────────────────────────────────────

  async getProviders(
    opts: { enabledOnly?: boolean } = {},
  ): Promise<LlmProviderConfig[]> {
    const rows = await db
      .select()
      .from(LlmProviderConfigTable)
      .orderBy(LlmProviderConfigTable.displayName);

    const filtered = opts.enabledOnly ? rows.filter((r) => r.enabled) : rows;

    const result: LlmProviderConfig[] = [];
    for (const row of filtered) {
      const models = await db
        .select()
        .from(LlmModelConfigTable)
        .where(eq(LlmModelConfigTable.providerId, row.id))
        .orderBy(LlmModelConfigTable.sortOrder, LlmModelConfigTable.uiName);

      result.push({
        id: row.id,
        name: row.name,
        displayName: row.displayName,
        apiKeyMasked: maskApiKey(row.apiKey),
        baseUrl: row.baseUrl,
        settings: normalizeProviderSettings(row.settings),
        enabled: row.enabled,
        models: models.map(mapModelRow),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
    return result;
  },

  async getProviderByName(name: string): Promise<{
    id: string;
    apiKey: string | null;
    baseUrl: string | null;
    settings: ProviderSettings;
    enabled: boolean;
  } | null> {
    const [row] = await db
      .select()
      .from(LlmProviderConfigTable)
      .where(eq(LlmProviderConfigTable.name, name));
    if (!row) return null;
    return {
      id: row.id,
      apiKey: row.apiKey,
      baseUrl: row.baseUrl,
      settings: normalizeProviderSettings(row.settings),
      enabled: row.enabled,
    };
  },

  async getProviderById(id: string): Promise<LlmProviderConfig | null> {
    const [row] = await db
      .select()
      .from(LlmProviderConfigTable)
      .where(eq(LlmProviderConfigTable.id, id));
    if (!row) return null;

    const models = await db
      .select()
      .from(LlmModelConfigTable)
      .where(eq(LlmModelConfigTable.providerId, row.id))
      .orderBy(LlmModelConfigTable.sortOrder, LlmModelConfigTable.uiName);

    return {
      id: row.id,
      name: row.name,
      displayName: row.displayName,
      apiKeyMasked: maskApiKey(row.apiKey),
      baseUrl: row.baseUrl,
      settings: normalizeProviderSettings(row.settings),
      enabled: row.enabled,
      models: models.map(mapModelRow),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },

  async upsertProvider(
    data: LlmProviderUpsertInput & { id?: string },
  ): Promise<LlmProviderConfig> {
    const now = new Date();
    const [row] = await db
      .insert(LlmProviderConfigTable)
      .values({
        name: data.name,
        displayName: data.displayName,
        apiKey: data.apiKey ?? null,
        baseUrl: data.baseUrl ?? null,
        settings: normalizeProviderSettings(data.settings),
        enabled: data.enabled ?? true,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: LlmProviderConfigTable.name,
        set: {
          displayName: data.displayName,
          // Only update apiKey if a new value is explicitly provided
          ...(data.apiKey !== undefined ? { apiKey: data.apiKey } : {}),
          baseUrl: data.baseUrl ?? null,
          ...(data.settings !== undefined
            ? { settings: normalizeProviderSettings(data.settings) }
            : {}),
          enabled: data.enabled ?? true,
          updatedAt: now,
        },
      })
      .returning();

    const models = await db
      .select()
      .from(LlmModelConfigTable)
      .where(eq(LlmModelConfigTable.providerId, row.id))
      .orderBy(LlmModelConfigTable.sortOrder);

    return {
      id: row.id,
      name: row.name,
      displayName: row.displayName,
      apiKeyMasked: maskApiKey(row.apiKey),
      baseUrl: row.baseUrl,
      settings: normalizeProviderSettings(row.settings),
      enabled: row.enabled,
      models: models.map(mapModelRow),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },

  async updateProvider(
    id: string,
    data: Partial<LlmProviderUpsertInput>,
  ): Promise<LlmProviderConfig | null> {
    const now = new Date();
    const [row] = await db
      .update(LlmProviderConfigTable)
      .set({
        ...(data.displayName !== undefined
          ? { displayName: data.displayName }
          : {}),
        ...(data.apiKey !== undefined ? { apiKey: data.apiKey } : {}),
        ...(data.baseUrl !== undefined ? { baseUrl: data.baseUrl } : {}),
        ...(data.settings !== undefined
          ? { settings: normalizeProviderSettings(data.settings) }
          : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        updatedAt: now,
      })
      .where(eq(LlmProviderConfigTable.id, id))
      .returning();
    if (!row) return null;

    const models = await db
      .select()
      .from(LlmModelConfigTable)
      .where(eq(LlmModelConfigTable.providerId, row.id))
      .orderBy(LlmModelConfigTable.sortOrder);

    return {
      id: row.id,
      name: row.name,
      displayName: row.displayName,
      apiKeyMasked: maskApiKey(row.apiKey),
      baseUrl: row.baseUrl,
      settings: normalizeProviderSettings(row.settings),
      enabled: row.enabled,
      models: models.map(mapModelRow),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },

  async deleteProvider(id: string): Promise<void> {
    await db
      .delete(LlmProviderConfigTable)
      .where(eq(LlmProviderConfigTable.id, id));
  },

  // ─── Models ─────────────────────────────────────────────────────────────────

  async getModelsByProvider(providerId: string): Promise<LlmModelConfig[]> {
    const rows = await db
      .select()
      .from(LlmModelConfigTable)
      .where(eq(LlmModelConfigTable.providerId, providerId))
      .orderBy(LlmModelConfigTable.sortOrder, LlmModelConfigTable.uiName);
    return rows.map(mapModelRow);
  },

  async getModelForChat(
    providerName: string,
    modelName: string,
  ): Promise<{
    apiName: string;
    contextLength: number;
    inputTokenPricePer1MUsd: number;
    outputTokenPricePer1MUsd: number;
    supportsTools: boolean;
    supportsGeneration: boolean;
    supportsImageInput: boolean;
    supportsFileInput: boolean;
  } | null> {
    const [providerRow] = await db
      .select({ id: LlmProviderConfigTable.id })
      .from(LlmProviderConfigTable)
      .where(
        and(
          eq(LlmProviderConfigTable.name, providerName),
          eq(LlmProviderConfigTable.enabled, true),
        ),
      );
    if (!providerRow) return null;

    const modelRows = await db
      .select()
      .from(LlmModelConfigTable)
      .where(
        and(
          eq(LlmModelConfigTable.providerId, providerRow.id),
          or(
            eq(LlmModelConfigTable.uiName, modelName),
            eq(LlmModelConfigTable.apiName, modelName),
          ),
          eq(LlmModelConfigTable.enabled, true),
        ),
      );

    const modelRow =
      modelRows.find((row) => row.uiName === modelName) ??
      modelRows.find((row) => row.apiName === modelName);
    if (!modelRow) return null;

    return {
      apiName: modelRow.apiName,
      contextLength: modelRow.contextLength,
      inputTokenPricePer1MUsd: modelRow.inputTokenPricePer1MUsd,
      outputTokenPricePer1MUsd: modelRow.outputTokenPricePer1MUsd,
      supportsTools: modelRow.supportsTools,
      supportsGeneration: modelRow.supportsGeneration,
      supportsImageInput: modelRow.supportsImageInput,
      supportsFileInput: modelRow.supportsFileInput,
    };
  },

  async createModel(
    providerId: string,
    data: LlmModelConfigInput,
  ): Promise<LlmModelConfig> {
    const normalizedData = sanitizeModelConfigInput(
      data,
      (data.modelType as ModelType) ?? "llm",
    );
    const [row] = await db
      .insert(LlmModelConfigTable)
      .values({
        providerId,
        apiName: normalizedData.apiName,
        uiName: normalizedData.uiName,
        enabled: normalizedData.enabled ?? true,
        contextLength: normalizedData.contextLength ?? 0,
        inputTokenPricePer1MUsd: normalizedData.inputTokenPricePer1MUsd ?? 0,
        outputTokenPricePer1MUsd: normalizedData.outputTokenPricePer1MUsd ?? 0,
        supportsTools: normalizedData.supportsTools ?? true,
        supportsGeneration: normalizedData.supportsGeneration ?? false,
        supportsImageInput: normalizedData.supportsImageInput ?? false,
        supportsImageGeneration:
          normalizedData.supportsImageGeneration ?? false,
        supportsFileInput: normalizedData.supportsFileInput ?? false,
        modelType: normalizedData.modelType ?? "llm",
        sortOrder: normalizedData.sortOrder ?? 0,
        updatedAt: new Date(),
      })
      .returning();
    return mapModelRow(row);
  },

  async updateModel(
    id: string,
    data: Partial<LlmModelConfigInput>,
  ): Promise<LlmModelConfig | null> {
    const [existingRow] = await db
      .select()
      .from(LlmModelConfigTable)
      .where(eq(LlmModelConfigTable.id, id));
    if (!existingRow) return null;

    const effectiveModelType =
      (data.modelType as ModelType | undefined) ??
      (existingRow.modelType as ModelType) ??
      "llm";
    const normalizedData = sanitizeModelConfigInput(data, effectiveModelType);

    const [row] = await db
      .update(LlmModelConfigTable)
      .set({ ...normalizedData, updatedAt: new Date() })
      .where(eq(LlmModelConfigTable.id, id))
      .returning();
    if (!row) return null;
    return mapModelRow(row);
  },

  async deleteModel(id: string): Promise<void> {
    await db.delete(LlmModelConfigTable).where(eq(LlmModelConfigTable.id, id));
  },

  async getRerankingModel(
    providerName: string,
    modelName: string,
  ): Promise<{ apiName: string } | null> {
    const [providerRow] = await db
      .select({ id: LlmProviderConfigTable.id })
      .from(LlmProviderConfigTable)
      .where(
        and(
          eq(LlmProviderConfigTable.name, providerName),
          eq(LlmProviderConfigTable.enabled, true),
        ),
      );
    if (!providerRow) return null;

    const modelRows = await db
      .select()
      .from(LlmModelConfigTable)
      .where(
        and(
          eq(LlmModelConfigTable.providerId, providerRow.id),
          or(
            eq(LlmModelConfigTable.uiName, modelName),
            eq(LlmModelConfigTable.apiName, modelName),
          ),
          eq(LlmModelConfigTable.enabled, true),
          eq(LlmModelConfigTable.modelType, "reranking"),
        ),
      );

    const modelRow =
      modelRows.find((row) => row.uiName === modelName) ??
      modelRows.find((row) => row.apiName === modelName);
    if (!modelRow) return null;

    return { apiName: modelRow.apiName };
  },

  // ─── System Settings ────────────────────────────────────────────────────────

  async getSetting(key: string): Promise<unknown> {
    const [row] = await db
      .select()
      .from(SystemSettingsTable)
      .where(eq(SystemSettingsTable.key, key));
    return row?.value ?? null;
  },

  async upsertSetting(key: string, value: unknown): Promise<void> {
    const now = new Date();
    await db
      .insert(SystemSettingsTable)
      .values({ key, value: value as any, updatedAt: now })
      .onConflictDoUpdate({
        target: SystemSettingsTable.key,
        set: { value: value as any, updatedAt: now },
      });
  },
};
