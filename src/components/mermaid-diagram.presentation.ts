import type {
  MermaidThemePalette,
  NormalizedMermaidSvgResult,
} from "./mermaid-diagram.render";

type FlowDirection = "TB" | "TD";
type MermaidNodeShape = "decision" | "process" | "terminal";

interface MermaidPresentationNode {
  id: string;
  label: string;
  order: number;
  shape: MermaidNodeShape;
  stageId: string | null;
}

interface MermaidPresentationEdge {
  id: string;
  label: string | null;
  order: number;
  sourceId: string;
  targetId: string;
}

export interface MermaidPresentationStage {
  id: string;
  label: string;
  nodeIds: string[];
  order: number;
}

export interface ParsedMermaidPresentationDiagram {
  direction: FlowDirection;
  edges: MermaidPresentationEdge[];
  nodes: MermaidPresentationNode[];
  stages: MermaidPresentationStage[];
}

interface NodeLayout {
  height: number;
  labelLines: string[];
  left: number;
  rank: number;
  top: number;
  width: number;
}

interface StageLayout {
  bottom: number;
  innerLeft: number;
  innerRight: number;
  label: string;
  left: number;
  loopLaneX: number;
  order: number;
  right: number;
  top: number;
}

interface RgbColor {
  b: number;
  g: number;
  r: number;
}

interface NodeAppearance {
  fill: string;
  stroke: string;
  text: string;
}

const MAX_STAGE_NODE_WIDTH = 248;
const MIN_STAGE_NODE_WIDTH = 178;
const STAGE_LEFT = 60;
const STAGE_WIDTH = 920;
const STAGE_RIGHT = STAGE_LEFT + STAGE_WIDTH;
const STAGE_TOP_PADDING = 18;
const STAGE_BOTTOM_PADDING = 28;
const STAGE_SIDE_PADDING = 20;
const STAGE_NODE_GAP_X = 38;
const STAGE_NODE_GAP_Y = 64;
const STAGE_GAP_Y = 92;
const START_Y = 28;
const CANVAS_WIDTH = 1040;

export function parseMermaidPresentationDiagram(
  chart: string,
): ParsedMermaidPresentationDiagram | null {
  const lines = chart
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("%%") &&
        !line.startsWith("%%{") &&
        !line.endsWith("}%%"),
    );

  const firstMeaningfulLine = lines[0];
  const directionMatch = firstMeaningfulLine?.match(
    /^(?:flowchart|graph)\s+(TD|TB)\b/i,
  );

  if (!directionMatch) {
    return null;
  }

  const nodes = new Map<string, MermaidPresentationNode>();
  const edges: MermaidPresentationEdge[] = [];
  const stages: MermaidPresentationStage[] = [];
  let currentStageId: string | null = null;
  let nodeOrder = 0;
  let edgeOrder = 0;
  let stageDepth = 0;

  for (const line of lines.slice(1)) {
    if (/^(?:style|classDef|class|linkStyle|click)\b/i.test(line)) {
      continue;
    }

    if (/^subgraph\b/i.test(line)) {
      if (stageDepth === 0) {
        const stage = parseSubgraphLine(line, stages.length);
        stages.push({
          id: stage.id,
          label: stage.label,
          nodeIds: [],
          order: stages.length,
        });
        currentStageId = stage.id;
      }

      stageDepth += 1;
      continue;
    }

    if (/^end$/i.test(line)) {
      stageDepth = Math.max(0, stageDepth - 1);
      if (stageDepth === 0) {
        currentStageId = null;
      }
      continue;
    }

    for (const definition of extractNodeDefinitions(line)) {
      if (!nodes.has(definition.id)) {
        nodes.set(definition.id, {
          id: definition.id,
          label: definition.label,
          order: nodeOrder,
          shape: definition.shape,
          stageId: currentStageId,
        });
        nodeOrder += 1;
      } else {
        const existingNode = nodes.get(definition.id)!;
        if (
          definition.label &&
          (!existingNode.label ||
            existingNode.label === humanizeIdentifier(existingNode.id))
        ) {
          existingNode.label = definition.label;
        }
        existingNode.shape = definition.shape;
        if (existingNode.stageId === null && currentStageId) {
          existingNode.stageId = currentStageId;
        }
      }

      if (currentStageId) {
        const currentStage = stages.find(
          (stage) => stage.id === currentStageId,
        );
        if (currentStage && !currentStage.nodeIds.includes(definition.id)) {
          currentStage.nodeIds.push(definition.id);
        }
      }
    }

    for (const edge of extractEdgesFromLine(line)) {
      if (!nodes.has(edge.sourceId)) {
        nodes.set(edge.sourceId, {
          id: edge.sourceId,
          label: humanizeIdentifier(edge.sourceId),
          order: nodeOrder,
          shape: "process",
          stageId: null,
        });
        nodeOrder += 1;
      }

      if (!nodes.has(edge.targetId)) {
        nodes.set(edge.targetId, {
          id: edge.targetId,
          label: humanizeIdentifier(edge.targetId),
          order: nodeOrder,
          shape: "process",
          stageId: null,
        });
        nodeOrder += 1;
      }

      edges.push({
        id: `edge-${edgeOrder}`,
        label: edge.label,
        order: edgeOrder,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
      });
      edgeOrder += 1;
    }
  }

  if (stages.length < 1) {
    return null;
  }

  for (const stage of stages) {
    stage.nodeIds.sort((leftId, rightId) => {
      return (nodes.get(leftId)?.order ?? 0) - (nodes.get(rightId)?.order ?? 0);
    });
  }

  return {
    direction: directionMatch[1].toUpperCase() as FlowDirection,
    edges,
    nodes: Array.from(nodes.values()).sort(
      (left, right) => left.order - right.order,
    ),
    stages,
  };
}

