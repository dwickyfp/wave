const MERMAID_DIAGRAM_START_PATTERNS = [
  /^architecture\b/i,
  /^block-beta\b/i,
  /^classDiagram(?:-v2)?\b/i,
  /^erDiagram\b/i,
  /^flowchart\b/i,
  /^gantt\b/i,
  /^gitGraph\b/i,
  /^graph\b/i,
  /^journey\b/i,
  /^mindmap\b/i,
  /^packet-beta\b/i,
  /^pie\b/i,
  /^quadrantChart\b/i,
  /^requirementDiagram\b/i,
  /^sankey-beta\b/i,
  /^sequenceDiagram\b/i,
  /^stateDiagram(?:-v2)?\b/i,
  /^timeline\b/i,
  /^xychart-beta\b/i,
  /^zenuml\b/i,
];

interface StructuredSeriesChart {
  data: Array<{
    xAxisLabel: string;
    series: Array<{
      seriesName: string;
      value: number;
    }>;
  }>;
  title?: string;
  yAxisLabel?: string | null;
}

export type PreparedMermaidChart =
  | {
      chart: string;
      convertedFromJson: boolean;
    }
  | {
      error: string;
    };

// Normalize multi-line array definitions inside [...] to a single line.
// AI models sometimes generate xychart-beta with x-axis arrays spanning
// multiple lines, which Mermaid's parser rejects.
export function normalizeMermaidChart(chart: string): string {
  return chart.replace(/\[[^\]]*\]/g, (match) =>
    match.replace(/\s*\n\s*/g, " "),
  );
}

export function prepareMermaidChart(chart: string): PreparedMermaidChart {
  const normalizedChart = normalizeMermaidChart(chart);
  const parsedJson = tryParseJson(normalizedChart);

  if (parsedJson === null) {
    return {
      chart: normalizedChart,
      convertedFromJson: false,
    };
  }

  if (isStructuredSeriesChart(parsedJson)) {
    return {
      chart: convertStructuredSeriesChartToXyChart(parsedJson),
      convertedFromJson: true,
    };
  }

  return {
    error: isVegaLiteSpec(parsedJson)
      ? "This block contains Vega-Lite JSON, not Mermaid. Use a `vegalite` code fence instead of `mermaid`."
      : "This block contains JSON, not Mermaid syntax. Start the block with a Mermaid diagram type such as `flowchart`, `sequenceDiagram`, `gantt`, or `xychart-beta`. Use `json` or `vegalite` for raw chart data.",
  };
}

export function formatMermaidError(error: unknown, chart: string): string {
  const message =
    error instanceof Error ? error.message : "Failed to render diagram";
  const trimmedChart = chart.trim();

  if (/Invalid date:/i.test(message) && looksLikeGanttChart(trimmedChart)) {
    return `${message}\nHint: Mermaid gantt task dates must match the declared date format exactly. Prefer ISO dates like 2024-01-01 and durations like 30d.`;
  }

  if (/No diagram type detected/i.test(message)) {
    return `${message}\nHint: Mermaid blocks must begin with a diagram type such as flowchart, sequenceDiagram, gantt, or xychart-beta.`;
  }

  if (
    /Syntax error in text/i.test(message) &&
    !looksLikeMermaidChart(trimmedChart)
  ) {
    return `${message}\nHint: This does not look like Mermaid DSL. Use a Mermaid diagram keyword at the top of the block, or switch to a \`json\` or \`vegalite\` fence for structured data.`;
  }

  return message;
}

function tryParseJson(chart: string): unknown | null {
  const trimmedChart = chart.trim();

  if (!(trimmedChart.startsWith("{") || trimmedChart.startsWith("["))) {
    return null;
  }

  try {
    return JSON.parse(trimmedChart);
  } catch {
    return null;
  }
}

function isStructuredSeriesChart(
  value: unknown,
): value is StructuredSeriesChart {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return false;
  }

  return value.data.every((item) => {
    if (!isRecord(item) || typeof item.xAxisLabel !== "string") {
      return false;
    }

    if (!Array.isArray(item.series) || item.series.length === 0) {
      return false;
    }

    return item.series.every(
      (seriesItem) =>
        isRecord(seriesItem) &&
        typeof seriesItem.seriesName === "string" &&
        typeof seriesItem.value === "number" &&
        Number.isFinite(seriesItem.value),
    );
  });
}

function isVegaLiteSpec(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.$schema === "string" &&
    value.$schema.includes("vega-lite")
  );
}

function convertStructuredSeriesChartToXyChart(
  chart: StructuredSeriesChart,
): string {
  const xAxisLabels = chart.data.map((item) => item.xAxisLabel);
  const seriesNames = Array.from(
    new Set(
      chart.data.flatMap((item) =>
        item.series.map((seriesItem) => seriesItem.seriesName),
      ),
    ),
  );
  const values = chart.data.flatMap((item) =>
    item.series.map((seriesItem) => seriesItem.value),
  );
  const [minValue, maxValue] = getAxisRange(values);

  const lines = ["xychart-beta"];

  if (chart.title?.trim()) {
    lines.push(`  title ${quoteMermaidText(chart.title)}`);
  }

  lines.push(
    `  x-axis [${xAxisLabels.map((label) => quoteMermaidText(label)).join(", ")}]`,
  );
  lines.push(
    `  y-axis ${quoteMermaidText(chart.yAxisLabel?.trim() || "Value")} ${minValue} --> ${maxValue}`,
  );

  for (const seriesName of seriesNames) {
    const seriesValues = chart.data.map((item) => {
      const point = item.series.find(
        (seriesItem) => seriesItem.seriesName === seriesName,
      );
      return point?.value ?? 0;
    });

    lines.push(
      `  bar ${quoteMermaidText(seriesName)} [${seriesValues.join(", ")}]`,
    );
  }

  return lines.join("\n");
}

function getAxisRange(values: number[]): [number, number] {
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const lowerBound = minValue >= 0 ? 0 : Math.floor(minValue);
  const upperBound = maxValue <= 0 ? 0 : Math.ceil(maxValue);

  if (lowerBound === upperBound) {
    return [lowerBound, upperBound + 1];
  }

  return [lowerBound, upperBound];
}

function quoteMermaidText(value: string): string {
  return JSON.stringify(value.replace(/\s+/g, " ").trim());
}

function looksLikeGanttChart(chart: string): boolean {
  return getFirstMeaningfulLine(chart).toLowerCase() === "gantt";
}

function looksLikeMermaidChart(chart: string): boolean {
  const firstLine = getFirstMeaningfulLine(chart);
  return MERMAID_DIAGRAM_START_PATTERNS.some((pattern) =>
    pattern.test(firstLine),
  );
}

function getFirstMeaningfulLine(chart: string): string {
  const withoutDirectives = chart
    .trimStart()
    .replace(/^(?:%%\{[\s\S]*?\}%%\s*)+/, "");

  return (
    withoutDirectives
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("%%")) || ""
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
