import {
  KnowledgeRepository,
  KnowledgeGroup,
  KnowledgeSummary,
  KnowledgeDocument,
  KnowledgeChunk,
  KnowledgeUsageStats,
  UsageSource,
} from "app-types/knowledge";
import { pgDb as db } from "../db.pg";
import {
  KnowledgeGroupTable,
  KnowledgeDocumentTable,
  KnowledgeChunkTable,
  KnowledgeGroupAgentTable,
  KnowledgeUsageLogTable,
  UserTable,
} from "../schema.pg";
import { and, desc, eq, ne, or, sql, count } from "drizzle-orm";
import { generateUUID } from "lib/utils";

function mapGroup(
  row: typeof KnowledgeGroupTable.$inferSelect,
): KnowledgeGroup {
  return {
    ...row,
    description: row.description ?? undefined,
    icon: row.icon ?? undefined,
    rerankingModel: row.rerankingModel ?? null,
    rerankingProvider: row.rerankingProvider ?? null,
    mcpApiKeyHash: row.mcpApiKeyHash ?? null,
    mcpApiKeyPreview: row.mcpApiKeyPreview ?? null,
  };
}

function mapDocument(
  row: typeof KnowledgeDocumentTable.$inferSelect,
): KnowledgeDocument {
  return {
    ...row,
    fileSize: row.fileSize ?? null,
    storagePath: row.storagePath ?? null,
    sourceUrl: row.sourceUrl ?? null,
    errorMessage: row.errorMessage ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? null,
  };
}

