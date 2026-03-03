import {
  AdminRepository,
  AdminUsersQuery,
  AdminUsersPaginated,
  UsageMonitoringData,
  UsageMonitoringQuery,
} from "app-types/admin";
import { pgDb as db } from "../db.pg";
import {
  UserTable,
  SessionTable,
  ChatThreadTable,
  ChatMessageTable,
} from "../schema.pg";
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

// Helper function to get user columns without password
const getUserColumnsWithoutPassword = () => {
  const { password, ...userColumns } = getTableColumns(UserTable);
  return userColumns;
};

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
        threadCount: sql<number>`COALESCE(COUNT(DISTINCT ${ChatThreadTable.id}), 0)`,
        messageCount: sql<number>`COALESCE(COUNT(${ChatMessageTable.id}), 0)`,
        totalTokens: sql<number>`COALESCE(SUM((${ChatMessageTable.metadata}->'usage'->>'totalTokens')::numeric), 0)`,
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
          ORDER BY SUM((${ChatMessageTable.metadata}->'usage'->>'totalTokens')::numeric) DESC
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
            ? sql`COUNT(${ChatMessageTable.id}) ASC`
            : sql`COUNT(${ChatMessageTable.id}) DESC`;
        break;
      case "threadCount":
        orderByClause =
          sortDirection === "asc"
            ? sql`COUNT(DISTINCT ${ChatThreadTable.id}) ASC`
            : sql`COUNT(DISTINCT ${ChatThreadTable.id}) DESC`;
        break;
      case "totalTokens":
      default:
        orderByClause =
          sortDirection === "asc"
            ? sql`COALESCE(SUM((${ChatMessageTable.metadata}->'usage'->>'totalTokens')::numeric), 0) ASC`
            : sql`COALESCE(SUM((${ChatMessageTable.metadata}->'usage'->>'totalTokens')::numeric), 0) DESC`;
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
        totalTokensSum: sql<number>`COALESCE(SUM((${ChatMessageTable.metadata}->'usage'->>'totalTokens')::numeric), 0)`,
        totalMessagesSum: sql<number>`COALESCE(COUNT(${ChatMessageTable.id}), 0)`,
        totalThreadsSum: sql<number>`COALESCE(COUNT(DISTINCT ${ChatThreadTable.id}), 0)`,
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

    return {
      users: users.map((u) => ({
        ...u,
        threadCount: Number(u.threadCount || 0),
        messageCount: Number(u.messageCount || 0),
        totalTokens: Number(u.totalTokens || 0),
        topModel: u.topModel ?? null,
      })),
      total: totalResult?.count || 0,
      limit,
      offset,
      totalTokensSum: Number(aggregates?.totalTokensSum || 0),
      totalMessagesSum: Number(aggregates?.totalMessagesSum || 0),
      totalThreadsSum: Number(aggregates?.totalThreadsSum || 0),
      activeUsersCount: Number(aggregates?.activeUsersCount || 0),
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
