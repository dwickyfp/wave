"use client";

import * as React from "react";
import { Label, Pie, PieChart as RechartsPieChart } from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

import { JsonViewPopup } from "../json-view-popup";
import { sanitizeCssVariableName } from "./shared.tool-invocation";
import type { VoiceArtifactTileDensity } from "../chat-bot-voice.utils";

// PieChart component props interface
export interface PieChartProps {
  // Chart title (required)
  title: string;
  // Chart data array (required)
  data: Array<{
    label: string; // Item label
    value: number; // Item value
  }>;
  // Value unit (optional, e.g., "visitors", "users", etc.)
  unit?: string;
  // Chart description (optional)
  description?: string;
  prefix?: string;
  jsonView?: boolean;
  colors?: string[];
  displayVariant?: "default" | "voice-stage";
  voiceStageDensity?: VoiceArtifactTileDensity;
}

// Color variable names (chart-1 ~ chart-5)
const chartColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

// Function to format large numbers with k, M, B, T units
function formatLargeNumber(num: number | null | undefined): string {
  // Handle null, undefined, or invalid numbers
  if (num == null || isNaN(num) || !isFinite(num)) {
    return "0";
  }

  // Handle negative numbers
  if (num < 0) {
    return `-${formatLargeNumber(-num)}`;
  }

  // Handle zero
  if (num === 0) {
    return "0";
  }

  if (num < 1000) {
    return num.toString();
  }

  const units = [
    "",
    "k",
    "M",
    "B",
    "T",
    "Qa",
    "Qi",
    "Sx",
    "Sp",
    "Oc",
    "No",
    "Dc",
  ];
  let unitIndex = 0;
  let value = num;

  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex++;
  }

  return `${value.toFixed(1)}${units[unitIndex]}`;
}

export function PieChart(props: PieChartProps) {
  const {
    title,
    data,
    unit,
    description,
    prefix,
    jsonView = true,
    colors,
    displayVariant = "default",
    voiceStageDensity = "dashboard",
  } = props;
  const isVoiceStage = displayVariant === "voice-stage";
  const compactVoiceHeader =
    voiceStageDensity === "triad" || voiceStageDensity === "dashboard";
  // Calculate total value
  const total = React.useMemo(() => {
    return data.reduce((acc, curr) => acc + curr.value, 0);
  }, [data]);
  const palette = colors?.length ? colors : chartColors;

  // Generate chart configuration dynamically
  const chartConfig = React.useMemo(() => {
    const config: ChartConfig = {};

    // Set value unit
    if (unit) {
      config.value = {
        label: unit,
      };
    }

    // Configure each data item
    data.forEach((item, index) => {
      // Colors cycle through chart-1 ~ chart-5
      const colorIndex = index % palette.length;
      config[sanitizeCssVariableName(item.label)] = {
        label: item.label,
        color: palette[colorIndex],
      };
    });

    return config;
  }, [data, palette, unit]);

  // Generate actual chart data
  const chartData = React.useMemo(() => {
    return data.map((item) => ({
      name: item.label,
      label: item.label,
      value: item.value,
      // Add fill property if needed
      fill: `var(--color-${sanitizeCssVariableName(item.label)})`,
    }));
  }, [data]);

  const chart = (
    <ChartContainer
      config={chartConfig}
      className={
        isVoiceStage
          ? "mx-auto h-full min-h-0 w-full max-w-[420px] aspect-auto"
          : "mx-auto aspect-square max-h-[300px]"
      }
    >
      <RechartsPieChart>
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent hideLabel />}
        />
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          innerRadius={60}
          paddingAngle={2}
          strokeWidth={5}
        >
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
                      className="fill-foreground text-3xl font-bold"
                    >
                      {formatLargeNumber(total)}
                    </tspan>
                    {unit && (
                      <tspan
                        x={viewBox.cx}
                        y={(viewBox.cy || 0) + 24}
                        className="fill-muted-foreground"
                      >
                        {unit}
                      </tspan>
                    )}
                  </text>
                );
              }
            }}
          />
        </Pie>
      </RechartsPieChart>
    </ChartContainer>
  );

  if (isVoiceStage) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[0.68rem] font-medium uppercase tracking-[0.26em] text-muted-foreground">
              Pie Chart
            </p>
            <h3
              className={
                compactVoiceHeader
                  ? "mt-2 text-base font-semibold leading-tight"
                  : "mt-2 text-lg font-semibold leading-tight"
              }
            >
              {title}
            </h3>
            {description ? (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {jsonView ? <JsonViewPopup data={props} /> : null}
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center pt-4">
          {chart}
        </div>
      </div>
    );
  }

  return (
    <Card className="flex flex-col bg-card">
      <CardHeader className="relative flex flex-col items-center gap-2 pb-0">
        <CardTitle className="flex items-center">
          {prefix ?? "Pie Chart - "}
          {title}
          {jsonView && (
            <div className="absolute right-4 top-0">
              <JsonViewPopup data={props} />
            </div>
          )}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex-1 pb-0">{chart}</CardContent>
    </Card>
  );
}
