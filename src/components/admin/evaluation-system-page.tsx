"use client";

import Link from "next/link";
import {
  buildSelfLearningUsersApiUrl,
  buildSelfLearningUsersPageUrl,
  parseSelfLearningUsersSearchParams,
} from "lib/self-learning/admin";
import { fetcher } from "lib/utils";
import { notify } from "lib/notify";
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  Clock3,
  Loader2,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  startTransition,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from "react";
import useSWR from "swr";
import type {
  SelfLearningEligibilitySummary,
  SelfLearningOverview,
  SelfLearningUserRow,
  SelfLearningUsersPage,
} from "app-types/self-learning";
import { toast } from "sonner";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import { Input } from "ui/input";
import { Switch } from "ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "ui/table";
import { TablePagination } from "ui/table-pagination";
import { formatEmptyReason } from "./evaluation-system-shared";

type EvaluationSystemResponse = {
  overview: SelfLearningOverview;
  usersPage: SelfLearningUsersPage;
};

type UserTableState = {
  page: number;
  query?: string;
};

function StatCard({
  title,
  value,
  hint,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  hint: string;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="space-y-1">
          <p className="text-muted-foreground text-sm">{title}</p>
          <p className="text-2xl font-semibold">{value}</p>
          <p className="text-muted-foreground text-xs">{hint}</p>
        </div>
        <div className="rounded-full border bg-muted/40 p-2">
          <Icon className="size-4" />
        </div>
      </CardContent>
    </Card>
  );
}

function getEligibilityBadgeVariant(user: SelfLearningUserRow) {
  return user.eligibleCandidateCount > 0
    ? ("default" as const)
    : ("secondary" as const);
}

