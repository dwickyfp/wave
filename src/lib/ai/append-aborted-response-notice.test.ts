import { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  ABORTED_RESPONSE_NOTICE,
  appendAbortedResponseNotice,
} from "./append-aborted-response-notice";

describe("appendAbortedResponseNotice", () => {
  it("appends the stop notice to the last assistant text part", () => {
    const message = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "Partial answer",
          state: "streaming",
        },
      ],
    } as UIMessage;

    const result = appendAbortedResponseNotice(message);

    expect(result.parts).toEqual([
      {
        type: "text",
        text: `Partial answer\n\n${ABORTED_RESPONSE_NOTICE}`,
        state: "done",
      },
    ]);
  });

  it("adds a trailing text part when a tool part is the last actionable part", () => {
    const message = {
      id: "assistant-2",
      role: "assistant",
      parts: [
        {
          type: "tool-webSearch",
          toolCallId: "tool-1",
          state: "input-streaming",
          input: { query: "chat cancel ux" },
        },
      ],
    } as UIMessage;

    const result = appendAbortedResponseNotice(message);

    expect(result.parts.at(-1)).toEqual({
      type: "text",
      text: ABORTED_RESPONSE_NOTICE,
      state: "done",
    });
  });

  it("does not duplicate the stop notice", () => {
    const message = {
      id: "assistant-3",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: `Partial answer\n\n${ABORTED_RESPONSE_NOTICE}`,
          state: "done",
        },
      ],
    } as UIMessage;

    const result = appendAbortedResponseNotice(message);

    expect(result.parts).toEqual(message.parts);
  });
});
