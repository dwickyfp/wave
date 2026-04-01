import type { MermaidConfig } from "mermaid";

export interface MermaidThemePalette {
  accent: string;
  background: string;
  border: string;
  chartColors: string[];
  fontFamily: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  primary: string;
}

export interface NormalizedMermaidSvgResult {
  height: number | null;
  svg: string;
  viewBox: string | null;
  width: number | null;
}

const LIGHT_PALETTE: MermaidThemePalette = {
  accent: "rgb(244, 244, 245)",
  background: "rgb(255, 255, 255)",
  border: "rgb(228, 228, 231)",
  chartColors: [
    "rgb(59, 130, 246)",
    "rgb(14, 165, 233)",
    "rgb(16, 185, 129)",
    "rgb(245, 158, 11)",
    "rgb(239, 68, 68)",
  ],
  fontFamily:
    "Geist, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  foreground: "rgb(24, 24, 27)",
  muted: "rgb(244, 244, 245)",
  mutedForeground: "rgb(113, 113, 122)",
  primary: "rgb(39, 39, 42)",
};

const DARK_PALETTE: MermaidThemePalette = {
  accent: "rgb(39, 39, 42)",
  background: "rgb(9, 9, 11)",
  border: "rgb(39, 39, 42)",
  chartColors: [
    "rgb(96, 165, 250)",
    "rgb(56, 189, 248)",
    "rgb(52, 211, 153)",
    "rgb(251, 191, 36)",
    "rgb(248, 113, 113)",
  ],
  fontFamily:
    "Geist, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  foreground: "rgb(250, 250, 250)",
  muted: "rgb(24, 24, 27)",
  mutedForeground: "rgb(161, 161, 170)",
  primary: "rgb(244, 244, 245)",
};

const RESPONSIVE_DIAGRAM_CONFIG = {
  useMaxWidth: true,
};

const FLOWCHART_DIAGRAM_CONFIG = {
  curve: "basis" as const,
  diagramPadding: 28,
  htmlLabels: true,
  nodeSpacing: 88,
  padding: 18,
  rankSpacing: 96,
  useMaxWidth: true,
  wrappingWidth: 220,
};

interface RgbaColor {
  a: number;
  b: number;
  g: number;
  r: number;
}

function getDefaultPalette(resolvedTheme?: string | null): MermaidThemePalette {
  return resolvedTheme === "dark" ? DARK_PALETTE : LIGHT_PALETTE;
}

export function normalizeColorForMermaid(
  value: string,
  fallback: string,
): string {
  const safeCanvasColor = normalizeColorWithCanvas(value);

  if (safeCanvasColor) {
    return safeCanvasColor;
  }

  const parsedColor = parseCssColor(value) ?? parseCssColor(fallback);

  return parsedColor ? formatRgbaColor(parsedColor) : fallback;
}