export function renderDetailedMermaidPresentationDiagram({
  chart,
  palette,
}: {
  chart: string;
  palette: MermaidThemePalette;
}): NormalizedMermaidSvgResult | null {
  const parsed = parseMermaidPresentationDiagram(chart);

  if (!parsed) {
    return null;
  }

  const nodesById = new Map(parsed.nodes.map((node) => [node.id, node]));
  const stageIndexById = new Map(
    parsed.stages.map((stage, index) => [stage.id, index]),
  );
  const stageLayouts = new Map<string, StageLayout>();
  const nodeLayouts = new Map<string, NodeLayout>();
  const stageColorPalette = buildStageColorPalette(palette);
  const canvasBackground = rgbToString(
    mixRgb(
      parseRgbColor(palette.background),
      parseRgbColor(palette.muted),
      0.22,
    ),
  );
  const edgeColor = rgbToString(
    mixRgb(
      parseRgbColor(palette.foreground),
      parseRgbColor(palette.background),
      0.58,
    ),
  );
  const nodeFill = rgbToString(
    mixRgb(
      parseRgbColor(palette.background),
      parseRgbColor(palette.primary),
      0.16,
    ),
  );
  const nodeStroke = rgbToString(
    mixRgb(
      parseRgbColor(palette.border),
      parseRgbColor(palette.foreground),
      0.24,
    ),
  );
  const nodeText = rgbToString(
    mixRgb(
      parseRgbColor(palette.foreground),
      parseRgbColor(palette.background),
      0.08,
    ),
  );

  let currentStageTop = 116;

  for (const stage of parsed.stages) {
    const stageNodes = stage.nodeIds
      .map((nodeId) => nodesById.get(nodeId))
      .filter((node): node is MermaidPresentationNode => Boolean(node));

    if (stageNodes.length === 0) {
      continue;
    }

    const ranks = computeStageRanks(stage, parsed.edges, nodesById);
    const nodeMeasurements = new Map<string, NodeLayout>();

    for (const stageNode of stageNodes) {
      const measurement = measureNode(stageNode);
      nodeMeasurements.set(stageNode.id, {
        ...measurement,
        left: 0,
        rank: ranks.get(stageNode.id) ?? 0,
        top: 0,
      });
    }

    const rankGroups = new Map<number, MermaidPresentationNode[]>();
    for (const stageNode of stageNodes) {
      const rank = ranks.get(stageNode.id) ?? 0;
      const group = rankGroups.get(rank) ?? [];
      group.push(stageNode);
      rankGroups.set(rank, group);
    }

    const orderedRanks = Array.from(rankGroups.keys()).sort(
      (left, right) => left - right,
    );
    let nodeTop = currentStageTop + STAGE_TOP_PADDING;

    for (const rank of orderedRanks) {
      const group = (rankGroups.get(rank) ?? []).sort(
        (left, right) => left.order - right.order,
      );
      const groupWidth =
        group.reduce(
          (total, node) => total + (nodeMeasurements.get(node.id)?.width ?? 0),
          0,
        ) +
        Math.max(0, group.length - 1) * STAGE_NODE_GAP_X;
      let nodeLeft =
        STAGE_LEFT +
        STAGE_SIDE_PADDING +
        (STAGE_WIDTH - STAGE_SIDE_PADDING * 2 - groupWidth) / 2;
      let rankMaxHeight = 0;

      for (const node of group) {
        const layout = nodeMeasurements.get(node.id)!;
        layout.left = nodeLeft;
        layout.top = nodeTop;
        rankMaxHeight = Math.max(rankMaxHeight, layout.height);
        nodeLeft += layout.width + STAGE_NODE_GAP_X;
      }

      nodeTop += rankMaxHeight + STAGE_NODE_GAP_Y;
    }

    const lastNodeBottom = Math.max(
      ...Array.from(nodeMeasurements.values()).map(
        (layout) => layout.top + layout.height,
      ),
    );
    const stageBottom = lastNodeBottom + STAGE_BOTTOM_PADDING;

    stageLayouts.set(stage.id, {
      bottom: stageBottom,
      innerLeft: STAGE_LEFT + STAGE_SIDE_PADDING,
      innerRight: STAGE_RIGHT - STAGE_SIDE_PADDING,
      label: normalizeStageLabel(stage.label, stage.order),
      left: STAGE_LEFT,
      loopLaneX: STAGE_LEFT + 26,
      order: stage.order,
      right: STAGE_RIGHT,
      top: currentStageTop,
    });

    for (const [nodeId, layout] of nodeMeasurements.entries()) {
      nodeLayouts.set(nodeId, layout);
    }

    currentStageTop = stageBottom + STAGE_GAP_Y;
  }

  const startNodes = parsed.nodes.filter((node) => {
    if (node.stageId !== null) {
      return false;
    }
    const incomingCount = parsed.edges.filter(
      (edge) => edge.targetId === node.id,
    ).length;
    const outgoingCount = parsed.edges.filter(
      (edge) => edge.sourceId === node.id,
    ).length;
    return outgoingCount > 0 && incomingCount === 0;
  });
  const endNodes = parsed.nodes.filter((node) => {
    if (node.stageId !== null) {
      return false;
    }
    const incomingCount = parsed.edges.filter(
      (edge) => edge.targetId === node.id,
    ).length;
    const outgoingCount = parsed.edges.filter(
      (edge) => edge.sourceId === node.id,
    ).length;
    return incomingCount > 0 && outgoingCount === 0;
  });

  layoutOutsideNodes({
    endNodes,
    nodeLayouts,
    startNodes,
    totalHeight: currentStageTop,
  });

  const diagramBottom = Math.max(
    currentStageTop,
    ...Array.from(nodeLayouts.values()).map(
      (layout) => layout.top + layout.height + 40,
    ),
  );
  const canvasHeight = diagramBottom + 40;

  const edgeMarkup = parsed.edges
    .map((edge) => {
      const sourceNode = nodesById.get(edge.sourceId);
      const targetNode = nodesById.get(edge.targetId);
      const sourceLayout = nodeLayouts.get(edge.sourceId);
      const targetLayout = nodeLayouts.get(edge.targetId);

      if (!sourceNode || !targetNode || !sourceLayout || !targetLayout) {
        return "";
      }

      const sameStage =
        sourceNode.stageId !== null &&
        sourceNode.stageId === targetNode.stageId &&
        sourceNode.stageId !== null;
      const sourceCenterX = sourceLayout.left + sourceLayout.width / 2;
      const targetCenterX = targetLayout.left + targetLayout.width / 2;
      const sourceBottomY = sourceLayout.top + sourceLayout.height;
      const targetTopY = targetLayout.top;
      const sourceMidY = sourceLayout.top + sourceLayout.height / 2;
      const targetMidY = targetLayout.top + targetLayout.height / 2;
      const sourceLeftX = sourceLayout.left;
      const targetLeftX = targetLayout.left;
      const targetOrder = targetNode.order;
      const sourceOrder = sourceNode.order;
      const isLoopEdge = sameStage && targetOrder <= sourceOrder;
      let path = "";
      let labelX = (sourceCenterX + targetCenterX) / 2;
      let labelY = (sourceBottomY + targetTopY) / 2;

      if (isLoopEdge) {
        const stageLayout = stageLayouts.get(sourceNode.stageId!);
        const laneX = stageLayout?.loopLaneX ?? STAGE_LEFT + 18;
        const loopTop = targetMidY;
        path = [
          `M ${sourceLeftX} ${sourceMidY}`,
          `C ${sourceLeftX - 18} ${sourceMidY}, ${laneX + 18} ${sourceMidY}, ${laneX} ${sourceMidY}`,
          `L ${laneX} ${loopTop}`,
          `C ${laneX} ${loopTop}, ${targetLeftX - 18} ${loopTop}, ${targetLeftX} ${loopTop}`,
        ].join(" ");
        labelX = laneX + 14;
        labelY = sourceMidY - Math.max(14, (sourceMidY - loopTop) / 2);
      } else if (Math.abs(sourceCenterX - targetCenterX) < 6) {
        path = `M ${sourceCenterX} ${sourceBottomY} L ${targetCenterX} ${targetTopY}`;
      } else {
        const midY = sourceBottomY + (targetTopY - sourceBottomY) / 2;
        path = [
          `M ${sourceCenterX} ${sourceBottomY}`,
          `C ${sourceCenterX} ${midY}, ${targetCenterX} ${midY}, ${targetCenterX} ${targetTopY}`,
        ].join(" ");
      }

      const pathMarkup = `<path d="${path}" fill="none" stroke="${edgeColor}" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#detailed-flow-arrow)" />`;
      const labelMarkup = edge.label
        ? renderEdgeLabel({
            background: canvasBackground,
            border: nodeStroke,
            color: nodeText,
            text: edge.label,
            x: labelX,
            y: labelY,
          })
        : "";

      return `<g class="mermaid-presentation__edge">${pathMarkup}${labelMarkup}</g>`;
    })
    .join("");

  const nodeMarkup = parsed.nodes
    .map((node) => {
      const layout = nodeLayouts.get(node.id);
      if (!layout) {
        return "";
      }

      const appearance = resolveNodeAppearance({
        canvasBackground,
        edgeColor,
        neutralAppearance: {
          fill: nodeFill,
          stroke: nodeStroke,
          text: nodeText,
        },
        node,
        stageColorPalette,
        stageIndexById,
      });

      if (node.shape === "decision") {
        return renderDecisionNode({
          fill: appearance.fill,
          labelLines: layout.labelLines,
          stroke: appearance.stroke,
          textColor: appearance.text,
          x: layout.left,
          y: layout.top,
          width: layout.width,
          height: layout.height,
        });
      }

      if (node.shape === "terminal") {
        return renderTerminalNode({
          fill: appearance.fill,
          labelLines: layout.labelLines,
          stroke: appearance.stroke,
          textColor: appearance.text,
          x: layout.left,
          y: layout.top,
          width: layout.width,
          height: layout.height,
        });
      }

      return renderProcessNode({
        fill: appearance.fill,
        labelLines: layout.labelLines,
        stroke: appearance.stroke,
        textColor: appearance.text,
        x: layout.left,
        y: layout.top,
        width: layout.width,
        height: layout.height,
      });
    })
    .join("");

  const svg = [
    `<svg width="100%" viewBox="0 0 ${CANVAS_WIDTH} ${canvasHeight}" xmlns="http://www.w3.org/2000/svg" data-mermaid-svg="true" data-mermaid-presentation="detailed" class="mermaid-diagram__svg" preserveAspectRatio="xMidYMin meet" style="display: block; height: auto; max-width: none; width: 100%;">`,
    `<defs><marker id="detailed-flow-arrow" viewBox="0 0 10 10" refX="8.4" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M2 1L8 5L2 9" fill="none" stroke="${edgeColor}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" /></marker></defs>`,
    `<style>
      .mermaid-presentation__node-text { font-family: ${escapeXml(palette.fontFamily)}; font-size: 12.5px; font-weight: 700; }
      .mermaid-presentation__edge-text { font-family: ${escapeXml(palette.fontFamily)}; font-size: 11px; font-weight: 600; }
    </style>`,
    `<rect x="0" y="0" width="${CANVAS_WIDTH}" height="${canvasHeight}" rx="28" fill="${canvasBackground}" />`,
    edgeMarkup,
    nodeMarkup,
    `</svg>`,
  ].join("");

  return {
    height: canvasHeight,
    svg,
    viewBox: `0 0 ${CANVAS_WIDTH} ${canvasHeight}`,
    width: CANVAS_WIDTH,
  };
}

