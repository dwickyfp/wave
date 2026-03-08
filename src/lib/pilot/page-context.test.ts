import { describe, expect, it } from "vitest";
import type { PageSnapshot, PilotTaskState } from "../../types/pilot";
import {
  buildRelevantFormContext,
  getPilotVisualTargetRect,
  resolvePilotTaskMode,
} from "./page-context";

const snapshot: PageSnapshot = {
  url: "https://example.com/apply",
  title: "Apply",
  visibleText: "Registration and newsletter forms",
  viewport: {
    innerWidth: 1280,
    innerHeight: 720,
    scrollX: 0,
    scrollY: 0,
    devicePixelRatio: 2,
  },
  focusedElement: {
    elementId: "reg-email",
    tagName: "input",
    type: "email",
    label: "Email address",
    name: "email",
    value: "",
    required: true,
    rect: {
      x: 280,
      y: 210,
      width: 360,
      height: 44,
    },
  },
  forms: [
    {
      formId: "registration-form",
      label: "Registration",
      action: "/register",
      method: "post",
      rect: {
        x: 220,
        y: 120,
        width: 520,
        height: 360,
      },
      fields: [
        {
          elementId: "reg-name",
          tagName: "input",
          type: "text",
          label: "Full name",
          name: "full_name",
          value: "",
          required: true,
          rect: {
            x: 280,
            y: 150,
            width: 360,
            height: 44,
          },
        },
        {
          elementId: "reg-email",
          tagName: "input",
          type: "email",
          label: "Email address",
          name: "email",
          value: "",
          required: true,
          rect: {
            x: 280,
            y: 210,
            width: 360,
            height: 44,
          },
        },
        {
          elementId: "reg-password",
          tagName: "input",
          type: "password",
          label: "Password",
          name: "password",
          value: "",
          required: true,
          rect: {
            x: 280,
            y: 270,
            width: 360,
            height: 44,
          },
        },
      ],
    },
    {
      formId: "newsletter-form",
      label: "Newsletter",
      action: "/newsletter",
      method: "post",
      rect: {
        x: 820,
        y: 160,
        width: 280,
        height: 200,
      },
      fields: [
        {
          elementId: "news-email",
          tagName: "input",
          type: "email",
          label: "Newsletter email",
          name: "newsletter_email",
          value: "",
          required: true,
          rect: {
            x: 860,
            y: 210,
            width: 180,
            height: 44,
          },
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
      rect: {
        x: 520,
        y: 410,
        width: 140,
        height: 40,
      },
    },
  ],
  sensitiveFieldRects: [
    {
      elementId: "reg-password",
      label: "Password",
      rect: {
        x: 280,
        y: 270,
        width: 360,
        height: 44,
      },
    },
  ],
};

const standaloneSnapshot: PageSnapshot = {
  url: "https://example.com/agent",
  title: "Create agent",
  visibleText: "Agent name, description, and instructions",
  viewport: {
    innerWidth: 1280,
    innerHeight: 720,
    scrollX: 0,
    scrollY: 0,
    devicePixelRatio: 2,
  },
  focusedElement: {
    elementId: "agent-name",
    tagName: "input",
    type: "text",
    label: "Name",
    name: "name",
    value: "",
    rect: {
      x: 220,
      y: 140,
      width: 360,
      height: 44,
    },
  },
  forms: [],
  standaloneFields: [
    {
      elementId: "agent-name",
      tagName: "input",
      type: "text",
      label: "Name",
      name: "name",
      value: "",
      rect: {
        x: 220,
        y: 140,
        width: 360,
        height: 44,
      },
    },
    {
      elementId: "agent-description",
      tagName: "textarea",
      type: "textarea",
      label: "Description",
      name: "description",
      value: "",
      rect: {
        x: 220,
        y: 204,
        width: 520,
        height: 160,
      },
    },
  ],
  actionables: [
    {
      elementId: "agent-save",
      role: "button",
      label: "Save agent",
      text: "Save",
      rect: {
        x: 640,
        y: 392,
        width: 120,
        height: 40,
      },
    },
  ],
  sensitiveFieldRects: [],
};

describe("pilot page context", () => {
  it("selects the focused or relevant form for fill tasks", () => {
    const relevantForm = buildRelevantFormContext({
      snapshot,
      userText: "fill this form for me",
      mode: "fill",
    });

    expect(relevantForm?.formId).toBe("registration-form");
    expect(relevantForm?.targetFieldIds).toEqual(
      expect.arrayContaining(["reg-name", "reg-email", "reg-password"]),
    );
  });

  it("resolves the proper task mode for ongoing fill continuations", () => {
    const previousState: PilotTaskState = {
      mode: "fill",
      targetFieldIds: ["reg-name"],
      missingFieldIds: ["reg-name"],
      collectedValues: {},
      lastPhase: "awaiting_user_input",
    };

    expect(
      resolvePilotTaskMode({
        userText: "Emma User",
        previousState,
      }),
    ).toBe("fill");
  });

  it("returns a padded crop target around the relevant form", () => {
    const rect = getPilotVisualTargetRect({
      snapshot,
      userText: "fill this form for me",
      mode: "fill",
    });

    expect(rect).toEqual({
      x: 192,
      y: 92,
      width: 576,
      height: 416,
    });
  });

  it("builds relevant context for standalone page fields outside a form", () => {
    const relevantForm = buildRelevantFormContext({
      snapshot: standaloneSnapshot,
      userText: "fill the agent name and description",
      mode: "fill",
    });

    expect(relevantForm?.formId).toBeUndefined();
    expect(relevantForm?.targetFieldIds).toEqual(
      expect.arrayContaining(["agent-name", "agent-description"]),
    );

    const rect = getPilotVisualTargetRect({
      snapshot: standaloneSnapshot,
      userText: "fill the agent name and description",
      mode: "fill",
    });

    expect(rect).toEqual({
      x: 192,
      y: 112,
      width: 576,
      height: 280,
    });
  });
});
