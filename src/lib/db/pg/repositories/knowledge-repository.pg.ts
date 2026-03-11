import {
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeDocumentImage,
  KnowledgeDocumentImageVersion,
  KnowledgeDocumentProcessingState,
  KnowledgeGroup,
  KnowledgeGroupSource,
  KnowledgeRepository,
  KnowledgeSection,
  KnowledgeSummary,
  KnowledgeUsageStats,
  UsageSource,
  PaginatedKnowledgeDocuments,
} from "app-types/knowledge";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { sanitizeImageStepHint } from "lib/knowledge/document-images";
import { applyEnforcedKnowledgeIngestPolicy } from "lib/knowledge/quality-ingest-policy";
import { generateUUID } from "lib/utils";
import { pgDb as db } from "../db.pg";
import {
  KnowledgeChunkTable,
  KnowledgeDocumentTable,
  KnowledgeDocumentImageTable,
  KnowledgeDocumentImageVersionTable,
  KnowledgeGroupAgentTable,
  KnowledgeGroupSourceTable,
  KnowledgeSectionTable,
  KnowledgeGroupTable,
  KnowledgeUsageLogTable,
  UserTable,
} from "../schema.pg";

function mapGroup(
  row: typeof KnowledgeGroupTable.$inferSelect,
): KnowledgeGroup {
  return applyEnforcedKnowledgeIngestPolicy({
    ...row,
    description: row.description ?? undefined,
    icon: row.icon ?? undefined,
    rerankingModel: row.rerankingModel ?? null,
    rerankingProvider: row.rerankingProvider ?? null,
    parseMode: row.parseMode ?? "always",
    parseRepairPolicy: row.parseRepairPolicy ?? "section-safe-reorder",
    contextMode: row.contextMode ?? "always-llm",
    imageMode: row.imageMode ?? "always",
    lazyRefinementEnabled: row.lazyRefinementEnabled ?? true,
    parsingModel: row.parsingModel ?? null,
    parsingProvider: row.parsingProvider ?? null,
    retrievalThreshold: row.retrievalThreshold ?? 0.0,
    mcpApiKeyHash: row.mcpApiKeyHash ?? null,
    mcpApiKeyPreview: row.mcpApiKeyPreview ?? null,
  });
}

function mapDocument(
  row: typeof KnowledgeDocumentTable.$inferSelect,
): KnowledgeDocument {
  const metadata = (row.metadata as Record<string, unknown>) ?? null;
  return {
    ...row,
    description: row.description ?? null,
    descriptionManual: row.descriptionManual ?? false,
    titleManual: row.titleManual ?? false,
    fileSize: row.fileSize ?? null,
    storagePath: row.storagePath ?? null,
    sourceUrl: row.sourceUrl ?? null,
    fingerprint: row.fingerprint ?? null,
    errorMessage: row.errorMessage ?? null,
    processingProgress: row.processingProgress ?? null,
    processingState: readDocumentProcessingState(metadata),
    embeddingTokenCount: row.embeddingTokenCount ?? 0,
    metadata,
    markdownContent: row.markdownContent ?? null,
    activeVersionId: row.activeVersionId ?? null,
    latestVersionNumber: row.latestVersionNumber ?? 0,
  };
}

function readDocumentProcessingState(
  metadata: Record<string, unknown> | null | undefined,
): KnowledgeDocumentProcessingState | null {
  const raw = metadata?.processingState;
  if (!raw || typeof raw !== "object") return null;
  const stage = "stage" in raw ? raw.stage : null;
  if (
    stage !== "extracting" &&
    stage !== "parsing" &&
    stage !== "materializing" &&
    stage !== "embedding" &&
    stage !== "finalizing"
  ) {
    return null;
  }

  const readNullableNumber = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  return {
    stage,
    currentPage: readNullableNumber(
      "currentPage" in raw ? raw.currentPage : null,
    ),
    totalPages: readNullableNumber("totalPages" in raw ? raw.totalPages : null),
    pageNumber: readNullableNumber("pageNumber" in raw ? raw.pageNumber : null),
  };
}

function buildProcessingMetadataUpdate(
  processingState: KnowledgeDocumentProcessingState | null | undefined,
  options: { clearWhenUndefined?: boolean } = {},
) {
  if (processingState !== undefined) {
    return processingState
      ? sql`(
          COALESCE(${KnowledgeDocumentTable.metadata}::jsonb, '{}'::jsonb) ||
          jsonb_build_object('processingState', ${JSON.stringify(processingState)}::jsonb)
        )::json`
      : sql`(
          COALESCE(${KnowledgeDocumentTable.metadata}::jsonb, '{}'::jsonb) - 'processingState'
        )::json`;
  }

  if (options.clearWhenUndefined) {
    return sql`(
      COALESCE(${KnowledgeDocumentTable.metadata}::jsonb, '{}'::jsonb) - 'processingState'
    )::json`;
  }

  return undefined;
}

type DocumentImageRow = Pick<
  KnowledgeDocumentImage,
  | "id"
  | "documentId"
  | "groupId"
  | "versionId"
  | "kind"
  | "ordinal"
  | "marker"
  | "label"
  | "description"
  | "headingPath"
  | "stepHint"
  | "sourceUrl"
  | "storagePath"
  | "mediaType"
  | "pageNumber"
  | "width"
  | "height"
  | "altText"
  | "caption"
  | "surroundingText"
  | "precedingText"
  | "followingText"
  | "isRenderable"
  | "manualLabel"
  | "manualDescription"
  | "createdAt"
  | "updatedAt"
>;

const knowledgeDocumentImageSelection = {
  id: KnowledgeDocumentImageTable.id,
  documentId: KnowledgeDocumentImageTable.documentId,
  groupId: KnowledgeDocumentImageTable.groupId,
  versionId: KnowledgeDocumentImageTable.versionId,
  kind: KnowledgeDocumentImageTable.kind,
  ordinal: KnowledgeDocumentImageTable.ordinal,
  marker: KnowledgeDocumentImageTable.marker,
  label: KnowledgeDocumentImageTable.label,
  description: KnowledgeDocumentImageTable.description,
  headingPath: KnowledgeDocumentImageTable.headingPath,
  stepHint: KnowledgeDocumentImageTable.stepHint,
  sourceUrl: KnowledgeDocumentImageTable.sourceUrl,
  storagePath: KnowledgeDocumentImageTable.storagePath,
  mediaType: KnowledgeDocumentImageTable.mediaType,
  pageNumber: KnowledgeDocumentImageTable.pageNumber,
  width: KnowledgeDocumentImageTable.width,
  height: KnowledgeDocumentImageTable.height,
  altText: KnowledgeDocumentImageTable.altText,
  caption: KnowledgeDocumentImageTable.caption,
  surroundingText: KnowledgeDocumentImageTable.surroundingText,
  precedingText: KnowledgeDocumentImageTable.precedingText,
  followingText: KnowledgeDocumentImageTable.followingText,
  isRenderable: KnowledgeDocumentImageTable.isRenderable,
  manualLabel: KnowledgeDocumentImageTable.manualLabel,
  manualDescription: KnowledgeDocumentImageTable.manualDescription,
  createdAt: KnowledgeDocumentImageTable.createdAt,
  updatedAt: KnowledgeDocumentImageTable.updatedAt,
};

const knowledgeDocumentImageVersionSelection = {
  id: KnowledgeDocumentImageVersionTable.id,
  documentId: KnowledgeDocumentImageVersionTable.documentId,
  groupId: KnowledgeDocumentImageVersionTable.groupId,
  versionId: KnowledgeDocumentImageVersionTable.versionId,
  kind: KnowledgeDocumentImageVersionTable.kind,
  ordinal: KnowledgeDocumentImageVersionTable.ordinal,
  marker: KnowledgeDocumentImageVersionTable.marker,
  label: KnowledgeDocumentImageVersionTable.label,
  description: KnowledgeDocumentImageVersionTable.description,
  headingPath: KnowledgeDocumentImageVersionTable.headingPath,
  stepHint: KnowledgeDocumentImageVersionTable.stepHint,
  sourceUrl: KnowledgeDocumentImageVersionTable.sourceUrl,
  storagePath: KnowledgeDocumentImageVersionTable.storagePath,
  mediaType: KnowledgeDocumentImageVersionTable.mediaType,
  pageNumber: KnowledgeDocumentImageVersionTable.pageNumber,
  width: KnowledgeDocumentImageVersionTable.width,
  height: KnowledgeDocumentImageVersionTable.height,
  altText: KnowledgeDocumentImageVersionTable.altText,
  caption: KnowledgeDocumentImageVersionTable.caption,
  surroundingText: KnowledgeDocumentImageVersionTable.surroundingText,
  precedingText: KnowledgeDocumentImageVersionTable.precedingText,
  followingText: KnowledgeDocumentImageVersionTable.followingText,
  isRenderable: KnowledgeDocumentImageVersionTable.isRenderable,
  manualLabel: KnowledgeDocumentImageVersionTable.manualLabel,
  manualDescription: KnowledgeDocumentImageVersionTable.manualDescription,
  createdAt: KnowledgeDocumentImageVersionTable.createdAt,
  updatedAt: KnowledgeDocumentImageVersionTable.updatedAt,
};

