import type {
  AdminDashboardBreakdownItem,
  AdminDashboardBreakdownSection,
  AdminDashboardDetailData,
  AdminDashboardKind,
  AdminDashboardListData,
  AdminDashboardListItem,
  AdminDashboardQuery,
  AdminDashboardRecentItem,
  AdminDashboardRecentSection,
  AdminDashboardStat,
  AdminDashboardTimelinePoint,
} from "app-types/admin-dashboard";
import { type SQL, eq, sql } from "drizzle-orm";
import { ADMIN_DASHBOARD_TITLES } from "lib/admin/dashboard";
import { pgDb as db } from "../db.pg";
import {
  AdminUsageEventTable,
  AgentExternalUsageLogTable,
  AgentTable,
  ChatMessageTable,
  ChatThreadTable,
  KnowledgeChunkTable,
  KnowledgeDocumentTable,
  KnowledgeGroupAgentTable,
  KnowledgeGroupTable,
  KnowledgeSectionTable,
  KnowledgeUsageLogTable,
  McpServerTable,
  SkillAgentTable,
  SkillGroupAgentTable,
  SkillGroupSkillTable,
  SkillTable,
  SubAgentTable,
  TeamResourceShareTable,
  UserTable,
  WorkflowNodeDataTable,
  WorkflowTable,
} from "../schema.pg";

type CreatorFields = {
  creatorId: string;
  creatorName: string | null;
  creatorEmail: string | null;
  creatorImage: string | null;
};

