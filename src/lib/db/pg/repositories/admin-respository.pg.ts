import {
  AdminRepository,
  AdminUsersPaginated,
  AdminUsersQuery,
  ModelUsageStat,
  UsageMonitoringData,
  UsageMonitoringQuery,
} from "app-types/admin";
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  ilike,
  or,
  sql,
} from "drizzle-orm";
import { pgDb as db } from "../db.pg";
import {
  ChatMessageTable,
  ChatThreadTable,
  LlmModelConfigTable,
  LlmProviderConfigTable,
  SessionTable,
  UserTable,
} from "../schema.pg";

// Helper function to get user columns without password
const getUserColumnsWithoutPassword = () => {
  const { password, ...userColumns } = getTableColumns(UserTable);
  return userColumns;
};

const messageTotalTokensSql = sql<number>`COALESCE((${ChatMessageTable.metadata}->'usage'->>'totalTokens')::numeric, 0)`;
const messageInputTokensSql = sql<number>`COALESCE((${ChatMessageTable.metadata}->'usage'->>'inputTokens')::numeric, 0)`;
const messageOutputTokensSql = sql<number>`COALESCE((${ChatMessageTable.metadata}->'usage'->>'outputTokens')::numeric, 0)`;
const messageModelNameSql = sql<
  string | null
>`${ChatMessageTable.metadata}->'chatModel'->>'model'`;
const messageProviderNameSql = sql<
  string | null
>`${ChatMessageTable.metadata}->'chatModel'->>'provider'`;

// Match the runtime model lookup: prefer an exact uiName match, then apiName.
const messageLiveCostUsdSql = sql<number>`ROUND(
  COALESCE(
    (
      SELECT
        (
          (${messageInputTokensSql} / 1000000.0)
          * ${LlmModelConfigTable.inputTokenPricePer1MUsd}
        )
        + (
          (${messageOutputTokensSql} / 1000000.0)
          * ${LlmModelConfigTable.outputTokenPricePer1MUsd}
        )
      FROM ${LlmModelConfigTable}
      INNER JOIN ${LlmProviderConfigTable}
        ON ${LlmModelConfigTable.providerId} = ${LlmProviderConfigTable.id}
      WHERE
        ${LlmProviderConfigTable.name} = ${messageProviderNameSql}
        AND ${LlmProviderConfigTable.enabled} = true
        AND ${LlmModelConfigTable.enabled} = true
        AND (
          ${LlmModelConfigTable.uiName} = ${messageModelNameSql}
          OR ${LlmModelConfigTable.apiName} = ${messageModelNameSql}
        )
      ORDER BY
        CASE
          WHEN ${LlmModelConfigTable.uiName} = ${messageModelNameSql}
            THEN 0
          ELSE 1
        END,
        ${LlmModelConfigTable.uiName}
      LIMIT 1
    ),
    0
  ),
  9
)`;
const totalMessageCountSql = sql<number>`COALESCE(COUNT(${ChatMessageTable.id}), 0)`;
const totalThreadCountSql = sql<number>`COALESCE(COUNT(DISTINCT ${ChatThreadTable.id}), 0)`;
const totalMessageTokensSql = sql<number>`COALESCE(SUM(${messageTotalTokensSql}), 0)`;
const totalMessageCostUsdSql = sql<number>`COALESCE(SUM(${messageLiveCostUsdSql}), 0)`;