function parseSubgraphLine(
  line: string,
  stageIndex: number,
): { id: string; label: string } {
  const rest = line.replace(/^subgraph\b/i, "").trim();

  if (!rest) {
    return {
      id: `stage-${stageIndex + 1}`,
      label: `PHASE ${stageIndex + 1}`,
    };
  }

  if (/^["'[(]/.test(rest)) {
    return {
      id: `stage-${stageIndex + 1}`,
      label: normalizeLabel(rest),
    };
  }

  const firstSpaceIndex = rest.search(/\s/);
  if (firstSpaceIndex === -1) {
    return {
      id: rest,
      label: humanizeIdentifier(rest),
    };
  }

  return {
    id: rest.slice(0, firstSpaceIndex).trim(),
    label: normalizeLabel(rest.slice(firstSpaceIndex).trim()),
  };
}

function extractEdgesFromLine(
  line: string,
): Array<{ label: string | null; sourceId: string; targetId: string }> {
  const operatorPattern = /-->\|([^|]*)\||-->/g;
  const segments: string[] = [];
  const labels: Array<string | null> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = operatorPattern.exec(line)) !== null) {
    segments.push(line.slice(lastIndex, match.index).trim());
    labels.push(match[1] ? normalizeLabel(match[1]) : null);
    lastIndex = match.index + match[0].length;
  }

  if (segments.length === 0) {
    return [];
  }

  segments.push(line.slice(lastIndex).trim());
  const edges: Array<{
    label: string | null;
    sourceId: string;
    targetId: string;
  }> = [];

  for (let index = 0; index < segments.length - 1; index += 1) {
    const leftIds = extractEndpointIds(segments[index]);
    const rightIds = extractEndpointIds(segments[index + 1]);

    for (const sourceId of leftIds) {
      for (const targetId of rightIds) {
        edges.push({
          label: labels[index] ?? null,
          sourceId,
          targetId,
        });
      }
    }
  }

  return edges;
}