function normalizeColorWithCanvas(value: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  if (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    !CSS.supports("color", value)
  ) {
    return null;
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  try {
    context.fillStyle = "#000000";
    context.fillStyle = value;

    const normalized = context.fillStyle.trim();
    return isMermaidSafeColor(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function isMermaidSafeColor(value: string): boolean {
  return (
    /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ||
    /^rgba?\(/i.test(value)
  );
}

function parseCssColor(value: string): RgbaColor | null {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  if (trimmedValue.startsWith("#")) {
    return parseHexColor(trimmedValue);
  }

  const functionMatch = trimmedValue.match(/^([a-z]+)\((.*)\)$/i);

  if (!functionMatch) {
    return null;
  }

  const [, functionName, rawArguments] = functionMatch;

  switch (functionName.toLowerCase()) {
    case "rgb":
    case "rgba":
      return parseRgbColor(rawArguments);
    case "hsl":
    case "hsla":
      return parseHslColor(rawArguments);
    case "lab":
      return parseLabColor(rawArguments);
    case "lch":
      return parseLchColor(rawArguments);
    case "oklab":
      return parseOklabColor(rawArguments);
    case "oklch":
      return parseOklchColor(rawArguments);
    default:
      return null;
  }
}

function parseHexColor(value: string): RgbaColor | null {
  const hex = value.slice(1).trim();

  if (!/^[0-9a-f]{3,8}$/i.test(hex)) {
    return null;
  }

  if (hex.length === 3 || hex.length === 4) {
    const expanded = hex
      .split("")
      .map((char) => `${char}${char}`)
      .join("");

    return parseHexColor(`#${expanded}`);
  }

  if (hex.length !== 6 && hex.length !== 8) {
    return null;
  }

  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;

  return { a, b, g, r };
}

function parseRgbColor(rawArguments: string): RgbaColor | null {
  const { alpha, channels } = splitColorFunctionArguments(rawArguments);

  if (channels.length !== 3) {
    return null;
  }

  const r = parseRgbChannel(channels[0]);
  const g = parseRgbChannel(channels[1]);
  const b = parseRgbChannel(channels[2]);
  const a = alpha ? parseAlpha(alpha) : 1;

  if (r === null || g === null || b === null || a === null) {
    return null;
  }

  return {
    a,
    b,
    g,
    r,
  };
}

function parseHslColor(rawArguments: string): RgbaColor | null {
  const { alpha, channels } = splitColorFunctionArguments(rawArguments);

  if (channels.length !== 3) {
    return null;
  }

  const hue = parseHue(channels[0]);
  const saturation = parsePercentage(channels[1]);
  const lightness = parsePercentage(channels[2]);
  const a = alpha ? parseAlpha(alpha) : 1;

  if (hue === null || saturation === null || lightness === null || a === null) {
    return null;
  }

  return hslToRgba(hue, saturation, lightness, a);
}

function parseLabColor(rawArguments: string): RgbaColor | null {
  const { alpha, channels } = splitColorFunctionArguments(rawArguments);

  if (channels.length !== 3) {
    return null;
  }

  const l = parseLabLightness(channels[0]);
  const aComponent = parseNumber(channels[1]);
  const bComponent = parseNumber(channels[2]);
  const opacity = alpha ? parseAlpha(alpha) : 1;

  if (
    l === null ||
    aComponent === null ||
    bComponent === null ||
    opacity === null
  ) {
    return null;
  }

  return labToRgba(l, aComponent, bComponent, opacity);
}

function parseLchColor(rawArguments: string): RgbaColor | null {
  const { alpha, channels } = splitColorFunctionArguments(rawArguments);

  if (channels.length !== 3) {
    return null;
  }

  const l = parseLabLightness(channels[0]);
  const chroma = parseNumber(channels[1]);
  const hue = parseHue(channels[2]);
  const opacity = alpha ? parseAlpha(alpha) : 1;

  if (l === null || chroma === null || hue === null || opacity === null) {
    return null;
  }

  const radians = (hue * Math.PI) / 180;
  return labToRgba(
    l,
    chroma * Math.cos(radians),
    chroma * Math.sin(radians),
    opacity,
  );
}

function parseOklabColor(rawArguments: string): RgbaColor | null {
  const { alpha, channels } = splitColorFunctionArguments(rawArguments);

  if (channels.length !== 3) {
    return null;
  }

  const l = parseOklabLightness(channels[0]);
  const aComponent = parseNumber(channels[1]);
  const bComponent = parseNumber(channels[2]);
  const opacity = alpha ? parseAlpha(alpha) : 1;

  if (
    l === null ||
    aComponent === null ||
    bComponent === null ||
    opacity === null
  ) {
    return null;
  }

  return oklabToRgba(l, aComponent, bComponent, opacity);
}

function parseOklchColor(rawArguments: string): RgbaColor | null {
  const { alpha, channels } = splitColorFunctionArguments(rawArguments);

  if (channels.length !== 3) {
    return null;
  }

  const l = parseOklabLightness(channels[0]);
  const chroma = parseNumber(channels[1]);
  const hue = parseHue(channels[2]);
  const opacity = alpha ? parseAlpha(alpha) : 1;

  if (l === null || chroma === null || hue === null || opacity === null) {
    return null;
  }

  const radians = (hue * Math.PI) / 180;
  return oklabToRgba(
    l,
    chroma * Math.cos(radians),
    chroma * Math.sin(radians),
    opacity,
  );
}

function splitColorFunctionArguments(rawArguments: string): {
  alpha: string | null;
  channels: string[];
} {
  const slashIndex = rawArguments.lastIndexOf("/");
  const rawChannels =
    slashIndex === -1 ? rawArguments : rawArguments.slice(0, slashIndex);
  const rawAlpha =
    slashIndex === -1 ? null : rawArguments.slice(slashIndex + 1).trim();
  const channels = rawChannels
    .replace(/,/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!rawAlpha && channels.length === 4) {
    return {
      alpha: channels[3],
      channels: channels.slice(0, 3),
    };
  }

  return {
    alpha: rawAlpha,
    channels,
  };
}

function parseRgbChannel(value: string): number | null {
  if (value.endsWith("%")) {
    const percent = parsePercentage(value);
    return percent === null ? null : percent * 255;
  }

  return parseNumber(value);
}

function parseAlpha(value: string): number | null {
  if (value.endsWith("%")) {
    return parsePercentage(value);
  }

  const parsed = parseNumber(value);
  return parsed === null ? null : clamp(parsed, 0, 1);
}

function parseLabLightness(value: string): number | null {
  if (value.endsWith("%")) {
    const percent = parsePercentage(value);
    return percent === null ? null : percent * 100;
  }

  return parseNumber(value);
}

function parseOklabLightness(value: string): number | null {
  if (value.endsWith("%")) {
    return parsePercentage(value);
  }

  return parseNumber(value);
}

function parsePercentage(value: string): number | null {
  if (!value.endsWith("%")) {
    return null;
  }

  const parsed = Number.parseFloat(value.slice(0, -1));
  return Number.isFinite(parsed) ? parsed / 100 : null;
}

function parseHue(value: string): number | null {
  if (value.endsWith("deg")) {
    return parseNumber(value.slice(0, -3));
  }

  if (value.endsWith("grad")) {
    const parsed = parseNumber(value.slice(0, -4));
    return parsed === null ? null : parsed * 0.9;
  }

  if (value.endsWith("rad")) {
    const parsed = parseNumber(value.slice(0, -3));
    return parsed === null ? null : (parsed * 180) / Math.PI;
  }

  if (value.endsWith("turn")) {
    const parsed = parseNumber(value.slice(0, -4));
    return parsed === null ? null : parsed * 360;
  }

  return parseNumber(value);
}

function parseNumber(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hslToRgba(
  hue: number,
  saturation: number,
  lightness: number,
  alpha: number,
): RgbaColor {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const chroma =
    (1 - Math.abs(2 * clamp(lightness, 0, 1) - 1)) * clamp(saturation, 0, 1);
  const huePrime = normalizedHue / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  let [r1, g1, b1] = [0, 0, 0];

  if (huePrime >= 0 && huePrime < 1) {
    [r1, g1, b1] = [chroma, x, 0];
  } else if (huePrime < 2) {
    [r1, g1, b1] = [x, chroma, 0];
  } else if (huePrime < 3) {
    [r1, g1, b1] = [0, chroma, x];
  } else if (huePrime < 4) {
    [r1, g1, b1] = [0, x, chroma];
  } else if (huePrime < 5) {
    [r1, g1, b1] = [x, 0, chroma];
  } else {
    [r1, g1, b1] = [chroma, 0, x];
  }

  const match = clamp(lightness, 0, 1) - chroma / 2;

  return {
    a: clamp(alpha, 0, 1),
    b: (b1 + match) * 255,
    g: (g1 + match) * 255,
    r: (r1 + match) * 255,
  };
}

function labToRgba(
  lightness: number,
  aComponent: number,
  bComponent: number,
  alpha: number,
): RgbaColor {
  const fy = (lightness + 16) / 116;
  const fx = fy + aComponent / 500;
  const fz = fy - bComponent / 200;
  const epsilon = 216 / 24389;
  const kappa = 24389 / 27;
  const x = 0.96422 * labInverseTransform(fx, epsilon, kappa);
  const y = labInverseTransform(fy, epsilon, kappa);
  const z = 0.82521 * labInverseTransform(fz, epsilon, kappa);

  const xD65 = 0.9554734 * x - 0.0230985 * y + 0.0632593 * z;
  const yD65 = -0.0283697 * x + 1.0099956 * y + 0.0210414 * z;
  const zD65 = 0.012314 * x - 0.0205077 * y + 1.3303659 * z;

  return linearRgbToRgba(
    3.2404542 * xD65 - 1.5371385 * yD65 - 0.4985314 * zD65,
    -0.969266 * xD65 + 1.8760108 * yD65 + 0.041556 * zD65,
    0.0556434 * xD65 - 0.2040259 * yD65 + 1.0572252 * zD65,
    alpha,
  );
}

function labInverseTransform(
  value: number,
  epsilon: number,
  kappa: number,
): number {
  const cubed = value ** 3;
  return cubed > epsilon ? cubed : (116 * value - 16) / kappa;
}

function oklabToRgba(
  lightness: number,
  aComponent: number,
  bComponent: number,
  alpha: number,
): RgbaColor {
  const l = lightness + 0.3963377774 * aComponent + 0.2158037573 * bComponent;
  const m = lightness - 0.1055613458 * aComponent - 0.0638541728 * bComponent;
  const s = lightness - 0.0894841775 * aComponent - 1.291485548 * bComponent;

  return linearRgbToRgba(
    4.0767416621 * l ** 3 - 3.3077115913 * m ** 3 + 0.2309699292 * s ** 3,
    -1.2684380046 * l ** 3 + 2.6097574011 * m ** 3 - 0.3413193965 * s ** 3,
    -0.0041960863 * l ** 3 - 0.7034186147 * m ** 3 + 1.707614701 * s ** 3,
    alpha,
  );
}

function linearRgbToRgba(
  r: number,
  g: number,
  b: number,
  alpha: number,
): RgbaColor {
  return {
    a: clamp(alpha, 0, 1),
    b: linearChannelToSrgb(b) * 255,
    g: linearChannelToSrgb(g) * 255,
    r: linearChannelToSrgb(r) * 255,
  };
}

function linearChannelToSrgb(value: number): number {
  const safeValue = clamp(value, 0, 1);

  return safeValue <= 0.0031308
    ? 12.92 * safeValue
    : 1.055 * safeValue ** (1 / 2.4) - 0.055;
}

function formatRgbaColor(color: RgbaColor): string {
  const r = clampChannel(color.r);
  const g = clampChannel(color.g);
  const b = clampChannel(color.b);
  const a = roundAlpha(color.a);

  return a >= 0.999 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

function clampChannel(value: number): number {
  return Math.round(clamp(value, 0, 255));
}

function roundAlpha(value: number): number {
  return Number.parseFloat(clamp(value, 0, 1).toFixed(3));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveCssColorValue(
  root: HTMLElement,
  variableName: string,
  fallback: string,
): string {
  const view = root.ownerDocument.defaultView;
  if (!view) {
    return fallback;
  }

  const rawColor = view.getComputedStyle(root).getPropertyValue(variableName);

  return normalizeColorForMermaid(rawColor || fallback, fallback);
}

function resolveFontFamily(root: HTMLElement, fallback: string): string {
  const view = root.ownerDocument.defaultView;
  if (!view) {
    return fallback;
  }

  const bodyFontFamily = root.ownerDocument.body
    ? view.getComputedStyle(root.ownerDocument.body).fontFamily.trim()
    : "";
  const rootFontFamily = view.getComputedStyle(root).fontFamily.trim();

  return bodyFontFamily || rootFontFamily || fallback;
}

export function readMermaidThemePalette({
  resolvedTheme,
  root,
}: {
  resolvedTheme?: string | null;
  root?: HTMLElement | null;
} = {}): MermaidThemePalette {
  const defaults = getDefaultPalette(resolvedTheme);

  if (typeof document === "undefined") {
    return defaults;
  }

  const target = root ?? document.documentElement;

  return {
    accent: resolveCssColorValue(target, "--accent", defaults.accent),
    background: resolveCssColorValue(
      target,
      "--background",
      defaults.background,
    ),
    border: resolveCssColorValue(target, "--border", defaults.border),
    chartColors: [1, 2, 3, 4, 5].map((index) =>
      resolveCssColorValue(
        target,
        `--chart-${index}`,
        defaults.chartColors[index - 1] ?? defaults.primary,
      ),
    ),
    fontFamily: resolveFontFamily(target, defaults.fontFamily),
    foreground: resolveCssColorValue(
      target,
      "--foreground",
      defaults.foreground,
    ),
    muted: resolveCssColorValue(target, "--muted", defaults.muted),
    mutedForeground: resolveCssColorValue(
      target,
      "--muted-foreground",
      defaults.mutedForeground,
    ),
    primary: resolveCssColorValue(target, "--primary", defaults.primary),
  };
}

function getChartColor(palette: MermaidThemePalette, index: number): string {
  return palette.chartColors[index] ?? palette.primary;
}

export function buildMermaidThemeVariables(
  palette: MermaidThemePalette,
): MermaidConfig["themeVariables"] {
  const neutralBlock = palette.muted;

  return {
    activationBkgColor: palette.muted,
    activationBorderColor: palette.border,
    actorBkg: palette.muted,
    actorBorder: palette.border,
    actorLineColor: palette.mutedForeground,
    actorTextColor: palette.foreground,
    altBackground: palette.background,
    altSectionBkgColor: neutralBlock,
    arrowheadColor: palette.mutedForeground,
    background: palette.background,
    border2: palette.border,
    classText: palette.foreground,
    clusterBkg: neutralBlock,
    clusterBorder: palette.border,
    cScale0: neutralBlock,
    cScale1: neutralBlock,
    cScale2: neutralBlock,
    cScale3: neutralBlock,
    cScale4: neutralBlock,
    cScale5: neutralBlock,
    cScale6: neutralBlock,
    cScale7: neutralBlock,
    cScale8: neutralBlock,
    cScale9: neutralBlock,
    cScale10: neutralBlock,
    cScale11: neutralBlock,
    critBkgColor: getChartColor(palette, 4),
    critBorderColor: getChartColor(palette, 4),
    defaultLinkColor: palette.mutedForeground,
    doneTaskBkgColor: getChartColor(palette, 2),
    doneTaskBorderColor: getChartColor(palette, 2),
    edgeLabelBackground: palette.background,
    errorBkgColor: getChartColor(palette, 4),
    errorTextColor: palette.foreground,
    fillType0: neutralBlock,
    fillType1: neutralBlock,
    fillType2: neutralBlock,
    fillType3: neutralBlock,
    fillType4: neutralBlock,
    fillType5: neutralBlock,
    fillType6: neutralBlock,
    fillType7: neutralBlock,
    fontFamily: palette.fontFamily,
    fontSize: "16px",
    gridColor: palette.border,
    labelBackgroundColor: palette.background,
    labelBoxBkgColor: palette.background,
    labelBoxBorderColor: palette.border,
    labelTextColor: palette.foreground,
    lineColor: palette.mutedForeground,
    loopTextColor: palette.foreground,
    mainBkg: neutralBlock,
    nodeBkg: palette.muted,
    nodeBorder: palette.border,
    nodeTextColor: palette.foreground,
    noteBkgColor: palette.accent,
    noteBorderColor: palette.border,
    noteTextColor: palette.foreground,
    pie1: getChartColor(palette, 0),
    pie2: getChartColor(palette, 1),
    pie3: getChartColor(palette, 2),
    pie4: getChartColor(palette, 3),
    pie5: getChartColor(palette, 4),
    pie6: getChartColor(palette, 0),
    pie7: getChartColor(palette, 1),
    pie8: getChartColor(palette, 2),
    pie9: getChartColor(palette, 3),
    pie10: getChartColor(palette, 4),
    pie11: getChartColor(palette, 0),
    primaryBorderColor: getChartColor(palette, 0),
    primaryColor: getChartColor(palette, 0),
    primaryTextColor: palette.foreground,
    rowEven: palette.muted,
    rowOdd: palette.background,
    scaleLabelColor: palette.foreground,
    secondaryBorderColor: getChartColor(palette, 1),
    secondaryColor: getChartColor(palette, 1),
    secondaryTextColor: palette.foreground,
    sectionBkgColor: neutralBlock,
    sectionBkgColor2: neutralBlock,
    signalColor: palette.mutedForeground,
    signalTextColor: palette.foreground,
    stateBkg: palette.muted,
    stateLabelColor: palette.foreground,
    taskBkgColor: palette.muted,
    taskBorderColor: palette.border,
    taskTextColor: palette.foreground,
    taskTextDarkColor: palette.foreground,
    taskTextLightColor: palette.foreground,
    taskTextOutsideColor: palette.foreground,
    tertiaryBorderColor: getChartColor(palette, 2),
    tertiaryColor: getChartColor(palette, 2),
    tertiaryTextColor: palette.foreground,
    textColor: palette.foreground,
    titleColor: palette.foreground,
    todayLineColor: getChartColor(palette, 1),
    transitionColor: palette.mutedForeground,
    transitionLabelColor: palette.foreground,
  };
}

export function buildMermaidThemeCss(palette: MermaidThemePalette): string {
  return `
svg.mermaid-diagram__svg {
  background: transparent;
  color: ${palette.foreground};
  font-family: ${palette.fontFamily};
}

svg.mermaid-diagram__svg text,
svg.mermaid-diagram__svg .nodeLabel,
svg.mermaid-diagram__svg .cluster-label,
svg.mermaid-diagram__svg .label text,
svg.mermaid-diagram__svg .cluster-label text,
svg.mermaid-diagram__svg .edgeLabel text,
svg.mermaid-diagram__svg .sectionTitle,
svg.mermaid-diagram__svg .taskText,
svg.mermaid-diagram__svg .taskTextOutsideLeft,
svg.mermaid-diagram__svg .taskTextOutsideRight,
svg.mermaid-diagram__svg .legend text,
svg.mermaid-diagram__svg foreignObject div,
svg.mermaid-diagram__svg foreignObject span,
svg.mermaid-diagram__svg .label foreignObject,
svg.mermaid-diagram__svg .cluster-label foreignObject {
  fill: ${palette.foreground} !important;
  color: ${palette.foreground} !important;
  font-weight: 600;
}

svg.mermaid-diagram__svg .node rect,
svg.mermaid-diagram__svg .node circle,
svg.mermaid-diagram__svg .node ellipse,
svg.mermaid-diagram__svg .node polygon,
svg.mermaid-diagram__svg .node path,
svg.mermaid-diagram__svg .cluster rect {
  stroke-width: 1.5px;
  shape-rendering: geometricPrecision;
}

svg.mermaid-diagram__svg .cluster rect {
  fill-opacity: 0.26;
  rx: 24px;
  ry: 24px;
  stroke-opacity: 0.92;
}

svg.mermaid-diagram__svg .cluster-label text,
svg.mermaid-diagram__svg .cluster-label foreignObject div,
svg.mermaid-diagram__svg .cluster-label span {
  font-size: 18px !important;
  font-weight: 700 !important;
  letter-spacing: 0.04em;
}

svg.mermaid-diagram__svg .node rect,
svg.mermaid-diagram__svg .node circle,
svg.mermaid-diagram__svg .node ellipse,
svg.mermaid-diagram__svg .node polygon,
svg.mermaid-diagram__svg .node path {
  filter: drop-shadow(0 12px 18px rgba(0, 0, 0, 0.16));
}

svg.mermaid-diagram__svg .edgePath path,
svg.mermaid-diagram__svg .flowchart-link,
svg.mermaid-diagram__svg marker path,
svg.mermaid-diagram__svg .messageLine0,
svg.mermaid-diagram__svg .messageLine1 {
  stroke: ${palette.mutedForeground} !important;
  stroke-width: 1.9px !important;
}

svg.mermaid-diagram__svg .edgeLabel,
svg.mermaid-diagram__svg .edgeLabel span,
svg.mermaid-diagram__svg .edgeLabel div {
  color: ${palette.foreground} !important;
  font-size: 13px !important;
  font-weight: 600 !important;
}

svg.mermaid-diagram__svg .edgeLabel rect,
svg.mermaid-diagram__svg .labelBkg {
  fill: ${palette.background} !important;
  opacity: 0.96;
  stroke: ${palette.border} !important;
}
`;
}

export function createMermaidRenderConfig({
  palette,
}: {
  palette: MermaidThemePalette;
}): MermaidConfig {
  return {
    architecture: RESPONSIVE_DIAGRAM_CONFIG,
    block: RESPONSIVE_DIAGRAM_CONFIG,
    c4: RESPONSIVE_DIAGRAM_CONFIG,
    class: RESPONSIVE_DIAGRAM_CONFIG,
    flowchart: FLOWCHART_DIAGRAM_CONFIG,
    fontSize: 16,
    gantt: RESPONSIVE_DIAGRAM_CONFIG,
    gitGraph: RESPONSIVE_DIAGRAM_CONFIG,
    journey: RESPONSIVE_DIAGRAM_CONFIG,
    kanban: RESPONSIVE_DIAGRAM_CONFIG,
    look: "classic",
    markdownAutoWrap: true,
    mindmap: RESPONSIVE_DIAGRAM_CONFIG,
    packet: RESPONSIVE_DIAGRAM_CONFIG,
    pie: RESPONSIVE_DIAGRAM_CONFIG,
    quadrantChart: RESPONSIVE_DIAGRAM_CONFIG,
    radar: RESPONSIVE_DIAGRAM_CONFIG,
    requirement: RESPONSIVE_DIAGRAM_CONFIG,
    sankey: RESPONSIVE_DIAGRAM_CONFIG,
    securityLevel: "loose",
    sequence: RESPONSIVE_DIAGRAM_CONFIG,
    startOnLoad: false,
    state: RESPONSIVE_DIAGRAM_CONFIG,
    suppressErrorRendering: true,
    theme: "base",
    themeCSS: buildMermaidThemeCss(palette),
    themeVariables: buildMermaidThemeVariables(palette),
    timeline: RESPONSIVE_DIAGRAM_CONFIG,
    wrap: true,
    xyChart: RESPONSIVE_DIAGRAM_CONFIG,
  };
}

function readAttributeValue(source: string, attribute: string): string | null {
  const match = source.match(new RegExp(`${attribute}=(["'])(.*?)\\1`, "i"));
  return match?.[2] ?? null;
}

function parseDimension(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseViewBoxDimensions(
  viewBox: string | null,
): Pick<NormalizedMermaidSvgResult, "height" | "width"> {
  if (!viewBox) {
    return {
      height: null,
      width: null,
    };
  }

  const parts = viewBox
    .trim()
    .split(/[,\s]+/)
    .map((value) => Number.parseFloat(value));

  if (
    parts.length !== 4 ||
    !Number.isFinite(parts[2]) ||
    !Number.isFinite(parts[3])
  ) {
    return {
      height: null,
      width: null,
    };
  }

  return {
    height: parts[3],
    width: parts[2],
  };
}

function replaceOrInsertAttribute(
  openTag: string,
  attribute: string,
  value: string,
): string {
  const nextAttribute = `${attribute}="${value}"`;
  const pattern = new RegExp(`\\s${attribute}=(["']).*?\\1`, "i");

  if (pattern.test(openTag)) {
    return openTag.replace(pattern, ` ${nextAttribute}`);
  }

  return openTag.replace("<svg", `<svg ${nextAttribute}`);
}

function removeAttribute(openTag: string, attribute: string): string {
  return openTag.replace(new RegExp(`\\s${attribute}=(["']).*?\\1`, "i"), "");
}

function ensureClass(openTag: string, className: string): string {
  const existingClass = readAttributeValue(openTag, "class");
  if (!existingClass) {
    return replaceOrInsertAttribute(openTag, "class", className);
  }

  const classes = new Set(existingClass.split(/\s+/).filter(Boolean));
  classes.add(className);

  return replaceOrInsertAttribute(
    openTag,
    "class",
    Array.from(classes).join(" "),
  );
}

export function normalizeMermaidSvg(svg: string): NormalizedMermaidSvgResult {
  const openTagMatch = svg.match(/<svg\b[^>]*>/i);

  if (!openTagMatch) {
    return {
      height: null,
      svg,
      viewBox: null,
      width: null,
    };
  }

  const openTag = openTagMatch[0];
  const viewBox = readAttributeValue(openTag, "viewBox");
  const width = parseDimension(readAttributeValue(openTag, "width"));
  const height = parseDimension(readAttributeValue(openTag, "height"));
  const viewBoxDimensions = parseViewBoxDimensions(viewBox);
  const normalizedWidth = width ?? viewBoxDimensions.width;
  const normalizedHeight = height ?? viewBoxDimensions.height;
  const normalizedViewBox =
    viewBox ??
    (normalizedWidth !== null && normalizedHeight !== null
      ? `0 0 ${normalizedWidth} ${normalizedHeight}`
      : null);

  let nextOpenTag = ensureClass(openTag, "mermaid-diagram__svg");
  nextOpenTag = replaceOrInsertAttribute(
    nextOpenTag,
    "data-mermaid-svg",
    "true",
  );
  nextOpenTag = replaceOrInsertAttribute(
    nextOpenTag,
    "preserveAspectRatio",
    "xMidYMin meet",
  );
  nextOpenTag = replaceOrInsertAttribute(nextOpenTag, "width", "100%");
  nextOpenTag = replaceOrInsertAttribute(
    nextOpenTag,
    "style",
    "display: block; height: auto; max-width: none; width: 100%;",
  );
  nextOpenTag = removeAttribute(nextOpenTag, "height");

  if (normalizedViewBox) {
    nextOpenTag = replaceOrInsertAttribute(
      nextOpenTag,
      "viewBox",
      normalizedViewBox,
    );
  }

  return {
    height: normalizedHeight,
    svg: svg.replace(openTag, nextOpenTag),
    viewBox: normalizedViewBox,
    width: normalizedWidth,
  };
}
