"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "ui/chart";
import { ModelUsageStat, UserUsageStat } from "app-types/admin";
import { TrendingUp, Users, Cpu } from "lucide-react";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function shortenModelName(model: string): string {
  // e.g. "claude-sonnet-4-6" -> "Sonnet 4.6"
  // e.g. "gpt-4o" -> "GPT-4o"
  return model
    .replace(/^claude-/, "")
    .replace(/-(\d+)-(\d+)$/, " $1.$2")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// ─── Top Models Pie Chart ────────────────────────────────────────────────────

interface TopModelsPieChartProps {
  modelDistribution: ModelUsageStat[];
}

export function TopModelsPieChart({
  modelDistribution,
}: TopModelsPieChartProps) {
  const data = modelDistribution.slice(0, 6);
  const totalTokens = data.reduce((s, m) => s + m.totalTokens, 0);

  const chartConfig = React.useMemo<ChartConfig>(() => {
    const config: ChartConfig = { value: { label: "Tokens" } };
    data.forEach((m, i) => {
      const key = `model_${i}`;
      config[key] = {
        label: shortenModelName(m.model),
        color: CHART_COLORS[i % CHART_COLORS.length],
      };
    });
    return config;
  }, [data]);

  const chartData = data.map((m, i) => ({
    name: shortenModelName(m.model),
    key: `model_${i}`,
    value: m.totalTokens,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Cpu className="h-4 w-4 text-muted-foreground" />
            Top Models
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
          No model data available
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Cpu className="h-4 w-4 text-muted-foreground" />
          Top Models by Token Usage
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square max-h-[220px]"
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  hideLabel
                  formatter={(value, name) => [
                    `${formatTokens(Number(value))} tokens`,
                    name,
                  ]}
                />
              }
            />
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={55}
              strokeWidth={4}
            >
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground text-xl font-bold"
                        >
                          {formatTokens(totalTokens)}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) + 20}
                          className="fill-muted-foreground text-xs"
                        >
                          tokens
                        </tspan>
                      </text>
                    );
                  }
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
        {/* Legend */}
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          {chartData.map((entry, i) => (
            <div key={i} className="flex items-center gap-1.5 min-w-0">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: entry.fill }}
              />
              <span className="text-xs text-muted-foreground truncate">
                {entry.name}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Top 5 Users Bar Chart ───────────────────────────────────────────────────

interface TopUsersBarChartProps {
  users: UserUsageStat[];
}

export function TopUsersBarChart({ users }: TopUsersBarChartProps) {
  const top5 = [...users]
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 5);

  const chartConfig: ChartConfig = {
    totalTokens: { label: "Tokens", color: "var(--chart-1)" },
  };

  const chartData = top5.map((u) => ({
    name: u.name.split(" ")[0],
    fullName: u.name,
    totalTokens: u.totalTokens,
  }));

  if (top5.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            Top 5 Users
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
          No user data available
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          Top 5 Users by Token Usage
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[220px] w-full">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ left: 4, right: 16 }}
          >
            <CartesianGrid horizontal={false} />
            <YAxis
              dataKey="name"
              type="category"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={60}
              tick={{ fontSize: 12 }}
            />
            <XAxis type="number" hide />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value, _name) => [
                    `${Number(value).toLocaleString()} tokens`,
                  ]}
                />
              }
            />
            <Bar dataKey="totalTokens" fill="var(--chart-1)" radius={4} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

// ─── Top 5 Users by Messages ─────────────────────────────────────────────────

interface TopUsersByMessagesProps {
  users: UserUsageStat[];
}

export function TopUsersByMessages({ users }: TopUsersByMessagesProps) {
  const top5 = [...users]
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, 5);

  const chartConfig: ChartConfig = {
    messageCount: { label: "Messages", color: "var(--chart-2)" },
  };

  const chartData = top5.map((u) => ({
    name: u.name.split(" ")[0],
    fullName: u.name,
    messageCount: u.messageCount,
  }));

  if (top5.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            Top 5 Users by Messages
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
          No data available
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          Top 5 Users by Messages
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[220px] w-full">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ left: 4, right: 16 }}
          >
            <CartesianGrid horizontal={false} />
            <YAxis
              dataKey="name"
              type="category"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={60}
              tick={{ fontSize: 12 }}
            />
            <XAxis type="number" hide />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value, _name) => [
                    `${Number(value).toLocaleString()} messages`,
                  ]}
                />
              }
            />
            <Bar dataKey="messageCount" fill="var(--chart-2)" radius={4} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
