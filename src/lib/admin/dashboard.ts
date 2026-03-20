import type {
  AdminDashboardKind,
  AdminDashboardListSortBy,
  AdminDashboardRangePreset,
} from "app-types/admin-dashboard";

export const ADMIN_DASHBOARD_LIMIT = 10;
export const ADMIN_DASHBOARD_DEFAULT_PRESET = "weekly";
export const ADMIN_DASHBOARD_DEFAULT_SORT_BY = "totalUsage";
export const ADMIN_DASHBOARD_DEFAULT_SORT_DIRECTION = "desc";

export interface AdminDashboardSearchState {
  page: number;
  limit: number;
  offset: number;
  preset: AdminDashboardRangePreset;
  query?: string;
  sortBy: AdminDashboardListSortBy;
  sortDirection: "asc" | "desc";
  startDate: Date;
  endDate: Date;
  startDateInput?: string;
  endDateInput?: string;
}

export interface AdminDashboardDetailSearchState {
  preset: AdminDashboardRangePreset;
  startDate: Date;
  endDate: Date;
  startDateInput?: string;
  endDateInput?: string;
}

export const ADMIN_DASHBOARD_TITLES: Record<AdminDashboardKind, string> = {
  agent: "Agent Dashboard",
  mcp: "MCP Dashboard",
  contextx: "ContextX Dashboard",
  skill: "Skills Dashboard",
  workflow: "Workflow Dashboard",
};

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

function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeStartOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function normalizeEndOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function parseDateInput(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolvePreset(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): AdminDashboardRangePreset {
  const preset = getParam(params, "preset");

  switch (preset) {
    case "daily":
    case "weekly":
    case "monthly":
    case "custom":
      return preset;
    default:
      return ADMIN_DASHBOARD_DEFAULT_PRESET;
  }
}

function resolveSortBy(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): AdminDashboardListSortBy {
  const sortBy = getParam(params, "sortBy");

  switch (sortBy) {
    case "name":
    case "creator":
    case "lastActiveAt":
    case "totalUsage":
      return sortBy;
    default:
      return ADMIN_DASHBOARD_DEFAULT_SORT_BY;
  }
}

function resolveSortDirection(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
) {
  return getParam(params, "sortDirection") === "asc" ? "asc" : "desc";
}

function resolvePage(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
) {
  const rawPage = Number.parseInt(getParam(params, "page") ?? "1", 10);
  return Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
}

export function getAdminDashboardDateRange(
  preset: AdminDashboardRangePreset,
  options?: {
    now?: Date;
    startDateInput?: string;
    endDateInput?: string;
  },
): {
  preset: AdminDashboardRangePreset;
  startDate: Date;
  endDate: Date;
  startDateInput?: string;
  endDateInput?: string;
} {
  const now = options?.now ?? new Date();
  const endDate = normalizeEndOfDay(now);
  const startDate = normalizeStartOfDay(now);

  if (preset === "daily") {
    return {
      preset,
      startDate,
      endDate,
      startDateInput: toDateInput(startDate),
      endDateInput: toDateInput(endDate),
    };
  }

  if (preset === "weekly" || preset === "monthly") {
    const dayCount = preset === "weekly" ? 7 : 30;
    const rangeStart = new Date(startDate);
    rangeStart.setDate(rangeStart.getDate() - (dayCount - 1));

    return {
      preset,
      startDate: rangeStart,
      endDate,
      startDateInput: toDateInput(rangeStart),
      endDateInput: toDateInput(endDate),
    };
  }

  const parsedStart = parseDateInput(options?.startDateInput);
  const parsedEnd = parseDateInput(options?.endDateInput);

  if (!parsedStart || !parsedEnd || parsedStart > parsedEnd) {
    return getAdminDashboardDateRange(ADMIN_DASHBOARD_DEFAULT_PRESET, {
      now,
    });
  }

  return {
    preset,
    startDate: normalizeStartOfDay(parsedStart),
    endDate: normalizeEndOfDay(parsedEnd),
    startDateInput: toDateInput(parsedStart),
    endDateInput: toDateInput(parsedEnd),
  };
}

export function parseAdminDashboardSearchParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
  limit: number = ADMIN_DASHBOARD_LIMIT,
  now?: Date,
): AdminDashboardSearchState {
  const preset = resolvePreset(params);
  const page = resolvePage(params);
  const query = getParam(params, "query")?.trim() || undefined;
  const sortBy = resolveSortBy(params);
  const sortDirection = resolveSortDirection(params);
  const {
    startDate,
    endDate,
    preset: resolvedPreset,
    startDateInput,
    endDateInput,
  } = getAdminDashboardDateRange(preset, {
    now,
    startDateInput: getParam(params, "startDate"),
    endDateInput: getParam(params, "endDate"),
  });

  return {
    page,
    limit,
    offset: (page - 1) * limit,
    preset: resolvedPreset,
    query,
    sortBy,
    sortDirection,
    startDate,
    endDate,
    startDateInput,
    endDateInput,
  };
}

export function parseAdminDashboardDetailSearchParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
  now?: Date,
): AdminDashboardDetailSearchState {
  const preset = resolvePreset(params);
  const {
    startDate,
    endDate,
    preset: resolvedPreset,
    startDateInput,
    endDateInput,
  } = getAdminDashboardDateRange(preset, {
    now,
    startDateInput: getParam(params, "startDate"),
    endDateInput: getParam(params, "endDate"),
  });

  return {
    preset: resolvedPreset,
    startDate,
    endDate,
    startDateInput,
    endDateInput,
  };
}

function buildSearchParams(input: {
  page?: number;
  query?: string;
  sortBy?: AdminDashboardListSortBy;
  sortDirection?: "asc" | "desc";
  preset: AdminDashboardRangePreset;
  startDate?: string;
  endDate?: string;
}) {
  const searchParams = new URLSearchParams();

  if (input.page && input.page > 1) {
    searchParams.set("page", String(input.page));
  }

  if (input.query) {
    searchParams.set("query", input.query);
  }

  if (input.sortBy && input.sortBy !== ADMIN_DASHBOARD_DEFAULT_SORT_BY) {
    searchParams.set("sortBy", input.sortBy);
  }

  if (
    input.sortDirection &&
    input.sortDirection !== ADMIN_DASHBOARD_DEFAULT_SORT_DIRECTION
  ) {
    searchParams.set("sortDirection", input.sortDirection);
  }

  if (input.preset !== ADMIN_DASHBOARD_DEFAULT_PRESET) {
    searchParams.set("preset", input.preset);
  }

  if (input.preset === "custom") {
    if (input.startDate) {
      searchParams.set("startDate", input.startDate);
    }
    if (input.endDate) {
      searchParams.set("endDate", input.endDate);
    }
  }

  return searchParams.toString();
}

export function buildAdminDashboardPageUrl(
  kind: AdminDashboardKind,
  input: {
    page?: number;
    query?: string;
    sortBy?: AdminDashboardListSortBy;
    sortDirection?: "asc" | "desc";
    preset: AdminDashboardRangePreset;
    startDate?: string;
    endDate?: string;
  },
) {
  const queryString = buildSearchParams(input);
  return queryString
    ? `/admin/dashboard/${kind}?${queryString}`
    : `/admin/dashboard/${kind}`;
}

export function buildAdminDashboardApiUrl(
  kind: AdminDashboardKind,
  input: {
    page?: number;
    query?: string;
    sortBy?: AdminDashboardListSortBy;
    sortDirection?: "asc" | "desc";
    preset: AdminDashboardRangePreset;
    startDate?: string;
    endDate?: string;
  },
) {
  const searchParams = new URLSearchParams({
    page: String(input.page ?? 1),
    sortBy: input.sortBy ?? ADMIN_DASHBOARD_DEFAULT_SORT_BY,
    sortDirection:
      input.sortDirection ?? ADMIN_DASHBOARD_DEFAULT_SORT_DIRECTION,
    preset: input.preset,
  });

  if (input.query) {
    searchParams.set("query", input.query);
  }

  if (input.preset === "custom") {
    if (input.startDate) {
      searchParams.set("startDate", input.startDate);
    }
    if (input.endDate) {
      searchParams.set("endDate", input.endDate);
    }
  }

  return `/api/admin/dashboard/${kind}?${searchParams.toString()}`;
}

export function buildAdminDashboardDetailPageUrl(
  kind: AdminDashboardKind,
  id: string,
  input: {
    preset: AdminDashboardRangePreset;
    startDate?: string;
    endDate?: string;
  },
) {
  const queryString = buildSearchParams({
    preset: input.preset,
    startDate: input.startDate,
    endDate: input.endDate,
  });

  return queryString
    ? `/admin/dashboard/${kind}/${id}?${queryString}`
    : `/admin/dashboard/${kind}/${id}`;
}

export function buildAdminDashboardDetailApiUrl(
  kind: AdminDashboardKind,
  id: string,
  input: {
    preset: AdminDashboardRangePreset;
    startDate?: string;
    endDate?: string;
  },
) {
  const searchParams = new URLSearchParams({
    preset: input.preset,
  });

  if (input.preset === "custom") {
    if (input.startDate) {
      searchParams.set("startDate", input.startDate);
    }
    if (input.endDate) {
      searchParams.set("endDate", input.endDate);
    }
  }

  return `/api/admin/dashboard/${kind}/${id}?${searchParams.toString()}`;
}

export const resolveAdminDashboardDateRange = getAdminDashboardDateRange;
