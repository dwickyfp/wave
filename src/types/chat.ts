import type { LanguageModelUsage, UIMessage } from "ai";
import { z } from "zod";
import type {
  PilotActionProposal,
  PilotTaskState,
  PilotVisualContext,
} from "./pilot";
import { AllowedMCPServerZodSchema } from "./mcp";
import { UserPreferences } from "./user";
import { tag } from "lib/tag";

export type ChatUsage = LanguageModelUsage & {
  inputCostUsd?: number;
  outputCostUsd?: number;
  totalCostUsd?: number;
  inputTokenPricePer1MUsd?: number;
  outputTokenPricePer1MUsd?: number;
};

export type ChatCompactionItem = {
  source: string;
  text: string;
};

export type ChatCompactionSummary = {
  conversationGoal: string;
  userPreferences: ChatCompactionItem[];
  constraints: ChatCompactionItem[];
  establishedFacts: ChatCompactionItem[];
  decisions: ChatCompactionItem[];
  toolResults: ChatCompactionItem[];
  artifacts: ChatCompactionItem[];
  openQuestions: ChatCompactionItem[];
  nextActions: ChatCompactionItem[];
};

export type ChatThreadCompactionCheckpoint = {
  id: string;
  threadId: string;
  schemaVersion: number;
  summaryJson: ChatCompactionSummary;
  summaryText: string;
  compactedMessageCount: number;
  sourceTokenCount: number;
  summaryTokenCount: number;
  modelProvider: string;
  modelName: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ChatCompactionSource = "background" | "pre-send";

export type ChatCompactionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type ChatContextPressureBreakdown = {
  systemPromptTokens?: number;
  checkpointTokens?: number;
  historyTokens?: number;
  knowledgeTokens?: number;
  attachmentPreviewTokens?: number;
  currentTurnTokens?: number;
  loopTokens?: number;
  toolTokens?: number;
  mentionsTokens?: number;
  uploadedFilesTokens?: number;
  extraContextTokens?: number;
  draftTokens?: number;
  totalTokens: number;
  contextLength?: number;
};

export type ChatThreadCompactionState = {
  id: string;
  threadId: string;
  status: ChatCompactionStatus;
  source: ChatCompactionSource;
  beforeTokens?: number | null;
  afterTokens?: number | null;
  failureCode?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ChatCompactionMetadata = {
  performed?: boolean;
  beforeTokens?: number;
  afterTokens?: number;
  compactedMessageCount?: number;
  checkpointUpdated?: boolean;
  failureCode?: string;
  breakdown?: ChatContextPressureBreakdown;
};

export type ChatKnowledgeSource = {
  groupId: string;
  groupName: string;
  documentId: string;
  documentName: string;
  sourceGroupId?: string | null;
  sourceGroupName?: string | null;
  isInherited?: boolean;
  matchedSections?: string[];
};

export type ChatKnowledgeCitation = {
  number: number;
  groupId: string;
  groupName: string;
  documentId: string;
  documentName: string;
  sourceGroupId?: string | null;
  sourceGroupName?: string | null;
  isInherited?: boolean;
  versionId?: string | null;
  sectionId?: string | null;
  sectionHeading?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  excerpt: string;
  relevanceScore: number;
};

export type ChatKnowledgeImage = {
  groupId: string;
  groupName: string;
  documentId: string;
  documentName: string;
  imageId: string;
  versionId?: string | null;
  label: string;
  description: string;
  headingPath?: string | null;
  stepHint?: string | null;
  pageNumber?: number | null;
  assetUrl: string | null;
};

export type ChatMetadata = {
  usage?: ChatUsage;
  chatModel?: ChatModel;
  toolChoice?: "auto" | "none" | "manual";
  toolCount?: number;
  responseMode?: "default" | "voice";
  voiceMode?: "legacy" | "realtime_native";
  activatedSkills?: string[];
  agentId?: string;
  source?: "chat" | "emma_pilot";
  tabUrl?: string;
  tabTitle?: string;
  lastApprovedActionSummary?: string;
  pilotProposals?: PilotActionProposal[];
  pilotTaskState?: PilotTaskState;
  pilotVisualMode?: PilotVisualContext["mode"];
  pilotVisualCaptureCount?: number;
  compaction?: ChatCompactionMetadata;
  knowledgeSources?: ChatKnowledgeSource[];
  knowledgeCitations?: ChatKnowledgeCitation[];
  knowledgeImages?: ChatKnowledgeImage[];
};

export type ChatFeedbackType = "like" | "dislike";

export type ChatMessageFeedback = {
  id: string;
  messageId: string;
  userId: string;
  type: ChatFeedbackType;
  reason?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ChatModel = {
  provider: string;
  model: string;
};

export const ChatAttachmentSchema = z.object({
  type: z.enum(["file", "source-url"]),
  url: z.string(),
  mediaType: z.string().optional(),
  filename: z.string().optional(),
});

export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

export type ChatThread = {
  id: string;
  title: string;
  userId: string;
  createdAt: Date;
  /** Snowflake Cortex thread UUID — only set for Snowflake-backed sessions */
  snowflakeThreadId?: string | null;
  /**
   * Last successful Snowflake assistant message_id for this thread.
   * 0 = start of thread; subsequent turns use the last assistant message_id.
   */
  snowflakeParentMessageId?: number | null;
  /** Last A2A agent used for the thread, so continuity resets on agent switch. */
  a2aAgentId?: string | null;
  /** A2A context ID used to continue the same remote conversation. */
  a2aContextId?: string | null;
  /** Optional A2A task ID returned by the remote agent. */
  a2aTaskId?: string | null;
};

export type ChatThreadListItem = ChatThread & {
  lastMessageAt: number;
};

export type PaginatedChatThreads = {
  items: ChatThreadListItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type ChatThreadDetails = ChatThread & {
  messages: ChatMessage[];
  userPreferences?: UserPreferences;
  compactionCheckpoint?: ChatThreadCompactionCheckpoint | null;
  compactionState?: ChatThreadCompactionState | null;
};

export type ChatMessage = {
  id: string;
  threadId: string;
  role: UIMessage["role"];
  parts: UIMessage["parts"];
  metadata?: ChatMetadata;
  createdAt: Date;
};

export const ChatMentionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("mcpTool"),
    name: z.string(),
    description: z.string().optional(),
    serverName: z.string().optional(),
    serverId: z.string(),
  }),
  z.object({
    type: z.literal("defaultTool"),
    name: z.string(),
    label: z.string(),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal("mcpServer"),
    name: z.string(),
    description: z.string().optional(),
    toolCount: z.number().optional(),
    serverId: z.string(),
  }),
  z.object({
    type: z.literal("workflow"),
    name: z.string(),
    description: z.string().nullish(),
    workflowId: z.string(),
    icon: z
      .object({
        type: z.literal("emoji"),
        value: z.string(),
        style: z.record(z.string(), z.string()).optional(),
      })
      .nullish(),
  }),
  z.object({
    type: z.literal("agent"),
    name: z.string(),
    description: z.string().nullish(),
    agentId: z.string(),
    icon: z
      .object({
        type: z.literal("emoji"),
        value: z.string(),
        style: z.record(z.string(), z.string()).optional(),
      })
      .nullish(),
  }),
  z.object({
    type: z.literal("knowledge"),
    name: z.string(),
    description: z.string().nullish(),
    knowledgeId: z.string(),
    icon: z
      .object({
        type: z.literal("emoji"),
        value: z.string(),
        style: z.record(z.string(), z.string()).optional(),
      })
      .nullish(),
  }),
]);

