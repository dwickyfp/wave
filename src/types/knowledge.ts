import { z } from "zod";

export type KnowledgeGroupIcon = {
  value?: string;
  style?: { backgroundColor?: string };
};

export type KnowledgeVisibility = "public" | "private" | "readonly";
export type DocumentFileType =
  | "pdf"
  | "docx"
  | "xlsx"
  | "csv"
  | "txt"
  | "md"
  | "url"
  | "html";
export type DocumentStatus = "pending" | "processing" | "ready" | "failed";
export type UsageSource = "chat" | "agent" | "mcp";

export interface KnowledgeGroup {
  id: string;
  name: string;
  description?: string;
  icon?: KnowledgeGroupIcon;
  userId: string;
  visibility: KnowledgeVisibility;
  embeddingModel: string;
  embeddingProvider: string;
  rerankingModel?: string | null;
  rerankingProvider?: string | null;
  parsingModel?: string | null;
  parsingProvider?: string | null;
  retrievalThreshold: number;
  mcpEnabled: boolean;
  mcpApiKeyHash?: string | null;
  mcpApiKeyPreview?: string | null;
  chunkSize: number;
  chunkOverlapPercent: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeSummary {
  id: string;
  name: string;
  description?: string;
  icon?: KnowledgeGroupIcon;
  userId: string;
  visibility: KnowledgeVisibility;
  embeddingModel: string;
  embeddingProvider: string;
  rerankingModel?: string | null;
  rerankingProvider?: string | null;
  parsingModel?: string | null;
  parsingProvider?: string | null;
  retrievalThreshold: number;
  mcpEnabled: boolean;
  documentCount: number;
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
  userName?: string;
  userAvatar?: string | null;
}

export interface KnowledgeDocument {
  id: string;
  groupId: string;
  userId: string;
  name: string;
  originalFilename: string;
  fileType: DocumentFileType;
  fileSize?: number | null;
  storagePath?: string | null;
  sourceUrl?: string | null;
  status: DocumentStatus;
  errorMessage?: string | null;
  chunkCount: number;
  tokenCount: number;
  metadata?: Record<string, unknown> | null;
  /** Full markdown content of the processed document */
  markdownContent?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  groupId: string;
  content: string;
  contextSummary?: string | null;
  chunkIndex: number;
  tokenCount: number;
  metadata?: {
    section?: string;
    headings?: string[];
    headingPath?: string;
    hasStructuredContent?: boolean;
    pageNumber?: number;
    sheetName?: string;
  } | null;
  createdAt: Date;
}

export interface KnowledgeQueryResult {
  chunk: KnowledgeChunk;
  documentName: string;
  documentId: string;
  score: number;
  rerankScore?: number;
}

export interface KnowledgeUsageStats {
  totalQueries: number;
  uniqueUsers: number;
  mcpQueries: number;
  avgLatencyMs: number;
  recentQueries: Array<{
    id: string;
    query: string;
    source: UsageSource;
    chunksRetrieved: number;
    latencyMs?: number | null;
    userName?: string | null;
    createdAt: Date;
  }>;
  dailyStats: Array<{
    date: string;
    count: number;
  }>;
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

export const createKnowledgeGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z
    .object({
      value: z.string().optional(),
      style: z.object({ backgroundColor: z.string().optional() }).optional(),
    })
    .optional(),
  visibility: z.enum(["public", "private", "readonly"]).default("private"),
  embeddingModel: z.string().default("text-embedding-3-small"),
  embeddingProvider: z.string().default("openai"),
  rerankingModel: z.string().optional().nullable(),
  rerankingProvider: z.string().optional().nullable(),
  parsingModel: z.string().optional().nullable(),
  parsingProvider: z.string().optional().nullable(),
  retrievalThreshold: z.number().min(0).max(1).default(0.0),
  chunkSize: z.number().int().min(128).max(2048).default(512),
  chunkOverlapPercent: z.number().int().min(0).max(50).default(20),
});

export const updateKnowledgeGroupSchema = createKnowledgeGroupSchema.partial();