function extractEndpointIds(segment: string): string[] {
  const ids = new Set<string>();

  for (const definition of extractNodeDefinitions(segment)) {
    ids.add(definition.id);
  }

  const strippedSegment = segment.replace(
    /[A-Za-z0-9_][A-Za-z0-9_-]*\s*(\([^)]*\)|\[[^\]]*\]|\{[^}]*\})/g,
    (match) => match.replace(/(\([^)]*\)|\[[^\]]*\]|\{[^}]*\})/g, ""),
  );

  for (const token of strippedSegment.split("&")) {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      continue;
    }

    const identifierMatch = trimmedToken.match(
      /\b[A-Za-z0-9_][A-Za-z0-9_-]*\b/,
    );
    if (identifierMatch) {
      ids.add(identifierMatch[0]);
    }
  }

  return Array.from(ids);
}

function extractNodeDefinitions(
  line: string,
): Array<{ id: string; label: string; shape: MermaidNodeShape }> {
  const definitions: Array<{
    id: string;
    label: string;
    shape: MermaidNodeShape;
  }> = [];
  let cursor = 0;

  while (cursor < line.length) {
    const identifierMatch = line
      .slice(cursor)
      .match(/[A-Za-z0-9_][A-Za-z0-9_-]*/);

    if (!identifierMatch || identifierMatch.index === undefined) {
      break;
    }

    const start = cursor + identifierMatch.index;
    const id = identifierMatch[0];
    let bracketIndex = start + id.length;

    while (bracketIndex < line.length && /\s/.test(line[bracketIndex])) {
      bracketIndex += 1;
    }

    const bracket = line[bracketIndex];
    if (bracket !== "(" && bracket !== "[" && bracket !== "{") {
      cursor = start + id.length;
      continue;
    }

    const segment = readBracketedSegment(line, bracketIndex);
    if (!segment) {
      cursor = start + id.length;
      continue;
    }

    definitions.push({
      id,
      label: normalizeLabel(segment.content),
      shape:
        bracket === "{" ? "decision" : bracket === "(" ? "terminal" : "process",
    });

    cursor = segment.end;
  }

  return definitions;
}

