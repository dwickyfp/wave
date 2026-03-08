import type { UIMessage } from "ai";
import { z } from "zod";
import { ChatAttachmentSchema, ChatMentionSchema } from "./chat";

export const pilotBrowserSchema = z.enum(["chrome", "edge"]);
export type PilotBrowser = z.infer<typeof pilotBrowserSchema>;

export const pilotTabContextSchema = z.object({
  tabId: z.number().int().optional(),
  url: z.string().url(),
  title: z.string().optional().default(""),
  origin: z.string().optional(),
});

export type PilotTabContext = z.infer<typeof pilotTabContextSchema>;

export const pageSelectOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});

export type PageSelectOption = z.infer<typeof pageSelectOptionSchema>;

export const pageFieldSchema = z.object({
  elementId: z.string(),
  tagName: z.string(),
  type: z.string().optional(),
  label: z.string().optional(),
  name: z.string().optional(),
  placeholder: z.string().optional(),
  text: z.string().optional(),
  value: z.string().optional(),
  required: z.boolean().optional(),
  disabled: z.boolean().optional(),
  checked: z.boolean().optional(),
  options: z.array(pageSelectOptionSchema).optional(),
});

export type PageField = z.infer<typeof pageFieldSchema>;

export const pageFormSchema = z.object({
  formId: z.string(),
  label: z.string().optional(),
  action: z.string().optional(),
  method: z.string().optional(),
  fields: z.array(pageFieldSchema),
});

export type PageForm = z.infer<typeof pageFormSchema>;

export const pageActionableElementSchema = z.object({
  elementId: z.string(),
  role: z.enum(["button", "link", "input", "select", "checkbox", "radio"]),
  label: z.string().optional(),
  text: z.string().optional(),
  href: z.string().optional(),
  disabled: z.boolean().optional(),
});

export type PageActionableElement = z.infer<typeof pageActionableElementSchema>;

export const pageSnapshotSchema = z.object({
  url: z.string().url(),
  title: z.string().optional().default(""),
  visibleText: z.string().optional().default(""),
  selectedText: z.string().optional(),
  focusedElement: pageFieldSchema.nullable().optional(),
  forms: z.array(pageFormSchema).default([]),
  actionables: z.array(pageActionableElementSchema).default([]),
  generatedAt: z.string().optional(),
});

export type PageSnapshot = z.infer<typeof pageSnapshotSchema>;

export const pilotActionKindSchema = z.enum([
  "highlightElement",
  "fillFields",
  "setInputValue",
  "selectOption",
  "toggleCheckbox",
  "clickElement",
  "scrollToElement",
  "navigate",
]);

export type PilotActionKind = z.infer<typeof pilotActionKindSchema>;

export const pilotFieldFillSchema = z.object({
  elementId: z.string(),
  value: z.string(),
});

export type PilotFieldFill = z.infer<typeof pilotFieldFillSchema>;

export const pilotActionProposalSchema = z.object({
  id: z.string(),
  kind: pilotActionKindSchema,
  label: z.string(),
  explanation: z.string(),
  elementId: z.string().optional(),
  url: z.string().url().optional(),
  value: z.string().optional(),
  checked: z.boolean().optional(),
  fields: z.array(pilotFieldFillSchema).optional(),
  requiresApproval: z.boolean().default(true),
  isSensitive: z.boolean().default(false),
  createdAt: z.string(),
});

export type PilotActionProposal = z.infer<typeof pilotActionProposalSchema>;

export const pilotActionApprovalSchema = z.object({
  proposalId: z.string(),
  approvedAt: z.string(),
});

export type PilotActionApproval = z.infer<typeof pilotActionApprovalSchema>;

export const pilotActionResultSchema = z.object({
  proposalId: z.string(),
  status: z.enum(["succeeded", "failed", "skipped"]),
  summary: z.string(),
  error: z.string().optional(),
});

export type PilotActionResult = z.infer<typeof pilotActionResultSchema>;

export const pilotTaskModeSchema = z.enum([
  "analyze",
  "explain",
  "fill",
  "navigate",
  "continue",
]);

export type PilotTaskMode = z.infer<typeof pilotTaskModeSchema>;

export const pilotFieldCoverageBucketSchema = z.enum([
  "ready",
  "missing",
  "sensitive",
  "irrelevant",
]);

export type PilotFieldCoverageBucket = z.infer<
  typeof pilotFieldCoverageBucketSchema
>;

export const pilotFieldCoverageSchema = z.object({
  elementId: z.string(),
  label: z.string().optional(),
  name: z.string().optional(),
  bucket: pilotFieldCoverageBucketSchema,
  reason: z.string().optional(),
});

export type PilotFieldCoverage = z.infer<typeof pilotFieldCoverageSchema>;

export const pilotRelevantActionSchema = z.object({
  elementId: z.string(),
  label: z.string().optional(),
  text: z.string().optional(),
});

export type PilotRelevantAction = z.infer<typeof pilotRelevantActionSchema>;

