"use client";

import Link from "next/link";
import { fetcher } from "lib/utils";
import { notify } from "lib/notify";
import { ArrowLeft, Loader2, Play, RefreshCw, RotateCcw } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import type { SelfLearningEligibilitySummary } from "app-types/self-learning";
import { toast } from "sonner";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import { Switch } from "ui/switch";
import {
  EvaluationUserDetail,
  formatEmptyReason,
  formatTimestamp,
  getRunDiagnostics,
  statusVariant,
} from "./evaluation-system-shared";

export function EvaluationUserDetailPage(props: {
  userId: string;
  initialDetail: EvaluationUserDetail;
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<
    "toggle" | "run" | "reset" | null
  >(null);
  const detailKey = `/api/admin/evaluation/users/${props.userId}`;
  const { data, mutate } = useSWR<EvaluationUserDetail>(detailKey, fetcher, {
    fallbackData: props.initialDetail,
    revalidateOnFocus: false,
  });

  const user = data?.user ?? null;

  async function refreshDetail() {
    try {
      setIsRefreshing(true);
      await mutate();
    } finally {
      setIsRefreshing(false);
    }
  }

  async function toggleUser() {
    if (!user) {
      return;
    }

    try {
      setBusyAction("toggle");
      const response = await fetch(
        `/api/admin/evaluation/users/${user.userId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            personalizationEnabled: !user.personalizationEnabled,
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to update user");
      }

      toast.success("User personalization updated");
      await mutate();
    } catch {
      toast.error("Failed to update user personalization");
    } finally {
      setBusyAction(null);
    }
  }

  async function queueManualRun() {
    if (!user) {
      return;
    }

    try {
      setBusyAction("run");
      const response = await fetch(
        `/api/admin/evaluation/users/${user.userId}/run`,
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

        toast.warning(
          `${userLabel} cannot run yet: ${formatEmptyReason(result.eligibility?.emptyReason)}.`,
        );
        await mutate();
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
      await mutate();
    } catch {
      toast.error("Failed to run manual evaluation");
    } finally {
      setBusyAction(null);
    }
  }

  async function resetUser() {
    if (!user) {
      return;
    }

    const confirmed = await notify.confirm({
      title: "Reset personalization?",
      description:
        "This removes the user's active personalization memories and rebuilds their hidden knowledge mirror, but keeps evaluation history and audit records.",
    });

    if (!confirmed) {
      return;
    }

    try {
      setBusyAction("reset");
      const response = await fetch(
        `/api/admin/evaluation/users/${user.userId}/reset`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        throw new Error("Failed to reset");
      }

      toast.success("User personalization reset");
      await mutate();
    } catch {
      toast.error("Failed to reset user personalization");
    } finally {
      setBusyAction(null);
    }
  }

  if (!data || !user) {
    return (
      <div className="space-y-4 px-4 pb-10 sm:px-6 lg:px-8">
        <Button asChild variant="ghost" size="sm" className="w-fit gap-2">
          <Link href="/admin/evaluation">
            <ArrowLeft className="size-4" />
            Back to Evaluation
          </Link>
        </Button>
        <Card>
          <CardContent className="flex items-center gap-2 p-6 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading user detail…
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 px-4 pb-10 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 rounded-2xl border bg-gradient-to-br from-background via-background to-muted/40 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="-ml-3 w-fit gap-2"
            >
              <Link href="/admin/evaluation">
                <ArrowLeft className="size-4" />
                Back to Evaluation
              </Link>
            </Button>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Per-User Detail</Badge>
                <Badge
                  variant={
                    data.config.personalizationEnabled ? "default" : "secondary"
                  }
                >
                  {data.config.personalizationEnabled ? "Enabled" : "Disabled"}
                </Badge>
                <Badge
                  variant={
                    data.eligibility.eligibleCandidateCount > 0
                      ? "default"
                      : "secondary"
                  }
                >
                  {data.eligibility.eligibleCandidateCount > 0
                    ? `${data.eligibility.eligibleCandidateCount} eligible`
                    : "Not ready"}
                </Badge>
              </div>
              <h1 className="text-3xl font-semibold tracking-tight">
                {user.name || "Unnamed user"}
              </h1>
              <p className="text-muted-foreground text-sm">{user.email}</p>
              <p className="max-w-3xl text-muted-foreground text-sm">
                Review this user’s training readiness, run diagnostics,
                evaluations, active memories, and audit history in one place.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="gap-2"
              onClick={refreshDetail}
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Refresh
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={queueManualRun}
              disabled={
                busyAction !== null ||
                data.eligibility.eligibleCandidateCount === 0
              }
            >
              {busyAction === "run" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Run now
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={resetUser}
              disabled={busyAction !== null}
            >
              <RotateCcw className="size-4" />
              Reset
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="space-y-3 p-5">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              Training Readiness
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  data.eligibility.eligibleCandidateCount > 0
                    ? "default"
                    : "secondary"
                }
              >
                {data.eligibility.eligibleCandidateCount > 0
                  ? `${data.eligibility.eligibleCandidateCount} eligible`
                  : "Not ready"}
              </Badge>
              <Badge variant="outline">
                {formatEmptyReason(data.eligibility.emptyReason)}
              </Badge>
            </div>
            <div className="grid gap-2 text-muted-foreground text-xs">
              <span>Threads: {data.eligibility.threadCount}</span>
              <span>Signals: {data.eligibility.signalCount}</span>
              <span>
                Assistant turns scanned: {data.eligibility.assistantTurnCount}
              </span>
              <span>
                Already evaluated:{" "}
                {data.eligibility.evaluatedAssistantTurnCount}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-5">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              Personalization
            </p>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="font-medium text-sm">Allow auto-apply</p>
                <p className="text-muted-foreground text-xs">
                  User-scoped memories can be activated when the bias guard is
                  met.
                </p>
              </div>
              <Switch
                checked={user.personalizationEnabled}
                onCheckedChange={toggleUser}
                disabled={busyAction !== null}
              />
            </div>
            <div className="grid gap-2 text-muted-foreground text-xs">
              <span>
                Last evaluated: {formatTimestamp(data.config.lastEvaluatedAt)}
              </span>
              <span>
                Last reset: {formatTimestamp(data.config.lastResetAt)}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-5">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              Hidden Knowledge Mirror
            </p>
            <div className="grid gap-2 text-muted-foreground text-xs">
              <span className="break-all">
                Group: {data.config.hiddenKnowledgeGroupId || "Not created"}
              </span>
              <span className="break-all">
                Document:{" "}
                {data.config.hiddenKnowledgeDocumentId || "Not created"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-5">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              History Volume
            </p>
            <div className="grid gap-2 text-muted-foreground text-xs">
              <span>Runs: {data.runs.length}</span>
              <span>Evaluations: {data.evaluations.length}</span>
              <span>Memories: {data.memories.length}</span>
              <span>Audit events: {data.auditLogs.length}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Memories</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.memories.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No memories recorded yet.
                </p>
              ) : (
                data.memories.map((memory) => (
                  <div
                    key={memory.id}
                    className="rounded-xl border border-border/70 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={statusVariant(memory.status)}>
                        {memory.status}
                      </Badge>
                      <Badge variant="outline">{memory.category}</Badge>
                      {memory.isAutoSafe ? (
                        <Badge variant="secondary">Auto-safe</Badge>
                      ) : null}
                    </div>
                    <p className="mt-3 font-medium">{memory.title}</p>
                    <p className="mt-2 whitespace-pre-wrap text-muted-foreground text-sm">
                      {memory.content}
                    </p>
                    <div className="mt-3 grid gap-2 text-muted-foreground text-xs sm:grid-cols-2">
                      <span>Support count: {memory.supportCount}</span>
                      <span>
                        Distinct threads: {memory.distinctThreadCount}
                      </span>
                      <span>
                        Last applied: {formatTimestamp(memory.lastAppliedAt)}
                      </span>
                      <span className="break-all">
                        Fingerprint: {memory.fingerprint}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Runs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.runs.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No runs recorded yet.
                </p>
              ) : (
                data.runs.map((run) => {
                  const diagnostics = getRunDiagnostics(run);

                  return (
                    <div
                      key={run.id}
                      className="rounded-xl border border-border/70 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={statusVariant(run.status)}>
                            {run.status}
                          </Badge>
                          <Badge variant="outline">{run.trigger}</Badge>
                        </div>
                        <span className="text-muted-foreground text-xs">
                          {formatTimestamp(run.createdAt)}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                        <span>
                          Processed: {run.processedCandidates}/
                          {run.totalCandidates}
                        </span>
                        <span>Applied: {run.appliedMemoryCount}</span>
                        <span>Skipped: {run.skippedMemoryCount}</span>
                        <span className="break-all">Run ID: {run.id}</span>
                      </div>
                      {diagnostics ? (
                        <div className="mt-3 rounded-lg bg-muted/40 p-3 text-xs">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <span>
                              Threads loaded: {diagnostics.threadCountLoaded}
                            </span>
                            <span>
                              Signals loaded: {diagnostics.signalsLoaded}
                            </span>
                            <span>
                              Assistant turns seen:{" "}
                              {diagnostics.assistantTurnsSeen}
                            </span>
                            <span>
                              Already evaluated:{" "}
                              {diagnostics.alreadyEvaluatedExcluded}
                            </span>
                            <span>
                              Small-talk excluded:{" "}
                              {diagnostics.smallTalkExcluded}
                            </span>
                            <span>
                              Missing preceding user:{" "}
                              {diagnostics.missingPrecedingUserExcluded}
                            </span>
                            <span>
                              Final candidates:{" "}
                              {diagnostics.finalCandidateCount}
                            </span>
                            {diagnostics.emptyReason ? (
                              <span>
                                Reason:{" "}
                                {formatEmptyReason(diagnostics.emptyReason)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      {run.errorMessage ? (
                        <p className="mt-3 text-destructive text-sm">
                          {run.errorMessage}
                        </p>
                      ) : null}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Evaluations</CardTitle>
            </CardHeader>
            <CardContent>
              {data.evaluations.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No evaluations recorded yet.
                </p>
              ) : (
                <div className="max-h-[44rem] space-y-3 overflow-y-auto pr-2">
                  {data.evaluations.map((evaluation) => (
                    <div
                      key={evaluation.id}
                      className="rounded-xl border border-border/70 p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={statusVariant(evaluation.status)}>
                          {evaluation.status}
                        </Badge>
                        {evaluation.category ? (
                          <Badge variant="outline">{evaluation.category}</Badge>
                        ) : null}
                        <Badge variant="secondary">
                          Composite {evaluation.compositeScore.toFixed(2)}
                        </Badge>
                      </div>
                      <p className="mt-3 font-medium">
                        {evaluation.candidateTitle || "Untitled candidate"}
                      </p>
                      {evaluation.candidateContent ? (
                        <p className="mt-2 whitespace-pre-wrap text-muted-foreground text-sm">
                          {evaluation.candidateContent}
                        </p>
                      ) : null}
                      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                        <span>
                          Explicit: {evaluation.explicitScore.toFixed(2)}
                        </span>
                        <span>
                          Implicit: {evaluation.implicitScore.toFixed(2)}
                        </span>
                        <span>LLM: {evaluation.llmScore.toFixed(2)}</span>
                        <span>
                          Confidence: {evaluation.confidence.toFixed(2)}
                        </span>
                      </div>
                      {evaluation.judgeOutput ? (
                        <div className="mt-3 space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
                          <p className="font-medium">Judge summary</p>
                          <p className="text-muted-foreground">
                            {evaluation.judgeOutput.summary}
                          </p>
                          {evaluation.judgeOutput.reasoning.length > 0 ? (
                            <div>
                              <p className="font-medium text-xs uppercase tracking-wide">
                                Reasoning
                              </p>
                              <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                                {evaluation.judgeOutput.reasoning.map(
                                  (item, index) => (
                                    <li
                                      key={`${evaluation.id}-reasoning-${index}`}
                                    >
                                      {item}
                                    </li>
                                  ),
                                )}
                              </ul>
                            </div>
                          ) : null}
                          {evaluation.judgeOutput.evidence.length > 0 ? (
                            <div>
                              <p className="font-medium text-xs uppercase tracking-wide">
                                Evidence
                              </p>
                              <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                                {evaluation.judgeOutput.evidence.map(
                                  (item, index) => (
                                    <li
                                      key={`${evaluation.id}-evidence-${index}`}
                                    >
                                      {item}
                                    </li>
                                  ),
                                )}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit Log</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.auditLogs.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No audit events recorded yet.
                </p>
              ) : (
                data.auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-xl border border-border/70 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Badge variant="outline">{log.action}</Badge>
                      <span className="text-muted-foreground text-xs">
                        {formatTimestamp(log.createdAt)}
                      </span>
                    </div>
                    {log.memoryId ? (
                      <p className="mt-2 break-all text-muted-foreground text-xs">
                        Memory ID: {log.memoryId}
                      </p>
                    ) : null}
                    {log.runId ? (
                      <p className="mt-1 break-all text-muted-foreground text-xs">
                        Run ID: {log.runId}
                      </p>
                    ) : null}
                    {log.details ? (
                      <pre className="mt-3 overflow-x-auto rounded-lg bg-muted/40 p-3 text-xs">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