function readBracketedSegment(
  value: string,
  startIndex: number,
): { content: string; end: number } | null {
  const opener = value[startIndex];
  const closer = opener === "(" ? ")" : opener === "[" ? "]" : "}";
  let depth = 0;

  for (let index = startIndex; index < value.length; index += 1) {
    if (value[index] === opener) {
      depth += 1;
    } else if (value[index] === closer) {
      depth -= 1;
      if (depth === 0) {
        return {
          content: value.slice(startIndex + 1, index),
          end: index + 1,
        };
      }
    }
  }

  return null;
}

function computeStageRanks(
  stage: MermaidPresentationStage,
  edges: MermaidPresentationEdge[],
  nodesById: Map<string, MermaidPresentationNode>,
): Map<string, number> {
  const stageNodeIds = new Set(stage.nodeIds);
  const forwardEdges = edges.filter((edge) => {
    if (!stageNodeIds.has(edge.sourceId) || !stageNodeIds.has(edge.targetId)) {
      return false;
    }

    const sourceNode = nodesById.get(edge.sourceId);
    const targetNode = nodesById.get(edge.targetId);
    if (!sourceNode || !targetNode) {
      return false;
    }

    return targetNode.order > sourceNode.order;
  });
  const incomingCount = new Map<string, number>(
    stage.nodeIds.map((nodeId) => [nodeId, 0]),
  );

  for (const edge of forwardEdges) {
    incomingCount.set(
      edge.targetId,
      (incomingCount.get(edge.targetId) ?? 0) + 1,
    );
  }

  const ranks = new Map<string, number>();
  for (const nodeId of stage.nodeIds) {
    if ((incomingCount.get(nodeId) ?? 0) === 0) {
      ranks.set(nodeId, 0);
    }
  }

  if (ranks.size === 0 && stage.nodeIds[0]) {
    ranks.set(stage.nodeIds[0], 0);
  }

  for (const nodeId of stage.nodeIds) {
    if (!ranks.has(nodeId)) {
      ranks.set(nodeId, 0);
    }
    const sourceRank = ranks.get(nodeId) ?? 0;

    for (const edge of forwardEdges.filter(
      (candidate) => candidate.sourceId === nodeId,
    )) {
      ranks.set(
        edge.targetId,
        Math.max(ranks.get(edge.targetId) ?? 0, sourceRank + 1),
      );
    }
  }

  return ranks;
}

