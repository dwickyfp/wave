import { describe, expect, it } from "vitest";

import {
  buildEffectiveContextHistory,
  buildTurnBundles,
  estimateChatContextTokens,
  estimatePromptTokens,
  getResponseBudgetTokens,
  getSummaryBudgetTokens,
  selectDynamicTailMessages,
} from "./context-window";

describe("context-window", () => {
  it("estimates tokens from thread context metadata and draft text", () => {
    const baseTokens = estimateChatContextTokens({
      extraContext: "Summarize answers in bullet points.",
      mentions: [
        {
          type: "knowledge",
          name: "Finance Docs",
          knowledgeId: "kn-1",
          description: "Annual reports",
          icon: null,
        },
      ],
      messages: [
        {
          id: "m-1",
          role: "user",
          parts: [{ type: "text", text: "What changed in revenue last year?" }],
        },
        {
          id: "m-2",
          role: "assistant",
          parts: [
            {
              type: "tool-get_report",
              input: { company: "ACME" },
              output: { revenue: "up 18 percent year over year" },
            },
          ],
        },
      ] as any,
      uploadedFiles: [
        {
          isUploading: false,
          mimeType: "application/pdf",
          name: "annual-report.pdf",
          size: 120_000,
        },
      ],
    });

    const totalTokens =
      baseTokens + estimatePromptTokens("Give me a short summary.");

    expect(baseTokens).toBeGreaterThan(0);
    expect(totalTokens).toBeGreaterThan(baseTokens);
  });

  it("does not overcount inline binary urls", () => {
    const tokens = estimateChatContextTokens({
      messages: [
        {
          id: "m-1",
          role: "user",
          parts: [
            {
              type: "file",
              filename: "chart.png",
              mediaType: "image/png",
              url: "data:image/png;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            },
          ],
        },
      ] as any,
    });

    expect(tokens).toBeLessThan(30);
  });

  it("returns zero for empty prompt text", () => {
    expect(estimatePromptTokens("   ")).toBe(0);
  });

  it("builds turn bundles from user turns and following assistant messages", () => {
    const bundles = buildTurnBundles([
      {
        id: "m-1",
        role: "assistant",
        parts: [{ type: "text", text: "orphan assistant intro" }],
      },
      {
        id: "m-2",
        role: "user",
        parts: [{ type: "text", text: "first question" }],
      },
      {
        id: "m-3",
        role: "assistant",
        parts: [{ type: "text", text: "first answer" }],
      },
      {
        id: "m-4",
        role: "user",
        parts: [{ type: "text", text: "second question" }],
      },
    ] as any);

    expect(bundles).toHaveLength(3);
    expect(bundles[0].messages).toHaveLength(1);
    expect(bundles[1].messages).toHaveLength(2);
    expect(bundles[2].messages).toHaveLength(1);
  });

  it("keeps only the newest contiguous bundles that fit the dynamic tail budget", () => {
    const selection = selectDynamicTailMessages({
      messages: [
        {
          id: "m-1",
          role: "user",
          parts: [{ type: "text", text: "a".repeat(500) }],
        },
        {
          id: "m-2",
          role: "assistant",
          parts: [{ type: "text", text: "b".repeat(500) }],
        },
        {
          id: "m-3",
          role: "user",
          parts: [{ type: "text", text: "c".repeat(200) }],
        },
        {
          id: "m-4",
          role: "assistant",
          parts: [{ type: "text", text: "d".repeat(200) }],
        },
      ] as any,
      contextLength: 2_200,
      fixedOverheadTokens: 120,
      responseBudgetTokens: getResponseBudgetTokens(2_200),
      summaryBudgetTokens: getSummaryBudgetTokens(2_200),
    });

    expect(selection.retainedMessages.map((message) => message.id)).toEqual([
      "m-3",
      "m-4",
    ]);
    expect(selection.compactableMessages.map((message) => message.id)).toEqual([
      "m-1",
      "m-2",
    ]);
  });

  it("supports a lower retained-history ceiling than the full context window", () => {
    const selection = selectDynamicTailMessages({
      messages: [
        {
          id: "m-1",
          role: "user",
          parts: [{ type: "text", text: "a".repeat(40_000) }],
        },
        {
          id: "m-2",
          role: "user",
          parts: [{ type: "text", text: "b".repeat(40_000) }],
        },
        {
          id: "m-3",
          role: "user",
          parts: [{ type: "text", text: "c".repeat(40_000) }],
        },
        {
          id: "m-4",
          role: "user",
          parts: [{ type: "text", text: "d".repeat(40_000) }],
        },
      ] as any,
      contextLength: 50_000,
      maxPromptTokens: 27_500,
      fixedOverheadTokens: 0,
      responseBudgetTokens: getResponseBudgetTokens(50_000),
      summaryBudgetTokens: getSummaryBudgetTokens(50_000),
    });

    expect(selection.retainedMessages.map((message) => message.id)).toEqual([
      "m-3",
      "m-4",
    ]);
    expect(selection.compactableMessages.map((message) => message.id)).toEqual([
      "m-1",
      "m-2",
    ]);
  });

  it("uses checkpoint summary plus post-checkpoint tail for effective history", () => {
    const history = buildEffectiveContextHistory(
      [
        {
          id: "m-1",
          role: "user",
          parts: [{ type: "text", text: "older turn".repeat(80) }],
        },
        {
          id: "m-2",
          role: "assistant",
          parts: [{ type: "text", text: "older answer".repeat(80) }],
        },
        {
          id: "m-3",
          role: "user",
          parts: [{ type: "text", text: "newer turn".repeat(60) }],
        },
        {
          id: "m-4",
          role: "assistant",
          parts: [{ type: "text", text: "newer answer".repeat(60) }],
        },
      ] as any,
      {
        checkpoint: {
          summaryText: "Conversation goal: keep the older history compacted.",
          compactedMessageCount: 2,
        },
        contextLength: 2_400,
        fixedOverheadTokens: 200,
      },
    );

    expect(history.summaryText).toContain("Conversation goal");
    expect(history.messages.map((message) => message.id)).toEqual([
      "m-3",
      "m-4",
    ]);
  });
});
