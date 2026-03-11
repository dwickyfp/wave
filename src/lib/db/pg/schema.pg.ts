import { Agent } from "app-types/agent";
import type { A2AAgentCard, A2AAgentConfig } from "app-types/a2a-agent";
import {
  MCPServerConfig,
  MCPToolInfo,
  type McpPublishAuthMode,
} from "app-types/mcp";
import type { ProviderSettings } from "app-types/settings";
import { UserPreferences } from "app-types/user";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  json,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// pgvector custom type
const vector = customType<{ data: number[]; config?: { dimensions?: number } }>(
  {
    dataType(config) {
      if (config?.dimensions) return `vector(${config.dimensions})`;
      return "vector"; // no dimension constraint — accepts any size
    },
    toDriver(value: number[]): string {
      return `[${value.join(",")}]`;
    },
    fromDriver(value: unknown): number[] {
      if (Array.isArray(value)) return value as number[];
      const str = value as string;
      return str
        .replace(/[\[\]]/g, "")
        .split(",")
        .map(Number);
    },
  },
);
import { TipTapMentionJsonContent } from "@/types/util";
import { UIMessage } from "ai";
import {
  ChatCompactionSource,
  ChatCompactionStatus,
  ChatCompactionSummary,
  ChatMention,
  ChatMetadata,
} from "app-types/chat";
import { KnowledgePurpose } from "app-types/knowledge";
import { PilotBrowser } from "app-types/pilot";
import {
  SelfLearningAuditAction,
  SelfLearningEvaluationStatus,
  SelfLearningJudgeOutput,
  SelfLearningMemoryCategory,
  SelfLearningMemoryStatus,
  SelfLearningRunStatus,
  SelfLearningRunTrigger,
  SelfLearningSignalPayload,
  SelfLearningSignalType,
} from "app-types/self-learning";
import { DBEdge, DBNode, DBWorkflow } from "app-types/workflow";
import { isNotNull } from "drizzle-orm";

export const ChatThreadTable = pgTable(
  "chat_thread",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    title: text("title").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    // Snowflake Cortex Threads — persisted per chat session so we can pass
    // thread_id + parent_message_id to agent:run on every subsequent turn.
    // Only populated when the thread is backed by a Snowflake Cortex agent.
    snowflakeThreadId: text("snowflake_thread_id"),
    // The assistant message_id returned by Snowflake for the last successful
    // turn.  Used as parent_message_id for the next agent:run call.
    // 0 means "start of thread" (first user turn).
    // Must be bigint because Snowflake message IDs exceed 32-bit int range.
    snowflakeParentMessageId: bigint("snowflake_parent_message_id", {
      mode: "number",
    }),
    a2aAgentId: uuid("a2a_agent_id").references(() => AgentTable.id, {
      onDelete: "set null",
    }),
    a2aContextId: text("a2a_context_id"),
    a2aTaskId: text("a2a_task_id"),
  },
  (t) => [
    index("chat_thread_user_id_created_at_idx").on(t.userId, t.createdAt),
    index("chat_thread_created_at_idx").on(t.createdAt),
  ],
);

export const ChatMessageTable = pgTable(
  "chat_message",
  {
    id: text("id").primaryKey().notNull(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => ChatThreadTable.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<UIMessage["role"]>(),
    parts: json("parts").notNull().array().$type<UIMessage["parts"]>(),
    metadata: json("metadata").$type<ChatMetadata>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("chat_message_thread_id_created_at_idx").on(t.threadId, t.createdAt),
    index("chat_message_created_at_idx").on(t.createdAt),
  ],
);

export const PilotExtensionAuthCodeTable = pgTable(
  "pilot_extension_auth_code",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    extensionId: text("extension_id").notNull(),
    browser: text("browser").$type<PilotBrowser>().notNull(),
    browserVersion: text("browser_version"),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique().on(table.codeHash),
    index("pilot_extension_auth_code_user_id_idx").on(table.userId),
    index("pilot_extension_auth_code_extension_id_idx").on(table.extensionId),
    index("pilot_extension_auth_code_expires_at_idx").on(table.expiresAt),
  ],
);

export const PilotExtensionSessionTable = pgTable(
  "pilot_extension_session",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    extensionId: text("extension_id").notNull(),
    browser: text("browser").$type<PilotBrowser>().notNull(),
    browserVersion: text("browser_version"),
    accessTokenHash: text("access_token_hash").notNull(),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }).notNull(),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique().on(table.accessTokenHash),
    unique().on(table.refreshTokenHash),
    index("pilot_extension_session_user_id_idx").on(table.userId),
    index("pilot_extension_session_extension_id_idx").on(table.extensionId),
    index("pilot_extension_session_last_used_at_idx").on(table.lastUsedAt),
  ],
);

export const ChatThreadCompactionCheckpointTable = pgTable(
  "chat_thread_compaction_checkpoint",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => ChatThreadTable.id, { onDelete: "cascade" }),
    schemaVersion: integer("schema_version").notNull().default(1),
    summaryJson: json("summary_json").notNull().$type<ChatCompactionSummary>(),
    summaryText: text("summary_text").notNull(),
    compactedMessageCount: integer("compacted_message_count")
      .notNull()
      .default(0),
    sourceTokenCount: integer("source_token_count").notNull().default(0),
    summaryTokenCount: integer("summary_token_count").notNull().default(0),
    modelProvider: text("model_provider").notNull(),
    modelName: text("model_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique().on(table.threadId),
    index("chat_thread_compaction_checkpoint_thread_id_idx").on(table.threadId),
  ],
);

