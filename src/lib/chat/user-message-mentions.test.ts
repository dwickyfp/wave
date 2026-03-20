import { describe, expect, it } from "vitest";

import { tokenizeUserMessageMentions } from "./user-message-mentions";

describe("tokenizeUserMessageMentions", () => {
  it("tokenizes supported chat mention syntaxes", () => {
    expect(
      tokenizeUserMessageMentions(
        '@agent("FinBot") kamu siapa? @mcp("Context7") cari docs @knowledge("Perpres Knowledge")siapa yang tanda tangan? @tool(\'web-search\')',
      ),
    ).toEqual([
      {
        type: "mention",
        mentionKind: "agent",
        value: "FinBot",
        raw: '@agent("FinBot")',
      },
      {
        type: "text",
        text: " kamu siapa? ",
      },
      {
        type: "mention",
        mentionKind: "mcp",
        value: "Context7",
        raw: '@mcp("Context7")',
      },
      {
        type: "text",
        text: " cari docs ",
      },
      {
        type: "mention",
        mentionKind: "knowledge",
        value: "Perpres Knowledge",
        raw: '@knowledge("Perpres Knowledge")',
      },
      {
        type: "text",
        text: "siapa yang tanda tangan? ",
      },
      {
        type: "mention",
        mentionKind: "tool",
        value: "web-search",
        raw: "@tool('web-search')",
      },
    ]);
  });

  it("returns a single text segment when there are no mentions", () => {
    expect(tokenizeUserMessageMentions("plain text only")).toEqual([
      {
        type: "text",
        text: "plain text only",
      },
    ]);
  });
});
