import type {
  KnowledgeChunkMetadata,
  KnowledgeDocument,
  KnowledgeDocumentImage,
  KnowledgeDocumentHistoryEvent,
  KnowledgeDocumentVersion,
  KnowledgeDocumentVersionSummary,
  KnowledgeGroup,
} from "app-types/knowledge";
import { desc, eq, sql } from "drizzle-orm";
import { knowledgeRepository } from "lib/db/repository";
import { pgDb as db } from "lib/db/pg/db.pg";
import {
  KnowledgeChunkTable,
  KnowledgeChunkVersionTable,
  KnowledgeDocumentHistoryEventTable,
  KnowledgeDocumentImageTable,
  KnowledgeDocumentImageVersionTable,
  KnowledgeDocumentTable,
  KnowledgeDocumentVersionTable,
  KnowledgeGroupTable,
  KnowledgeSectionTable,
  KnowledgeSectionVersionTable,
} from "lib/db/pg/schema.pg";
import { materializeDocumentMarkdown } from "lib/knowledge/materialize-markdown";
import { sanitizeImageStepHint } from "lib/knowledge/document-images";
import type { ProcessedDocumentImage } from "lib/knowledge/processor/types";
import { generateUUID } from "lib/utils";

const VERSION_BATCH_SIZE = 100;
const ROLLBACK_MODEL_MISMATCH_REASON =
  "This version uses a different embedding model than the current knowledge group.";

type DocumentVersionChangeType =
  | "initial_ingest"
  | "edit"
  | "rollback"
  | "reingest";
type HistoryEventType =
  | "created"
  | "edited"
  | "rollback"
  | "failed"
  | "bootstrap"
  | "reingest";

type SelectedDocumentRow = typeof KnowledgeDocumentTable.$inferSelect & {
  embeddingProvider: string;
  embeddingModel: string;
  chunkSize: number;
  chunkOverlapPercent: number;
};

type VersionSnapshotSection = {
  id: string;
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
  embedding?: number[] | null;
  sourcePath?: string | null;
  libraryId?: string | null;
  libraryVersion?: string | null;
  includeHeadingInChunkContent?: boolean;
};

type VersionSnapshotChunk = {
  id: string;
  sectionId?: string | null;
  content: string;
  contextSummary?: string | null;
  embedding?: number[] | null;
  chunkIndex: number;
  tokenCount: number;
  metadata?: KnowledgeChunkMetadata | null;
};

type VersionSnapshotImage = Omit<
  KnowledgeDocumentImage,
  "createdAt" | "updatedAt"
>;

type MaterializedCommitInput = {
  versionId: string;
  versionNumber: number;
  sourceVersionId?: string | null;
  expectedActiveVersionId?: string | null;
  eventType: HistoryEventType;
  actorUserId?: string | null;
  doc: KnowledgeDocument;
  group: KnowledgeGroup;
  markdown: string;
  resolvedTitle: string;
  resolvedDescription?: string | null;
  metadata?: Record<string, unknown> | null;
  metadataEmbedding?: number[] | null;
  sections: VersionSnapshotSection[];
  chunks: VersionSnapshotChunk[];
  images: VersionSnapshotImage[];
  totalTokens: number;
  embeddingTokenCount: number;
};

type VersionRowWithVector =
  typeof KnowledgeDocumentVersionTable.$inferSelect & {
    metadataEmbeddingText?: string | null;
  };

const documentVersionSelection = {
  id: KnowledgeDocumentVersionTable.id,
  documentId: KnowledgeDocumentVersionTable.documentId,
  groupId: KnowledgeDocumentVersionTable.groupId,
  userId: KnowledgeDocumentVersionTable.userId,
  versionNumber: KnowledgeDocumentVersionTable.versionNumber,
  status: KnowledgeDocumentVersionTable.status,
  changeType: KnowledgeDocumentVersionTable.changeType,
  markdownContent: KnowledgeDocumentVersionTable.markdownContent,
  resolvedTitle: KnowledgeDocumentVersionTable.resolvedTitle,
  resolvedDescription: KnowledgeDocumentVersionTable.resolvedDescription,
  metadata: KnowledgeDocumentVersionTable.metadata,
  metadataEmbeddingText: sql<
    string | null
  >`${KnowledgeDocumentVersionTable.metadataEmbedding}::text`,
  embeddingProvider: KnowledgeDocumentVersionTable.embeddingProvider,
  embeddingModel: KnowledgeDocumentVersionTable.embeddingModel,
  chunkCount: KnowledgeDocumentVersionTable.chunkCount,
  tokenCount: KnowledgeDocumentVersionTable.tokenCount,
  embeddingTokenCount: KnowledgeDocumentVersionTable.embeddingTokenCount,
  sourceVersionId: KnowledgeDocumentVersionTable.sourceVersionId,
  createdByUserId: KnowledgeDocumentVersionTable.createdByUserId,
  errorMessage: KnowledgeDocumentVersionTable.errorMessage,
  createdAt: KnowledgeDocumentVersionTable.createdAt,
  updatedAt: KnowledgeDocumentVersionTable.updatedAt,
};

const documentVersionSummarySelection = {
  id: KnowledgeDocumentVersionTable.id,
  versionNumber: KnowledgeDocumentVersionTable.versionNumber,
  status: KnowledgeDocumentVersionTable.status,
  changeType: KnowledgeDocumentVersionTable.changeType,
  resolvedTitle: KnowledgeDocumentVersionTable.resolvedTitle,
  resolvedDescription: KnowledgeDocumentVersionTable.resolvedDescription,
  embeddingProvider: KnowledgeDocumentVersionTable.embeddingProvider,
  embeddingModel: KnowledgeDocumentVersionTable.embeddingModel,
  chunkCount: KnowledgeDocumentVersionTable.chunkCount,
  tokenCount: KnowledgeDocumentVersionTable.tokenCount,
  embeddingTokenCount: KnowledgeDocumentVersionTable.embeddingTokenCount,
  sourceVersionId: KnowledgeDocumentVersionTable.sourceVersionId,
  createdByUserId: KnowledgeDocumentVersionTable.createdByUserId,
  createdAt: KnowledgeDocumentVersionTable.createdAt,
  updatedAt: KnowledgeDocumentVersionTable.updatedAt,
};

class VersionConflictError extends Error {
  constructor() {
    super("version_conflict");
  }
}

class RollbackModelMismatchError extends Error {
  constructor() {
    super("rollback_model_mismatch");
  }
}

class VersionNotFoundError extends Error {
  constructor() {
    super("version_not_found");
  }
}

type PendingImageOverride = {
  imageId: string;
  label?: string | null;
  description?: string | null;
  stepHint?: string | null;
};

type LockedDocumentVersionRow = {
  id: string;
  groupId: string;
  userId: string;
  name: string;
  description: string | null;
  descriptionManual: boolean;
  titleManual: boolean;
  originalFilename: string;
  fileType: KnowledgeDocument["fileType"];
  fileSize: number | null;
  storagePath: string | null;
  sourceUrl: string | null;
  status: KnowledgeDocument["status"];
  errorMessage: string | null;
  processingProgress: number | null;
  chunkCount: number;
  tokenCount: number;
  embeddingTokenCount: number;
  metadata: Record<string, unknown> | null;
  markdownContent: string | null;
  activeVersionId: string | null;
  latestVersionNumber: number;
  createdAt: Date;
  updatedAt: Date;
  embeddingProvider: string;
  embeddingModel: string;
  chunkSize: number;
  chunkOverlapPercent: number;
};

function readPendingImageOverrides(
  metadata: Record<string, unknown> | null | undefined,
): PendingImageOverride[] {
  const raw = metadata?.contextImageOverrides;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is PendingImageOverride =>
        !!entry &&
        typeof entry === "object" &&
        "imageId" in entry &&
        typeof (entry as { imageId?: unknown }).imageId === "string",
    )
    .map((entry) => ({
      imageId: entry.imageId,
      label:
        typeof entry.label === "string" || entry.label === null
          ? entry.label
          : undefined,
      description:
        typeof entry.description === "string" || entry.description === null
          ? entry.description
          : undefined,
      stepHint:
        typeof entry.stepHint === "string" || entry.stepHint === null
          ? entry.stepHint
          : undefined,
    }));
}

function parsePgVectorLiteral(
  value: string | number[] | null | undefined,
): number[] | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    return value.map((entry) => Number(entry));
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === "[]") return [];

  return trimmed
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((entry) => Number.isFinite(entry));
}

