import "server-only";

import type {
  AdminDashboardDetailData,
  AdminDashboardKind,
  AdminDashboardListData,
  AdminDashboardQuery,
} from "app-types/admin-dashboard";
import { and, eq } from "drizzle-orm";
import { mcpClientsManager } from "lib/ai/mcp/mcp-manager";
import { requireAdminPermission } from "lib/auth/permissions";
import { getSession } from "lib/auth/server";
import { serverCache } from "lib/cache";
import { CacheKeys } from "lib/cache/cache-keys";
import { pgDb as db } from "lib/db/pg/db.pg";
import pgAdminDashboardRepository from "lib/db/pg/repositories/admin-dashboard-repository.pg";
import {
  AdminUsageEventTable,
  AgentTable,
  KnowledgeGroupTable,
  McpServerTable,
  SkillTable,
  WorkflowTable,
} from "lib/db/pg/schema.pg";
import { ADMIN_DASHBOARD_LIMIT } from "./dashboard";

export { ADMIN_DASHBOARD_LIMIT } from "./dashboard";

export async function getAdminDashboardList(
  kind: AdminDashboardKind,
  query: AdminDashboardQuery,
): Promise<AdminDashboardListData> {
  await requireAdminPermission("access admin resource dashboards");
  await getSession();

  return pgAdminDashboardRepository.getList(kind, {
    ...query,
    limit: query.limit ?? ADMIN_DASHBOARD_LIMIT,
    offset: query.offset ?? 0,
    sortBy: query.sortBy ?? "totalUsage",
    sortDirection: query.sortDirection ?? "desc",
  });
}

export async function getAdminDashboardDetail(
  kind: AdminDashboardKind,
  id: string,
  query: AdminDashboardQuery,
): Promise<AdminDashboardDetailData | null> {
  await requireAdminPermission("access admin resource dashboards");
  await getSession();

  return pgAdminDashboardRepository.getDetail(kind, id, query);
}

async function deleteUsageEvents(
  kind: "mcp" | "skill" | "workflow",
  id: string,
) {
  await db
    .delete(AdminUsageEventTable)
    .where(
      and(
        eq(AdminUsageEventTable.resourceType, kind),
        eq(AdminUsageEventTable.resourceId, id),
      ),
    );
}

export async function deleteAdminDashboardItem(
  kind: AdminDashboardKind,
  id: string,
) {
  await requireAdminPermission("delete admin resource dashboards");
  await getSession();

  switch (kind) {
    case "agent": {
      const deleted = await db
        .delete(AgentTable)
        .where(eq(AgentTable.id, id))
        .returning({ id: AgentTable.id });
      if (!deleted[0]) {
        throw new Error("Not found");
      }
      await serverCache.delete(CacheKeys.agentInstructions(id));
      return;
    }
    case "mcp": {
      const existing = await db
        .select({ id: McpServerTable.id })
        .from(McpServerTable)
        .where(eq(McpServerTable.id, id));
      if (!existing[0]) {
        throw new Error("Not found");
      }
      await mcpClientsManager.removeClient(id);
      await deleteUsageEvents("mcp", id);
      return;
    }
    case "contextx": {
      const deleted = await db
        .delete(KnowledgeGroupTable)
        .where(eq(KnowledgeGroupTable.id, id))
        .returning({ id: KnowledgeGroupTable.id });
      if (!deleted[0]) {
        throw new Error("Not found");
      }
      return;
    }
    case "skill": {
      const deleted = await db
        .delete(SkillTable)
        .where(eq(SkillTable.id, id))
        .returning({ id: SkillTable.id });
      if (!deleted[0]) {
        throw new Error("Not found");
      }
      await deleteUsageEvents("skill", id);
      return;
    }
    case "workflow": {
      const deleted = await db
        .delete(WorkflowTable)
        .where(eq(WorkflowTable.id, id))
        .returning({ id: WorkflowTable.id });
      if (!deleted[0]) {
        throw new Error("Not found");
      }
      await deleteUsageEvents("workflow", id);
      return;
    }
  }
}
