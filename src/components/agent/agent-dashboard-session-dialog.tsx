"use client";

import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { Loader2Icon } from "lucide-react";
import type { AgentDashboardSessionSource } from "app-types/agent-dashboard";
import { useAgentDashboardSession } from "@/hooks/queries/use-agent-dashboard-session";
import { PreviewMessage } from "@/components/message";
import { Badge } from "ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Skeleton } from "ui/skeleton";

type SessionSelection = {
  id: string;
  source: AgentDashboardSessionSource;
} | null;

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toString();
}

export function AgentDashboardSessionDialog(props: {
  agentId: string;
  session: SessionSelection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations();
  const { data, error, isLoading } = useAgentDashboardSession({
    agentId: props.agentId,
    sessionId: props.session?.id,
    source: props.session?.source,
    enabled: props.open,
  });

  const sourceLabel =
    data?.source === "in_app"
      ? t("Agent.dashboardWaveChat")
      : t("Agent.dashboardContinueChat");

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-5xl h-[85vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-6 py-4 border-b gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <DialogTitle className="text-lg">
                {data?.title || t("Agent.dashboardSessionHistory")}
              </DialogTitle>
              <DialogDescription className="text-sm">
                {data?.summary || t("Agent.dashboardSessionHistoryDescription")}
              </DialogDescription>
            </div>
            {data ? (
              <div className="flex flex-wrap items-center gap-2 justify-end">
                <Badge variant="outline">{sourceLabel}</Badge>
                <Badge variant="outline">
                  {data.totalTurns} {t("Agent.dashboardTurnLabel")}
                </Badge>
                <Badge variant="outline">
                  {formatTokens(data.totalTokens)}{" "}
                  {t("Agent.dashboardTokenLabel")}
                </Badge>
                {data.status ? (
                  <Badge variant="outline">{data.status}</Badge>
                ) : null}
              </div>
            ) : null}
          </div>
          {data ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {data.modelProvider || data.modelName ? (
                <span>
                  {data.modelProvider || "unknown"} /{" "}
                  {data.modelName || "unknown"}
                </span>
              ) : null}
              {data.updatedAt ? (
                <span>
                  {t("Agent.dashboardUpdatedAt")}:{" "}
                  {format(new Date(data.updatedAt), "MMM d, yyyy HH:mm")}
                </span>
              ) : null}
            </div>
          ) : null}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-6">
          {isLoading ? (
            <div className="flex flex-col gap-4 px-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                {t("Agent.dashboardSessionLoading")}
              </div>
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : null}

          {!isLoading && error ? (
            <div className="px-6 text-sm text-destructive">
              {error.message || t("Agent.dashboardSessionLoadFailed")}
            </div>
          ) : null}

          {!isLoading && data ? (
            <div className="flex flex-col gap-4">
              {data.transcriptMode === "preview" ? (
                <div className="mx-6 rounded-lg border bg-secondary/25 px-4 py-3 text-sm text-muted-foreground">
                  {t("Agent.dashboardSessionPreviewOnly")}
                </div>
              ) : null}

              {data.messages.length ? (
                data.messages.map((message, index) => (
                  <PreviewMessage
                    key={message.id}
                    readonly={true}
                    message={message}
                    messageIndex={index}
                    isLastMessage={index === data.messages.length - 1}
                  />
                ))
              ) : (
                <div className="px-6 text-sm text-muted-foreground">
                  {t("Agent.dashboardSessionEmpty")}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
