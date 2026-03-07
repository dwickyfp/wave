"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import type {
  AgentAutocompleteRequestSummary,
  AgentExternalChatSessionSummary,
  AgentInAppSessionSummary,
  AgentUsageTimelinePoint,
} from "app-types/agent-dashboard";
import { useAgentDashboard } from "@/hooks/queries/use-agent-dashboard";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import { Skeleton } from "ui/skeleton";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BotIcon,
  MessageSquareIcon,
  SparklesIcon,
  TicketIcon,
} from "lucide-react";

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toString();
}

function StatCard(props: {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardHeader className="p-3 pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <props.icon className="size-3.5" />
          {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <p className="text-2xl font-semibold">{props.value}</p>
      </CardContent>
    </Card>
  );
}

function UsageChart(props: {
  data: AgentUsageTimelinePoint[];
  label: string;
}) {
  if (!props.data.length) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-medium">{props.label}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <ResponsiveContainer width="100%" height={140}>
          <BarChart
            data={props.data}
            margin={{ top: 0, right: 0, left: -24, bottom: 0 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={(value) => format(new Date(value), "MMM d")}
              tick={{ fontSize: 11 }}
            />
            <YAxis tickFormatter={(value) => formatTokens(Number(value))} />
            <Tooltip
              formatter={(value) => [
                `${Number(value).toLocaleString()} tokens`,
                "Tokens",
              ]}
              labelFormatter={(value) => format(new Date(value), "MMM d, yyyy")}
            />
            <Bar
              dataKey="totalTokens"
              fill="hsl(var(--primary))"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <p className="text-sm text-muted-foreground text-center py-8">{label}</p>
  );
}

function InAppSessionList({
  items,
  emptyLabel,
}: {
  items: AgentInAppSessionSummary[];
  emptyLabel: string;
}) {
  if (!items.length) return <EmptyState label={emptyLabel} />;

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => (
        <div
          key={item.threadId}
          className="flex items-center gap-3 rounded-lg border bg-secondary/25 px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{item.title}</p>
            <p className="text-xs text-muted-foreground">
              {item.assistantMessages} turns ·{" "}
              {item.totalTokens.toLocaleString()} tokens
            </p>
          </div>
          <time className="shrink-0 text-xs text-muted-foreground">
            {format(new Date(item.lastMessageAt), "MMM d HH:mm")}
          </time>
        </div>
      ))}
    </div>
  );
}

function ExternalSessionList({
  items,
  emptyLabel,
}: {
  items: AgentExternalChatSessionSummary[];
  emptyLabel: string;
}) {
  if (!items.length) return <EmptyState label={emptyLabel} />;

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => (
        <div
          key={item.sessionId}
          className="flex items-center gap-3 rounded-lg border bg-secondary/25 px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {item.firstUserPreview}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {item.summaryPreview || item.firstUserPreview}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline">{item.totalTurns} turns</Badge>
            <Badge variant="outline">
              {item.totalTokens.toLocaleString()} tokens
            </Badge>
            <time className="text-xs text-muted-foreground">
              {format(new Date(item.updatedAt), "MMM d HH:mm")}
            </time>
          </div>
        </div>
      ))}
    </div>
  );
}

