import { describe, expect, test } from "vitest";

import {
  buildMermaidThemeVariables,
  createMermaidRenderConfig,
  normalizeMermaidSvg,
  normalizeColorForMermaid,
  type MermaidThemePalette,
} from "./mermaid-diagram.render";

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

describe("createMermaidRenderConfig", () => {
  test("builds a theme-aware mermaid config with responsive diagram sizing", () => {
    const config = createMermaidRenderConfig({ palette });

    expect(config).toMatchObject({
      fontSize: 16,
      look: "classic",
      markdownAutoWrap: true,
      securityLevel: "loose",
      startOnLoad: false,
      suppressErrorRendering: true,
      theme: "base",
      wrap: true,
    });
    expect(config.flowchart).toEqual({
      curve: "basis",
      diagramPadding: 28,
      htmlLabels: true,
      nodeSpacing: 88,
      padding: 18,
      rankSpacing: 96,
      useMaxWidth: true,
      wrappingWidth: 220,
    });
    expect(config.sequence).toEqual({ useMaxWidth: true });
    expect(config.themeCSS).toContain("svg.mermaid-diagram__svg");
    expect(config.themeCSS).toContain("fill-opacity: 0.26");
  });

  test("maps palette colors into mermaid theme variables", () => {
    const themeVariables = buildMermaidThemeVariables(palette);

    expect(themeVariables).toMatchObject({
      background: palette.background,
      fontFamily: palette.fontFamily,
      fontSize: "16px",
      lineColor: palette.mutedForeground,
      nodeBkg: palette.muted,
      primaryColor: palette.chartColors[0],
      primaryTextColor: palette.foreground,
    });
  });
});

describe("normalizeMermaidSvg", () => {
  test("ensures responsive svg attributes and keeps intrinsic dimensions", () => {
    const result = normalizeMermaidSvg(
      '<svg width="720" height="480" xmlns="http://www.w3.org/2000/svg"><g /></svg>',
    );

    expect(result.width).toBe(720);
    expect(result.height).toBe(480);
    expect(result.viewBox).toBe("0 0 720 480");
    expect(result.svg).toContain('class="mermaid-diagram__svg"');
    expect(result.svg).toContain('data-mermaid-svg="true"');
    expect(result.svg).toContain('preserveAspectRatio="xMidYMin meet"');
    expect(result.svg).toContain('viewBox="0 0 720 480"');
    expect(result.svg).toContain('width="100%"');
    expect(result.svg).toContain(
      'style="display: block; height: auto; max-width: none; width: 100%;"',
    );
    expect(result.svg).not.toContain('height="480"');
  });

  test("uses an existing viewBox when one is already present", () => {
    const result = normalizeMermaidSvg(
      '<svg viewBox="0 0 100 50" style="max-width: 100%;" xmlns="http://www.w3.org/2000/svg"><g /></svg>',
    );

    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
    expect(result.viewBox).toBe("0 0 100 50");
    expect(result.svg).toContain('viewBox="0 0 100 50"');
    expect(result.svg).toContain('width="100%"');
  });
});

describe("normalizeColorForMermaid", () => {
  test("converts reported lab colors into a mermaid-safe rgb string", () => {
    const result = normalizeColorForMermaid(
      "lab(65.6464 1.53497 -5.42429)",
      "rgb(0, 0, 0)",
    );

    expect(result).toMatch(/^rgb\(/);
    expect(result).not.toContain("lab(");
  });

  test("converts oklch colors with alpha into rgba", () => {
    const result = normalizeColorForMermaid(
      "oklch(1 0 0 / 10%)",
      "rgb(255, 255, 255)",
    );

    expect(result).toBe("rgba(255, 255, 255, 0.1)");
  });
});
