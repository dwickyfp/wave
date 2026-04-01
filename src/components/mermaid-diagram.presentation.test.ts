import { describe, expect, test } from "vitest";

import type { MermaidThemePalette } from "./mermaid-diagram.render";
import {
  parseMermaidPresentationDiagram,
  renderDetailedMermaidPresentationDiagram,
} from "./mermaid-diagram.presentation";

const palette: MermaidThemePalette = {
  accent: "rgb(244, 244, 245)",
  background: "rgb(9, 9, 11)",
  border: "rgb(39, 39, 42)",
  chartColors: [
    "rgb(96, 165, 250)",
    "rgb(56, 189, 248)",
    "rgb(52, 211, 153)",
    "rgb(251, 191, 36)",
    "rgb(248, 113, 113)",
  ],
  fontFamily: "Geist, sans-serif",
  foreground: "rgb(250, 250, 250)",
  muted: "rgb(24, 24, 27)",
  mutedForeground: "rgb(161, 161, 170)",
  primary: "rgb(244, 244, 245)",
};

const chart = `flowchart TD
A([🚀 Start]) --> B

subgraph DESIGN ["🎨 PHASE 1: DESIGN"]
  B[Requirements Gathering] --> C[User Research & Analysis]
  C --> D[Wireframing & Mockup]
  D --> E[UI/UX Design - Figma/Adobe XD]
  E --> F{Design Review}
  F -->|Revisi| D
  F -->|Approved ✅| G[Design Handoff]
end

subgraph DEV ["💻 PHASE 2: DEVELOPMENT"]
  G --> H[Setup Project & Repository]
  H --> I[Setup Development Environment]
  I --> J[Frontend Development]
  I --> K[Backend Development]
  I --> L[Database Design]
  J & K & L --> M[Integration & API Connection]
end

N([✅ Live])`;

describe("parseMermaidPresentationDiagram", () => {
  test("keeps stages, nodes and explicit branch edges", () => {
    const parsed = parseMermaidPresentationDiagram(chart);

    expect(parsed).not.toBeNull();
    expect(parsed?.stages).toHaveLength(2);
    expect(parsed?.stages[0]?.nodeIds).toEqual(["B", "C", "D", "E", "F", "G"]);
    expect(
      parsed?.edges.some(
        (edge) => edge.sourceId === "F" && edge.targetId === "D",
      ),
    ).toBe(true);
    expect(
      parsed?.edges.find(
        (edge) => edge.sourceId === "F" && edge.targetId === "D",
      )?.label,
    ).toBe("Revisi");
  });
});

describe("renderDetailedMermaidPresentationDiagram", () => {
  test("renders separate detailed nodes and loop labels without grouping them", () => {
    const rendered = renderDetailedMermaidPresentationDiagram({
      chart,
      palette,
    });

    expect(rendered).not.toBeNull();
    expect(rendered?.svg).toContain('data-mermaid-presentation="detailed"');
    expect(rendered?.svg).toContain("Requirements Gathering");
    expect(rendered?.svg).toContain("Wireframing &amp; Mockup");
    expect(rendered?.svg).toContain("Design Review");
    expect(rendered?.svg).toContain("Approved ✅");
    expect(rendered?.svg).toContain("Revisi");
    expect(rendered?.svg).not.toContain('class="mermaid-presentation__stage"');
    expect(rendered?.svg).not.toContain(
      "Requirements Gathering · User Research",
    );
    expect(rendered?.svg).not.toMatch(/<path d="[^"]*\bC\b[^"]*"/);
  });

  test("suppresses unlabeled straight-through edges from decision nodes that already branch with labels", () => {
    const rendered = renderDetailedMermaidPresentationDiagram({
      chart: `flowchart TD
A([🚀 Start]) --> B

subgraph STAGE1 ["Stage 1"]
  B[Staging Checks] --> C{Staging OK?}
  C -->|No ❌| D[Fix Issues]
  C -->|Yes ✅| E[Deploy to Production]
  C --> F[Smoke Testing]
  E --> F
end
`,
      palette,
    });

    expect(rendered).not.toBeNull();

    const edgeCount =
      rendered?.svg.match(/class="mermaid-presentation__edge"/g)?.length ?? 0;

    expect(rendered?.svg).toContain("No ❌");
    expect(rendered?.svg).toContain("Yes ✅");
    expect(rendered?.svg).toContain("Smoke Testing");
    expect(edgeCount).toBe(5);
  });
});
