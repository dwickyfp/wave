import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  consumePilotUIMessageStream,
  getToolName,
  isToolUIPart,
} from "./pilot-ui-message";

function createSseResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  const payload = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .concat("data: [DONE]\n\n")
    .join("");

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(payload));
        controller.close();
      },
    }),
  );
}

describe("pilot ui message helpers", () => {
  it("detects tool parts without ai runtime helpers", () => {
    expect(
      isToolUIPart({
        type: "tool-pilot_propose_fill_fields",
        toolCallId: "tool-1",
      }),
    ).toBe(true);
    expect(
      getToolName({
        type: "tool-pilot_propose_fill_fields",
        toolCallId: "tool-1",
      }),
    ).toBe("pilot_propose_fill_fields");
    expect(
      getToolName({
        type: "dynamic-tool",
        toolName: "pilot_propose_fill_fields",
        toolCallId: "tool-1",
      }),
    ).toBe("pilot_propose_fill_fields");
  });

  it("streams assistant messages from SSE without ai runtime parsing", async () => {
    const response = createSseResponse([
      {
        type: "start",
        messageId: "assistant-1",
      },
      {
        type: "reasoning-start",
        id: "reasoning-1",
      },
      {
        type: "reasoning-delta",
        id: "reasoning-1",
        delta: "Thinking",
      },
      {
        type: "reasoning-end",
        id: "reasoning-1",
      },
      {
        type: "text-start",
        id: "text-1",
      },
      {
        type: "text-delta",
        id: "text-1",
        delta: "Hello Emma",
      },
      {
        type: "text-end",
        id: "text-1",
      },
      {
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "pilot_propose_fill_fields",
        input: {
          fields: [{ elementId: "field-1", value: "Emma" }],
        },
      },
      {
        type: "tool-output-available",
        toolCallId: "tool-1",
        output: {
          id: "proposal-1",
          kind: "fillFields",
          label: "Fill field",
          explanation: "Fill the field.",
        },
      },
    ]);

    const streamedMessages: UIMessage[] = [];
    const finalMessage = await consumePilotUIMessageStream({
      response,
      onMessage: (message) => {
        streamedMessages.push(message);
      },
    });

    expect(streamedMessages.length).toBeGreaterThan(1);
    expect(finalMessage?.id).toBe("assistant-1");
    expect(finalMessage?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "reasoning",
          text: "Thinking",
        }),
        expect.objectContaining({
          type: "text",
          text: "Hello Emma",
        }),
        expect.objectContaining({
          type: "tool-pilot_propose_fill_fields",
          toolCallId: "tool-1",
          state: "output-available",
        }),
      ]),
    );
  });
});
