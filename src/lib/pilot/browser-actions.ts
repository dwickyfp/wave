import type {
  PageField,
  PageSnapshot,
  PilotActionKind,
  PilotActionProposal,
  PilotActionResult,
} from "app-types/pilot";
import { generateUUID } from "lib/utils";

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

const CRITICAL_ACTION_TOKENS = [
  "save",
  "submit",
  "delete",
  "remove",
  "update",
  "confirm",
  "apply",
  "purchase",
  "pay",
  "checkout",
  "place order",
  "book",
  "send",
];

function normalizeText(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

function hasCriticalActionText(...values: Array<string | null | undefined>) {
  const haystack = values.map(normalizeText).join(" ");
  return CRITICAL_ACTION_TOKENS.some((token) => haystack.includes(token));
}

export function isSensitiveField(field?: Partial<PageField> | null) {
  if (!field) return false;

  const haystack = [
    field.type,
    field.label,
    field.name,
    field.placeholder,
    field.text,
  ]
    .map(normalizeText)
    .join(" ");

  return SENSITIVE_FIELD_TOKENS.some((token) => haystack.includes(token));
}

export function findFieldByElementId(
  snapshot: PageSnapshot | undefined,
  elementId: string | undefined,
) {
  if (!snapshot || !elementId) return null;

  for (const form of snapshot.forms) {
    const match = form.fields.find((field) => field.elementId === elementId);
    if (match) return match;
  }

  if (snapshot.focusedElement?.elementId === elementId) {
    return snapshot.focusedElement;
  }

  return null;
}

export function createPilotActionProposal(input: {
  kind: PilotActionKind;
  label: string;
  explanation: string;
  elementId?: string;
  url?: string;
  value?: string;
  checked?: boolean;
  fields?: PilotActionProposal["fields"];
  isSensitive?: boolean;
  requiresApproval?: boolean;
}): PilotActionProposal {
  const requiresApproval =
    input.requiresApproval ??
    input.isSensitive ??
    (input.kind === "clickElement" &&
      hasCriticalActionText(input.label, input.explanation));

  return {
    id: generateUUID(),
    kind: input.kind,
    label: input.label,
    explanation: input.explanation,
    elementId: input.elementId,
    url: input.url,
    value: input.value,
    checked: input.checked,
    fields: input.fields,
    requiresApproval,
    isSensitive: input.isSensitive ?? false,
    createdAt: new Date().toISOString(),
  };
}

export function validateProposalAgainstSnapshot(
  proposal: PilotActionProposal,
  snapshot?: PageSnapshot,
) {
  if (!snapshot) {
    throw new Error("Page snapshot is required for browser actions.");
  }

  if (
    proposal.elementId &&
    !findFieldByElementId(snapshot, proposal.elementId)
  ) {
    const actionableMatch = snapshot.actionables.find(
      (item) => item.elementId === proposal.elementId,
    );
    if (!actionableMatch) {
      throw new Error(
        "Browser action references an element that is not present.",
      );
    }
  }

  if (proposal.fields?.length) {
    for (const field of proposal.fields) {
      const existingField = findFieldByElementId(snapshot, field.elementId);
      if (!existingField) {
        throw new Error("Form fill proposal references an unknown field.");
      }
    }
  }

  if (proposal.kind === "navigate" && !proposal.url) {
    throw new Error("Navigate proposal is missing a URL.");
  }
}

export function summarizeActionResults(results: PilotActionResult[] = []) {
  if (!results.length) return undefined;
  return results
    .map((result) => `${result.status}: ${result.summary}`)
    .join(" | ")
    .slice(0, 500);
}