function measureNode(
  node: MermaidPresentationNode,
): Omit<NodeLayout, "left" | "rank" | "top"> {
  const maxCharactersPerLine = node.shape === "decision" ? 16 : 22;
  const labelLines = wrapWords(node.label, maxCharactersPerLine, 3);
  const lineHeight = 18;
  const width = clamp(
    Math.max(...labelLines.map((line) => line.length), 10) * 7.2 + 34,
    node.shape === "decision" ? 144 : MIN_STAGE_NODE_WIDTH,
    node.shape === "decision" ? 186 : MAX_STAGE_NODE_WIDTH,
  );
  const height =
    node.shape === "decision"
      ? Math.max(100, 54 + (labelLines.length - 1) * lineHeight)
      : Math.max(50, 28 + labelLines.length * lineHeight);

  return {
    height,
    labelLines,
    width,
  };
}

function layoutOutsideNodes({
  endNodes,
  nodeLayouts,
  startNodes,
  totalHeight,
}: {
  endNodes: MermaidPresentationNode[];
  nodeLayouts: Map<string, NodeLayout>;
  startNodes: MermaidPresentationNode[];
  totalHeight: number;
}) {
  if (startNodes[0]) {
    const startMeasurement = measureNode(startNodes[0]);
    nodeLayouts.set(startNodes[0].id, {
      ...startMeasurement,
      left: CANVAS_WIDTH / 2 - startMeasurement.width / 2,
      rank: 0,
      top: START_Y,
    });
  }

  if (endNodes[0]) {
    const endMeasurement = measureNode(endNodes[0]);
    nodeLayouts.set(endNodes[0].id, {
      ...endMeasurement,
      left: CANVAS_WIDTH / 2 - endMeasurement.width / 2,
      rank: 0,
      top: totalHeight - 12,
    });
  }
}