function toPgVectorLiteral(embedding: number[] | null | undefined) {
  if (!embedding || embedding.length === 0) return null;
  const safe = embedding.map((entry) => (Number.isFinite(entry) ? entry : 0));
  return `[${safe.join(",")}]`;
}

function toPgVectorExpression(embedding: number[] | null | undefined) {
  const literal = toPgVectorLiteral(embedding);
  return literal === null ? sql`NULL::vector` : sql`${literal}::vector`;
}

export function getNextReservedVersionNumber(input: {
  latestVersionNumber?: number | null;
  maxExistingVersionNumber?: number | null;
}): number {
  return (
    Math.max(
      input.latestVersionNumber ?? 0,
      input.maxExistingVersionNumber ?? 0,
    ) + 1
  );
}

export function resolveKnowledgeDocumentFailureOutcome(input: {
  activeVersionId?: string | null;
  errorMessage: string;
}) {
  if (input.activeVersionId) {
    return {
      status: "ready" as const,
      errorMessage: input.errorMessage,
    };
  }

  return {
    status: "failed" as const,
    errorMessage: input.errorMessage,
  };
}

function clearDocumentProcessingMetadata() {
  return sql`(
    COALESCE(${KnowledgeDocumentTable.metadata}::jsonb, '{}'::jsonb) - 'processingState'
  )::json`;
}

