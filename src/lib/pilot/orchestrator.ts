import type { Agent } from "app-types/agent";
import type { ChatMetadata, ChatModel } from "app-types/chat";
import type {
  PageField,
  PageForm,
  PageSnapshot,
  PilotActionProposal,
  PilotActionResult,
  PilotFieldCoverage,
  PilotRelevantFormContext,
  PilotTaskMode,
  PilotTaskState,
} from "app-types/pilot";
import type { UIMessage } from "ai";
import { truncateString } from "lib/utils";
import {
  createPilotActionProposal,
  isSensitiveField,
  validateProposalAgainstSnapshot,
} from "./browser-actions";

const FORM_FILL_TOKENS = [
  "fill",
  "form",
  "field",
  "complete",
  "populate",
  "enter",
  "input",
  "set",
  "type",
  "choose",
  "select",
  "check",
  "tick",
  "apply",
  "registration",
  "signup",
  "register",
  "checkout",
  "profile",
];

const EXPLAIN_TOKENS = [
  "explain",
  "meaning",
  "what is",
  "what does",
  "help me understand",
];

const ANALYZE_TOKENS = ["analyze", "inspect", "review", "look at", "summarize"];

const NAVIGATE_TOKENS = [
  "open",
  "go to",
  "navigate",
  "visit",
  "search",
  "find",
  "play",
];

const SUBMIT_ACTION_TOKENS = [
  "submit",
  "save",
  "update",
  "apply",
  "continue",
  "next",
  "confirm",
  "send",
  "finish",
  "search",
];

const CLARIFICATION_TOKENS = [
  "which",
  "what",
  "please share",
  "please provide",
  "i need",
  "missing",
  "tell me",
  "before i can fill",
  "before i continue",
];

function normalizeText(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

function getTokens(value?: string | null) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 2);
}

function countSharedTokens(a: string[], b: string[]) {
  const other = new Set(b);
  return a.reduce((count, token) => count + (other.has(token) ? 1 : 0), 0);
}

