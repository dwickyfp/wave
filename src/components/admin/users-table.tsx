"use client";

import { buildUserDetailUrl } from "@/lib/admin/navigation-utils";
import { AdminUserListItem, AdminUsersPaginated } from "app-types/admin";
import { format } from "date-fns";
import { ChevronRight, LoaderCircle, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from "react";
import useSWR from "swr";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { SortableHeader } from "ui/sortable-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "ui/table";
import { TablePagination } from "ui/table-pagination";

import { UserRoleBadges } from "@/components/user/user-detail/user-role-badges";
import { UserStatusBadge } from "@/components/user/user-detail/user-status-badge";
import {
  ADMIN_USERS_DEFAULT_SORT_BY,
  ADMIN_USERS_DEFAULT_SORT_DIRECTION,
  type AdminUsersSortBy,
  buildAdminUsersApiUrl,
  buildAdminUsersPageUrl,
  buildAdminUsersSearchParams,
  parseAdminUsersSearchParams,
} from "lib/admin/users";
import { getUserAvatar } from "lib/user/utils";
import { fetcher } from "lib/utils";

interface UsersTableProps {
  users: AdminUserListItem[];
  currentUserId: string;
  total: number;
  page: number;
  limit: number;
  query?: string;
  baseUrl?: string;
  sortBy: AdminUsersSortBy;
  sortDirection: "asc" | "desc";
}

interface UsersTableState {
  limit: number;
  page: number;
  query?: string;
  sortBy: AdminUsersSortBy;
  sortDirection: "asc" | "desc";
}

function getTableState({
  page,
  limit,
  query,
  sortBy,
  sortDirection,
}: UsersTableProps): UsersTableState {
  return {
    limit,
    page,
    query,
    sortBy,
    sortDirection,
  };
}

function sameTableState(
  currentState: UsersTableState,
  nextState: UsersTableState,
) {
  return (
    currentState.limit === nextState.limit &&
    currentState.page === nextState.page &&
    currentState.query === nextState.query &&
    currentState.sortBy === nextState.sortBy &&
    currentState.sortDirection === nextState.sortDirection
  );
}

export function UsersTable(props: UsersTableProps) {
  const {
    users,
    currentUserId,
    total,
    page,
    limit,
    query,
    baseUrl = "/admin/users",
  } = props;
  const router = useRouter();
  const t = useTranslations("Admin.Users");
  const [tableState, setTableState] = useState<UsersTableState>(
    getTableState(props),
  );
  const [queryInput, setQueryInput] = useState(query ?? "");

  const requestUrl = useMemo(
    () => buildAdminUsersApiUrl(tableState),
    [tableState],
  );

  const {
    data: resolvedData = {
      users,
      total,
      limit,
      offset: (page - 1) * limit,
    },
    error,
    isValidating,
  } = useSWR<AdminUsersPaginated>(requestUrl, fetcher, {
    fallbackData: {
      users,
      total,
      limit,
      offset: (page - 1) * limit,
    },
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  const totalPages = Math.ceil(resolvedData.total / tableState.limit);

  const updateBrowserUrl = useCallback(
    (nextState: UsersTableState, historyMode: "push" | "replace" = "push") => {
      const nextUrl = buildAdminUsersPageUrl({
        ...nextState,
        baseUrl,
      });
      window.history[historyMode === "push" ? "pushState" : "replaceState"](
        null,
        "",
        nextUrl,
      );
    },
    [baseUrl],
  );

  const commitTableState = useCallback(
    (nextState: UsersTableState, historyMode: "push" | "replace" = "push") => {
      if (sameTableState(tableState, nextState)) {
        return;
      }

      updateBrowserUrl(nextState, historyMode);
      startTransition(() => {
        setTableState(nextState);
      });
    },
    [tableState, updateBrowserUrl],
  );

  const applySearch = useEffectEvent((nextQueryInput: string) => {
    const normalizedQuery = nextQueryInput.trim() || undefined;

    if (normalizedQuery === tableState.query) {
      return;
    }

    commitTableState(
      {
        ...tableState,
        page: 1,
        query: normalizedQuery,
      },
      "replace",
    );
  });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      applySearch(queryInput);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [applySearch, queryInput]);

  useEffect(() => {
    const syncFromUrl = () => {
      const nextSearchState = parseAdminUsersSearchParams(
        new URLSearchParams(window.location.search),
        limit,
      );
      const nextState: UsersTableState = {
        limit: nextSearchState.limit,
        page: nextSearchState.page,
        query: nextSearchState.query,
        sortBy: nextSearchState.sortBy,
        sortDirection: nextSearchState.sortDirection,
      };

      setQueryInput(nextSearchState.query ?? "");
      setTableState((currentState) =>
        sameTableState(currentState, nextState) ? currentState : nextState,
      );
    };

    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [limit]);

  useEffect(() => {
    if (
      resolvedData.total === 0 ||
      totalPages === 0 ||
      tableState.page <= totalPages
    ) {
      return;
    }

    commitTableState(
      {
        ...tableState,
        page: totalPages,
      },
      "replace",
    );
  }, [commitTableState, resolvedData.total, tableState, totalPages]);

  const handleSort = useCallback(
    (field: string) => {
      const nextSortBy = field as AdminUsersSortBy;
      const nextSortDirection =
        tableState.sortBy === nextSortBy && tableState.sortDirection === "asc"
          ? "desc"
          : "asc";

      commitTableState({
        ...tableState,
        page: 1,
        sortBy: nextSortBy,
        sortDirection: nextSortDirection,
      });
    },
    [commitTableState, tableState],
  );

  const handlePageChange = useCallback(
    (nextPage: number) => {
      if (nextPage < 1 || (totalPages > 0 && nextPage > totalPages)) {
        return;
      }

      commitTableState({
        ...tableState,
        page: nextPage,
      });
    },
    [commitTableState, tableState, totalPages],
  );

  const handleClear = useCallback(() => {
    setQueryInput("");
    commitTableState(
      {
        ...tableState,
        page: 1,
        query: undefined,
        sortBy: ADMIN_USERS_DEFAULT_SORT_BY,
        sortDirection: ADMIN_USERS_DEFAULT_SORT_DIRECTION,
      },
      "replace",
    );
  }, [commitTableState, tableState]);

  const handleRowClick = useCallback(
    (userId: string) => {
      const currentSearchString =
        buildAdminUsersSearchParams(tableState).toString();
      const url = buildUserDetailUrl(userId, currentSearchString);

      startTransition(() => {
        router.push(url);
      });
    },
    [router, tableState],
  );

  const isFiltered =
    !!tableState.query ||
    tableState.sortBy !== ADMIN_USERS_DEFAULT_SORT_BY ||
    tableState.sortDirection !== ADMIN_USERS_DEFAULT_SORT_DIRECTION;

  return (
    <div className="space-y-4 w-full">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={queryInput}
              placeholder={t("searchPlaceholder")}
              className="pl-9 pr-9"
              onChange={(event) => {
                setQueryInput(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }

                event.preventDefault();
                applySearch(queryInput);
              }}
              data-testid="users-search-input"
            />
            {queryInput && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1 h-7 w-7"
                onClick={handleClear}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {isFiltered && (
            <Button variant="outline" onClick={handleClear}>
              <X className="h-4 w-4 mr-1" />
              {t("clear")}
            </Button>
          )}
        </div>
        <div
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="users-total-count"
        >
          <span>{t("totalCount", { count: resolvedData.total })}</span>
          {isValidating && (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          )}
        </div>
      </div>

      {error instanceof Error && (
        <p className="text-xs text-destructive">{error.message}</p>
      )}

      <div
        className="rounded-lg border bg-card w-full overflow-x-auto relative"
        aria-busy={isValidating}
      >
        {isValidating && (
          <div className="pointer-events-none absolute inset-0 z-10 bg-background/35 backdrop-blur-[1px]" />
        )}

        <Table data-testid="users-table" className="w-full">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortableHeader
                field="name"
                currentSortBy={tableState.sortBy}
                currentSortDirection={tableState.sortDirection}
                onSort={handleSort}
                data-testid="sort-header-name"
              >
                <span className="px-2">{t("user")}</span>
              </SortableHeader>
              <SortableHeader
                field="role"
                currentSortBy={tableState.sortBy}
                currentSortDirection={tableState.sortDirection}
                onSort={handleSort}
                data-testid="sort-header-role"
              >
                {t("role")}
              </SortableHeader>
              <TableHead className="font-semibold" data-testid="header-status">
                {t("status")}
              </TableHead>
              <SortableHeader
                field="createdAt"
                currentSortBy={tableState.sortBy}
                currentSortDirection={tableState.sortDirection}
                onSort={handleSort}
                data-testid="sort-header-createdAt"
              >
                {t("joined")}
              </SortableHeader>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {resolvedData.users.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center py-8 text-muted-foreground"
                >
                  {t("noUsersFound")}
                </TableCell>
              </TableRow>
            ) : (
              resolvedData.users.map((user) => (
                <TableRow
                  key={user.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => handleRowClick(user.id)}
                  data-testid={`user-row-${user.id}`}
                >
                  <TableCell>
                    <div className="flex items-center gap-3 px-2">
                      <Avatar className="size-8 rounded-full">
                        <AvatarImage src={getUserAvatar(user)} />
                        <AvatarFallback className="text-sm">
                          {user.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {user.name}
                          {user.id === currentUserId && (
                            <Badge
                              variant="outline"
                              className="text-xs"
                              data-testid="current-user-badge"
                            >
                              {t("youBadge")}
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {user.email}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <UserRoleBadges
                      user={{ ...user }}
                      showBanned={false}
                      className="mt-0"
                    />
                  </TableCell>
                  <TableCell>
                    <UserStatusBadge
                      user={{ ...user, lastLogin: user.lastLogin || null }}
                      currentUserId={currentUserId}
                      showClickable={false}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(user.createdAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>
                    <ChevronRight
                      className="h-4 w-4 text-muted-foreground"
                      data-testid="user-row-chevron"
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        currentPage={tableState.page}
        totalPages={totalPages}
        buildUrl={(params) =>
          buildAdminUsersPageUrl({
            ...tableState,
            baseUrl,
            page: params.page,
          })
        }
        onPageChange={handlePageChange}
      />
    </div>
  );
}
