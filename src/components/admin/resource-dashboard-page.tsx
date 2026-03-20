"use client";

import { DashboardListChartCard } from "@/components/admin/resource-dashboard-charts";
import type {
  AdminDashboardKind,
  AdminDashboardListData,
  AdminDashboardListSortBy,
  AdminDashboardRangePreset,
} from "app-types/admin-dashboard";
import {
  buildAdminDashboardApiUrl,
  buildAdminDashboardDetailPageUrl,
  buildAdminDashboardPageUrl,
} from "lib/admin/dashboard";
import { notify } from "lib/notify";
import { cn, fetcher } from "lib/utils";
import { ArrowRight, LoaderCircle, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
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
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
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

const RANGE_PRESETS: Array<{
  value: AdminDashboardRangePreset;
  label: string;
}> = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom range" },
];

type ListViewState = {
  page: number;
  query?: string;
  sortBy: AdminDashboardListSortBy;
  sortDirection: "asc" | "desc";
  preset: AdminDashboardRangePreset;
  startDate?: string;
  endDate?: string;
};

interface ResourceDashboardPageProps {
  kind: AdminDashboardKind;
  data: AdminDashboardListData;
  page: number;
  limit: number;
  query?: string;
  sortBy: AdminDashboardListSortBy;
  sortDirection: "asc" | "desc";
  preset: AdminDashboardRangePreset;
  startDate?: string;
  endDate?: string;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Never";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getViewState(props: ResourceDashboardPageProps): ListViewState {
  return {
    page: props.page,
    query: props.query,
    sortBy: props.sortBy,
    sortDirection: props.sortDirection,
    preset: props.preset,
    startDate: props.startDate,
    endDate: props.endDate,
  };
}

function sameViewState(current: ListViewState, next: ListViewState) {
  return (
    current.page === next.page &&
    current.query === next.query &&
    current.sortBy === next.sortBy &&
    current.sortDirection === next.sortDirection &&
    current.preset === next.preset &&
    current.startDate === next.startDate &&
    current.endDate === next.endDate
  );
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-2xl font-semibold">
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
        {hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : (
          <div className="h-4" />
        )}
      </CardContent>
    </Card>
  );
}