export function EvaluationSystemPage(props: {
  initialOverview: SelfLearningOverview;
  initialUsersPage: SelfLearningUsersPage;
  initialPage: number;
  initialQuery?: string;
}) {
  const [tableState, setTableState] = useState<UserTableState>({
    page: props.initialPage,
    query: props.initialQuery,
  });
  const [searchInput, setSearchInput] = useState(props.initialQuery ?? "");
  const [isUpdatingSystem, setIsUpdatingSystem] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const listKey = useMemo(
    () =>
      buildSelfLearningUsersApiUrl({
        page: tableState.page,
        query: tableState.query,
      }),
    [tableState],
  );

  const updateBrowserUrl = useCallback(
    (nextState: UserTableState, historyMode: "push" | "replace" = "push") => {
      const nextUrl = buildSelfLearningUsersPageUrl(nextState);
      window.history[historyMode === "push" ? "pushState" : "replaceState"](
        null,
        "",
        nextUrl,
      );
    },
    [],
  );

  const commitTableState = useCallback(
    (nextState: UserTableState, historyMode: "push" | "replace" = "push") => {
      if (
        nextState.page === tableState.page &&
        nextState.query === tableState.query
      ) {
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
        page: 1,
        query: normalizedQuery,
      },
      "replace",
    );
  });

  const {
    data: systemData = {
      overview: props.initialOverview,
      usersPage: props.initialUsersPage,
    },
    mutate: mutateSystemData,
    isValidating: isRefreshingList,
  } = useSWR<EvaluationSystemResponse>(listKey, fetcher, {
    fallbackData: {
      overview: props.initialOverview,
      usersPage: props.initialUsersPage,
    },
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      applySearch(searchInput);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [applySearch, searchInput]);

  useEffect(() => {
    const syncFromUrl = () => {
      const nextSearchState = parseSelfLearningUsersSearchParams(
        new URLSearchParams(window.location.search),
      );
      const nextTableState = {
        page: nextSearchState.page,
        query: nextSearchState.query,
      };

      setSearchInput(nextSearchState.query ?? "");
      setTableState((currentState) =>
        currentState.page === nextTableState.page &&
        currentState.query === nextTableState.query
          ? currentState
          : nextTableState,
      );
    };

    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  const totalPages = Math.ceil(
    systemData.usersPage.total / systemData.usersPage.limit,
  );

  useEffect(() => {
    if (systemData.usersPage.total === 0) {
      if (tableState.page !== 1) {
        commitTableState(
          {
            ...tableState,
            page: 1,
          },
          "replace",
        );
      }
      return;
    }

    if (totalPages > 0 && tableState.page > totalPages) {
      commitTableState(
        {
          ...tableState,
          page: totalPages,
        },
        "replace",
      );
    }
  }, [commitTableState, systemData.usersPage.total, tableState, totalPages]);

  async function refreshAll() {
    await mutateSystemData();
  }

  async function toggleSystem(nextValue: boolean) {
    try {
      setIsUpdatingSystem(true);
      const response = await fetch("/api/admin/evaluation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRunning: nextValue }),
      });

      if (!response.ok) {
        throw new Error("Failed to update system");
      }

      await mutateSystemData();
      toast.success(
        nextValue
          ? "Self-learning system is now running"
          : "Self-learning system is paused",
      );
    } catch {
      toast.error("Failed to update self-learning system");
    } finally {
      setIsUpdatingSystem(false);
    }
  }

  async function toggleUser(userId: string, personalizationEnabled: boolean) {
    try {
      setBusyUserId(userId);
      const response = await fetch(`/api/admin/evaluation/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizationEnabled: !personalizationEnabled,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update user");
      }

      await refreshAll();
      toast.success("User personalization updated");
    } catch {
      toast.error("Failed to update user personalization");
    } finally {
      setBusyUserId(null);
    }
  }

  async function queueManualRun(userId: string) {
    try {
      setBusyUserId(userId);
      const response = await fetch(
        `/api/admin/evaluation/users/${userId}/run`,
        {
          method: "POST",
        },
      );

      if (response.status === 422) {
        const result = (await response.json()) as {
          user?: {
            id: string;
            name: string | null;
            email: string;
          } | null;
          eligibility?: SelfLearningEligibilitySummary;
        };
        const userLabel =
          result.user?.name || result.user?.email || "This user";
        const emptyReason = formatEmptyReason(result.eligibility?.emptyReason);
        const eligibleCount = result.eligibility?.eligibleCandidateCount ?? 0;

        toast.warning(
          `${userLabel} cannot run yet: ${emptyReason}. Eligible candidates: ${eligibleCount}.`,
        );
        await refreshAll();
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to queue run");
      }

      const result = (await response.json()) as {
        eligibility?: SelfLearningEligibilitySummary;
      };

      toast.success(
        `Manual evaluation queued with ${
          result.eligibility?.eligibleCandidateCount ?? 0
        } eligible candidate(s)`,
      );
      await refreshAll();
    } catch {
      toast.error("Failed to run manual evaluation");
    } finally {
      setBusyUserId(null);
    }
  }

  async function resetUser(userId: string) {
    const confirmed = await notify.confirm({
      title: "Reset personalization?",
      description:
        "This removes the user's active personalization memories and rebuilds their hidden knowledge mirror, but keeps evaluation history and audit records.",
    });

    if (!confirmed) {
      return;
    }

    try {
      setBusyUserId(userId);
      const response = await fetch(
        `/api/admin/evaluation/users/${userId}/reset`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        throw new Error("Failed to reset");
      }

      toast.success("User personalization reset");
      await refreshAll();
    } catch {
      toast.error("Failed to reset user personalization");
    } finally {
      setBusyUserId(null);
    }
  }

  const pageStart =
    systemData.usersPage.total === 0 ? 0 : systemData.usersPage.offset + 1;
  const pageEnd =
    systemData.usersPage.offset + systemData.usersPage.users.length;

  return (
    <div className="space-y-6 px-4 pb-10 sm:px-6 lg:px-8">
      <div className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline">Admin</Badge>
              <Badge
                variant={
                  systemData.overview.system.isRunning ? "default" : "secondary"
                }
              >
                {systemData.overview.system.isRunning ? "Running" : "Paused"}
              </Badge>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Evaluation System
            </h1>
            <p className="max-w-3xl text-muted-foreground text-sm">
              Capture feedback continuously, evaluate reusable user-specific
              lessons, and route deeper per-user review into a dedicated detail
              page for cleaner admin workflow.
            </p>
          </div>

          <div className="flex items-start justify-end lg:pt-1">
            <Switch
              aria-label="Run Self-Learning"
              checked={systemData.overview.system.isRunning}
              onCheckedChange={toggleSystem}
              disabled={isUpdatingSystem}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Signals Captured"
            value={systemData.overview.totalSignals}
            hint="Explicit and implicit user reactions captured even while paused."
            icon={Activity}
          />
          <StatCard
            title="Evaluations"
            value={systemData.overview.totalEvaluations}
            hint="Structured LLM-as-judge runs with score breakdowns and rationale."
            icon={BrainCircuit}
          />
          <StatCard
            title="Active Memories"
            value={systemData.overview.totalActiveMemories}
            hint="User-specific memories currently injected into Emma prompts."
            icon={ShieldCheck}
          />
          <StatCard
            title="Enabled Users"
            value={systemData.overview.enabledUsers}
            hint="Users with personalization toggled on and ready for auto-apply."
            icon={Clock3}
          />
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>Per-User Personalization</CardTitle>
            <p className="text-muted-foreground text-sm">
              Search users, toggle personalization, queue manual runs, or open
              dedicated per-user metrics and history pages.
            </p>
          </div>
          <div className="relative w-full lg:w-72">
            <Search className="-translate-y-1/2 absolute left-3 top-1/2 size-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search by name or email"
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Threads</TableHead>
                  <TableHead>Signals</TableHead>
                  <TableHead>Eligible</TableHead>
                  <TableHead>Evaluations</TableHead>
                  <TableHead>Active Memories</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {systemData.usersPage.users.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-10 text-center text-muted-foreground"
                    >
                      No users found for the current filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  systemData.usersPage.users.map((user) => {
                    const isBusy = busyUserId === user.userId;

                    return (
                      <TableRow key={user.userId}>
                        <TableCell>
                          <Link
                            href={`/admin/evaluation/${user.userId}`}
                            className="block text-left transition hover:opacity-80"
                          >
                            <div className="font-medium">
                              {user.name || "Unnamed user"}
                            </div>
                            <div className="text-muted-foreground text-xs">
                              {user.email}
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell>{user.threadCount}</TableCell>
                        <TableCell>{user.signalCount}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Badge variant={getEligibilityBadgeVariant(user)}>
                              {user.eligibleCandidateCount > 0
                                ? `Eligible ${user.eligibleCandidateCount}`
                                : "No training data"}
                            </Badge>
                            <div className="text-muted-foreground text-xs">
                              {formatEmptyReason(user.emptyReason)}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{user.evaluationCount}</TableCell>
                        <TableCell>{user.activeMemoryCount}</TableCell>
                        <TableCell>
                          <Switch
                            checked={user.personalizationEnabled}
                            onCheckedChange={() =>
                              toggleUser(
                                user.userId,
                                user.personalizationEnabled,
                              )
                            }
                            disabled={isBusy}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              asChild
                              size="sm"
                              variant="ghost"
                              className="gap-1.5"
                            >
                              <Link href={`/admin/evaluation/${user.userId}`}>
                                View
                                <ArrowRight className="size-3.5" />
                              </Link>
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              onClick={() => queueManualRun(user.userId)}
                              disabled={
                                isBusy || user.eligibleCandidateCount === 0
                              }
                            >
                              {isBusy ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Play className="size-3.5" />
                              )}
                              Run now
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              onClick={() => resetUser(user.userId)}
                              disabled={isBusy}
                            >
                              <RotateCcw className="size-3.5" />
                              Reset
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 text-muted-foreground text-xs sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <span>
                {isRefreshingList
                  ? "Refreshing user list…"
                  : `Showing ${pageStart}-${pageEnd} of ${systemData.usersPage.total} users`}
              </span>
              <span>
                Scheduler: {systemData.overview.system.dailySchedulerPattern}
              </span>
            </div>
            <TablePagination
              currentPage={tableState.page}
              totalPages={totalPages}
              buildUrl={(params) =>
                buildSelfLearningUsersPageUrl({
                  page: params.page,
                  query: tableState.query,
                })
              }
              onPageChange={(nextPage) => {
                if (nextPage < 1 || (totalPages > 0 && nextPage > totalPages)) {
                  return;
                }

                commitTableState({
                  ...tableState,
                  page: nextPage,
                });
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
