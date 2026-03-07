const CONTINUE_PROMPT_SOURCE_MAP = {
  coding: [
    "Anthropic/Claude Code 2.0.txt: prefer edits to existing files; avoid unnecessary file creation",
    "Amp/*.yaml: concise coding-agent mission and verification discipline",
    "VSCode Agent/*.txt: workspace-scoped execution, checkpoint cadence, and tool hygiene",
    "Cursor Prompts/Agent Prompt 2025-09-03.txt: delta progress updates and substantive task tracking",
    "Warp.dev/Prompt.txt and Windsurf/*: context gathering before edits and minimal-claim discipline",
    "Z.ai Code/prompt.txt: task tracking emphasis, adapted without proprietary todo tools",
  ],
  planning: [
    "Google/Antigravity/planning-mode.txt: planning/execution/verification framing",
    "Kiro/Spec_Prompt.txt: implementation-plan structure and risk/verification framing",
    "VSCode Agent/*.txt: concise task/checkpoint presentation",
  ],
  autocomplete: [
    "VSCode Agent/nes-tab-completion.txt: completion-only behavior",
    "Cursor and VSCode agent prompts: style matching and no extra narration",
  ],
} as const;

type ContinueMessageLike = {
  role: string;
  content?: unknown;
};

type ContinueCapabilityState = {
  knowledgeGroups?: string[];
  subAgents?: string[];
  skills?: string[];
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeContent(content: unknown) {
  if (typeof content === "string") return normalizeWhitespace(content);

  if (Array.isArray(content)) {
    return normalizeWhitespace(
      content
        .map((part) => {
          if (!part || typeof part !== "object") return "";
          const candidate = part as { type?: string; text?: string };
          return candidate.type === "text" ? (candidate.text ?? "") : "";
        })
        .join(" "),
    );
  }

  return "";
}

function getLatestUserText(messages: ContinueMessageLike[]) {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  return normalizeContent(latestUserMessage?.content);
}

function isExplicitPlanningRequest(text: string) {
  return /\b(plan|planning|design|architecture|break down|roadmap|todo|steps|implementation plan)\b/i.test(
    text,
  );
}

function isImplementationIntent(text: string) {
  return /\b(implement|build|fix|debug|refactor|edit|write|create|add|update|change|ship|code)\b/i.test(
    text,
  );
}

function isComplexCodingRequest(text: string) {
  const complexitySignals = [
    /\b(refactor|migrate|integrate|architecture|workflow|dashboard|analytics)\b/i,
    /\b(test|verify|validation|coverage|regression)\b/i,
    /\b(and|then|plus|also)\b/i,
    /\n\s*\d+\./,
  ];

  return (
    text.length >= 220 ||
    complexitySignals.filter((pattern) => pattern.test(text)).length >= 2
  );
}

export function isPlanOnlyContinueRequest(messages: ContinueMessageLike[]) {
  const latestUserText = getLatestUserText(messages);
  if (!latestUserText) return false;

  return (
    isExplicitPlanningRequest(latestUserText) &&
    !/\b(implement|build|code|fix|edit|apply|write the code)\b/i.test(
      latestUserText,
    )
  );
}

export function shouldUseContinuePlanningPrimer(
  messages: ContinueMessageLike[],
) {
  const latestUserText = getLatestUserText(messages);
  if (!latestUserText) return false;

  return (
    isExplicitPlanningRequest(latestUserText) ||
    (isImplementationIntent(latestUserText) &&
      isComplexCodingRequest(latestUserText))
  );
}

function buildCodingMission(agentName?: string) {
  const agentContext = agentName
    ? `You are acting as the Wave agent "${agentName}" in Continue coding mode.`
    : "You are operating as a Wave coding agent in Continue.";

  return [
    agentContext,
    "Focus on production-grade software work: understand the repo, make the smallest correct change, and verify before claiming success.",
    "Prefer editing existing files over creating new files. Do not invent file paths, APIs, tests, or project conventions.",
    "When you need local file inspection, terminal output, diffs, or edits, use the client-provided Continue tools instead of claiming direct workspace access.",
    "Do not say local files changed unless the client tool results confirm the change.",
  ].join(" ");
}

function buildCodingExecutionRules() {
  return [
    "Keep coding-mode responses structured and concise.",
    "For complex implementation asks, begin with short sections in this order: Objective, Plan, Tasks, Checks/Risks.",
    "If the request is implementation-oriented, continue execution after that compact plan in the same turn instead of stopping at planning.",
    "During longer runs, provide delta-style Progress updates rather than repeating the entire task list.",
    "Use task lists only for substantive engineering work. Do not create tasks for trivial operational chores like opening files or running one obvious command.",
    "Before finishing, validate the change with the strongest available evidence from tool output, tests, or explicit limitations.",
    "If blocked, end with Next gaps instead of pretending the change is complete.",
  ].join(" ");
}

function buildPlanOnlyRules() {
  return [
    "The user is asking for planning only.",
    "Do not implement or claim changes.",
    "Return sections in this order: Objective, Plan, Tasks, Checks/Risks, Validation.",
    "Keep the plan concrete, file-aware, and scoped to the current repository context.",
  ].join(" ");
}

function buildPlanningPrimerRules() {
  return [
    "This request is complex enough to benefit from a planning-first response.",
    "Start with Objective, Plan, Tasks, and Checks/Risks before execution, then continue with the work unless the user asked for planning only.",
  ].join(" ");
}

export function buildContinueAgentSystemMessage(agentName?: string) {
  return [buildCodingMission(agentName), buildCodingExecutionRules()].join(
    "\n\n",
  );
}

export function buildContinuePlanSystemMessage(agentName?: string) {
  const agentContext = agentName
    ? `You are planning work for the Wave agent "${agentName}".`
    : "You are planning work for a Wave coding agent.";

  return [
    agentContext,
    "Use Continue Plan mode as a read-only planning workspace.",
    "Investigate enough repository context to produce a realistic implementation plan without making edits.",
    "Return sections in this order: Objective, Plan, Tasks, Checks/Risks, Validation.",
    "Tasks should be substantive implementation steps, not low-level tool actions.",
    "Call out uncertainties, dependencies, migration/testing implications, and any user decisions that materially affect the implementation.",
  ].join("\n\n");
}

export function buildContinueAutocompleteSystemMessage(agentName?: string) {
  const agentContext = agentName
    ? `You are generating inline code completions for the Wave agent "${agentName}".`
    : "You are generating inline code completions for a Wave coding agent.";

  return [
    agentContext,
    "Return only the raw code continuation. No markdown, no explanation, no surrounding quotes, and no conversational filler.",
    "Match the surrounding file's style, indentation, naming, and imports.",
    "Prefer short, useful continuations that compose cleanly with the provided suffix when present.",
  ].join("\n\n");
}

function formatCapabilityList(values: string[]) {
  return values.map((value) => `"${value}"`).join(", ");
}

function buildCapabilityAvailabilityRules(
  capabilityState?: ContinueCapabilityState,
) {
  if (!capabilityState) return [];

  const prompts: string[] = [];

  if (capabilityState.knowledgeGroups?.length) {
    prompts.push(
      `Attached Wave knowledge tools are available for ${formatCapabilityList(
        capabilityState.knowledgeGroups,
      )}. Use them for repository/domain lookup and documentation retrieval.`,
    );
  }

  if (capabilityState.subAgents?.length) {
    prompts.push(
      `Attached Wave subagents are available: ${formatCapabilityList(
        capabilityState.subAgents,
      )}. Delegate specialized work to them when useful.`,
    );
  }

  if (capabilityState.skills?.length) {
    prompts.push(
      `Attached Wave skills are available through the load_skill tool: ${formatCapabilityList(
        capabilityState.skills,
      )}. Load the relevant skill before following its workflow.`,
    );
  }

  return prompts;
}

export function buildContinueRoutePrompt(options: {
  codingMode: boolean;
  agentName?: string;
  messages: ContinueMessageLike[];
  clientOwnsWorkspaceTools?: boolean;
  capabilityState?: ContinueCapabilityState;
}) {
  const prompts: string[] = [];

  if (!options.codingMode) {
    if (options.clientOwnsWorkspaceTools) {
      prompts.push(
        "When local workspace inspection or edits are needed, use the client-provided tools instead of claiming direct file access.",
      );
      prompts.push(
        "Do not say you changed local files unless the client tool results confirm the change.",
      );
    }

    prompts.push(...buildCapabilityAvailabilityRules(options.capabilityState));
    return prompts;
  }

  prompts.push(buildContinueAgentSystemMessage(options.agentName));

  if (isPlanOnlyContinueRequest(options.messages)) {
    prompts.push(buildPlanOnlyRules());
  } else if (shouldUseContinuePlanningPrimer(options.messages)) {
    prompts.push(buildPlanningPrimerRules());
  }

  if (options.clientOwnsWorkspaceTools) {
    prompts.push(
      "Continue owns workspace reads, edits, diffs, and terminal actions. Ask the client tools for those operations rather than inventing local state.",
    );
  }

  prompts.push(...buildCapabilityAvailabilityRules(options.capabilityState));
  return prompts;
}

export function buildContinuePromptSourceMap() {
  return [
    ...CONTINUE_PROMPT_SOURCE_MAP.coding,
    ...CONTINUE_PROMPT_SOURCE_MAP.planning,
    ...CONTINUE_PROMPT_SOURCE_MAP.autocomplete,
  ];
}