export const ChatThreadCompactionStateTable = pgTable(
  "chat_thread_compaction_state",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => ChatThreadTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().$type<ChatCompactionStatus>(),
    source: text("source").notNull().$type<ChatCompactionSource>(),
    beforeTokens: integer("before_tokens"),
    afterTokens: integer("after_tokens"),
    failureCode: text("failure_code"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique().on(table.threadId),
    index("chat_thread_compaction_state_thread_id_idx").on(table.threadId),
  ],
);

export const AgentTable = pgTable("agent", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  icon: json("icon").$type<Agent["icon"]>(),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  instructions: json("instructions").$type<Agent["instructions"]>(),
  visibility: varchar("visibility", {
    enum: ["public", "private", "readonly"],
  })
    .notNull()
    .default("private"),
  subAgentsEnabled: boolean("sub_agents_enabled").notNull().default(false),
  agentType: varchar("agent_type", {
    enum: ["standard", "snowflake_cortex", "a2a_remote"],
  })
    .notNull()
    .default("standard"),
  chatPersonalizationEnabled: boolean("chat_personalization_enabled")
    .notNull()
    .default(true),
  mcpEnabled: boolean("mcp_enabled").notNull().default(false),
  mcpApiKeyHash: text("mcp_api_key_hash"),
  mcpApiKeyPreview: text("mcp_api_key_preview"),
  a2aEnabled: boolean("a2a_enabled").notNull().default(false),
  a2aApiKeyHash: text("a2a_api_key_hash"),
  a2aApiKeyPreview: text("a2a_api_key_preview"),
  mcpModelProvider: text("mcp_model_provider"),
  mcpModelName: text("mcp_model_name"),
  mcpCodingMode: boolean("mcp_coding_mode").notNull().default(false),
  mcpAutocompleteModelProvider: text("mcp_autocomplete_model_provider"),
  mcpAutocompleteModelName: text("mcp_autocomplete_model_name"),
  mcpPresentationMode: text("mcp_presentation_mode")
    .$type<"compatibility" | "copilot_native">()
    .notNull()
    .default("compatibility"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const A2AAgentConfigTable = pgTable("a2a_agent_config", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .unique()
    .references(() => AgentTable.id, { onDelete: "cascade" }),
  inputUrl: text("input_url").notNull(),
  agentCardUrl: text("agent_card_url").notNull(),
  rpcUrl: text("rpc_url").notNull(),
  authMode: varchar("auth_mode", {
    enum: ["none", "bearer", "header"],
  })
    .$type<A2AAgentConfig["authMode"]>()
    .notNull()
    .default("none"),
  authHeaderName: text("auth_header_name"),
  authSecret: text("auth_secret"),
  agentCard: json("agent_card").$type<A2AAgentCard>().notNull(),
  lastDiscoveredAt: timestamp("last_discovered_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const SnowflakeAgentConfigTable = pgTable("snowflake_agent_config", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .unique()
    .references(() => AgentTable.id, { onDelete: "cascade" }),
  // Account locator is the short format (e.g., ABC12345) used for JWT auth
  accountLocator: text("account_locator").notNull(),
  // Account is the full org-account format (e.g., MYORG-MYACCOUNT) used for API URL
  account: text("account").notNull(),
  snowflakeUser: text("snowflake_user").notNull(),
  // RSA private key in PEM/PKCS8 format (stored as text, handle with care)
  privateKeyPem: text("private_key_pem").notNull(),
  // Optional passphrase for encrypted (PKCS8 encrypted) private keys
  privateKeyPassphrase: text("private_key_passphrase"),
  database: text("database").notNull(),
  schema: text("schema").notNull(),
  cortexAgentName: text("cortex_agent_name").notNull(),
  // Optional Snowflake role for the Cortex Agent REST API (?role=...)
  snowflakeRole: text("snowflake_role"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const SubAgentTable = pgTable(
  "sub_agent",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => AgentTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    instructions: text("instructions"),
    tools: json("tools").$type<ChatMention[]>().default([]),
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("sub_agent_agent_id_idx").on(table.agentId)],
);

export const BookmarkTable = pgTable(
  "bookmark",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull(),
    itemType: varchar("item_type", {
      enum: ["agent", "workflow", "mcp"],
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique().on(table.userId, table.itemId, table.itemType),
    index("bookmark_user_id_idx").on(table.userId),
    index("bookmark_item_idx").on(table.itemId, table.itemType),
  ],
);

export const McpServerTable = pgTable("mcp_server", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: text("name").notNull(),
  config: json("config").notNull().$type<MCPServerConfig>(),
  enabled: boolean("enabled").notNull().default(true),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  visibility: varchar("visibility", {
    enum: ["public", "private"],
  })
    .notNull()
    .default("private"),
  toolInfo: json("tool_info").$type<MCPToolInfo[]>(),
  toolInfoUpdatedAt: timestamp("tool_info_updated_at", { withTimezone: true }),
  lastConnectionStatus: varchar("last_connection_status", {
    enum: ["connected", "error"],
  }),
  publishEnabled: boolean("publish_enabled").notNull().default(false),
  publishAuthMode: varchar("publish_auth_mode", {
    enum: ["none", "bearer"],
  })
    .$type<McpPublishAuthMode>()
    .notNull()
    .default("none"),
  publishApiKeyHash: text("publish_api_key_hash"),
  publishApiKeyPreview: text("publish_api_key_preview"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const UserTable = pgTable("user", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  password: text("password"),
  image: text("image"),
  preferences: json("preferences").default({}).$type<UserPreferences>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  banned: boolean("banned"),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  role: text("role").notNull().default("user"),
});

// Role tables removed - using Better Auth's built-in role system
// Roles are now managed via the 'role' field on UserTable

export const SessionTable = pgTable("session", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  // Admin plugin field (from better-auth generated schema)
  impersonatedBy: text("impersonated_by"),
});

export const AccountTable = pgTable("account", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const VerificationTable = pgTable("verification", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
});

// Tool customization table for per-user additional instructions
export const McpToolCustomizationTable = pgTable(
  "mcp_server_tool_custom_instructions",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => McpServerTable.id, { onDelete: "cascade" }),
    prompt: text("prompt"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [unique().on(table.userId, table.toolName, table.mcpServerId)],
);

export const McpServerCustomizationTable = pgTable(
  "mcp_server_custom_instructions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => McpServerTable.id, { onDelete: "cascade" }),
    prompt: text("prompt"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [unique().on(table.userId, table.mcpServerId)],
);

export const WorkflowTable = pgTable("workflow", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  version: text("version").notNull().default("0.1.0"),
  name: text("name").notNull(),
  icon: json("icon").$type<DBWorkflow["icon"]>(),
  description: text("description"),
  isPublished: boolean("is_published").notNull().default(false),
  visibility: varchar("visibility", {
    enum: ["public", "private", "readonly"],
  })
    .notNull()
    .default("private"),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const WorkflowNodeDataTable = pgTable(
  "workflow_node",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    version: text("version").notNull().default("0.1.0"),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => WorkflowTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    uiConfig: json("ui_config").$type<DBNode["uiConfig"]>().default({}),
    nodeConfig: json("node_config")
      .$type<Partial<DBNode["nodeConfig"]>>()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("workflow_node_kind_idx").on(t.kind)],
);

export const WorkflowEdgeTable = pgTable("workflow_edge", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  version: text("version").notNull().default("0.1.0"),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => WorkflowTable.id, { onDelete: "cascade" }),
  source: uuid("source")
    .notNull()
    .references(() => WorkflowNodeDataTable.id, { onDelete: "cascade" }),
  target: uuid("target")
    .notNull()
    .references(() => WorkflowNodeDataTable.id, { onDelete: "cascade" }),
  uiConfig: json("ui_config").$type<DBEdge["uiConfig"]>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const ArchiveTable = pgTable("archive", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const ArchiveItemTable = pgTable(
  "archive_item",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    archiveId: uuid("archive_id")
      .notNull()
      .references(() => ArchiveTable.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("archive_item_item_id_idx").on(t.itemId)],
);

export const McpOAuthSessionTable = pgTable(
  "mcp_oauth_session",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => McpServerTable.id, { onDelete: "cascade" }),
    serverUrl: text("server_url").notNull(),
    clientInfo: json("client_info"),
    tokens: json("tokens"),
    codeVerifier: text("code_verifier"),
    state: text("state").unique(), // OAuth state parameter for current flow (unique for security)
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("mcp_oauth_session_server_id_idx").on(t.mcpServerId),
    index("mcp_oauth_session_state_idx").on(t.state),
    // Partial index for sessions with tokens for better performance
    index("mcp_oauth_session_tokens_idx")
      .on(t.mcpServerId)
      .where(isNotNull(t.tokens)),
  ],
);

export type McpServerEntity = typeof McpServerTable.$inferSelect;
export type ChatThreadEntity = typeof ChatThreadTable.$inferSelect;
export type ChatMessageEntity = typeof ChatMessageTable.$inferSelect;

export type AgentEntity = typeof AgentTable.$inferSelect;
export type SubAgentEntity = typeof SubAgentTable.$inferSelect;
export type A2AAgentConfigEntity = typeof A2AAgentConfigTable.$inferSelect;
export type SnowflakeAgentConfigEntity =
  typeof SnowflakeAgentConfigTable.$inferSelect;
export type UserEntity = typeof UserTable.$inferSelect;
export type SessionEntity = typeof SessionTable.$inferSelect;

export type ToolCustomizationEntity =
  typeof McpToolCustomizationTable.$inferSelect;
export type McpServerCustomizationEntity =
  typeof McpServerCustomizationTable.$inferSelect;

export const ChatExportTable = pgTable("chat_export", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  title: text("title").notNull(),
  exporterId: uuid("exporter_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  originalThreadId: uuid("original_thread_id"),
  messages: json("messages").notNull().$type<
    Array<{
      id: string;
      role: UIMessage["role"];
      parts: UIMessage["parts"];
      metadata?: ChatMetadata;
    }>
  >(),
  exportedAt: timestamp("exported_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const ChatExportCommentTable = pgTable("chat_export_comment", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  exportId: uuid("export_id")
    .notNull()
    .references(() => ChatExportTable.id, { onDelete: "cascade" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").references(() => ChatExportCommentTable.id, {
    onDelete: "cascade",
  }),
  content: json("content").notNull().$type<TipTapMentionJsonContent>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const ChatMessageFeedbackTable = pgTable(
  "chat_message_feedback",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    messageId: text("message_id")
      .notNull()
      .references(() => ChatMessageTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    type: varchar("type", { enum: ["like", "dislike"] }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique().on(table.messageId, table.userId),
    index("chat_message_feedback_message_id_idx").on(table.messageId),
    index("chat_message_feedback_user_id_idx").on(table.userId),
  ],
);

export type ChatMessageFeedbackEntity =
  typeof ChatMessageFeedbackTable.$inferSelect;

export type ArchiveEntity = typeof ArchiveTable.$inferSelect;
export type ArchiveItemEntity = typeof ArchiveItemTable.$inferSelect;
export type BookmarkEntity = typeof BookmarkTable.$inferSelect;

// ─── LLM Provider & Model Configuration ───────────────────────────────────────

export const LlmProviderConfigTable = pgTable("llm_provider_config", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: text("name").notNull().unique(), // "openrouter" | "openai" | "anthropic" | ...
  displayName: text("display_name").notNull(),
  apiKey: text("api_key"),
  baseUrl: text("base_url"),
  settings: json("settings").$type<ProviderSettings>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const LlmModelConfigTable = pgTable(
  "llm_model_config",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => LlmProviderConfigTable.id, { onDelete: "cascade" }),
    apiName: text("api_name").notNull(),
    uiName: text("ui_name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    contextLength: integer("context_length").notNull().default(0),
    inputTokenPricePer1MUsd: numeric("input_token_price_per_1m_usd", {
      precision: 12,
      scale: 6,
      mode: "number",
    })
      .notNull()
      .default(0),
    outputTokenPricePer1MUsd: numeric("output_token_price_per_1m_usd", {
      precision: 12,
      scale: 6,
      mode: "number",
    })
      .notNull()
      .default(0),
    supportsTools: boolean("supports_tools").notNull().default(true),
    supportsGeneration: boolean("supports_generation").notNull().default(false),
    supportsImageInput: boolean("supports_image_input")
      .notNull()
      .default(false),
    supportsImageGeneration: boolean("supports_image_generation")
      .notNull()
      .default(false),
    supportsFileInput: boolean("supports_file_input").notNull().default(false),
    modelType: varchar("model_type", {
      enum: ["llm", "image_generation", "embedding", "reranking"],
    })
      .notNull()
      .default("llm"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    unique().on(t.providerId, t.uiName),
    index("llm_model_config_provider_id_idx").on(t.providerId),
    index("llm_model_config_provider_id_api_name_idx").on(
      t.providerId,
      t.apiName,
    ),
  ],
);

export const SystemSettingsTable = pgTable("system_settings", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  key: text("key").notNull().unique(),
  value: json("value"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export type LlmProviderConfigEntity =
  typeof LlmProviderConfigTable.$inferSelect;
export type LlmModelConfigEntity = typeof LlmModelConfigTable.$inferSelect;
export type SystemSettingsEntity = typeof SystemSettingsTable.$inferSelect;

// ─── ContextX Knowledge Management ────────────────────────────────────────────

export const KnowledgeGroupTable = pgTable("knowledge_group", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  icon: json("icon").$type<{
    value?: string;
    style?: { backgroundColor?: string };
  }>(),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  visibility: varchar("visibility", {
    enum: ["public", "private", "readonly"],
  })
    .notNull()
    .default("private"),
  purpose: varchar("purpose", { enum: ["default", "personalization"] })
    .notNull()
    .default("default")
    .$type<KnowledgePurpose>(),
  isSystemManaged: boolean("is_system_managed").notNull().default(false),
  embeddingModel: text("embedding_model")
    .notNull()
    .default("text-embedding-3-small"),
  embeddingProvider: text("embedding_provider").notNull().default("openai"),
  rerankingModel: text("reranking_model"),
  rerankingProvider: text("reranking_provider"),
  parseMode: varchar("parse_mode", {
    enum: ["off", "auto", "always"],
  })
    .notNull()
    .default("always"),
  parseRepairPolicy: varchar("parse_repair_policy", {
    enum: ["strict", "section-safe-reorder", "aggressive"],
  })
    .notNull()
    .default("section-safe-reorder"),
  contextMode: varchar("context_mode", {
    enum: ["deterministic", "auto-llm", "always-llm"],
  })
    .notNull()
    .default("always-llm"),
  imageMode: varchar("image_mode", {
    enum: ["off", "auto", "always"],
  })
    .notNull()
    .default("always"),
  lazyRefinementEnabled: boolean("lazy_refinement_enabled")
    .notNull()
    .default(true),
  mcpEnabled: boolean("mcp_enabled").notNull().default(false),
  mcpApiKeyHash: text("mcp_api_key_hash"),
  mcpApiKeyPreview: text("mcp_api_key_preview"),
  chunkSize: integer("chunk_size").notNull().default(768),
  chunkOverlapPercent: integer("chunk_overlap_percent").notNull().default(10),
  parsingModel: text("parsing_model"),
  parsingProvider: text("parsing_provider"),
  retrievalThreshold: real("retrieval_threshold").notNull().default(0.0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const KnowledgeGroupSourceTable = pgTable(
  "knowledge_group_source",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => KnowledgeGroupTable.id, { onDelete: "cascade" }),
    sourceGroupId: uuid("source_group_id")
      .notNull()
      .references(() => KnowledgeGroupTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    unique().on(t.groupId, t.sourceGroupId),
    index("knowledge_group_source_group_id_idx").on(t.groupId),
    index("knowledge_group_source_source_group_id_idx").on(t.sourceGroupId),
  ],
);

export const KnowledgeDocumentTable = pgTable(
  "knowledge_document",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => KnowledgeGroupTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    descriptionManual: boolean("description_manual").notNull().default(false),
    titleManual: boolean("title_manual").notNull().default(false),
    originalFilename: text("original_filename").notNull(),
    fileType: varchar("file_type", {
      enum: ["pdf", "docx", "xlsx", "csv", "txt", "md", "url", "html"],
    }).notNull(),
    fileSize: bigint("file_size", { mode: "number" }),
    storagePath: text("storage_path"),
    sourceUrl: text("source_url"),
    fingerprint: text("fingerprint"),
    status: varchar("status", {
      enum: ["pending", "processing", "ready", "failed"],
    })
      .notNull()
      .default("pending"),
    errorMessage: text("error_message"),
    /** Ingestion progress percentage (0–100). Null when not processing. */
    processingProgress: integer("processing_progress"),
    chunkCount: integer("chunk_count").notNull().default(0),
    tokenCount: integer("token_count").notNull().default(0),
    embeddingTokenCount: integer("embedding_token_count").notNull().default(0),
    metadata: json("metadata"),
    metadataEmbedding: vector("metadata_embedding"),
    /** Full markdown content of the processed document (Context7-style retrieval) */
    markdownContent: text("markdown_content"),
    activeVersionId: uuid("active_version_id"),
    latestVersionNumber: integer("latest_version_number").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("knowledge_document_group_id_idx").on(t.groupId),
    unique("knowledge_document_group_fingerprint_unique").on(
      t.groupId,
      t.fingerprint,
    ),
  ],
);

export const KnowledgeDocumentVersionTable = pgTable(
  "knowledge_document_version",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => KnowledgeDocumentTable.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => KnowledgeGroupTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    status: varchar("status", {
      enum: ["processing", "ready", "failed"],
    })
      .notNull()
      .default("processing"),
    changeType: varchar("change_type", {
      enum: ["initial_ingest", "edit", "rollback", "reingest"],
    }).notNull(),
    markdownContent: text("markdown_content"),
    resolvedTitle: text("resolved_title").notNull(),
    resolvedDescription: text("resolved_description"),
    metadata: json("metadata"),
    metadataEmbedding: vector("metadata_embedding"),
    embeddingProvider: text("embedding_provider").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    chunkCount: integer("chunk_count").notNull().default(0),
    tokenCount: integer("token_count").notNull().default(0),
    embeddingTokenCount: integer("embedding_token_count").notNull().default(0),
    sourceVersionId: uuid("source_version_id"),
    createdByUserId: uuid("created_by_user_id").references(() => UserTable.id, {
      onDelete: "set null",
    }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    unique("knowledge_document_version_document_version_unique").on(
      t.documentId,
      t.versionNumber,
    ),
    index("knowledge_document_version_document_id_idx").on(t.documentId),
    index("knowledge_document_version_group_id_idx").on(t.groupId),
    index("knowledge_document_version_source_version_id_idx").on(
      t.sourceVersionId,
    ),
  ],
);

export const KnowledgeSectionTable = pgTable(
  "knowledge_section",
  {
    id: uuid("id").primaryKey().notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => KnowledgeDocumentTable.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => KnowledgeGroupTable.id, { onDelete: "cascade" }),
    parentSectionId: uuid("parent_section_id"),
    prevSectionId: uuid("prev_section_id"),
    nextSectionId: uuid("next_section_id"),
    heading: text("heading").notNull(),
    headingPath: text("heading_path").notNull(),
    level: integer("level").notNull().default(1),
    partIndex: integer("part_index").notNull().default(0),
    partCount: integer("part_count").notNull().default(1),
    content: text("content").notNull(),
    summary: text("summary").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    embedding: vector("embedding"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("knowledge_section_group_id_idx").on(t.groupId),
    index("knowledge_section_document_id_idx").on(t.documentId),
    index("knowledge_section_parent_section_id_idx").on(t.parentSectionId),
  ],
);

export const KnowledgeChunkTable = pgTable(
  "knowledge_chunk",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => KnowledgeDocumentTable.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => KnowledgeGroupTable.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id").references(() => KnowledgeSectionTable.id, {
      onDelete: "set null",
    }),
    content: text("content").notNull(),
    contextSummary: text("context_summary"),
    embedding: vector("embedding"),
    chunkIndex: integer("chunk_index").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    metadata: json("metadata").$type<{
      section?: string;
      sectionTitle?: string;
      headings?: string[];
      headingPath?: string;
      chunkType?:
        | "code"
        | "directive"
        | "api"
        | "narrative"
        | "table"
        | "list"
        | "other";
      sourcePath?: string;
      libraryId?: string;
      libraryVersion?: string;
      pageNumber?: number;
      pageStart?: number;
      pageEnd?: number;
      extractionMode?: "raw" | "normalized" | "refined";
      qualityScore?: number;
      repairReason?: string;
      sheetName?: string;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("knowledge_chunk_group_id_idx").on(t.groupId),
    index("knowledge_chunk_document_id_idx").on(t.documentId),
    index("knowledge_chunk_section_id_idx").on(t.sectionId),
  ],
);

export const KnowledgeDocumentImageTable = pgTable(
  "knowledge_document_image",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => KnowledgeDocumentTable.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => KnowledgeGroupTable.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(
      () => KnowledgeDocumentVersionTable.id,
      {
        onDelete: "set null",
      },
    ),
    kind: varchar("kind", {
      enum: ["embedded", "region"],
    })
      .notNull()
      .default("embedded"),
    ordinal: integer("ordinal").notNull(),
    marker: text("marker").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull(),
    headingPath: text("heading_path"),
    stepHint: text("step_hint"),
    storagePath: text("storage_path"),
    sourceUrl: text("source_url"),
    mediaType: text("media_type"),
    pageNumber: integer("page_number"),
    width: integer("width"),
    height: integer("height"),
    altText: text("alt_text"),
    caption: text("caption"),
    surroundingText: text("surrounding_text"),
    precedingText: text("preceding_text"),
    followingText: text("following_text"),
    isRenderable: boolean("is_renderable").notNull().default(false),
    manualLabel: boolean("manual_label").notNull().default(false),
    manualDescription: boolean("manual_description").notNull().default(false),
    embedding: vector("embedding"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("knowledge_document_image_group_id_idx").on(t.groupId),
    index("knowledge_document_image_document_id_idx").on(t.documentId),
    index("knowledge_document_image_version_id_idx").on(t.versionId),
    index("knowledge_document_image_document_ordinal_idx").on(
      t.documentId,
      t.ordinal,
    ),
  ],
);

export const KnowledgeSectionVersionTable = pgTable(
  "knowledge_section_version",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => KnowledgeDocumentVersionTable.id, {
        onDelete: "cascade",
      }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => KnowledgeDocumentTable.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => KnowledgeGroupTable.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    parentSectionId: uuid("parent_section_id"),
    prevSectionId: uuid("prev_section_id"),
    nextSectionId: uuid("next_section_id"),
    heading: text("heading").notNull(),
    headingPath: text("heading_path").notNull(),
    level: integer("level").notNull().default(1),
    partIndex: integer("part_index").notNull().default(0),
    partCount: integer("part_count").notNull().default(1),
    content: text("content").notNull(),
    summary: text("summary").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    embedding: vector("embedding"),
    sourcePath: text("source_path"),
    libraryId: text("library_id"),
    libraryVersion: text("library_version"),
    includeHeadingInChunkContent: boolean("include_heading_in_chunk_content")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("knowledge_section_version_version_id_idx").on(t.versionId),
    index("knowledge_section_version_document_id_idx").on(t.documentId),
  ],
);

export const KnowledgeChunkVersionTable = pgTable(
  "knowledge_chunk_version",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => KnowledgeDocumentVersionTable.id, {
        onDelete: "cascade",
      }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => KnowledgeDocumentTable.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => KnowledgeGroupTable.id, { onDelete: "cascade" }),
    sectionVersionId: uuid("section_version_id").references(
      () => KnowledgeSectionVersionTable.id,
      {
        onDelete: "set null",
      },
    ),
    content: text("content").notNull(),
    contextSummary: text("context_summary"),
    embedding: vector("embedding"),
    chunkIndex: integer("chunk_index").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    metadata: json("metadata").$type<{
      section?: string;
      sectionTitle?: string;
      headings?: string[];
      headingPath?: string;
      chunkType?:
        | "code"
        | "directive"
        | "api"
        | "narrative"
        | "table"
        | "list"
        | "other";
      sourcePath?: string;
      libraryId?: string;
      libraryVersion?: string;
      pageNumber?: number;
      pageStart?: number;
      pageEnd?: number;
      extractionMode?: "raw" | "normalized" | "refined";
      qualityScore?: number;
      repairReason?: string;
      sheetName?: string;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("knowledge_chunk_version_version_id_idx").on(t.versionId),
    index("knowledge_chunk_version_document_id_idx").on(t.documentId),
    index("knowledge_chunk_version_section_version_id_idx").on(
      t.sectionVersionId,
    ),
  ],
);

export const KnowledgeDocumentImageVersionTable = pgTable(
  "knowledge_document_image_version",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => KnowledgeDocumentVersionTable.id, {
        onDelete: "cascade",
      }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => KnowledgeDocumentTable.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => KnowledgeGroupTable.id, { onDelete: "cascade" }),
    kind: varchar("kind", {
      enum: ["embedded", "region"],
    })
      .notNull()
      .default("embedded"),
    ordinal: integer("ordinal").notNull(),
    marker: text("marker").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull(),
    headingPath: text("heading_path"),
    stepHint: text("step_hint"),
    storagePath: text("storage_path"),
    sourceUrl: text("source_url"),
    mediaType: text("media_type"),
    pageNumber: integer("page_number"),
    width: integer("width"),
    height: integer("height"),
    altText: text("alt_text"),
    caption: text("caption"),
    surroundingText: text("surrounding_text"),
    precedingText: text("preceding_text"),
    followingText: text("following_text"),
    isRenderable: boolean("is_renderable").notNull().default(false),
    manualLabel: boolean("manual_label").notNull().default(false),
    manualDescription: boolean("manual_description").notNull().default(false),
    embedding: vector("embedding"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("knowledge_document_image_version_version_id_idx").on(t.versionId),
    index("knowledge_document_image_version_document_id_idx").on(t.documentId),
    index("knowledge_document_image_version_document_ordinal_idx").on(
      t.documentId,
      t.ordinal,
    ),
  ],
);

export const KnowledgeDocumentHistoryEventTable = pgTable(
  "knowledge_document_history_event",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => KnowledgeDocumentTable.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => KnowledgeGroupTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => UserTable.id, {
      onDelete: "set null",
    }),
    eventType: varchar("event_type", {
      enum: [
        "created",
        "edited",
        "rollback",
        "failed",
        "bootstrap",
        "reingest",
      ],
    }).notNull(),
    fromVersionId: uuid("from_version_id"),
    toVersionId: uuid("to_version_id"),
    details: json("details"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("knowledge_document_history_event_document_id_idx").on(t.documentId),
    index("knowledge_document_history_event_group_id_idx").on(t.groupId),
  ],
);

export const KnowledgeGroupAgentTable = pgTable(
  "knowledge_group_agent",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => AgentTable.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => KnowledgeGroupTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [unique().on(t.agentId, t.groupId)],
);

export const SkillTable = pgTable("skill", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  instructions: text("instructions").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  visibility: varchar("visibility", {
    enum: ["public", "private", "readonly"],
  })
    .notNull()
    .default("private"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const SkillGroupTable = pgTable("skill_group", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  userId: uuid("user_id")
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  visibility: varchar("visibility", {
    enum: ["public", "private", "readonly"],
  })
    .notNull()
    .default("private"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const SkillGroupSkillTable = pgTable(
  "skill_group_skill",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => SkillGroupTable.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => SkillTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    unique().on(t.groupId, t.skillId),
    index("skill_group_skill_group_id_idx").on(t.groupId),
    index("skill_group_skill_skill_id_idx").on(t.skillId),
  ],
);

export const SkillAgentTable = pgTable(
  "skill_agent",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => AgentTable.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => SkillTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    unique().on(t.agentId, t.skillId),
    index("skill_agent_agent_id_idx").on(t.agentId),
    index("skill_agent_skill_id_idx").on(t.skillId),
  ],
);

export const SkillGroupAgentTable = pgTable(
  "skill_group_agent",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => AgentTable.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => SkillGroupTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    unique().on(t.agentId, t.groupId),
    index("skill_group_agent_agent_id_idx").on(t.agentId),
    index("skill_group_agent_group_id_idx").on(t.groupId),
  ],
);

export const KnowledgeUsageLogTable = pgTable(
  "knowledge_usage_log",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => KnowledgeGroupTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => UserTable.id, {
      onDelete: "set null",
    }),
    query: text("query").notNull(),
    source: varchar("source", { enum: ["chat", "agent", "mcp"] })
      .notNull()
      .default("chat"),
    chunksRetrieved: integer("chunks_retrieved").notNull().default(0),
    latencyMs: integer("latency_ms"),
    metadata: json("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("knowledge_usage_log_group_id_idx").on(t.groupId),
    index("knowledge_usage_log_created_at_idx").on(t.createdAt),
  ],
);

export const SelfLearningUserConfigTable = pgTable(
  "self_learning_user_config",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    personalizationEnabled: boolean("personalization_enabled")
      .notNull()
      .default(true),
    hiddenKnowledgeGroupId: uuid("hidden_knowledge_group_id").references(
      () => KnowledgeGroupTable.id,
      { onDelete: "set null" },
    ),
    hiddenKnowledgeDocumentId: uuid("hidden_knowledge_document_id").references(
      () => KnowledgeDocumentTable.id,
      { onDelete: "set null" },
    ),
    lastManualRunAt: timestamp("last_manual_run_at", { withTimezone: true }),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
    lastResetAt: timestamp("last_reset_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique().on(table.userId),
    index("self_learning_user_config_user_id_idx").on(table.userId),
  ],
);

export const SelfLearningSignalEventTable = pgTable(
  "self_learning_signal_event",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").references(() => ChatThreadTable.id, {
      onDelete: "cascade",
    }),
    messageId: text("message_id").references(() => ChatMessageTable.id, {
      onDelete: "cascade",
    }),
    signalType: varchar("signal_type", {
      enum: [
        "feedback_like",
        "feedback_dislike",
        "regenerate_response",
        "branch_from_response",
        "delete_response",
        "follow_up_continue",
      ],
    })
      .notNull()
      .$type<SelfLearningSignalType>(),
    value: real("value").notNull().default(0),
    payload: json("payload").$type<SelfLearningSignalPayload>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("self_learning_signal_event_user_id_idx").on(table.userId),
    index("self_learning_signal_event_message_id_idx").on(table.messageId),
    index("self_learning_signal_event_created_at_idx").on(table.createdAt),
  ],
);

export const SelfLearningRunTable = pgTable(
  "self_learning_run",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    trigger: varchar("trigger", { enum: ["daily", "manual", "rebuild"] })
      .notNull()
      .$type<SelfLearningRunTrigger>(),
    status: varchar("status", {
      enum: ["queued", "running", "completed", "failed"],
    })
      .notNull()
      .default("queued")
      .$type<SelfLearningRunStatus>(),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    totalCandidates: integer("total_candidates").notNull().default(0),
    processedCandidates: integer("processed_candidates").notNull().default(0),
    appliedMemoryCount: integer("applied_memory_count").notNull().default(0),
    skippedMemoryCount: integer("skipped_memory_count").notNull().default(0),
    errorMessage: text("error_message"),
    metadata: json("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("self_learning_run_user_id_idx").on(table.userId),
    index("self_learning_run_status_idx").on(table.status),
    index("self_learning_run_created_at_idx").on(table.createdAt),
  ],
);

export const SelfLearningMemoryTable = pgTable(
  "self_learning_memory",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    category: varchar("category", {
      enum: [
        "preference",
        "style",
        "format",
        "avoidance",
        "workflow",
        "factual",
        "policy",
      ],
    })
      .notNull()
      .$type<SelfLearningMemoryCategory>(),
    status: varchar("status", {
      enum: ["active", "inactive", "superseded", "deleted"],
    })
      .notNull()
      .default("inactive")
      .$type<SelfLearningMemoryStatus>(),
    isAutoSafe: boolean("is_auto_safe").notNull().default(false),
    fingerprint: text("fingerprint").notNull(),
    contradictionFingerprint: text("contradiction_fingerprint"),
    title: text("title").notNull(),
    content: text("content").notNull(),
    supportCount: integer("support_count").notNull().default(0),
    distinctThreadCount: integer("distinct_thread_count").notNull().default(0),
    sourceEvaluationId: uuid("source_evaluation_id"),
    supersededByMemoryId: uuid("superseded_by_memory_id"),
    lastAppliedAt: timestamp("last_applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique().on(table.userId, table.fingerprint),
    index("self_learning_memory_user_id_idx").on(table.userId),
    index("self_learning_memory_status_idx").on(table.status),
  ],
);

export const SelfLearningEvaluationTable = pgTable(
  "self_learning_evaluation",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => SelfLearningRunTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").references(() => ChatThreadTable.id, {
      onDelete: "set null",
    }),
    messageId: text("message_id").references(() => ChatMessageTable.id, {
      onDelete: "set null",
    }),
    signalEventId: uuid("signal_event_id").references(
      () => SelfLearningSignalEventTable.id,
      { onDelete: "set null" },
    ),
    status: varchar("status", {
      enum: ["proposed", "applied", "skipped", "rejected"],
    })
      .notNull()
      .default("proposed")
      .$type<SelfLearningEvaluationStatus>(),
    explicitScore: real("explicit_score").notNull().default(0),
    implicitScore: real("implicit_score").notNull().default(0),
    llmScore: real("llm_score").notNull().default(0),
    compositeScore: real("composite_score").notNull().default(0),
    confidence: real("confidence").notNull().default(0),
    category: varchar("category", {
      enum: [
        "preference",
        "style",
        "format",
        "avoidance",
        "workflow",
        "factual",
        "policy",
      ],
    }).$type<SelfLearningMemoryCategory>(),
    candidateFingerprint: text("candidate_fingerprint"),
    candidateTitle: text("candidate_title"),
    candidateContent: text("candidate_content"),
    judgeOutput: json("judge_output").$type<SelfLearningJudgeOutput>(),
    metrics: json("metrics"),
    appliedMemoryId: uuid("applied_memory_id").references(
      () => SelfLearningMemoryTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("self_learning_evaluation_run_id_idx").on(table.runId),
    index("self_learning_evaluation_user_id_idx").on(table.userId),
    index("self_learning_evaluation_status_idx").on(table.status),
    index("self_learning_evaluation_message_id_idx").on(table.messageId),
  ],
);

export const SelfLearningAuditLogTable = pgTable(
  "self_learning_audit_log",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => UserTable.id, {
      onDelete: "set null",
    }),
    runId: uuid("run_id").references(() => SelfLearningRunTable.id, {
      onDelete: "set null",
    }),
    evaluationId: uuid("evaluation_id").references(
      () => SelfLearningEvaluationTable.id,
      { onDelete: "set null" },
    ),
    memoryId: uuid("memory_id").references(() => SelfLearningMemoryTable.id, {
      onDelete: "set null",
    }),
    action: varchar("action", {
      enum: [
        "signal_recorded",
        "manual_run_requested",
        "run_completed",
        "run_failed",
        "memory_applied",
        "memory_skipped",
        "memory_superseded",
        "personalization_reset",
        "learning_deleted",
        "user_toggle_updated",
        "system_toggle_updated",
      ],
    })
      .notNull()
      .$type<SelfLearningAuditAction>(),
    details: json("details"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("self_learning_audit_log_user_id_idx").on(table.userId),
    index("self_learning_audit_log_created_at_idx").on(table.createdAt),
  ],
);

