import { z } from "zod";

export type KnowledgeGroupIcon = {
  value?: string;
  style?: { backgroundColor?: string };
};

export type KnowledgeVisibility = "public" | "private" | "readonly";
export type KnowledgePurpose = "default" | "personalization";
export type KnowledgeParseMode = "off" | "auto" | "always";
export type KnowledgeParseRepairPolicy =
  | "strict"
  | "section-safe-reorder"
  | "aggressive";
export type KnowledgeContextMode = "deterministic" | "auto-llm" | "always-llm";
export type KnowledgeImageMode = "off" | "auto" | "always";
export type KnowledgeDocumentVersionStatus = "processing" | "ready" | "failed";
export type KnowledgeDocumentVersionChangeType =
  | "initial_ingest"
  | "edit"
  | "rollback"
  | "reingest";
export type KnowledgeDocumentImageKind = "embedded" | "region";
export type KnowledgeDocumentHistoryEventType =
  | "created"
  | "edited"
  | "rollback"
  | "failed"
  | "bootstrap"
  | "reingest";
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
export type KnowledgeDocumentProcessingStage =
  | "extracting"
  | "parsing"
  | "materializing"
  | "embedding"
  | "finalizing";

export interface KnowledgeDocumentProcessingState {
  stage: KnowledgeDocumentProcessingStage;
  currentPage?: number | null;
  totalPages?: number | null;
  pageNumber?: number | null;
}

export type KnowledgeChunkMetadata = {
  section?: string;
  sectionTitle?: string;
  headings?: string[];
  headingPath?: string;
  canonicalTitle?: string;
  issuerName?: string;
  issuerTicker?: string;
  reportType?: string;
  fiscalYear?: number;
  periodEnd?: string;
  noteNumber?: string;
  noteTitle?: string;
  noteSubsection?: string;
  continued?: boolean;
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
  hasStructuredContent?: boolean;
  pageNumber?: number;
  pageStart?: number;
  pageEnd?: number;
  extractionMode?: "raw" | "normalized" | "refined";
  qualityScore?: number;
  repairReason?: string;
  sheetName?: string;
  sourceGroupId?: string;
  sourceGroupName?: string;
};

