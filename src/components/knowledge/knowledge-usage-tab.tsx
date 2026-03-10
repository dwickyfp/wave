"use client";

import { useKnowledgeUsage } from "@/hooks/queries/use-knowledge";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import { Badge } from "ui/badge";
import { Skeleton } from "ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import {
  MessageSquareIcon,
  CoinsIcon,
  UsersIcon,
  ServerIcon,
  TimerIcon,
} from "lucide-react";

interface Props {
  groupId: string;
}

export function KnowledgeUsageTab({ groupId }: Props) {
  const { data: stats, isLoading } = useKnowledgeUsage(groupId, 7);

  const formatTokens = (value: number) =>
    new Intl.NumberFormat("en-US").format(value);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-lg" />
      </div>
    );
  }

  if (!stats) return null;

  const statCards = [
    {
      title: "Total Queries (7d)",
      value: stats.totalQueries,
      icon: MessageSquareIcon,
    },
    { title: "Unique Users", value: stats.uniqueUsers, icon: UsersIcon },
    { title: "MCP Queries", value: stats.mcpQueries, icon: ServerIcon },
    { title: "Avg Latency", value: `${stats.avgLatencyMs}ms`, icon: TimerIcon },
    {
      title: "Stored Embedding Tokens",
      value: formatTokens(stats.storedEmbeddingTokens),
      icon: CoinsIcon,
    },
    {
      title: "Processed Embedding Tokens",
      value: formatTokens(stats.processedEmbeddingTokens),
      icon: CoinsIcon,
    },
    {
      title: "Recent Embedding Tokens",
      value: formatTokens(stats.recentEmbeddingTokens),
      icon: CoinsIcon,
    },
  ];

  const SOURCE_COLORS: Record<string, string> = {
    chat: "bg-blue-500/10 text-blue-600 border-blue-500",
    agent: "bg-purple-500/10 text-purple-600 border-purple-500",
    mcp: "bg-green-500/10 text-green-600 border-green-500",
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <Card key={s.title}>
            <CardHeader className="p-3 pb-1">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <s.icon className="size-3.5" />
                {s.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <p className="text-2xl font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Daily Chart */}
      {stats.dailyStats.length > 0 && (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">Daily Queries</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <ResponsiveContainer width="100%" height={120}>
              <BarChart
                data={stats.dailyStats}
                margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
              >
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => format(new Date(v), "MMM d")}
                  tick={{ fontSize: 11 }}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v) => [v, "Queries"]}
                  labelFormatter={(l) => format(new Date(l), "MMM d, yyyy")}
                />
                <Bar
                  dataKey="count"
                  fill="hsl(var(--primary))"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Embedding Usage by Document</h3>
        {stats.documentEmbeddingUsage.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No embedded documents yet
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {stats.documentEmbeddingUsage.map((doc) => (
              <div
                key={doc.documentId}
                className="flex items-center gap-3 rounded-lg border border-transparent bg-secondary/30 px-3 py-2 transition-colors hover:border-input"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{doc.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatTokens(doc.embeddingTokenCount)} stored embedding
                    tokens
                    {doc.latestVersionNumber != null &&
                      ` · v${doc.latestVersionNumber}`}
                  </p>
                </div>
                <time className="shrink-0 text-xs text-muted-foreground">
                  {format(new Date(doc.updatedAt), "MMM d HH:mm")}
                </time>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Queries */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Recent Queries</h3>
        {stats.recentQueries.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No queries yet
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {stats.recentQueries.map((q) => (
              <div
                key={q.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-secondary/30 border border-transparent hover:border-input transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{q.query}</p>
                  <p className="text-xs text-muted-foreground">
                    {q.userName ?? "Anonymous"} · {q.chunksRetrieved} chunks
                    retrieved
                    {q.latencyMs != null && ` · ${q.latencyMs}ms`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant="outline"
                    className={`text-xs px-1.5 py-0 ${SOURCE_COLORS[q.source] ?? ""}`}
                  >
                    {q.source}
                  </Badge>
                  <time className="text-xs text-muted-foreground">
                    {format(new Date(q.createdAt), "MMM d HH:mm")}
                  </time>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