function renderProcessNode({
  fill,
  height,
  labelLines,
  stroke,
  textColor,
  width,
  x,
  y,
}: {
  fill: string;
  height: number;
  labelLines: string[];
  stroke: string;
  textColor: string;
  width: number;
  x: number;
  y: number;
}) {
  return [
    `<g class="mermaid-presentation__node">`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="${fill}" stroke="${stroke}" stroke-width="1.05" />`,
    renderNodeText({ height, labelLines, textColor, width, x, y }),
    `</g>`,
  ].join("");
}

function renderTerminalNode({
  fill,
  height,
  labelLines,
  stroke,
  textColor,
  width,
  x,
  y,
}: {
  fill: string;
  height: number;
  labelLines: string[];
  stroke: string;
  textColor: string;
  width: number;
  x: number;
  y: number;
}) {
  return [
    `<g class="mermaid-presentation__node">`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.min(
      24,
      Math.round(height / 2),
    )}" fill="${fill}" stroke="${stroke}" stroke-width="1.05" />`,
    renderNodeText({ height, labelLines, textColor, width, x, y }),
    `</g>`,
  ].join("");
}

function renderDecisionNode({
  fill,
  height,
  labelLines,
  stroke,
  textColor,
  width,
  x,
  y,
}: {
  fill: string;
  height: number;
  labelLines: string[];
  stroke: string;
  textColor: string;
  width: number;
  x: number;
  y: number;
}) {
  const centerX = x + width / 2;
  const centerY = y + height / 2;

  return [
    `<g class="mermaid-presentation__node">`,
    `<polygon points="${centerX},${y} ${x + width},${centerY} ${centerX},${y + height} ${x},${centerY}" fill="${fill}" stroke="${stroke}" stroke-width="1.05" />`,
    renderNodeText({ height, labelLines, textColor, width, x, y }),
    `</g>`,
  ].join("");
}

function renderNodeText({
  height,
  labelLines,
  textColor,
  width,
  x,
  y,
}: {
  height: number;
  labelLines: string[];
  textColor: string;
  width: number;
  x: number;
  y: number;
}) {
  const centerX = x + width / 2;
  const lineHeight = 16;
  const firstLineY =
    y + height / 2 - ((labelLines.length - 1) * lineHeight) / 2 + 1;

  return labelLines
    .map((line, index) => {
      return `<text class="mermaid-presentation__node-text" x="${centerX}" y="${
        firstLineY + index * lineHeight
      }" text-anchor="middle" dominant-baseline="central" fill="${textColor}">${escapeXml(
        line,
      )}</text>`;
    })
    .join("");
}

function renderEdgeLabel({
  background,
  border,
  color,
  text,
  x,
  y,
}: {
  background: string;
  border: string;
  color: string;
  text: string;
  x: number;
  y: number;
}) {
  const normalizedText = normalizeLabel(text);
  const width = Math.max(54, normalizedText.length * 7.4 + 16);
  const left = x - width / 2;
  const top = y - 10;

  return [
    `<rect x="${left}" y="${top}" width="${width}" height="20" rx="4" fill="${background}" stroke="${border}" stroke-width="0.8" />`,
    `<text class="mermaid-presentation__edge-text" x="${x}" y="${y + 1}" text-anchor="middle" dominant-baseline="central" fill="${color}">${escapeXml(
      normalizedText,
    )}</text>`,
  ].join("");
}

