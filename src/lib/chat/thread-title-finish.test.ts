import { describe, expect, it } from "vitest";
import { resolveThreadTitleFinishAction } from "./thread-title-finish";

describe("resolveThreadTitleFinishAction", () => {
  it("generates a title prompt for a new untitled thread", () => {
    const action = resolveThreadTitleFinishAction({
      threadId: "thread-1",
      threadList: [],
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "buatkan chart penjualan bulanan" }],
        },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "Baik, saya siapkan chart-nya." }],
        },
      ] as any,
    });

    expect(action).toEqual({
      type: "generate",
      prompt:
        "user: buatkan chart penjualan bulanan\n\nassistant: Baik, saya siapkan chart-nya.",
    });
  });

  it("refreshes the thread list for existing threads that are not leading", () => {
    const action = resolveThreadTitleFinishAction({
      threadId: "thread-2",
      threadList: [
        { id: "thread-1", title: "Current thread" },
        { id: "thread-2", title: "Older thread" },
      ],
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "lanjutkan" }],
        },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "Tentu." }],
        },
        {
          id: "user-2",
          role: "user",
          parts: [{ type: "text", text: "buat summary" }],
        },
      ] as any,
    });

    expect(action).toEqual({ type: "refresh-list" });
  });

  it("still generates a title for the first turn when tool loops add extra assistant messages", () => {
    const action = resolveThreadTitleFinishAction({
      threadId: "thread-1",
      threadList: [],
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "buat line chart penjualan" }],
        },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "tool-createLineChart",
              toolCallId: "tool-1",
              state: "output-available",
              input: { title: "Sales", data: [] },
              output: { ok: true },
            },
          ],
        },
        {
          id: "assistant-2",
          role: "assistant",
          parts: [{ type: "text", text: "Ini line chart penjualannya." }],
        },
      ] as any,
    });

    expect(action).toEqual({
      type: "generate",
      prompt:
        "user: buat line chart penjualan\n\nassistant: Ini line chart penjualannya.",
    });
  });

  it("does nothing when a new thread has no usable text for title generation", () => {
    const action = resolveThreadTitleFinishAction({
      threadId: "thread-1",
      threadList: [],
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "file", url: "/report.csv", mediaType: "text/csv" }],
        },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "reasoning", text: "thinking" }],
        },
      ] as any,
    });

    expect(action).toEqual({ type: "none" });
  });
});