function AutocompleteRequestList({
  items,
  emptyLabel,
}: {
  items: AgentAutocompleteRequestSummary[];
  emptyLabel: string;
}) {
  if (!items.length) return <EmptyState label={emptyLabel} />;

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-3 rounded-lg border bg-secondary/25 px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {item.requestPreview || "Autocomplete request"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {item.responsePreview || "No completion captured"}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline">
              {item.totalTokens.toLocaleString()} tokens
            </Badge>
            <time className="text-xs text-muted-foreground">
              {format(new Date(item.createdAt), "MMM d HH:mm")}
            </time>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AgentDashboardTab({ agentId }: { agentId: string }) {
  const t = useTranslations();
  const [days, setDays] = useState(30);
  const { data, isLoading } = useAgentDashboard(agentId, days);

  const dayOptions = useMemo(
    () => [
      { label: t("Agent.dashboardRange7"), value: 7 },
      { label: t("Agent.dashboardRange30"), value: 30 },
      { label: t("Agent.dashboardRange90"), value: 90 },
    ],
    [t],
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-20 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t("Agent.dashboardTitle")}</p>
          <p className="text-xs text-muted-foreground">
            {t("Agent.dashboardDescription")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dayOptions.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={days === option.value ? "default" : "outline"}
              onClick={() => setDays(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <MessageSquareIcon className="size-4 text-primary" />
          <p className="text-sm font-medium">{t("Agent.dashboardWaveChat")}</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            title={t("Agent.dashboardTotalSessions")}
            value={data.inApp.totalSessions}
            icon={TicketIcon}
          />
          <StatCard
            title={t("Agent.dashboardTotalTurns")}
            value={data.inApp.totalAssistantMessages}
            icon={MessageSquareIcon}
          />
          <StatCard
            title={t("Agent.dashboardTotalTokens")}
            value={formatTokens(data.inApp.totalTokens)}
            icon={BotIcon}
          />
          <StatCard
            title={t("Agent.dashboardPromptTokens")}
            value={formatTokens(data.inApp.promptTokens)}
            icon={BotIcon}
          />
        </div>
        <UsageChart
          data={data.inApp.daily}
          label={t("Agent.dashboardTokenTrend")}
        />
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {t("Agent.dashboardRecentSessions")}
          </p>
          <InAppSessionList
            items={data.inApp.recentSessions}
            emptyLabel={t("Agent.dashboardEmptyInApp")}
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <BotIcon className="size-4 text-primary" />
          <p className="text-sm font-medium">
            {t("Agent.dashboardContinueChat")}
          </p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            title={t("Agent.dashboardTotalSessions")}
            value={data.externalChat.totalSessions}
            icon={TicketIcon}
          />
          <StatCard
            title={t("Agent.dashboardTotalTurns")}
            value={data.externalChat.totalTurns}
            icon={MessageSquareIcon}
          />
          <StatCard
            title={t("Agent.dashboardTotalTokens")}
            value={formatTokens(data.externalChat.totalTokens)}
            icon={BotIcon}
          />
          <StatCard
            title={t("Agent.dashboardPromptTokens")}
            value={formatTokens(data.externalChat.promptTokens)}
            icon={BotIcon}
          />
        </div>
        <UsageChart
          data={data.externalChat.daily}
          label={t("Agent.dashboardTokenTrend")}
        />
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {t("Agent.dashboardRecentSessions")}
          </p>
          <ExternalSessionList
            items={data.externalChat.recentSessions}
            emptyLabel={t("Agent.dashboardEmptyExternalChat")}
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <SparklesIcon className="size-4 text-primary" />
          <p className="text-sm font-medium">
            {t("Agent.dashboardAutocomplete")}
          </p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            title={t("Agent.dashboardTotalRequests")}
            value={data.autocomplete.totalRequests}
            icon={SparklesIcon}
          />
          <StatCard
            title={t("Agent.dashboardTotalTokens")}
            value={formatTokens(data.autocomplete.totalTokens)}
            icon={BotIcon}
          />
          <StatCard
            title={t("Agent.dashboardPromptTokens")}
            value={formatTokens(data.autocomplete.promptTokens)}
            icon={BotIcon}
          />
          <StatCard
            title={t("Agent.dashboardCompletionTokens")}
            value={formatTokens(data.autocomplete.completionTokens)}
            icon={BotIcon}
          />
        </div>
        <UsageChart
          data={data.autocomplete.daily}
          label={t("Agent.dashboardTokenTrend")}
        />
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {t("Agent.dashboardRecentRequests")}
          </p>
          <AutocompleteRequestList
            items={data.autocomplete.recentRequests}
            emptyLabel={t("Agent.dashboardEmptyAutocomplete")}
          />
        </div>
      </div>
    </div>
  );
}