export const AgentExternalChatSessionTable = pgTable(
  "agent_external_chat_session",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => AgentTable.id, { onDelete: "cascade" }),
    clientFingerprint: text("client_fingerprint").notNull(),
    firstUserMessageHash: text("first_user_message_hash").notNull(),
    firstUserPreview: text("first_user_preview").notNull(),
    lastTranscriptMessageHash: text("last_transcript_message_hash").notNull(),
    lastMessageCount: integer("last_message_count").notNull().default(0),
    summaryPreview: text("summary_preview"),
    turnCount: integer("turn_count").notNull().default(0),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    lastModelProvider: text("last_model_provider"),
    lastModelName: text("last_model_name"),
    lastStatus: text("last_status").notNull().default("success"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("agent_external_chat_session_agent_id_idx").on(table.agentId),
    index("agent_external_chat_session_updated_at_idx").on(table.updatedAt),
  ],
);

export const AgentExternalUsageLogTable = pgTable(
  "agent_external_usage_log",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => AgentTable.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(
      () => AgentExternalChatSessionTable.id,
      {
        onDelete: "set null",
      },
    ),
    transport: text("transport")
      .$type<"continue_chat" | "continue_autocomplete">()
      .notNull(),
    kind: text("kind").$type<"chat_turn" | "autocomplete_request">().notNull(),
    modelProvider: text("model_provider"),
    modelName: text("model_name"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    finishReason: text("finish_reason"),
    status: text("status")
      .$type<"success" | "error" | "cancelled">()
      .notNull()
      .default("success"),
    requestPreview: text("request_preview"),
    responsePreview: text("response_preview"),
    requestMessages: json("request_messages"),
    responseMessage: json("response_message"),
    requestMessageCount: integer("request_message_count"),
    clientFingerprint: text("client_fingerprint"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("agent_external_usage_log_agent_id_idx").on(table.agentId),
    index("agent_external_usage_log_session_id_idx").on(table.sessionId),
    index("agent_external_usage_log_created_at_idx").on(table.createdAt),
  ],
);

export type KnowledgeGroupEntity = typeof KnowledgeGroupTable.$inferSelect;
export type KnowledgeGroupSourceEntity =
  typeof KnowledgeGroupSourceTable.$inferSelect;
export type KnowledgeDocumentEntity =
  typeof KnowledgeDocumentTable.$inferSelect;
export type KnowledgeSectionEntity = typeof KnowledgeSectionTable.$inferSelect;
export type KnowledgeChunkEntity = typeof KnowledgeChunkTable.$inferSelect;
export type KnowledgeGroupAgentEntity =
  typeof KnowledgeGroupAgentTable.$inferSelect;
export type SkillEntity = typeof SkillTable.$inferSelect;
export type SkillGroupEntity = typeof SkillGroupTable.$inferSelect;
export type SkillGroupSkillEntity = typeof SkillGroupSkillTable.$inferSelect;
export type SkillAgentEntity = typeof SkillAgentTable.$inferSelect;
export type SkillGroupAgentEntity = typeof SkillGroupAgentTable.$inferSelect;
export type KnowledgeUsageLogEntity =
  typeof KnowledgeUsageLogTable.$inferSelect;
export type SelfLearningUserConfigEntity =
  typeof SelfLearningUserConfigTable.$inferSelect;
export type SelfLearningSignalEventEntity =
  typeof SelfLearningSignalEventTable.$inferSelect;
export type SelfLearningRunEntity = typeof SelfLearningRunTable.$inferSelect;
export type SelfLearningEvaluationEntity =
  typeof SelfLearningEvaluationTable.$inferSelect;
export type SelfLearningMemoryEntity =
  typeof SelfLearningMemoryTable.$inferSelect;
export type SelfLearningAuditLogEntity =
  typeof SelfLearningAuditLogTable.$inferSelect;
export type AgentExternalChatSessionEntity =
  typeof AgentExternalChatSessionTable.$inferSelect;
export type AgentExternalUsageLogEntity =
  typeof AgentExternalUsageLogTable.$inferSelect;
