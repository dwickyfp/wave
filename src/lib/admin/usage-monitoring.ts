import type { UsageMonitoringQuery } from "app-types/admin";

export const USAGE_MONITORING_DEFAULT_PRESET = "7d";
export const USAGE_MONITORING_DEFAULT_SORT_BY = "totalTokens";
export const USAGE_MONITORING_DEFAULT_SORT_DIRECTION = "desc";

export const USAGE_MONITORING_PRESETS = ["7d", "14d", "30d", "90d"] as const;

export type DatePreset = (typeof USAGE_MONITORING_PRESETS)[number];
export type UsageMonitoringSortBy = NonNullable<UsageMonitoringQuery["sortBy"]>;

const PRESET_DAYS: Record<DatePreset, number> = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "90d": 90,
};

export interface UsageMonitoringSearchState {
  page: number;
  limit: number;
  offset: number;
  preset: DatePreset;
  query?: string;
  sortBy: UsageMonitoringSortBy;
  sortDirection: "asc" | "desc";
  startDate: Date;
  endDate: Date;
}

function getParam(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
  key: string,
) {
  if (params instanceof URLSearchParams) {
    return params.get(key) ?? undefined;
  }

  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function getPositivePage(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
) {
  const rawPage = getParam(params, "page");
  const parsedPage = Number.parseInt(rawPage ?? "1", 10);

  return Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
}

function getSortBy(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): UsageMonitoringSortBy {
  const rawSortBy = getParam(params, "sortBy");

  switch (rawSortBy) {
    case "name":
    case "email":
    case "messageCount":
    case "threadCount":
    case "totalCostUsd":
    case "totalTokens":
      return rawSortBy;
    default:
      return USAGE_MONITORING_DEFAULT_SORT_BY;
  }
}

function getSortDirection(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
) {
  return getParam(params, "sortDirection") === "asc" ? "asc" : "desc";
}

function getPreset(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): DatePreset {
  const rawPreset = getParam(params, "preset");

  return USAGE_MONITORING_PRESETS.includes(rawPreset as DatePreset)
    ? (rawPreset as DatePreset)
    : USAGE_MONITORING_DEFAULT_PRESET;
}

export function getUsageMonitoringDateRange(preset: DatePreset): {
  startDate: Date;
  endDate: Date;
} {
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - PRESET_DAYS[preset]);
  startDate.setHours(0, 0, 0, 0);

  return { startDate, endDate };
}

export function parseUsageMonitoringSearchParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
  limit: number,
): UsageMonitoringSearchState {
  const page = getPositivePage(params);
  const preset = getPreset(params);
  const query = getParam(params, "query")?.trim() || undefined;
  const sortBy = getSortBy(params);
  const sortDirection = getSortDirection(params);
  const { startDate, endDate } = getUsageMonitoringDateRange(preset);

  return {
    page,
    limit,
    offset: (page - 1) * limit,
    preset,
    query,
    sortBy,
    sortDirection,
    startDate,
    endDate,
  };
}

export function buildUsageMonitoringPageUrl(params: {
  page: number;
  query?: string;
  sortBy: UsageMonitoringSortBy;
  sortDirection: "asc" | "desc";
  preset: DatePreset;
}) {
  const searchParams = new URLSearchParams();

  if (params.page > 1) {
    searchParams.set("page", String(params.page));
  }
  if (params.query) {
    searchParams.set("query", params.query);
  }
  if (params.sortBy !== USAGE_MONITORING_DEFAULT_SORT_BY) {
    searchParams.set("sortBy", params.sortBy);
  }
  if (params.sortDirection !== USAGE_MONITORING_DEFAULT_SORT_DIRECTION) {
    searchParams.set("sortDirection", params.sortDirection);
  }
  if (params.preset !== USAGE_MONITORING_DEFAULT_PRESET) {
    searchParams.set("preset", params.preset);
  }

  const queryString = searchParams.toString();
  return queryString
    ? `/admin/usage-monitoring?${queryString}`
    : "/admin/usage-monitoring";
}

export function buildUsageMonitoringApiUrl(params: {
  page: number;
  query?: string;
  sortBy: UsageMonitoringSortBy;
  sortDirection: "asc" | "desc";
  preset: DatePreset;
}) {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    sortBy: params.sortBy,
    sortDirection: params.sortDirection,
    preset: params.preset,
  });

  if (params.query) {
    searchParams.set("query", params.query);
  }

  return `/api/admin/usage-monitoring?${searchParams.toString()}`;
}
