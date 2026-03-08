import { describe, expect, it } from "vitest";
import { ModelMessage } from "ai";

import {
  sanitizeModelMessagesForProvider,
  shouldSendToolDefinitionsToProvider,
} from "./provider-compatibility";

describe("provider-compatibility", () => {
  it("prunes stale snowflake tool history when the tool is no longer bound", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Find revenue numbers" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "web_search",
            input: { query: "ACME revenue" },
          },
          {
            type: "tool-approval-request",
            approvalId: "approval-1",
            toolCallId: "call-1",
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-approval-response",
            approvalId: "approval-1",
            approved: true,
          },
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "web_search",
            output: {
              type: "text",
              value: "ACME revenue was up 18%.",
            },
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Revenue increased 18%." }],
      },
    ];

    const result = sanitizeModelMessagesForProvider({
      provider: "snowflake",
      messages,
      tools: {},
    });

    expect(result.messages).toEqual([messages[0], messages[3]]);
    expect(result.removedMessages).toBe(2);
    expect(result.removedToolParts).toBe(4);
  });

  it("keeps active snowflake tool history when the tool is still available", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "web_search",
            input: { query: "ACME revenue" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "web_search",
            output: {
              type: "text",
              value: "ACME revenue was up 18%.",
            },
          },
        ],
      },
    ];

    const result = sanitizeModelMessagesForProvider({
      provider: "snowflake",
      messages,
      tools: {
        web_search: {
          description: "Search the web",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: true,
          },
        } as any,
      },
    });

    expect(result.messages).toEqual(messages);
    expect(result.removedMessages).toBe(0);
    expect(result.removedToolParts).toBe(0);
  });

  it("does not modify non-snowflake providers", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "web_search",
            input: { query: "ACME revenue" },
          },
        ],
      },
    ];

    const result = sanitizeModelMessagesForProvider({
      provider: "openai",
      messages,
      tools: {},
    });

    expect(result.messages).toBe(messages);
    expect(result.removedMessages).toBe(0);
    expect(result.removedToolParts).toBe(0);
  });

  it("omits empty snowflake tool definitions payloads", () => {
    expect(
      shouldSendToolDefinitionsToProvider({
        provider: "snowflake",
        tools: {},
      }),
    ).toBe(false);

    expect(
      shouldSendToolDefinitionsToProvider({
        provider: "snowflake",
        tools: {
          web_search: {
            description: "Search the web",
            inputSchema: {
              type: "object",
              properties: {},
            },
          } as any,
        },
      }),
    ).toBe(true);
  });
});
