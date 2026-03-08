import { describe, expect, it } from "vitest";
import {
  createPilotActionProposal,
  findFieldByElementId,
  isSensitiveField,
  summarizeActionResults,
  validateProposalAgainstSnapshot,
} from "./browser-actions";

const snapshot = {
  url: "https://example.com/form",
  title: "Checkout",
  visibleText: "Checkout form",
  forms: [
    {
      formId: "form-1",
      label: "Checkout",
      action: "/submit",
      method: "post",
      fields: [
        {
          elementId: "field-email",
          tagName: "input",
          type: "email",
          label: "Email",
          name: "email",
          value: "",
        },
        {
          elementId: "field-card",
          tagName: "input",
          type: "text",
          label: "Card number",
          name: "card_number",
          value: "",
        },
      ],
    },
  ],
  actionables: [
    {
      elementId: "button-submit",
      role: "button" as const,
      label: "Submit order",
      text: "Submit",
    },
  ],
};

describe("pilot browser actions", () => {
  it("detects sensitive fields from labels and names", () => {
    expect(
      isSensitiveField({
        label: "Card number",
        name: "credit_card",
      }),
    ).toBe(true);
    expect(
      isSensitiveField({
        label: "Email",
        name: "email",
      }),
    ).toBe(false);
  });

  it("finds fields by stable element id", () => {
    expect(findFieldByElementId(snapshot, "field-email")?.label).toBe("Email");
    expect(findFieldByElementId(snapshot, "missing-field")).toBeNull();
  });

  it("validates known proposals and rejects missing elements", () => {
    const validProposal = createPilotActionProposal({
      kind: "fillFields",
      label: "Fill 1 field",
      explanation: "Populate the email field.",
      fields: [
        {
          elementId: "field-email",
          value: "emma@example.com",
        },
      ],
    });

    expect(() =>
      validateProposalAgainstSnapshot(validProposal, snapshot),
    ).not.toThrow();

    const invalidProposal = createPilotActionProposal({
      kind: "clickElement",
      label: "Click missing button",
      explanation: "Try to click a missing control.",
      elementId: "missing-button",
    });

    expect(() =>
      validateProposalAgainstSnapshot(invalidProposal, snapshot),
    ).toThrow("Browser action references an element that is not present.");
  });

  it("only requires approval for sensitive or critical proposals", () => {
    const safeFill = createPilotActionProposal({
      kind: "fillFields",
      label: "Fill 1 field",
      explanation: "Populate the email field.",
      fields: [
        {
          elementId: "field-email",
          value: "emma@example.com",
        },
      ],
      isSensitive: false,
    });

    const criticalClick = createPilotActionProposal({
      kind: "clickElement",
      label: "Submit order",
      explanation: "Click the submit button to save the checkout form.",
      elementId: "button-submit",
    });

    const sensitiveFill = createPilotActionProposal({
      kind: "setInputValue",
      label: "Card number",
      explanation: "Populate the saved card number.",
      elementId: "field-card",
      value: "4111111111111111",
      isSensitive: true,
    });

    expect(safeFill.requiresApproval).toBe(false);
    expect(criticalClick.requiresApproval).toBe(true);
    expect(sensitiveFill.requiresApproval).toBe(true);
  });

  it("summarizes executed action results", () => {
    expect(
      summarizeActionResults([
        {
          proposalId: "proposal-1",
          status: "succeeded",
          summary: "Filled the email field.",
        },
        {
          proposalId: "proposal-2",
          status: "failed",
          summary: "Submit button was disabled.",
        },
      ]),
    ).toBe(
      "succeeded: Filled the email field. | failed: Submit button was disabled.",
    );
  });
});
