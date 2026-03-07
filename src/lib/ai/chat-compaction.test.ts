import { describe, expect, it } from "vitest";

import {
  buildCompactionAssembly,
  buildPersistedHistoryCompactionCandidate,
  buildChatStreamSeedMessages,
  buildCompactionSourceTokenBudgetSequence,
  collectUsedToolNamesFromModelMessages,
  extractAttachmentPreviewText,
  getCompactionSourceTokenBudget,
  renderCompactionMemoryBlock,
  serializeMessagesForCompaction,
  splitCompactionSourceText,
  stripAttachmentPreviewParts,
  stripAttachmentPreviewPartsFromMessages,
} from "./chat-compaction";

describe("chat-compaction", () => {
  it("keeps full persisted history before the first checkpoint exists", async () => {
    const assembly = await buildCompactionAssembly({
      persistedMessages: [
        {
          id: "m-1",
          role: "user",
          parts: [{ type: "text", text: "older question" }],
        },
        {
          id: "m-2",
          role: "assistant",
          parts: [{ type: "text", text: "older answer" }],
        },
      ] as any,
      currentMessage: {
        id: "m-3",
        role: "user",
        parts: [{ type: "text", text: "latest request" }],
      } as any,
      contextLength: 8_000,
      systemPrompt: "You are helpful.",
      tools: {},
      dynamicTailEnabled: false,
    });

    expect(assembly.compactableMessages).toHaveLength(0);
    expect(assembly.retainedMessages).toHaveLength(2);
    expect(assembly.systemPrompt).toBe("You are helpful.");
    expect(assembly.messages).toHaveLength(3);
  });

  it("injects checkpoint memory and uses a reduced retained tail when enabled", async () => {
    const assembly = await buildCompactionAssembly({
      persistedMessages: [
        {
          id: "m-1",
          role: "user",
          parts: [{ type: "text", text: "older question ".repeat(80) }],
        },
        {
          id: "m-2",
          role: "assistant",
          parts: [{ type: "text", text: "older answer ".repeat(80) }],
        },
        {
          id: "m-3",
          role: "user",
          parts: [{ type: "text", text: "recent question ".repeat(24) }],
        },
        {
          id: "m-4",
          role: "assistant",
          parts: [{ type: "text", text: "recent answer ".repeat(24) }],
        },
      ] as any,
      currentMessage: {
        id: "m-5",
        role: "user",
        parts: [{ type: "text", text: "new request" }],
      } as any,
      checkpoint: {
        id: "cp-1",
        threadId: "thread-1",
        schemaVersion: 1,
        summaryJson: {
          conversationGoal: "Track older work",
          userPreferences: [],
          constraints: [],
          establishedFacts: [],
          decisions: [],
          toolResults: [],
          artifacts: [],
          openQuestions: [],
          nextActions: [],
        },
        summaryText: "Conversation goal:\nTrack older work",
        compactedMessageCount: 2,
        sourceTokenCount: 100,
        summaryTokenCount: 20,
        modelProvider: "openai",
        modelName: "gpt-test",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      contextLength: 10_000,
      systemPrompt: "You are helpful.",
      tools: {},
      dynamicTailEnabled: true,
    });

    expect(assembly.systemPrompt).toContain("Compressed conversation memory");
    expect(assembly.retainedMessages.map((message) => message.id)).toEqual([
      "m-3",
      "m-4",
    ]);
    expect(assembly.messages.at(-1)?.role).toBe("user");
  });

  it("selects a compaction range once history crosses the trigger band", async () => {
    const assembly = await buildCompactionAssembly({
      persistedMessages: [
        {
          id: "m-1",
          role: "user",
          parts: [{ type: "text", text: "older turn a".repeat(3_000) }],
        },
        {
          id: "m-2",
          role: "user",
          parts: [{ type: "text", text: "older turn b".repeat(3_000) }],
        },
        {
          id: "m-3",
          role: "user",
          parts: [{ type: "text", text: "newer turn c".repeat(3_000) }],
        },
        {
          id: "m-4",
          role: "user",
          parts: [{ type: "text", text: "newer turn d".repeat(3_000) }],
        },
      ] as any,
      currentMessage: {
        id: "m-5",
        role: "user",
        parts: [{ type: "text", text: "latest request" }],
      } as any,
      contextLength: 50_000,
      systemPrompt: "You are helpful.",
      tools: {},
      dynamicTailEnabled: false,
    });

    expect(assembly.compactableMessages.map((message) => message.id)).toEqual([
      "m-1",
      "m-2",
    ]);
  });

  it("renders the memory block with recency precedence guidance", () => {
    const block = renderCompactionMemoryBlock(
      "Conversation goal:\nShip safely",
    );

    expect(block).toContain("Compressed conversation memory");
    expect(block).toContain("trust the newer raw messages");
    expect(block).toContain("Ship safely");
  });

  it("builds a non-empty bootstrap seed for streamText", async () => {
    const seedMessages = await buildChatStreamSeedMessages({
      id: "m-seed",
      role: "assistant",
      parts: [],
    } as any);

    expect(seedMessages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "Continue the conversation." }],
      },
    ]);
  });

  it("strips attachment preview parts without removing file parts", () => {
    const message = {
      id: "m-1",
      role: "user",
      parts: [
        { type: "text", text: "Ask about this file" },
        { type: "text", text: "csv preview", ingestionPreview: true },
        {
          type: "file",
          filename: "report.csv",
          mediaType: "text/csv",
          url: "https://example.com/report.csv",
        },
      ],
    } as any;

    expect(extractAttachmentPreviewText([message])).toContain("csv preview");
    expect(stripAttachmentPreviewParts(message).parts).toEqual([
      { type: "text", text: "Ask about this file" },
      {
        type: "file",
        filename: "report.csv",
        mediaType: "text/csv",
        url: "https://example.com/report.csv",
      },
    ]);
    expect(
      stripAttachmentPreviewPartsFromMessages([message])[0]?.parts,
    ).toHaveLength(2);
  });

  it("uses only visible text parts for compaction source", () => {
    expect(
      serializeMessagesForCompaction([
        {
          id: "m-1",
          role: "user",
          parts: [
            { type: "text", text: "Ask about the report" },
            { type: "text", text: "csv preview", ingestionPreview: true },
            {
              type: "file",
              filename: "report.csv",
              mediaType: "text/csv",
              url: "https://example.com/report.csv",
            },
          ],
        },
        {
          id: "m-2",
          role: "assistant",
          parts: [
            { type: "text", text: "Revenue was up 18% year over year." },
            {
              type: "tool-webSearch",
              state: "output-available",
              input: { query: "revenue" },
              output: { result: "ignored for compaction" },
            },
          ],
        },
      ] as any),
    ).toBe(
      "user:\nAsk about the report\n\nassistant:\nRevenue was up 18% year over year.",
    );
  });

  it("collects used tool names from loop messages", () => {
    const usedToolNames = collectUsedToolNamesFromModelMessages([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "web_search",
            input: { query: "bank revenue" },
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
              value: "result",
            },
          },
        ],
      },
    ] as any);

    expect(Array.from(usedToolNames)).toEqual(["web_search"]);
  });

  it("builds a history-only candidate for background compaction", () => {
    const candidate = buildPersistedHistoryCompactionCandidate({
      persistedMessages: [
        {
          id: "m-1",
          role: "user",
          parts: [{ type: "text", text: "older turn".repeat(4_000) }],
        },
        {
          id: "m-2",
          role: "assistant",
          parts: [{ type: "text", text: "older answer".repeat(4_000) }],
        },
        {
          id: "m-3",
          role: "user",
          parts: [{ type: "text", text: "recent turn".repeat(2_000) }],
        },
      ] as any,
      contextLength: 40_000,
    });

    expect(candidate.totalTokens).toBeGreaterThan(0);
    expect(candidate.compactableMessages.length).toBeGreaterThan(0);
    expect(candidate.breakdown.historyTokens).toBeGreaterThan(0);
  });

  it("splits oversized compaction source text into bounded chunks", () => {
    const chunks = splitCompactionSourceText({
      sourceText: Array.from(
        { length: 12 },
        (_, index) => `user:\nsection ${index} ${"x".repeat(6_000)}`,
      ).join("\n\n"),
      tokenBudget: 3_000,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.trim().length > 0)).toBeTruthy();
  });

  it("caps compaction source budget for large context windows", () => {
    expect(
      getCompactionSourceTokenBudget({
        contextLength: 90_000,
        summaryBudgetTokens: 2_000,
      }),
    ).toBe(31_500);
    expect(
      getCompactionSourceTokenBudget({
        contextLength: 200_000,
        summaryBudgetTokens: 2_000,
      }),
    ).toBe(32_000);
  });

  it("retries compaction with progressively smaller source budgets", () => {
    expect(
      buildCompactionSourceTokenBudgetSequence({
        contextLength: 90_000,
        summaryBudgetTokens: 2_000,
      }),
    ).toEqual([31_500, 15_750, 7_875, 4_000]);
  });

  it("keeps a deterministic text fallback summary within budget", () => {
    const text = Array.from(
      { length: 20 },
      (_, index) =>
        `${index % 2 === 0 ? "user" : "assistant"}:\n${"detail ".repeat(80)}`,
    ).join("\n\n");

    const chunks = splitCompactionSourceText({
      sourceText: text,
      tokenBudget: 500,
    });

    expect(chunks.length).toBeGreaterThan(1);
  });
});
