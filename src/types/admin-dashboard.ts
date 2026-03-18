import { z } from "zod";

export const AdminDashboardKindSchema = z.enum([
  "agent",
  "mcp",
  "contextx",
  "skill",
  "workflow",
]);

export const AdminDashboardRangePresetSchema = z.enum([
  "daily",
  "weekly",
  "monthly",
  "custom",
]);

export const AdminDashboardListSortBySchema = z.enum([
  "name",
  "totalUsage",
  "creator",
  "lastActiveAt",
]);

export const AdminUsageEventResourceTypeSchema = z.enum([
  "mcp",
  "skill",
  "workflow",
]);

export const AdminUsageEventSourceSchema = z.enum([
  "chat",
  "manual",
  "pilot",
  "published",
  "workflow",
  "mcp",
  "a2a",
]);

export const AdminUsageEventStatusSchema = z.enum([
  "success",
  "error",
  "cancelled",
]);

export type AdminDashboardKind = z.infer<typeof AdminDashboardKindSchema>;
export type AdminDashboardRangePreset = z.infer<
  typeof AdminDashboardRangePresetSchema
>;
export type AdminDashboardListSortBy = z.infer<
  typeof AdminDashboardListSortBySchema
>;
export type AdminUsageEventResourceType = z.infer<
  typeof AdminUsageEventResourceTypeSchema
>;
export type AdminUsageEventSource = z.infer<typeof AdminUsageEventSourceSchema>;
export type AdminUsageEventStatus = z.infer<typeof AdminUsageEventStatusSchema>;

export interface AdminDashboardQuery {
  startDate: Date;
  endDate: Date;
  limit?: number;
  offset?: number;
  searchValue?: string;
  sortBy?: AdminDashboardListSortBy;
  sortDirection?: "asc" | "desc";
}

export interface AdminDashboardUsageContext {
  source: AdminUsageEventSource;
  actorUserId?: string | null;
  agentId?: string | null;
  threadId?: string | null;
}

export interface AdminUsageEventInsert extends AdminDashboardUsageContext {
  resourceType: AdminUsageEventResourceType;
  resourceId: string;
  eventName: string;
  status?: AdminUsageEventStatus;
  latencyMs?: number | null;
  toolName?: string | null;
  createdAt?: Date;
}

export interface AdminDashboardStat {
  label: string;
  value: number | string;
  hint?: string;
}

export interface AdminDashboardListItem {
  id: string;
  name: string;
  totalUsage: number;
  creatorId: string;
  creatorName: string;
  creatorEmail: string;
  creatorImage?: string | null;
  lastActiveAt: string | null;
  badges: string[];
  meta?: string;
}

export interface AdminDashboardListData {
  kind: AdminDashboardKind;
  title: string;
  usageLabel: string;
  metrics: AdminDashboardStat[];
  items: AdminDashboardListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminDashboardTimelinePoint {
  date: string;
  value: number;
}

export interface AdminDashboardBreakdownItem {
  label: string;
  value: number;
  secondary?: string;
}

export interface AdminDashboardBreakdownSection {
  title: string;
  items: AdminDashboardBreakdownItem[];
}

export interface AdminDashboardTopListItem {
  label: string;
  value: number;
  secondary?: string;
}

export interface AdminDashboardTopList {
  title: string;
  items: AdminDashboardTopListItem[];
}

export interface AdminDashboardRecentItem {
  id: string;
  title: string;
  subtitle?: string;
  occurredAt: string;
  status?: string | null;
  value?: number | string;
}

export interface AdminDashboardRecentSection {
  title: string;
  items: AdminDashboardRecentItem[];
}

export interface AdminDashboardTableSection {
  title: string;
  columns: string[];
  rows: Array<{
    id: string;
    values: Array<string | number>;
  }>;
}

export interface AdminDashboardDetailHeader {
  id: string;
  name: string;
  description?: string | null;
  creatorId: string;
  creatorName: string;
  creatorEmail: string;
  creatorImage?: string | null;
  createdAt: string;
  updatedAt: string;
  badges: string[];
  canDelete: boolean;
}

export interface AdminDashboardDetailData {
  kind: AdminDashboardKind;
  title: string;
  header: AdminDashboardDetailHeader;
  metrics: AdminDashboardStat[];
  usageTimeline: AdminDashboardTimelinePoint[];
  breakdowns: AdminDashboardBreakdownSection[];
  topLists: AdminDashboardTopList[];
  recent: AdminDashboardRecentSection[];
  tables: AdminDashboardTableSection[];
}