function messageText(message?: UIMessage | null) {
  if (!message) return "";
  return message.parts
    .filter(
      (
        part,
      ): part is Extract<
        UIMessage["parts"][number],
        { type: "text"; text: string }
      > => part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function fieldText(field: PageField) {
  return [field.label, field.name, field.placeholder, field.text, field.type]
    .filter(Boolean)
    .join(" ");
}

function fieldHasValue(field: PageField) {
  return Boolean(field.value?.trim()) || field.checked === true;
}

function isEditableField(field: PageField) {
  return !field.disabled && normalizeText(field.type) !== "hidden";
}

function buildCoverage(
  field: PageField,
  bucket: PilotFieldCoverage["bucket"],
  reason: string,
): PilotFieldCoverage {
  return {
    elementId: field.elementId,
    label: field.label,
    name: field.name,
    bucket,
    reason,
  };
}

function findFormByElementId(
  snapshot: PageSnapshot | undefined,
  elementId: string,
): PageForm | null {
  if (!snapshot) return null;
  for (const form of snapshot.forms) {
    if (form.fields.some((field) => field.elementId === elementId)) {
      return form;
    }
  }
  return null;
}

function scoreFormAgainstText(
  form: PageForm,
  queryTokens: string[],
  snapshot: PageSnapshot | undefined,
  previousState?: PilotTaskState,
) {
  let score = 0;

  if (previousState?.targetFormId === form.formId) {
    score += 240;
  }

  if (
    snapshot?.focusedElement?.elementId &&
    form.fields.some(
      (field) => field.elementId === snapshot.focusedElement?.elementId,
    )
  ) {
    score += 160;
  }

  const formTokens = getTokens(
    [form.label, form.action, form.method].join(" "),
  );
  score += countSharedTokens(formTokens, queryTokens) * 16;

  for (const field of form.fields) {
    const fieldTokens = getTokens(fieldText(field));
    score += Math.min(countSharedTokens(fieldTokens, queryTokens) * 10, 60);
  }

  if (form.fields.some((field) => field.required)) {
    score += 12;
  }

  return score;
}

function selectRelevantForm(input: {
  snapshot?: PageSnapshot;
  userText: string;
  previousState?: PilotTaskState;
  mode: PilotTaskMode;
}) {
  const forms = input.snapshot?.forms ?? [];
  if (!forms.length) {
    return null;
  }

  if (input.previousState?.targetFormId) {
    const previousMatch = forms.find(
      (form) => form.formId === input.previousState?.targetFormId,
    );
    if (previousMatch) {
      return {
        form: previousMatch,
        reason: "Continuing work on the previously targeted form.",
      };
    }
  }

  if (input.snapshot?.focusedElement?.elementId) {
    const focusedForm = findFormByElementId(
      input.snapshot,
      input.snapshot.focusedElement.elementId,
    );
    if (focusedForm) {
      return {
        form: focusedForm,
        reason: "Using the form around the currently focused field.",
      };
    }
  }

  const queryTokens = getTokens(input.userText);
  let bestForm = forms[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const form of forms) {
    const score = scoreFormAgainstText(
      form,
      queryTokens,
      input.snapshot,
      input.previousState,
    );

    if (score > bestScore) {
      bestForm = form;
      bestScore = score;
    }
  }

  if (bestScore <= 0 && forms.length > 1 && input.mode !== "fill") {
    return null;
  }

  return {
    form: bestForm,
    reason:
      bestScore > 0
        ? "Closest match based on the user request and page focus."
        : "Single available form on the page.",
  };
}

function buildLikelySubmitActions(
  snapshot: PageSnapshot | undefined,
  query: string,
) {
  const queryText = normalizeText(query);
  return (snapshot?.actionables ?? [])
    .filter((actionable) => {
      if (actionable.disabled) {
        return false;
      }
      const haystack = normalizeText(
        [actionable.label, actionable.text].filter(Boolean).join(" "),
      );
      return SUBMIT_ACTION_TOKENS.some(
        (token) => haystack.includes(token) || queryText.includes(token),
      );
    })
    .slice(0, 4)
    .map((actionable) => ({
      elementId: actionable.elementId,
      label: actionable.label,
      text: actionable.text,
    }));
}

export function getLatestPilotTaskState(messages: UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const metadata = messages[index]?.metadata as ChatMetadata | undefined;
    if (metadata?.pilotTaskState) {
      return metadata.pilotTaskState;
    }
  }
  return undefined;
}

export function getLatestPilotSelections(messages: UIMessage[]) {
  let agentId: string | undefined;
  let chatModel: ChatModel | undefined;
  let pilotTaskState: PilotTaskState | undefined;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const metadata = messages[index]?.metadata as ChatMetadata | undefined;
    if (!metadata) {
      continue;
    }

    if (!agentId && metadata.agentId) {
      agentId = metadata.agentId;
    }

    if (!chatModel && metadata.chatModel) {
      chatModel = metadata.chatModel;
    }

    if (!pilotTaskState && metadata.pilotTaskState) {
      pilotTaskState = metadata.pilotTaskState;
    }

    if (agentId && chatModel && pilotTaskState) {
      break;
    }
  }

  return {
    agentId,
    chatModel,
    pilotTaskState,
  };
}

export function resolvePilotTaskMode(input: {
  userText: string;
  previousState?: PilotTaskState;
  actionResults?: PilotActionResult[];
}) {
  const text = normalizeText(input.userText);

  if (input.actionResults?.length) {
    return "continue" as const;
  }

  if (
    input.previousState?.lastPhase === "awaiting_user_input" &&
    input.previousState.targetFieldIds.length
  ) {
    return "fill" as const;
  }

  if (NAVIGATE_TOKENS.some((token) => text.includes(token))) {
    return "navigate" as const;
  }

  if (FORM_FILL_TOKENS.some((token) => text.includes(token))) {
    return "fill" as const;
  }

  if (EXPLAIN_TOKENS.some((token) => text.includes(token))) {
    return "explain" as const;
  }

  if (ANALYZE_TOKENS.some((token) => text.includes(token))) {
    return "analyze" as const;
  }

  return input.previousState?.mode === "fill" ? "fill" : "analyze";
}

