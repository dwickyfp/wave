import type { ChatMetadata, ChatModel } from "../../types/chat";
import type {
  PageField,
  PageForm,
  PageSnapshot,
  PilotActionResult,
  PilotFieldCoverage,
  PilotRelevantFormContext,
  PilotTaskMode,
  PilotTaskState,
  PilotElementRect,
} from "../../types/pilot";
import type { UIMessage } from "ai";

const SENSITIVE_FIELD_TOKENS = [
  "password",
  "passcode",
  "secret",
  "card",
  "credit",
  "cvv",
  "cvc",
  "security code",
  "iban",
  "routing",
  "account number",
  "ssn",
];

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

export function normalizePilotText(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

export function getPilotTokens(value?: string | null) {
  return normalizePilotText(value)
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 2);
}

export function countSharedTokens(a: string[], b: string[]) {
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

export function getPageFieldText(field: PageField) {
  return [field.label, field.name, field.placeholder, field.text, field.type]
    .filter(Boolean)
    .join(" ");
}

export function fieldHasValue(field: PageField) {
  return Boolean(field.value?.trim()) || field.checked === true;
}

export function isEditableField(field: PageField) {
  return !field.disabled && normalizePilotText(field.type) !== "hidden";
}

export function isSensitivePilotField(field?: Partial<PageField> | null) {
  if (!field) return false;

  const haystack = [
    field.type,
    field.label,
    field.name,
    field.placeholder,
    field.text,
  ]
    .map(normalizePilotText)
    .join(" ");

  return SENSITIVE_FIELD_TOKENS.some((token) => haystack.includes(token));
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

function getStandaloneFields(snapshot?: PageSnapshot) {
  return (snapshot?.standaloneFields ?? []).filter(isEditableField);
}

function getSnapshotFields(snapshot?: PageSnapshot) {
  const allFields = [
    ...(snapshot?.forms ?? []).flatMap((form) => form.fields),
    ...getStandaloneFields(snapshot),
  ];

  if (
    snapshot?.focusedElement?.elementId &&
    !allFields.some(
      (field) => field.elementId === snapshot.focusedElement?.elementId,
    )
  ) {
    allFields.push(snapshot.focusedElement);
  }

  return allFields;
}

export function findFormByElementId(
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

type RelevantFieldGroup = {
  formId?: string;
  label?: string;
  rect?: PilotElementRect;
  fields: PageField[];
  reason: string;
};

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

  const formTokens = getPilotTokens(
    [form.label, form.action, form.method].join(" "),
  );
  score += countSharedTokens(formTokens, queryTokens) * 16;

  for (const field of form.fields) {
    const fieldTokens = getPilotTokens(getPageFieldText(field));
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
}): RelevantFieldGroup | null {
  const forms = input.snapshot?.forms ?? [];
  if (!forms.length) {
    const standaloneFields = getStandaloneFields(input.snapshot);
    if (!standaloneFields.length) {
      return null;
    }

    const previousTargetedStandalone = standaloneFields.some((field) =>
      input.previousState?.targetFieldIds.includes(field.elementId),
    );
    if (previousTargetedStandalone) {
      return {
        label: "Current page fields",
        fields: standaloneFields,
        reason: "Continuing work on the previously targeted page fields.",
      };
    }

    const focusedStandalone = standaloneFields.find(
      (field) => field.elementId === input.snapshot?.focusedElement?.elementId,
    );
    if (focusedStandalone) {
      return {
        label: "Current page fields",
        rect: focusedStandalone.rect,
        fields: standaloneFields,
        reason: "Using the page fields around the currently focused input.",
      };
    }

    const queryTokens = getPilotTokens(input.userText);
    const standaloneScore = standaloneFields.reduce((score, field) => {
      const fieldTokens = getPilotTokens(getPageFieldText(field));
      return (
        score + Math.min(countSharedTokens(fieldTokens, queryTokens) * 10, 60)
      );
    }, 0);

    if (
      standaloneScore <= 0 &&
      input.mode !== "fill" &&
      standaloneFields.length > 1
    ) {
      return null;
    }

    return {
      label: "Current page fields",
      fields: standaloneFields,
      reason:
        standaloneScore > 0
          ? "Closest match based on the user request and visible page inputs."
          : "Only standalone page fields are available here.",
    };
  }

  if (input.previousState?.targetFormId) {
    const previousMatch = forms.find(
      (form) => form.formId === input.previousState?.targetFormId,
    );
    if (previousMatch) {
      return {
        formId: previousMatch.formId,
        label: previousMatch.label,
        rect: previousMatch.rect,
        fields: previousMatch.fields,
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
        formId: focusedForm.formId,
        label: focusedForm.label,
        rect: focusedForm.rect,
        fields: focusedForm.fields,
        reason: "Using the form around the currently focused field.",
      };
    }
  }

  const queryTokens = getPilotTokens(input.userText);
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
    formId: bestForm.formId,
    label: bestForm.label,
    rect: bestForm.rect,
    fields: bestForm.fields,
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
  const queryText = normalizePilotText(query);
  return (snapshot?.actionables ?? [])
    .filter((actionable) => {
      if (actionable.disabled) {
        return false;
      }
      const haystack = normalizePilotText(
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
  const text = normalizePilotText(input.userText);

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

  const queryTokens = getPilotTokens(input.userText);
  const focusedElementId = input.snapshot?.focusedElement?.elementId;
  const genericFillRequest =
    input.mode === "fill" &&
    (!queryTokens.length ||
      FORM_FILL_TOKENS.some((token) =>
        normalizePilotText(input.userText).includes(token),
      ));

  const readyFields: PilotFieldCoverage[] = [];
  const missingFields: PilotFieldCoverage[] = [];
  const sensitiveFields: PilotFieldCoverage[] = [];
  const irrelevantFields: PilotFieldCoverage[] = [];
  const targetFieldIds: string[] = [];

  for (const field of selected.fields) {
    const tokens = getPilotTokens(getPageFieldText(field));
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

    if (isSensitivePilotField(field)) {
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
    formId: selected.formId,
    label: selected.label,
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

function clampRectToViewport(
  rect: PilotElementRect,
  snapshot?: PageSnapshot,
): PilotElementRect | undefined {
  const viewport = snapshot?.viewport;
  if (!viewport) {
    return rect;
  }

  const x = Math.max(0, Math.min(rect.x, viewport.innerWidth));
  const y = Math.max(0, Math.min(rect.y, viewport.innerHeight));
  const right = Math.max(x, Math.min(rect.x + rect.width, viewport.innerWidth));
  const bottom = Math.max(
    y,
    Math.min(rect.y + rect.height, viewport.innerHeight),
  );

  if (right <= x || bottom <= y) {
    return undefined;
  }

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function expandRect(
  rect: PilotElementRect,
  snapshot?: PageSnapshot,
  padding = 24,
) {
  const expanded = {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  } satisfies PilotElementRect;

  return clampRectToViewport(expanded, snapshot);
}

export function getPilotVisualTargetRect(input: {
  snapshot?: PageSnapshot;
  userText: string;
  previousState?: PilotTaskState;
  mode: PilotTaskMode;
}) {
  if (!input.snapshot?.viewport) {
    return undefined;
  }

  const relevantForm = buildRelevantFormContext(input);
  if (relevantForm?.formId) {
    const form = input.snapshot.forms.find(
      (item) => item.formId === relevantForm.formId,
    );
    if (form?.rect) {
      return expandRect(form.rect, input.snapshot, 28);
    }
  }

  if (relevantForm?.targetFieldIds.length) {
    const relevantRects = getSnapshotFields(input.snapshot)
      .filter((field) => relevantForm.targetFieldIds.includes(field.elementId))
      .map((field) => field.rect)
      .filter((rect): rect is PilotElementRect => Boolean(rect));

    if (relevantRects.length) {
      const left = Math.min(...relevantRects.map((rect) => rect.x));
      const top = Math.min(...relevantRects.map((rect) => rect.y));
      const right = Math.max(
        ...relevantRects.map((rect) => rect.x + rect.width),
      );
      const bottom = Math.max(
        ...relevantRects.map((rect) => rect.y + rect.height),
      );

      return expandRect(
        {
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
        },
        input.snapshot,
        28,
      );
    }
  }

  if (input.snapshot.focusedElement?.rect) {
    return expandRect(input.snapshot.focusedElement.rect, input.snapshot, 56);
  }

  if (input.snapshot.forms.length === 1 && input.snapshot.forms[0]?.rect) {
    return expandRect(input.snapshot.forms[0].rect, input.snapshot, 28);
  }

  return undefined;
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