export interface KnowledgeGroup {
  id: string;
  name: string;
  description?: string;
  icon?: KnowledgeGroupIcon;
  userId: string;
  visibility: KnowledgeVisibility;
  purpose: KnowledgePurpose;
  isSystemManaged: boolean;
  embeddingModel: string;
  embeddingProvider: string;
  rerankingModel?: string | null;
  rerankingProvider?: string | null;
  parsingModel?: string | null;
  parsingProvider?: string | null;
  parseMode: KnowledgeParseMode;
  parseRepairPolicy: KnowledgeParseRepairPolicy;
  contextMode: KnowledgeContextMode;
  imageMode: KnowledgeImageMode;
  lazyRefinementEnabled: boolean;
  retrievalThreshold: number;
  mcpEnabled: boolean;
  mcpApiKeyHash?: string | null;
  mcpApiKeyPreview?: string | null;
  chunkSize: number;
  chunkOverlapPercent: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeGroupSource {
  groupId: string;
  sourceGroupId: string;
  sourceGroupName: string;
  sourceGroupDescription?: string;
  sourceGroupVisibility: KnowledgeVisibility;
  sourceGroupUserId: string;
  sourceGroupUserName?: string;
  createdAt: Date;
}

export interface KnowledgeSummary {
  id: string;
  name: string;
  description?: string;
  icon?: KnowledgeGroupIcon;
  userId: string;
  visibility: KnowledgeVisibility;
  purpose: KnowledgePurpose;
  isSystemManaged: boolean;
  embeddingModel: string;
  embeddingProvider: string;
  rerankingModel?: string | null;
  rerankingProvider?: string | null;
  parsingModel?: string | null;
  parsingProvider?: string | null;
  parseMode: KnowledgeParseMode;
  parseRepairPolicy: KnowledgeParseRepairPolicy;
  contextMode: KnowledgeContextMode;
  imageMode: KnowledgeImageMode;
  lazyRefinementEnabled: boolean;
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
  description?: string | null;
  descriptionManual?: boolean;
  titleManual?: boolean;
  originalFilename: string;
  fileType: DocumentFileType;
  fileSize?: number | null;
  storagePath?: string | null;
  sourceUrl?: string | null;
  fingerprint?: string | null;
  status: DocumentStatus;
  /** Ingestion progress percentage 0–100. Null when not processing. */
  processingProgress?: number | null;
  processingState?: KnowledgeDocumentProcessingState | null;
  errorMessage?: string | null;
  chunkCount: number;
  tokenCount: number;
  embeddingTokenCount: number;
  metadata?: Record<string, unknown> | null;
  /** Full markdown content of the processed document */
  markdownContent?: string | null;
  activeVersionId?: string | null;
  latestVersionNumber?: number;
  /** True when this doc is inherited from a linked source group */
  isInherited?: boolean;
  /** Source group metadata (set only for inherited docs) */
  sourceGroupId?: string | null;
  sourceGroupName?: string | null;
  sourceGroupVisibility?: KnowledgeVisibility | null;
  sourceGroupUserName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeSection {
  id: string;
  documentId: string;
  groupId: string;
  parentSectionId?: string | null;
  prevSectionId?: string | null;
  nextSectionId?: string | null;
  heading: string;
  headingPath: string;
  level: number;
  partIndex: number;
  partCount: number;
  content: string;
  summary: string;
  tokenCount: number;
  pageStart?: number | null;
  pageEnd?: number | null;
  noteNumber?: string | null;
  noteTitle?: string | null;
  noteSubsection?: string | null;
  continued?: boolean | null;
  embedding?: number[] | null;
  createdAt: Date;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  groupId: string;
  sectionId?: string | null;
  content: string;
  contextSummary?: string | null;
  chunkIndex: number;
  tokenCount: number;
  metadata?: KnowledgeChunkMetadata | null;
  createdAt: Date;
}

export interface KnowledgeChunkSnapshot extends KnowledgeChunk {
  embedding?: number[] | null;
}

export interface KnowledgeDocumentImage {
  id: string;
  documentId: string;
  groupId: string;
  versionId?: string | null;
  kind: KnowledgeDocumentImageKind;
  ordinal: number;
  marker: string;
  label: string;
  description: string;
  headingPath?: string | null;
  stepHint?: string | null;
  sourceUrl?: string | null;
  storagePath?: string | null;
  mediaType?: string | null;
  pageNumber?: number | null;
  width?: number | null;
  height?: number | null;
  altText?: string | null;
  caption?: string | null;
  surroundingText?: string | null;
  precedingText?: string | null;
  followingText?: string | null;
  isRenderable: boolean;
  manualLabel: boolean;
  manualDescription: boolean;
  embedding?: number[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeDocumentImageVersion extends KnowledgeDocumentImage {
  versionId: string;
}

export interface KnowledgeDocumentImagePreview extends KnowledgeDocumentImage {
  assetUrl: string | null;
}

export interface KnowledgeDocumentVersion {
  id: string;
  documentId: string;
  groupId: string;
  userId: string;
  versionNumber: number;
  status: KnowledgeDocumentVersionStatus;
  changeType: KnowledgeDocumentVersionChangeType;
  markdownContent?: string | null;
  resolvedTitle: string;
  resolvedDescription?: string | null;
  metadata?: Record<string, unknown> | null;
  metadataEmbedding?: number[] | null;
  embeddingProvider: string;
  embeddingModel: string;
  chunkCount: number;
  tokenCount: number;
  embeddingTokenCount: number;
  sourceVersionId?: string | null;
  createdByUserId?: string | null;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeDocumentVersionSummary {
  id: string;
  versionNumber: number;
  status: KnowledgeDocumentVersionStatus;
  changeType: KnowledgeDocumentVersionChangeType;
  isActive: boolean;
  resolvedTitle: string;
  resolvedDescription?: string | null;
  embeddingProvider: string;
  embeddingModel: string;
  chunkCount: number;
  tokenCount: number;
  embeddingTokenCount: number;
  sourceVersionId?: string | null;
  createdByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  canRollback: boolean;
  rollbackBlockedReason?: string | null;
}

export interface KnowledgeDocumentVersionContent {
  versionId: string;
  markdownContent: string | null;
}

export interface KnowledgeDocumentHistoryEvent {
  id: string;
  documentId: string;
  groupId: string;
  userId: string;
  actorUserId?: string | null;
  actorUserName?: string | null;
  eventType: KnowledgeDocumentHistoryEventType;
  fromVersionId?: string | null;
  fromVersionNumber?: number | null;
  toVersionId?: string | null;
  toVersionNumber?: number | null;
  details?: Record<string, unknown> | null;
  createdAt: Date;
}

export interface KnowledgeDocumentPreview {
  doc: {
    id: string;
    name: string;
    description?: string | null;
    descriptionManual?: boolean;
    titleManual?: boolean;
    isInherited?: boolean;
    sourceGroupId?: string | null;
    sourceGroupName?: string | null;
    sourceGroupVisibility?: KnowledgeVisibility | null;
    sourceGroupUserName?: string | null;
    originalFilename: string;
    fileType: string;
    fileSize?: number | null;
    mimeType: string;
    activeVersionId?: string | null;
    latestVersionNumber?: number;
    embeddingTokenCount?: number;
    processingState?: KnowledgeDocumentProcessingState | null;
  };
  assetUrl: string | null;
  previewUrl: string | null;
  sourceUrl: string | null;
  content: string | null;
  markdownAvailable: boolean;
  isUrlOnly: boolean;
  requestedVersionId?: string | null;
  resolvedVersionId?: string | null;
  binaryMatchesRequestedVersion?: boolean;
  fallbackWarning?: string | null;
  activeVersionId: string | null;
  activeVersionNumber: number | null;
  versions: KnowledgeDocumentVersionSummary[];
  images: KnowledgeDocumentImagePreview[];
}

export interface KnowledgeQueryResult {
  chunk: KnowledgeChunk;
  documentName: string;
  documentId: string;
  score: number;
  confidenceScore?: number;
  semanticScore?: number;
  lexicalScore?: number;
  docSignal?: number;
  rerankScore?: number;
  neighborContext?: {
    previous?: string;
    next?: string;
  };
}

export interface KnowledgeUsageStats {
  totalQueries: number;
  uniqueUsers: number;
  mcpQueries: number;
  avgLatencyMs: number;
  storedEmbeddingTokens: number;
  processedEmbeddingTokens: number;
  recentEmbeddingTokens: number;
  documentEmbeddingUsage: Array<{
    documentId: string;
    name: string;
    embeddingTokenCount: number;
    latestVersionNumber?: number | null;
    updatedAt: Date;
  }>;
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

export interface PaginatedKnowledgeDocuments {
  items: KnowledgeDocument[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
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
  chunkSize: z.number().int().min(128).max(2048).default(768),
  chunkOverlapPercent: z.number().int().min(0).max(50).default(10),
  sourceGroupIds: z.array(z.string().uuid()).max(50).optional(),
});

export const updateKnowledgeGroupSchema = createKnowledgeGroupSchema.partial();

export type CreateKnowledgeGroupInput = z.input<
  typeof createKnowledgeGroupSchema
>;
export type UpdateKnowledgeGroupInput = z.input<
  typeof updateKnowledgeGroupSchema
>;

// ─── Repository Interface ─────────────────────────────────────────────────────

export interface KnowledgeRepository {
  // Groups
  insertGroup(
    data: CreateKnowledgeGroupInput & {
      userId: string;
      purpose?: KnowledgePurpose;
      isSystemManaged?: boolean;
    },
  ): Promise<KnowledgeGroup>;
  selectGroupById(id: string, userId: string): Promise<KnowledgeGroup | null>;
  selectGroupByIdForMcp(id: string): Promise<KnowledgeGroup | null>;
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
  setGroupSources(
    groupId: string,
    userId: string,
    sourceGroupIds: string[],
  ): Promise<void>;
  selectGroupSources(groupId: string): Promise<KnowledgeGroupSource[]>;
  selectRetrievalScopes(groupId: string): Promise<KnowledgeGroup[]>;
  pruneInvalidGroupSources(groupId: string): Promise<void>;
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
      | "embeddingTokenCount"
      | "status"
      | "errorMessage"
    > & { status?: DocumentStatus },
  ): Promise<KnowledgeDocument>;
  selectDocumentsByGroupId(groupId: string): Promise<KnowledgeDocument[]>;
  selectDocumentsByGroupScope(groupId: string): Promise<KnowledgeDocument[]>;
  selectDocumentsPageByGroupScope(
    groupId: string,
    input: { limit: number; offset: number },
  ): Promise<PaginatedKnowledgeDocuments>;
  selectDocumentById(id: string): Promise<KnowledgeDocument | null>;
  selectDocumentByFingerprint(
    groupId: string,
    fingerprint: string,
  ): Promise<KnowledgeDocument | null>;
  selectUrlDocumentBySourceUrl(
    groupId: string,
    sourceUrl: string,
  ): Promise<KnowledgeDocument | null>;
  selectFileDocumentByNameAndSize(input: {
    groupId: string;
    originalFilename: string;
    fileType: DocumentFileType;
    fileSize: number;
  }): Promise<KnowledgeDocument | null>;
  updateDocumentStatus(
    id: string,
    status: DocumentStatus,
    extra?: {
      errorMessage?: string;
      chunkCount?: number;
      tokenCount?: number;
      embeddingTokenCount?: number;
      markdownContent?: string;
      processingProgress?: number | null;
      processingState?: KnowledgeDocumentProcessingState | null;
    },
  ): Promise<void>;
  updateDocumentProcessing(
    id: string,
    data: {
      status?: DocumentStatus;
      errorMessage?: string | null;
      processingProgress?: number | null;
      processingState?: KnowledgeDocumentProcessingState | null;
    },
  ): Promise<void>;
  updateDocumentMetadata(
    id: string,
    userId: string,
    data: {
      title?: string;
      description?: string | null;
      metadataEmbedding?: number[] | null;
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<KnowledgeDocument | null>;
  updateDocumentAutoMetadata(
    id: string,
    data: {
      title?: string;
      description?: string | null;
      metadataEmbedding?: number[] | null;
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<void>;
  deleteDocument(id: string): Promise<void>;
  getDocumentImages(documentId: string): Promise<KnowledgeDocumentImage[]>;
  getDocumentImagesByVersion(
    documentId: string,
    versionId: string,
  ): Promise<KnowledgeDocumentImageVersion[]>;
  getDocumentImageById(
    documentId: string,
    imageId: string,
  ): Promise<KnowledgeDocumentImage | null>;
  getDocumentImageByIdFromVersion(
    documentId: string,
    versionId: string,
    imageId: string,
  ): Promise<KnowledgeDocumentImageVersion | null>;
  listDocumentImageStoragePaths(documentId: string): Promise<string[]>;

  // Document markdown (Context7-style full-doc retrieval)
  getDocumentMarkdown(documentId: string): Promise<{
    name: string;
    description?: string | null;
    markdown: string;
  } | null>;
  getGroupDocumentsMarkdown(
    groupId: string,
    topic?: string,
  ): Promise<Array<{ documentId: string; name: string; markdown: string }>>;
  getDocumentMetadataByIds(
    groupId: string,
    ids: string[],
  ): Promise<
    Array<{
      documentId: string;
      name: string;
      description?: string | null;
      updatedAt: Date;
    }>
  >;
  getDocumentMetadataByIdsAcrossGroups(ids: string[]): Promise<
    Array<{
      documentId: string;
      groupId: string;
      name: string;
      description?: string | null;
      metadata?: Record<string, unknown> | null;
      activeVersionId?: string | null;
      updatedAt: Date;
    }>
  >;
  findDocumentIdsByRetrievalIdentity(
    groupId: string,
    input: {
      issuer?: string | null;
      ticker?: string | null;
      limit?: number;
    },
  ): Promise<Array<{ documentId: string; score: number }>>;
  searchDocumentMetadata(
    groupId: string,
    query: string,
    limit: number,
    documentIds?: string[],
  ): Promise<Array<{ documentId: string; score: number }>>;
  vectorSearchDocumentMetadata(
    groupId: string,
    embedding: number[],
    limit: number,
    documentIds?: string[],
  ): Promise<Array<{ documentId: string; score: number }>>;

  // Sections
  insertSections(
    sections: Array<Omit<KnowledgeSection, "createdAt">>,
  ): Promise<void>;
  deleteSectionsByDocumentId(documentId: string): Promise<void>;
  getSectionsByIds(ids: string[]): Promise<KnowledgeSection[]>;
  getRelatedSections(sectionIds: string[]): Promise<KnowledgeSection[]>;
  findSectionsByStructuredFilters(input: {
    groupId: string;
    documentIds?: string[];
    page?: number | null;
    noteNumber?: string | null;
    noteSubsection?: string | null;
    limit?: number;
  }): Promise<
    Array<{
      section: KnowledgeSection;
      documentId: string;
      documentName: string;
    }>
  >;

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
    filters?: {
      documentIds?: string[];
      sectionIds?: string[];
    },
  ): Promise<Array<KnowledgeQueryResult>>;
  fullTextSearch(
    groupId: string,
    query: string,
    limit: number,
    filters?: {
      documentIds?: string[];
      sectionIds?: string[];
    },
  ): Promise<Array<KnowledgeQueryResult>>;
  fullTextSearchSections(
    groupId: string,
    query: string,
    limit: number,
    documentIds?: string[],
  ): Promise<
    Array<{
      section: KnowledgeSection;
      documentId: string;
      documentName: string;
      score: number;
    }>
  >;
  vectorSearchSections(
    groupId: string,
    embedding: number[],
    limit: number,
    documentIds?: string[],
  ): Promise<
    Array<{
      section: KnowledgeSection;
      documentId: string;
      documentName: string;
      score: number;
    }>
  >;
  fullTextSearchImages(
    groupId: string,
    query: string,
    limit: number,
    documentIds?: string[],
  ): Promise<Array<KnowledgeDocumentImage & { score: number }>>;
  vectorSearchImages(
    groupId: string,
    embedding: number[],
    limit: number,
    documentIds?: string[],
  ): Promise<Array<KnowledgeDocumentImage & { score: number }>>;

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
    metadata?: Record<string, unknown> | null;
  }): Promise<void>;
  getUsageStats(groupId: string, days?: number): Promise<KnowledgeUsageStats>;
}