export function buildRelevantFormContext(input: {
  snapshot?: PageSnapshot;
  userText: string;
  previousState?: PilotTaskState;
  mode: PilotTaskMode;
}) {
  const selected = selectRelevantForm(input);
  if (!selected) {
    return undefined;
  }

  const queryTokens = getTokens(input.userText);
  const focusedElementId = input.snapshot?.focusedElement?.elementId;
  const genericFillRequest =
    input.mode === "fill" &&
    (!queryTokens.length ||
      FORM_FILL_TOKENS.some((token) =>
        normalizeText(input.userText).includes(token),
      ));

  const readyFields: PilotFieldCoverage[] = [];
  const missingFields: PilotFieldCoverage[] = [];
  const sensitiveFields: PilotFieldCoverage[] = [];
  const irrelevantFields: PilotFieldCoverage[] = [];
  const targetFieldIds: string[] = [];

  for (const field of selected.form.fields) {
    const tokens = getTokens(fieldText(field));
    const matchesQuery = countSharedTokens(tokens, queryTokens) > 0;
    const isFocused = focusedElementId === field.elementId;
    const wasTargeted =
      input.previousState?.targetFieldIds.includes(field.elementId) ?? false;
    const relevant =
      isEditableField(field) &&
      (genericFillRequest || matchesQuery || isFocused || wasTargeted);

    if (!relevant) {
      irrelevantFields.push(
        buildCoverage(
          field,
          "irrelevant",
          "Not clearly part of the current task.",
        ),
      );
      continue;
    }

    targetFieldIds.push(field.elementId);

    if (isSensitiveField(field)) {
      sensitiveFields.push(
        buildCoverage(
          field,
          "sensitive",
          "Sensitive field. Require explicit confirmation before filling.",
        ),
      );
      continue;
    }

    if (fieldHasValue(field)) {
      readyFields.push(
        buildCoverage(
          field,
          "ready",
          "Already has a value on the page or prior state.",
        ),
      );
      continue;
    }

    if (input.previousState?.collectedValues[field.elementId]) {
      readyFields.push(
        buildCoverage(
          field,
          "ready",
          "User already provided a value in the ongoing task state.",
        ),
      );
      continue;
    }

    missingFields.push(
      buildCoverage(
        field,
        "missing",
        field.required
          ? "Required field still needs a value."
          : "Likely needed for the requested form task.",
      ),
    );
  }

  return {
    formId: selected.form.formId,
    label: selected.form.label,
    reason: selected.reason,
    targetFieldIds,
    readyFields,
    missingFields,
    sensitiveFields,
    irrelevantFields,
    likelySubmitActions: buildLikelySubmitActions(
      input.snapshot,
      input.userText,
    ),
  } satisfies PilotRelevantFormContext;
}

export function buildPilotTaskState(input: {
  mode: PilotTaskMode;
  previousState?: PilotTaskState;
  relevantForm?: PilotRelevantFormContext;
  selectedAgent?: Agent | null;
  snapshot?: PageSnapshot;
  actionResults?: PilotActionResult[];
  autoContinuationCount?: number;
}) {
  const collectedValues = {
    ...(input.previousState?.collectedValues ?? {}),
  };

  const relevantForm = input.relevantForm;
  if (input.snapshot && relevantForm) {
    for (const form of input.snapshot.forms) {
      if (form.formId !== relevantForm.formId) {
        continue;
      }

      for (const field of form.fields) {
        if (field.value?.trim()) {
          collectedValues[field.elementId] = field.value;
        }
      }
    }
  }

  const targetFieldIds = relevantForm?.targetFieldIds.length
    ? relevantForm.targetFieldIds
    : (input.previousState?.targetFieldIds ?? []);
  const missingFieldIds =
    relevantForm?.missingFields.map((field) => field.elementId) ??
    input.previousState?.missingFieldIds ??
    [];

  let lastPhase: PilotTaskState["lastPhase"] = "analyzing";
  if (input.mode === "continue" && input.actionResults?.length) {
    lastPhase = "after_execution";
  } else if (input.mode === "fill" && missingFieldIds.length) {
    lastPhase = "awaiting_user_input";
  } else if (input.mode === "fill" && targetFieldIds.length) {
    lastPhase = "ready_to_fill";
  } else if (input.mode === "navigate") {
    lastPhase = "executing";
  } else if (!targetFieldIds.length && !missingFieldIds.length) {
    lastPhase = "completed";
  }

  return {
    mode: input.mode,
    targetFormId: relevantForm?.formId ?? input.previousState?.targetFormId,
    targetFieldIds,
    missingFieldIds,
    collectedValues,
    lastPhase,
    selectedAgentId:
      input.selectedAgent?.id ?? input.previousState?.selectedAgentId,
    relevantForm,
    autoContinuationCount:
      input.autoContinuationCount ?? input.previousState?.autoContinuationCount,
  } satisfies PilotTaskState;
}