const pgAdminRepository: AdminRepository = {
  getUsers: async (query?: AdminUsersQuery): Promise<AdminUsersPaginated> => {
    const {
      searchValue,
      limit = 10,
      offset = 0,
      sortBy = "createdAt",
      sortDirection = "desc",
      filterField,
      filterValue,
      filterOperator = "eq",
    } = query || {};

    // Base query with user columns (excluding password) and last login
    const baseQuery = db
      .select({
        ...getUserColumnsWithoutPassword(),
        lastLogin: sql<Date | null>`(
          SELECT MAX(${SessionTable.updatedAt}) 
          FROM ${SessionTable} 
          WHERE ${SessionTable.userId} = ${UserTable.id}
        )`.as("lastLogin"),
      })
      .from(UserTable);

    // Build WHERE conditions
    const whereConditions: any[] = [];

    // Search across multiple fields (case insensitive)
    if (searchValue && searchValue.trim()) {
      const searchTerm = `%${searchValue.trim()}%`;
      whereConditions.push(
        or(
          ilike(UserTable.name, searchTerm),
          ilike(UserTable.email, searchTerm),
        ),
      );
    }

    // Apply filters
    if (filterField && filterValue !== undefined) {
      const filterCondition = buildFilterCondition(
        filterField,
        filterValue,
        filterOperator,
      );
      if (filterCondition) {
        whereConditions.push(filterCondition);
      }
    }

    // Build the final WHERE clause
    const whereClause =
      whereConditions.length > 0
        ? whereConditions.length === 1
          ? whereConditions[0]
          : and(...whereConditions)
        : undefined;

    // Build ORDER BY
    const orderByClause = buildOrderBy(sortBy, sortDirection);

    // Execute main query
    const usersQueryBuilder = baseQuery
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);
    const users = whereClause
      ? await usersQueryBuilder.where(whereClause)
      : await usersQueryBuilder;

    // Get total count with same WHERE conditions
    const countQueryBuilder = db.select({ count: count() }).from(UserTable);
    const [totalResult] = whereClause
      ? await countQueryBuilder.where(whereClause)
      : await countQueryBuilder;

    return {
      users: users.map((user) => ({
        ...user,
        preferences: undefined, // Exclude preferences from admin list
      })),
      total: totalResult?.count || 0,
      limit,
      offset,
    };
  },

  getUsersUsage: async (
    query?: UsageMonitoringQuery,
  ): Promise<UsageMonitoringData> => {
    const {
      startDate,
      endDate,
      limit = 20,
      offset = 0,
      sortBy = "totalTokens",
      sortDirection = "desc",
      searchValue,
    } = query || {};

    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setDate(defaultStart.getDate() - 7);
    defaultStart.setHours(0, 0, 0, 0);

    const rangeStart = startDate ?? defaultStart;
    const rangeEnd = endDate ?? now;

    // Build search condition
    const searchCondition =
      searchValue && searchValue.trim()
        ? or(
            ilike(UserTable.name, `%${searchValue.trim()}%`),
            ilike(UserTable.email, `%${searchValue.trim()}%`),
          )
        : undefined;

    // Aggregate usage per user within the date range
    const usageQuery = db
      .select({
        userId: UserTable.id,
        name: UserTable.name,
        email: UserTable.email,
        image: UserTable.image,
        role: UserTable.role,
        threadCount: totalThreadCountSql,
        messageCount: totalMessageCountSql,
        totalTokens: totalMessageTokensSql,
        totalCostUsd: totalMessageCostUsdSql,
        topModel: sql<string | null>`(
          SELECT ${ChatMessageTable.metadata}->'chatModel'->>'model'
          FROM ${ChatMessageTable}
          JOIN ${ChatThreadTable} AS ct2 ON ${ChatMessageTable.threadId} = ct2.id
          WHERE ct2.user_id = ${UserTable.id}
            AND ${ChatMessageTable.createdAt} >= ${rangeStart}
            AND ${ChatMessageTable.createdAt} <= ${rangeEnd}
            AND ${ChatMessageTable.metadata} IS NOT NULL
            AND ${ChatMessageTable.metadata}->'chatModel'->>'model' IS NOT NULL
          GROUP BY ${ChatMessageTable.metadata}->'chatModel'->>'model'
          ORDER BY SUM(${messageTotalTokensSql}) DESC
          LIMIT 1
        )`,
      })
      .from(UserTable)
      .leftJoin(
        ChatThreadTable,
        and(
          eq(ChatThreadTable.userId, UserTable.id),
          sql`${ChatThreadTable.createdAt} >= ${rangeStart}`,
          sql`${ChatThreadTable.createdAt} <= ${rangeEnd}`,
        ),
      )
      .leftJoin(
        ChatMessageTable,
        and(
          eq(ChatMessageTable.threadId, ChatThreadTable.id),
          sql`${ChatMessageTable.createdAt} >= ${rangeStart}`,
          sql`${ChatMessageTable.createdAt} <= ${rangeEnd}`,
        ),
      )
      .groupBy(
        UserTable.id,
        UserTable.name,
        UserTable.email,
        UserTable.image,
        UserTable.role,
      );

    // Build ORDER BY for usage query
    let orderByClause;
    switch (sortBy) {
      case "name":
        orderByClause =
          sortDirection === "asc" ? asc(UserTable.name) : desc(UserTable.name);
        break;
      case "email":
        orderByClause =
          sortDirection === "asc"
            ? asc(UserTable.email)
            : desc(UserTable.email);
        break;
      case "messageCount":
        orderByClause =
          sortDirection === "asc"
            ? sql`${totalMessageCountSql} ASC`
            : sql`${totalMessageCountSql} DESC`;
        break;
      case "totalCostUsd":
        orderByClause =
          sortDirection === "asc"
            ? sql`${totalMessageCostUsdSql} ASC`
            : sql`${totalMessageCostUsdSql} DESC`;
        break;
      case "threadCount":
        orderByClause =
          sortDirection === "asc"
            ? sql`${totalThreadCountSql} ASC`
            : sql`${totalThreadCountSql} DESC`;
        break;
      case "totalTokens":
      default:
        orderByClause =
          sortDirection === "asc"
            ? sql`${totalMessageTokensSql} ASC`
            : sql`${totalMessageTokensSql} DESC`;
        break;
    }

    const users = await (searchCondition
      ? usageQuery.where(searchCondition)
      : usageQuery
    )
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);

    // Count total users matching search
    const countBase = db.select({ count: count() }).from(UserTable);
    const [totalResult] = searchCondition
      ? await countBase.where(searchCondition)
      : await countBase;

    // Aggregated totals across all users in the date range
    const [aggregates] = await db
      .select({
        totalTokensSum: totalMessageTokensSql,
        totalCostSum: totalMessageCostUsdSql,
        totalMessagesSum: totalMessageCountSql,
        totalThreadsSum: totalThreadCountSql,
        activeUsersCount: sql<number>`COUNT(DISTINCT ${ChatThreadTable.userId})`,
      })
      .from(ChatThreadTable)
      .leftJoin(
        ChatMessageTable,
        eq(ChatMessageTable.threadId, ChatThreadTable.id),
      )
      .where(
        and(
          sql`${ChatThreadTable.createdAt} >= ${rangeStart}`,
          sql`${ChatThreadTable.createdAt} <= ${rangeEnd}`,
        ),
      );

    // Model distribution: top models by token usage in the date range
    const modelDistributionRaw = await db
      .select({
        model: sql<string>`${ChatMessageTable.metadata}->'chatModel'->>'model'`,
        totalTokens: totalMessageTokensSql,
        messageCount: sql<number>`COUNT(${ChatMessageTable.id})`,
      })
      .from(ChatMessageTable)
      .innerJoin(
        ChatThreadTable,
        eq(ChatMessageTable.threadId, ChatThreadTable.id),
      )
      .where(
        and(
          sql`${ChatMessageTable.createdAt} >= ${rangeStart}`,
          sql`${ChatMessageTable.createdAt} <= ${rangeEnd}`,
          sql`${ChatMessageTable.metadata}->'chatModel'->>'model' IS NOT NULL`,
        ),
      )
      .groupBy(sql`${ChatMessageTable.metadata}->'chatModel'->>'model'`)
      .orderBy(sql`${totalMessageTokensSql} DESC`)
      .limit(10);

    const modelDistribution: ModelUsageStat[] = modelDistributionRaw
      .filter((r) => r.model)
      .map((r) => ({
        model: r.model,
        totalTokens: Number(r.totalTokens || 0),
        messageCount: Number(r.messageCount || 0),
      }));

    return {
      users: users.map((u) => ({
        ...u,
        threadCount: Number(u.threadCount || 0),
        messageCount: Number(u.messageCount || 0),
        totalTokens: Number(u.totalTokens || 0),
        totalCostUsd: Number(u.totalCostUsd || 0),
        topModel: u.topModel ?? null,
      })),
      total: totalResult?.count || 0,
      limit,
      offset,
      totalTokensSum: Number(aggregates?.totalTokensSum || 0),
      totalCostUsd: Number(aggregates?.totalCostSum || 0),
      totalMessagesSum: Number(aggregates?.totalMessagesSum || 0),
      totalThreadsSum: Number(aggregates?.totalThreadsSum || 0),
      activeUsersCount: Number(aggregates?.activeUsersCount || 0),
      modelDistribution,
    };
  },
};

