"use client";

import {
  DashboardBreakdownChartCard,
  DashboardRankingChartCard,
  DashboardTimelineChartCard,
} from "@/components/admin/resource-dashboard-charts";
import type {
  AdminDashboardDetailData,
  AdminDashboardKind,
  AdminDashboardRangePreset,
} from "app-types/admin-dashboard";
import {
  buildAdminDashboardDetailApiUrl,
  buildAdminDashboardDetailPageUrl,
  buildAdminDashboardPageUrl,
} from "lib/admin/dashboard";
import { buildAdminDashboardDetailInsights } from "lib/admin/resource-dashboard-insights";
import { notify } from "lib/notify";
import { fetcher } from "lib/utils";
import { ArrowLeft, LoaderCircle, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useCallback,
  useEffect,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "ui/table";

const RANGE_PRESETS: Array<{
  value: AdminDashboardRangePreset;
  label: string;
}> = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom range" },
];

type DetailViewState = {
  preset: AdminDashboardRangePreset;
  startDate?: string;
  endDate?: string;
};

interface ResourceDashboardDetailPageProps {
  kind: AdminDashboardKind;
  id: string;
  data: AdminDashboardDetailData;
  preset: AdminDashboardRangePreset;
  startDate?: string;
  endDate?: string;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Unknown";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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

export function ResourceDashboardDetailPage(
  props: ResourceDashboardDetailPageProps,
) {
  const { kind, id, data } = props;
  const router = useRouter();
  const [viewState, setViewState] = useState<DetailViewState>({
    preset: props.preset,
    startDate: props.startDate,
    endDate: props.endDate,
  });
  const [isDeleting, setIsDeleting] = useState(false);

  const requestUrl = useMemo(
    () => buildAdminDashboardDetailApiUrl(kind, id, viewState),
    [id, kind, viewState],
  );

  const {
    data: resolvedData = data,
    error,
    isValidating,
  } = useSWR<AdminDashboardDetailData>(requestUrl, fetcher, {
    fallbackData: data,
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  const updateBrowserUrl = useCallback(
    (nextState: DetailViewState, historyMode: "push" | "replace" = "push") => {
      const nextUrl = buildAdminDashboardDetailPageUrl(kind, id, nextState);
      window.history[historyMode === "push" ? "pushState" : "replaceState"](
        null,
        "",
        nextUrl,
      );
    },
    [id, kind],
  );

  const commitViewState = useCallback(
    (nextState: DetailViewState, historyMode: "push" | "replace" = "push") => {
      updateBrowserUrl(nextState, historyMode);
      startTransition(() => {
        setViewState(nextState);
      });
    },
    [updateBrowserUrl],
  );

  useEffect(() => {
    const syncFromUrl = () => {
      const searchParams = new URLSearchParams(window.location.search);
      startTransition(() => {
        setViewState({
          preset:
            (searchParams.get("preset") as AdminDashboardRangePreset | null) ??
            "weekly",
          startDate: searchParams.get("startDate") ?? undefined,
          endDate: searchParams.get("endDate") ?? undefined,
        });
      });
    };

    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  const handleDelete = useCallback(async () => {
    const confirmed = await notify.confirm({
      description: `Delete ${resolvedData.header.name}? This action cannot be undone.`,
    });
    if (!confirmed) return;

    try {
      setIsDeleting(true);
      const response = await fetch(`/api/admin/dashboard/${kind}/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Delete failed");
      }

      router.push(
        buildAdminDashboardPageUrl(kind, {
          page: 1,
          preset: viewState.preset,
          startDate: viewState.startDate,
          endDate: viewState.endDate,
        }),
      );
    } finally {
      setIsDeleting(false);
    }
  }, [id, kind, resolvedData.header.name, router, viewState]);

  const isCustomRange = viewState.preset === "custom";
  const insightMetrics = useMemo(
    () => buildAdminDashboardDetailInsights(resolvedData),
    [resolvedData],
  );

  return (
    <div className="flex w-full flex-col gap-6 p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-4">
          <Button asChild className="w-fit" size="sm" variant="ghost">
            <Link
              href={buildAdminDashboardPageUrl(kind, {
                page: 1,
                preset: viewState.preset,
                startDate: viewState.startDate,
                endDate: viewState.endDate,
              })}
            >
              <ArrowLeft className="mr-2 size-4" />
              Back to list
            </Link>
          </Button>

          <div>
            <h1 className="text-2xl font-semibold">{resolvedData.title}</h1>
            {resolvedData.header.description ? (
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                {resolvedData.header.description}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Select
            value={viewState.preset}
            onValueChange={(value: AdminDashboardRangePreset) =>
              commitViewState({
                ...viewState,
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
                      endDate: event.target.value || undefined,
                    },
                    "replace",
                  )
                }
              />
            </>
          ) : null}

          <Button
            disabled={isDeleting}
            onClick={handleDelete}
            variant="destructive"
          >
            {isDeleting ? (
              <LoaderCircle className="mr-2 size-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 size-4" />
            )}
            Delete
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <Avatar className="size-12">
              <AvatarImage
                src={resolvedData.header.creatorImage ?? undefined}
              />
              <AvatarFallback>
                {(
                  resolvedData.header.creatorName ||
                  resolvedData.header.creatorEmail ||
                  "?"
                )
                  .slice(0, 2)
                  .toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-1">
              <p className="font-medium">{resolvedData.header.creatorName}</p>
              <p className="text-sm text-muted-foreground">
                {resolvedData.header.creatorEmail}
              </p>
              <p className="text-xs text-muted-foreground">
                Created {formatDateTime(resolvedData.header.createdAt)} •
                Updated {formatDateTime(resolvedData.header.updatedAt)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {resolvedData.header.badges.map((badge) => (
              <Badge
                key={`${resolvedData.header.id}-${badge}`}
                variant="outline"
              >
                {badge}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
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
          <h2 className="text-lg font-semibold">Derived insights</h2>
          <p className="text-sm text-muted-foreground">
            Highlight peaks, consistency, and dominant segments for this
            resource.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {insightMetrics.map((metric) => (
            <MetricCard
              hint={metric.hint}
              key={`insight-${metric.label}`}
              label={metric.label}
              value={metric.value}
            />
          ))}
        </div>
      </div>

      {error ? (
        <Card>
          <CardContent className="flex h-[180px] items-center justify-center text-sm text-destructive">
            Failed to load dashboard detail.
          </CardContent>
        </Card>
      ) : (
        <DashboardTimelineChartCard
          description="Track how activity changes across the selected range and spot peaks quickly."
          timeline={resolvedData.usageTimeline}
          title="Usage timeline"
        />
      )}

      <div className="space-y-2">
        <div>
          <h2 className="text-lg font-semibold">Breakdowns and rankings</h2>
          <p className="text-sm text-muted-foreground">
            Visualize which segments dominate and who contributes the most.
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {resolvedData.breakdowns.map((section) => (
            <DashboardBreakdownChartCard
              description="Share and concentration across the leading segments in this range."
              items={section.items}
              key={section.title}
              title={section.title}
            />
          ))}

          {resolvedData.topLists.map((section) => (
            <DashboardRankingChartCard
              description="Ranked leaders for the current range, with the biggest contributors surfaced first."
              items={section.items}
              key={section.title}
              title={section.title}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {resolvedData.recent.map((section) => (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {section.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No recent activity available.
                </p>
              ) : (
                section.items.map((item) => (
                  <div
                    className="space-y-1 border-b pb-3 last:border-b-0 last:pb-0"
                    key={`${section.title}-${item.id}`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <p className="font-medium">{item.title}</p>
                      {item.status ? (
                        <Badge variant="outline">{item.status}</Badge>
                      ) : null}
                    </div>
                    {item.subtitle ? (
                      <p className="text-sm text-muted-foreground">
                        {item.subtitle}
                      </p>
                    ) : null}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{formatDateTime(item.occurredAt)}</span>
                      {item.value !== undefined ? (
                        <span>
                          {typeof item.value === "number"
                            ? item.value.toLocaleString()
                            : item.value}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {resolvedData.tables.map((section) => (
        <Card key={section.title}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {section.columns.map((column) => (
                      <TableHead key={`${section.title}-${column}`}>
                        {column}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {section.rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        className="py-10 text-center text-sm text-muted-foreground"
                        colSpan={section.columns.length}
                      >
                        No table data available.
                      </TableCell>
                    </TableRow>
                  ) : (
                    section.rows.map((row) => (
                      <TableRow key={row.id}>
                        {row.values.map((value, index) => (
                          <TableCell key={`${row.id}-${index}`}>
                            {typeof value === "number"
                              ? value.toLocaleString()
                              : value}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ))}

      {isValidating ? <Skeleton className="h-1 w-full" /> : null}
    </div>
  );
}
