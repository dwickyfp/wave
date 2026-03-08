import { describe, expect, it } from "vitest";
import type { PageSnapshot } from "app-types/pilot";
import { createPilotActionProposal } from "./browser-actions";
import {
  buildPilotBrokerPrompt,
  buildPilotTaskState,
  buildRelevantFormContext,
  mergePilotFillProposals,
  resolvePilotTaskMode,
  shouldRetryForPilotCoverage,
} from "./orchestrator";

const snapshot: PageSnapshot = {
  url: "https://example.com/apply",
  title: "Apply",
  visibleText: "Registration and newsletter forms",
  focusedElement: {
    elementId: "reg-email",
    tagName: "input",
    type: "email",
    label: "Email address",
    name: "email",
    value: "",
    required: true,
  },
  forms: [
    {
      formId: "registration-form",
      label: "Registration",
      action: "/register",
      method: "post",
      fields: [
        {
          elementId: "reg-name",
          tagName: "input",
          type: "text",
          label: "Full name",
          name: "full_name",
          value: "",
          required: true,
        },
        {
          elementId: "reg-email",
          tagName: "input",
          type: "email",
          label: "Email address",
          name: "email",
          value: "",
          required: true,
        },
        {
          elementId: "reg-password",
          tagName: "input",
          type: "password",
          label: "Password",
          name: "password",
          value: "",
          required: true,
        },
      ],
    },
    {
      formId: "newsletter-form",
      label: "Newsletter",
      action: "/newsletter",
      method: "post",
      fields: [
        {
          elementId: "news-email",
          tagName: "input",
          type: "email",
          label: "Newsletter email",
          name: "newsletter_email",
          value: "",
          required: true,
        },
      ],
    },
  ],
  standaloneFields: [],
  actionables: [
    {
      elementId: "register-submit",
      role: "button",
      label: "Create account",
      text: "Create account",
    },
    {
      elementId: "newsletter-submit",
      role: "button",
      label: "Subscribe",
      text: "Subscribe",
    },
  ],
};

describe("pilot orchestrator helpers", () => {
  it("prefers the focused form when multiple forms are present", () => {
    const relevantForm = buildRelevantFormContext({
      snapshot,
      userText: "fill this form for me",
      mode: "fill",
    });

    expect(relevantForm?.formId).toBe("registration-form");
    expect(relevantForm?.targetFieldIds).toContain("reg-name");
    expect(relevantForm?.missingFields.map((field) => field.elementId)).toEqual(
      expect.arrayContaining(["reg-name", "reg-email"]),
    );
    expect(
      relevantForm?.sensitiveFields.map((field) => field.elementId),
    ).toContain("reg-password");
  });

  it("matches a form by user text when focus is not enough", () => {
    const alternateSnapshot = {
      ...snapshot,
      focusedElement: undefined,
    } satisfies PageSnapshot;

    const relevantForm = buildRelevantFormContext({
      snapshot: alternateSnapshot,
      userText: "subscribe this email to the newsletter",
      mode: "fill",
    });

    expect(relevantForm?.formId).toBe("newsletter-form");
    expect(relevantForm?.targetFieldIds).toEqual(["news-email"]);
  });

  it("builds awaiting-user-input state for multi-field form tasks", () => {
    const relevantForm = buildRelevantFormContext({
      snapshot,
      userText: "fill the registration form",
      mode: "fill",
    });

    const taskState = buildPilotTaskState({
      mode: "fill",
      relevantForm,
      snapshot,
      selectedAgent: {
        id: "agent-1",
        name: "Form Helper",
        userId: "user-1",
        visibility: "private",
        createdAt: new Date(),
        updatedAt: new Date(),
        instructions: {},
      },
    });

    expect(taskState.targetFormId).toBe("registration-form");
    expect(taskState.lastPhase).toBe("awaiting_user_input");
    expect(taskState.missingFieldIds).toEqual(
      expect.arrayContaining(["reg-name", "reg-email"]),
    );
    expect(taskState.selectedAgentId).toBe("agent-1");
  });

  it("merges multiple fill-like proposals into one fillFields proposal", () => {
    const proposals = mergePilotFillProposals({
      snapshot,
      relevantForm: buildRelevantFormContext({
        snapshot,
        userText: "fill the registration form",
        mode: "fill",
      }),
      proposals: [
        createPilotActionProposal({
          kind: "setInputValue",
          label: "Full name",
          explanation: "Fill the name.",
          elementId: "reg-name",
          value: "Emma User",
          isSensitive: false,
        }),
        createPilotActionProposal({
          kind: "setInputValue",
          label: "Email address",
          explanation: "Fill the email.",
          elementId: "reg-email",
          value: "emma@example.com",
          isSensitive: false,
        }),
      ],
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.kind).toBe("fillFields");
    expect(proposals[0]?.fields).toEqual(
      expect.arrayContaining([
        { elementId: "reg-name", value: "Emma User" },
        { elementId: "reg-email", value: "emma@example.com" },
      ]),
    );
  });

  it("keeps sensitive proposals out of safe fill merging", () => {
    const proposals = mergePilotFillProposals({
      snapshot,
      relevantForm: buildRelevantFormContext({
        snapshot,
        userText: "fill the registration form",
        mode: "fill",
      }),
      proposals: [
        createPilotActionProposal({
          kind: "setInputValue",
          label: "Full name",
          explanation: "Fill the name.",
          elementId: "reg-name",
          value: "Emma User",
          isSensitive: false,
        }),
        createPilotActionProposal({
          kind: "setInputValue",
          label: "Password",
          explanation: "Fill the password.",
          elementId: "reg-password",
          value: "secret",
          isSensitive: true,
        }),
      ],
    });

    expect(proposals).toHaveLength(2);
    expect(proposals.some((proposal) => proposal.kind === "fillFields")).toBe(
      false,
    );
  });

  it("retries when a multi-field fill task only proposes one field", () => {
    const relevantForm = buildRelevantFormContext({
      snapshot,
      userText: "fill the registration form",
      mode: "fill",
    });

    expect(
      shouldRetryForPilotCoverage({
        mode: "fill",
        text: "I filled the first field and can continue after that.",
        proposals: [
          createPilotActionProposal({
            kind: "setInputValue",
            label: "Full name",
            explanation: "Fill the name.",
            elementId: "reg-name",
            value: "Emma User",
            isSensitive: false,
          }),
        ],
        relevantForm,
      }),
    ).toBe(true);
  });

  it("does not retry when the broker asks grouped clarification", () => {
    const relevantForm = buildRelevantFormContext({
      snapshot,
      userText: "fill the registration form",
      mode: "fill",
    });

    expect(
      shouldRetryForPilotCoverage({
        mode: "fill",
        text: "I can fill this form, but I still need your full name and email address before I continue. Which values should I use?",
        proposals: [],
        relevantForm,
      }),
    ).toBe(false);
  });

  it("classifies continuation mode from executed actions", () => {
    expect(
      resolvePilotTaskMode({
        userText: "continue",
        actionResults: [
          {
            proposalId: "proposal-1",
            status: "succeeded",
            summary: "Filled the name field.",
          },
        ],
      }),
    ).toBe("continue");
  });

  it("includes protected-action guardrails in the broker prompt", () => {
    const prompt = buildPilotBrokerPrompt({
      tabUrl: snapshot.url,
      tabTitle: snapshot.title,
      snapshot,
      mode: "fill",
    });

    expect(prompt).toContain("delete, save, update, and commit");
    expect(prompt).toContain(
      "Do not propose them unless the user explicitly asked",
    );
  });
});