export function ResourceDashboardPage(props: ResourceDashboardPageProps) {
  const { kind, data, limit } = props;
  const [viewState, setViewState] = useState<ListViewState>(
    getViewState(props),
  );
  const [queryInput, setQueryInput] = useState(props.query ?? "");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const requestUrl = useMemo(
    () => buildAdminDashboardApiUrl(kind, viewState),
    [kind, viewState],
  );

  const {
    data: resolvedData = data,
    error,
    isValidating,
    mutate,
  } = useSWR<AdminDashboardListData>(requestUrl, fetcher, {
    fallbackData: data,
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  const totalPages = Math.max(1, Math.ceil(resolvedData.total / limit));
  const pageStart =
    resolvedData.total === 0 ? 0 : (viewState.page - 1) * limit + 1;
  const pageEnd = Math.min(viewState.page * limit, resolvedData.total);

  const updateBrowserUrl = useCallback(
    (nextState: ListViewState, historyMode: "push" | "replace" = "push") => {
      const nextUrl = buildAdminDashboardPageUrl(kind, nextState);
      window.history[historyMode === "push" ? "pushState" : "replaceState"](
        null,
        "",
        nextUrl,
      );
    },
    [kind],
  );

  const commitViewState = useCallback(
    (nextState: ListViewState, historyMode: "push" | "replace" = "push") => {
      if (sameViewState(viewState, nextState)) {
        return;
      }

      updateBrowserUrl(nextState, historyMode);
      startTransition(() => {
        setViewState(nextState);
      });
    },
    [updateBrowserUrl, viewState],
  );

  const applySearch = useEffectEvent((nextQueryInput: string) => {
    const normalizedQuery = nextQueryInput.trim() || undefined;
    if (normalizedQuery === viewState.query) {
      return;
    }

    commitViewState(
      {
        ...viewState,
        page: 1,
        query: normalizedQuery,
      },
      "replace",
    );
  });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      applySearch(queryInput);
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [applySearch, queryInput]);

  useEffect(() => {
    const syncFromUrl = () => {
      const searchParams = new URLSearchParams(window.location.search);
      const nextState = {
        ...viewState,
        page: Number.parseInt(searchParams.get("page") ?? "1", 10) || 1,
        query: searchParams.get("query") ?? undefined,
        sortBy:
          (searchParams.get("sortBy") as AdminDashboardListSortBy | null) ??
          "totalUsage",
        sortDirection:
          searchParams.get("sortDirection") === "asc" ? "asc" : "desc",
        preset:
          (searchParams.get("preset") as AdminDashboardRangePreset | null) ??
          "weekly",
        startDate: searchParams.get("startDate") ?? undefined,
        endDate: searchParams.get("endDate") ?? undefined,
      } satisfies ListViewState;

      setQueryInput(nextState.query ?? "");
      startTransition(() => {
        setViewState(nextState);
      });
    };

    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [viewState]);

  const handleSort = useCallback(
    (field: string) => {
      const typedField = field as AdminDashboardListSortBy;
      commitViewState({
        ...viewState,
        page: 1,
        sortBy: typedField,
        sortDirection:
          viewState.sortBy === typedField && viewState.sortDirection === "desc"
            ? "asc"
            : "desc",
      });
    },
    [commitViewState, viewState],
  );

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      const confirmed = await notify.confirm({
        description: `Delete ${name}? This action cannot be undone.`,
      });
      if (!confirmed) return;

      try {
        setDeletingId(id);
        const response = await fetch(`/api/admin/dashboard/${kind}/${id}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          throw new Error("Delete failed");
        }

        await mutate();
      } finally {
        setDeletingId(null);
      }
    },
    [kind, mutate],
  );

  const isCustomRange = viewState.preset === "custom";

  return (
    <div className="flex w-full flex-col gap-6 p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{resolvedData.title}</h1>
        <p className="text-sm text-muted-foreground">
          Inspect usage, activity, and ownership across admin-managed resources.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {resolvedData.metrics.map((metric) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            hint={metric.hint}
          />
        ))}
      </div>

      <div className="space-y-2">
        <div>
          <h2 className="text-lg font-semibold">Overview charts</h2>
          <p className="text-sm text-muted-foreground">
            Compare leaders, ownership distribution, and overall activity
            coverage for the current filtered set.
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          {resolvedData.charts.map((chart) => (
            <DashboardListChartCard
              chart={chart}
              key={`${resolvedData.kind}-${chart.title}`}
            />
          ))}
        </div>
      </div>

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Usage table</CardTitle>
            <p className="text-sm text-muted-foreground">
              {resolvedData.total > 0
                ? `Showing ${pageStart}-${pageEnd} of ${resolvedData.total}`
                : "No resources found for this range."}
            </p>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative min-w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9 pr-9"
                placeholder="Search resources or creators"
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
              />
              {queryInput ? (
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setQueryInput("")}
                  type="button"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>

            <Select
              value={viewState.preset}
              onValueChange={(value: AdminDashboardRangePreset) =>
                commitViewState({
                  ...viewState,
                  page: 1,
                  preset: value,
                })
              }
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select range" />
              </SelectTrigger>
              <SelectContent>
                {RANGE_PRESETS.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {isCustomRange ? (
              <>
                <Input
                  type="date"
                  value={viewState.startDate ?? ""}
                  onChange={(event) =>
                    commitViewState(
                      {
                        ...viewState,
                        page: 1,
                        startDate: event.target.value || undefined,
                      },
                      "replace",
                    )
                  }
                />
                <Input
                  type="date"
                  value={viewState.endDate ?? ""}
                  onChange={(event) =>
                    commitViewState(
                      {
                        ...viewState,
                        page: 1,
                        endDate: event.target.value || undefined,
                      },
                      "replace",
                    )
                  }
                />
              </>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHeader
                    field="name"
                    currentSortBy={viewState.sortBy}
                    currentSortDirection={viewState.sortDirection}
                    onSort={handleSort}
                  >
                    Name
                  </SortableHeader>
                  <SortableHeader
                    field="totalUsage"
                    currentSortBy={viewState.sortBy}
                    currentSortDirection={viewState.sortDirection}
                    onSort={handleSort}
                  >
                    {resolvedData.usageLabel}
                  </SortableHeader>
                  <SortableHeader
                    field="creator"
                    currentSortBy={viewState.sortBy}
                    currentSortDirection={viewState.sortDirection}
                    onSort={handleSort}
                  >
                    Creator
                  </SortableHeader>
                  <SortableHeader
                    field="lastActiveAt"
                    currentSortBy={viewState.sortBy}
                    currentSortDirection={viewState.sortDirection}
                    onSort={handleSort}
                  >
                    Last active
                  </SortableHeader>
                  <TableHead>Details</TableHead>
                  <TableHead className="w-[96px]">Delete</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {error ? (
                  <TableRow>
                    <TableCell
                      className="py-10 text-center text-sm text-destructive"
                      colSpan={6}
                    >
                      Failed to load dashboard data.
                    </TableCell>
                  </TableRow>
                ) : resolvedData.items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      className="py-10 text-center text-sm text-muted-foreground"
                      colSpan={6}
                    >
                      No resources found.
                    </TableCell>
                  </TableRow>
                ) : (
                  resolvedData.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="space-y-2">
                        <div className="font-medium">{item.name}</div>
                        <div className="flex flex-wrap gap-2">
                          {item.badges.map((badge) => (
                            <Badge
                              key={`${item.id}-${badge}`}
                              variant="outline"
                            >
                              {badge}
                            </Badge>
                          ))}
                        </div>
                        {item.meta ? (
                          <p className="text-xs text-muted-foreground">
                            {item.meta}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-medium">
                        {item.totalUsage.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="size-8">
                            <AvatarImage src={item.creatorImage ?? undefined} />
                            <AvatarFallback>
                              {(item.creatorName || item.creatorEmail || "?")
                                .slice(0, 2)
                                .toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {item.creatorName}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {item.creatorEmail}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{formatDateTime(item.lastActiveAt)}</TableCell>
                      <TableCell>
                        <Button asChild size="sm" variant="outline">
                          <Link
                            href={buildAdminDashboardDetailPageUrl(
                              kind,
                              item.id,
                              {
                                preset: viewState.preset,
                                startDate: viewState.startDate,
                                endDate: viewState.endDate,
                              },
                            )}
                          >
                            Details
                            <ArrowRight className="ml-2 size-4" />
                          </Link>
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Button
                          disabled={deletingId === item.id}
                          onClick={() => handleDelete(item.id, item.name)}
                          size="icon"
                          variant="ghost"
                        >
                          {deletingId === item.id ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4 text-destructive" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}

                {isValidating && resolvedData.items.length === 0
                  ? Array.from({ length: 3 }).map((_, index) => (
                      <TableRow key={`skeleton-${index}`}>
                        <TableCell colSpan={6}>
                          <Skeleton className="h-14 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  : null}
              </TableBody>
            </Table>
          </div>

          <div
            className={cn(
              "flex flex-col gap-3 md:flex-row md:items-center md:justify-between",
            )}
          >
            <p className="text-sm text-muted-foreground">
              {resolvedData.total > 0
                ? `Showing ${pageStart}-${pageEnd} of ${resolvedData.total}`
                : "No rows to display"}
            </p>
            <TablePagination
              currentPage={viewState.page}
              totalPages={totalPages}
              buildUrl={({ page }) =>
                buildAdminDashboardPageUrl(kind, {
                  ...viewState,
                  page,
                })
              }
              onPageChange={(page) =>
                commitViewState({
                  ...viewState,
                  page,
                })
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