function mapDocumentVersion(
  row: VersionRowWithVector,
): KnowledgeDocumentVersion {
  return {
    id: row.id,
    documentId: row.documentId,
    groupId: row.groupId,
    userId: row.userId,
    versionNumber: row.versionNumber,
    status: row.status,
    changeType: row.changeType,
    markdownContent: row.markdownContent ?? null,
    resolvedTitle: row.resolvedTitle,
    resolvedDescription: row.resolvedDescription ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? null,
    metadataEmbedding: parsePgVectorLiteral(row.metadataEmbeddingText ?? null),
    embeddingProvider: row.embeddingProvider,
    embeddingModel: row.embeddingModel,
    chunkCount: row.chunkCount ?? 0,
    tokenCount: row.tokenCount ?? 0,
    embeddingTokenCount: row.embeddingTokenCount ?? 0,
    sourceVersionId: row.sourceVersionId ?? null,
    createdByUserId: row.createdByUserId ?? null,
    errorMessage: row.errorMessage ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function selectDocumentRow(documentId: string) {
  const [row] = await db
    .select({
      id: KnowledgeDocumentTable.id,
      groupId: KnowledgeDocumentTable.groupId,
      userId: KnowledgeDocumentTable.userId,
      name: KnowledgeDocumentTable.name,
      description: KnowledgeDocumentTable.description,
      descriptionManual: KnowledgeDocumentTable.descriptionManual,
      titleManual: KnowledgeDocumentTable.titleManual,
      originalFilename: KnowledgeDocumentTable.originalFilename,
      fileType: KnowledgeDocumentTable.fileType,
      fileSize: KnowledgeDocumentTable.fileSize,
      storagePath: KnowledgeDocumentTable.storagePath,
      sourceUrl: KnowledgeDocumentTable.sourceUrl,
      status: KnowledgeDocumentTable.status,
      errorMessage: KnowledgeDocumentTable.errorMessage,
      processingProgress: KnowledgeDocumentTable.processingProgress,
      chunkCount: KnowledgeDocumentTable.chunkCount,
      tokenCount: KnowledgeDocumentTable.tokenCount,
      embeddingTokenCount: KnowledgeDocumentTable.embeddingTokenCount,
      metadata: KnowledgeDocumentTable.metadata,
      markdownContent: KnowledgeDocumentTable.markdownContent,
      activeVersionId: KnowledgeDocumentTable.activeVersionId,
      latestVersionNumber: KnowledgeDocumentTable.latestVersionNumber,
      createdAt: KnowledgeDocumentTable.createdAt,
      updatedAt: KnowledgeDocumentTable.updatedAt,
      embeddingProvider: KnowledgeGroupTable.embeddingProvider,
      embeddingModel: KnowledgeGroupTable.embeddingModel,
      chunkSize: KnowledgeGroupTable.chunkSize,
      chunkOverlapPercent: KnowledgeGroupTable.chunkOverlapPercent,
    })
    .from(KnowledgeDocumentTable)
    .innerJoin(
      KnowledgeGroupTable,
      eq(KnowledgeDocumentTable.groupId, KnowledgeGroupTable.id),
    )
    .where(eq(KnowledgeDocumentTable.id, documentId));

  return row as SelectedDocumentRow | undefined;
}

async function selectDocumentRowForUpdate(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  documentId: string,
): Promise<LockedDocumentVersionRow | undefined> {
  const rows = await tx.execute<{
    id: string;
    group_id: string;
    user_id: string;
    name: string;
    description: string | null;
    description_manual: boolean | null;
    title_manual: boolean | null;
    original_filename: string;
    file_type: KnowledgeDocument["fileType"];
    file_size: number | null;
    storage_path: string | null;
    source_url: string | null;
    status: KnowledgeDocument["status"];
    error_message: string | null;
    processing_progress: number | null;
    chunk_count: number;
    token_count: number;
    embedding_token_count: number;
    metadata: Record<string, unknown> | null;
    markdown_content: string | null;
    active_version_id: string | null;
    latest_version_number: number | null;
    created_at: Date;
    updated_at: Date;
    embedding_provider: string;
    embedding_model: string;
    chunk_size: number;
    chunk_overlap_percent: number;
  }>(sql`
    SELECT
      doc.id,
      doc.group_id,
      doc.user_id,
      doc.name,
      doc.description,
      doc.description_manual,
      doc.title_manual,
      doc.original_filename,
      doc.file_type,
      doc.file_size,
      doc.storage_path,
      doc.source_url,
      doc.status,
      doc.error_message,
      doc.processing_progress,
      doc.chunk_count,
      doc.token_count,
      doc.embedding_token_count,
      doc.metadata,
      doc.markdown_content,
      doc.active_version_id,
      doc.latest_version_number,
      doc.created_at,
      doc.updated_at,
      grp.embedding_provider,
      grp.embedding_model,
      grp.chunk_size,
      grp.chunk_overlap_percent
    FROM knowledge_document doc
    INNER JOIN knowledge_group grp
      ON grp.id = doc.group_id
    WHERE doc.id = ${documentId}::uuid
    FOR UPDATE OF doc
  `);

  const row = rows.rows[0];
  if (!row) return undefined;

  return {
    id: row.id,
    groupId: row.group_id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    descriptionManual: row.description_manual ?? false,
    titleManual: row.title_manual ?? false,
    originalFilename: row.original_filename,
    fileType: row.file_type,
    fileSize: row.file_size,
    storagePath: row.storage_path,
    sourceUrl: row.source_url,
    status: row.status,
    errorMessage: row.error_message,
    processingProgress: row.processing_progress,
    chunkCount: row.chunk_count ?? 0,
    tokenCount: row.token_count ?? 0,
    embeddingTokenCount: row.embedding_token_count ?? 0,
    metadata: row.metadata,
    markdownContent: row.markdown_content,
    activeVersionId: row.active_version_id,
    latestVersionNumber: row.latest_version_number ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    embeddingProvider: row.embedding_provider,
    embeddingModel: row.embedding_model,
    chunkSize: row.chunk_size,
    chunkOverlapPercent: row.chunk_overlap_percent,
  };
}

async function selectMaxDocumentVersionNumber(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  documentId: string,
): Promise<number> {
  const rows = await tx.execute<{ max_version_number: number | null }>(sql`
    SELECT MAX(version_number)::integer AS max_version_number
    FROM knowledge_document_version
    WHERE document_id = ${documentId}::uuid
  `);

  return rows.rows[0]?.max_version_number ?? 0;
}

async function insertPendingVersion(args: {
  documentId: string;
  expectedActiveVersionId?: string | null;
  createdByUserId?: string | null;
  changeType:
    | DocumentVersionChangeType
    | ((input: {
        document: LockedDocumentVersionRow;
        maxExistingVersionNumber: number;
      }) => DocumentVersionChangeType);
  markdownContent: string | null;
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
}): Promise<KnowledgeDocumentVersion> {
  return db.transaction(async (tx) => {
    const docRow = await selectDocumentRowForUpdate(tx, args.documentId);
    if (!docRow) {
      throw new VersionNotFoundError();
    }

    if (
      args.expectedActiveVersionId !== undefined &&
      (docRow.activeVersionId ?? null) !==
        (args.expectedActiveVersionId ?? null)
    ) {
      throw new VersionConflictError();
    }

    const maxExistingVersionNumber = await selectMaxDocumentVersionNumber(
      tx,
      args.documentId,
    );
    const changeType =
      typeof args.changeType === "function"
        ? args.changeType({
            document: docRow,
            maxExistingVersionNumber,
          })
        : args.changeType;
    const nextVersionNumber = getNextReservedVersionNumber({
      latestVersionNumber: docRow.latestVersionNumber,
      maxExistingVersionNumber,
    });

    const [version] = await tx
      .insert(KnowledgeDocumentVersionTable)
      .values({
        id: generateUUID(),
        documentId: docRow.id,
        groupId: docRow.groupId,
        userId: docRow.userId,
        versionNumber: nextVersionNumber,
        status: "processing",
        changeType,
        markdownContent: args.markdownContent,
        resolvedTitle: args.resolvedTitle,
        resolvedDescription: args.resolvedDescription ?? null,
        metadata: args.metadata ?? null,
        metadataEmbedding: toPgVectorExpression(args.metadataEmbedding ?? null),
        embeddingProvider: args.embeddingProvider,
        embeddingModel: args.embeddingModel,
        chunkCount: args.chunkCount,
        tokenCount: args.tokenCount,
        embeddingTokenCount: args.embeddingTokenCount,
        sourceVersionId: args.sourceVersionId ?? null,
        createdByUserId: args.createdByUserId ?? docRow.userId,
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any)
      .returning(documentVersionSelection);

    return mapDocumentVersion(version as VersionRowWithVector);
  });
}

async function selectVersionRow(versionId: string) {
  const [row] = await db
    .select(documentVersionSelection)
    .from(KnowledgeDocumentVersionTable)
    .where(eq(KnowledgeDocumentVersionTable.id, versionId));

  return row as VersionRowWithVector | undefined;
}

async function selectLatestProcessingVersionRow(documentId: string) {
  const [row] = await db
    .select(documentVersionSelection)
    .from(KnowledgeDocumentVersionTable)
    .where(
      sql`${KnowledgeDocumentVersionTable.documentId} = ${documentId}::uuid AND ${KnowledgeDocumentVersionTable.status} = 'processing'`,
    )
    .orderBy(
      desc(KnowledgeDocumentVersionTable.versionNumber),
      desc(KnowledgeDocumentVersionTable.updatedAt),
    )
    .limit(1);

  return row as VersionRowWithVector | undefined;
}

async function selectLiveSections(
  documentId: string,
): Promise<VersionSnapshotSection[]> {
  const rows = await db.execute<{
    id: string;
    parent_section_id: string | null;
    prev_section_id: string | null;
    next_section_id: string | null;
    heading: string;
    heading_path: string;
    level: number;
    part_index: number;
    part_count: number;
    content: string;
    summary: string;
    token_count: number;
    embedding_text: string | null;
  }>(
    sql`
      SELECT
        id,
        parent_section_id,
        prev_section_id,
        next_section_id,
        heading,
        heading_path,
        level,
        part_index,
        part_count,
        content,
        summary,
        token_count,
        embedding::text AS embedding_text
      FROM knowledge_section
      WHERE document_id = ${documentId}::uuid
      ORDER BY created_at ASC, part_index ASC, id ASC
    `,
  );

  return rows.rows.map((row) => ({
    id: row.id,
    parentSectionId: row.parent_section_id ?? null,
    prevSectionId: row.prev_section_id ?? null,
    nextSectionId: row.next_section_id ?? null,
    heading: row.heading,
    headingPath: row.heading_path,
    level: row.level,
    partIndex: row.part_index,
    partCount: row.part_count,
    content: row.content,
    summary: row.summary,
    tokenCount: row.token_count,
    embedding: parsePgVectorLiteral(row.embedding_text),
    sourcePath: null,
    libraryId: null,
    libraryVersion: null,
    includeHeadingInChunkContent: false,
  }));
}

async function selectLiveChunks(
  documentId: string,
): Promise<VersionSnapshotChunk[]> {
  const rows = await db.execute<{
    id: string;
    section_id: string | null;
    content: string;
    context_summary: string | null;
    embedding_text: string | null;
    chunk_index: number;
    token_count: number;
    metadata: KnowledgeChunkMetadata | null;
  }>(
    sql`
      SELECT
        id,
        section_id,
        content,
        context_summary,
        embedding::text AS embedding_text,
        chunk_index,
        token_count,
        metadata
      FROM knowledge_chunk
      WHERE document_id = ${documentId}::uuid
      ORDER BY chunk_index ASC
    `,
  );

  return rows.rows.map((row) => ({
    id: row.id,
    sectionId: row.section_id ?? null,
    content: row.content,
    contextSummary: row.context_summary ?? null,
    embedding: parsePgVectorLiteral(row.embedding_text),
    chunkIndex: row.chunk_index,
    tokenCount: row.token_count,
    metadata: row.metadata ?? null,
  }));
}

async function selectLiveImages(
  documentId: string,
): Promise<VersionSnapshotImage[]> {
  const rows = await db.execute<{
    id: string;
    document_id: string;
    group_id: string;
    version_id: string | null;
    kind: "embedded" | "region";
    ordinal: number;
    marker: string;
    label: string;
    description: string;
    heading_path: string | null;
    step_hint: string | null;
    storage_path: string | null;
    source_url: string | null;
    media_type: string | null;
    page_number: number | null;
    width: number | null;
    height: number | null;
    alt_text: string | null;
    caption: string | null;
    surrounding_text: string | null;
    preceding_text: string | null;
    following_text: string | null;
    is_renderable: boolean;
    manual_label: boolean;
    manual_description: boolean;
    embedding_text: string | null;
  }>(
    sql`
      SELECT
        id,
        document_id,
        group_id,
        version_id,
        kind,
        ordinal,
        marker,
        label,
        description,
        heading_path,
        step_hint,
        storage_path,
        source_url,
        media_type,
        page_number,
        width,
        height,
        alt_text,
        caption,
        surrounding_text,
        preceding_text,
        following_text,
        is_renderable,
        manual_label,
        manual_description,
        embedding::text AS embedding_text
      FROM knowledge_document_image
      WHERE document_id = ${documentId}::uuid
      ORDER BY ordinal ASC, created_at ASC
    `,
  );

  return rows.rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    groupId: row.group_id,
    versionId: row.version_id ?? null,
    kind: row.kind,
    ordinal: row.ordinal,
    marker: row.marker,
    label: row.label,
    description: row.description,
    headingPath: row.heading_path ?? null,
    stepHint: sanitizeImageStepHint(row.step_hint),
    sourceUrl: row.source_url ?? null,
    storagePath: row.storage_path ?? null,
    mediaType: row.media_type ?? null,
    pageNumber: row.page_number ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    altText: row.alt_text ?? null,
    caption: row.caption ?? null,
    surroundingText: row.surrounding_text ?? null,
    precedingText: row.preceding_text ?? null,
    followingText: row.following_text ?? null,
    isRenderable: row.is_renderable,
    manualLabel: row.manual_label,
    manualDescription: row.manual_description,
    embedding: parsePgVectorLiteral(row.embedding_text),
  }));
}

async function selectVersionSections(
  versionId: string,
): Promise<VersionSnapshotSection[]> {
  const rows = await db.execute<{
    id: string;
    parent_section_id: string | null;
    prev_section_id: string | null;
    next_section_id: string | null;
    heading: string;
    heading_path: string;
    level: number;
    part_index: number;
    part_count: number;
    content: string;
    summary: string;
    token_count: number;
    embedding_text: string | null;
    source_path: string | null;
    library_id: string | null;
    library_version: string | null;
    include_heading_in_chunk_content: boolean | null;
  }>(
    sql`
      SELECT
        id,
        parent_section_id,
        prev_section_id,
        next_section_id,
        heading,
        heading_path,
        level,
        part_index,
        part_count,
        content,
        summary,
        token_count,
        embedding::text AS embedding_text,
        source_path,
        library_id,
        library_version,
        include_heading_in_chunk_content
      FROM knowledge_section_version
      WHERE version_id = ${versionId}::uuid
      ORDER BY position ASC, id ASC
    `,
  );

  return rows.rows.map((row) => ({
    id: row.id,
    parentSectionId: row.parent_section_id ?? null,
    prevSectionId: row.prev_section_id ?? null,
    nextSectionId: row.next_section_id ?? null,
    heading: row.heading,
    headingPath: row.heading_path,
    level: row.level,
    partIndex: row.part_index,
    partCount: row.part_count,
    content: row.content,
    summary: row.summary,
    tokenCount: row.token_count,
    embedding: parsePgVectorLiteral(row.embedding_text),
    sourcePath: row.source_path ?? null,
    libraryId: row.library_id ?? null,
    libraryVersion: row.library_version ?? null,
    includeHeadingInChunkContent: row.include_heading_in_chunk_content ?? false,
  }));
}

