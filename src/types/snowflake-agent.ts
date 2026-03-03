import z from "zod";

export const SnowflakeAgentConfigCreateSchema = z.object({
  accountLocator: z
    .string()
    .min(1, "Account locator is required")
    .describe("Short account locator format (e.g. ABC12345) used for JWT auth"),
  account: z
    .string()
    .min(1, "Account is required")
    .describe(
      "Full org-account format (e.g. MYORG-MYACCOUNT) used for API URL",
    ),
  snowflakeUser: z.string().min(1, "Snowflake username is required"),
  privateKeyPem: z
    .string()
    .min(1, "RSA private key is required")
    .describe("RSA private key in PEM/PKCS8 format"),
  database: z.string().min(1, "Database name is required"),
  schema: z.string().min(1, "Schema name is required"),
  cortexAgentName: z.string().min(1, "Cortex agent name is required"),
});

export const SnowflakeAgentConfigUpdateSchema =
  SnowflakeAgentConfigCreateSchema.partial();

export type SnowflakeAgentConfig = z.infer<
  typeof SnowflakeAgentConfigCreateSchema
> & {
  id: string;
  agentId: string;
  createdAt: Date;
  updatedAt: Date;
};

// Redacted version that masks the private key for safe display in UI
export type SnowflakeAgentConfigSafe = Omit<
  SnowflakeAgentConfig,
  "privateKeyPem"
> & {
  privateKeyPem: string; // Will be "••••••••" redacted value
  hasPrivateKey: boolean;
};

export const SnowflakeAgentCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(8000).optional(),
  visibility: z
    .enum(["public", "private", "readonly"])
    .optional()
    .default("private"),
  snowflakeConfig: SnowflakeAgentConfigCreateSchema,
});

export type SnowflakeAgentCreateInput = z.infer<
  typeof SnowflakeAgentCreateSchema
>;

export type SnowflakeAgentRepository = {
  insertSnowflakeConfig(
    agentId: string,
    config: z.infer<typeof SnowflakeAgentConfigCreateSchema>,
  ): Promise<SnowflakeAgentConfig>;

  selectSnowflakeConfigByAgentId(
    agentId: string,
  ): Promise<SnowflakeAgentConfig | null>;

  updateSnowflakeConfig(
    agentId: string,
    config: z.infer<typeof SnowflakeAgentConfigUpdateSchema>,
  ): Promise<SnowflakeAgentConfig>;

  deleteSnowflakeConfig(agentId: string): Promise<void>;
};