function normalizeStageLabel(label: string, stageOrder: number): string {
  const normalized = normalizeLabel(label)
    .replace(/^["']|["']$/g, "")
    .trim();

  if (!normalized) {
    return `PHASE ${stageOrder + 1}`;
  }

  return normalized;
}

function normalizeLabel(value: string): string {
  let normalized = value.trim();

  while (true) {
    const next = unwrap(normalized);
    if (next === normalized) {
      break;
    }
    normalized = next.trim();
  }

  return normalized
    .replace(/<br\s*\/?>/gi, " / ")
    .replace(/\s+/g, " ")
    .trim();
}

function unwrap(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  if (
    (value.startsWith("(") && value.endsWith(")")) ||
    (value.startsWith("[") && value.endsWith("]")) ||
    (value.startsWith("{") && value.endsWith("}"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function wrapWords(
  text: string,
  maxCharactersPerLine: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return ["Node"];
  }

  const lines: string[] = [];
  let currentLine = "";
  let wordIndex = 0;

  while (wordIndex < words.length && lines.length < maxLines) {
    const nextLine = currentLine
      ? `${currentLine} ${words[wordIndex]}`
      : words[wordIndex];

    if (currentLine && nextLine.length > maxCharactersPerLine) {
      lines.push(currentLine);
      currentLine = "";
      continue;
    }

    currentLine = nextLine;
    wordIndex += 1;
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  if (wordIndex < words.length && lines.length > 0) {
    lines[lines.length - 1] =
      `${lines[lines.length - 1].replace(/[.,\s]+$/g, "")}...`;
  }

  return lines;
}

function buildStageColorPalette(palette: MermaidThemePalette) {
  return palette.chartColors.map((color) => {
    const accent = parseRgbColor(color);
    const background = parseRgbColor(palette.background);
    const foreground = parseRgbColor(palette.foreground);

    return {
      fill: rgbToString(mixRgb(background, accent, 0.44)),
      stroke: rgbToString(mixRgb(accent, foreground, 0.14)),
      text: rgbToString(mixRgb(foreground, accent, 0.08)),
    };
  });
}

function resolveNodeAppearance({
  canvasBackground,
  edgeColor,
  neutralAppearance,
  node,
  stageColorPalette,
  stageIndexById,
}: {
  canvasBackground: string;
  edgeColor: string;
  neutralAppearance: NodeAppearance;
  node: MermaidPresentationNode;
  stageColorPalette: NodeAppearance[];
  stageIndexById: Map<string, number>;
}): NodeAppearance {
  if (node.shape === "terminal" || node.stageId === null) {
    return neutralAppearance;
  }

  const stageIndex = stageIndexById.get(node.stageId);
  const stageAppearance =
    stageIndex !== undefined
      ? stageColorPalette[stageIndex % stageColorPalette.length]
      : neutralAppearance;

  if (node.shape === "decision") {
    return {
      fill: canvasBackground,
      stroke: stageAppearance.stroke || edgeColor,
      text: neutralAppearance.text,
    };
  }

  return stageAppearance ?? neutralAppearance;
}

function parseRgbColor(value: string): RgbColor {
  const trimmedValue = value.trim();

  if (trimmedValue.startsWith("#")) {
    const hex = trimmedValue.slice(1);
    const expanded =
      hex.length === 3
        ? hex
            .split("")
            .map((char) => `${char}${char}`)
            .join("")
        : hex;

    return {
      b: Number.parseInt(expanded.slice(4, 6), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      r: Number.parseInt(expanded.slice(0, 2), 16),
    };
  }

  const rgbMatch = trimmedValue.match(/^rgba?\((.+)\)$/i);
  if (!rgbMatch) {
    return { b: 0, g: 0, r: 0 };
  }

  const channels = rgbMatch[1]
    .split(",")
    .slice(0, 3)
    .map((channel) => Number.parseFloat(channel.trim()));

  return {
    b: Number.isFinite(channels[2]) ? channels[2] : 0,
    g: Number.isFinite(channels[1]) ? channels[1] : 0,
    r: Number.isFinite(channels[0]) ? channels[0] : 0,
  };
}

function mixRgb(
  base: RgbColor,
  target: RgbColor,
  targetWeight: number,
): RgbColor {
  const baseWeight = 1 - targetWeight;

  return {
    b: base.b * baseWeight + target.b * targetWeight,
    g: base.g * baseWeight + target.g * targetWeight,
    r: base.r * baseWeight + target.r * targetWeight,
  };
}

function rgbToString(color: RgbColor): string {
  return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
}

function humanizeIdentifier(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
