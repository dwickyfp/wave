import { describe, expect, it } from "vitest";
import {
  buildVoiceLatestTurnModel,
  extractMarkdownTableBlocks,
} from "./chat-bot-voice.utils";

describe("buildVoiceLatestTurnModel", () => {
  it("keeps only the latest turn and exposes the prompt as floating text", () => {
    const model = buildVoiceLatestTurnModel([
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "old request" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "old answer" }],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "show me a line chart" }],
      },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [{ type: "text", text: "Here is the latest chart." }],
      },
    ] as any);

    expect(model.floatingPromptText).toBe("show me a line chart");
    expect(model.hiddenAssistantText).toBe("Here is the latest chart.");
    expect(model.assistantMessages.map((message) => message.id)).toEqual([
      "assistant-2",
    ]);
  });

  it("promotes markdown tables while keeping prose hidden from the center stage", () => {
    const model = buildVoiceLatestTurnModel([
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "show sales table" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: [
              "Berikut datanya.",
              "",
              "| Bulan | Nilai |",
              "| --- | --- |",
              "| Jan | 10 |",
              "| Feb | 20 |",
            ].join("\n"),
          },
        ],
      },
    ] as any);

    expect(model.hiddenAssistantText).toContain("Berikut datanya.");
    expect(model.presentableArtifacts).toEqual([
      {
        kind: "markdown-table",
        id: "assistant-1-markdown-table-0-0",
        messageId: "assistant-1",
        markdown: [
          "| Bulan | Nilai |",
          "| --- | --- |",
          "| Jan | 10 |",
          "| Feb | 20 |",
        ].join("\n"),
      },
    ]);
  });

  it("keeps only current-turn presentable tool outputs in the center stage", () => {
    const model = buildVoiceLatestTurnModel([
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "create visuals" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-createLineChart",
            toolCallId: "chart-1",
            state: "output-available",
            input: { title: "Sales trend", data: [] },
            output: { ok: true },
          },
          {
            type: "tool-pythonExecution",
            toolCallId: "tool-2",
            state: "output-available",
            input: { code: "print('hi')" },
            output: { text: "hi" },
          },
        ],
      },
    ] as any);

    expect(model.presentableArtifacts).toHaveLength(1);
    expect(model.presentableArtifacts[0]).toMatchObject({
      kind: "tool",
      messageId: "assistant-1",
    });
  });

  it("shows no center artifact for prose-only assistant replies", () => {
    const model = buildVoiceLatestTurnModel([
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "what happened" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Semua berjalan dengan baik." }],
      },
    ] as any);

    expect(model.hiddenAssistantText).toBe("Semua berjalan dengan baik.");
    expect(model.presentableArtifacts).toEqual([]);
  });

  it("tracks only running current-turn tools for the status row", () => {
    const model = buildVoiceLatestTurnModel([
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "run tools" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-pythonExecution",
            toolCallId: "tool-1",
            state: "input-available",
            input: { code: "print('hi')" },
          },
          {
            type: "tool-createTable",
            toolCallId: "tool-2",
            state: "output-available",
            input: { title: "Table", columns: [], data: [] },
            output: { ok: true },
          },
        ],
      },
    ] as any);

    expect(model.runningToolStates).toEqual([
      {
        id: "tool-1",
        name: "pythonExecution",
        state: "input-available",
        messageId: "assistant-1",
      },
    ]);
  });
});

describe("extractMarkdownTableBlocks", () => {
  it("extracts only markdown tables and skips fenced code blocks", () => {
    const blocks = extractMarkdownTableBlocks(
      [
        "Intro",
        "",
        "| Nama | Nilai |",
        "| --- | --- |",
        "| A | 1 |",
        "",
        "```md",
        "| fake | table |",
        "| --- | --- |",
        "```",
      ].join("\n"),
    );

    expect(blocks).toEqual([
      ["| Nama | Nilai |", "| --- | --- |", "| A | 1 |"].join("\n"),
    ]);
  });
});