// Helper function to build filter conditions
function buildFilterCondition(
  field: string,
  value: string | number | boolean,
  operator: string,
) {
  // Map common field names to actual columns
  let column;
  switch (field) {
    case "name":
      column = UserTable.name;
      break;
    case "email":
      column = UserTable.email;
      break;
    case "role":
      column = UserTable.role;
      break;
    case "banned":
      column = UserTable.banned;
      break;
    case "createdAt":
      column = UserTable.createdAt;
      break;
    case "updatedAt":
      column = UserTable.updatedAt;
      break;
    default:
      return null; // Unknown field
  }

  switch (operator) {
    case "eq":
      return eq(column, value);
    case "ne":
      return sql`${column} != ${value}`;
    case "lt":
      return sql`${column} < ${value}`;
    case "lte":
      return sql`${column} <= ${value}`;
    case "gt":
      return sql`${column} > ${value}`;
    case "gte":
      return sql`${column} >= ${value}`;
    case "contains":
      return ilike(column, `%${value}%`);
    default:
      return eq(column, value);
  }
}

// Helper function to build ORDER BY clause
function buildOrderBy(sortBy: string, direction: "asc" | "desc") {
  // Map common sort fields to actual columns
  let column;
  switch (sortBy) {
    case "name":
      column = UserTable.name;
      break;
    case "email":
      column = UserTable.email;
      break;
    case "role":
      column = UserTable.role;
      break;
    case "createdAt":
      column = UserTable.createdAt;
      break;
    case "updatedAt":
      column = UserTable.updatedAt;
      break;
    default:
      // Default to createdAt if invalid sortBy
      column = UserTable.createdAt;
      break;
  }
  return direction === "asc" ? asc(column) : desc(column);
}

export default pgAdminRepository;