async function selectVersionChunks(
  versionId: string,
): Promise<VersionSnapshotChunk[]> {
  const rows = await db.execute<{
    id: string;
    section_version_id: string | null;
    content: string;
    context_summary: string | null;
    embedding_text: string | null;
    chunk_index: number;
    token_count: number;
    metadata: KnowledgeChunkMetadata | null;
  }>(
    sql`
      SELECT
        id,
        section_version_id,
        content,
        context_summary,
        embedding::text AS embedding_text,
        chunk_index,
        token_count,
        metadata
      FROM knowledge_chunk_version
      WHERE version_id = ${versionId}::uuid
      ORDER BY chunk_index ASC
    `,
  );

  return rows.rows.map((row) => ({
    id: row.id,
    sectionId: row.section_version_id ?? null,
    content: row.content,
    contextSummary: row.context_summary ?? null,
    embedding: parsePgVectorLiteral(row.embedding_text),
    chunkIndex: row.chunk_index,
    tokenCount: row.token_count,
    metadata: row.metadata ?? null,
  }));
}

async function selectVersionImages(
  versionId: string,
): Promise<VersionSnapshotImage[]> {
  const rows = await db.execute<{
    id: string;
    version_id: string;
    document_id: string;
    group_id: string;
    kind: "embedded" | "region";
    ordinal: number;
    marker: string;
    label: string;
    description: string;
    heading_path: string | null;
    step_hint: string | null;
    storage_path: string | null;
    source_url: string | null;
    media_type: string | null;
    page_number: number | null;
    width: number | null;
    height: number | null;
    alt_text: string | null;
    caption: string | null;
    surrounding_text: string | null;
    preceding_text: string | null;
    following_text: string | null;
    is_renderable: boolean;
    manual_label: boolean;
    manual_description: boolean;
    embedding_text: string | null;
  }>(
    sql`
      SELECT
        id,
        version_id,
        document_id,
        group_id,
        kind,
        ordinal,
        marker,
        label,
        description,
        heading_path,
        step_hint,
        storage_path,
        source_url,
        media_type,
        page_number,
        width,
        height,
        alt_text,
        caption,
        surrounding_text,
        preceding_text,
        following_text,
        is_renderable,
        manual_label,
        manual_description,
        embedding::text AS embedding_text
      FROM knowledge_document_image_version
      WHERE version_id = ${versionId}::uuid
      ORDER BY ordinal ASC, created_at ASC
    `,
  );

  return rows.rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    groupId: row.group_id,
    versionId: row.version_id,
    kind: row.kind,
    ordinal: row.ordinal,
    marker: row.marker,
    label: row.label,
    description: row.description,
    headingPath: row.heading_path ?? null,
    stepHint: sanitizeImageStepHint(row.step_hint),
    sourceUrl: row.source_url ?? null,
    storagePath: row.storage_path ?? null,
    mediaType: row.media_type ?? null,
    pageNumber: row.page_number ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    altText: row.alt_text ?? null,
    caption: row.caption ?? null,
    surroundingText: row.surrounding_text ?? null,
    precedingText: row.preceding_text ?? null,
    followingText: row.following_text ?? null,
    isRenderable: row.is_renderable,
    manualLabel: row.manual_label,
    manualDescription: row.manual_description,
    embedding: parsePgVectorLiteral(row.embedding_text),
  }));
}

function applyImageOverrides(
  images: VersionSnapshotImage[],
  overrides: PendingImageOverride[],
): VersionSnapshotImage[] {
  if (overrides.length === 0) return images;
  const overrideById = new Map(
    overrides.map((override) => [override.imageId, override]),
  );
  return images.map((image) => {
    const override = overrideById.get(image.id);
    if (!override) return image;
    return {
      ...image,
      label:
        override.label !== undefined && override.label !== null
          ? override.label
          : image.label,
      description:
        override.description !== undefined && override.description !== null
          ? override.description
          : image.description,
      stepHint:
        override.stepHint !== undefined ? override.stepHint : image.stepHint,
      manualLabel:
        override.label !== undefined
          ? Boolean(override.label?.trim())
          : image.manualLabel,
      manualDescription:
        override.description !== undefined
          ? Boolean(override.description?.trim())
          : image.manualDescription,
    };
  });
}

function toProcessedDocumentImages(
  images: VersionSnapshotImage[],
): ProcessedDocumentImage[] {
  return images.map((image, index) => ({
    kind: image.kind,
    marker: image.marker,
    index: image.ordinal ?? index,
    mediaType: image.mediaType ?? null,
    sourceUrl: image.sourceUrl ?? null,
    storagePath: image.storagePath ?? null,
    pageNumber: image.pageNumber ?? null,
    width: image.width ?? null,
    height: image.height ?? null,
    altText: image.altText ?? null,
    caption: image.caption ?? null,
    surroundingText: image.surroundingText ?? null,
    precedingText: image.precedingText ?? null,
    followingText: image.followingText ?? null,
    headingPath: image.headingPath ?? null,
    stepHint: image.stepHint ?? null,
    label: image.label,
    description: image.description,
    isRenderable: image.isRenderable,
    manualLabel: image.manualLabel,
    manualDescription: image.manualDescription,
    embedding: image.embedding ?? null,
  }));
}

async function insertSectionSnapshots(
  tx: any,
  versionId: string,
  documentId: string,
  groupId: string,
  sections: VersionSnapshotSection[],
) {
  if (sections.length === 0) return;

  for (let index = 0; index < sections.length; index += VERSION_BATCH_SIZE) {
    const batch = sections.slice(index, index + VERSION_BATCH_SIZE);
    await tx.insert(KnowledgeSectionVersionTable).values(
      batch.map((section, offset) => ({
        id: section.id,
        versionId,
        documentId,
        groupId,
        position: index + offset,
        parentSectionId: section.parentSectionId ?? null,
        prevSectionId: section.prevSectionId ?? null,
        nextSectionId: section.nextSectionId ?? null,
        heading: section.heading,
        headingPath: section.headingPath,
        level: section.level,
        partIndex: section.partIndex,
        partCount: section.partCount,
        content: section.content,
        summary: section.summary,
        tokenCount: section.tokenCount,
        embedding: toPgVectorExpression(section.embedding ?? null),
        sourcePath: section.sourcePath ?? null,
        libraryId: section.libraryId ?? null,
        libraryVersion: section.libraryVersion ?? null,
        includeHeadingInChunkContent:
          section.includeHeadingInChunkContent ?? false,
        createdAt: new Date(),
      })),
    );
  }
}

async function insertChunkSnapshots(
  tx: any,
  versionId: string,
  documentId: string,
  groupId: string,
  chunks: VersionSnapshotChunk[],
) {
  if (chunks.length === 0) return;

  for (let index = 0; index < chunks.length; index += VERSION_BATCH_SIZE) {
    const batch = chunks.slice(index, index + VERSION_BATCH_SIZE);
    await tx.insert(KnowledgeChunkVersionTable).values(
      batch.map((chunk) => ({
        id: chunk.id,
        versionId,
        documentId,
        groupId,
        sectionVersionId: chunk.sectionId ?? null,
        content: chunk.content,
        contextSummary: chunk.contextSummary ?? null,
        embedding: chunk.embedding ?? null,
        chunkIndex: chunk.chunkIndex,
        tokenCount: chunk.tokenCount,
        metadata: chunk.metadata ?? null,
        createdAt: new Date(),
      })),
    );
  }
}

