import { z } from "zod";

// ─── LLM Provider ─────────────────────────────────────────────────────────────

export type ModelType = "llm" | "image_generation" | "embedding" | "reranking";

export type LlmProviderName =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "groq"
  | "ollama"
  | "openai-compatible";

export type LlmModelConfig = {
  id: string;
  providerId: string;
  apiName: string;
  uiName: string;
  enabled: boolean;
  supportsTools: boolean;
  supportsImageInput: boolean;
  supportsImageGeneration: boolean;
  supportsFileInput: boolean;
  modelType: ModelType;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type LlmProviderConfig = {
  id: string;
  name: string;
  displayName: string;
  /** Masked API key — never returns the raw key to the client */
  apiKeyMasked: string | null;
  baseUrl: string | null;
  enabled: boolean;
  models: LlmModelConfig[];
  createdAt: Date;
  updatedAt: Date;
};

// ─── Other Configs ────────────────────────────────────────────────────────────

export type OtherConfig = {
  exaApiKey?: string;
};

// ─── Minio ────────────────────────────────────────────────────────────────────

export type MinioConfig = {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region?: string;
  useSSL: boolean;
};

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

export const LlmModelConfigZodSchema = z.object({
  apiName: z.string().min(1, "API name is required"),
  uiName: z.string().min(1, "Display name is required"),
  enabled: z.boolean().default(true),
  supportsTools: z.boolean().default(true),
  supportsImageInput: z.boolean().default(false),
  supportsImageGeneration: z.boolean().default(false),
  supportsFileInput: z.boolean().default(false),
  modelType: z
    .enum(["llm", "image_generation", "embedding", "reranking"])
    .default("llm"),
  sortOrder: z.number().int().default(0),
});

export const LlmModelConfigUpdateZodSchema = LlmModelConfigZodSchema.partial();

export const LlmProviderUpsertZodSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1),
  apiKey: z.string().optional().nullable(),
  baseUrl: z.string().url().optional().nullable(),
  enabled: z.boolean().default(true),
});

export const OtherConfigZodSchema = z.object({
  exaApiKey: z.string().optional(),
});

export const MinioConfigZodSchema = z.object({
  endpoint: z.string().min(1, "Endpoint is required"),
  bucket: z.string().min(1, "Bucket name is required"),
  accessKey: z.string().min(1, "Access key is required"),
  secretKey: z.string().min(1, "Secret key is required"),
  region: z.string().optional(),
  useSSL: z.boolean().default(true),
});

export type LlmModelConfigInput = z.infer<typeof LlmModelConfigZodSchema>;
export type LlmProviderUpsertInput = z.infer<typeof LlmProviderUpsertZodSchema>;
export type MinioConfigInput = z.infer<typeof MinioConfigZodSchema>;
export type OtherConfigInput = z.infer<typeof OtherConfigZodSchema>;
