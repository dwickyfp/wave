import type { Tool } from "ai";
import { z } from "zod";
import { DefaultToolName, ImageToolName } from "lib/ai/tools";

export type VoiceToolMetadata = {
  toolName: string;
  source:
    | "mcp"
    | "workflow"
    | "app-default"
    | "knowledge"
    | "skill"
    | "subagent";
  voiceSafe: boolean;
  spokenLabel: string;
  fillerKey:
    | "search"
    | "lookup"
    | "workflow"
    | "knowledge"
    | "code"
    | "visualization"
    | "tool";
  maxSpokenSummaryChars: number;
  preferSilentExecution: boolean;
};

export type VoiceFillerStage = "ack" | "progress" | "long-progress";

export type VoiceRealtimeToolDefinition = VoiceToolMetadata & {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

type ToolSourceBuckets = {
  mcpTools?: Record<string, Tool>;
  workflowTools?: Record<string, Tool>;
  appDefaultTools?: Record<string, Tool>;
  knowledgeTools?: Record<string, Tool>;
  skillTools?: Record<string, Tool>;
  subagentTools?: Record<string, Tool>;
};

function toOpenAiParameters(inputSchema: Tool["inputSchema"]) {
  if (!inputSchema) {
    return {
      type: "object",
      properties: {},
      additionalProperties: false,
    };
  }

  if (
    typeof inputSchema === "object" &&
    inputSchema !== null &&
    "jsonSchema" in inputSchema
  ) {
    const schema = (inputSchema as unknown as { jsonSchema?: unknown })
      .jsonSchema;
    return {
      type: "object",
      properties: {},
      additionalProperties: false,
      ...(schema &&
      typeof schema === "object" &&
      !("then" in (schema as Record<string, unknown>))
        ? (schema as Record<string, unknown>)
        : {}),
    };
  }

  if ("~standard" in (inputSchema as object)) {
    const schema = z.toJSONSchema(inputSchema as z.ZodTypeAny);
    return {
      type: "object",
      properties: {},
      additionalProperties: false,
      ...(schema as Record<string, unknown>),
    };
  }

  return {
    type: "object",
    properties: {},
    additionalProperties: false,
  };
}

function formatToolLabel(toolName: string) {
  return toolName
    .replace(/^tool-/, "")
    .replace(/^tool_/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactSpokenLabel(label: string) {
  return label.replace(/\s+/g, " ").trim().slice(0, 40).trim();
}

function hashVoiceSeed(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function pickVariant(variants: readonly string[], seed: string) {
  if (variants.length === 0) {
    return "";
  }

  return variants[hashVoiceSeed(seed) % variants.length] ?? variants[0] ?? "";
}

function buildFillerVariantMap(spokenLabel: string) {
  const label = compactSpokenLabel(spokenLabel) || "that";

  return {
    search: {
      ack: ["Let me check that.", "Checking that now."],
      progress: ["I'm still checking that.", "Pulling that together now."],
      "long-progress": [
        "This is taking a little longer, but I'm still on it.",
        "Still checking that now.",
      ],
    },
    lookup: {
      ack: [`Checking ${label}.`, `Let me look up ${label}.`],
      progress: [`I'm still checking ${label}.`, `Pulling up ${label} now.`],
      "long-progress": [
        `This is taking a moment, but I'm still checking ${label}.`,
        `Still working through ${label} now.`,
      ],
    },
    workflow: {
      ack: [`Running ${label}.`, `Starting ${label} now.`],
      progress: [
        `I'm still running ${label}.`,
        `Working through ${label} now.`,
      ],
      "long-progress": [
        `This is taking a bit longer, but ${label} is still running.`,
        `Still working through ${label}.`,
      ],
    },
    knowledge: {
      ack: ["Let me pull that up.", "Checking that now."],
      progress: ["I'm still pulling that up.", "Looking through that now."],
      "long-progress": [
        "This is taking a little longer, but I'm still checking.",
        "Still working through that now.",
      ],
    },
    code: {
      ack: ["Working through that now.", "Let me run through that."],
      progress: ["I'm still working through that.", "Still running that now."],
      "long-progress": [
        "This is taking a bit longer, but I'm still on it.",
        "Still working through that now.",
      ],
    },
    visualization: {
      ack: ["Putting that on screen now.", "Setting that up now."],
      progress: ["I'm still setting that up.", "Still putting that on screen."],
      "long-progress": [
        "This is taking a moment, but I'm still setting it up.",
        "Still working on that visual now.",
      ],
    },
    tool: {
      ack: ["One moment while I do that.", "Working on that now."],
      progress: ["I'm still working on that.", "Still on that now."],
      "long-progress": [
        "This is taking a bit longer, but I'm still on it.",
        "Still working on that now.",
      ],
    },
  } as const;
}

function buildVoiceToolMetadata(
  source: VoiceToolMetadata["source"],
  toolName: string,
): VoiceToolMetadata {
  const spokenLabel = formatToolLabel(toolName);

  if (source === "workflow") {
    return {
      toolName,
      source,
      voiceSafe: true,
      spokenLabel,
      fillerKey: "workflow",
      maxSpokenSummaryChars: 220,
      preferSilentExecution: false,
    };
  }

  if (source === "knowledge") {
    return {
      toolName,
      source,
      voiceSafe: true,
      spokenLabel,
      fillerKey: "knowledge",
      maxSpokenSummaryChars: 220,
      preferSilentExecution: false,
    };
  }

  if (
    toolName === DefaultToolName.JavascriptExecution ||
    toolName === DefaultToolName.PythonExecution
  ) {
    return {
      toolName,
      source,
      voiceSafe: true,
      spokenLabel,
      fillerKey: "code",
      maxSpokenSummaryChars: 160,
      preferSilentExecution: true,
    };
  }

  if (
    toolName === DefaultToolName.CreateBarChart ||
    toolName === DefaultToolName.CreateLineChart ||
    toolName === DefaultToolName.CreatePieChart ||
    toolName === DefaultToolName.CreateTable ||
    toolName === ImageToolName
  ) {
    return {
      toolName,
      source,
      voiceSafe: true,
      spokenLabel,
      fillerKey: "visualization",
      maxSpokenSummaryChars: 160,
      preferSilentExecution: true,
    };
  }

  if (toolName === DefaultToolName.WebSearch) {
    return {
      toolName,
      source,
      voiceSafe: true,
      spokenLabel,
      fillerKey: "search",
      maxSpokenSummaryChars: 220,
      preferSilentExecution: false,
    };
  }

  if (
    toolName === DefaultToolName.WebContent ||
    toolName === DefaultToolName.Http
  ) {
    return {
      toolName,
      source,
      voiceSafe: true,
      spokenLabel,
      fillerKey: "lookup",
      maxSpokenSummaryChars: 220,
      preferSilentExecution: false,
    };
  }

  if (source === "subagent" || source === "skill") {
    return {
      toolName,
      source,
      voiceSafe: true,
      spokenLabel,
      fillerKey: "tool",
      maxSpokenSummaryChars: 180,
      preferSilentExecution: true,
    };
  }

  return {
    toolName,
    source,
    voiceSafe: true,
    spokenLabel,
    fillerKey: source === "mcp" ? "lookup" : "tool",
    maxSpokenSummaryChars: 220,
    preferSilentExecution: false,
  };
}

function toToolEntries(
  source: VoiceToolMetadata["source"],
  tools: Record<string, Tool> | undefined,
) {
  return Object.entries(tools ?? {}).map(([toolName, tool]) => {
    const metadata = buildVoiceToolMetadata(source, toolName);

    return {
      type: "function" as const,
      name: toolName,
      description: tool.description ?? metadata.spokenLabel,
      parameters: toOpenAiParameters(tool.inputSchema),
      ...metadata,
    };
  });
}

export function buildVoiceRealtimeToolDefinitions(sources: ToolSourceBuckets) {
  return [
    ...toToolEntries("mcp", sources.mcpTools),
    ...toToolEntries("workflow", sources.workflowTools),
    ...toToolEntries("app-default", sources.appDefaultTools),
    ...toToolEntries("knowledge", sources.knowledgeTools),
    ...toToolEntries("skill", sources.skillTools),
    ...toToolEntries("subagent", sources.subagentTools),
  ];
}

export function pickVoiceFillerLine(
  metadata: Pick<VoiceToolMetadata, "fillerKey" | "spokenLabel">,
  options?: {
    stage?: VoiceFillerStage;
    seed?: string;
  },
) {
  const stage = options?.stage ?? "ack";
  const seed = options?.seed ?? metadata.spokenLabel;
  const variants = buildFillerVariantMap(metadata.spokenLabel)[
    metadata.fillerKey
  ][stage];
  return pickVariant(variants, `${metadata.fillerKey}:${stage}:${seed}`);
}

export function buildVoiceFillerInstructions(
  metadata: Pick<VoiceToolMetadata, "fillerKey" | "spokenLabel">,
  options?: {
    stage?: VoiceFillerStage;
    seed?: string;
  },
) {
  return `Say exactly: ${pickVoiceFillerLine(metadata, options)}`;
}

function compactText(text: string, maxChars: number) {
  return text.replace(/\s+/g, " ").trim().slice(0, maxChars).trim();
}

export function buildVoiceToolResumeInstructions(input: {
  ok: boolean;
  spokenSummary?: string | null;
  tool?: Pick<
    VoiceToolMetadata,
    "spokenLabel" | "preferSilentExecution"
  > | null;
}) {
  if (!input.ok) {
    return "Continue the live voice call naturally. Briefly explain that the requested action failed and offer one practical next step.";
  }

  const summaryHint =
    typeof input.spokenSummary === "string" && input.spokenSummary.trim()
      ? `Prefer this spoken summary when accurate: "${compactText(input.spokenSummary, 180)}".`
      : "";

  if (input.tool?.preferSilentExecution) {
    return `Continue the live voice call naturally. Do not repeat the earlier progress line. Confirm completion in one short sentence, and mention that details are on screen when helpful. ${summaryHint}`.trim();
  }

  return `Continue the live voice call naturally. Do not repeat the earlier progress line. Lead with the result in one or two short spoken sentences. ${summaryHint}`.trim();
}

export function summarizeToolOutputForVoice(input: {
  output: unknown;
  metadata: VoiceToolMetadata;
}) {
  const { output, metadata } = input;

  if (metadata.preferSilentExecution) {
    return null;
  }

  if (typeof output === "string") {
    return compactText(output, metadata.maxSpokenSummaryChars);
  }

  if (!output || typeof output !== "object") {
    return null;
  }

  const record = output as Record<string, unknown>;

  if (record.isError) {
    return compactText(
      String(record.error ?? record.statusMessage ?? "The tool failed."),
      metadata.maxSpokenSummaryChars,
    );
  }

  for (const key of ["spokenSummary", "summary", "answer", "message", "text"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return compactText(value, metadata.maxSpokenSummaryChars);
    }
  }

  if (Array.isArray(record.results)) {
    return `I found ${record.results.length} result${
      record.results.length === 1 ? "" : "s"
    }.`;
  }

  if (Array.isArray(record.urls)) {
    return `I checked ${record.urls.length} item${
      record.urls.length === 1 ? "" : "s"
    }.`;
  }

  if (typeof record.status === "number") {
    return `The request finished with status ${record.status}.`;
  }

  if (typeof record.status === "string" && record.status) {
    return compactText(
      `${metadata.spokenLabel} finished with status ${record.status}.`,
      metadata.maxSpokenSummaryChars,
    );
  }

  return null;
}