function coverageLine(label: string, items: PilotFieldCoverage[]) {
  if (!items.length) {
    return `${label}: none`;
  }

  return `${label}: ${items
    .map((field) => field.label || field.name || field.elementId)
    .join(", ")}`;
}

export function summarizeRelevantFormForPrompt(
  relevantForm?: PilotRelevantFormContext,
) {
  if (!relevantForm) {
    return "No relevant form selected yet.";
  }

  return [
    `Form id: ${relevantForm.formId || "unknown"}`,
    `Form label: ${relevantForm.label || "unlabeled form"}`,
    `Why this form: ${relevantForm.reason || "best available match"}`,
    coverageLine("Ready fields", relevantForm.readyFields),
    coverageLine("Missing fields", relevantForm.missingFields),
    coverageLine("Sensitive fields", relevantForm.sensitiveFields),
    coverageLine(
      "Irrelevant fields",
      relevantForm.irrelevantFields.slice(0, 6),
    ),
    `Likely next controls: ${
      relevantForm.likelySubmitActions.length
        ? relevantForm.likelySubmitActions
            .map((action) => action.label || action.text || action.elementId)
            .join(", ")
        : "none"
    }`,
  ].join("\n");
}

function summarizePageSnapshot(snapshot?: PageSnapshot) {
  if (!snapshot) return "No page snapshot available.";

  const focused = snapshot.focusedElement
    ? `Focused element: ${JSON.stringify(snapshot.focusedElement)}`
    : "Focused element: none";

  const forms = snapshot.forms.slice(0, 6).map((form) => ({
    formId: form.formId,
    label: form.label,
    action: form.action,
    fields: form.fields.slice(0, 12),
  }));

  const actionables = snapshot.actionables.slice(0, 20);

  return JSON.stringify(
    {
      url: snapshot.url,
      title: snapshot.title,
      selectedText: snapshot.selectedText,
      visibleText: truncateString(snapshot.visibleText || "", 5000),
      forms,
      actionables,
      focused,
    },
    null,
    2,
  );
}

