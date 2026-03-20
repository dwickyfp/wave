export const SELF_LEARNING_USER_LIST_LIMIT = 10;

export interface SelfLearningUsersSearchState {
  limit: number;
  offset: number;
  page: number;
  query?: string;
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

export function parseSelfLearningUsersSearchParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): SelfLearningUsersSearchState {
  const limit = SELF_LEARNING_USER_LIST_LIMIT;
  const page = getPositiveInt(getParam(params, "page"), 1);
  const query = getParam(params, "query")?.trim() || undefined;

  return {
    limit,
    offset: (page - 1) * limit,
    page,
    query,
  };
}

export function buildSelfLearningUsersSearchParams(params: {
  page: number;
  query?: string;
}) {
  const searchParams = new URLSearchParams();

  if (params.page > 1) {
    searchParams.set("page", String(params.page));
  }

  if (params.query) {
    searchParams.set("query", params.query);
  }

  return searchParams;
}

export function buildSelfLearningUsersPageUrl(params: {
  page: number;
  query?: string;
  baseUrl?: string;
}) {
  const baseUrl = params.baseUrl ?? "/admin/evaluation";
  const searchParams = buildSelfLearningUsersSearchParams(params);
  const queryString = searchParams.toString();

  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

export function buildSelfLearningUsersApiUrl(params: {
  page: number;
  query?: string;
}) {
  const searchParams = buildSelfLearningUsersSearchParams(params);
  const queryString = searchParams.toString();

  return queryString
    ? `/api/admin/evaluation?${queryString}`
    : "/api/admin/evaluation";
}