function mapDocumentImage(row: DocumentImageRow): KnowledgeDocumentImage {
  return {
    id: row.id,
    documentId: row.documentId,
    groupId: row.groupId,
    versionId: "versionId" in row ? (row.versionId ?? null) : null,
    kind: row.kind,
    ordinal: row.ordinal,
    marker: row.marker,
    label: row.label,
    description: row.description,
    headingPath: row.headingPath ?? null,
    stepHint: sanitizeImageStepHint(row.stepHint),
    sourceUrl: row.sourceUrl ?? null,
    storagePath: row.storagePath ?? null,
    mediaType: row.mediaType ?? null,
    pageNumber: row.pageNumber ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    altText: row.altText ?? null,
    caption: row.caption ?? null,
    surroundingText: row.surroundingText ?? null,
    precedingText: row.precedingText ?? null,
    followingText: row.followingText ?? null,
    isRenderable: row.isRenderable ?? false,
    manualLabel: row.manualLabel ?? false,
    manualDescription: row.manualDescription ?? false,
    embedding: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapVersionedDocumentImage(
  row: DocumentImageRow & { versionId: string },
): KnowledgeDocumentImageVersion {
  return {
    ...mapDocumentImage(row),
    versionId: row.versionId,
  };
}

function mapSection(
  row: typeof KnowledgeSectionTable.$inferSelect,
): KnowledgeSection {
  return {
    ...row,
    parentSectionId: row.parentSectionId ?? null,
    prevSectionId: row.prevSectionId ?? null,
    nextSectionId: row.nextSectionId ?? null,
    pageStart: row.pageStart ?? null,
    pageEnd: row.pageEnd ?? null,
    noteNumber: row.noteNumber ?? null,
    noteTitle: row.noteTitle ?? null,
    noteSubsection: row.noteSubsection ?? null,
    continued: row.continued ?? false,
    embedding: null,
  };
}

function mapGroupSource(row: {
  groupId: string;
  sourceGroupId: string;
  sourceGroupName: string;
  sourceGroupDescription: string | null;
  sourceGroupVisibility: "public" | "private" | "readonly";
  sourceGroupUserId: string;
  sourceGroupUserName: string | null;
  createdAt: Date;
}): KnowledgeGroupSource {
  return {
    groupId: row.groupId,
    sourceGroupId: row.sourceGroupId,
    sourceGroupName: row.sourceGroupName,
    sourceGroupDescription: row.sourceGroupDescription ?? undefined,
    sourceGroupVisibility: row.sourceGroupVisibility,
    sourceGroupUserId: row.sourceGroupUserId,
    sourceGroupUserName: row.sourceGroupUserName ?? undefined,
    createdAt: row.createdAt,
  };
}

function toPgVectorLiteral(embedding: number[] | null): string | null {
  if (embedding === null) return null;
  if (embedding.length === 0) return null;
  // Defensive cleanup for provider anomalies (NaN/Infinity) without changing
  // vector dimensionality.
  const safe = embedding.map((n) => (Number.isFinite(n) ? n : 0));
  return `[${safe.join(",")}]`;
}

function buildTypedVectorComparison(column: string, embedding: number[]) {
  const dimension = embedding.length;
  const embeddingLiteral = toPgVectorLiteral(embedding);
  if (!embeddingLiteral) {
    throw new Error("Embedding vector is empty.");
  }
  const typedColumn = sql.raw(`${column}::vector(${dimension})`);
  const typedEmbedding = sql`${embeddingLiteral}::vector(${sql.raw(String(dimension))})`;

  return {
    typedColumn,
    typedEmbedding,
    dimensionFilter: sql`vector_dims(${sql.raw(column)}) = ${dimension}`,
  };
}

function buildUuidFilterSql(columnName: string, ids?: string[]) {
  if (!ids || ids.length === 0) {
    return sql``;
  }

  return sql`AND ${sql.raw(columnName)} IN (${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}

export const pgKnowledgeRepository: KnowledgeRepository = {
  // ─── Groups ─────────────────────────────────────────────────────────────────

  async insertGroup(data) {
    const enforcedPolicy = applyEnforcedKnowledgeIngestPolicy({});
    const [row] = await db
      .insert(KnowledgeGroupTable)
      .values({
        id: generateUUID(),
        name: data.name,
        description: data.description,
        icon: data.icon,
        userId: data.userId,
        visibility: data.visibility ?? "private",
        purpose: data.purpose ?? "default",
        isSystemManaged: data.isSystemManaged ?? false,
        embeddingModel: data.embeddingModel ?? "text-embedding-3-small",
        embeddingProvider: data.embeddingProvider ?? "openai",
        rerankingModel: data.rerankingModel ?? null,
        rerankingProvider: data.rerankingProvider ?? null,
        parseMode: enforcedPolicy.parseMode,
        parseRepairPolicy: enforcedPolicy.parseRepairPolicy,
        contextMode: enforcedPolicy.contextMode,
        imageMode: enforcedPolicy.imageMode,
        lazyRefinementEnabled: true,
        mcpEnabled: false,
        chunkSize: data.chunkSize ?? 768,
        chunkOverlapPercent: data.chunkOverlapPercent ?? 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return mapGroup(row);
  },

  async selectGroupById(id, userId) {
    const [row] = await db
      .select()
      .from(KnowledgeGroupTable)
      .where(
        and(
          eq(KnowledgeGroupTable.id, id),
          or(
            eq(KnowledgeGroupTable.userId, userId),
            eq(KnowledgeGroupTable.visibility, "public"),
            eq(KnowledgeGroupTable.visibility, "readonly"),
          ),
        ),
      );
    if (!row) return null;
    return mapGroup(row);
  },

  async selectGroupByIdForMcp(id) {
    const [row] = await db
      .select()
      .from(KnowledgeGroupTable)
      .where(eq(KnowledgeGroupTable.id, id));
    if (!row) return null;
    return mapGroup(row);
  },

  async selectGroups(userId, filters = ["mine", "shared"]) {
    let whereCondition: any;
    const visiblePurposeCondition = eq(KnowledgeGroupTable.purpose, "default");

    if (filters.includes("mine") && filters.includes("shared")) {
      whereCondition = and(
        visiblePurposeCondition,
        or(
          eq(KnowledgeGroupTable.userId, userId),
          and(
            ne(KnowledgeGroupTable.userId, userId),
            or(
              eq(KnowledgeGroupTable.visibility, "public"),
              eq(KnowledgeGroupTable.visibility, "readonly"),
            ),
          ),
        ),
      );
    } else if (filters.includes("mine")) {
      whereCondition = and(
        visiblePurposeCondition,
        eq(KnowledgeGroupTable.userId, userId),
      );
    } else {
      whereCondition = and(
        visiblePurposeCondition,
        ne(KnowledgeGroupTable.userId, userId),
        or(
          eq(KnowledgeGroupTable.visibility, "public"),
          eq(KnowledgeGroupTable.visibility, "readonly"),
        ),
      );
    }

    const docCounts = db
      .select({
        groupId: KnowledgeDocumentTable.groupId,
        docCount: count(KnowledgeDocumentTable.id).as("doc_count"),
      })
      .from(KnowledgeDocumentTable)
      .groupBy(KnowledgeDocumentTable.groupId)
      .as("doc_counts");

    const chunkCounts = db
      .select({
        groupId: KnowledgeChunkTable.groupId,
        chunkCount: count(KnowledgeChunkTable.id).as("chunk_count"),
      })
      .from(KnowledgeChunkTable)
      .groupBy(KnowledgeChunkTable.groupId)
      .as("chunk_counts");

    const rows = await db
      .select({
        id: KnowledgeGroupTable.id,
        name: KnowledgeGroupTable.name,
        description: KnowledgeGroupTable.description,
        icon: KnowledgeGroupTable.icon,
        userId: KnowledgeGroupTable.userId,
        visibility: KnowledgeGroupTable.visibility,
        purpose: KnowledgeGroupTable.purpose,
        isSystemManaged: KnowledgeGroupTable.isSystemManaged,
        embeddingModel: KnowledgeGroupTable.embeddingModel,
        embeddingProvider: KnowledgeGroupTable.embeddingProvider,
        rerankingModel: KnowledgeGroupTable.rerankingModel,
        rerankingProvider: KnowledgeGroupTable.rerankingProvider,
        parseMode: KnowledgeGroupTable.parseMode,
        parseRepairPolicy: KnowledgeGroupTable.parseRepairPolicy,
        contextMode: KnowledgeGroupTable.contextMode,
        imageMode: KnowledgeGroupTable.imageMode,
        lazyRefinementEnabled: KnowledgeGroupTable.lazyRefinementEnabled,
        parsingModel: KnowledgeGroupTable.parsingModel,
        parsingProvider: KnowledgeGroupTable.parsingProvider,
        retrievalThreshold: KnowledgeGroupTable.retrievalThreshold,
        mcpEnabled: KnowledgeGroupTable.mcpEnabled,
        chunkSize: KnowledgeGroupTable.chunkSize,
        chunkOverlapPercent: KnowledgeGroupTable.chunkOverlapPercent,
        createdAt: KnowledgeGroupTable.createdAt,
        updatedAt: KnowledgeGroupTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
        documentCount: sql<number>`COALESCE(${docCounts.docCount}, 0)`,
        chunkCount: sql<number>`COALESCE(${chunkCounts.chunkCount}, 0)`,
      })
      .from(KnowledgeGroupTable)
      .innerJoin(UserTable, eq(KnowledgeGroupTable.userId, UserTable.id))
      .leftJoin(docCounts, eq(KnowledgeGroupTable.id, docCounts.groupId))
      .leftJoin(chunkCounts, eq(KnowledgeGroupTable.id, chunkCounts.groupId))
      .where(whereCondition)
      .orderBy(
        sql`CASE WHEN ${KnowledgeGroupTable.userId} = ${userId} THEN 0 ELSE 1 END`,
        desc(KnowledgeGroupTable.createdAt),
      );

    return rows
      .map((r) => ({
        ...r,
        description: r.description ?? undefined,
        icon: r.icon ?? undefined,
        purpose: r.purpose,
        isSystemManaged: r.isSystemManaged,
        rerankingModel: r.rerankingModel ?? null,
        rerankingProvider: r.rerankingProvider ?? null,
        parseMode: r.parseMode ?? "always",
        parseRepairPolicy: r.parseRepairPolicy ?? "section-safe-reorder",
        contextMode: r.contextMode ?? "always-llm",
        imageMode: r.imageMode ?? "always",
        lazyRefinementEnabled: r.lazyRefinementEnabled ?? true,
        parsingModel: r.parsingModel ?? null,
        parsingProvider: r.parsingProvider ?? null,
        retrievalThreshold: r.retrievalThreshold ?? 0.0,
        userName: r.userName ?? undefined,
        userAvatar: r.userAvatar ?? null,
        documentCount: Number(r.documentCount),
        chunkCount: Number(r.chunkCount),
      }))
      .map((row) =>
        applyEnforcedKnowledgeIngestPolicy(row),
      ) as KnowledgeSummary[];
  },

  async updateGroup(id, userId, data) {
    const { sourceGroupIds: _ignored, ...groupData } = data as any;
    const enforced = applyEnforcedKnowledgeIngestPolicy(groupData);
    const [row] = await db
      .update(KnowledgeGroupTable)
      .set({ ...enforced, updatedAt: new Date() })
      .where(
        and(
          eq(KnowledgeGroupTable.id, id),
          eq(KnowledgeGroupTable.userId, userId),
        ),
      )
      .returning();

    if (data.visibility === "private") {
      await db.execute(
        sql`
          DELETE FROM knowledge_group_source rel
          USING knowledge_group parent
          WHERE rel.source_group_id = ${id}
            AND rel.group_id = parent.id
            AND parent.user_id <> ${userId}::uuid
        `,
      );
    }

    return mapGroup(row);
  },

  async deleteGroup(id, userId) {
    await db
      .delete(KnowledgeGroupTable)
      .where(
        and(
          eq(KnowledgeGroupTable.id, id),
          eq(KnowledgeGroupTable.userId, userId),
        ),
      );
  },

  async setGroupSources(groupId, userId, sourceGroupIds) {
    const [parent] = await db
      .select({ id: KnowledgeGroupTable.id })
      .from(KnowledgeGroupTable)
      .where(
        and(
          eq(KnowledgeGroupTable.id, groupId),
          eq(KnowledgeGroupTable.userId, userId),
        ),
      );
    if (!parent) {
      throw new Error("Not found or unauthorized");
    }

    const uniqueSourceIds = Array.from(
      new Set(
        sourceGroupIds
          .filter(Boolean)
          .map((id) => id.trim())
          .filter((id) => id.length > 0 && id !== groupId),
      ),
    );

    const allowedSourceIds =
      uniqueSourceIds.length > 0
        ? (
            await db
              .select({ id: KnowledgeGroupTable.id })
              .from(KnowledgeGroupTable)
              .where(
                and(
                  inArray(KnowledgeGroupTable.id, uniqueSourceIds),
                  ne(KnowledgeGroupTable.id, groupId),
                  or(
                    eq(KnowledgeGroupTable.userId, userId),
                    eq(KnowledgeGroupTable.visibility, "public"),
                    eq(KnowledgeGroupTable.visibility, "readonly"),
                  ),
                ),
              )
          ).map((r) => r.id)
        : [];

    await db.transaction(async (tx) => {
      const existing = await tx
        .select({
          sourceGroupId: KnowledgeGroupSourceTable.sourceGroupId,
        })
        .from(KnowledgeGroupSourceTable)
        .where(eq(KnowledgeGroupSourceTable.groupId, groupId));

      const existingIds = new Set(existing.map((r) => r.sourceGroupId));
      const allowedSet = new Set(allowedSourceIds);

      const toDelete = existing
        .map((r) => r.sourceGroupId)
        .filter((id) => !allowedSet.has(id));
      if (toDelete.length > 0) {
        await tx
          .delete(KnowledgeGroupSourceTable)
          .where(
            and(
              eq(KnowledgeGroupSourceTable.groupId, groupId),
              inArray(KnowledgeGroupSourceTable.sourceGroupId, toDelete),
            ),
          );
      }

      const toInsert = allowedSourceIds.filter((id) => !existingIds.has(id));
      if (toInsert.length > 0) {
        await tx
          .insert(KnowledgeGroupSourceTable)
          .values(
            toInsert.map((sourceGroupId) => ({
              id: generateUUID(),
              groupId,
              sourceGroupId,
              createdAt: new Date(),
            })),
          )
          .onConflictDoNothing();
      }
    });

    await pgKnowledgeRepository.pruneInvalidGroupSources(groupId);
  },

  async selectGroupSources(groupId) {
    await pgKnowledgeRepository.pruneInvalidGroupSources(groupId);

    const rows = await db.execute<{
      group_id: string;
      source_group_id: string;
      source_group_name: string;
      source_group_description: string | null;
      source_group_visibility: "public" | "private" | "readonly";
      source_group_user_id: string;
      source_group_user_name: string | null;
      created_at: Date;
    }>(
      sql`
        SELECT
          rel.group_id,
          src.id AS source_group_id,
          src.name AS source_group_name,
          src.description AS source_group_description,
          src.visibility AS source_group_visibility,
          src.user_id AS source_group_user_id,
          u.name AS source_group_user_name,
          rel.created_at
        FROM knowledge_group_source rel
        JOIN knowledge_group parent ON parent.id = rel.group_id
        JOIN knowledge_group src ON src.id = rel.source_group_id
        LEFT JOIN "user" u ON u.id = src.user_id
        WHERE rel.group_id = ${groupId}
          AND rel.group_id <> rel.source_group_id
          AND (
            src.user_id = parent.user_id
            OR src.visibility IN ('public', 'readonly')
          )
        ORDER BY rel.created_at ASC
      `,
    );

    return rows.rows.map((r) =>
      mapGroupSource({
        groupId: r.group_id,
        sourceGroupId: r.source_group_id,
        sourceGroupName: r.source_group_name,
        sourceGroupDescription: r.source_group_description,
        sourceGroupVisibility: r.source_group_visibility,
        sourceGroupUserId: r.source_group_user_id,
        sourceGroupUserName: r.source_group_user_name,
        createdAt: r.created_at,
      }),
    );
  },

  async selectRetrievalScopes(groupId) {
    const [groupRow] = await db
      .select()
      .from(KnowledgeGroupTable)
      .where(eq(KnowledgeGroupTable.id, groupId));
    if (!groupRow) return [];

    const sources = await pgKnowledgeRepository.selectGroupSources(groupId);
    if (sources.length === 0) return [mapGroup(groupRow)];

    const sourceIds = sources.map((s) => s.sourceGroupId);
    const sourceRows = await db
      .select()
      .from(KnowledgeGroupTable)
      .where(inArray(KnowledgeGroupTable.id, sourceIds));

    return [mapGroup(groupRow), ...sourceRows.map(mapGroup)];
  },

  async pruneInvalidGroupSources(groupId) {
    await db.execute(
      sql`
        DELETE FROM knowledge_group_source rel
        USING knowledge_group parent, knowledge_group src
        WHERE rel.group_id = ${groupId}
          AND rel.group_id = parent.id
          AND rel.source_group_id = src.id
          AND (
            rel.group_id = rel.source_group_id
            OR (
              src.user_id <> parent.user_id
              AND src.visibility = 'private'
            )
          )
      `,
    );
  },

  async setMcpApiKey(id, userId, keyHash, keyPreview) {
    await db
      .update(KnowledgeGroupTable)
      .set({
        mcpApiKeyHash: keyHash,
        mcpApiKeyPreview: keyPreview,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(KnowledgeGroupTable.id, id),
          eq(KnowledgeGroupTable.userId, userId),
        ),
      );
  },

  async setMcpEnabled(id, userId, enabled) {
    await db
      .update(KnowledgeGroupTable)
      .set({ mcpEnabled: enabled, updatedAt: new Date() })
      .where(
        and(
          eq(KnowledgeGroupTable.id, id),
          eq(KnowledgeGroupTable.userId, userId),
        ),
      );
  },

  async getGroupByMcpKey(groupId) {
    const [row] = await db
      .select({
        id: KnowledgeGroupTable.id,
        mcpApiKeyHash: KnowledgeGroupTable.mcpApiKeyHash,
        mcpEnabled: KnowledgeGroupTable.mcpEnabled,
      })
      .from(KnowledgeGroupTable)
      .where(eq(KnowledgeGroupTable.id, groupId));
    if (!row) return null;
    return {
      id: row.id,
      mcpApiKeyHash: row.mcpApiKeyHash,
      mcpEnabled: row.mcpEnabled,
    };
  },

  // ─── Documents ──────────────────────────────────────────────────────────────

  async insertDocument(data) {
    const [row] = await db
      .insert(KnowledgeDocumentTable)
      .values({
        id: generateUUID(),
        groupId: data.groupId,
        userId: data.userId,
        name: data.name,
        description: data.description ?? null,
        originalFilename: data.originalFilename,
        fileType: data.fileType,
        fileSize: data.fileSize ?? null,
        storagePath: data.storagePath ?? null,
        sourceUrl: data.sourceUrl ?? null,
        fingerprint: data.fingerprint ?? null,
        status: (data as any).status ?? "pending",
        chunkCount: 0,
        tokenCount: 0,
        embeddingTokenCount: 0,
        metadata: data.metadata ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing({
        target: [
          KnowledgeDocumentTable.groupId,
          KnowledgeDocumentTable.fingerprint,
        ],
      })
      .returning();
    if (row) {
      return mapDocument(row);
    }

    if (data.fingerprint) {
      const existing = await pgKnowledgeRepository.selectDocumentByFingerprint(
        data.groupId,
        data.fingerprint,
      );
      if (existing) {
        return existing;
      }
    }

    throw new Error("Failed to insert document");
  },

  async selectDocumentsByGroupId(groupId) {
    const rows = await db
      .select()
      .from(KnowledgeDocumentTable)
      .where(eq(KnowledgeDocumentTable.groupId, groupId))
      .orderBy(desc(KnowledgeDocumentTable.createdAt));
    return rows.map(mapDocument);
  },

  async selectDocumentsByGroupScope(groupId) {
    const page = await pgKnowledgeRepository.selectDocumentsPageByGroupScope(
      groupId,
      {
        limit: 500,
        offset: 0,
      },
    );
    return page.items;
  },

  async selectDocumentsPageByGroupScope(
    groupId,
    input,
  ): Promise<PaginatedKnowledgeDocuments> {
    const sources = await pgKnowledgeRepository.selectGroupSources(groupId);
    const sourceByGroupId = new Map(
      sources.map((source) => [source.sourceGroupId, source]),
    );
    const scopeGroupIds = [groupId, ...sourceByGroupId.keys()];
    const limit = Math.max(1, Math.min(input.limit, 100));
    const offset = Math.max(0, input.offset);

    const rows = await db
      .select()
      .from(KnowledgeDocumentTable)
      .where(inArray(KnowledgeDocumentTable.groupId, scopeGroupIds))
      .orderBy(desc(KnowledgeDocumentTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({
        total: count(KnowledgeDocumentTable.id),
      })
      .from(KnowledgeDocumentTable)
      .where(inArray(KnowledgeDocumentTable.groupId, scopeGroupIds));

    const items = rows.map((row) => {
      const mapped = mapDocument(row);
      if (row.groupId === groupId) {
        return {
          ...mapped,
          isInherited: false,
          sourceGroupId: null,
          sourceGroupName: null,
          sourceGroupVisibility: null,
          sourceGroupUserName: null,
        };
      }

      const source = sourceByGroupId.get(row.groupId);
      return {
        ...mapped,
        isInherited: true,
        sourceGroupId: row.groupId,
        sourceGroupName: source?.sourceGroupName ?? "Unknown source group",
        sourceGroupVisibility: source?.sourceGroupVisibility ?? null,
        sourceGroupUserName: source?.sourceGroupUserName ?? null,
      };
    });

    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    };
  },

  async selectDocumentById(id) {
    const [row] = await db
      .select()
      .from(KnowledgeDocumentTable)
      .where(eq(KnowledgeDocumentTable.id, id));
    if (!row) return null;
    return mapDocument(row);
  },

  async selectDocumentByFingerprint(groupId, fingerprint) {
    const [row] = await db
      .select()
      .from(KnowledgeDocumentTable)
      .where(
        and(
          eq(KnowledgeDocumentTable.groupId, groupId),
          eq(KnowledgeDocumentTable.fingerprint, fingerprint),
        ),
      );
    if (!row) return null;
    return mapDocument(row);
  },

  async selectUrlDocumentBySourceUrl(groupId, sourceUrl) {
    const [row] = await db
      .select()
      .from(KnowledgeDocumentTable)
      .where(
        and(
          eq(KnowledgeDocumentTable.groupId, groupId),
          eq(KnowledgeDocumentTable.fileType, "url"),
          eq(KnowledgeDocumentTable.sourceUrl, sourceUrl),
        ),
      );
    if (!row) return null;
    return mapDocument(row);
  },

  async selectFileDocumentByNameAndSize(input) {
    const [row] = await db
      .select()
      .from(KnowledgeDocumentTable)
      .where(
        and(
          eq(KnowledgeDocumentTable.groupId, input.groupId),
          eq(KnowledgeDocumentTable.fileType, input.fileType),
          eq(KnowledgeDocumentTable.originalFilename, input.originalFilename),
          eq(KnowledgeDocumentTable.fileSize, input.fileSize),
          isNull(KnowledgeDocumentTable.sourceUrl),
        ),
      );
    if (!row) return null;
    return mapDocument(row);
  },

  async updateDocumentStatus(id, status, extra) {
    const metadataUpdate = buildProcessingMetadataUpdate(
      extra?.processingState,
      { clearWhenUndefined: status !== "processing" },
    );

    await db
      .update(KnowledgeDocumentTable)
      .set({
        status,
        errorMessage: extra?.errorMessage ?? null,
        // Reset progress when not processing; update it when provided
        processingProgress:
          status === "processing" ? (extra?.processingProgress ?? 0) : null,
        ...(extra?.chunkCount !== undefined
          ? { chunkCount: extra.chunkCount }
          : {}),
        ...(extra?.tokenCount !== undefined
          ? { tokenCount: extra.tokenCount }
          : {}),
        ...(extra?.embeddingTokenCount !== undefined
          ? { embeddingTokenCount: extra.embeddingTokenCount }
          : {}),
        ...(extra?.markdownContent !== undefined
          ? { markdownContent: extra.markdownContent }
          : {}),
        ...(metadataUpdate !== undefined ? { metadata: metadataUpdate } : {}),
        updatedAt: new Date(),
      })
      .where(eq(KnowledgeDocumentTable.id, id));
  },

  async updateDocumentProcessing(id, data) {
    const metadataUpdate = buildProcessingMetadataUpdate(data.processingState);

    await db
      .update(KnowledgeDocumentTable)
      .set({
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.errorMessage !== undefined
          ? { errorMessage: data.errorMessage }
          : {}),
        ...(data.processingProgress !== undefined
          ? { processingProgress: data.processingProgress }
          : {}),
        ...(metadataUpdate !== undefined ? { metadata: metadataUpdate } : {}),
        updatedAt: new Date(),
      })
      .where(eq(KnowledgeDocumentTable.id, id));
  },

  async updateDocumentMetadata(id, userId, data) {
    const setData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.title !== undefined) {
      setData.name = data.title;
      setData.titleManual = true;
    }
    if (data.description !== undefined) {
      setData.description = data.description;
      setData.descriptionManual = true;
    }
    if (data.metadataEmbedding !== undefined) {
      const embeddingLiteral = toPgVectorLiteral(data.metadataEmbedding);
      setData.metadataEmbedding =
        embeddingLiteral === null ? null : sql`${embeddingLiteral}::vector`;
    }
    if (data.metadata !== undefined) {
      setData.metadata = data.metadata ?? null;
    }

    const [row] = await db
      .update(KnowledgeDocumentTable)
      .set(setData as any)
      .where(
        and(
          eq(KnowledgeDocumentTable.id, id),
          sql`EXISTS (
            SELECT 1
            FROM knowledge_group kg
            WHERE kg.id = ${KnowledgeDocumentTable.groupId}
              AND kg.user_id = ${userId}::uuid
          )`,
        ),
      )
      .returning();

    return row ? mapDocument(row) : null;
  },

  async updateDocumentAutoMetadata(id, data) {
    const setData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.title !== undefined) {
      setData.name = sql`CASE WHEN ${KnowledgeDocumentTable.titleManual} THEN ${KnowledgeDocumentTable.name} ELSE ${data.title} END`;
    }
    if (data.description !== undefined) {
      setData.description = sql`CASE WHEN ${KnowledgeDocumentTable.descriptionManual} THEN ${KnowledgeDocumentTable.description} ELSE ${data.description} END`;
    }
    if (data.metadataEmbedding !== undefined) {
      const embeddingLiteral = toPgVectorLiteral(data.metadataEmbedding);
      const embeddingExpr =
        embeddingLiteral === null
          ? sql`NULL::vector`
          : sql`${embeddingLiteral}::vector`;
      setData.metadataEmbedding = sql`CASE
        WHEN ${KnowledgeDocumentTable.titleManual} AND ${KnowledgeDocumentTable.descriptionManual}
        THEN ${KnowledgeDocumentTable.metadataEmbedding}
        ELSE ${embeddingExpr}
      END`;
    }
    if (data.metadata !== undefined) {
      setData.metadata = data.metadata ?? null;
    }

    await db
      .update(KnowledgeDocumentTable)
      .set(setData as any)
      .where(eq(KnowledgeDocumentTable.id, id));
  },

  async deleteDocument(id) {
    await db
      .delete(KnowledgeDocumentTable)
      .where(eq(KnowledgeDocumentTable.id, id));
  },

  async getDocumentImages(documentId) {
    const rows = await db
      .select(knowledgeDocumentImageSelection)
      .from(KnowledgeDocumentImageTable)
      .where(eq(KnowledgeDocumentImageTable.documentId, documentId))
      .orderBy(
        KnowledgeDocumentImageTable.ordinal,
        KnowledgeDocumentImageTable.createdAt,
      );
    return rows.map(mapDocumentImage);
  },

  async getDocumentImagesByVersion(documentId, versionId) {
    const rows = await db
      .select(knowledgeDocumentImageVersionSelection)
      .from(KnowledgeDocumentImageVersionTable)
      .where(
        and(
          eq(KnowledgeDocumentImageVersionTable.documentId, documentId),
          eq(KnowledgeDocumentImageVersionTable.versionId, versionId),
        ),
      )
      .orderBy(
        KnowledgeDocumentImageVersionTable.ordinal,
        KnowledgeDocumentImageVersionTable.createdAt,
      );
    return rows.map(mapVersionedDocumentImage);
  },

  async getDocumentImageById(documentId, imageId) {
    const [row] = await db
      .select(knowledgeDocumentImageSelection)
      .from(KnowledgeDocumentImageTable)
      .where(
        and(
          eq(KnowledgeDocumentImageTable.documentId, documentId),
          eq(KnowledgeDocumentImageTable.id, imageId),
        ),
      );
    return row ? mapDocumentImage(row) : null;
  },

  async getDocumentImageByIdFromVersion(documentId, versionId, imageId) {
    const [row] = await db
      .select(knowledgeDocumentImageVersionSelection)
      .from(KnowledgeDocumentImageVersionTable)
      .where(
        and(
          eq(KnowledgeDocumentImageVersionTable.documentId, documentId),
          eq(KnowledgeDocumentImageVersionTable.versionId, versionId),
          eq(KnowledgeDocumentImageVersionTable.id, imageId),
        ),
      );
    return row ? mapVersionedDocumentImage(row) : null;
  },

  async listDocumentImageStoragePaths(documentId) {
    const liveRows = await db
      .select({
        storagePath: KnowledgeDocumentImageTable.storagePath,
      })
      .from(KnowledgeDocumentImageTable)
      .where(eq(KnowledgeDocumentImageTable.documentId, documentId));
    const versionRows = await db
      .select({
        storagePath: KnowledgeDocumentImageVersionTable.storagePath,
      })
      .from(KnowledgeDocumentImageVersionTable)
      .where(eq(KnowledgeDocumentImageVersionTable.documentId, documentId));

    return Array.from(
      new Set(
        [...liveRows, ...versionRows]
          .map((row) => row.storagePath ?? null)
          .filter((value): value is string => Boolean(value)),
      ),
    );
  },

  // ─── Document Markdown (Context7-style) ─────────────────────────────────────

  async getDocumentMarkdown(documentId) {
    const [row] = await db
      .select({
        name: KnowledgeDocumentTable.name,
        description: KnowledgeDocumentTable.description,
        markdownContent: KnowledgeDocumentTable.markdownContent,
      })
      .from(KnowledgeDocumentTable)
      .where(eq(KnowledgeDocumentTable.id, documentId));
    if (!row || !row.markdownContent) return null;
    return {
      name: row.name,
      description: row.description ?? null,
      markdown: row.markdownContent,
    };
  },

  async getGroupDocumentsMarkdown(groupId, topic) {
    const rows = await db
      .select({
        documentId: KnowledgeDocumentTable.id,
        name: KnowledgeDocumentTable.name,
        markdownContent: KnowledgeDocumentTable.markdownContent,
      })
      .from(KnowledgeDocumentTable)
      .where(
        and(
          eq(KnowledgeDocumentTable.groupId, groupId),
          eq(KnowledgeDocumentTable.status, "ready"),
        ),
      )
      .orderBy(desc(KnowledgeDocumentTable.createdAt));

    let results = rows
      .filter((r) => !!r.markdownContent)
      .map((r) => ({
        documentId: r.documentId,
        name: r.name,
        markdown: r.markdownContent!,
      }));

    // Topic filtering: if a topic is provided, filter sections that match
    if (topic && topic.trim()) {
      const topicLower = topic.toLowerCase();
      const topicWords = topicLower.split(/\s+/).filter(Boolean);

      results = results
        .map((doc) => {
          // Try to extract relevant sections from the markdown
          const sections = doc.markdown.split(/(?=^#{1,3}\s)/m);
          const relevantSections = sections.filter((section) => {
            const lower = section.toLowerCase();
            return topicWords.some((w) => lower.includes(w));
          });

          if (relevantSections.length > 0) {
            return { ...doc, markdown: relevantSections.join("\n\n") };
          }
          // If no section matches, check if the whole doc is relevant
          if (topicWords.some((w) => doc.markdown.toLowerCase().includes(w))) {
            return doc;
          }
          return null;
        })
        .filter(Boolean) as typeof results;
    }

    return results;
  },

  async getDocumentMetadataByIds(groupId, ids) {
    if (ids.length === 0) return [];

    const rows = await db
      .select({
        documentId: KnowledgeDocumentTable.id,
        name: KnowledgeDocumentTable.name,
        description: KnowledgeDocumentTable.description,
        updatedAt: KnowledgeDocumentTable.updatedAt,
      })
      .from(KnowledgeDocumentTable)
      .where(
        and(
          eq(KnowledgeDocumentTable.groupId, groupId),
          inArray(KnowledgeDocumentTable.id, ids),
          eq(KnowledgeDocumentTable.status, "ready"),
        ),
      );

    return rows.map((r) => ({
      documentId: r.documentId,
      name: r.name,
      description: r.description ?? null,
      updatedAt: r.updatedAt,
    }));
  },

  async getDocumentMetadataByIdsAcrossGroups(ids) {
    if (ids.length === 0) return [];

    const rows = await db
      .select({
        documentId: KnowledgeDocumentTable.id,
        groupId: KnowledgeDocumentTable.groupId,
        name: KnowledgeDocumentTable.name,
        description: KnowledgeDocumentTable.description,
        metadata: KnowledgeDocumentTable.metadata,
        updatedAt: KnowledgeDocumentTable.updatedAt,
      })
      .from(KnowledgeDocumentTable)
      .where(
        and(
          inArray(KnowledgeDocumentTable.id, ids),
          eq(KnowledgeDocumentTable.status, "ready"),
        ),
      );

    return rows.map((r) => ({
      documentId: r.documentId,
      groupId: r.groupId,
      name: r.name,
      description: r.description ?? null,
      metadata: (r.metadata as Record<string, unknown>) ?? null,
      updatedAt: r.updatedAt,
    }));
  },

  async findDocumentIdsByRetrievalIdentity(groupId, input) {
    const issuer = input.issuer?.trim() ?? null;
    const ticker = input.ticker?.trim().toUpperCase() ?? null;
    if (!issuer && !ticker) {
      return [];
    }

    const rows = await db.execute<{ document_id: string; score: number }>(
      sql`
        WITH q AS (
          SELECT
            ${issuer}::text AS issuer_q,
            ${ticker}::text AS ticker_q
        )
        SELECT
          kd.id AS document_id,
          (
            CASE
              WHEN (SELECT ticker_q FROM q) IS NOT NULL
               AND (
                 upper(coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerTicker', '')) = (SELECT ticker_q FROM q)
                 OR upper(coalesce(kd.name, '')) LIKE '%' || (SELECT ticker_q FROM q) || '%'
                 OR upper(coalesce(kd.original_filename, '')) LIKE '%' || (SELECT ticker_q FROM q) || '%'
                 OR EXISTS (
                   SELECT 1
                   FROM jsonb_array_elements_text(
                     COALESCE(kd.metadata::jsonb->'retrievalIdentity'->'issuerAliases', '[]'::jsonb)
                   ) alias
                   WHERE upper(alias) = (SELECT ticker_q FROM q)
                 )
               )
              THEN 1.0
              ELSE 0
            END
            +
            CASE
              WHEN (SELECT issuer_q FROM q) IS NOT NULL
               AND (
                 lower(coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerName', '')) LIKE '%' || lower((SELECT issuer_q FROM q)) || '%'
                 OR lower(coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'canonicalTitle', '')) LIKE '%' || lower((SELECT issuer_q FROM q)) || '%'
                 OR lower(coalesce(kd.name, '')) LIKE '%' || lower((SELECT issuer_q FROM q)) || '%'
                 OR EXISTS (
                   SELECT 1
                   FROM jsonb_array_elements_text(
                     COALESCE(kd.metadata::jsonb->'retrievalIdentity'->'issuerAliases', '[]'::jsonb)
                   ) alias
                   WHERE lower(alias) LIKE '%' || lower((SELECT issuer_q FROM q)) || '%'
                 )
               )
              THEN 0.9
              ELSE 0
            END
          ) AS score
        FROM knowledge_document kd
        WHERE kd.group_id = ${groupId}
          AND kd.status = 'ready'
          AND (
            (
              (SELECT ticker_q FROM q) IS NOT NULL
              AND (
                upper(coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerTicker', '')) = (SELECT ticker_q FROM q)
                OR upper(coalesce(kd.name, '')) LIKE '%' || (SELECT ticker_q FROM q) || '%'
                OR upper(coalesce(kd.original_filename, '')) LIKE '%' || (SELECT ticker_q FROM q) || '%'
                OR EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements_text(
                    COALESCE(kd.metadata::jsonb->'retrievalIdentity'->'issuerAliases', '[]'::jsonb)
                  ) alias
                  WHERE upper(alias) = (SELECT ticker_q FROM q)
                )
              )
            )
            OR
            (
              (SELECT issuer_q FROM q) IS NOT NULL
              AND (
                lower(coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerName', '')) LIKE '%' || lower((SELECT issuer_q FROM q)) || '%'
                OR lower(coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'canonicalTitle', '')) LIKE '%' || lower((SELECT issuer_q FROM q)) || '%'
                OR lower(coalesce(kd.name, '')) LIKE '%' || lower((SELECT issuer_q FROM q)) || '%'
                OR EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements_text(
                    COALESCE(kd.metadata::jsonb->'retrievalIdentity'->'issuerAliases', '[]'::jsonb)
                  ) alias
                  WHERE lower(alias) LIKE '%' || lower((SELECT issuer_q FROM q)) || '%'
                )
              )
            )
          )
        ORDER BY score DESC, kd.updated_at DESC
        LIMIT ${Math.max(1, input.limit ?? 24)}
      `,
    );

    return rows.rows.map((row) => ({
      documentId: row.document_id,
      score: Number(row.score),
    }));
  },

  async searchDocumentMetadata(groupId, query, limit, documentIds) {
    const documentFilter = buildUuidFilterSql("kd.id", documentIds);
    const rows = await db.execute<{ document_id: string; score: number }>(
      sql`
        WITH q AS (
          SELECT
            websearch_to_tsquery('simple', ${query}) AS simple_q,
            websearch_to_tsquery('english', ${query}) AS english_q,
            phraseto_tsquery('simple', ${query}) AS phrase_q,
            '%' || ${query} || '%' AS ilike_q,
            lower(regexp_replace(${query}, '\s+', ' ', 'g')) AS normalized_q
        )
        SELECT
          kd.id AS document_id,
          (
            GREATEST(
              ts_rank_cd(
                to_tsvector(
                  'simple',
                  coalesce(kd.name, '') || ' ' ||
                  coalesce(kd.description, '') || ' ' ||
                  coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'canonicalTitle', '') || ' ' ||
                  coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerName', '') || ' ' ||
                  coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerTicker', '') || ' ' ||
                  coalesce(kd.original_filename, '') || ' ' ||
                  coalesce(kd.source_url, '')
                ),
                (SELECT simple_q FROM q)
              ),
              ts_rank_cd(
                to_tsvector(
                  'english',
                  coalesce(kd.name, '') || ' ' ||
                  coalesce(kd.description, '') || ' ' ||
                  coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'canonicalTitle', '') || ' ' ||
                  coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerName', '') || ' ' ||
                  coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerTicker', '') || ' ' ||
                  coalesce(kd.original_filename, '') || ' ' ||
                  coalesce(kd.source_url, '')
                ),
                (SELECT english_q FROM q)
              )
            )
            + 0.25 * ts_rank_cd(
                to_tsvector(
                  'simple',
                  coalesce(kd.name, '') || ' ' ||
                  coalesce(kd.description, '') || ' ' ||
                  coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'canonicalTitle', '') || ' ' ||
                  coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerName', '') || ' ' ||
                  coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerTicker', '')
                ),
                (SELECT phrase_q FROM q)
              )
            + CASE
                WHEN (
                  coalesce(kd.name, '') || ' ' ||
                  coalesce(kd.description, '') || ' ' ||
                  coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'canonicalTitle', '') || ' ' ||
                  coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerName', '') || ' ' ||
                  coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerTicker', '')
                )
                  ILIKE (SELECT ilike_q FROM q) THEN 0.15
                ELSE 0
              END
            + 0.35 * similarity(
                lower(
                  regexp_replace(
                    coalesce(kd.name, '') || ' ' ||
                    coalesce(kd.description, '') || ' ' ||
                    coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'canonicalTitle', '') || ' ' ||
                    coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerName', '') || ' ' ||
                    coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerTicker', '') || ' ' ||
                    coalesce(kd.original_filename, '') || ' ' ||
                    coalesce(kd.source_url, ''),
                    '\s+',
                    ' ',
                    'g'
                  )
                ),
                (SELECT normalized_q FROM q)
              )
          ) AS score
        FROM knowledge_document kd
        WHERE kd.group_id = ${groupId}
          AND kd.status = 'ready'
          ${documentFilter}
          AND (
            to_tsvector(
              'simple',
              coalesce(kd.name, '') || ' ' ||
              coalesce(kd.description, '') || ' ' ||
              coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'canonicalTitle', '') || ' ' ||
              coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerName', '') || ' ' ||
              coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerTicker', '') || ' ' ||
              coalesce(kd.original_filename, '') || ' ' ||
              coalesce(kd.source_url, '')
            ) @@ (SELECT simple_q FROM q)
            OR to_tsvector(
              'english',
              coalesce(kd.name, '') || ' ' ||
              coalesce(kd.description, '') || ' ' ||
              coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'canonicalTitle', '') || ' ' ||
              coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerName', '') || ' ' ||
              coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerTicker', '') || ' ' ||
              coalesce(kd.original_filename, '') || ' ' ||
              coalesce(kd.source_url, '')
            ) @@ (SELECT english_q FROM q)
            OR (
              coalesce(kd.name, '') || ' ' ||
              coalesce(kd.description, '') || ' ' ||
              coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'canonicalTitle', '') || ' ' ||
              coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerName', '') || ' ' ||
              coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerTicker', '')
            )
              ILIKE (SELECT ilike_q FROM q)
            OR similarity(
              lower(
                regexp_replace(
                  coalesce(kd.name, '') || ' ' ||
                  coalesce(kd.description, '') || ' ' ||
                  coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'canonicalTitle', '') || ' ' ||
                  coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerName', '') || ' ' ||
                  coalesce(kd.metadata::jsonb->'retrievalIdentity'->>'issuerTicker', '') || ' ' ||
                  coalesce(kd.original_filename, '') || ' ' ||
                  coalesce(kd.source_url, ''),
                  '\s+',
                  ' ',
                  'g'
                )
              ),
              (SELECT normalized_q FROM q)
            ) >= 0.12
          )
        ORDER BY score DESC, kd.updated_at DESC
        LIMIT ${limit}
      `,
    );

    return rows.rows.map((r) => ({
      documentId: r.document_id,
      score: Number(r.score),
    }));
  },

  async vectorSearchDocumentMetadata(groupId, embedding, limit, documentIds) {
    const { typedColumn, typedEmbedding, dimensionFilter } =
      buildTypedVectorComparison("kd.metadata_embedding", embedding);
    const documentFilter = buildUuidFilterSql("kd.id", documentIds);
    const rows = await db.execute<{ document_id: string; score: number }>(
      sql`
        SELECT
          kd.id AS document_id,
          1 - (${typedColumn} <=> ${typedEmbedding}) AS score
        FROM knowledge_document kd
        WHERE kd.group_id = ${groupId}
          AND kd.status = 'ready'
          AND kd.metadata_embedding IS NOT NULL
          AND ${dimensionFilter}
          ${documentFilter}
        ORDER BY ${typedColumn} <=> ${typedEmbedding}
        LIMIT ${limit}
      `,
    );

    return rows.rows.map((r) => ({
      documentId: r.document_id,
      score: Number(r.score),
    }));
  },

  // ─── Sections ───────────────────────────────────────────────────────────────

  async insertSections(sections) {
    if (sections.length === 0) return;
    const BATCH = 100;
    for (let i = 0; i < sections.length; i += BATCH) {
      const batch = sections.slice(i, i + BATCH);
      await db.insert(KnowledgeSectionTable).values(
        batch.map((section) => ({
          id: section.id,
          documentId: section.documentId,
          groupId: section.groupId,
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
          pageStart: section.pageStart ?? null,
          pageEnd: section.pageEnd ?? null,
          noteNumber: section.noteNumber ?? null,
          noteTitle: section.noteTitle ?? null,
          noteSubsection: section.noteSubsection ?? null,
          continued: section.continued ?? false,
          embedding:
            toPgVectorLiteral(section.embedding ?? null) === null
              ? null
              : sql`${toPgVectorLiteral(section.embedding ?? null)}::vector`,
          createdAt: new Date(),
        })),
      );
    }
  },

  async deleteSectionsByDocumentId(documentId) {
    await db
      .delete(KnowledgeSectionTable)
      .where(eq(KnowledgeSectionTable.documentId, documentId));
  },

  async getSectionsByIds(ids) {
    if (ids.length === 0) return [];

    const rows = await db
      .select()
      .from(KnowledgeSectionTable)
      .where(inArray(KnowledgeSectionTable.id, ids));

    return rows.map(mapSection);
  },

  async getRelatedSections(sectionIds) {
    if (sectionIds.length === 0) return [];

    const relationRows = await db
      .select({
        parentSectionId: KnowledgeSectionTable.parentSectionId,
        prevSectionId: KnowledgeSectionTable.prevSectionId,
        nextSectionId: KnowledgeSectionTable.nextSectionId,
      })
      .from(KnowledgeSectionTable)
      .where(inArray(KnowledgeSectionTable.id, sectionIds));

    const relatedIds = Array.from(
      new Set(
        relationRows
          .flatMap((row) => [
            row.parentSectionId,
            row.prevSectionId,
            row.nextSectionId,
          ])
          .filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
      ),
    );

    if (relatedIds.length === 0) return [];

    const rows = await db
      .select()
      .from(KnowledgeSectionTable)
      .where(inArray(KnowledgeSectionTable.id, relatedIds));

    return rows.map(mapSection);
  },

  async findSectionsByStructuredFilters(input) {
    const docFilter = buildUuidFilterSql("ks.document_id", input.documentIds);
    const pageFilter =
      typeof input.page === "number" && Number.isFinite(input.page)
        ? sql`AND COALESCE(ks.page_start, 0) <= ${input.page}
               AND COALESCE(ks.page_end, ks.page_start, 0) >= ${input.page}`
        : sql``;
    const noteNumberFilter = input.noteNumber
      ? sql`AND ks.note_number = ${input.noteNumber}`
      : sql``;
    const noteSubsectionFilter = input.noteSubsection
      ? sql`AND lower(COALESCE(ks.note_subsection, '')) = lower(${input.noteSubsection})`
      : sql``;
    const rows = await db.execute<{
      id: string;
      document_id: string;
      group_id: string;
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
      page_start: number | null;
      page_end: number | null;
      note_number: string | null;
      note_title: string | null;
      note_subsection: string | null;
      continued: boolean | null;
      created_at: Date;
      document_name: string;
    }>(
      sql`
        SELECT
          ks.id,
          ks.document_id,
          ks.group_id,
          ks.parent_section_id,
          ks.prev_section_id,
          ks.next_section_id,
          ks.heading,
          ks.heading_path,
          ks.level,
          ks.part_index,
          ks.part_count,
          ks.content,
          ks.summary,
          ks.token_count,
          ks.page_start,
          ks.page_end,
          ks.note_number,
          ks.note_title,
          ks.note_subsection,
          ks.continued,
          ks.created_at,
          kd.name AS document_name
        FROM knowledge_section ks
        JOIN knowledge_document kd ON kd.id = ks.document_id
        WHERE ks.group_id = ${input.groupId}
          AND kd.status = 'ready'
          ${docFilter}
          ${pageFilter}
          ${noteNumberFilter}
          ${noteSubsectionFilter}
        ORDER BY ks.page_start ASC NULLS LAST, ks.created_at ASC
        LIMIT ${Math.max(1, input.limit ?? 200)}
      `,
    );

    return rows.rows.map((row) => ({
      section: {
        id: row.id,
        documentId: row.document_id,
        groupId: row.group_id,
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
        pageStart: row.page_start ?? null,
        pageEnd: row.page_end ?? null,
        noteNumber: row.note_number ?? null,
        noteTitle: row.note_title ?? null,
        noteSubsection: row.note_subsection ?? null,
        continued: row.continued ?? false,
        embedding: null,
        createdAt: row.created_at,
      } satisfies KnowledgeSection,
      documentId: row.document_id,
      documentName: row.document_name,
    }));
  },

  async fullTextSearchSections(groupId, query, limit, documentIds) {
    const docFilter = buildUuidFilterSql("ks.document_id", documentIds);

    const rows = await db.execute<{
      id: string;
      document_id: string;
      group_id: string;
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
      page_start: number | null;
      page_end: number | null;
      note_number: string | null;
      note_title: string | null;
      note_subsection: string | null;
      continued: boolean | null;
      created_at: Date;
      document_name: string;
      score: number;
    }>(
      sql`
        WITH q AS (
          SELECT
            websearch_to_tsquery('simple', ${query}) AS simple_q,
            websearch_to_tsquery('english', ${query}) AS english_q,
            phraseto_tsquery('simple', ${query}) AS phrase_q,
            '%' || ${query} || '%' AS ilike_q,
            lower(regexp_replace(${query}, '\s+', ' ', 'g')) AS normalized_q
        )
        SELECT
          ks.id,
          ks.document_id,
          ks.group_id,
          ks.parent_section_id,
          ks.prev_section_id,
          ks.next_section_id,
          ks.heading,
          ks.heading_path,
          ks.level,
          ks.part_index,
          ks.part_count,
          ks.content,
          ks.summary,
          ks.token_count,
          ks.page_start,
          ks.page_end,
          ks.note_number,
          ks.note_title,
          ks.note_subsection,
          ks.continued,
          ks.created_at,
          kd.name AS document_name,
          (
            GREATEST(
              ts_rank_cd(
                to_tsvector(
                  'english',
                  coalesce(kd.name, '') || ' ' ||
                  coalesce(kd.description, '') || ' ' ||
                  coalesce(kd.original_filename, '') || ' ' ||
                  coalesce(ks.heading_path, '') || ' ' ||
                  coalesce(ks.note_number, '') || ' ' ||
                  coalesce(ks.note_title, '') || ' ' ||
                  coalesce(ks.note_subsection, '') || ' ' ||
                  coalesce(ks.summary, '') || ' ' ||
                  coalesce(ks.content, '')
                ),
                (SELECT english_q FROM q)
              ),
              ts_rank_cd(
                to_tsvector(
                  'simple',
                  coalesce(kd.name, '') || ' ' ||
                  coalesce(kd.description, '') || ' ' ||
                  coalesce(kd.original_filename, '') || ' ' ||
                  coalesce(ks.heading_path, '') || ' ' ||
                  coalesce(ks.note_number, '') || ' ' ||
                  coalesce(ks.note_title, '') || ' ' ||
                  coalesce(ks.note_subsection, '') || ' ' ||
                  coalesce(ks.summary, '') || ' ' ||
                  coalesce(ks.content, '')
                ),
                (SELECT simple_q FROM q)
              )
            )
            + 0.25 * ts_rank_cd(
              to_tsvector(
                'simple',
                coalesce(ks.heading_path, '') || ' ' ||
                coalesce(ks.note_number, '') || ' ' ||
                coalesce(ks.note_title, '') || ' ' ||
                coalesce(ks.summary, '')
              ),
              (SELECT phrase_q FROM q)
            )
            + CASE
                WHEN (
                  coalesce(ks.heading_path, '') || ' ' ||
                  coalesce(ks.note_number, '') || ' ' ||
                  coalesce(ks.note_title, '') || ' ' ||
                  coalesce(ks.note_subsection, '') || ' ' ||
                  coalesce(ks.summary, '') || ' ' ||
                  coalesce(ks.content, '')
                ) ILIKE (SELECT ilike_q FROM q) THEN 0.15
                ELSE 0
              END
            + 0.35 * similarity(
                lower(
                  regexp_replace(
                    coalesce(kd.name, '') || ' ' ||
                    coalesce(kd.description, '') || ' ' ||
                    coalesce(kd.original_filename, '') || ' ' ||
                    coalesce(ks.heading_path, '') || ' ' ||
                    coalesce(ks.note_number, '') || ' ' ||
                    coalesce(ks.note_title, '') || ' ' ||
                    coalesce(ks.note_subsection, '') || ' ' ||
                    coalesce(ks.summary, '') || ' ' ||
                    coalesce(ks.content, ''),
                    '\s+',
                    ' ',
                    'g'
                  )
                ),
                (SELECT normalized_q FROM q)
              )
          ) AS score
        FROM knowledge_section ks
        JOIN knowledge_document kd ON kd.id = ks.document_id
        WHERE ks.group_id = ${groupId}
          AND kd.status = 'ready'
          ${docFilter}
          AND (
            to_tsvector(
              'english',
              coalesce(kd.name, '') || ' ' ||
              coalesce(kd.description, '') || ' ' ||
              coalesce(kd.original_filename, '') || ' ' ||
              coalesce(ks.heading_path, '') || ' ' ||
              coalesce(ks.note_number, '') || ' ' ||
              coalesce(ks.note_title, '') || ' ' ||
              coalesce(ks.note_subsection, '') || ' ' ||
              coalesce(ks.summary, '') || ' ' ||
              coalesce(ks.content, '')
            ) @@ (SELECT english_q FROM q)
            OR to_tsvector(
              'simple',
              coalesce(kd.name, '') || ' ' ||
              coalesce(kd.description, '') || ' ' ||
              coalesce(kd.original_filename, '') || ' ' ||
              coalesce(ks.heading_path, '') || ' ' ||
              coalesce(ks.note_number, '') || ' ' ||
              coalesce(ks.note_title, '') || ' ' ||
              coalesce(ks.note_subsection, '') || ' ' ||
              coalesce(ks.summary, '') || ' ' ||
              coalesce(ks.content, '')
            ) @@ (SELECT simple_q FROM q)
            OR (
              coalesce(ks.heading_path, '') || ' ' ||
              coalesce(ks.note_number, '') || ' ' ||
              coalesce(ks.note_title, '') || ' ' ||
              coalesce(ks.note_subsection, '') || ' ' ||
              coalesce(ks.summary, '') || ' ' ||
              coalesce(ks.content, '')
            ) ILIKE (SELECT ilike_q FROM q)
            OR similarity(
              lower(
                regexp_replace(
                  coalesce(kd.name, '') || ' ' ||
                  coalesce(kd.description, '') || ' ' ||
                  coalesce(kd.original_filename, '') || ' ' ||
                  coalesce(ks.heading_path, '') || ' ' ||
                  coalesce(ks.note_number, '') || ' ' ||
                  coalesce(ks.note_title, '') || ' ' ||
                  coalesce(ks.note_subsection, '') || ' ' ||
                  coalesce(ks.summary, '') || ' ' ||
                  coalesce(ks.content, ''),
                  '\s+',
                  ' ',
                  'g'
                )
              ),
              (SELECT normalized_q FROM q)
            ) >= 0.12
          )
        ORDER BY score DESC, ks.created_at DESC
        LIMIT ${limit}
      `,
    );

    return rows.rows.map((row) => ({
      section: {
        id: row.id,
        documentId: row.document_id,
        groupId: row.group_id,
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
        pageStart: row.page_start ?? null,
        pageEnd: row.page_end ?? null,
        noteNumber: row.note_number ?? null,
        noteTitle: row.note_title ?? null,
        noteSubsection: row.note_subsection ?? null,
        continued: row.continued ?? false,
        embedding: null,
        createdAt: row.created_at,
      } satisfies KnowledgeSection,
      documentId: row.document_id,
      documentName: row.document_name,
      score: Number(row.score),
    }));
  },

  async vectorSearchSections(groupId, embedding, limit, documentIds) {
    const { typedColumn, typedEmbedding, dimensionFilter } =
      buildTypedVectorComparison("ks.embedding", embedding);
    const docFilter = buildUuidFilterSql("ks.document_id", documentIds);

    const rows = await db.execute<{
      id: string;
      document_id: string;
      group_id: string;
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
      page_start: number | null;
      page_end: number | null;
      note_number: string | null;
      note_title: string | null;
      note_subsection: string | null;
      continued: boolean | null;
      created_at: Date;
      document_name: string;
      score: number;
    }>(
      sql`
        SELECT
          ks.id,
          ks.document_id,
          ks.group_id,
          ks.parent_section_id,
          ks.prev_section_id,
          ks.next_section_id,
          ks.heading,
          ks.heading_path,
          ks.level,
          ks.part_index,
          ks.part_count,
          ks.content,
          ks.summary,
          ks.token_count,
          ks.page_start,
          ks.page_end,
          ks.note_number,
          ks.note_title,
          ks.note_subsection,
          ks.continued,
          ks.created_at,
          kd.name AS document_name,
          1 - (${typedColumn} <=> ${typedEmbedding}) AS score
        FROM knowledge_section ks
        JOIN knowledge_document kd ON kd.id = ks.document_id
        WHERE ks.group_id = ${groupId}
          AND ks.embedding IS NOT NULL
          AND ${dimensionFilter}
          AND kd.status = 'ready'
          ${docFilter}
        ORDER BY ${typedColumn} <=> ${typedEmbedding}
        LIMIT ${limit}
      `,
    );

    return rows.rows.map((row) => ({
      section: {
        id: row.id,
        documentId: row.document_id,
        groupId: row.group_id,
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
        pageStart: row.page_start ?? null,
        pageEnd: row.page_end ?? null,
        noteNumber: row.note_number ?? null,
        noteTitle: row.note_title ?? null,
        noteSubsection: row.note_subsection ?? null,
        continued: row.continued ?? false,
        embedding: null,
        createdAt: row.created_at,
      } satisfies KnowledgeSection,
      documentId: row.document_id,
      documentName: row.document_name,
      score: Number(row.score),
    }));
  },

  // ─── Chunks ─────────────────────────────────────────────────────────────────

  async insertChunks(chunks) {
    if (chunks.length === 0) return;
    const BATCH = 100;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      await db.insert(KnowledgeChunkTable).values(
        batch.map((c) => ({
          id: generateUUID(),
          documentId: c.documentId,
          groupId: c.groupId,
          sectionId: c.sectionId ?? null,
          content: c.content,
          contextSummary: c.contextSummary ?? null,
          embedding: (c as any).embedding ?? null,
          chunkIndex: c.chunkIndex,
          tokenCount: c.tokenCount,
          metadata: c.metadata ?? null,
          createdAt: new Date(),
        })),
      );
    }
  },

  async deleteChunksByDocumentId(documentId) {
    await db
      .delete(KnowledgeChunkTable)
      .where(eq(KnowledgeChunkTable.documentId, documentId));
  },

  async deleteChunksByGroupId(groupId) {
    await db
      .delete(KnowledgeChunkTable)
      .where(eq(KnowledgeChunkTable.groupId, groupId));
  },

  // ─── Hybrid Search ───────────────────────────────────────────────────────────

  async vectorSearch(groupId, embedding, limit, filters) {
    const embeddingStr = `[${embedding.join(",")}]`;
    const documentFilter = buildUuidFilterSql(
      "kc.document_id",
      filters?.documentIds,
    );
    const sectionFilter = buildUuidFilterSql(
      "kc.section_id",
      filters?.sectionIds,
    );
    const rows = await db.execute<{
      id: string;
      document_id: string;
      group_id: string;
      section_id: string | null;
      content: string;
      context_summary: string | null;
      chunk_index: number;
      token_count: number;
      metadata: any;
      created_at: Date;
      document_name: string;
      score: number;
    }>(
      sql`
        SELECT
          kc.id, kc.document_id, kc.group_id, kc.section_id, kc.content, kc.context_summary,
          kc.chunk_index, kc.token_count, kc.metadata, kc.created_at,
          kd.name AS document_name,
          1 - (kc.embedding <=> ${embeddingStr}::vector) AS score
        FROM knowledge_chunk kc
        JOIN knowledge_document kd ON kd.id = kc.document_id
        WHERE kc.group_id = ${groupId}
          AND kc.embedding IS NOT NULL
          AND kd.status = 'ready'
          ${documentFilter}
          ${sectionFilter}
        ORDER BY kc.embedding <=> ${embeddingStr}::vector
        LIMIT ${limit}
      `,
    );

    return rows.rows.map((r) => ({
      chunk: {
        id: r.id,
        documentId: r.document_id,
        groupId: r.group_id,
        sectionId: r.section_id,
        content: r.content,
        contextSummary: r.context_summary,
        chunkIndex: r.chunk_index,
        tokenCount: r.token_count,
        metadata: r.metadata,
        createdAt: r.created_at,
      } as KnowledgeChunk,
      documentName: r.document_name,
      documentId: r.document_id,
      score: Number(r.score),
    }));
  },

  async fullTextSearch(groupId, query, limit, filters) {
    const documentFilter = buildUuidFilterSql(
      "kc.document_id",
      filters?.documentIds,
    );
    const sectionFilter = buildUuidFilterSql(
      "kc.section_id",
      filters?.sectionIds,
    );
    const rows = await db.execute<{
      id: string;
      document_id: string;
      group_id: string;
      section_id: string | null;
      content: string;
      context_summary: string | null;
      chunk_index: number;
      token_count: number;
      metadata: any;
      created_at: Date;
      document_name: string;
      score: number;
    }>(
      sql`
        WITH q AS (
          SELECT
            websearch_to_tsquery('simple', ${query}) AS simple_q,
            websearch_to_tsquery('english', ${query}) AS english_q,
            phraseto_tsquery('simple', ${query}) AS phrase_q,
            '%' || ${query} || '%' AS ilike_q,
            lower(regexp_replace(${query}, '\s+', ' ', 'g')) AS normalized_q
        )
        SELECT
          kc.id, kc.document_id, kc.group_id, kc.section_id, kc.content, kc.context_summary,
          kc.chunk_index, kc.token_count, kc.metadata, kc.created_at,
          kd.name AS document_name,
          (
            -- BM25-like rank with Porter stemming (english) + literal token mode (simple)
            GREATEST(
              ts_rank_cd(
                to_tsvector(
                  'english',
                  coalesce(kd.name, '') || ' ' ||
                  coalesce(kd.description, '') || ' ' ||
                  coalesce(kd.original_filename, '') || ' ' ||
                  coalesce(kc.context_summary, '') || ' ' ||
                  coalesce(kc.content, '') || ' ' ||
                  coalesce(kc.metadata->>'canonicalTitle', '') || ' ' ||
                  coalesce(kc.metadata->>'issuerName', '') || ' ' ||
                  coalesce(kc.metadata->>'issuerTicker', '') || ' ' ||
                  coalesce(kc.metadata->>'headingPath', '') || ' ' ||
                  coalesce(kc.metadata->>'section', '') || ' ' ||
                  coalesce(kc.metadata->>'noteNumber', '') || ' ' ||
                  coalesce(kc.metadata->>'noteTitle', '') || ' ' ||
                  coalesce(kc.metadata->>'noteSubsection', '') || ' ' ||
                  coalesce(kc.metadata->>'pageStart', '') || ' ' ||
                  coalesce(kc.metadata->>'pageEnd', '')
                ),
                (SELECT english_q FROM q)
              ),
              ts_rank_cd(
                to_tsvector(
                  'simple',
                  coalesce(kd.name, '') || ' ' ||
                  coalesce(kd.description, '') || ' ' ||
                  coalesce(kd.original_filename, '') || ' ' ||
                  coalesce(kc.context_summary, '') || ' ' ||
                  coalesce(kc.content, '') || ' ' ||
                  coalesce(kc.metadata->>'canonicalTitle', '') || ' ' ||
                  coalesce(kc.metadata->>'issuerName', '') || ' ' ||
                  coalesce(kc.metadata->>'issuerTicker', '') || ' ' ||
                  coalesce(kc.metadata->>'headingPath', '') || ' ' ||
                  coalesce(kc.metadata->>'section', '') || ' ' ||
                  coalesce(kc.metadata->>'noteNumber', '') || ' ' ||
                  coalesce(kc.metadata->>'noteTitle', '') || ' ' ||
                  coalesce(kc.metadata->>'noteSubsection', '') || ' ' ||
                  coalesce(kc.metadata->>'pageStart', '') || ' ' ||
                  coalesce(kc.metadata->>'pageEnd', '')
                ),
                (SELECT simple_q FROM q)
              )
            )
            -- Prefer exact heading matches for entity-like queries ("PT DJARUM")
            + 0.35 * ts_rank_cd(
              to_tsvector(
                'simple',
                coalesce(kd.name, '') || ' ' ||
                coalesce(kd.description, '') || ' ' ||
                coalesce(kd.original_filename, '') || ' ' ||
                coalesce(kc.metadata->>'canonicalTitle', '') || ' ' ||
                coalesce(kc.metadata->>'issuerName', '') || ' ' ||
                coalesce(kc.metadata->>'issuerTicker', '') || ' ' ||
                coalesce(kc.metadata->>'headingPath', '') || ' ' ||
                coalesce(kc.metadata->>'section', '') || ' ' ||
                coalesce(kc.metadata->>'noteNumber', '') || ' ' ||
                coalesce(kc.metadata->>'noteTitle', '') || ' ' ||
                coalesce(kc.metadata->>'noteSubsection', '')
              ),
              (SELECT simple_q FROM q)
            )
            -- Phrase bonus for exact sequence matches
            + 0.25 * ts_rank_cd(
              to_tsvector(
                'simple',
                coalesce(kd.name, '') || ' ' ||
                coalesce(kd.description, '') || ' ' ||
                coalesce(kc.context_summary, '') || ' ' ||
                coalesce(kc.content, '') || ' ' ||
                coalesce(kc.metadata->>'headingPath', '') || ' ' ||
                coalesce(kc.metadata->>'section', '')
              ),
              (SELECT phrase_q FROM q)
            )
            -- Last-resort literal substring boost
            + CASE
                WHEN (
                  coalesce(kd.name, '') || ' ' ||
                  coalesce(kd.description, '') || ' ' ||
                  coalesce(kd.original_filename, '') || ' ' ||
                  coalesce(kc.context_summary, '') || ' ' ||
                  coalesce(kc.content, '') || ' ' ||
                  coalesce(kc.metadata->>'canonicalTitle', '') || ' ' ||
                  coalesce(kc.metadata->>'issuerName', '') || ' ' ||
                  coalesce(kc.metadata->>'issuerTicker', '') || ' ' ||
                  coalesce(kc.metadata->>'headingPath', '') || ' ' ||
                  coalesce(kc.metadata->>'section', '') || ' ' ||
                  coalesce(kc.metadata->>'noteNumber', '') || ' ' ||
                  coalesce(kc.metadata->>'noteTitle', '') || ' ' ||
                  coalesce(kc.metadata->>'noteSubsection', '') || ' ' ||
                  coalesce(kc.metadata->>'pageStart', '') || ' ' ||
                  coalesce(kc.metadata->>'pageEnd', '')
                ) ILIKE (SELECT ilike_q FROM q) THEN 0.15
                ELSE 0
              END
            + 0.3 * similarity(
                lower(
                  regexp_replace(
                    coalesce(kd.name, '') || ' ' ||
                    coalesce(kd.description, '') || ' ' ||
                    coalesce(kd.original_filename, '') || ' ' ||
                    coalesce(kc.context_summary, '') || ' ' ||
                    coalesce(kc.content, '') || ' ' ||
                    coalesce(kc.metadata->>'canonicalTitle', '') || ' ' ||
                    coalesce(kc.metadata->>'issuerName', '') || ' ' ||
                    coalesce(kc.metadata->>'issuerTicker', '') || ' ' ||
                    coalesce(kc.metadata->>'headingPath', '') || ' ' ||
                    coalesce(kc.metadata->>'section', '') || ' ' ||
                    coalesce(kc.metadata->>'noteNumber', '') || ' ' ||
                    coalesce(kc.metadata->>'noteTitle', '') || ' ' ||
                    coalesce(kc.metadata->>'noteSubsection', '') || ' ' ||
                    coalesce(kc.metadata->>'pageStart', '') || ' ' ||
                    coalesce(kc.metadata->>'pageEnd', ''),
                    '\s+',
                    ' ',
                    'g'
                  )
                ),
                (SELECT normalized_q FROM q)
              )
          ) AS score
        FROM knowledge_chunk kc
        JOIN knowledge_document kd ON kd.id = kc.document_id
        WHERE kc.group_id = ${groupId}
          AND kd.status = 'ready'
          ${documentFilter}
          ${sectionFilter}
          AND (
            to_tsvector(
              'english',
              coalesce(kd.name, '') || ' ' ||
              coalesce(kd.description, '') || ' ' ||
              coalesce(kd.original_filename, '') || ' ' ||
              coalesce(kc.context_summary, '') || ' ' ||
              coalesce(kc.content, '') || ' ' ||
              coalesce(kc.metadata->>'canonicalTitle', '') || ' ' ||
              coalesce(kc.metadata->>'issuerName', '') || ' ' ||
              coalesce(kc.metadata->>'issuerTicker', '') || ' ' ||
              coalesce(kc.metadata->>'headingPath', '') || ' ' ||
              coalesce(kc.metadata->>'section', '') || ' ' ||
              coalesce(kc.metadata->>'noteNumber', '') || ' ' ||
              coalesce(kc.metadata->>'noteTitle', '') || ' ' ||
              coalesce(kc.metadata->>'noteSubsection', '') || ' ' ||
              coalesce(kc.metadata->>'pageStart', '') || ' ' ||
              coalesce(kc.metadata->>'pageEnd', '')
            ) @@ (SELECT english_q FROM q)
            OR to_tsvector(
              'simple',
              coalesce(kd.name, '') || ' ' ||
              coalesce(kd.description, '') || ' ' ||
              coalesce(kd.original_filename, '') || ' ' ||
              coalesce(kc.context_summary, '') || ' ' ||
              coalesce(kc.content, '') || ' ' ||
              coalesce(kc.metadata->>'canonicalTitle', '') || ' ' ||
              coalesce(kc.metadata->>'issuerName', '') || ' ' ||
              coalesce(kc.metadata->>'issuerTicker', '') || ' ' ||
              coalesce(kc.metadata->>'headingPath', '') || ' ' ||
              coalesce(kc.metadata->>'section', '') || ' ' ||
              coalesce(kc.metadata->>'noteNumber', '') || ' ' ||
              coalesce(kc.metadata->>'noteTitle', '') || ' ' ||
              coalesce(kc.metadata->>'noteSubsection', '') || ' ' ||
              coalesce(kc.metadata->>'pageStart', '') || ' ' ||
              coalesce(kc.metadata->>'pageEnd', '')
            ) @@ (SELECT simple_q FROM q)
            OR (
              coalesce(kd.name, '') || ' ' ||
              coalesce(kd.description, '') || ' ' ||
              coalesce(kd.original_filename, '') || ' ' ||
              coalesce(kc.context_summary, '') || ' ' ||
              coalesce(kc.content, '') || ' ' ||
              coalesce(kc.metadata->>'canonicalTitle', '') || ' ' ||
              coalesce(kc.metadata->>'issuerName', '') || ' ' ||
              coalesce(kc.metadata->>'issuerTicker', '') || ' ' ||
              coalesce(kc.metadata->>'headingPath', '') || ' ' ||
              coalesce(kc.metadata->>'section', '') || ' ' ||
              coalesce(kc.metadata->>'noteNumber', '') || ' ' ||
              coalesce(kc.metadata->>'noteTitle', '') || ' ' ||
              coalesce(kc.metadata->>'noteSubsection', '') || ' ' ||
              coalesce(kc.metadata->>'pageStart', '') || ' ' ||
              coalesce(kc.metadata->>'pageEnd', '')
            ) ILIKE (SELECT ilike_q FROM q)
            OR similarity(
              lower(
                regexp_replace(
                  coalesce(kd.name, '') || ' ' ||
                  coalesce(kd.description, '') || ' ' ||
                  coalesce(kd.original_filename, '') || ' ' ||
                  coalesce(kc.context_summary, '') || ' ' ||
                  coalesce(kc.content, '') || ' ' ||
                  coalesce(kc.metadata->>'canonicalTitle', '') || ' ' ||
                  coalesce(kc.metadata->>'issuerName', '') || ' ' ||
                  coalesce(kc.metadata->>'issuerTicker', '') || ' ' ||
                  coalesce(kc.metadata->>'headingPath', '') || ' ' ||
                  coalesce(kc.metadata->>'section', '') || ' ' ||
                  coalesce(kc.metadata->>'noteNumber', '') || ' ' ||
                  coalesce(kc.metadata->>'noteTitle', '') || ' ' ||
                  coalesce(kc.metadata->>'noteSubsection', '') || ' ' ||
                  coalesce(kc.metadata->>'pageStart', '') || ' ' ||
                  coalesce(kc.metadata->>'pageEnd', ''),
                  '\s+',
                  ' ',
                  'g'
                )
              ),
              (SELECT normalized_q FROM q)
            ) >= 0.1
          )
        ORDER BY score DESC, kc.created_at DESC
        LIMIT ${limit}
      `,
    );

    return rows.rows.map((r) => ({
      chunk: {
        id: r.id,
        documentId: r.document_id,
        groupId: r.group_id,
        sectionId: r.section_id,
        content: r.content,
        contextSummary: r.context_summary,
        chunkIndex: r.chunk_index,
        tokenCount: r.token_count,
        metadata: r.metadata,
        createdAt: r.created_at,
      } as KnowledgeChunk,
      documentName: r.document_name,
      documentId: r.document_id,
      score: Number(r.score),
    }));
  },

  async fullTextSearchImages(groupId, query, limit, documentIds) {
    const docFilter = buildUuidFilterSql("kdi.document_id", documentIds);

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
      created_at: Date;
      updated_at: Date;
      score: number;
    }>(
      sql`
        WITH q AS (
          SELECT
            websearch_to_tsquery('simple', ${query}) AS simple_q,
            websearch_to_tsquery('english', ${query}) AS english_q,
            '%' || ${query} || '%' AS ilike_q,
            lower(regexp_replace(${query}, '\s+', ' ', 'g')) AS normalized_q
        )
        SELECT
          kdi.id,
          kdi.document_id,
          kdi.group_id,
          kdi.version_id,
          kdi.kind,
          kdi.ordinal,
          kdi.marker,
          kdi.label,
          kdi.description,
          kdi.heading_path,
          kdi.step_hint,
          kdi.storage_path,
          kdi.source_url,
          kdi.media_type,
          kdi.page_number,
          kdi.width,
          kdi.height,
          kdi.alt_text,
          kdi.caption,
          kdi.surrounding_text,
          kdi.preceding_text,
          kdi.following_text,
          kdi.is_renderable,
          kdi.manual_label,
          kdi.manual_description,
          kdi.created_at,
          kdi.updated_at,
          (
            GREATEST(
              ts_rank_cd(
                to_tsvector(
                  'english',
                  coalesce(kdi.label, '') || ' ' ||
                  coalesce(kdi.description, '') || ' ' ||
                  coalesce(kdi.heading_path, '') || ' ' ||
                  coalesce(kdi.step_hint, '') || ' ' ||
                  coalesce(kdi.caption, '') || ' ' ||
                  coalesce(kdi.alt_text, '') || ' ' ||
                  coalesce(kdi.preceding_text, '') || ' ' ||
                  coalesce(kdi.following_text, '') || ' ' ||
                  coalesce(kdi.surrounding_text, '')
                ),
                (SELECT english_q FROM q)
              ),
              ts_rank_cd(
                to_tsvector(
                  'simple',
                  coalesce(kdi.label, '') || ' ' ||
                  coalesce(kdi.description, '') || ' ' ||
                  coalesce(kdi.heading_path, '') || ' ' ||
                  coalesce(kdi.step_hint, '') || ' ' ||
                  coalesce(kdi.caption, '') || ' ' ||
                  coalesce(kdi.alt_text, '') || ' ' ||
                  coalesce(kdi.preceding_text, '') || ' ' ||
                  coalesce(kdi.following_text, '') || ' ' ||
                  coalesce(kdi.surrounding_text, '')
                ),
                (SELECT simple_q FROM q)
              )
            )
            + CASE
                WHEN (
                  coalesce(kdi.label, '') || ' ' ||
                  coalesce(kdi.description, '') || ' ' ||
                  coalesce(kdi.heading_path, '') || ' ' ||
                  coalesce(kdi.step_hint, '') || ' ' ||
                  coalesce(kdi.caption, '') || ' ' ||
                  coalesce(kdi.alt_text, '') || ' ' ||
                  coalesce(kdi.preceding_text, '') || ' ' ||
                  coalesce(kdi.following_text, '') || ' ' ||
                  coalesce(kdi.surrounding_text, '')
                ) ILIKE (SELECT ilike_q FROM q) THEN 0.15
                ELSE 0
              END
            + 0.3 * similarity(
                lower(
                  regexp_replace(
                    coalesce(kdi.label, '') || ' ' ||
                    coalesce(kdi.description, '') || ' ' ||
                    coalesce(kdi.heading_path, '') || ' ' ||
                    coalesce(kdi.step_hint, '') || ' ' ||
                    coalesce(kdi.caption, '') || ' ' ||
                    coalesce(kdi.alt_text, '') || ' ' ||
                    coalesce(kdi.preceding_text, '') || ' ' ||
                    coalesce(kdi.following_text, '') || ' ' ||
                    coalesce(kdi.surrounding_text, ''),
                    '\s+',
                    ' ',
                    'g'
                  )
                ),
                (SELECT normalized_q FROM q)
              )
          ) AS score
        FROM knowledge_document_image kdi
        WHERE kdi.group_id = ${groupId}
          AND kdi.is_renderable = true
          ${docFilter}
          AND (
            to_tsvector(
              'english',
              coalesce(kdi.label, '') || ' ' ||
              coalesce(kdi.description, '') || ' ' ||
              coalesce(kdi.heading_path, '') || ' ' ||
              coalesce(kdi.step_hint, '') || ' ' ||
              coalesce(kdi.caption, '') || ' ' ||
              coalesce(kdi.alt_text, '') || ' ' ||
              coalesce(kdi.preceding_text, '') || ' ' ||
              coalesce(kdi.following_text, '') || ' ' ||
              coalesce(kdi.surrounding_text, '')
            ) @@ (SELECT english_q FROM q)
            OR to_tsvector(
              'simple',
              coalesce(kdi.label, '') || ' ' ||
              coalesce(kdi.description, '') || ' ' ||
              coalesce(kdi.heading_path, '') || ' ' ||
              coalesce(kdi.step_hint, '') || ' ' ||
              coalesce(kdi.caption, '') || ' ' ||
              coalesce(kdi.alt_text, '') || ' ' ||
              coalesce(kdi.preceding_text, '') || ' ' ||
              coalesce(kdi.following_text, '') || ' ' ||
              coalesce(kdi.surrounding_text, '')
            ) @@ (SELECT simple_q FROM q)
            OR (
              coalesce(kdi.label, '') || ' ' ||
              coalesce(kdi.description, '') || ' ' ||
              coalesce(kdi.heading_path, '') || ' ' ||
              coalesce(kdi.step_hint, '') || ' ' ||
              coalesce(kdi.caption, '') || ' ' ||
              coalesce(kdi.alt_text, '') || ' ' ||
              coalesce(kdi.preceding_text, '') || ' ' ||
              coalesce(kdi.following_text, '') || ' ' ||
              coalesce(kdi.surrounding_text, '')
            ) ILIKE (SELECT ilike_q FROM q)
            OR similarity(
              lower(
                regexp_replace(
                  coalesce(kdi.label, '') || ' ' ||
                  coalesce(kdi.description, '') || ' ' ||
                  coalesce(kdi.heading_path, '') || ' ' ||
                  coalesce(kdi.step_hint, '') || ' ' ||
                  coalesce(kdi.caption, '') || ' ' ||
                  coalesce(kdi.alt_text, '') || ' ' ||
                  coalesce(kdi.preceding_text, '') || ' ' ||
                  coalesce(kdi.following_text, '') || ' ' ||
                  coalesce(kdi.surrounding_text, ''),
                  '\s+',
                  ' ',
                  'g'
                )
              ),
              (SELECT normalized_q FROM q)
            ) >= 0.1
          )
        ORDER BY score DESC, kdi.updated_at DESC
        LIMIT ${limit}
      `,
    );

    return rows.rows.map((row) => ({
      ...mapDocumentImage({
        id: row.id,
        documentId: row.document_id,
        groupId: row.group_id,
        versionId: row.version_id,
        kind: row.kind,
        ordinal: row.ordinal,
        marker: row.marker,
        label: row.label,
        description: row.description,
        headingPath: row.heading_path,
        stepHint: row.step_hint,
        storagePath: row.storage_path,
        sourceUrl: row.source_url,
        mediaType: row.media_type,
        pageNumber: row.page_number,
        width: row.width,
        height: row.height,
        altText: row.alt_text,
        caption: row.caption,
        surroundingText: row.surrounding_text,
        precedingText: row.preceding_text,
        followingText: row.following_text,
        isRenderable: row.is_renderable,
        manualLabel: row.manual_label,
        manualDescription: row.manual_description,
        embedding: null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      } as typeof KnowledgeDocumentImageTable.$inferSelect),
      score: Number(row.score),
    }));
  },

  async vectorSearchImages(groupId, embedding, limit, documentIds) {
    const { typedColumn, typedEmbedding, dimensionFilter } =
      buildTypedVectorComparison("kdi.embedding", embedding);
    const docFilter =
      documentIds && documentIds.length > 0
        ? sql`AND kdi.document_id IN (${sql.join(
            documentIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`
        : sql``;

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
      created_at: Date;
      updated_at: Date;
      score: number;
    }>(
      sql`
        SELECT
          kdi.id,
          kdi.document_id,
          kdi.group_id,
          kdi.version_id,
          kdi.kind,
          kdi.ordinal,
          kdi.marker,
          kdi.label,
          kdi.description,
          kdi.heading_path,
          kdi.step_hint,
          kdi.storage_path,
          kdi.source_url,
          kdi.media_type,
          kdi.page_number,
          kdi.width,
          kdi.height,
          kdi.alt_text,
          kdi.caption,
          kdi.surrounding_text,
          kdi.preceding_text,
          kdi.following_text,
          kdi.is_renderable,
          kdi.manual_label,
          kdi.manual_description,
          kdi.created_at,
          kdi.updated_at,
          1 - (${typedColumn} <=> ${typedEmbedding}) AS score
        FROM knowledge_document_image kdi
        WHERE kdi.group_id = ${groupId}
          AND kdi.is_renderable = true
          AND kdi.embedding IS NOT NULL
          AND ${dimensionFilter}
          ${docFilter}
        ORDER BY ${typedColumn} <=> ${typedEmbedding}
        LIMIT ${limit}
      `,
    );

    return rows.rows.map((row) => ({
      ...mapDocumentImage({
        id: row.id,
        documentId: row.document_id,
        groupId: row.group_id,
        versionId: row.version_id,
        kind: row.kind,
        ordinal: row.ordinal,
        marker: row.marker,
        label: row.label,
        description: row.description,
        headingPath: row.heading_path,
        stepHint: row.step_hint,
        storagePath: row.storage_path,
        sourceUrl: row.source_url,
        mediaType: row.media_type,
        pageNumber: row.page_number,
        width: row.width,
        height: row.height,
        altText: row.alt_text,
        caption: row.caption,
        surroundingText: row.surrounding_text,
        precedingText: row.preceding_text,
        followingText: row.following_text,
        isRenderable: row.is_renderable,
        manualLabel: row.manual_label,
        manualDescription: row.manual_description,
        embedding: null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      } as typeof KnowledgeDocumentImageTable.$inferSelect),
      score: Number(row.score),
    }));
  },

  // ─── Adjacent Chunk Expansion ────────────────────────────────────────────────

  async getAdjacentChunks(groupId, requests) {
    if (requests.length === 0) return [];

    // Build a VALUES-based filter for (document_id, chunk_index) pairs
    const conditions = requests.map(
      (r) => sql`(${r.documentId}::uuid, ${r.chunkIndex}::integer)`,
    );

    const rows = await db.execute<{
      id: string;
      document_id: string;
      group_id: string;
      section_id: string | null;
      content: string;
      context_summary: string | null;
      chunk_index: number;
      token_count: number;
      metadata: any;
      created_at: Date;
      document_name: string;
    }>(
      sql`
        SELECT
          kc.id, kc.document_id, kc.group_id, kc.section_id, kc.content, kc.context_summary,
          kc.chunk_index, kc.token_count, kc.metadata, kc.created_at,
          kd.name AS document_name
        FROM knowledge_chunk kc
        JOIN knowledge_document kd ON kd.id = kc.document_id
        WHERE kc.group_id = ${groupId}
          AND (kc.document_id, kc.chunk_index) IN (${sql.join(conditions, sql`, `)})
      `,
    );

    return rows.rows.map((r) => ({
      chunk: {
        id: r.id,
        documentId: r.document_id,
        groupId: r.group_id,
        sectionId: r.section_id,
        content: r.content,
        contextSummary: r.context_summary,
        chunkIndex: r.chunk_index,
        tokenCount: r.token_count,
        metadata: r.metadata,
        createdAt: r.created_at,
      } as KnowledgeChunk,
      documentName: r.document_name,
      documentId: r.document_id,
      score: 0,
    }));
  },

  // ─── Agent Links ─────────────────────────────────────────────────────────────

  async linkAgentToGroup(agentId, groupId) {
    await db
      .insert(KnowledgeGroupAgentTable)
      .values({ id: generateUUID(), agentId, groupId, createdAt: new Date() })
      .onConflictDoNothing();
  },

  async unlinkAgentFromGroup(agentId, groupId) {
    await db
      .delete(KnowledgeGroupAgentTable)
      .where(
        and(
          eq(KnowledgeGroupAgentTable.agentId, agentId),
          eq(KnowledgeGroupAgentTable.groupId, groupId),
        ),
      );
  },

  async getGroupsByAgentId(agentId) {
    const docCounts = db
      .select({
        groupId: KnowledgeDocumentTable.groupId,
        docCount: count(KnowledgeDocumentTable.id).as("doc_count"),
      })
      .from(KnowledgeDocumentTable)
      .groupBy(KnowledgeDocumentTable.groupId)
      .as("doc_counts");

    const chunkCounts = db
      .select({
        groupId: KnowledgeChunkTable.groupId,
        chunkCount: count(KnowledgeChunkTable.id).as("chunk_count"),
      })
      .from(KnowledgeChunkTable)
      .groupBy(KnowledgeChunkTable.groupId)
      .as("chunk_counts");

    const rows = await db
      .select({
        id: KnowledgeGroupTable.id,
        name: KnowledgeGroupTable.name,
        description: KnowledgeGroupTable.description,
        icon: KnowledgeGroupTable.icon,
        userId: KnowledgeGroupTable.userId,
        visibility: KnowledgeGroupTable.visibility,
        purpose: KnowledgeGroupTable.purpose,
        isSystemManaged: KnowledgeGroupTable.isSystemManaged,
        embeddingModel: KnowledgeGroupTable.embeddingModel,
        embeddingProvider: KnowledgeGroupTable.embeddingProvider,
        rerankingModel: KnowledgeGroupTable.rerankingModel,
        rerankingProvider: KnowledgeGroupTable.rerankingProvider,
        parseMode: KnowledgeGroupTable.parseMode,
        parseRepairPolicy: KnowledgeGroupTable.parseRepairPolicy,
        contextMode: KnowledgeGroupTable.contextMode,
        imageMode: KnowledgeGroupTable.imageMode,
        lazyRefinementEnabled: KnowledgeGroupTable.lazyRefinementEnabled,
        parsingModel: KnowledgeGroupTable.parsingModel,
        parsingProvider: KnowledgeGroupTable.parsingProvider,
        retrievalThreshold: KnowledgeGroupTable.retrievalThreshold,
        mcpEnabled: KnowledgeGroupTable.mcpEnabled,
        chunkSize: KnowledgeGroupTable.chunkSize,
        chunkOverlapPercent: KnowledgeGroupTable.chunkOverlapPercent,
        createdAt: KnowledgeGroupTable.createdAt,
        updatedAt: KnowledgeGroupTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
        documentCount: sql<number>`COALESCE(${docCounts.docCount}, 0)`,
        chunkCount: sql<number>`COALESCE(${chunkCounts.chunkCount}, 0)`,
      })
      .from(KnowledgeGroupAgentTable)
      .innerJoin(
        KnowledgeGroupTable,
        eq(KnowledgeGroupAgentTable.groupId, KnowledgeGroupTable.id),
      )
      .innerJoin(UserTable, eq(KnowledgeGroupTable.userId, UserTable.id))
      .leftJoin(docCounts, eq(KnowledgeGroupTable.id, docCounts.groupId))
      .leftJoin(chunkCounts, eq(KnowledgeGroupTable.id, chunkCounts.groupId))
      .where(eq(KnowledgeGroupAgentTable.agentId, agentId));

    return rows
      .map((r) => ({
        ...r,
        description: r.description ?? undefined,
        icon: r.icon ?? undefined,
        rerankingModel: r.rerankingModel ?? null,
        rerankingProvider: r.rerankingProvider ?? null,
        parseMode: r.parseMode ?? "always",
        parseRepairPolicy: r.parseRepairPolicy ?? "section-safe-reorder",
        contextMode: r.contextMode ?? "always-llm",
        imageMode: r.imageMode ?? "always",
        lazyRefinementEnabled: r.lazyRefinementEnabled ?? true,
        parsingModel: r.parsingModel ?? null,
        parsingProvider: r.parsingProvider ?? null,
        retrievalThreshold: r.retrievalThreshold ?? 0.0,
        userName: r.userName ?? undefined,
        userAvatar: r.userAvatar ?? null,
        documentCount: Number(r.documentCount),
        chunkCount: Number(r.chunkCount),
      }))
      .map((row) =>
        applyEnforcedKnowledgeIngestPolicy(row),
      ) as KnowledgeSummary[];
  },

  async getAgentsByGroupId(groupId) {
    const rows = await db
      .select({ agentId: KnowledgeGroupAgentTable.agentId })
      .from(KnowledgeGroupAgentTable)
      .where(eq(KnowledgeGroupAgentTable.groupId, groupId));
    return rows.map((r) => r.agentId);
  },

  // ─── Usage ───────────────────────────────────────────────────────────────────

  async insertUsageLog(data) {
    await db.insert(KnowledgeUsageLogTable).values({
      id: generateUUID(),
      groupId: data.groupId,
      userId: data.userId ?? null,
      query: data.query,
      source: data.source,
      chunksRetrieved: data.chunksRetrieved,
      latencyMs: data.latencyMs ?? null,
      metadata: data.metadata ?? null,
      createdAt: new Date(),
    });
  },

  async getUsageStats(groupId, days = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const totals = await db.execute<{
      total: number;
      unique_users: number;
      mcp_queries: number;
      avg_latency: number;
    }>(
      sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(DISTINCT user_id)::int AS unique_users,
          COUNT(*) FILTER (WHERE source = 'mcp')::int AS mcp_queries,
          AVG(latency_ms)::float AS avg_latency
        FROM knowledge_usage_log
        WHERE group_id = ${groupId}
          AND created_at >= ${since.toISOString()}
      `,
    );

    const recentRows = await db.execute<{
      id: string;
      query: string;
      source: string;
      chunks_retrieved: number;
      latency_ms: number | null;
      user_name: string | null;
      created_at: Date;
    }>(
      sql`
        SELECT kul.id, kul.query, kul.source, kul.chunks_retrieved,
               kul.latency_ms, u.name AS user_name, kul.created_at
        FROM knowledge_usage_log kul
        LEFT JOIN "user" u ON u.id = kul.user_id
        WHERE kul.group_id = ${groupId}
        ORDER BY kul.created_at DESC
        LIMIT 50
      `,
    );

    const dailyRows = await db.execute<{ date: string; cnt: number }>(
      sql`
        SELECT DATE(created_at)::text AS date, COUNT(*)::int AS cnt
        FROM knowledge_usage_log
        WHERE group_id = ${groupId}
          AND created_at >= ${since.toISOString()}
        GROUP BY DATE(created_at)
        ORDER BY date
      `,
    );

    const [
      storedEmbeddingTotals,
      processedEmbeddingTotals,
      recentEmbeddingTotals,
    ] = await Promise.all([
      db.execute<{ total_tokens: number }>(sql`
          SELECT COALESCE(SUM(embedding_token_count), 0)::int AS total_tokens
          FROM knowledge_document
          WHERE group_id = ${groupId}
            AND status = 'ready'
        `),
      db.execute<{ total_tokens: number }>(sql`
          SELECT COALESCE(SUM(
              CASE
              WHEN json_typeof(details) = 'object'
                AND (details->>'embeddingTokenCount') IS NOT NULL
              THEN (details->>'embeddingTokenCount')::numeric
              ELSE 0
            END
          ), 0)::int AS total_tokens
          FROM knowledge_document_history_event
          WHERE group_id = ${groupId}
        `),
      db.execute<{ total_tokens: number }>(sql`
          SELECT COALESCE(SUM(
              CASE
              WHEN json_typeof(details) = 'object'
                AND (details->>'embeddingTokenCount') IS NOT NULL
              THEN (details->>'embeddingTokenCount')::numeric
              ELSE 0
            END
          ), 0)::int AS total_tokens
          FROM knowledge_document_history_event
          WHERE group_id = ${groupId}
            AND created_at >= ${since.toISOString()}
        `),
    ]);

    const documentEmbeddingRows = await db.execute<{
      document_id: string;
      name: string;
      embedding_token_count: number;
      latest_version_number: number | null;
      updated_at: Date;
    }>(sql`
      SELECT
        id AS document_id,
        name,
        embedding_token_count,
        latest_version_number,
        updated_at
      FROM knowledge_document
      WHERE group_id = ${groupId}
        AND status = 'ready'
      ORDER BY embedding_token_count DESC, updated_at DESC
      LIMIT 50
    `);

    const t = totals.rows[0] ?? {
      total: 0,
      unique_users: 0,
      mcp_queries: 0,
      avg_latency: 0,
    };

    return {
      totalQueries: Number(t.total ?? 0),
      uniqueUsers: Number(t.unique_users ?? 0),
      mcpQueries: Number(t.mcp_queries ?? 0),
      avgLatencyMs: Math.round(Number(t.avg_latency ?? 0)),
      storedEmbeddingTokens: Number(
        storedEmbeddingTotals.rows[0]?.total_tokens ?? 0,
      ),
      processedEmbeddingTokens: Number(
        processedEmbeddingTotals.rows[0]?.total_tokens ?? 0,
      ),
      recentEmbeddingTokens: Number(
        recentEmbeddingTotals.rows[0]?.total_tokens ?? 0,
      ),
      documentEmbeddingUsage: documentEmbeddingRows.rows.map((row) => ({
        documentId: row.document_id,
        name: row.name,
        embeddingTokenCount: Number(row.embedding_token_count ?? 0),
        latestVersionNumber: row.latest_version_number ?? null,
        updatedAt: row.updated_at,
      })),
      recentQueries: recentRows.rows.map((r) => ({
        id: r.id,
        query: r.query,
        source: r.source as UsageSource,
        chunksRetrieved: Number(r.chunks_retrieved),
        latencyMs: r.latency_ms,
        userName: r.user_name,
        createdAt: r.created_at,
      })),
      dailyStats: dailyRows.rows.map((r) => ({
        date: r.date,
        count: Number(r.cnt),
      })),
    } satisfies KnowledgeUsageStats;
  },
};
