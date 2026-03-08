import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  extractPilotProposalsFromMessage,
  getStableStreamItemKey,
  getToolStateLabel,
  upsertStreamedMessage,
  withStableMessageId,
} from "./pilot-message-helpers";

describe("pilot message helpers", () => {
  it("extracts pilot proposals from streamed tool parts", () => {
    const message = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool-pilot_propose_fill_fields",
          toolCallId: "tool-1",
          state: "output-available",
          input: {
            fields: [
              { elementId: "field-name", value: "Emma User" },
              { elementId: "field-email", value: "emma@example.com" },
            ],
          },
          output: {
            id: "proposal-1",
            kind: "fillFields",
            label: "Fill 2 fields",
            explanation: "Fill the form fields.",
            fields: [
              { elementId: "field-name", value: "Emma User" },
              { elementId: "field-email", value: "emma@example.com" },
            ],
            requiresApproval: false,
          },
        },
      ],
    } satisfies UIMessage;

    expect(extractPilotProposalsFromMessage(message)).toEqual([
      {
        id: "proposal-1",
        kind: "fillFields",
        label: "Fill 2 fields",
        explanation: "Fill the form fields.",
        fields: [
          { elementId: "field-name", value: "Emma User" },
          { elementId: "field-email", value: "emma@example.com" },
        ],
        requiresApproval: false,
      },
    ]);
  });

  it("upserts streamed assistant messages by id", () => {
    const firstPass = {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "Hello" }],
    } satisfies UIMessage;
    const secondPass = {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "Hello world" }],
    } satisfies UIMessage;

    expect(upsertStreamedMessage([], firstPass)).toEqual([firstPass]);
    expect(upsertStreamedMessage([firstPass], secondPass)).toEqual([
      secondPass,
    ]);
  });

  it("summarizes tool execution states for rendering", () => {
    expect(
      getToolStateLabel({
        type: "tool-example",
        toolCallId: "tool-1",
        state: "input-streaming",
      } as any),
    ).toBe("Preparing");
    expect(
      getToolStateLabel({
        type: "tool-example",
        toolCallId: "tool-1",
        state: "output-available",
        output: "ok",
      } as any),
    ).toBe("Done");
  });

  it("builds a stable fallback key when the streamed key is empty", () => {
    expect(
      getStableStreamItemKey({
        messageId: "assistant-1",
        preferredKey: "",
        fallbackLabel: "pilot_propose_click",
        index: 2,
      }),
    ).toBe("assistant-1-pilot_propose_click-2");

    expect(
      getStableStreamItemKey({
        messageId: "",
        preferredKey: "tool-1",
        fallbackLabel: "pilot_propose_click",
        index: 2,
      }),
    ).toBe("tool-1");
  });

  it("pins a streamed message to a stable client id when the stream omits one", () => {
    const message = withStableMessageId(
      {
        id: "",
        role: "assistant",
        parts: [{ type: "text", text: "Streaming reply" }],
      } satisfies UIMessage,
      "stream-message-1",
    );

    expect(message.id).toBe("stream-message-1");
  });
});
