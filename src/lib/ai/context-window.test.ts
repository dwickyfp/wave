import { describe, expect, it } from "vitest";

import {
  estimateChatContextTokens,
  estimatePromptTokens,
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
});
