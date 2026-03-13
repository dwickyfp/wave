import { describe, expect, test } from "vitest";

import {
  formatMermaidError,
  normalizeMermaidChart,
  prepareMermaidChart,
} from "./mermaid-diagram.utils";

describe("normalizeMermaidChart", () => {
  test("collapses multiline x-axis arrays", () => {
    const chart = `xychart-beta
  x-axis [
    "Jan",
    "Feb"
  ]
  bar [1, 2]`;

    expect(normalizeMermaidChart(chart)).toContain('x-axis [ "Jan", "Feb" ]');
  });
});

describe("prepareMermaidChart", () => {
  test("keeps native Mermaid definitions intact", () => {
    const chart = `flowchart TD
  A[Start] --> B[End]`;

    expect(prepareMermaidChart(chart)).toEqual({
      chart,
      convertedFromJson: false,
    });
  });

  test("converts structured chart JSON into Mermaid xychart", () => {
    const chart = JSON.stringify({
      title: "BBCA vs Peers FY25",
      yAxisLabel: "Value (%)",
      data: [
        {
          xAxisLabel: "NIM (%)",
          series: [
            { seriesName: "BBCA", value: 6.1 },
            { seriesName: "Peers Avg", value: 6.3 },
          ],
        },
        {
          xAxisLabel: "ROE (%)",
          series: [
            { seriesName: "BBCA", value: 20.5 },
            { seriesName: "Peers Avg", value: 18.5 },
          ],
        },
      ],
    });

    expect(prepareMermaidChart(chart)).toEqual({
      chart: `xychart-beta
  title "BBCA vs Peers FY25"
  x-axis ["NIM (%)", "ROE (%)"]
  y-axis "Value (%)" 0 --> 21
  bar "BBCA" [6.1, 20.5]
  bar "Peers Avg" [6.3, 18.5]`,
      convertedFromJson: true,
    });
  });

  test("rejects non-Mermaid JSON with an actionable message", () => {
    const chart = JSON.stringify({
      hello: "world",
    });

    expect(prepareMermaidChart(chart)).toEqual({
      error:
        "This block contains JSON, not Mermaid syntax. Start the block with a Mermaid diagram type such as `flowchart`, `sequenceDiagram`, `gantt`, or `xychart-beta`. Use `json` or `vegalite` for raw chart data.",
    });
  });

  test("rejects Vega-Lite specs with the right fence hint", () => {
    const chart = JSON.stringify({
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      mark: "bar",
    });

    expect(prepareMermaidChart(chart)).toEqual({
      error:
        "This block contains Vega-Lite JSON, not Mermaid. Use a `vegalite` code fence instead of `mermaid`.",
    });
  });
});

describe("formatMermaidError", () => {
  test("adds a gantt-specific hint for invalid dates", () => {
    const chart = `gantt
  title Roadmap
  dateFormat YYYY-MM-DD
  section Planning
  Kickoff :2024 :81.5, 1d`;

    expect(
      formatMermaidError(new Error("Invalid date:2024 :81.5"), chart),
    ).toBe(
      "Invalid date:2024 :81.5\nHint: Mermaid gantt task dates must match the declared date format exactly. Prefer ISO dates like 2024-01-01 and durations like 30d.",
    );
  });

  test("adds a syntax hint when the block does not look like Mermaid", () => {
    expect(
      formatMermaidError(new Error("Syntax error in text"), '{"foo":"bar"}'),
    ).toBe(
      "Syntax error in text\nHint: This does not look like Mermaid DSL. Use a Mermaid diagram keyword at the top of the block, or switch to a `json` or `vegalite` fence for structured data.",
    );
  });
});