export const pilotRelevantFormContextSchema = z.object({
  formId: z.string().optional(),
  label: z.string().optional(),
  reason: z.string().optional(),
  targetFieldIds: z.array(z.string()).default([]),
  readyFields: z.array(pilotFieldCoverageSchema).default([]),
  missingFields: z.array(pilotFieldCoverageSchema).default([]),
  sensitiveFields: z.array(pilotFieldCoverageSchema).default([]),
  irrelevantFields: z.array(pilotFieldCoverageSchema).default([]),
  likelySubmitActions: z.array(pilotRelevantActionSchema).default([]),
});

export type PilotRelevantFormContext = z.infer<
  typeof pilotRelevantFormContextSchema
>;

export const pilotTaskPhaseSchema = z.enum([
  "analyzing",
  "awaiting_user_input",
  "ready_to_fill",
  "executing",
  "awaiting_approval",
  "after_execution",
  "completed",
]);

export type PilotTaskPhase = z.infer<typeof pilotTaskPhaseSchema>;

export const pilotTaskStateSchema = z.object({
  mode: pilotTaskModeSchema,
  targetFormId: z.string().optional(),
  targetFieldIds: z.array(z.string()).default([]),
  missingFieldIds: z.array(z.string()).default([]),
  collectedValues: z.record(z.string(), z.string()).default({}),
  lastPhase: pilotTaskPhaseSchema.optional(),
  selectedAgentId: z.string().optional(),
  relevantForm: pilotRelevantFormContextSchema.optional(),
  autoContinuationCount: z.number().int().nonnegative().optional(),
});

export type PilotTaskState = z.infer<typeof pilotTaskStateSchema>;

export const pilotChatRequestSchema = z.object({
  threadId: z.string().uuid().optional(),
  message: z.any() as z.ZodType<UIMessage>,
  messages: z.array(z.any() as z.ZodType<UIMessage>).optional(),
  mentions: z.array(ChatMentionSchema).optional(),
  attachments: z.array(ChatAttachmentSchema).optional(),
  tabContext: pilotTabContextSchema,
  pageSnapshot: pageSnapshotSchema.optional(),
  approvedActionIds: z.array(z.string()).optional(),
  actionResults: z.array(pilotActionResultSchema).optional(),
  chatModel: z
    .object({
      provider: z.string(),
      model: z.string(),
    })
    .optional(),
  stream: z.boolean().optional().default(false),
});

export type PilotChatRequest = z.infer<typeof pilotChatRequestSchema>;

export const pilotChatContinueRequestSchema = z.object({
  threadId: z.string().uuid(),
  tabContext: pilotTabContextSchema,
  pageSnapshot: pageSnapshotSchema.optional(),
  approvedActionIds: z.array(z.string()).optional(),
  actionResults: z.array(pilotActionResultSchema).optional(),
});

export type PilotChatContinueRequest = z.infer<
  typeof pilotChatContinueRequestSchema
>;

export const pilotAuthExchangeResponseSchema = z.object({
  sessionId: z.string().uuid(),
  accessToken: z.string(),
  refreshToken: z.string(),
  accessTokenExpiresAt: z.string(),
  refreshTokenExpiresAt: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    name: z.string().nullable().optional(),
  }),
});

export type PilotAuthExchangeResponse = z.infer<
  typeof pilotAuthExchangeResponseSchema
>;

export const pilotModelOptionSchema = z.object({
  name: z.string(),
  contextLength: z.number(),
  supportsGeneration: z.boolean(),
  isToolCallUnsupported: z.boolean(),
  isImageInputUnsupported: z.boolean(),
  supportedFileMimeTypes: z.array(z.string()),
});

export type PilotModelOption = z.infer<typeof pilotModelOptionSchema>;

export const pilotModelProviderSchema = z.object({
  provider: z.string(),
  hasAPIKey: z.boolean(),
  models: z.array(pilotModelOptionSchema),
});

export type PilotModelProvider = z.infer<typeof pilotModelProviderSchema>;

export const pilotThreadSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  createdAt: z.string(),
  lastMessageAt: z.string(),
  lastChatModel: z
    .object({
      provider: z.string(),
      model: z.string(),
    })
    .nullable()
    .optional(),
  lastAgentId: z.string().nullable().optional(),
});

export type PilotThreadSummary = z.infer<typeof pilotThreadSummarySchema>;

export const pilotThreadDetailSchema = pilotThreadSummarySchema.extend({
  messages: z.array(z.any() as z.ZodType<UIMessage>),
});

export type PilotThreadDetail = z.infer<typeof pilotThreadDetailSchema>;

export const pilotExtensionSessionSummarySchema = z.object({
  id: z.string().uuid(),
  browser: pilotBrowserSchema,
  browserVersion: z.string().nullable().optional(),
  extensionId: z.string(),
  lastUsedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  revokedAt: z.string().nullable().optional(),
});

export type PilotExtensionSessionSummary = z.infer<
  typeof pilotExtensionSessionSummarySchema
>;
