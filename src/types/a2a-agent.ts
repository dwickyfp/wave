import z from "zod";

export const A2ARemoteAuthModeSchema = z.enum(["none", "bearer", "header"]);

const A2AAgentSkillSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    inputModes: z.array(z.string()).optional(),
    outputModes: z.array(z.string()).optional(),
    examples: z.array(z.string()).optional(),
  })
  .passthrough();

const A2AAgentInterfaceSchema = z.object({
  transport: z.string().min(1),
  url: z.string().url(),
});

const A2AAgentCapabilitiesSchema = z
  .object({
    streaming: z.boolean().optional(),
    pushNotifications: z.boolean().optional(),
    stateTransitionHistory: z.boolean().optional(),
    extensions: z.array(z.unknown()).optional(),
  })
  .default({});

export const A2AAgentCardSchema = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    protocolVersion: z.string().min(1),
    version: z.string().min(1),
    url: z.string().url(),
    preferredTransport: z.string().optional(),
    skills: z.array(A2AAgentSkillSchema).default([]),
    capabilities: A2AAgentCapabilitiesSchema,
    defaultInputModes: z.array(z.string()).default(["text"]),
    defaultOutputModes: z.array(z.string()).default(["text"]),
    additionalInterfaces: z.array(A2AAgentInterfaceSchema).optional(),
    iconUrl: z.string().url().optional(),
    documentationUrl: z.string().url().optional(),
    provider: z
      .object({
        organization: z.string().min(1),
        url: z.string().url(),
      })
      .optional(),
    securitySchemes: z.record(z.string(), z.unknown()).optional(),
    security: z.array(z.record(z.string(), z.array(z.string()))).optional(),
    supportsAuthenticatedExtendedCard: z.boolean().optional(),
  })
  .passthrough();

export type A2AAgentCard = z.infer<typeof A2AAgentCardSchema>;

export const A2AAgentConfigCreateSchema = z
  .object({
    inputUrl: z.string().url(),
    agentCardUrl: z.string().url(),
    rpcUrl: z.string().url(),
    authMode: A2ARemoteAuthModeSchema.default("none"),
    authHeaderName: z.string().min(1).optional(),
    authSecret: z.string().optional(),
    agentCard: A2AAgentCardSchema,
    lastDiscoveredAt: z.coerce.date().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.authMode === "header" && !value.authHeaderName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Custom header name is required for header auth.",
        path: ["authHeaderName"],
      });
    }

    if (value.authMode !== "none" && !value.authSecret?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Authentication secret is required.",
        path: ["authSecret"],
      });
    }
  });

export const A2AAgentConfigUpdateSchema = A2AAgentConfigCreateSchema.partial()
  .extend({
    refreshDiscovery: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.authMode === "header" &&
      value.authHeaderName !== undefined &&
      !value.authHeaderName.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Custom header name is required for header auth.",
        path: ["authHeaderName"],
      });
    }
  });

export const A2AAgentDiscoverSchema = z
  .object({
    url: z.string().url(),
    authMode: A2ARemoteAuthModeSchema.default("none"),
    authHeaderName: z.string().optional(),
    authSecret: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.authMode === "header" && !value.authHeaderName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Custom header name is required for header auth.",
        path: ["authHeaderName"],
      });
    }

    if (value.authMode !== "none" && !value.authSecret?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Authentication secret is required.",
        path: ["authSecret"],
      });
    }
  });

export type A2AAgentConfig = z.infer<typeof A2AAgentConfigCreateSchema> & {
  id: string;
  agentId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type A2AAgentConfigSafe = Omit<A2AAgentConfig, "authSecret"> & {
  authSecret: string;
  hasAuthSecret: boolean;
};

export type A2AAgentRepository = {
  insertA2AConfig(
    agentId: string,
    config: z.infer<typeof A2AAgentConfigCreateSchema>,
  ): Promise<A2AAgentConfig>;

  selectA2AConfigByAgentId(agentId: string): Promise<A2AAgentConfig | null>;

  updateA2AConfig(
    agentId: string,
    config: z.infer<typeof A2AAgentConfigUpdateSchema>,
  ): Promise<A2AAgentConfig>;

  deleteA2AConfig(agentId: string): Promise<void>;
};
