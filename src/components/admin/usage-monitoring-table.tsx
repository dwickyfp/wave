"use client";

import { buildUserDetailUrl } from "@/lib/admin/navigation-utils";
import { UsageMonitoringData, UserUsageStat } from "app-types/admin";
import {
  DatePreset,
  type UsageMonitoringSortBy,
  buildUsageMonitoringApiUrl,
  buildUsageMonitoringPageUrl,
  parseUsageMonitoringSearchParams,
} from "lib/admin/usage-monitoring";
import { getUserAvatar } from "lib/user/utils";
import { cn, fetcher } from "lib/utils";
import {
  BarChart2,
  ChevronRight,
  Cpu,
  DollarSign,
  LoaderCircle,
  MessageCircle,
  MessagesSquare,
  Search,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
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
import { Card, CardContent } from "ui/card";
import { Input } from "ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "ui/select";
import { Skeleton } from "ui/skeleton";
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
import {
  TopModelsPieChart,
  TopUsersBarChart,
  TopUsersByMessages,
} from "./usage-charts";

const DATE_PRESETS: { value: DatePreset; labelKey: string }[] = [
  { value: "7d", labelKey: "last7Days" },
  { value: "14d", labelKey: "last14Days" },
  { value: "30d", labelKey: "last30Days" },
  { value: "90d", labelKey: "last90Days" },
];

interface UsageMonitoringTableProps {
  data: UsageMonitoringData;
  page: number;
  limit: number;
  query?: string;
  sortBy: UsageMonitoringSortBy;
  sortDirection: "asc" | "desc";
  preset: DatePreset;
}

interface UsageMonitoringViewState {
  page: number;
  query?: string;
  sortBy: UsageMonitoringSortBy;
  sortDirection: "asc" | "desc";
  preset: DatePreset;
}

function getViewState({
  page,
  query,
  sortBy,
  sortDirection,
  preset,
}: UsageMonitoringTableProps): UsageMonitoringViewState {
  return {
    page,
    query,
    sortBy,
    sortDirection,
    preset,
  };
}

function sameViewState(
  currentState: UsageMonitoringViewState,
  nextState: UsageMonitoringViewState,
) {
  return (
    currentState.page === nextState.page &&
    currentState.query === nextState.query &&
    currentState.sortBy === nextState.sortBy &&
    currentState.sortDirection === nextState.sortDirection &&
    currentState.preset === nextState.preset
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  colorClass,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  colorClass?: string;
}) {
  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={cn("shrink-0 rounded-full p-2", colorClass)}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <p className="mb-0.5 text-xs font-medium text-muted-foreground">
              {label}
            </p>
            <p className="text-xl font-bold leading-none">
              {typeof value === "number" ? value.toLocaleString() : value}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatUsd(value: number) {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(6)}`;
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function UsageMonitoringTable(props: UsageMonitoringTableProps) {
  const { data, limit } = props;
  const t = useTranslations("Admin.UsageMonitoring");
  const [tableState, setTableState] = useState<UsageMonitoringViewState>(
    getViewState(props),
  );
  const [queryInput, setQueryInput] = useState(props.query ?? "");

  const requestUrl = useMemo(
    () => buildUsageMonitoringApiUrl(tableState),
    [tableState],
  );

  const {
    data: resolvedData = data,
    error,
    isValidating,
  } = useSWR<UsageMonitoringData>(requestUrl, fetcher, {
    fallbackData: data,
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  const totalPages = Math.ceil(resolvedData.total / limit);
  const pageStart =
    resolvedData.total === 0 ? 0 : (tableState.page - 1) * limit + 1;
  const pageEnd = Math.min(tableState.page * limit, resolvedData.total);
  const selectedPreset = DATE_PRESETS.find(
    (datePreset) => datePreset.value === tableState.preset,
  );
  const maxTokensOnPage = useMemo(
    () => Math.max(...resolvedData.users.map((user) => user.totalTokens), 0),
    [resolvedData.users],
  );

  const updateBrowserUrl = useCallback(
    (
      nextState: UsageMonitoringViewState,
      historyMode: "push" | "replace" = "push",
    ) => {
      const nextUrl = buildUsageMonitoringPageUrl(nextState);
      window.history[historyMode === "push" ? "pushState" : "replaceState"](
        null,
        "",
        nextUrl,
      );
    },
    [],
  );

  const commitTableState = useCallback(
    (
      nextState: UsageMonitoringViewState,
      historyMode: "push" | "replace" = "push",
    ) => {
      if (sameViewState(tableState, nextState)) {
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
        query: normalizedQuery,
        page: 1,
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
      const nextSearchState = parseUsageMonitoringSearchParams(
        new URLSearchParams(window.location.search),
        limit,
      );
      const nextState: UsageMonitoringViewState = {
        page: nextSearchState.page,
        query: nextSearchState.query,
        sortBy: nextSearchState.sortBy,
        sortDirection: nextSearchState.sortDirection,
        preset: nextSearchState.preset,
      };

      setQueryInput(nextSearchState.query ?? "");
      setTableState((currentState) =>
        sameViewState(currentState, nextState) ? currentState : nextState,
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
      const nextSortBy = field as UsageMonitoringSortBy;
      const nextSortDirection =
        tableState.sortBy === nextSortBy && tableState.sortDirection === "desc"
          ? "asc"
          : "desc";

      commitTableState({
        ...tableState,
        page: 1,
        sortBy: nextSortBy,
        sortDirection: nextSortDirection,
      });
    },
    [commitTableState, tableState],
  );

  const handlePresetChange = useCallback(
    (value: string) => {
      commitTableState({
        ...tableState,
        page: 1,
        preset: value as DatePreset,
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

  const handleClearSearch = useCallback(() => {
    setQueryInput("");
    commitTableState(
      {
        ...tableState,
        page: 1,
        query: undefined,
      },
      "replace",
    );
  }, [commitTableState, tableState]);

  const handleSubmitSearch = useCallback(() => {
    commitTableState(
      {
        ...tableState,
        page: 1,
        query: queryInput.trim() || undefined,
      },
      "replace",
    );
  }, [commitTableState, queryInput, tableState]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BarChart2 className="h-6 w-6 text-foreground" />
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("description")}
          </p>
        </div>
        <Select value={tableState.preset} onValueChange={handlePresetChange}>
          <SelectTrigger
            className="w-full sm:w-40"
            data-testid="usage-monitoring-date-preset"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_PRESETS.map((datePreset) => (
              <SelectItem key={datePreset.value} value={datePreset.value}>
                {t(datePreset.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          icon={Zap}
          label={t("totalTokens")}
          value={resolvedData.totalTokensSum}
          colorClass="bg-primary/10 text-primary"
        />
        <StatCard
          icon={DollarSign}
          label={t("totalPrice")}
          value={formatUsd(resolvedData.totalCostUsd)}
          colorClass="bg-emerald-500/10 text-emerald-500"
        />
        <StatCard
          icon={MessageCircle}
          label={t("totalMessages")}
          value={resolvedData.totalMessagesSum}
          colorClass="bg-blue-500/10 text-blue-500"
        />
        <StatCard
          icon={MessagesSquare}
          label={t("totalThreads")}
          value={resolvedData.totalThreadsSum}
          colorClass="bg-violet-500/10 text-violet-500"
        />
        <StatCard
          icon={Users}
          label={t("activeUsers")}
          value={resolvedData.activeUsersCount}
          colorClass="bg-amber-500/10 text-amber-500"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <TopModelsPieChart modelDistribution={resolvedData.modelDistribution} />
        <TopUsersBarChart users={resolvedData.users} />
        <TopUsersByMessages users={resolvedData.users} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="border-b bg-muted/20 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-foreground">
                  {t("allUsers")}
                </span>
                <Badge variant="secondary" className="font-mono text-xs">
                  {resolvedData.total}
                </Badge>
                {selectedPreset && (
                  <Badge variant="outline" className="text-xs">
                    {t(selectedPreset.labelKey)}
                  </Badge>
                )}
                {resolvedData.total > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {pageStart}-{pageEnd}
                  </span>
                )}
                {isValidating && (
                  <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
                )}
              </div>
              {error instanceof Error && (
                <p className="text-xs text-destructive">{error.message}</p>
              )}
            </div>

            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={queryInput}
                  placeholder={t("searchPlaceholder")}
                  className="h-9 w-full pl-8 pr-8 text-sm sm:w-72"
                  onChange={(event) => {
                    setQueryInput(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") {
                      return;
                    }

                    event.preventDefault();
                    handleSubmitSearch();
                  }}
                />
                {queryInput && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1 h-7 w-7"
                    onClick={handleClearSearch}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="relative" aria-busy={isValidating}>
          {isValidating && (
            <div className="pointer-events-none absolute inset-0 z-10 bg-background/45 backdrop-blur-[1px]" />
          )}

          <Table className="min-w-[940px]">
            <TableHeader className="bg-muted/25">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[64px] pl-4 font-semibold">#</TableHead>
                <TableHead className="w-[280px] font-semibold">
                  {t("user")}
                </TableHead>
                <SortableHeader
                  field="totalTokens"
                  currentSortBy={tableState.sortBy}
                  currentSortDirection={tableState.sortDirection}
                  onSort={handleSort}
                  className="w-[240px]"
                  data-testid="sort-totalTokens"
                >
                  {t("tokens")}
                </SortableHeader>
                <SortableHeader
                  field="totalCostUsd"
                  currentSortBy={tableState.sortBy}
                  currentSortDirection={tableState.sortDirection}
                  onSort={handleSort}
                  data-testid="sort-totalCostUsd"
                >
                  {t("price")}
                </SortableHeader>
                <SortableHeader
                  field="messageCount"
                  currentSortBy={tableState.sortBy}
                  currentSortDirection={tableState.sortDirection}
                  onSort={handleSort}
                  data-testid="sort-messageCount"
                >
                  {t("messages")}
                </SortableHeader>
                <SortableHeader
                  field="threadCount"
                  currentSortBy={tableState.sortBy}
                  currentSortDirection={tableState.sortDirection}
                  onSort={handleSort}
                  data-testid="sort-threadCount"
                >
                  {t("threads")}
                </SortableHeader>
                <TableHead className="font-semibold">{t("topModel")}</TableHead>
                <TableHead className="pr-4 text-right font-semibold" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {resolvedData.users.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-16 text-center text-muted-foreground"
                  >
                    <div className="flex flex-col items-center gap-3">
                      <BarChart2 className="h-10 w-10 opacity-30" />
                      <p className="font-medium">{t("noData")}</p>
                      <p className="text-xs">{t("noDataDescription")}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                resolvedData.users.map((user, index) => (
                  <UsageMonitoringRow
                    key={user.userId}
                    user={user}
                    rank={(tableState.page - 1) * limit + index + 1}
                    maxTokens={maxTokensOnPage}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="border-t px-4 py-3 sm:px-5">
            <TablePagination
              currentPage={tableState.page}
              totalPages={totalPages}
              buildUrl={(params) =>
                buildUsageMonitoringPageUrl({
                  ...tableState,
                  page: params.page,
                })
              }
              onPageChange={handlePageChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function UsageMonitoringRow({
  user,
  rank,
  maxTokens,
}: {
  user: UserUsageStat;
  rank: number;
  maxTokens: number;
}) {
  const router = useRouter();
  const avatarSrc = getUserAvatar(user);
  const hasActivity = user.totalTokens > 0;
  const userDetailUrl = buildUserDetailUrl(user.userId);
  const usageShare =
    maxTokens > 0
      ? Math.max((user.totalTokens / maxTokens) * 100, hasActivity ? 8 : 0)
      : 0;

  return (
    <TableRow
      className={cn(
        "group cursor-pointer transition-all hover:bg-muted/40",
        !hasActivity && "opacity-70",
      )}
      onClick={() => {
        startTransition(() => {
          router.push(userDetailUrl);
        });
      }}
    >
      <TableCell className="pl-4">
        <div
          className={cn(
            "flex size-8 items-center justify-center rounded-full border text-xs font-semibold",
            hasActivity
              ? "border-primary/25 bg-primary/5 text-primary"
              : "border-border text-muted-foreground",
          )}
        >
          {rank}
        </div>
      </TableCell>

      <TableCell className="py-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarImage src={avatarSrc} alt={user.name} />
            <AvatarFallback className="text-xs font-medium">
              {user.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">
                {user.name}
              </span>
              {user.role === "admin" && (
                <Badge
                  variant="outline"
                  className="h-5 shrink-0 px-2 text-[10px] uppercase tracking-[0.12em]"
                >
                  Admin
                </Badge>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {user.email}
            </p>
          </div>
        </div>
      </TableCell>

      <TableCell>
        <div className="min-w-[220px] space-y-2">
          <div className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span
              className={cn(
                "font-semibold tabular-nums text-sm",
                hasActivity ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {user.totalTokens.toLocaleString()}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary/80 transition-[width] duration-300"
              style={{ width: `${usageShare}%` }}
            />
          </div>
        </div>
      </TableCell>

      <TableCell>
        <div className="inline-flex min-w-[88px] items-center rounded-full bg-emerald-500/10 px-3 py-1.5 text-sm font-medium tabular-nums text-emerald-600">
          {formatUsd(user.totalCostUsd)}
        </div>
      </TableCell>

      <TableCell>
        <span className="text-sm font-medium tabular-nums">
          {user.messageCount.toLocaleString()}
        </span>
      </TableCell>

      <TableCell>
        <span className="text-sm font-medium tabular-nums">
          {user.threadCount.toLocaleString()}
        </span>
      </TableCell>

      <TableCell>
        {user.topModel ? (
          <div className="inline-flex max-w-[200px] items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-3 py-1.5">
            <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-xs font-medium text-muted-foreground">
              {user.topModel}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>

      <TableCell className="pr-4 text-right">
        <Button asChild variant="ghost" size="sm" className="h-8 px-2.5">
          <Link
            href={userDetailUrl}
            className="text-xs"
            onClick={(event) => event.stopPropagation()}
          >
            View
            <ChevronRight className="size-3.5" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function UsageMonitoringTableSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-6 w-16" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="rounded-2xl border">
        <div className="flex items-center justify-between border-b p-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-9 w-64" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4 px-6 py-4">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-24 rounded-full" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-8 w-28 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
