import { type AdminUsersQuery } from "app-types/admin";

export const ADMIN_USERS_DEFAULT_SORT_BY = "createdAt";
export const ADMIN_USERS_DEFAULT_SORT_DIRECTION = "desc";

const ADMIN_USERS_ALLOWED_SORT_FIELDS = [
  "createdAt",
  "email",
  "name",
  "role",
  "updatedAt",
] as const;

export type AdminUsersSortBy = (typeof ADMIN_USERS_ALLOWED_SORT_FIELDS)[number];

export interface AdminUsersSearchState {
  limit: number;
  offset: number;
  page: number;
  query?: string;
  sortBy: AdminUsersSortBy;
  sortDirection: "asc" | "desc";
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

function getPositiveInt(
  value: string | undefined,
  fallback: number,
  minimum = 1,
) {
  const parsed = Number.parseInt(value ?? "", 10);

  if (Number.isNaN(parsed) || parsed < minimum) {
    return fallback;
  }

  return parsed;
}

function getSortBy(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): AdminUsersSortBy {
  const sortBy = getParam(params, "sortBy");

  return ADMIN_USERS_ALLOWED_SORT_FIELDS.includes(sortBy as AdminUsersSortBy)
    ? (sortBy as AdminUsersSortBy)
    : ADMIN_USERS_DEFAULT_SORT_BY;
}

function getSortDirection(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
) {
  return getParam(params, "sortDirection") === "asc" ? "asc" : "desc";
}

export function parseAdminUsersSearchParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
  defaultLimit: number,
): AdminUsersSearchState {
  const limit = getPositiveInt(getParam(params, "limit"), defaultLimit);
  const page = getPositiveInt(getParam(params, "page"), 1);
  const query = getParam(params, "query")?.trim() || undefined;
  const sortBy = getSortBy(params);
  const sortDirection = getSortDirection(params);

  return {
    limit,
    offset: (page - 1) * limit,
    page,
    query,
    sortBy,
    sortDirection,
  };
}

export function buildAdminUsersSearchParams(params: {
  limit: number;
  page: number;
  query?: string;
  sortBy: AdminUsersSortBy;
  sortDirection: "asc" | "desc";
}) {
  const searchParams = new URLSearchParams();

  if (params.limit > 0) {
    searchParams.set("limit", String(params.limit));
  }
  if (params.page > 1) {
    searchParams.set("page", String(params.page));
  }
  if (params.query) {
    searchParams.set("query", params.query);
  }
  if (params.sortBy !== ADMIN_USERS_DEFAULT_SORT_BY) {
    searchParams.set("sortBy", params.sortBy);
  }
  if (params.sortDirection !== ADMIN_USERS_DEFAULT_SORT_DIRECTION) {
    searchParams.set("sortDirection", params.sortDirection);
  }

  return searchParams;
}

export function buildAdminUsersPageUrl(params: {
  baseUrl?: string;
  limit: number;
  page: number;
  query?: string;
  sortBy: AdminUsersSortBy;
  sortDirection: "asc" | "desc";
}) {
  const baseUrl = params.baseUrl ?? "/admin/users";
  const searchParams = buildAdminUsersSearchParams(params);
  const queryString = searchParams.toString();

  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

export function buildAdminUsersApiUrl(params: {
  limit: number;
  page: number;
  query?: string;
  sortBy: AdminUsersSortBy;
  sortDirection: "asc" | "desc";
}) {
  const searchParams = buildAdminUsersSearchParams(params);
  return `/api/admin/users?${searchParams.toString()}`;
}

export function buildAdminUsersQuery(
  searchState: AdminUsersSearchState,
): AdminUsersQuery {
  return {
    searchField: "email",
    searchOperator: "contains",
    searchValue: searchState.query,
    limit: searchState.limit,
    offset: searchState.offset,
    sortBy: searchState.sortBy,
    sortDirection: searchState.sortDirection,
  };
}