export const pgKnowledgeRepository: KnowledgeRepository = {
  // ─── Groups ─────────────────────────────────────────────────────────────────

  async insertGroup(data) {
    const [row] = await db
      .insert(KnowledgeGroupTable)
      .values({
        id: generateUUID(),
        name: data.name,
        description: data.description,
        icon: data.icon,
        userId: data.userId,
        visibility: data.visibility ?? "private",
        embeddingModel: data.embeddingModel ?? "text-embedding-3-small",
        embeddingProvider: data.embeddingProvider ?? "openai",
        rerankingModel: data.rerankingModel ?? null,
        rerankingProvider: data.rerankingProvider ?? null,
        mcpEnabled: false,
        chunkSize: data.chunkSize ?? 512,
        chunkOverlapPercent: data.chunkOverlapPercent ?? 20,
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

  async selectGroups(userId, filters = ["mine", "shared"]) {
    let whereCondition: any;

    if (filters.includes("mine") && filters.includes("shared")) {
      whereCondition = or(
        eq(KnowledgeGroupTable.userId, userId),
        and(
          ne(KnowledgeGroupTable.userId, userId),
          or(
            eq(KnowledgeGroupTable.visibility, "public"),
            eq(KnowledgeGroupTable.visibility, "readonly"),
          ),
        ),
      );
    } else if (filters.includes("mine")) {
      whereCondition = eq(KnowledgeGroupTable.userId, userId);
    } else {
      whereCondition = and(
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
        embeddingModel: KnowledgeGroupTable.embeddingModel,
        embeddingProvider: KnowledgeGroupTable.embeddingProvider,
        rerankingModel: KnowledgeGroupTable.rerankingModel,
        rerankingProvider: KnowledgeGroupTable.rerankingProvider,
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

    return rows.map((r) => ({
      ...r,
      description: r.description ?? undefined,
      icon: r.icon ?? undefined,
      rerankingModel: r.rerankingModel ?? null,
      rerankingProvider: r.rerankingProvider ?? null,
      userName: r.userName ?? undefined,
      userAvatar: r.userAvatar ?? null,
      documentCount: Number(r.documentCount),
      chunkCount: Number(r.chunkCount),
    })) as KnowledgeSummary[];
  },

  async updateGroup(id, userId, data) {
    const [row] = await db
      .update(KnowledgeGroupTable)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(KnowledgeGroupTable.id, id),
          eq(KnowledgeGroupTable.userId, userId),
        ),
      )
      .returning();
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
        originalFilename: data.originalFilename,
        fileType: data.fileType,
        fileSize: data.fileSize ?? null,
        storagePath: data.storagePath ?? null,
        sourceUrl: data.sourceUrl ?? null,
        status: (data as any).status ?? "pending",
        chunkCount: 0,
        tokenCount: 0,
        metadata: data.metadata ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return mapDocument(row);
  },

  async selectDocumentsByGroupId(groupId) {
    const rows = await db
      .select()
      .from(KnowledgeDocumentTable)
      .where(eq(KnowledgeDocumentTable.groupId, groupId))
      .orderBy(desc(KnowledgeDocumentTable.createdAt));
    return rows.map(mapDocument);
  },

  async selectDocumentById(id) {
    const [row] = await db
      .select()
      .from(KnowledgeDocumentTable)
      .where(eq(KnowledgeDocumentTable.id, id));
    if (!row) return null;
    return mapDocument(row);
  },

  async updateDocumentStatus(id, status, extra) {
    await db
      .update(KnowledgeDocumentTable)
      .set({
        status,
        errorMessage: extra?.errorMessage ?? null,
        ...(extra?.chunkCount !== undefined
          ? { chunkCount: extra.chunkCount }
          : {}),
        ...(extra?.tokenCount !== undefined
          ? { tokenCount: extra.tokenCount }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(KnowledgeDocumentTable.id, id));
  },

  async deleteDocument(id) {
    await db
      .delete(KnowledgeDocumentTable)
      .where(eq(KnowledgeDocumentTable.id, id));
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

  async vectorSearch(groupId, embedding, limit) {
    const embeddingStr = `[${embedding.join(",")}]`;
    const rows = await db.execute<{
      id: string;
      document_id: string;
      group_id: string;
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
          kc.id, kc.document_id, kc.group_id, kc.content, kc.context_summary,
          kc.chunk_index, kc.token_count, kc.metadata, kc.created_at,
          kd.name AS document_name,
          1 - (kc.embedding <=> ${embeddingStr}::vector) AS score
        FROM knowledge_chunk kc
        JOIN knowledge_document kd ON kd.id = kc.document_id
        WHERE kc.group_id = ${groupId}
          AND kc.embedding IS NOT NULL
        ORDER BY kc.embedding <=> ${embeddingStr}::vector
        LIMIT ${limit}
      `,
    );

    return rows.rows.map((r) => ({
      chunk: {
        id: r.id,
        documentId: r.document_id,
        groupId: r.group_id,
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

  async fullTextSearch(groupId, query, limit) {
    const rows = await db.execute<{
      id: string;
      document_id: string;
      group_id: string;
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
          kc.id, kc.document_id, kc.group_id, kc.content, kc.context_summary,
          kc.chunk_index, kc.token_count, kc.metadata, kc.created_at,
          kd.name AS document_name,
          ts_rank(kc.search_vector, plainto_tsquery('english', ${query})) AS score
        FROM knowledge_chunk kc
        JOIN knowledge_document kd ON kd.id = kc.document_id
        WHERE kc.group_id = ${groupId}
          AND kc.search_vector @@ plainto_tsquery('english', ${query})
        ORDER BY score DESC
        LIMIT ${limit}
      `,
    );

    return rows.rows.map((r) => ({
      chunk: {
        id: r.id,
        documentId: r.document_id,
        groupId: r.group_id,
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
        embeddingModel: KnowledgeGroupTable.embeddingModel,
        embeddingProvider: KnowledgeGroupTable.embeddingProvider,
        rerankingModel: KnowledgeGroupTable.rerankingModel,
        rerankingProvider: KnowledgeGroupTable.rerankingProvider,
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

    return rows.map((r) => ({
      ...r,
      description: r.description ?? undefined,
      icon: r.icon ?? undefined,
      rerankingModel: r.rerankingModel ?? null,
      rerankingProvider: r.rerankingProvider ?? null,
      userName: r.userName ?? undefined,
      userAvatar: r.userAvatar ?? null,
      documentCount: Number(r.documentCount),
      chunkCount: Number(r.chunkCount),
    })) as KnowledgeSummary[];
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