export type CreateKnowledgeGroupInput = z.infer<
  typeof createKnowledgeGroupSchema
>;
export type UpdateKnowledgeGroupInput = z.infer<
  typeof updateKnowledgeGroupSchema
>;

// ─── Repository Interface ─────────────────────────────────────────────────────

export interface KnowledgeRepository {
  // Groups
  insertGroup(
    data: CreateKnowledgeGroupInput & { userId: string },
  ): Promise<KnowledgeGroup>;
  selectGroupById(id: string, userId: string): Promise<KnowledgeGroup | null>;
  selectGroups(
    userId: string,
    filters?: ("mine" | "shared")[],
  ): Promise<KnowledgeSummary[]>;
  updateGroup(
    id: string,
    userId: string,
    data: UpdateKnowledgeGroupInput,
  ): Promise<KnowledgeGroup>;
  deleteGroup(id: string, userId: string): Promise<void>;
  setMcpApiKey(
    id: string,
    userId: string,
    keyHash: string,
    keyPreview: string,
  ): Promise<void>;
  setMcpEnabled(id: string, userId: string, enabled: boolean): Promise<void>;
  getGroupByMcpKey(
    groupId: string,
  ): Promise<Pick<
    KnowledgeGroup,
    "id" | "mcpApiKeyHash" | "mcpEnabled"
  > | null>;

  // Documents
  insertDocument(
    data: Omit<
      KnowledgeDocument,
      | "id"
      | "createdAt"
      | "updatedAt"
      | "chunkCount"
      | "tokenCount"
      | "status"
      | "errorMessage"
    > & { status?: DocumentStatus },
  ): Promise<KnowledgeDocument>;
  selectDocumentsByGroupId(groupId: string): Promise<KnowledgeDocument[]>;
  selectDocumentById(id: string): Promise<KnowledgeDocument | null>;
  updateDocumentStatus(
    id: string,
    status: DocumentStatus,
    extra?: {
      errorMessage?: string;
      chunkCount?: number;
      tokenCount?: number;
      markdownContent?: string;
    },
  ): Promise<void>;
  deleteDocument(id: string): Promise<void>;

  // Document markdown (Context7-style full-doc retrieval)
  getDocumentMarkdown(
    documentId: string,
  ): Promise<{ name: string; markdown: string } | null>;
  getGroupDocumentsMarkdown(
    groupId: string,
    topic?: string,
  ): Promise<Array<{ documentId: string; name: string; markdown: string }>>;

  // Chunks
  insertChunks(
    chunks: Array<
      Omit<KnowledgeChunk, "id" | "createdAt"> & { embedding?: number[] }
    >,
  ): Promise<void>;
  deleteChunksByDocumentId(documentId: string): Promise<void>;
  deleteChunksByGroupId(groupId: string): Promise<void>;

  // Hybrid search
  vectorSearch(
    groupId: string,
    embedding: number[],
    limit: number,
  ): Promise<Array<KnowledgeQueryResult>>;
  fullTextSearch(
    groupId: string,
    query: string,
    limit: number,
  ): Promise<Array<KnowledgeQueryResult>>;

  // Adjacent chunks (for neighbor expansion)
  getAdjacentChunks(
    groupId: string,
    requests: Array<{ documentId: string; chunkIndex: number }>,
  ): Promise<Array<KnowledgeQueryResult>>;

  // Agent links
  linkAgentToGroup(agentId: string, groupId: string): Promise<void>;
  unlinkAgentFromGroup(agentId: string, groupId: string): Promise<void>;
  getGroupsByAgentId(agentId: string): Promise<KnowledgeSummary[]>;
  getAgentsByGroupId(groupId: string): Promise<string[]>;

  // Usage
  insertUsageLog(data: {
    groupId: string;
    userId?: string | null;
    query: string;
    source: UsageSource;
    chunksRetrieved: number;
    latencyMs?: number;
  }): Promise<void>;
  getUsageStats(groupId: string, days?: number): Promise<KnowledgeUsageStats>;
}