type DetailHeaderBase = CreatorFields & {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type CountRow = {
  id: string;
  count: number | string | null;
};

type UsageRow = {
  resourceId: string;
  totalUsage: number | string | null;
  lastActiveAt: Date | string | null;
  uniqueUsers?: number | string | null;
};

interface AdminDashboardRepository {
  getList(
    kind: AdminDashboardKind,
    query: AdminDashboardQuery,
  ): Promise<AdminDashboardListData>;
  getDetail(
    kind: AdminDashboardKind,
    id: string,
    query: AdminDashboardQuery,
  ): Promise<AdminDashboardDetailData | null>;
}

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toIsoDateTime(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDayKey(value: unknown) {
  if (!value) return "";
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function fillTimeline(
  rows: Array<{ date: unknown; value: unknown }>,
  startDate: Date,
  endDate: Date,
): AdminDashboardTimelinePoint[] {
  const values = new Map(
    rows.map((row) => [toDayKey(row.date), toNumber(row.value)]),
  );
  const cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);
  const limit = new Date(endDate);
  limit.setHours(0, 0, 0, 0);
  const timeline: AdminDashboardTimelinePoint[] = [];

  while (cursor <= limit) {
    const key = cursor.toISOString().slice(0, 10);
    timeline.push({
      date: key,
      value: values.get(key) ?? 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return timeline;
}

function getCreatorName(row: CreatorFields) {
  return row.creatorName ?? row.creatorEmail ?? "Unknown User";
}

function getCreatorEmail(row: CreatorFields) {
  return row.creatorEmail ?? "";
}

function getLastActiveLabel(value: string | null) {
  return value ?? null;
}

function applySearch(items: AdminDashboardListItem[], searchValue?: string) {
  if (!searchValue) return items;
  const normalized = searchValue.trim().toLowerCase();
  if (!normalized) return items;

  return items.filter((item) =>
    [item.name, item.creatorName, item.creatorEmail, item.meta]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalized)),
  );
}

function compareNullableStrings(left?: string | null, right?: string | null) {
  const a = left ?? "";
  const b = right ?? "";
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function compareNullableDates(left?: string | null, right?: string | null) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return new Date(left).getTime() - new Date(right).getTime();
}

function sortListItems(
  items: AdminDashboardListItem[],
  sortBy: NonNullable<AdminDashboardQuery["sortBy"]> = "totalUsage",
  sortDirection: NonNullable<AdminDashboardQuery["sortDirection"]> = "desc",
) {
  const factor = sortDirection === "asc" ? 1 : -1;

  return [...items].sort((left, right) => {
    switch (sortBy) {
      case "name":
        return compareNullableStrings(left.name, right.name) * factor;
      case "creator":
        return (
          compareNullableStrings(left.creatorName, right.creatorName) * factor
        );
      case "lastActiveAt":
        return (
          compareNullableDates(left.lastActiveAt, right.lastActiveAt) * factor
        );
      case "totalUsage":
      default: {
        const delta = left.totalUsage - right.totalUsage;
        if (delta !== 0) {
          return delta * factor;
        }
        return compareNullableStrings(left.name, right.name) * factor;
      }
    }
  });
}

function paginateItems(
  items: AdminDashboardListItem[],
  limit = 10,
  offset = 0,
) {
  return items.slice(offset, offset + limit);
}

function buildListMetrics(
  kind: AdminDashboardKind,
  items: AdminDashboardListItem[],
): AdminDashboardStat[] {
  const totalUsage = items.reduce((sum, item) => sum + item.totalUsage, 0);
  const activeCount = items.filter((item) => item.totalUsage > 0).length;
  const topItem = [...items].sort(
    (left, right) => right.totalUsage - left.totalUsage,
  )[0];
  const labelPrefix =
    kind === "agent"
      ? "agents"
      : kind === "mcp"
        ? "servers"
        : kind === "contextx"
          ? "groups"
          : kind === "skill"
            ? "skills"
            : "workflows";

  return [
    {
      label: `Total ${labelPrefix}`,
      value: items.length,
    },
    {
      label: "Total active",
      value: activeCount,
    },
    {
      label: "Total usage",
      value: totalUsage,
    },
    {
      label: "Top usage",
      value: topItem?.totalUsage ?? 0,
      hint: topItem?.name,
    },
  ];
}

function buildHeader(row: DetailHeaderBase, badges: string[]) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    creatorId: row.creatorId,
    creatorName: getCreatorName(row),
    creatorEmail: getCreatorEmail(row),
    creatorImage: row.creatorImage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    badges,
    canDelete: true,
  };
}

function makeBreakdownSection(
  title: string,
  items: AdminDashboardBreakdownItem[],
): AdminDashboardBreakdownSection {
  return {
    title,
    items,
  };
}

function makeRecentSection(
  title: string,
  items: AdminDashboardRecentItem[],
): AdminDashboardRecentSection {
  return {
    title,
    items,
  };
}

function uuidParam(value: string) {
  return sql`${value}::uuid`;
}

async function queryRows<T extends Record<string, unknown>>(
  statement: SQL,
): Promise<T[]> {
  const result = await db.execute(statement);
  return result.rows as T[];
}

async function queryCountMap(statement: SQL) {
  const rows = await queryRows<CountRow>(statement);
  return new Map(rows.map((row) => [row.id, toNumber(row.count)]));
}

async function getAgentList(
  query: AdminDashboardQuery,
): Promise<AdminDashboardListData> {
  const [rows, usageRows] = await Promise.all([
    db
      .select({
        id: AgentTable.id,
        name: AgentTable.name,
        visibility: AgentTable.visibility,
        agentType: AgentTable.agentType,
        creatorId: UserTable.id,
        creatorName: UserTable.name,
        creatorEmail: UserTable.email,
        creatorImage: UserTable.image,
      })
      .from(AgentTable)
      .innerJoin(UserTable, eq(AgentTable.userId, UserTable.id)),
    queryRows<UsageRow>(sql`
      WITH in_app_usage AS (
        SELECT
          (${ChatMessageTable.metadata}->>'agentId') AS resource_id,
          COUNT(*)::int AS total_usage,
          MAX(${ChatMessageTable.createdAt}) AS last_active_at
        FROM ${ChatMessageTable}
        WHERE
          ${ChatMessageTable.role} = 'assistant'
          AND ${ChatMessageTable.metadata}->>'agentId' IS NOT NULL
          AND ${ChatMessageTable.createdAt} >= ${query.startDate}
          AND ${ChatMessageTable.createdAt} <= ${query.endDate}
        GROUP BY 1
      ),
      external_usage AS (
        SELECT
          CAST(${AgentExternalUsageLogTable.agentId} AS text) AS resource_id,
          COUNT(*)::int AS total_usage,
          MAX(${AgentExternalUsageLogTable.createdAt}) AS last_active_at
        FROM ${AgentExternalUsageLogTable}
        WHERE
          ${AgentExternalUsageLogTable.createdAt} >= ${query.startDate}
          AND ${AgentExternalUsageLogTable.createdAt} <= ${query.endDate}
        GROUP BY 1
      )
      SELECT
        COALESCE(in_app_usage.resource_id, external_usage.resource_id) AS "resourceId",
        (
          COALESCE(in_app_usage.total_usage, 0) +
          COALESCE(external_usage.total_usage, 0)
        )::int AS "totalUsage",
        CASE
          WHEN in_app_usage.last_active_at IS NULL THEN external_usage.last_active_at
          WHEN external_usage.last_active_at IS NULL THEN in_app_usage.last_active_at
          ELSE GREATEST(in_app_usage.last_active_at, external_usage.last_active_at)
        END AS "lastActiveAt"
      FROM in_app_usage
      FULL OUTER JOIN external_usage
        ON external_usage.resource_id = in_app_usage.resource_id
    `),
  ]);

  const usageMap = new Map(
    usageRows.map((row) => [
      row.resourceId,
      {
        totalUsage: toNumber(row.totalUsage),
        lastActiveAt: toIsoDateTime(row.lastActiveAt),
      },
    ]),
  );

  const items = rows.map((row) => {
    const usage = usageMap.get(row.id);
    return {
      id: row.id,
      name: row.name,
      totalUsage: usage?.totalUsage ?? 0,
      creatorId: row.creatorId,
      creatorName: getCreatorName(row),
      creatorEmail: getCreatorEmail(row),
      creatorImage: row.creatorImage,
      lastActiveAt: getLastActiveLabel(usage?.lastActiveAt ?? null),
      badges: [row.visibility, row.agentType],
      meta: `${row.visibility} • ${row.agentType}`,
    } satisfies AdminDashboardListItem;
  });

  const filteredItems = sortListItems(
    applySearch(items, query.searchValue),
    query.sortBy,
    query.sortDirection,
  );

  return {
    kind: "agent",
    title: ADMIN_DASHBOARD_TITLES.agent,
    usageLabel: "Total usage",
    metrics: buildListMetrics("agent", filteredItems),
    items: paginateItems(filteredItems, query.limit, query.offset),
    total: filteredItems.length,
    limit: query.limit ?? filteredItems.length,
    offset: query.offset ?? 0,
  };
}

async function getMcpList(
  query: AdminDashboardQuery,
): Promise<AdminDashboardListData> {
  const [rows, usageRows] = await Promise.all([
    db
      .select({
        id: McpServerTable.id,
        name: McpServerTable.name,
        visibility: McpServerTable.visibility,
        publishEnabled: McpServerTable.publishEnabled,
        lastConnectionStatus: McpServerTable.lastConnectionStatus,
        toolInfo: McpServerTable.toolInfo,
        creatorId: UserTable.id,
        creatorName: UserTable.name,
        creatorEmail: UserTable.email,
        creatorImage: UserTable.image,
      })
      .from(McpServerTable)
      .innerJoin(UserTable, eq(McpServerTable.userId, UserTable.id)),
    queryRows<UsageRow>(sql`
      SELECT
        ${AdminUsageEventTable.resourceId} AS "resourceId",
        COUNT(*)::int AS "totalUsage",
        MAX(${AdminUsageEventTable.createdAt}) AS "lastActiveAt"
      FROM ${AdminUsageEventTable}
      WHERE
        ${AdminUsageEventTable.resourceType} = 'mcp'
        AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
        AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
      GROUP BY 1
    `),
  ]);

  const usageMap = new Map(
    usageRows.map((row) => [
      row.resourceId,
      {
        totalUsage: toNumber(row.totalUsage),
        lastActiveAt: toIsoDateTime(row.lastActiveAt),
      },
    ]),
  );

  const items = rows.map((row) => {
    const usage = usageMap.get(row.id);
    const toolCount = Array.isArray(row.toolInfo) ? row.toolInfo.length : 0;
    return {
      id: row.id,
      name: row.name,
      totalUsage: usage?.totalUsage ?? 0,
      creatorId: row.creatorId,
      creatorName: getCreatorName(row),
      creatorEmail: getCreatorEmail(row),
      creatorImage: row.creatorImage,
      lastActiveAt: getLastActiveLabel(usage?.lastActiveAt ?? null),
      badges: [
        row.visibility,
        row.publishEnabled ? "published" : "unpublished",
      ],
      meta: `${row.lastConnectionStatus ?? "unknown"} • ${toolCount} tools`,
    } satisfies AdminDashboardListItem;
  });

  const filteredItems = sortListItems(
    applySearch(items, query.searchValue),
    query.sortBy,
    query.sortDirection,
  );

  return {
    kind: "mcp",
    title: ADMIN_DASHBOARD_TITLES.mcp,
    usageLabel: "Total usage",
    metrics: buildListMetrics("mcp", filteredItems),
    items: paginateItems(filteredItems, query.limit, query.offset),
    total: filteredItems.length,
    limit: query.limit ?? filteredItems.length,
    offset: query.offset ?? 0,
  };
}

async function getContextxList(
  query: AdminDashboardQuery,
): Promise<AdminDashboardListData> {
  const [rows, usageRows, docCounts] = await Promise.all([
    db
      .select({
        id: KnowledgeGroupTable.id,
        name: KnowledgeGroupTable.name,
        visibility: KnowledgeGroupTable.visibility,
        purpose: KnowledgeGroupTable.purpose,
        creatorId: UserTable.id,
        creatorName: UserTable.name,
        creatorEmail: UserTable.email,
        creatorImage: UserTable.image,
      })
      .from(KnowledgeGroupTable)
      .innerJoin(UserTable, eq(KnowledgeGroupTable.userId, UserTable.id)),
    queryRows<UsageRow>(sql`
      SELECT
        ${KnowledgeUsageLogTable.groupId} AS "resourceId",
        COUNT(*)::int AS "totalUsage",
        MAX(${KnowledgeUsageLogTable.createdAt}) AS "lastActiveAt",
        COUNT(DISTINCT ${KnowledgeUsageLogTable.userId})::int AS "uniqueUsers"
      FROM ${KnowledgeUsageLogTable}
      WHERE
        ${KnowledgeUsageLogTable.createdAt} >= ${query.startDate}
        AND ${KnowledgeUsageLogTable.createdAt} <= ${query.endDate}
      GROUP BY 1
    `),
    queryCountMap(sql`
      SELECT
        ${KnowledgeDocumentTable.groupId} AS id,
        COUNT(*)::int AS count
      FROM ${KnowledgeDocumentTable}
      GROUP BY 1
    `),
  ]);

  const usageMap = new Map(
    usageRows.map((row) => [
      row.resourceId,
      {
        totalUsage: toNumber(row.totalUsage),
        lastActiveAt: toIsoDateTime(row.lastActiveAt),
        uniqueUsers: toNumber(row.uniqueUsers),
      },
    ]),
  );

  const items = rows.map((row) => {
    const usage = usageMap.get(row.id);
    const documentCount = docCounts.get(row.id) ?? 0;
    return {
      id: row.id,
      name: row.name,
      totalUsage: usage?.totalUsage ?? 0,
      creatorId: row.creatorId,
      creatorName: getCreatorName(row),
      creatorEmail: getCreatorEmail(row),
      creatorImage: row.creatorImage,
      lastActiveAt: getLastActiveLabel(usage?.lastActiveAt ?? null),
      badges: [row.visibility, row.purpose],
      meta: `${documentCount} docs • ${usage?.uniqueUsers ?? 0} users`,
    } satisfies AdminDashboardListItem;
  });

  const filteredItems = sortListItems(
    applySearch(items, query.searchValue),
    query.sortBy,
    query.sortDirection,
  );

  return {
    kind: "contextx",
    title: ADMIN_DASHBOARD_TITLES.contextx,
    usageLabel: "Total usage",
    metrics: buildListMetrics("contextx", filteredItems),
    items: paginateItems(filteredItems, query.limit, query.offset),
    total: filteredItems.length,
    limit: query.limit ?? filteredItems.length,
    offset: query.offset ?? 0,
  };
}

async function getSkillList(
  query: AdminDashboardQuery,
): Promise<AdminDashboardListData> {
  const [rows, usageRows, attachedAgentCounts] = await Promise.all([
    db
      .select({
        id: SkillTable.id,
        name: SkillTable.title,
        visibility: SkillTable.visibility,
        creatorId: UserTable.id,
        creatorName: UserTable.name,
        creatorEmail: UserTable.email,
        creatorImage: UserTable.image,
      })
      .from(SkillTable)
      .innerJoin(UserTable, eq(SkillTable.userId, UserTable.id)),
    queryRows<UsageRow>(sql`
      SELECT
        ${AdminUsageEventTable.resourceId} AS "resourceId",
        COUNT(*)::int AS "totalUsage",
        MAX(${AdminUsageEventTable.createdAt}) AS "lastActiveAt"
      FROM ${AdminUsageEventTable}
      WHERE
        ${AdminUsageEventTable.resourceType} = 'skill'
        AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
        AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
      GROUP BY 1
    `),
    queryCountMap(sql`
      SELECT
        ${SkillAgentTable.skillId} AS id,
        COUNT(*)::int AS count
      FROM ${SkillAgentTable}
      GROUP BY 1
    `),
  ]);

  const usageMap = new Map(
    usageRows.map((row) => [
      row.resourceId,
      {
        totalUsage: toNumber(row.totalUsage),
        lastActiveAt: toIsoDateTime(row.lastActiveAt),
      },
    ]),
  );

  const items = rows.map((row) => {
    const usage = usageMap.get(row.id);
    const attachedAgentCount = attachedAgentCounts.get(row.id) ?? 0;
    return {
      id: row.id,
      name: row.name,
      totalUsage: usage?.totalUsage ?? 0,
      creatorId: row.creatorId,
      creatorName: getCreatorName(row),
      creatorEmail: getCreatorEmail(row),
      creatorImage: row.creatorImage,
      lastActiveAt: getLastActiveLabel(usage?.lastActiveAt ?? null),
      badges: [row.visibility],
      meta: `${attachedAgentCount} attached agents`,
    } satisfies AdminDashboardListItem;
  });

  const filteredItems = sortListItems(
    applySearch(items, query.searchValue),
    query.sortBy,
    query.sortDirection,
  );

  return {
    kind: "skill",
    title: ADMIN_DASHBOARD_TITLES.skill,
    usageLabel: "Total usage",
    metrics: buildListMetrics("skill", filteredItems),
    items: paginateItems(filteredItems, query.limit, query.offset),
    total: filteredItems.length,
    limit: query.limit ?? filteredItems.length,
    offset: query.offset ?? 0,
  };
}

async function getWorkflowList(
  query: AdminDashboardQuery,
): Promise<AdminDashboardListData> {
  const [rows, usageRows, nodeCounts] = await Promise.all([
    db
      .select({
        id: WorkflowTable.id,
        name: WorkflowTable.name,
        visibility: WorkflowTable.visibility,
        isPublished: WorkflowTable.isPublished,
        creatorId: UserTable.id,
        creatorName: UserTable.name,
        creatorEmail: UserTable.email,
        creatorImage: UserTable.image,
      })
      .from(WorkflowTable)
      .innerJoin(UserTable, eq(WorkflowTable.userId, UserTable.id)),
    queryRows<UsageRow>(sql`
      SELECT
        ${AdminUsageEventTable.resourceId} AS "resourceId",
        COUNT(*)::int AS "totalUsage",
        MAX(${AdminUsageEventTable.createdAt}) AS "lastActiveAt"
      FROM ${AdminUsageEventTable}
      WHERE
        ${AdminUsageEventTable.resourceType} = 'workflow'
        AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
        AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
      GROUP BY 1
    `),
    queryCountMap(sql`
      SELECT
        ${WorkflowNodeDataTable.workflowId} AS id,
        COUNT(*)::int AS count
      FROM ${WorkflowNodeDataTable}
      GROUP BY 1
    `),
  ]);

  const usageMap = new Map(
    usageRows.map((row) => [
      row.resourceId,
      {
        totalUsage: toNumber(row.totalUsage),
        lastActiveAt: toIsoDateTime(row.lastActiveAt),
      },
    ]),
  );

  const items = rows.map((row) => {
    const usage = usageMap.get(row.id);
    const nodeCount = nodeCounts.get(row.id) ?? 0;
    return {
      id: row.id,
      name: row.name,
      totalUsage: usage?.totalUsage ?? 0,
      creatorId: row.creatorId,
      creatorName: getCreatorName(row),
      creatorEmail: getCreatorEmail(row),
      creatorImage: row.creatorImage,
      lastActiveAt: getLastActiveLabel(usage?.lastActiveAt ?? null),
      badges: [row.visibility, row.isPublished ? "published" : "draft"],
      meta: `${nodeCount} nodes`,
    } satisfies AdminDashboardListItem;
  });

  const filteredItems = sortListItems(
    applySearch(items, query.searchValue),
    query.sortBy,
    query.sortDirection,
  );

  return {
    kind: "workflow",
    title: ADMIN_DASHBOARD_TITLES.workflow,
    usageLabel: "Total usage",
    metrics: buildListMetrics("workflow", filteredItems),
    items: paginateItems(filteredItems, query.limit, query.offset),
    total: filteredItems.length,
    limit: query.limit ?? filteredItems.length,
    offset: query.offset ?? 0,
  };
}

async function getAgentDetail(
  id: string,
  query: AdminDashboardQuery,
): Promise<AdminDashboardDetailData | null> {
  const agentId = uuidParam(id);
  const [row] = await db
    .select({
      id: AgentTable.id,
      name: AgentTable.name,
      description: AgentTable.description,
      visibility: AgentTable.visibility,
      agentType: AgentTable.agentType,
      createdAt: AgentTable.createdAt,
      updatedAt: AgentTable.updatedAt,
      creatorId: UserTable.id,
      creatorName: UserTable.name,
      creatorEmail: UserTable.email,
      creatorImage: UserTable.image,
    })
    .from(AgentTable)
    .innerJoin(UserTable, eq(AgentTable.userId, UserTable.id))
    .where(eq(AgentTable.id, id));

  if (!row) return null;

  const [
    summaryRows,
    externalStatusRows,
    topUserRows,
    topModelRows,
    timelineRows,
    recentSessionRows,
    recentExternalRows,
    teamShareRows,
    knowledgeRows,
    skillRows,
    skillGroupRows,
    subAgentRows,
  ] = await Promise.all([
    queryRows<{
      inAppSessions: unknown;
      externalChatTurns: unknown;
      autocompleteRequests: unknown;
      totalTokens: unknown;
      uniqueUsers: unknown;
    }>(sql`
      WITH in_app AS (
        SELECT
          COUNT(DISTINCT ${ChatMessageTable.threadId})::int AS in_app_sessions,
          COUNT(DISTINCT ${ChatThreadTable.userId})::int AS unique_users,
          COALESCE(SUM(((${ChatMessageTable.metadata}->'usage'->>'totalTokens')::numeric)), 0)::bigint AS total_tokens
        FROM ${ChatMessageTable}
        INNER JOIN ${ChatThreadTable}
          ON ${ChatMessageTable.threadId} = ${ChatThreadTable.id}
        WHERE
          ${ChatMessageTable.role} = 'assistant'
          AND ${ChatMessageTable.metadata}->>'agentId' = ${id}
          AND ${ChatMessageTable.createdAt} >= ${query.startDate}
          AND ${ChatMessageTable.createdAt} <= ${query.endDate}
      ),
      external_usage AS (
        SELECT
          COUNT(*) FILTER (WHERE ${AgentExternalUsageLogTable.kind} = 'chat_turn')::int AS external_chat_turns,
          COUNT(*) FILTER (WHERE ${AgentExternalUsageLogTable.kind} = 'autocomplete_request')::int AS autocomplete_requests,
          COALESCE(SUM(${AgentExternalUsageLogTable.totalTokens}), 0)::bigint AS total_tokens
        FROM ${AgentExternalUsageLogTable}
        WHERE
          ${AgentExternalUsageLogTable.agentId} = ${agentId}
          AND ${AgentExternalUsageLogTable.createdAt} >= ${query.startDate}
          AND ${AgentExternalUsageLogTable.createdAt} <= ${query.endDate}
      )
      SELECT
        in_app.in_app_sessions AS "inAppSessions",
        external_usage.external_chat_turns AS "externalChatTurns",
        external_usage.autocomplete_requests AS "autocompleteRequests",
        (COALESCE(in_app.total_tokens, 0) + COALESCE(external_usage.total_tokens, 0))::bigint AS "totalTokens",
        in_app.unique_users AS "uniqueUsers"
      FROM in_app, external_usage
    `),
    queryRows<{ label: string | null; value: unknown }>(sql`
      SELECT
        ${AgentExternalUsageLogTable.status} AS label,
        COUNT(*)::int AS value
      FROM ${AgentExternalUsageLogTable}
      WHERE
        ${AgentExternalUsageLogTable.agentId} = ${agentId}
        AND ${AgentExternalUsageLogTable.createdAt} >= ${query.startDate}
        AND ${AgentExternalUsageLogTable.createdAt} <= ${query.endDate}
      GROUP BY 1
      ORDER BY value DESC
    `),
    queryRows<{
      label: string | null;
      secondary: string | null;
      value: unknown;
    }>(
      sql`
        SELECT
          COALESCE(${UserTable.name}, ${UserTable.email}, 'Unknown User') AS label,
          ${UserTable.email} AS secondary,
          COUNT(*)::int AS value
        FROM ${ChatMessageTable}
        INNER JOIN ${ChatThreadTable}
          ON ${ChatMessageTable.threadId} = ${ChatThreadTable.id}
        LEFT JOIN ${UserTable}
          ON ${ChatThreadTable.userId} = ${UserTable.id}
        WHERE
          ${ChatMessageTable.role} = 'assistant'
          AND ${ChatMessageTable.metadata}->>'agentId' = ${id}
          AND ${ChatMessageTable.createdAt} >= ${query.startDate}
          AND ${ChatMessageTable.createdAt} <= ${query.endDate}
        GROUP BY ${ChatThreadTable.userId}, ${UserTable.name}, ${UserTable.email}
        ORDER BY value DESC, label ASC
        LIMIT 5
      `,
    ),
    queryRows<{ label: string | null; value: unknown }>(sql`
      WITH model_usage AS (
        SELECT
          ${ChatMessageTable.metadata}->'chatModel'->>'model' AS model_name,
          COUNT(*)::int AS value
        FROM ${ChatMessageTable}
        WHERE
          ${ChatMessageTable.role} = 'assistant'
          AND ${ChatMessageTable.metadata}->>'agentId' = ${id}
          AND ${ChatMessageTable.createdAt} >= ${query.startDate}
          AND ${ChatMessageTable.createdAt} <= ${query.endDate}
          AND ${ChatMessageTable.metadata}->'chatModel'->>'model' IS NOT NULL
        GROUP BY 1
        UNION ALL
        SELECT
          ${AgentExternalUsageLogTable.modelName} AS model_name,
          COUNT(*)::int AS value
        FROM ${AgentExternalUsageLogTable}
        WHERE
          ${AgentExternalUsageLogTable.agentId} = ${agentId}
          AND ${AgentExternalUsageLogTable.createdAt} >= ${query.startDate}
          AND ${AgentExternalUsageLogTable.createdAt} <= ${query.endDate}
          AND ${AgentExternalUsageLogTable.modelName} IS NOT NULL
        GROUP BY 1
      )
      SELECT
        model_name AS label,
        SUM(value)::int AS value
      FROM model_usage
      WHERE model_name IS NOT NULL
      GROUP BY 1
      ORDER BY value DESC, label ASC
      LIMIT 5
    `),
    queryRows<{ date: unknown; value: unknown }>(sql`
      WITH activity AS (
        SELECT
          DATE_TRUNC('day', ${ChatMessageTable.createdAt})::date AS day,
          COUNT(*)::int AS value
        FROM ${ChatMessageTable}
        WHERE
          ${ChatMessageTable.role} = 'assistant'
          AND ${ChatMessageTable.metadata}->>'agentId' = ${id}
          AND ${ChatMessageTable.createdAt} >= ${query.startDate}
          AND ${ChatMessageTable.createdAt} <= ${query.endDate}
        GROUP BY 1
        UNION ALL
        SELECT
          DATE_TRUNC('day', ${AgentExternalUsageLogTable.createdAt})::date AS day,
          COUNT(*)::int AS value
        FROM ${AgentExternalUsageLogTable}
        WHERE
          ${AgentExternalUsageLogTable.agentId} = ${agentId}
          AND ${AgentExternalUsageLogTable.createdAt} >= ${query.startDate}
          AND ${AgentExternalUsageLogTable.createdAt} <= ${query.endDate}
        GROUP BY 1
      )
      SELECT
        day AS date,
        SUM(value)::int AS value
      FROM activity
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    queryRows<{
      id: string;
      title: string | null;
      subtitle: string | null;
      occurredAt: unknown;
    }>(sql`
      SELECT
        recent.id,
        recent.title,
        recent.subtitle,
        recent.occurred_at AS "occurredAt"
      FROM (
        SELECT DISTINCT ON (${ChatThreadTable.id})
          ${ChatThreadTable.id} AS id,
          ${ChatThreadTable.title} AS title,
          COALESCE(${UserTable.name}, ${UserTable.email}, 'Unknown User') AS subtitle,
          ${ChatMessageTable.createdAt} AS occurred_at
        FROM ${ChatMessageTable}
        INNER JOIN ${ChatThreadTable}
          ON ${ChatMessageTable.threadId} = ${ChatThreadTable.id}
        LEFT JOIN ${UserTable}
          ON ${ChatThreadTable.userId} = ${UserTable.id}
        WHERE
          ${ChatMessageTable.role} = 'assistant'
          AND ${ChatMessageTable.metadata}->>'agentId' = ${id}
          AND ${ChatMessageTable.createdAt} >= ${query.startDate}
          AND ${ChatMessageTable.createdAt} <= ${query.endDate}
        ORDER BY ${ChatThreadTable.id}, ${ChatMessageTable.createdAt} DESC
      ) recent
      ORDER BY recent.occurred_at DESC
      LIMIT 5
    `),
    queryRows<{
      id: string;
      title: string | null;
      subtitle: string | null;
      status: string | null;
      occurredAt: unknown;
      value: unknown;
    }>(sql`
      SELECT
        ${AgentExternalUsageLogTable.id} AS id,
        COALESCE(${AgentExternalUsageLogTable.kind}, 'usage') AS title,
        ${AgentExternalUsageLogTable.modelName} AS subtitle,
        ${AgentExternalUsageLogTable.status} AS status,
        ${AgentExternalUsageLogTable.createdAt} AS "occurredAt",
        ${AgentExternalUsageLogTable.totalTokens} AS value
      FROM ${AgentExternalUsageLogTable}
      WHERE
        ${AgentExternalUsageLogTable.agentId} = ${agentId}
        AND ${AgentExternalUsageLogTable.createdAt} >= ${query.startDate}
        AND ${AgentExternalUsageLogTable.createdAt} <= ${query.endDate}
      ORDER BY ${AgentExternalUsageLogTable.createdAt} DESC
      LIMIT 5
    `),
    queryRows<{ count: unknown }>(sql`
      SELECT COUNT(*)::int AS count
      FROM ${TeamResourceShareTable}
      WHERE
        ${TeamResourceShareTable.resourceType} = 'agent'
        AND ${TeamResourceShareTable.resourceId} = ${agentId}
    `),
    queryRows<{ count: unknown }>(sql`
      SELECT COUNT(*)::int AS count
      FROM ${KnowledgeGroupAgentTable}
      WHERE ${KnowledgeGroupAgentTable.agentId} = ${agentId}
    `),
    queryRows<{ count: unknown }>(sql`
      SELECT COUNT(*)::int AS count
      FROM ${SkillAgentTable}
      WHERE ${SkillAgentTable.agentId} = ${agentId}
    `),
    queryRows<{ count: unknown }>(sql`
      SELECT COUNT(*)::int AS count
      FROM ${SkillGroupAgentTable}
      WHERE ${SkillGroupAgentTable.agentId} = ${agentId}
    `),
    queryRows<{ count: unknown }>(sql`
      SELECT COUNT(*)::int AS count
      FROM ${SubAgentTable}
      WHERE ${SubAgentTable.agentId} = ${agentId}
    `),
  ]);

  const summary = summaryRows[0];

  return {
    kind: "agent",
    title: `${row.name} Metrics`,
    header: buildHeader(row, [row.visibility, row.agentType]),
    metrics: [
      { label: "In-app sessions", value: toNumber(summary?.inAppSessions) },
      {
        label: "External chat turns",
        value: toNumber(summary?.externalChatTurns),
      },
      {
        label: "Autocomplete requests",
        value: toNumber(summary?.autocompleteRequests),
      },
      { label: "Total tokens", value: toNumber(summary?.totalTokens) },
      { label: "Unique users", value: toNumber(summary?.uniqueUsers) },
      { label: "Team shares", value: toNumber(teamShareRows[0]?.count) },
      {
        label: "Knowledge groups",
        value: toNumber(knowledgeRows[0]?.count),
      },
      { label: "Attached skills", value: toNumber(skillRows[0]?.count) },
      {
        label: "Skill groups",
        value: toNumber(skillGroupRows[0]?.count),
      },
      { label: "Subagents", value: toNumber(subAgentRows[0]?.count) },
    ],
    usageTimeline: fillTimeline(timelineRows, query.startDate, query.endDate),
    breakdowns: [
      makeBreakdownSection(
        "External status mix",
        externalStatusRows.map((item) => ({
          label: item.label ?? "unknown",
          value: toNumber(item.value),
        })),
      ),
    ],
    topLists: [
      {
        title: "Top usage users",
        items: topUserRows.map((item) => ({
          label: item.label ?? "Unknown User",
          secondary: item.secondary ?? undefined,
          value: toNumber(item.value),
        })),
      },
      {
        title: "Top models",
        items: topModelRows.map((item) => ({
          label: item.label ?? "Unknown model",
          value: toNumber(item.value),
        })),
      },
    ],
    recent: [
      makeRecentSection(
        "Recent in-app sessions",
        recentSessionRows.map((item) => ({
          id: item.id,
          title: item.title ?? "Untitled thread",
          subtitle: item.subtitle ?? undefined,
          occurredAt:
            toIsoDateTime(item.occurredAt) ?? new Date().toISOString(),
        })),
      ),
      makeRecentSection(
        "Recent external usage",
        recentExternalRows.map((item) => ({
          id: item.id,
          title: item.title ?? "usage",
          subtitle: item.subtitle ?? undefined,
          status: item.status ?? undefined,
          occurredAt:
            toIsoDateTime(item.occurredAt) ?? new Date().toISOString(),
          value: toNumber(item.value),
        })),
      ),
    ],
    tables: [],
  };
}

async function getMcpDetail(
  id: string,
  query: AdminDashboardQuery,
): Promise<AdminDashboardDetailData | null> {
  const mcpId = uuidParam(id);
  const [row] = await db
    .select({
      id: McpServerTable.id,
      name: McpServerTable.name,
      description: sql<string | null>`NULL`,
      visibility: McpServerTable.visibility,
      publishEnabled: McpServerTable.publishEnabled,
      lastConnectionStatus: McpServerTable.lastConnectionStatus,
      toolInfo: McpServerTable.toolInfo,
      createdAt: McpServerTable.createdAt,
      updatedAt: McpServerTable.updatedAt,
      creatorId: UserTable.id,
      creatorName: UserTable.name,
      creatorEmail: UserTable.email,
      creatorImage: UserTable.image,
    })
    .from(McpServerTable)
    .innerJoin(UserTable, eq(McpServerTable.userId, UserTable.id))
    .where(eq(McpServerTable.id, id));

  if (!row) return null;

  const [
    summaryRows,
    sourceRows,
    statusRows,
    topToolRows,
    topUserRows,
    timelineRows,
    recentRows,
    teamShareRows,
  ] = await Promise.all([
    queryRows<{
      totalInvocations: unknown;
      uniqueCallers: unknown;
      successCount: unknown;
      errorCount: unknown;
      avgLatencyMs: unknown;
    }>(sql`
        SELECT
          COUNT(*)::int AS "totalInvocations",
          COUNT(DISTINCT ${AdminUsageEventTable.actorUserId})::int AS "uniqueCallers",
          COUNT(*) FILTER (WHERE ${AdminUsageEventTable.status} = 'success')::int AS "successCount",
          COUNT(*) FILTER (WHERE ${AdminUsageEventTable.status} = 'error')::int AS "errorCount",
          COALESCE(AVG(${AdminUsageEventTable.latencyMs}), 0)::numeric AS "avgLatencyMs"
        FROM ${AdminUsageEventTable}
        WHERE
          ${AdminUsageEventTable.resourceType} = 'mcp'
          AND ${AdminUsageEventTable.resourceId} = ${mcpId}
          AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
          AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
      `),
    queryRows<{ label: string | null; value: unknown }>(sql`
        SELECT
          ${AdminUsageEventTable.source} AS label,
          COUNT(*)::int AS value
        FROM ${AdminUsageEventTable}
        WHERE
          ${AdminUsageEventTable.resourceType} = 'mcp'
          AND ${AdminUsageEventTable.resourceId} = ${mcpId}
          AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
          AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
        GROUP BY 1
        ORDER BY value DESC
      `),
    queryRows<{ label: string | null; value: unknown }>(sql`
        SELECT
          ${AdminUsageEventTable.status} AS label,
          COUNT(*)::int AS value
        FROM ${AdminUsageEventTable}
        WHERE
          ${AdminUsageEventTable.resourceType} = 'mcp'
          AND ${AdminUsageEventTable.resourceId} = ${mcpId}
          AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
          AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
        GROUP BY 1
        ORDER BY value DESC
      `),
    queryRows<{ label: string | null; value: unknown }>(sql`
        SELECT
          ${AdminUsageEventTable.toolName} AS label,
          COUNT(*)::int AS value
        FROM ${AdminUsageEventTable}
        WHERE
          ${AdminUsageEventTable.resourceType} = 'mcp'
          AND ${AdminUsageEventTable.resourceId} = ${mcpId}
          AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
          AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
          AND ${AdminUsageEventTable.toolName} IS NOT NULL
        GROUP BY 1
        ORDER BY value DESC, label ASC
        LIMIT 5
      `),
    queryRows<{
      label: string | null;
      secondary: string | null;
      value: unknown;
    }>(
      sql`
          SELECT
            COALESCE(${UserTable.name}, ${UserTable.email}, 'Unknown User') AS label,
            ${UserTable.email} AS secondary,
            COUNT(*)::int AS value
          FROM ${AdminUsageEventTable}
          LEFT JOIN ${UserTable}
            ON ${AdminUsageEventTable.actorUserId} = ${UserTable.id}
          WHERE
            ${AdminUsageEventTable.resourceType} = 'mcp'
            AND ${AdminUsageEventTable.resourceId} = ${mcpId}
            AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
            AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
            AND ${AdminUsageEventTable.actorUserId} IS NOT NULL
          GROUP BY ${AdminUsageEventTable.actorUserId}, ${UserTable.name}, ${UserTable.email}
          ORDER BY value DESC, label ASC
          LIMIT 5
        `,
    ),
    queryRows<{ date: unknown; value: unknown }>(sql`
        SELECT
          DATE_TRUNC('day', ${AdminUsageEventTable.createdAt})::date AS date,
          COUNT(*)::int AS value
        FROM ${AdminUsageEventTable}
        WHERE
          ${AdminUsageEventTable.resourceType} = 'mcp'
          AND ${AdminUsageEventTable.resourceId} = ${mcpId}
          AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
          AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
        GROUP BY 1
        ORDER BY 1 ASC
      `),
    queryRows<{
      id: string;
      title: string | null;
      subtitle: string | null;
      status: string | null;
      occurredAt: unknown;
      value: unknown;
    }>(sql`
        SELECT
          ${AdminUsageEventTable.id} AS id,
          COALESCE(${AdminUsageEventTable.toolName}, ${AdminUsageEventTable.eventName}) AS title,
          ${AdminUsageEventTable.source} AS subtitle,
          ${AdminUsageEventTable.status} AS status,
          ${AdminUsageEventTable.createdAt} AS "occurredAt",
          ${AdminUsageEventTable.latencyMs} AS value
        FROM ${AdminUsageEventTable}
        WHERE
          ${AdminUsageEventTable.resourceType} = 'mcp'
          AND ${AdminUsageEventTable.resourceId} = ${mcpId}
          AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
          AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
        ORDER BY ${AdminUsageEventTable.createdAt} DESC
        LIMIT 8
      `),
    queryRows<{ count: unknown }>(sql`
        SELECT COUNT(*)::int AS count
        FROM ${TeamResourceShareTable}
        WHERE
          ${TeamResourceShareTable.resourceType} = 'mcp'
          AND ${TeamResourceShareTable.resourceId} = ${mcpId}
      `),
  ]);

  const summary = summaryRows[0];
  const toolCount = Array.isArray(row.toolInfo) ? row.toolInfo.length : 0;

  return {
    kind: "mcp",
    title: `${row.name} Metrics`,
    header: buildHeader(row, [
      row.visibility,
      row.publishEnabled ? "published" : "unpublished",
      row.lastConnectionStatus ?? "unknown",
    ]),
    metrics: [
      {
        label: "Total invocations",
        value: toNumber(summary?.totalInvocations),
      },
      { label: "Unique callers", value: toNumber(summary?.uniqueCallers) },
      { label: "Success", value: toNumber(summary?.successCount) },
      { label: "Errors", value: toNumber(summary?.errorCount) },
      {
        label: "Avg latency (ms)",
        value: Math.round(toNumber(summary?.avgLatencyMs)),
      },
      { label: "Tool count", value: toolCount },
      { label: "Team shares", value: toNumber(teamShareRows[0]?.count) },
    ],
    usageTimeline: fillTimeline(timelineRows, query.startDate, query.endDate),
    breakdowns: [
      makeBreakdownSection(
        "Source split",
        sourceRows.map((item) => ({
          label: item.label ?? "unknown",
          value: toNumber(item.value),
        })),
      ),
      makeBreakdownSection(
        "Status split",
        statusRows.map((item) => ({
          label: item.label ?? "unknown",
          value: toNumber(item.value),
        })),
      ),
    ],
    topLists: [
      {
        title: "Top tools",
        items: topToolRows.map((item) => ({
          label: item.label ?? "Unknown tool",
          value: toNumber(item.value),
        })),
      },
      {
        title: "Top users",
        items: topUserRows.map((item) => ({
          label: item.label ?? "Unknown User",
          secondary: item.secondary ?? undefined,
          value: toNumber(item.value),
        })),
      },
    ],
    recent: [
      makeRecentSection(
        "Recent invocations",
        recentRows.map((item) => ({
          id: item.id,
          title: item.title ?? "Invocation",
          subtitle: item.subtitle ?? undefined,
          status: item.status ?? undefined,
          occurredAt:
            toIsoDateTime(item.occurredAt) ?? new Date().toISOString(),
          value: toNumber(item.value),
        })),
      ),
    ],
    tables: [],
  };
}

async function getContextxDetail(
  id: string,
  query: AdminDashboardQuery,
): Promise<AdminDashboardDetailData | null> {
  const groupId = uuidParam(id);
  const [row] = await db
    .select({
      id: KnowledgeGroupTable.id,
      name: KnowledgeGroupTable.name,
      description: KnowledgeGroupTable.description,
      visibility: KnowledgeGroupTable.visibility,
      purpose: KnowledgeGroupTable.purpose,
      createdAt: KnowledgeGroupTable.createdAt,
      updatedAt: KnowledgeGroupTable.updatedAt,
      creatorId: UserTable.id,
      creatorName: UserTable.name,
      creatorEmail: UserTable.email,
      creatorImage: UserTable.image,
    })
    .from(KnowledgeGroupTable)
    .innerJoin(UserTable, eq(KnowledgeGroupTable.userId, UserTable.id))
    .where(eq(KnowledgeGroupTable.id, id));

  if (!row) return null;

  const [
    usageSummaryRows,
    documentSummaryRows,
    sectionCountRows,
    chunkCountRows,
    linkedAgentRows,
    sourceRows,
    topUserRows,
    timelineRows,
    recentRows,
    documentTableRows,
  ] = await Promise.all([
    queryRows<{
      totalQueries: unknown;
      uniqueUsers: unknown;
      avgLatencyMs: unknown;
    }>(sql`
      SELECT
        COUNT(*)::int AS "totalQueries",
        COUNT(DISTINCT ${KnowledgeUsageLogTable.userId})::int AS "uniqueUsers",
        COALESCE(AVG(${KnowledgeUsageLogTable.latencyMs}), 0)::numeric AS "avgLatencyMs"
      FROM ${KnowledgeUsageLogTable}
      WHERE
        ${KnowledgeUsageLogTable.groupId} = ${groupId}
        AND ${KnowledgeUsageLogTable.createdAt} >= ${query.startDate}
        AND ${KnowledgeUsageLogTable.createdAt} <= ${query.endDate}
    `),
    queryRows<{
      totalDocuments: unknown;
      readyDocuments: unknown;
      processingDocuments: unknown;
      failedDocuments: unknown;
      chunkTotal: unknown;
      tokenTotal: unknown;
      embeddingTokenTotal: unknown;
    }>(sql`
      SELECT
        COUNT(*)::int AS "totalDocuments",
        COUNT(*) FILTER (WHERE ${KnowledgeDocumentTable.status} = 'ready')::int AS "readyDocuments",
        COUNT(*) FILTER (WHERE ${KnowledgeDocumentTable.status} = 'processing')::int AS "processingDocuments",
        COUNT(*) FILTER (WHERE ${KnowledgeDocumentTable.status} = 'failed')::int AS "failedDocuments",
        COALESCE(SUM(${KnowledgeDocumentTable.chunkCount}), 0)::bigint AS "chunkTotal",
        COALESCE(SUM(${KnowledgeDocumentTable.tokenCount}), 0)::bigint AS "tokenTotal",
        COALESCE(SUM(${KnowledgeDocumentTable.embeddingTokenCount}), 0)::bigint AS "embeddingTokenTotal"
      FROM ${KnowledgeDocumentTable}
      WHERE ${KnowledgeDocumentTable.groupId} = ${groupId}
    `),
    queryRows<{ count: unknown }>(sql`
      SELECT COUNT(*)::int AS count
      FROM ${KnowledgeSectionTable}
      WHERE ${KnowledgeSectionTable.groupId} = ${groupId}
    `),
    queryRows<{ count: unknown }>(sql`
      SELECT COUNT(*)::int AS count
      FROM ${KnowledgeChunkTable}
      WHERE ${KnowledgeChunkTable.groupId} = ${groupId}
    `),
    queryRows<{ count: unknown }>(sql`
      SELECT COUNT(*)::int AS count
      FROM ${KnowledgeGroupAgentTable}
      WHERE ${KnowledgeGroupAgentTable.groupId} = ${groupId}
    `),
    queryRows<{ label: string | null; value: unknown }>(sql`
      SELECT
        ${KnowledgeUsageLogTable.source} AS label,
        COUNT(*)::int AS value
      FROM ${KnowledgeUsageLogTable}
      WHERE
        ${KnowledgeUsageLogTable.groupId} = ${groupId}
        AND ${KnowledgeUsageLogTable.createdAt} >= ${query.startDate}
        AND ${KnowledgeUsageLogTable.createdAt} <= ${query.endDate}
      GROUP BY 1
      ORDER BY value DESC
    `),
    queryRows<{
      label: string | null;
      secondary: string | null;
      value: unknown;
    }>(
      sql`
        SELECT
          COALESCE(${UserTable.name}, ${UserTable.email}, 'Unknown User') AS label,
          ${UserTable.email} AS secondary,
          COUNT(*)::int AS value
        FROM ${KnowledgeUsageLogTable}
        LEFT JOIN ${UserTable}
          ON ${KnowledgeUsageLogTable.userId} = ${UserTable.id}
        WHERE
          ${KnowledgeUsageLogTable.groupId} = ${groupId}
          AND ${KnowledgeUsageLogTable.createdAt} >= ${query.startDate}
          AND ${KnowledgeUsageLogTable.createdAt} <= ${query.endDate}
          AND ${KnowledgeUsageLogTable.userId} IS NOT NULL
        GROUP BY ${KnowledgeUsageLogTable.userId}, ${UserTable.name}, ${UserTable.email}
        ORDER BY value DESC, label ASC
        LIMIT 5
      `,
    ),
    queryRows<{ date: unknown; value: unknown }>(sql`
      SELECT
        DATE_TRUNC('day', ${KnowledgeUsageLogTable.createdAt})::date AS date,
        COUNT(*)::int AS value
      FROM ${KnowledgeUsageLogTable}
      WHERE
        ${KnowledgeUsageLogTable.groupId} = ${groupId}
        AND ${KnowledgeUsageLogTable.createdAt} >= ${query.startDate}
        AND ${KnowledgeUsageLogTable.createdAt} <= ${query.endDate}
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    queryRows<{
      id: string;
      title: string;
      subtitle: string | null;
      occurredAt: unknown;
      value: unknown;
    }>(sql`
      SELECT
        ${KnowledgeUsageLogTable.id} AS id,
        ${KnowledgeUsageLogTable.query} AS title,
        ${KnowledgeUsageLogTable.source} AS subtitle,
        ${KnowledgeUsageLogTable.createdAt} AS "occurredAt",
        COALESCE(${KnowledgeUsageLogTable.latencyMs}, 0) AS value
      FROM ${KnowledgeUsageLogTable}
      WHERE
        ${KnowledgeUsageLogTable.groupId} = ${groupId}
        AND ${KnowledgeUsageLogTable.createdAt} >= ${query.startDate}
        AND ${KnowledgeUsageLogTable.createdAt} <= ${query.endDate}
      ORDER BY ${KnowledgeUsageLogTable.createdAt} DESC
      LIMIT 8
    `),
    queryRows<{
      id: string;
      name: string;
      status: string;
      chunkCount: unknown;
      tokenCount: unknown;
      embeddingTokenCount: unknown;
    }>(sql`
      SELECT
        ${KnowledgeDocumentTable.id} AS id,
        ${KnowledgeDocumentTable.name} AS name,
        ${KnowledgeDocumentTable.status} AS status,
        ${KnowledgeDocumentTable.chunkCount} AS "chunkCount",
        ${KnowledgeDocumentTable.tokenCount} AS "tokenCount",
        ${KnowledgeDocumentTable.embeddingTokenCount} AS "embeddingTokenCount"
      FROM ${KnowledgeDocumentTable}
      WHERE ${KnowledgeDocumentTable.groupId} = ${groupId}
      ORDER BY ${KnowledgeDocumentTable.embeddingTokenCount} DESC, ${KnowledgeDocumentTable.updatedAt} DESC
      LIMIT 10
    `),
  ]);

  const usageSummary = usageSummaryRows[0];
  const documentSummary = documentSummaryRows[0];

  return {
    kind: "contextx",
    title: `${row.name} Metrics`,
    header: buildHeader(row, [row.visibility, row.purpose]),
    metrics: [
      { label: "Total queries", value: toNumber(usageSummary?.totalQueries) },
      { label: "Unique users", value: toNumber(usageSummary?.uniqueUsers) },
      {
        label: "Avg latency (ms)",
        value: Math.round(toNumber(usageSummary?.avgLatencyMs)),
      },
      {
        label: "Linked agents",
        value: toNumber(linkedAgentRows[0]?.count),
      },
      {
        label: "Ready documents",
        value: toNumber(documentSummary?.readyDocuments),
      },
      {
        label: "Processing documents",
        value: toNumber(documentSummary?.processingDocuments),
      },
      {
        label: "Failed documents",
        value: toNumber(documentSummary?.failedDocuments),
      },
      { label: "Sections", value: toNumber(sectionCountRows[0]?.count) },
      { label: "Chunks", value: toNumber(chunkCountRows[0]?.count) },
      {
        label: "Embedding tokens",
        value: toNumber(documentSummary?.embeddingTokenTotal),
      },
    ],
    usageTimeline: fillTimeline(timelineRows, query.startDate, query.endDate),
    breakdowns: [
      makeBreakdownSection(
        "Source split",
        sourceRows.map((item) => ({
          label: item.label ?? "unknown",
          value: toNumber(item.value),
        })),
      ),
      makeBreakdownSection("Document status", [
        {
          label: "ready",
          value: toNumber(documentSummary?.readyDocuments),
        },
        {
          label: "processing",
          value: toNumber(documentSummary?.processingDocuments),
        },
        {
          label: "failed",
          value: toNumber(documentSummary?.failedDocuments),
        },
      ]),
    ],
    topLists: [
      {
        title: "Top users",
        items: topUserRows.map((item) => ({
          label: item.label ?? "Unknown User",
          secondary: item.secondary ?? undefined,
          value: toNumber(item.value),
        })),
      },
    ],
    recent: [
      makeRecentSection(
        "Recent queries",
        recentRows.map((item) => ({
          id: item.id,
          title: item.title,
          subtitle: item.subtitle ?? undefined,
          occurredAt:
            toIsoDateTime(item.occurredAt) ?? new Date().toISOString(),
          value: toNumber(item.value),
        })),
      ),
    ],
    tables: [
      {
        title: "Document embedding usage",
        columns: ["Document", "Status", "Chunks", "Tokens", "Embedding tokens"],
        rows: documentTableRows.map((item) => ({
          id: item.id,
          values: [
            item.name,
            item.status,
            toNumber(item.chunkCount),
            toNumber(item.tokenCount),
            toNumber(item.embeddingTokenCount),
          ],
        })),
      },
    ],
  };
}

async function getSkillDetail(
  id: string,
  query: AdminDashboardQuery,
): Promise<AdminDashboardDetailData | null> {
  const skillId = uuidParam(id);
  const [row] = await db
    .select({
      id: SkillTable.id,
      name: SkillTable.title,
      description: SkillTable.description,
      visibility: SkillTable.visibility,
      createdAt: SkillTable.createdAt,
      updatedAt: SkillTable.updatedAt,
      creatorId: UserTable.id,
      creatorName: UserTable.name,
      creatorEmail: UserTable.email,
      creatorImage: UserTable.image,
    })
    .from(SkillTable)
    .innerJoin(UserTable, eq(SkillTable.userId, UserTable.id))
    .where(eq(SkillTable.id, id));

  if (!row) return null;

  const [
    summaryRows,
    sourceRows,
    eventRows,
    topUserRows,
    topAgentRows,
    timelineRows,
    recentRows,
    teamShareRows,
    attachedAgentRows,
    groupMembershipRows,
  ] = await Promise.all([
    queryRows<{
      totalUsage: unknown;
      activationCount: unknown;
      loadCount: unknown;
      uniqueUsers: unknown;
    }>(sql`
        SELECT
          COUNT(*)::int AS "totalUsage",
          COUNT(*) FILTER (WHERE ${AdminUsageEventTable.eventName} = 'activated')::int AS "activationCount",
          COUNT(*) FILTER (WHERE ${AdminUsageEventTable.eventName} = 'load')::int AS "loadCount",
          COUNT(DISTINCT ${AdminUsageEventTable.actorUserId})::int AS "uniqueUsers"
        FROM ${AdminUsageEventTable}
        WHERE
          ${AdminUsageEventTable.resourceType} = 'skill'
          AND ${AdminUsageEventTable.resourceId} = ${skillId}
          AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
          AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
      `),
    queryRows<{ label: string | null; value: unknown }>(sql`
        SELECT
          ${AdminUsageEventTable.source} AS label,
          COUNT(*)::int AS value
        FROM ${AdminUsageEventTable}
        WHERE
          ${AdminUsageEventTable.resourceType} = 'skill'
          AND ${AdminUsageEventTable.resourceId} = ${skillId}
          AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
          AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
        GROUP BY 1
        ORDER BY value DESC
      `),
    queryRows<{ label: string | null; value: unknown }>(sql`
        SELECT
          ${AdminUsageEventTable.eventName} AS label,
          COUNT(*)::int AS value
        FROM ${AdminUsageEventTable}
        WHERE
          ${AdminUsageEventTable.resourceType} = 'skill'
          AND ${AdminUsageEventTable.resourceId} = ${skillId}
          AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
          AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
        GROUP BY 1
        ORDER BY value DESC
      `),
    queryRows<{
      label: string | null;
      secondary: string | null;
      value: unknown;
    }>(
      sql`
          SELECT
            COALESCE(${UserTable.name}, ${UserTable.email}, 'Unknown User') AS label,
            ${UserTable.email} AS secondary,
            COUNT(*)::int AS value
          FROM ${AdminUsageEventTable}
          LEFT JOIN ${UserTable}
            ON ${AdminUsageEventTable.actorUserId} = ${UserTable.id}
          WHERE
            ${AdminUsageEventTable.resourceType} = 'skill'
            AND ${AdminUsageEventTable.resourceId} = ${skillId}
            AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
            AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
            AND ${AdminUsageEventTable.actorUserId} IS NOT NULL
          GROUP BY ${AdminUsageEventTable.actorUserId}, ${UserTable.name}, ${UserTable.email}
          ORDER BY value DESC, label ASC
          LIMIT 5
        `,
    ),
    queryRows<{ label: string | null; value: unknown }>(sql`
        SELECT
          ${AgentTable.name} AS label,
          COUNT(*)::int AS value
        FROM ${AdminUsageEventTable}
        INNER JOIN ${AgentTable}
          ON ${AdminUsageEventTable.agentId} = ${AgentTable.id}
        WHERE
          ${AdminUsageEventTable.resourceType} = 'skill'
          AND ${AdminUsageEventTable.resourceId} = ${skillId}
          AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
          AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
          AND ${AdminUsageEventTable.agentId} IS NOT NULL
        GROUP BY ${AgentTable.id}, ${AgentTable.name}
        ORDER BY value DESC, label ASC
        LIMIT 5
      `),
    queryRows<{ date: unknown; value: unknown }>(sql`
        SELECT
          DATE_TRUNC('day', ${AdminUsageEventTable.createdAt})::date AS date,
          COUNT(*)::int AS value
        FROM ${AdminUsageEventTable}
        WHERE
          ${AdminUsageEventTable.resourceType} = 'skill'
          AND ${AdminUsageEventTable.resourceId} = ${skillId}
          AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
          AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
        GROUP BY 1
        ORDER BY 1 ASC
      `),
    queryRows<{
      id: string;
      title: string | null;
      subtitle: string | null;
      status: string | null;
      occurredAt: unknown;
    }>(sql`
        SELECT
          ${AdminUsageEventTable.id} AS id,
          ${AdminUsageEventTable.eventName} AS title,
          ${AdminUsageEventTable.source} AS subtitle,
          ${AdminUsageEventTable.status} AS status,
          ${AdminUsageEventTable.createdAt} AS "occurredAt"
        FROM ${AdminUsageEventTable}
        WHERE
          ${AdminUsageEventTable.resourceType} = 'skill'
          AND ${AdminUsageEventTable.resourceId} = ${skillId}
          AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
          AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
        ORDER BY ${AdminUsageEventTable.createdAt} DESC
        LIMIT 8
      `),
    queryRows<{ count: unknown }>(sql`
        SELECT COUNT(*)::int AS count
        FROM ${TeamResourceShareTable}
        WHERE
          ${TeamResourceShareTable.resourceType} = 'skill'
          AND ${TeamResourceShareTable.resourceId} = ${skillId}
      `),
    queryRows<{ count: unknown }>(sql`
        SELECT COUNT(*)::int AS count
        FROM ${SkillAgentTable}
        WHERE ${SkillAgentTable.skillId} = ${skillId}
      `),
    queryRows<{ count: unknown }>(sql`
        SELECT COUNT(*)::int AS count
        FROM ${SkillGroupSkillTable}
        WHERE ${SkillGroupSkillTable.skillId} = ${skillId}
      `),
  ]);

  const summary = summaryRows[0];

  return {
    kind: "skill",
    title: `${row.name} Metrics`,
    header: buildHeader(row, [row.visibility]),
    metrics: [
      { label: "Total usage", value: toNumber(summary?.totalUsage) },
      { label: "Activation count", value: toNumber(summary?.activationCount) },
      { label: "Load count", value: toNumber(summary?.loadCount) },
      { label: "Unique users", value: toNumber(summary?.uniqueUsers) },
      {
        label: "Attached agents",
        value: toNumber(attachedAgentRows[0]?.count),
      },
      {
        label: "Skill groups",
        value: toNumber(groupMembershipRows[0]?.count),
      },
      { label: "Team shares", value: toNumber(teamShareRows[0]?.count) },
    ],
    usageTimeline: fillTimeline(timelineRows, query.startDate, query.endDate),
    breakdowns: [
      makeBreakdownSection(
        "Source split",
        sourceRows.map((item) => ({
          label: item.label ?? "unknown",
          value: toNumber(item.value),
        })),
      ),
      makeBreakdownSection(
        "Event split",
        eventRows.map((item) => ({
          label: item.label ?? "unknown",
          value: toNumber(item.value),
        })),
      ),
    ],
    topLists: [
      {
        title: "Top users",
        items: topUserRows.map((item) => ({
          label: item.label ?? "Unknown User",
          secondary: item.secondary ?? undefined,
          value: toNumber(item.value),
        })),
      },
      {
        title: "Top agents",
        items: topAgentRows.map((item) => ({
          label: item.label ?? "Unknown Agent",
          value: toNumber(item.value),
        })),
      },
    ],
    recent: [
      makeRecentSection(
        "Recent activity",
        recentRows.map((item) => ({
          id: item.id,
          title: item.title ?? "Activity",
          subtitle: item.subtitle ?? undefined,
          status: item.status ?? undefined,
          occurredAt:
            toIsoDateTime(item.occurredAt) ?? new Date().toISOString(),
        })),
      ),
    ],
    tables: [],
  };
}

async function getWorkflowDetail(
  id: string,
  query: AdminDashboardQuery,
): Promise<AdminDashboardDetailData | null> {
  const workflowId = uuidParam(id);
  const [row] = await db
    .select({
      id: WorkflowTable.id,
      name: WorkflowTable.name,
      description: WorkflowTable.description,
      visibility: WorkflowTable.visibility,
      isPublished: WorkflowTable.isPublished,
      createdAt: WorkflowTable.createdAt,
      updatedAt: WorkflowTable.updatedAt,
      creatorId: UserTable.id,
      creatorName: UserTable.name,
      creatorEmail: UserTable.email,
      creatorImage: UserTable.image,
    })
    .from(WorkflowTable)
    .innerJoin(UserTable, eq(WorkflowTable.userId, UserTable.id))
    .where(eq(WorkflowTable.id, id));

  if (!row) return null;

  const [
    summaryRows,
    nodeCountRows,
    sourceRows,
    statusRows,
    topUserRows,
    timelineRows,
    recentRows,
  ] = await Promise.all([
    queryRows<{
      totalExecutions: unknown;
      successCount: unknown;
      errorCount: unknown;
      uniqueUsers: unknown;
      avgLatencyMs: unknown;
    }>(sql`
        SELECT
          COUNT(*)::int AS "totalExecutions",
          COUNT(*) FILTER (WHERE ${AdminUsageEventTable.status} = 'success')::int AS "successCount",
          COUNT(*) FILTER (WHERE ${AdminUsageEventTable.status} = 'error')::int AS "errorCount",
          COUNT(DISTINCT ${AdminUsageEventTable.actorUserId})::int AS "uniqueUsers",
          COALESCE(AVG(${AdminUsageEventTable.latencyMs}), 0)::numeric AS "avgLatencyMs"
        FROM ${AdminUsageEventTable}
        WHERE
          ${AdminUsageEventTable.resourceType} = 'workflow'
          AND ${AdminUsageEventTable.resourceId} = ${workflowId}
          AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
          AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
      `),
    queryRows<{ count: unknown }>(sql`
        SELECT COUNT(*)::int AS count
        FROM ${WorkflowNodeDataTable}
        WHERE ${WorkflowNodeDataTable.workflowId} = ${workflowId}
      `),
    queryRows<{ label: string | null; value: unknown }>(sql`
        SELECT
          ${AdminUsageEventTable.source} AS label,
          COUNT(*)::int AS value
        FROM ${AdminUsageEventTable}
        WHERE
          ${AdminUsageEventTable.resourceType} = 'workflow'
          AND ${AdminUsageEventTable.resourceId} = ${workflowId}
          AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
          AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
        GROUP BY 1
        ORDER BY value DESC
      `),
    queryRows<{ label: string | null; value: unknown }>(sql`
        SELECT
          ${AdminUsageEventTable.status} AS label,
          COUNT(*)::int AS value
        FROM ${AdminUsageEventTable}
        WHERE
          ${AdminUsageEventTable.resourceType} = 'workflow'
          AND ${AdminUsageEventTable.resourceId} = ${workflowId}
          AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
          AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
        GROUP BY 1
        ORDER BY value DESC
      `),
    queryRows<{
      label: string | null;
      secondary: string | null;
      value: unknown;
    }>(
      sql`
          SELECT
            COALESCE(${UserTable.name}, ${UserTable.email}, 'Unknown User') AS label,
            ${UserTable.email} AS secondary,
            COUNT(*)::int AS value
          FROM ${AdminUsageEventTable}
          LEFT JOIN ${UserTable}
            ON ${AdminUsageEventTable.actorUserId} = ${UserTable.id}
          WHERE
            ${AdminUsageEventTable.resourceType} = 'workflow'
            AND ${AdminUsageEventTable.resourceId} = ${workflowId}
            AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
            AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
            AND ${AdminUsageEventTable.actorUserId} IS NOT NULL
          GROUP BY ${AdminUsageEventTable.actorUserId}, ${UserTable.name}, ${UserTable.email}
          ORDER BY value DESC, label ASC
          LIMIT 5
        `,
    ),
    queryRows<{ date: unknown; value: unknown }>(sql`
        SELECT
          DATE_TRUNC('day', ${AdminUsageEventTable.createdAt})::date AS date,
          COUNT(*)::int AS value
        FROM ${AdminUsageEventTable}
        WHERE
          ${AdminUsageEventTable.resourceType} = 'workflow'
          AND ${AdminUsageEventTable.resourceId} = ${workflowId}
          AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
          AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
        GROUP BY 1
        ORDER BY 1 ASC
      `),
    queryRows<{
      id: string;
      title: string | null;
      subtitle: string | null;
      status: string | null;
      occurredAt: unknown;
      value: unknown;
    }>(sql`
        SELECT
          ${AdminUsageEventTable.id} AS id,
          ${AdminUsageEventTable.eventName} AS title,
          ${AdminUsageEventTable.source} AS subtitle,
          ${AdminUsageEventTable.status} AS status,
          ${AdminUsageEventTable.createdAt} AS "occurredAt",
          ${AdminUsageEventTable.latencyMs} AS value
        FROM ${AdminUsageEventTable}
        WHERE
          ${AdminUsageEventTable.resourceType} = 'workflow'
          AND ${AdminUsageEventTable.resourceId} = ${workflowId}
          AND ${AdminUsageEventTable.createdAt} >= ${query.startDate}
          AND ${AdminUsageEventTable.createdAt} <= ${query.endDate}
        ORDER BY ${AdminUsageEventTable.createdAt} DESC
        LIMIT 8
      `),
  ]);

  const summary = summaryRows[0];

  return {
    kind: "workflow",
    title: `${row.name} Metrics`,
    header: buildHeader(row, [
      row.visibility,
      row.isPublished ? "published" : "draft",
    ]),
    metrics: [
      { label: "Total executions", value: toNumber(summary?.totalExecutions) },
      { label: "Success", value: toNumber(summary?.successCount) },
      { label: "Errors", value: toNumber(summary?.errorCount) },
      { label: "Unique users", value: toNumber(summary?.uniqueUsers) },
      {
        label: "Avg latency (ms)",
        value: Math.round(toNumber(summary?.avgLatencyMs)),
      },
      { label: "Node count", value: toNumber(nodeCountRows[0]?.count) },
    ],
    usageTimeline: fillTimeline(timelineRows, query.startDate, query.endDate),
    breakdowns: [
      makeBreakdownSection(
        "Source split",
        sourceRows.map((item) => ({
          label: item.label ?? "unknown",
          value: toNumber(item.value),
        })),
      ),
      makeBreakdownSection(
        "Status split",
        statusRows.map((item) => ({
          label: item.label ?? "unknown",
          value: toNumber(item.value),
        })),
      ),
    ],
    topLists: [
      {
        title: "Top users",
        items: topUserRows.map((item) => ({
          label: item.label ?? "Unknown User",
          secondary: item.secondary ?? undefined,
          value: toNumber(item.value),
        })),
      },
    ],
    recent: [
      makeRecentSection(
        "Recent executions",
        recentRows.map((item) => ({
          id: item.id,
          title: item.title ?? "Execution",
          subtitle: item.subtitle ?? undefined,
          status: item.status ?? undefined,
          occurredAt:
            toIsoDateTime(item.occurredAt) ?? new Date().toISOString(),
          value: toNumber(item.value),
        })),
      ),
    ],
    tables: [],
  };
}

const pgAdminDashboardRepository: AdminDashboardRepository = {
  async getList(kind, query) {
    switch (kind) {
      case "agent":
        return getAgentList(query);
      case "mcp":
        return getMcpList(query);
      case "contextx":
        return getContextxList(query);
      case "skill":
        return getSkillList(query);
      case "workflow":
        return getWorkflowList(query);
    }
  },

  async getDetail(kind, id, query) {
    switch (kind) {
      case "agent":
        return getAgentDetail(id, query);
      case "mcp":
        return getMcpDetail(id, query);
      case "contextx":
        return getContextxDetail(id, query);
      case "skill":
        return getSkillDetail(id, query);
      case "workflow":
        return getWorkflowDetail(id, query);
    }
  },
};

export default pgAdminDashboardRepository;