async function insertImageSnapshots(
  tx: any,
  versionId: string,
  documentId: string,
  groupId: string,
  images: VersionSnapshotImage[],
) {
  if (images.length === 0) return;

  for (let index = 0; index < images.length; index += VERSION_BATCH_SIZE) {
    const batch = images.slice(index, index + VERSION_BATCH_SIZE);
    await tx.insert(KnowledgeDocumentImageVersionTable).values(
      batch.map((image) => ({
        id: image.id,
        versionId,
        documentId,
        groupId,
        kind: image.kind,
        ordinal: image.ordinal,
        marker: image.marker,
        label: image.label,
        description: image.description,
        headingPath: image.headingPath ?? null,
        stepHint: image.stepHint ?? null,
        storagePath: image.storagePath ?? null,
        sourceUrl: image.sourceUrl ?? null,
        mediaType: image.mediaType ?? null,
        pageNumber: image.pageNumber ?? null,
        width: image.width ?? null,
        height: image.height ?? null,
        altText: image.altText ?? null,
        caption: image.caption ?? null,
        surroundingText: image.surroundingText ?? null,
        precedingText: image.precedingText ?? null,
        followingText: image.followingText ?? null,
        isRenderable: image.isRenderable,
        manualLabel: image.manualLabel,
        manualDescription: image.manualDescription,
        embedding: image.embedding ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    );
  }
}

async function replaceLiveMaterialization(
  tx: any,
  documentId: string,
  groupId: string,
  sections: VersionSnapshotSection[],
  chunks: VersionSnapshotChunk[],
  images: VersionSnapshotImage[],
) {
  await tx
    .delete(KnowledgeDocumentImageTable)
    .where(eq(KnowledgeDocumentImageTable.documentId, documentId));
  await tx
    .delete(KnowledgeChunkTable)
    .where(eq(KnowledgeChunkTable.documentId, documentId));
  await tx
    .delete(KnowledgeSectionTable)
    .where(eq(KnowledgeSectionTable.documentId, documentId));

  if (sections.length > 0) {
    for (let index = 0; index < sections.length; index += VERSION_BATCH_SIZE) {
      const batch = sections.slice(index, index + VERSION_BATCH_SIZE);
      await tx.insert(KnowledgeSectionTable).values(
        batch.map((section) => ({
          id: section.id,
          documentId,
          groupId,
          parentSectionId: section.parentSectionId ?? null,
          prevSectionId: section.prevSectionId ?? null,
          nextSectionId: section.nextSectionId ?? null,
          heading: section.heading,
          headingPath: section.headingPath,
          level: section.level,
          partIndex: section.partIndex,
          partCount: section.partCount,
          content: section.content,
          summary: section.summary,
          tokenCount: section.tokenCount,
          embedding: toPgVectorExpression(section.embedding ?? null),
          createdAt: new Date(),
        })),
      );
    }
  }

  if (chunks.length > 0) {
    for (let index = 0; index < chunks.length; index += VERSION_BATCH_SIZE) {
      const batch = chunks.slice(index, index + VERSION_BATCH_SIZE);
      await tx.insert(KnowledgeChunkTable).values(
        batch.map((chunk) => ({
          id: chunk.id,
          documentId,
          groupId,
          sectionId: chunk.sectionId ?? null,
          content: chunk.content,
          contextSummary: chunk.contextSummary ?? null,
          embedding: chunk.embedding ?? null,
          chunkIndex: chunk.chunkIndex,
          tokenCount: chunk.tokenCount,
          metadata: chunk.metadata ?? null,
          createdAt: new Date(),
        })),
      );
    }
  }

  if (images.length > 0) {
    for (let index = 0; index < images.length; index += VERSION_BATCH_SIZE) {
      const batch = images.slice(index, index + VERSION_BATCH_SIZE);
      await tx.insert(KnowledgeDocumentImageTable).values(
        batch.map((image) => ({
          id: image.id,
          documentId,
          groupId,
          versionId: image.versionId ?? null,
          kind: image.kind,
          ordinal: image.ordinal,
          marker: image.marker,
          label: image.label,
          description: image.description,
          headingPath: image.headingPath ?? null,
          stepHint: image.stepHint ?? null,
          storagePath: image.storagePath ?? null,
          sourceUrl: image.sourceUrl ?? null,
          mediaType: image.mediaType ?? null,
          pageNumber: image.pageNumber ?? null,
          width: image.width ?? null,
          height: image.height ?? null,
          altText: image.altText ?? null,
          caption: image.caption ?? null,
          surroundingText: image.surroundingText ?? null,
          precedingText: image.precedingText ?? null,
          followingText: image.followingText ?? null,
          isRenderable: image.isRenderable,
          manualLabel: image.manualLabel,
          manualDescription: image.manualDescription,
          embedding: image.embedding ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
    }
  }
}

async function insertHistoryEvent(
  tx: any,
  args: {
    documentId: string;
    groupId: string;
    userId: string;
    actorUserId?: string | null;
    eventType: HistoryEventType;
    fromVersionId?: string | null;
    toVersionId?: string | null;
    details?: Record<string, unknown> | null;
  },
) {
  await tx.insert(KnowledgeDocumentHistoryEventTable).values({
    id: generateUUID(),
    documentId: args.documentId,
    groupId: args.groupId,
    userId: args.userId,
    actorUserId: args.actorUserId ?? null,
    eventType: args.eventType,
    fromVersionId: args.fromVersionId ?? null,
    toVersionId: args.toVersionId ?? null,
    details: args.details ?? null,
    createdAt: new Date(),
  });
}

function ensureModelMatch(
  version: Pick<
    KnowledgeDocumentVersion,
    "embeddingProvider" | "embeddingModel"
  >,
  group: Pick<KnowledgeGroup, "embeddingProvider" | "embeddingModel">,
) {
  if (
    version.embeddingProvider !== group.embeddingProvider ||
    version.embeddingModel !== group.embeddingModel
  ) {
    throw new RollbackModelMismatchError();
  }
}

async function finalizeMaterializedVersion({
  versionId,
  versionNumber,
  sourceVersionId,
  expectedActiveVersionId,
  eventType,
  actorUserId,
  doc,
  group,
  markdown,
  resolvedTitle,
  resolvedDescription,
  metadata,
  metadataEmbedding,
  sections,
  chunks,
  images,
  totalTokens,
  embeddingTokenCount,
}: MaterializedCommitInput) {
  await db.transaction(async (tx) => {
    const [currentDoc] = await tx
      .select({
        id: KnowledgeDocumentTable.id,
        activeVersionId: KnowledgeDocumentTable.activeVersionId,
        latestVersionNumber: KnowledgeDocumentTable.latestVersionNumber,
      })
      .from(KnowledgeDocumentTable)
      .where(eq(KnowledgeDocumentTable.id, doc.id));

    if (!currentDoc) {
      throw new VersionNotFoundError();
    }

    if (
      expectedActiveVersionId !== undefined &&
      (currentDoc.activeVersionId ?? null) !== (expectedActiveVersionId ?? null)
    ) {
      throw new VersionConflictError();
    }

    await tx
      .delete(KnowledgeChunkVersionTable)
      .where(eq(KnowledgeChunkVersionTable.versionId, versionId));
    await tx
      .delete(KnowledgeDocumentImageVersionTable)
      .where(eq(KnowledgeDocumentImageVersionTable.versionId, versionId));
    await tx
      .delete(KnowledgeSectionVersionTable)
      .where(eq(KnowledgeSectionVersionTable.versionId, versionId));

    await insertSectionSnapshots(tx, versionId, doc.id, group.id, sections);
    await insertChunkSnapshots(tx, versionId, doc.id, group.id, chunks);
    await insertImageSnapshots(tx, versionId, doc.id, group.id, images);
    await replaceLiveMaterialization(
      tx,
      doc.id,
      group.id,
      sections,
      chunks,
      images.map((image) => ({
        ...image,
        versionId,
      })),
    );

    await tx
      .update(KnowledgeDocumentVersionTable)
      .set({
        status: "ready",
        markdownContent: markdown,
        resolvedTitle,
        resolvedDescription: resolvedDescription ?? null,
        metadata: metadata ?? null,
        metadataEmbedding: toPgVectorExpression(metadataEmbedding ?? null),
        chunkCount: chunks.length,
        tokenCount: totalTokens,
        embeddingTokenCount,
        errorMessage: null,
        updatedAt: new Date(),
      } as any)
      .where(eq(KnowledgeDocumentVersionTable.id, versionId));

    await tx
      .update(KnowledgeDocumentTable)
      .set({
        name: resolvedTitle,
        description: resolvedDescription ?? null,
        metadata: metadata ?? null,
        metadataEmbedding: toPgVectorExpression(metadataEmbedding ?? null),
        markdownContent: markdown,
        status: "ready",
        errorMessage: null,
        processingProgress: null,
        chunkCount: chunks.length,
        tokenCount: totalTokens,
        embeddingTokenCount,
        activeVersionId: versionId,
        latestVersionNumber: Math.max(
          currentDoc.latestVersionNumber ?? 0,
          versionNumber,
        ),
        updatedAt: new Date(),
      } as any)
      .where(eq(KnowledgeDocumentTable.id, doc.id));

    await insertHistoryEvent(tx, {
      documentId: doc.id,
      groupId: group.id,
      userId: doc.userId,
      actorUserId: actorUserId ?? doc.userId,
      eventType,
      fromVersionId: sourceVersionId ?? null,
      toVersionId: versionId,
      details: {
        chunkCount: chunks.length,
        tokenCount: totalTokens,
        embeddingTokenCount: eventType === "rollback" ? 0 : embeddingTokenCount,
        imageCount: images.length,
      },
    });
  });
}

export async function ensureDocumentVersionBootstrap(documentId: string) {
  const selectedDoc = await selectDocumentRow(documentId);
  if (!selectedDoc) return;
  if (
    (selectedDoc.activeVersionId ?? null) !== null &&
    (selectedDoc.latestVersionNumber ?? 0) > 0
  ) {
    return;
  }
  if (selectedDoc.status !== "ready" || !selectedDoc.markdownContent) {
    return;
  }

  await db.transaction(async (tx) => {
    const currentDoc = await selectDocumentRowForUpdate(tx, documentId);

    if (
      !currentDoc ||
      currentDoc.activeVersionId ||
      (currentDoc.latestVersionNumber ?? 0) > 0 ||
      !currentDoc.markdownContent
    ) {
      return;
    }

    const liveSections = await selectLiveSections(documentId);
    const liveChunks = await selectLiveChunks(documentId);
    const liveImages = await selectLiveImages(documentId);
    const [version] = await tx
      .insert(KnowledgeDocumentVersionTable)
      .values({
        id: generateUUID(),
        documentId: documentId,
        groupId: selectedDoc.groupId,
        userId: selectedDoc.userId,
        versionNumber: 1,
        status: "ready",
        changeType: "initial_ingest",
        markdownContent: currentDoc.markdownContent,
        resolvedTitle: currentDoc.name,
        resolvedDescription: currentDoc.description ?? null,
        metadata: currentDoc.metadata ?? null,
        metadataEmbedding: sql`NULL::vector`,
        embeddingProvider: selectedDoc.embeddingProvider,
        embeddingModel: selectedDoc.embeddingModel,
        chunkCount: liveChunks.length,
        tokenCount: liveChunks.reduce(
          (sum, chunk) => sum + chunk.tokenCount,
          0,
        ),
        embeddingTokenCount: selectedDoc.embeddingTokenCount ?? 0,
        sourceVersionId: null,
        createdByUserId: selectedDoc.userId,
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any)
      .returning();

    await insertSectionSnapshots(
      tx,
      version.id,
      documentId,
      selectedDoc.groupId,
      liveSections,
    );
    await insertChunkSnapshots(
      tx,
      version.id,
      documentId,
      selectedDoc.groupId,
      liveChunks,
    );
    await insertImageSnapshots(
      tx,
      version.id,
      documentId,
      selectedDoc.groupId,
      liveImages.map((image) => ({
        ...image,
        versionId: version.id,
      })),
    );

    await tx
      .update(KnowledgeDocumentTable)
      .set({
        activeVersionId: version.id,
        latestVersionNumber: 1,
        updatedAt: new Date(),
      })
      .where(eq(KnowledgeDocumentTable.id, documentId));

    await insertHistoryEvent(tx, {
      documentId,
      groupId: selectedDoc.groupId,
      userId: selectedDoc.userId,
      actorUserId: selectedDoc.userId,
      eventType: "bootstrap",
      toVersionId: version.id,
      details: {
        chunkCount: liveChunks.length,
        embeddingTokenCount: 0,
        imageCount: liveImages.length,
      },
    });
  });
}

export async function listDocumentVersions(documentId: string) {
  await ensureDocumentVersionBootstrap(documentId);

  const selectedDoc = await selectDocumentRow(documentId);
  if (!selectedDoc) return [];

  const rows = await db
    .select(documentVersionSummarySelection)
    .from(KnowledgeDocumentVersionTable)
    .where(eq(KnowledgeDocumentVersionTable.documentId, documentId))
    .orderBy(desc(KnowledgeDocumentVersionTable.versionNumber));

  return rows.map((row) => {
    const isActive = row.id === selectedDoc.activeVersionId;
    const canRollback =
      !isActive &&
      row.status === "ready" &&
      row.embeddingProvider === selectedDoc.embeddingProvider &&
      row.embeddingModel === selectedDoc.embeddingModel;

    return {
      id: row.id,
      versionNumber: row.versionNumber,
      status: row.status,
      changeType: row.changeType,
      isActive,
      resolvedTitle: row.resolvedTitle,
      resolvedDescription: row.resolvedDescription ?? null,
      embeddingProvider: row.embeddingProvider,
      embeddingModel: row.embeddingModel,
      chunkCount: row.chunkCount ?? 0,
      tokenCount: row.tokenCount ?? 0,
      embeddingTokenCount: row.embeddingTokenCount ?? 0,
      sourceVersionId: row.sourceVersionId ?? null,
      createdByUserId: row.createdByUserId ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      canRollback,
      rollbackBlockedReason:
        !isActive && row.status === "ready" && !canRollback
          ? ROLLBACK_MODEL_MISMATCH_REASON
          : null,
    } satisfies KnowledgeDocumentVersionSummary;
  });
}

export async function getDocumentVersionContent(
  documentId: string,
  versionId: string,
) {
  await ensureDocumentVersionBootstrap(documentId);

  const row = await selectVersionRow(versionId);
  if (!row || row.documentId !== documentId) {
    return null;
  }

  return {
    versionId: row.id,
    markdownContent: row.markdownContent ?? null,
  };
}

export async function getDocumentHistory(documentId: string) {
  await ensureDocumentVersionBootstrap(documentId);

  const rows = await db.execute<{
    id: string;
    document_id: string;
    group_id: string;
    user_id: string;
    actor_user_id: string | null;
    actor_user_name: string | null;
    event_type: HistoryEventType;
    from_version_id: string | null;
    from_version_number: number | null;
    to_version_id: string | null;
    to_version_number: number | null;
    details: Record<string, unknown> | null;
    created_at: Date;
  }>(
    sql`
      SELECT
        event.id,
        event.document_id,
        event.group_id,
        event.user_id,
        event.actor_user_id,
        actor.name AS actor_user_name,
        event.event_type,
        event.from_version_id,
        from_version.version_number AS from_version_number,
        event.to_version_id,
        to_version.version_number AS to_version_number,
        event.details,
        event.created_at
      FROM knowledge_document_history_event event
      LEFT JOIN "user" actor ON actor.id = event.actor_user_id
      LEFT JOIN knowledge_document_version from_version
        ON from_version.id = event.from_version_id
      LEFT JOIN knowledge_document_version to_version
        ON to_version.id = event.to_version_id
      WHERE event.document_id = ${documentId}::uuid
      ORDER BY event.created_at DESC
    `,
  );

  return rows.rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    groupId: row.group_id,
    userId: row.user_id,
    actorUserId: row.actor_user_id,
    actorUserName: row.actor_user_name,
    eventType: row.event_type,
    fromVersionId: row.from_version_id,
    fromVersionNumber: row.from_version_number,
    toVersionId: row.to_version_id,
    toVersionNumber: row.to_version_number,
    details: row.details ?? null,
    createdAt: row.created_at,
  })) satisfies KnowledgeDocumentHistoryEvent[];
}

export async function prepareSourceDocumentVersion(documentId: string) {
  const docRow = await selectDocumentRow(documentId);
  if (!docRow) {
    throw new VersionNotFoundError();
  }

  return insertPendingVersion({
    documentId: docRow.id,
    changeType: ({ document, maxExistingVersionNumber }) =>
      Math.max(document.latestVersionNumber ?? 0, maxExistingVersionNumber) > 0
        ? "reingest"
        : "initial_ingest",
    markdownContent: docRow.markdownContent ?? null,
    resolvedTitle: docRow.name,
    resolvedDescription: docRow.description ?? null,
    metadata:
      ((docRow.metadata ?? null) as Record<string, unknown> | null) ?? null,
    metadataEmbedding: null,
    embeddingProvider: docRow.embeddingProvider,
    embeddingModel: docRow.embeddingModel,
    chunkCount: docRow.chunkCount ?? 0,
    tokenCount: docRow.tokenCount ?? 0,
    embeddingTokenCount: docRow.embeddingTokenCount ?? 0,
    sourceVersionId: docRow.activeVersionId ?? null,
    createdByUserId: docRow.userId,
  });
}

export async function createMarkdownEditVersion(args: {
  documentId: string;
  actorUserId: string;
  markdownContent: string;
  expectedActiveVersionId?: string | null;
}) {
  await ensureDocumentVersionBootstrap(args.documentId);

  const docRow = await selectDocumentRow(args.documentId);
  if (!docRow) {
    throw new VersionNotFoundError();
  }

  return insertPendingVersion({
    documentId: docRow.id,
    expectedActiveVersionId: args.expectedActiveVersionId ?? null,
    changeType: "edit",
    markdownContent: args.markdownContent,
    resolvedTitle: docRow.name,
    resolvedDescription: docRow.description ?? null,
    metadata:
      ((docRow.metadata ?? null) as Record<string, unknown> | null) ?? null,
    metadataEmbedding: null,
    embeddingProvider: docRow.embeddingProvider,
    embeddingModel: docRow.embeddingModel,
    chunkCount: 0,
    tokenCount: 0,
    embeddingTokenCount: 0,
    sourceVersionId: docRow.activeVersionId ?? null,
    createdByUserId: args.actorUserId,
  });
}

export async function createImageAnnotationEditVersion(args: {
  documentId: string;
  actorUserId: string;
  markdownContent: string;
  imageOverrides: PendingImageOverride[];
  expectedActiveVersionId?: string | null;
}) {
  await ensureDocumentVersionBootstrap(args.documentId);

  const docRow = await selectDocumentRow(args.documentId);
  if (!docRow) {
    throw new VersionNotFoundError();
  }

  return insertPendingVersion({
    documentId: docRow.id,
    expectedActiveVersionId: args.expectedActiveVersionId ?? null,
    changeType: "edit",
    markdownContent: args.markdownContent,
    resolvedTitle: docRow.name,
    resolvedDescription: docRow.description ?? null,
    metadata: {
      ...((docRow.metadata ?? {}) as Record<string, unknown>),
      contextImageOverrides: args.imageOverrides,
    },
    metadataEmbedding: null,
    embeddingProvider: docRow.embeddingProvider,
    embeddingModel: docRow.embeddingModel,
    chunkCount: 0,
    tokenCount: 0,
    embeddingTokenCount: 0,
    sourceVersionId: docRow.activeVersionId ?? null,
    createdByUserId: args.actorUserId,
  });
}

export async function createRollbackVersion(args: {
  documentId: string;
  actorUserId: string;
  rollbackFromVersionId: string;
  expectedActiveVersionId?: string | null;
}) {
  await ensureDocumentVersionBootstrap(args.documentId);

  const docRow = await selectDocumentRow(args.documentId);
  if (!docRow) {
    throw new VersionNotFoundError();
  }

  const sourceVersion = await selectVersionRow(args.rollbackFromVersionId);
  if (!sourceVersion || sourceVersion.documentId !== args.documentId) {
    throw new VersionNotFoundError();
  }

  const parsedSourceVersion = mapDocumentVersion(sourceVersion);
  ensureModelMatch(parsedSourceVersion, {
    embeddingProvider: docRow.embeddingProvider,
    embeddingModel: docRow.embeddingModel,
  });

  return insertPendingVersion({
    documentId: docRow.id,
    expectedActiveVersionId: args.expectedActiveVersionId ?? null,
    changeType: "rollback",
    markdownContent: parsedSourceVersion.markdownContent ?? null,
    resolvedTitle: parsedSourceVersion.resolvedTitle,
    resolvedDescription: parsedSourceVersion.resolvedDescription ?? null,
    metadata: parsedSourceVersion.metadata ?? null,
    metadataEmbedding: parsedSourceVersion.metadataEmbedding ?? null,
    embeddingProvider: parsedSourceVersion.embeddingProvider,
    embeddingModel: parsedSourceVersion.embeddingModel,
    chunkCount: parsedSourceVersion.chunkCount,
    tokenCount: parsedSourceVersion.tokenCount,
    embeddingTokenCount: parsedSourceVersion.embeddingTokenCount,
    sourceVersionId: parsedSourceVersion.id,
    createdByUserId: args.actorUserId,
  });
}

export async function completeSourceDocumentVersion(args: {
  versionId: string;
  doc: KnowledgeDocument;
  group: KnowledgeGroup;
  materialized: Awaited<ReturnType<typeof materializeDocumentMarkdown>>;
}) {
  const version = await selectVersionRow(args.versionId);
  if (!version) throw new VersionNotFoundError();

  await finalizeMaterializedVersion({
    versionId: version.id,
    versionNumber: version.versionNumber,
    sourceVersionId: version.sourceVersionId ?? null,
    expectedActiveVersionId:
      version.changeType === "initial_ingest"
        ? undefined
        : (version.sourceVersionId ?? null),
    eventType: version.changeType === "reingest" ? "reingest" : "created",
    actorUserId: version.createdByUserId ?? args.doc.userId,
    doc: args.doc,
    group: args.group,
    markdown: args.materialized.markdown,
    resolvedTitle: args.materialized.resolvedTitle,
    resolvedDescription: args.materialized.resolvedDescription,
    metadata: args.materialized.metadata,
    metadataEmbedding: args.materialized.metadataEmbedding ?? null,
    sections: args.materialized.sections.map((section) => ({
      id: section.id,
      parentSectionId: section.parentSectionId ?? null,
      prevSectionId: section.prevSectionId ?? null,
      nextSectionId: section.nextSectionId ?? null,
      heading: section.heading,
      headingPath: section.headingPath,
      level: section.level,
      partIndex: section.partIndex,
      partCount: section.partCount,
      content: section.content,
      summary: section.summary,
      tokenCount: section.tokenCount,
      embedding: section.embedding ?? null,
      sourcePath: section.sourcePath ?? null,
      libraryId: section.libraryId ?? null,
      libraryVersion: section.libraryVersion ?? null,
      includeHeadingInChunkContent:
        section.includeHeadingInChunkContent ?? false,
    })),
    chunks: args.materialized.chunks,
    images: args.materialized.images,
    totalTokens: args.materialized.totalTokens,
    embeddingTokenCount: args.materialized.embeddingTokenCount,
  });
}

export async function runMarkdownEditVersion(args: {
  versionId: string;
  expectedActiveVersionId?: string | null;
}) {
  const version = await selectVersionRow(args.versionId);
  if (!version) {
    throw new VersionNotFoundError();
  }
  const doc = await knowledgeRepository.selectDocumentById(version.documentId);
  if (!doc) {
    throw new VersionNotFoundError();
  }
  const group = await knowledgeRepository.selectGroupById(
    version.groupId,
    doc.userId,
  );
  if (!group) {
    throw new VersionNotFoundError();
  }

  const pendingOverrides = readPendingImageOverrides(
    (version.metadata as Record<string, unknown> | null) ?? null,
  );
  const sourceImages = version.sourceVersionId
    ? await selectVersionImages(version.sourceVersionId)
    : await selectLiveImages(doc.id);
  const images = applyImageOverrides(
    sourceImages.map((image) => ({
      ...image,
      versionId: null,
    })),
    pendingOverrides,
  );

  const materialized = await materializeDocumentMarkdown({
    documentId: doc.id,
    groupId: group.id,
    documentTitle: doc.name,
    doc,
    group,
    markdown: version.markdownContent ?? "",
    images: toProcessedDocumentImages(images),
  });

  await finalizeMaterializedVersion({
    versionId: version.id,
    versionNumber: version.versionNumber,
    sourceVersionId: version.sourceVersionId ?? null,
    expectedActiveVersionId: args.expectedActiveVersionId ?? null,
    eventType: "edited",
    actorUserId: version.createdByUserId ?? doc.userId,
    doc,
    group,
    markdown: materialized.markdown,
    resolvedTitle: materialized.resolvedTitle,
    resolvedDescription: materialized.resolvedDescription,
    metadata: materialized.metadata,
    metadataEmbedding: materialized.metadataEmbedding ?? null,
    sections: materialized.sections.map((section) => ({
      id: section.id,
      parentSectionId: section.parentSectionId ?? null,
      prevSectionId: section.prevSectionId ?? null,
      nextSectionId: section.nextSectionId ?? null,
      heading: section.heading,
      headingPath: section.headingPath,
      level: section.level,
      partIndex: section.partIndex,
      partCount: section.partCount,
      content: section.content,
      summary: section.summary,
      tokenCount: section.tokenCount,
      embedding: section.embedding ?? null,
      sourcePath: section.sourcePath ?? null,
      libraryId: section.libraryId ?? null,
      libraryVersion: section.libraryVersion ?? null,
      includeHeadingInChunkContent:
        section.includeHeadingInChunkContent ?? false,
    })),
    chunks: materialized.chunks,
    images: materialized.images,
    totalTokens: materialized.totalTokens,
    embeddingTokenCount: materialized.embeddingTokenCount,
  });
}

export async function runRollbackVersion(args: {
  versionId: string;
  expectedActiveVersionId?: string | null;
}) {
  const version = await selectVersionRow(args.versionId);
  if (!version) {
    throw new VersionNotFoundError();
  }

  const sourceVersionId = version.sourceVersionId;
  if (!sourceVersionId) {
    throw new VersionNotFoundError();
  }

  const sourceVersion = await selectVersionRow(sourceVersionId);
  if (!sourceVersion) {
    throw new VersionNotFoundError();
  }

  const doc = await knowledgeRepository.selectDocumentById(version.documentId);
  if (!doc) {
    throw new VersionNotFoundError();
  }
  const group = await knowledgeRepository.selectGroupById(
    version.groupId,
    doc.userId,
  );
  if (!group) {
    throw new VersionNotFoundError();
  }

  ensureModelMatch(mapDocumentVersion(sourceVersion), group);

  const sourceSections = await selectVersionSections(sourceVersionId);
  const sourceChunks = await selectVersionChunks(sourceVersionId);
  const sourceImages = await selectVersionImages(sourceVersionId);
  const sectionIdMap = new Map<string, string>();
  const duplicatedSections = sourceSections.map((section) => {
    const newId = generateUUID();
    sectionIdMap.set(section.id, newId);
    return {
      ...section,
      id: newId,
    };
  });

  const remappedSections = duplicatedSections.map((section, index) => {
    const source = sourceSections[index];
    return {
      ...section,
      parentSectionId: source.parentSectionId
        ? (sectionIdMap.get(source.parentSectionId) ?? null)
        : null,
      prevSectionId: source.prevSectionId
        ? (sectionIdMap.get(source.prevSectionId) ?? null)
        : null,
      nextSectionId: source.nextSectionId
        ? (sectionIdMap.get(source.nextSectionId) ?? null)
        : null,
    };
  });

  const duplicatedChunks = sourceChunks.map((chunk) => ({
    ...chunk,
    id: generateUUID(),
    sectionId: chunk.sectionId
      ? (sectionIdMap.get(chunk.sectionId) ?? null)
      : null,
    embedding: chunk.embedding ?? null,
  }));
  const duplicatedImages = sourceImages.map((image) => ({
    ...image,
    id: generateUUID(),
    versionId: null,
    embedding: image.embedding ?? null,
  }));

  await finalizeMaterializedVersion({
    versionId: version.id,
    versionNumber: version.versionNumber,
    sourceVersionId,
    expectedActiveVersionId: args.expectedActiveVersionId ?? null,
    eventType: "rollback",
    actorUserId: version.createdByUserId ?? doc.userId,
    doc,
    group,
    markdown: sourceVersion.markdownContent ?? "",
    resolvedTitle: sourceVersion.resolvedTitle,
    resolvedDescription: sourceVersion.resolvedDescription ?? null,
    metadata: (sourceVersion.metadata as Record<string, unknown>) ?? null,
    metadataEmbedding: parsePgVectorLiteral(
      sourceVersion.metadataEmbeddingText ?? null,
    ),
    sections: remappedSections,
    chunks: duplicatedChunks,
    images: duplicatedImages,
    totalTokens: sourceVersion.tokenCount ?? 0,
    embeddingTokenCount: sourceVersion.embeddingTokenCount ?? 0,
  });
}

export async function markDocumentVersionFailed(args: {
  versionId: string;
  errorMessage: string;
  updateDocumentStatus?: boolean;
}) {
  const version = await selectVersionRow(args.versionId);
  if (!version) {
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(KnowledgeDocumentVersionTable)
      .set({
        status: "failed",
        errorMessage: args.errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(KnowledgeDocumentVersionTable.id, args.versionId));

    if (args.updateDocumentStatus) {
      const [currentDoc] = await tx
        .select({
          activeVersionId: KnowledgeDocumentTable.activeVersionId,
        })
        .from(KnowledgeDocumentTable)
        .where(eq(KnowledgeDocumentTable.id, version.documentId));
      const outcome = resolveKnowledgeDocumentFailureOutcome({
        activeVersionId: currentDoc?.activeVersionId ?? null,
        errorMessage: args.errorMessage,
      });

      await tx
        .update(KnowledgeDocumentTable)
        .set({
          status: outcome.status,
          errorMessage: outcome.errorMessage,
          processingProgress: null,
          metadata: clearDocumentProcessingMetadata(),
          updatedAt: new Date(),
        })
        .where(eq(KnowledgeDocumentTable.id, version.documentId));
    }

    await insertHistoryEvent(tx, {
      documentId: version.documentId,
      groupId: version.groupId,
      userId: version.userId,
      actorUserId: version.createdByUserId ?? version.userId,
      eventType: "failed",
      fromVersionId: version.sourceVersionId ?? null,
      toVersionId: version.id,
      details: {
        errorMessage: args.errorMessage,
      },
    });
  });
}

export async function reconcileDocumentIngestFailure(args: {
  documentId: string;
  errorMessage: string;
}) {
  const document = await knowledgeRepository.selectDocumentById(
    args.documentId,
  );
  if (!document) {
    return;
  }

  const outcome = resolveKnowledgeDocumentFailureOutcome({
    activeVersionId: document.activeVersionId ?? null,
    errorMessage: args.errorMessage,
  });

  await knowledgeRepository.updateDocumentProcessing(args.documentId, {
    status: outcome.status,
    errorMessage: outcome.errorMessage,
    processingProgress: null,
    processingState: null,
  });
}

export async function cancelDocumentVersionProcessing(args: {
  documentId: string;
  errorMessage: string;
}) {
  const [document, version] = await Promise.all([
    knowledgeRepository.selectDocumentById(args.documentId),
    selectLatestProcessingVersionRow(args.documentId),
  ]);
  if (!document || !version) {
    return null;
  }

  const outcome = resolveKnowledgeDocumentFailureOutcome({
    activeVersionId: document.activeVersionId ?? null,
    errorMessage: args.errorMessage,
  });

  await db.transaction(async (tx) => {
    await tx
      .update(KnowledgeDocumentVersionTable)
      .set({
        status: "failed",
        errorMessage: args.errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(KnowledgeDocumentVersionTable.id, version.id));

    await tx
      .update(KnowledgeDocumentTable)
      .set({
        status: outcome.status,
        errorMessage: outcome.errorMessage,
        processingProgress: null,
        metadata: clearDocumentProcessingMetadata(),
        updatedAt: new Date(),
      })
      .where(eq(KnowledgeDocumentTable.id, args.documentId));

    await insertHistoryEvent(tx, {
      documentId: version.documentId,
      groupId: version.groupId,
      userId: version.userId,
      actorUserId: version.createdByUserId ?? version.userId,
      eventType: "failed",
      fromVersionId: version.sourceVersionId ?? null,
      toVersionId: version.id,
      details: {
        errorMessage: args.errorMessage,
        canceled: true,
      },
    });
  });

  return knowledgeRepository.selectDocumentById(args.documentId);
}

export function isKnowledgeVersionConflictError(error: unknown) {
  return error instanceof VersionConflictError;
}

export function isKnowledgeRollbackModelMismatchError(error: unknown) {
  return error instanceof RollbackModelMismatchError;
}

export { ROLLBACK_MODEL_MISMATCH_REASON };