export type ChatMention = z.infer<typeof ChatMentionSchema>;

export const chatApiSchemaRequestBodySchema = z.object({
  id: z.string(),
  message: z.any() as z.ZodType<UIMessage>,
  responseMode: z.enum(["default", "voice"]).optional(),
  responseLanguageHint: z.string().optional(),
  chatModel: z
    .object({
      provider: z.string(),
      model: z.string(),
    })
    .optional(),
  toolChoice: z.enum(["auto", "none", "manual"]),
  mentions: z.array(ChatMentionSchema).optional(),
  imageTool: z
    .object({ provider: z.string().optional(), model: z.string().optional() })
    .optional(),
  allowedMcpServers: z.record(z.string(), AllowedMCPServerZodSchema).optional(),
  allowedAppDefaultToolkit: z.array(z.string()).optional(),
  attachments: z.array(ChatAttachmentSchema).optional(),
});

export type ChatApiSchemaRequestBody = z.infer<
  typeof chatApiSchemaRequestBodySchema
>;

export type ChatRepository = {
  insertThread(thread: Omit<ChatThread, "createdAt">): Promise<ChatThread>;

  selectThread(id: string): Promise<ChatThread | null>;

  deleteChatMessage(id: string): Promise<void>;

  selectThreadDetails(
    id: string,
    options?: {
      messageOffset?: number;
      messageLimit?: number;
    },
  ): Promise<ChatThreadDetails | null>;

  selectMessagesByThreadId(
    threadId: string,
    options?: {
      offset?: number;
      limit?: number;
    },
  ): Promise<ChatMessage[]>;

  selectMessageById(messageId: string): Promise<ChatMessage | null>;

  selectCompactionCheckpoint(
    threadId: string,
  ): Promise<ChatThreadCompactionCheckpoint | null>;

  selectCompactionState(
    threadId: string,
  ): Promise<ChatThreadCompactionState | null>;

  selectLatestThreadChatModel(threadId: string): Promise<ChatModel | null>;

  selectThreadsByUserId(userId: string): Promise<ChatThreadListItem[]>;
  selectThreadsPageByUserId(
    userId: string,
    input: {
      limit: number;
      offset: number;
    },
  ): Promise<PaginatedChatThreads>;

  updateThread(
    id: string,
    thread: Partial<Omit<ChatThread, "id" | "createdAt">>,
  ): Promise<ChatThread>;

  deleteThread(id: string): Promise<void>;

  upsertThread(
    thread: PartialBy<Omit<ChatThread, "createdAt">, "userId">,
  ): Promise<ChatThread>;

  insertMessage(message: Omit<ChatMessage, "createdAt">): Promise<ChatMessage>;
  upsertMessage(message: Omit<ChatMessage, "createdAt">): Promise<ChatMessage>;

  upsertCompactionCheckpoint(
    checkpoint: PartialBy<
      Omit<ChatThreadCompactionCheckpoint, "createdAt" | "updatedAt">,
      "id"
    >,
  ): Promise<ChatThreadCompactionCheckpoint>;

  upsertCompactionState(
    state: PartialBy<
      Omit<ChatThreadCompactionState, "createdAt" | "updatedAt">,
      "id"
    >,
  ): Promise<ChatThreadCompactionState>;

  deleteCompactionCheckpoint(threadId: string): Promise<void>;

  copyCompactionCheckpoint(
    sourceThreadId: string,
    targetThreadId: string,
  ): Promise<ChatThreadCompactionCheckpoint | null>;

  deleteMessagesByChatIdAfterTimestamp(messageId: string): Promise<void>;

  selectThreadIdByMessageId(messageId: string): Promise<string | null>;

  deleteAllThreads(userId: string): Promise<void>;

  deleteUnarchivedThreads(userId: string): Promise<void>;

  checkAccess(id: string, userId: string): Promise<boolean>;

  insertMessages(
    messages: PartialBy<ChatMessage, "createdAt">[],
  ): Promise<ChatMessage[]>;

  upsertMessageFeedback(
    messageId: string,
    userId: string,
    type: ChatFeedbackType,
    reason?: string,
  ): Promise<ChatMessageFeedback>;

  getMessageFeedback(
    messageId: string,
    userId: string,
  ): Promise<ChatMessageFeedback | null>;

  deleteMessageFeedback(messageId: string, userId: string): Promise<void>;
};

export const ManualToolConfirmTag = tag<{
  confirm: boolean;
}>("manual-tool-confirm");
