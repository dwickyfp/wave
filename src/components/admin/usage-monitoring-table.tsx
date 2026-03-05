"use client";

import { useCallback, useRef, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "ui/table";
import { Badge } from "ui/badge";
import { Input } from "ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "ui/select";
import {
  BarChart2,
  MessageCircle,
  Search,
  Users,
  Zap,
  MessagesSquare,
  Cpu,
  X,
} from "lucide-react";
import { Button } from "ui/button";
import { Card, CardContent } from "ui/card";
import { Skeleton } from "ui/skeleton";
import { UsageMonitoringData, UserUsageStat } from "app-types/admin";
import { cn } from "lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { TablePagination } from "ui/table-pagination";
import { SortableHeader } from "ui/sortable-header";
import { getUserAvatar } from "lib/user/utils";
import { buildUserDetailUrl } from "@/lib/admin/navigation-utils";
import { useTranslations } from "next-intl";
import Form from "next/form";
import Link from "next/link";
import {
  TopModelsPieChart,
  TopUsersBarChart,
  TopUsersByMessages,
} from "./usage-charts";

export type DatePreset = "7d" | "14d" | "30d" | "90d";

const DATE_PRESETS: { value: DatePreset; labelKey: string; days: number }[] = [
  { value: "7d", labelKey: "last7Days", days: 7 },
  { value: "14d", labelKey: "last14Days", days: 14 },
  { value: "30d", labelKey: "last30Days", days: 30 },
  { value: "90d", labelKey: "last90Days", days: 90 },
];

const DEFAULT_SORT_BY = "totalTokens";
const DEFAULT_SORT_DIRECTION = "desc";

interface UsageMonitoringTableProps {
  data: UsageMonitoringData;
  page: number;
  limit: number;
  query?: string;
  sortBy: string;
  sortDirection: "asc" | "desc";
  preset: DatePreset;
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
    <Card className="transition-all duration-200 hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={cn("rounded-full p-2 shrink-0", colorClass)}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-0.5">
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

export function UsageMonitoringTable({
  data,
  page,
  limit,
  query,
  sortBy = DEFAULT_SORT_BY,
  sortDirection = DEFAULT_SORT_DIRECTION,
  preset,
}: UsageMonitoringTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const t = useTranslations("Admin.UsageMonitoring");

  const totalPages = Math.ceil(data.total / limit);

  const buildUrl = useCallback(
    (params: {
      page?: number;
      sortBy?: string;
      sortDirection?: string;
      query?: string;
      preset?: DatePreset;
    }) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (params.page !== undefined) sp.set("page", String(params.page));
      if (params.sortBy !== undefined) sp.set("sortBy", params.sortBy);
      if (params.sortDirection !== undefined)
        sp.set("sortDirection", params.sortDirection);
      if (params.query !== undefined) {
        if (params.query) sp.set("query", params.query);
        else sp.delete("query");
      }
      if (params.preset !== undefined) {
        sp.set("preset", params.preset);
        sp.set("page", "1");
      }
      return `/admin/usage-monitoring?${sp.toString()}`;
    },
    [searchParams],
  );

  const handleSort = useCallback(
    (field: string) => {
      startTransition(() => {
        const newDir =
          sortBy === field && sortDirection === "desc" ? "asc" : "desc";
        router.push(
          buildUrl({ sortBy: field, sortDirection: newDir, page: 1 }),
        );
      });
    },
    [router, buildUrl, sortBy, sortDirection],
  );

  const handlePresetChange = useCallback(
    (value: string) => {
      startTransition(() => {
        router.push(buildUrl({ preset: value as DatePreset, page: 1 }));
      });
    },
    [router, buildUrl],
  );

  const submitForm = useCallback(() => {
    formRef.current?.requestSubmit();
  }, []);

  const debouncedSearch = useDebounce(submitForm, 300);

  const selectedPreset = DATE_PRESETS.find((p) => p.value === preset);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart2 className="h-6 w-6 text-foreground" />
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("description")}
          </p>
        </div>
        <Select value={preset} onValueChange={handlePresetChange}>
          <SelectTrigger
            className="w-40"
            data-testid="usage-monitoring-date-preset"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {t(p.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Zap}
          label={t("totalTokens")}
          value={data.totalTokensSum}
          colorClass="bg-primary/10 text-primary"
        />
        <StatCard
          icon={MessageCircle}
          label={t("totalMessages")}
          value={data.totalMessagesSum}
          colorClass="bg-blue-500/10 text-blue-500"
        />
        <StatCard
          icon={MessagesSquare}
          label={t("totalThreads")}
          value={data.totalThreadsSum}
          colorClass="bg-violet-500/10 text-violet-500"
        />
        <StatCard
          icon={Users}
          label={t("activeUsers")}
          value={data.activeUsersCount}
          colorClass="bg-emerald-500/10 text-emerald-500"
        />
      </div>

      {/* Charts Section */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        <TopModelsPieChart modelDistribution={data.modelDistribution} />
        <TopUsersBarChart users={data.users} />
        <TopUsersByMessages users={data.users} />
      </div>

      {/* Table Section */}
      <div className="rounded-lg border bg-card">
        {/* Table Header with Search */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{t("allUsers")}</span>
            <Badge variant="secondary" className="font-mono text-xs">
              {data.total}
            </Badge>
            {selectedPreset && (
              <span className="text-xs">
                &middot; {t(selectedPreset.labelKey)}
              </span>
            )}
          </div>

          <Form
            ref={formRef}
            action="/admin/usage-monitoring"
            className="relative"
          >
            <input type="hidden" name="preset" value={preset} />
            <input type="hidden" name="sortBy" value={sortBy} />
            <input type="hidden" name="sortDirection" value={sortDirection} />
            <input type="hidden" name="page" value="1" />
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              name="query"
              defaultValue={query}
              placeholder={t("searchPlaceholder")}
              className="pl-8 pr-8 h-9 w-64 text-sm"
              onChange={() => {
                debouncedSearch();
              }}
            />
            {query && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1 h-7 w-7"
                onClick={() => {
                  router.push(buildUrl({ query: "", page: 1 }));
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </Form>
        </div>

        {/* Table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[260px] font-semibold">
                {t("user")}
              </TableHead>
              <SortableHeader
                field="totalTokens"
                currentSortBy={sortBy}
                currentSortDirection={sortDirection}
                onSort={handleSort}
                data-testid="sort-totalTokens"
              >
                {t("tokens")}
              </SortableHeader>
              <SortableHeader
                field="messageCount"
                currentSortBy={sortBy}
                currentSortDirection={sortDirection}
                onSort={handleSort}
                data-testid="sort-messageCount"
              >
                {t("messages")}
              </SortableHeader>
              <SortableHeader
                field="threadCount"
                currentSortBy={sortBy}
                currentSortDirection={sortDirection}
                onSort={handleSort}
                data-testid="sort-threadCount"
              >
                {t("threads")}
              </SortableHeader>
              <TableHead className="font-semibold">{t("topModel")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.users.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-16 text-muted-foreground"
                >
                  <div className="flex flex-col items-center gap-3">
                    <BarChart2 className="h-10 w-10 opacity-30" />
                    <p className="font-medium">{t("noData")}</p>
                    <p className="text-xs">{t("noDataDescription")}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              data.users.map((user) => (
                <UsageMonitoringRow
                  key={user.userId}
                  user={user}
                  buildUserDetailUrl={buildUserDetailUrl}
                />
              ))
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="border-t px-4 py-3">
            <TablePagination
              currentPage={page}
              totalPages={totalPages}
              buildUrl={(params) => buildUrl({ page: params.page })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function UsageMonitoringRow({
  user,
  buildUserDetailUrl,
}: {
  user: UserUsageStat;
  buildUserDetailUrl: (userId: string) => string;
}) {
  const avatarSrc = getUserAvatar(user);
  const hasActivity = user.totalTokens > 0;

  return (
    <TableRow
      className={cn(
        "cursor-pointer hover:bg-muted/50 transition-colors",
        !hasActivity && "opacity-60",
      )}
      onClick={() => {
        window.location.href = buildUserDetailUrl(user.userId);
      }}
    >
      {/* User */}
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarImage src={avatarSrc} alt={user.name} />
            <AvatarFallback className="text-xs font-medium">
              {user.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="font-medium text-sm truncate max-w-[160px]">
              {user.name}
            </div>
            <div className="text-xs text-muted-foreground truncate max-w-[160px]">
              {user.email}
            </div>
          </div>
          {user.role === "admin" && (
            <Badge variant="outline" className="text-xs shrink-0">
              Admin
            </Badge>
          )}
        </div>
      </TableCell>

      {/* Tokens */}
      <TableCell>
        <div className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
          <span
            className={cn(
              "font-medium tabular-nums text-sm",
              hasActivity ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {user.totalTokens.toLocaleString()}
          </span>
        </div>
      </TableCell>

      {/* Messages */}
      <TableCell>
        <span className="text-sm tabular-nums">{user.messageCount}</span>
      </TableCell>

      {/* Threads */}
      <TableCell>
        <span className="text-sm tabular-nums">{user.threadCount}</span>
      </TableCell>

      {/* Top Model */}
      <TableCell>
        {user.topModel ? (
          <div className="flex items-center gap-1.5 max-w-[180px]">
            <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs truncate text-muted-foreground font-medium">
              {user.topModel}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* View detail link */}
      <TableCell className="text-right pr-4">
        <Link
          href={buildUserDetailUrl(user.userId)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          View
        </Link>
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
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
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
      <div className="rounded-lg border">
        <div className="p-4 border-b flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-9 w-64" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="px-6 py-4 flex items-center gap-4">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