export function buildPilotBrokerPrompt(input: {
  tabUrl: string;
  tabTitle?: string;
  snapshot?: PageSnapshot;
  actionResults?: PilotActionResult[];
  relevantForm?: PilotRelevantFormContext;
  taskState?: PilotTaskState;
  mode: PilotTaskMode;
  selectedAgent?: Agent | null;
}) {
  const selectedAgent = input.selectedAgent
    ? [
        `Selected Emma agent for delegated reasoning: ${input.selectedAgent.name}`,
        input.selectedAgent.description
          ? `Agent description: ${input.selectedAgent.description}`
          : "",
        input.selectedAgent.instructions.role
          ? `Agent role: ${input.selectedAgent.instructions.role}`
          : "",
        input.selectedAgent.instructions.systemPrompt
          ? `Use the selected agent's tools, skills, subagents, and knowledge when deeper reasoning helps. Do not hand off browser control; all pilot_propose_* tool calls must still come from Emma Pilot broker.`
          : "Use the selected agent only for reasoning support when helpful. Keep browser control in the broker.",
      ]
        .filter(Boolean)
        .join("\n")
    : "No user-selected Emma agent is available for delegation in this turn.";

  return [
    "You are Emma Pilot broker, the built-in browser-task orchestrator on top of the Emma agent platform.",
    "Your primary job is to stay grounded in the active browser tab, analyze the current page state, decide the next best browser-aware step, and keep the workflow moving until you need user input or an approval boundary.",
    "Treat the browser tab as the main task context. Do not drift into a generic standalone chatbot response when the page already provides the working context.",
    "Classify every turn as one of: explain, analyze, fill, navigate, continue-after-action.",
    "Relevant-form-first: when the user asks to fill or work with a form, identify the closest relevant form and inspect the whole form before proposing actions.",
    "Do not stop after one field if the task clearly targets a multi-field form.",
    "If the user asks for content that belongs in page fields, prefer filling the relevant browser fields or asking for the missing values instead of returning detached answer options, unless the user explicitly asks for options or drafts only.",
    "If values are missing or ambiguous, ask one grouped checklist of the missing fields instead of asking one field per turn.",
    "Prefer one pilot_propose_fill_fields call for multiple related form inputs instead of many single-field proposals.",
    "Sensitive fields such as passwords, payment data, or secrets require explicit confirmation and must not be auto-filled automatically.",
    "You may delegate reasoning, interpretation, extraction, or planning to the selected Emma agent's available tools, knowledge, workflows, skills, or subagents only when that helps. Do not delegate browser control.",
    "Never pretend a browser action already happened. Use pilot_propose_* tools when you want the extension to act.",
    "After every answer, include a concise next-step statement.",
    `Current broker mode: ${input.mode}`,
    `Active tab URL: ${input.tabUrl}`,
    `Active tab title: ${input.tabTitle || ""}`,
    input.actionResults?.length
      ? `Recently executed browser actions: ${JSON.stringify(input.actionResults)}`
      : "",
    input.taskState
      ? `Current broker task state:\n${JSON.stringify(input.taskState, null, 2)}`
      : "",
    `Relevant form context:\n${summarizeRelevantFormForPrompt(input.relevantForm)}`,
    selectedAgent,
    `Current page snapshot:\n${summarizePageSnapshot(input.snapshot)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildPilotContinueInstruction(input: {
  taskState?: PilotTaskState;
  relevantForm?: PilotRelevantFormContext;
  actionResults?: PilotActionResult[];
}) {
  return [
    "Continue the current Emma Pilot browser task using the latest action results and page snapshot.",
    "Do not repeat completed actions.",
    input.actionResults?.length
      ? `Latest browser action results: ${JSON.stringify(input.actionResults)}`
      : "",
    input.taskState?.lastPhase
      ? `Current task phase: ${input.taskState.lastPhase}`
      : "",
    input.relevantForm
      ? `Relevant form summary:\n${summarizeRelevantFormForPrompt(
          input.relevantForm,
        )}`
      : "",
    "If more values are required, ask a grouped checklist. If safe next actions are obvious, propose them now. Stop only when you need user input, hit an approval boundary, or there is no useful next step.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function getClarificationSignal(text: string) {
  const normalized = normalizeText(text);
  return (
    normalized.includes("?") ||
    CLARIFICATION_TOKENS.some((token) => normalized.includes(token))
  );
}

function getFillFieldCount(proposal: PilotActionProposal) {
  if (proposal.kind === "fillFields") {
    return proposal.fields?.length ?? 0;
  }

  if (
    (proposal.kind === "setInputValue" || proposal.kind === "selectOption") &&
    proposal.elementId &&
    typeof proposal.value === "string"
  ) {
    return 1;
  }

  return 0;
}

export function shouldRetryForPilotCoverage(input: {
  mode: PilotTaskMode;
  text: string;
  proposals: PilotActionProposal[];
  relevantForm?: PilotRelevantFormContext;
}) {
  if (input.mode !== "fill" || !input.relevantForm) {
    return false;
  }

  const multiFieldTargetCount =
    input.relevantForm.readyFields.length +
    input.relevantForm.missingFields.length;
  if (multiFieldTargetCount < 2) {
    return false;
  }

  if (getClarificationSignal(input.text)) {
    return false;
  }

  if (
    input.proposals.some(
      (proposal) =>
        proposal.kind === "fillFields" && (proposal.fields?.length ?? 0) > 1,
    )
  ) {
    return false;
  }

  const actionableFillCount = input.proposals.reduce(
    (count, proposal) => count + getFillFieldCount(proposal),
    0,
  );

  return actionableFillCount <= 1;
}

export function mergePilotFillProposals(input: {
  proposals: PilotActionProposal[];
  snapshot?: PageSnapshot;
  relevantForm?: PilotRelevantFormContext;
}) {
  const passthrough: Array<{ order: number; proposal: PilotActionProposal }> =
    [];
  const grouped = new Map<
    string,
    {
      order: number;
      formLabel?: string;
      explanations: string[];
      fields: Map<string, string>;
      originalProposals: PilotActionProposal[];
    }
  >();

  input.proposals.forEach((proposal, order) => {
    const isFillLike =
      proposal.kind === "fillFields" ||
      proposal.kind === "setInputValue" ||
      proposal.kind === "selectOption";

    if (!isFillLike || proposal.requiresApproval || proposal.isSensitive) {
      passthrough.push({ order, proposal });
      return;
    }

    const normalizedFields =
      proposal.kind === "fillFields"
        ? (proposal.fields ?? [])
        : proposal.elementId && typeof proposal.value === "string"
          ? [{ elementId: proposal.elementId, value: proposal.value }]
          : [];

    if (!normalizedFields.length) {
      passthrough.push({ order, proposal });
      return;
    }

    const forms = normalizedFields
      .map((field) => findFormByElementId(input.snapshot, field.elementId))
      .filter((form): form is PageForm => Boolean(form));

    if (!forms.length) {
      passthrough.push({ order, proposal });
      return;
    }

    const formId = forms[0]?.formId;
    if (!formId || forms.some((form) => form.formId !== formId)) {
      passthrough.push({ order, proposal });
      return;
    }

    const bucket = grouped.get(formId) ?? {
      order,
      formLabel:
        input.relevantForm?.formId === formId
          ? input.relevantForm.label
          : forms[0]?.label,
      explanations: [],
      fields: new Map<string, string>(),
      originalProposals: [],
    };

    bucket.order = Math.min(bucket.order, order);
    bucket.explanations.push(proposal.explanation);
    bucket.originalProposals.push(proposal);

    normalizedFields.forEach((field) => {
      bucket.fields.set(field.elementId, field.value);
    });

    grouped.set(formId, bucket);
  });

  const merged = Array.from(grouped.values()).flatMap((group) => {
    if (group.fields.size <= 1) {
      return group.originalProposals.map((proposal) => ({
        order: group.order,
        proposal,
      }));
    }

    const mergedProposal = createPilotActionProposal({
      kind: "fillFields",
      label: `Fill ${group.fields.size} fields`,
      explanation:
        group.formLabel && group.formLabel.trim()
          ? `Fill the requested fields for ${group.formLabel}.`
          : "Fill the requested fields on the current form.",
      fields: Array.from(group.fields.entries()).map(([elementId, value]) => ({
        elementId,
        value,
      })),
      isSensitive: false,
      requiresApproval: false,
    });

    validateProposalAgainstSnapshot(mergedProposal, input.snapshot);

    return [
      {
        order: group.order,
        proposal: mergedProposal,
      },
    ];
  });

  return [...passthrough, ...merged]
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.proposal);
}

export function getLatestUserText(
  messages: UIMessage[],
  currentMessage?: UIMessage,
) {
  const candidateMessages = currentMessage
    ? [...messages, currentMessage]
    : messages;

  for (let index = candidateMessages.length - 1; index >= 0; index -= 1) {
    const message = candidateMessages[index];
    if (message?.role !== "user") {
      continue;
    }
    const text = messageText(message);
    if (text) {
      return text;
    }
  }
  return "";
}
