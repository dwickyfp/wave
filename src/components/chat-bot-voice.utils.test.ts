import { describe, expect, it } from "vitest";
import { buildVoiceLatestTurnModel } from "./chat-bot-voice.utils";

describe("buildVoiceLatestTurnModel", () => {
  it("keeps only the latest user turn in the voice drawer model", () => {
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
        parts: [{ type: "text", text: "Preparing chart..." }],
      },
      {
        id: "assistant-3",
        role: "assistant",
        parts: [{ type: "text", text: "Here is the latest chart." }],
      },
    ] as any);

    expect(model.latestUserText).toBe("show me a line chart");
    expect(model.assistantSummaryText).toBe("Here is the latest chart.");
    expect(model.assistantMessages.map((message) => message.id)).toEqual([
      "assistant-2",
      "assistant-3",
    ]);
  });

  it("uses only the latest meaningful assistant text from the current turn", () => {
    const model = buildVoiceLatestTurnModel([
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "old request" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "old answer should stay hidden" }],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "buatkan chart" }],
      },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [{ type: "text", text: "Baik, saya proses." }],
      },
      {
        id: "assistant-3",
        role: "assistant",
        parts: [{ type: "text", text: "Ini line chart terbaru." }],
      },
    ] as any);

    expect(model.assistantSummaryText).toBe("Ini line chart terbaru.");
    expect(model.assistantSummaryText).not.toContain(
      "old answer should stay hidden",
    );
    expect(model.assistantSummaryText).not.toContain("Baik, saya proses.");
  });

  it("collects only current-turn artifact entries and keeps artifact order", () => {
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
          { type: "text", text: "Working on it." },
          {
            type: "tool-createLineChart",
            toolCallId: "chart-1",
            state: "output-available",
            input: { title: "Sales trend", data: [] },
            output: { ok: true },
          },
        ],
      },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [{ type: "text", text: "Done." }],
        metadata: {
          knowledgeImages: [
            {
              groupId: "group-1",
              groupName: "Docs",
              documentId: "doc-1",
              documentName: "Guide",
              imageId: "image-1",
              label: "Preview",
              description: "Image preview",
              assetUrl: "/image-1.png",
            },
          ],
        },
      },
    ] as any);

    expect(model.artifactEntries).toHaveLength(2);
    expect(model.artifactEntries[0]?.message.id).toBe("assistant-1");
    expect(model.artifactEntries[0]?.parts).toMatchObject([
      { type: "tool-createLineChart", toolCallId: "chart-1" },
    ]);
    expect(model.artifactEntries[1]?.message.id).toBe("assistant-2");
    expect(model.artifactEntries[1]?.knowledgeImages).toHaveLength(1);
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
