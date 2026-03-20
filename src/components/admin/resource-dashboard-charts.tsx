"use client";

import type {
  AdminDashboardBreakdownItem,
  AdminDashboardChartCard,
  AdminDashboardTimelinePoint,
} from "app-types/admin-dashboard";
import {
  Area,
  AreaChart,
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

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function buildChartConfig(items: AdminDashboardBreakdownItem[]): ChartConfig {
  const config: ChartConfig = {
    value: {
      label: "Value",
      color: CHART_COLORS[0],
    },
  };

  items.slice(0, 6).forEach((item, index) => {
    config[`item_${index}`] = {
      label: item.label,
      color: CHART_COLORS[index % CHART_COLORS.length],
    };
  });

  return config;
}

function getTotal(items: AdminDashboardBreakdownItem[]) {
  return items.reduce((sum, item) => sum + item.value, 0);
}

interface DashboardBreakdownChartCardProps {
  title: string;
  description?: string;
  items: AdminDashboardBreakdownItem[];
  valueLabel?: string;
  emptyMessage?: string;
}

export function DashboardBreakdownChartCard({
  title,
  description,
  items,
  valueLabel = "Value",
  emptyMessage = "No chart data available.",
}: DashboardBreakdownChartCardProps) {
  const chartItems = items.slice(0, 6);
  const total = getTotal(chartItems);
  const chartConfig = buildChartConfig(chartItems);
  const chartData = chartItems.map((item, index) => ({
    key: `item_${index}`,
    name: item.label,
    value: item.value,
    secondary: item.secondary,
    fill: CHART_COLORS[index % CHART_COLORS.length],
  }));

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle>{title}</CardTitle>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {chartData.length === 0 || total === 0 ? (
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <>
            <ChartContainer
              className="mx-auto h-[240px] max-w-[320px]"
              config={chartConfig}
            >
              <PieChart>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => [
                        `${Number(value).toLocaleString()} ${valueLabel.toLowerCase()}`,
                        name,
                      ]}
                      hideLabel
                    />
                  }
                  cursor={false}
                />
                <Pie
                  data={chartData}
                  dataKey="value"
                  innerRadius={64}
                  nameKey="name"
                  strokeWidth={4}
                >
                  {chartData.map((item) => (
                    <Cell fill={item.fill} key={item.key} />
                  ))}
                  <Label
                    content={({ viewBox }) => {
                      if (
                        !viewBox ||
                        !("cx" in viewBox) ||
                        !("cy" in viewBox)
                      ) {
                        return null;
                      }

                      return (
                        <text
                          dominantBaseline="middle"
                          textAnchor="middle"
                          x={viewBox.cx}
                          y={viewBox.cy}
                        >
                          <tspan
                            className="fill-foreground text-xl font-semibold"
                            x={viewBox.cx}
                            y={viewBox.cy}
                          >
                            {formatCompactNumber(total)}
                          </tspan>
                          <tspan
                            className="fill-muted-foreground text-[11px]"
                            x={viewBox.cx}
                            y={(viewBox.cy || 0) + 18}
                          >
                            {valueLabel}
                          </tspan>
                        </text>
                      );
                    }}
                  />
                </Pie>
              </PieChart>
            </ChartContainer>

            <div className="space-y-2">
              {chartItems.map((item, index) => {
                const share =
                  total > 0 ? Math.round((item.value / total) * 100) : 0;

                return (
                  <div
                    className="flex items-start justify-between gap-3 border-b pb-2 last:border-b-0 last:pb-0"
                    key={`${title}-${item.label}`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              CHART_COLORS[index % CHART_COLORS.length],
                          }}
                        />
                        <p className="truncate font-medium">{item.label}</p>
                      </div>
                      {item.secondary ? (
                        <p className="truncate pl-4 text-xs text-muted-foreground">
                          {item.secondary}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold">
                        {item.value.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">{share}%</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface DashboardRankingChartCardProps {
  title: string;
  description?: string;
  items: AdminDashboardBreakdownItem[];
  valueLabel?: string;
  emptyMessage?: string;
}

export function DashboardRankingChartCard({
  title,
  description,
  items,
  valueLabel = "Value",
  emptyMessage = "No chart data available.",
}: DashboardRankingChartCardProps) {
  const chartItems = items.slice(0, 6);
  const chartData = chartItems.map((item, index) => ({
    key: `item_${index}`,
    label: item.label,
    shortLabel:
      item.label.length > 18 ? `${item.label.slice(0, 18)}...` : item.label,
    secondary: item.secondary,
    value: item.value,
    fill: CHART_COLORS[index % CHART_COLORS.length],
  }));
  const chartConfig = buildChartConfig(chartItems);
  const maxValue = Math.max(...chartItems.map((item) => item.value), 0);

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle>{title}</CardTitle>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {chartData.length === 0 || maxValue === 0 ? (
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <>
            <ChartContainer className="h-[240px] w-full" config={chartConfig}>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ left: 4, right: 16 }}
              >
                <CartesianGrid horizontal={false} />
                <YAxis
                  axisLine={false}
                  dataKey="shortLabel"
                  tickLine={false}
                  tickMargin={8}
                  type="category"
                  width={120}
                />
                <XAxis hide type="number" />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, _name, entry) => [
                        `${Number(value).toLocaleString()} ${valueLabel.toLowerCase()}`,
                        entry.payload.label,
                      ]}
                      hideLabel
                    />
                  }
                  cursor={false}
                />
                <Bar dataKey="value" radius={6}>
                  {chartData.map((item) => (
                    <Cell fill={item.fill} key={item.key} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>

            <div className="space-y-2">
              {chartItems.map((item) => (
                <div
                  className="flex items-start justify-between gap-3 border-b pb-2 last:border-b-0 last:pb-0"
                  key={`${title}-${item.label}`}
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate font-medium">{item.label}</p>
                    {item.secondary ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {item.secondary}
                      </p>
                    ) : null}
                  </div>
                  <p className="shrink-0 font-semibold">
                    {item.value.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface DashboardTimelineChartCardProps {
  title: string;
  description?: string;
  timeline: AdminDashboardTimelinePoint[];
}

export function DashboardTimelineChartCard({
  title,
  description,
  timeline,
}: DashboardTimelineChartCardProps) {
  const total = timeline.reduce((sum, point) => sum + point.value, 0);
  const activeDays = timeline.filter((point) => point.value > 0).length;
  const peakDay = [...timeline].sort((left, right) => {
    if (right.value !== left.value) {
      return right.value - left.value;
    }

    return left.date.localeCompare(right.date);
  })[0];
  const chartConfig: ChartConfig = {
    value: {
      label: "Usage",
      color: "var(--chart-1)",
    },
  };

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle>{title}</CardTitle>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Range total
            </p>
            <p className="mt-1 text-xl font-semibold">
              {total.toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Active days
            </p>
            <p className="mt-1 text-xl font-semibold">
              {activeDays.toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Peak day
            </p>
            <p className="mt-1 text-xl font-semibold">
              {peakDay?.value?.toLocaleString() ?? "0"}
            </p>
            <p className="text-xs text-muted-foreground">
              {peakDay ? formatShortDate(peakDay.date) : "No activity"}
            </p>
          </div>
        </div>

        {timeline.length === 0 || total === 0 ? (
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
            No activity recorded for this range.
          </div>
        ) : (
          <ChartContainer className="h-[280px] w-full" config={chartConfig}>
            <AreaChart data={timeline}>
              <defs>
                <linearGradient
                  id="dashboard-usage-fill"
                  x1="0"
                  x2="0"
                  y1="0"
                  y2="1"
                >
                  <stop
                    offset="5%"
                    stopColor="var(--color-value)"
                    stopOpacity={0.35}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-value)"
                    stopOpacity={0.03}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(value) => formatShortDate(String(value))}
              />
              <YAxis allowDecimals={false} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => [
                      `${Number(value).toLocaleString()} usage`,
                    ]}
                    labelFormatter={(label) => formatShortDate(String(label))}
                  />
                }
              />
              <Area
                dataKey="value"
                fill="url(#dashboard-usage-fill)"
                fillOpacity={1}
                stroke="var(--color-value)"
                strokeWidth={2.5}
                type="monotone"
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardListChartCard({
  chart,
}: {
  chart: AdminDashboardChartCard;
}) {
  if (chart.type === "bar") {
    return (
      <DashboardRankingChartCard
        description={chart.description}
        items={chart.items}
        title={chart.title}
        valueLabel={chart.valueLabel}
      />
    );
  }

  return (
    <DashboardBreakdownChartCard
      description={chart.description}
      items={chart.items}
      title={chart.title}
      valueLabel={chart.valueLabel}
    />
  );
}
