import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  generateTextMock,
  getProviderByNameMock,
  getModelForChatMock,
  createModelFromConfigMock,
} = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  getProviderByNameMock: vi.fn(),
  getModelForChatMock: vi.fn(),
  createModelFromConfigMock: vi.fn(),
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateText: generateTextMock,
  };
});

vi.mock("lib/db/repository", () => ({
  settingsRepository: {
    getProviderByName: getProviderByNameMock,
    getModelForChat: getModelForChatMock,
  },
}));

vi.mock("lib/ai/provider-factory", () => ({
  createModelFromConfig: createModelFromConfigMock,
}));

import {
  isTransientKnowledgeParseError,
  mergeParsedMarkdownWindows,
  parseDocumentToMarkdown,
  splitRawTextIntoWindows,
} from "./markdown-parser";

describe("markdown-parser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProviderByNameMock.mockResolvedValue({
      enabled: true,
      apiKey: "test-key",
      baseUrl: null,
      settings: null,
    });
    getModelForChatMock.mockResolvedValue({
      apiName: "gpt-4.1-mini",
    });
    createModelFromConfigMock.mockReturnValue({});
    generateTextMock.mockResolvedValue({
      text: "# Parsed\n\nCTX_IMAGE_1\n\nBody copy",
    });
  });

  it("keeps tail content beyond the old single-window limit", () => {
    const rawText = [
      "# Intro\n",
      "A".repeat(50_000),
      "\n## Middle\n",
      "B".repeat(50_000),
      "\n## Tail\n",
      "TAIL-CONTENT",
      "C".repeat(35_000),
    ].join("");

    const windows = splitRawTextIntoWindows(rawText);

    expect(windows.length).toBeGreaterThan(1);
    expect(
      windows.some((windowText) => windowText.includes("TAIL-CONTENT")),
    ).toBe(true);
  });

  it("merges parsed windows without duplicating overlapped headings", () => {
    const merged = mergeParsedMarkdownWindows([
      "# Intro\n\nAlpha\n\n## Install\n\nRun setup",
      "## Install\n\nRun setup\n\n## Usage\n\nRun app",
      "## Usage\n\nRun app\n\n## Tail\n\nDone",
    ]);

    expect(merged).toContain("## Install\n\nRun setup");
    expect(merged).toContain("## Usage\n\nRun app");
    expect(merged.match(/## Install/g)).toHaveLength(1);
    expect(merged.match(/## Usage/g)).toHaveLength(1);
    expect(merged).toContain("## Tail\n\nDone");
  });

  it("preserves page markers and skips parsing work when parse mode is off", async () => {
    const result = await parseDocumentToMarkdown({
      pages: [
        {
          pageNumber: 1,
          rawText: "Page one raw text",
          normalizedText: "Page one markdown",
          markdown: "Page one markdown",
          fingerprint: "page-1",
          qualityScore: 0.9,
          extractionMode: "normalized",
          repairReason: null,
        },
        {
          pageNumber: 2,
          rawText: "Page two raw text",
          normalizedText: "Page two markdown",
          markdown: "Page two markdown",
          fingerprint: "page-2",
          qualityScore: 0.4,
          extractionMode: "normalized",
          repairReason: "fragmented_lines",
        },
      ],
      documentTitle: "Guide",
      parsingProvider: "openai",
      parsingModel: "gpt-4.1-mini",
      mode: "off",
      repairPolicy: "section-safe-reorder",
    });

    expect(result.markdown).toContain("<!--CTX_PAGE:1-->");
    expect(result.markdown).toContain("<!--CTX_PAGE:2-->");
    expect(result.pages[1]?.extractionMode).toBe("normalized");
  });

  it("prompts for semantic structure preservation and inline image anchors", async () => {
    await parseDocumentToMarkdown({
      pages: [
        {
          pageNumber: 1,
          rawText:
            "1. Scope\nCTX_IMAGE_1\nFigure 1 Revenue by region\nBody copy",
          normalizedText:
            "1. Scope\nCTX_IMAGE_1\nFigure 1 Revenue by region\nBody copy",
          markdown:
            "1. Scope\nCTX_IMAGE_1\nFigure 1 Revenue by region\nBody copy",
          fingerprint: "page-structure",
          qualityScore: 0.2,
          extractionMode: "normalized",
          repairReason: "broken_reading_order",
        },
      ],
      documentTitle: "Quarterly Report",
      parsingProvider: "openai",
      parsingModel: "gpt-4.1-mini",
      mode: "always",
      repairPolicy: "section-safe-reorder",
    });

    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining(
          "Match the actual document structure semantically",
        ),
        prompt: expect.stringContaining(
          "Preserve heading hierarchy, numbering, list nesting, table/caption grouping, and CTX_IMAGE marker placement.",
        ),
      }),
    );
  });

  it("runs multiple repaired pages in parallel while preserving final page order", async () => {
    const resolvers: Array<(value: { text: string }) => void> = [];
    generateTextMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const promise = parseDocumentToMarkdown({
      pages: [
        {
          pageNumber: 1,
          rawText: "Page one raw text",
          normalizedText: "Page one markdown",
          markdown: "Page one markdown",
          fingerprint: "page-parallel-1",
          qualityScore: 0.2,
          extractionMode: "normalized",
          repairReason: "broken_reading_order",
        },
        {
          pageNumber: 2,
          rawText: "Page two raw text",
          normalizedText: "Page two markdown",
          markdown: "Page two markdown",
          fingerprint: "page-parallel-2",
          qualityScore: 0.2,
          extractionMode: "normalized",
          repairReason: "broken_reading_order",
        },
      ],
      documentTitle: "Parallel Guide",
      parsingProvider: "openai",
      parsingModel: "gpt-4.1-mini",
      mode: "always",
      repairPolicy: "section-safe-reorder",
    });

    await vi.waitFor(() => {
      expect(generateTextMock).toHaveBeenCalledTimes(2);
    });

    resolvers[1]?.({ text: "## Page Two\n\nSecond page content" });
    resolvers[0]?.({ text: "## Page One\n\nFirst page content" });

    const result = await promise;

    expect(result.markdown).toContain("<!--CTX_PAGE:1-->\n\n## Page One");
    expect(result.markdown).toContain("<!--CTX_PAGE:2-->\n\n## Page Two");
    expect(result.markdown.indexOf("<!--CTX_PAGE:1-->")).toBeLessThan(
      result.markdown.indexOf("<!--CTX_PAGE:2-->"),
    );
  });

  it("reports monotonic per-page parsing progress as pages complete", async () => {
    const onPageProgress = vi.fn();

    await parseDocumentToMarkdown({
      pages: [
        {
          pageNumber: 1,
          rawText: "Page one raw text",
          normalizedText: "Page one markdown",
          markdown: "Page one markdown",
          fingerprint: "page-progress-1",
          qualityScore: 0.2,
          extractionMode: "normalized",
          repairReason: "broken_reading_order",
        },
        {
          pageNumber: 2,
          rawText: "Page two raw text",
          normalizedText: "Page two markdown",
          markdown: "Page two markdown",
          fingerprint: "page-progress-2",
          qualityScore: 0.95,
          extractionMode: "normalized",
          repairReason: null,
        },
      ],
      documentTitle: "Progress Guide",
      parsingProvider: "openai",
      parsingModel: "gpt-4.1-mini",
      mode: "auto",
      repairPolicy: "section-safe-reorder",
      onPageProgress,
    });

    expect(onPageProgress).toHaveBeenCalledTimes(2);
    expect(
      onPageProgress.mock.calls.map(([state]) => state.currentPage),
    ).toEqual([1, 2]);
    expect(
      onPageProgress.mock.calls.every(
        ([state]) =>
          state.totalPages === 2 && typeof state.pageNumber === "number",
      ),
    ).toBe(true);
  });

  it("falls back only the failed window and keeps page parsing moving", async () => {
    const previousRetryAttempts = process.env.KNOWLEDGE_PARSE_RETRY_ATTEMPTS;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.KNOWLEDGE_PARSE_RETRY_ATTEMPTS = "1";
    generateTextMock
      .mockRejectedValueOnce(new Error("parser offline"))
      .mockResolvedValueOnce({
        text: "## Second Window\n\nTail parsed cleanly",
      });

    try {
      const result = await parseDocumentToMarkdown({
        pages: [
          {
            pageNumber: 63,
            rawText: [
              "# First Window\n",
              "A".repeat(41_000),
              "\n## Second Window\n",
              "Tail marker\n",
              "B".repeat(2_000),
            ].join(""),
            normalizedText: "Normalized page fallback",
            markdown: "Normalized page fallback",
            fingerprint: "page-partial-window-fallback",
            qualityScore: 0.2,
            extractionMode: "normalized",
            repairReason: "broken_reading_order",
          },
        ],
        documentTitle: "BBCA_Q4_2025",
        parsingProvider: "openai",
        parsingModel: "gpt-4.1-mini",
        mode: "always",
        repairPolicy: "section-safe-reorder",
      });

      expect(generateTextMock).toHaveBeenCalledTimes(2);
      expect(result.pages[0]?.parseFallbackUsed).toBe(true);
      expect(result.pages[0]?.parseWindowCount).toBeGreaterThan(1);
      expect(result.pages[0]?.parseFailedWindowCount).toBe(1);
      expect(result.pages[0]?.parseError).toMatch(/parser offline/i);
      expect(result.pages[0]?.extractionMode).toBe("refined");
      expect(result.markdown).toContain("# First Window");
      expect(result.markdown).toContain("Tail parsed cleanly");
    } finally {
      warnSpy.mockRestore();
      if (previousRetryAttempts === undefined) {
        delete process.env.KNOWLEDGE_PARSE_RETRY_ATTEMPTS;
      } else {
        process.env.KNOWLEDGE_PARSE_RETRY_ATTEMPTS = previousRetryAttempts;
      }
    }
  });

  it("splits a repeatedly failing large window into smaller parse windows", async () => {
    const previousRetryAttempts = process.env.KNOWLEDGE_PARSE_RETRY_ATTEMPTS;
    const previousRetryDelay = process.env.KNOWLEDGE_PARSE_RETRY_BASE_DELAY_MS;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.KNOWLEDGE_PARSE_RETRY_ATTEMPTS = "4";
    process.env.KNOWLEDGE_PARSE_RETRY_BASE_DELAY_MS = "0";
    generateTextMock
      .mockRejectedValueOnce(new Error("500 internal error"))
      .mockRejectedValueOnce(new Error("500 internal error"))
      .mockResolvedValueOnce({
        text: "## Window 1.1\n\nFirst half repaired",
      })
      .mockResolvedValueOnce({
        text: "## Window 1.2\n\nSecond half repaired",
      });

    try {
      const result = await parseDocumentToMarkdown({
        pages: [
          {
            pageNumber: 63,
            rawText: [
              "# Profit Section\n",
              "A".repeat(5_200),
              "\n## Tail Section\n",
              "B".repeat(5_200),
            ].join(""),
            normalizedText: "Normalized page fallback",
            markdown: "Normalized page fallback",
            fingerprint: "page-adaptive-window-split",
            qualityScore: 0.2,
            extractionMode: "normalized",
            repairReason: "broken_reading_order",
          },
        ],
        documentTitle: "BBCA_Q4_2025",
        parsingProvider: "openai",
        parsingModel: "gpt-4.1-mini",
        mode: "always",
        repairPolicy: "section-safe-reorder",
      });

      expect(generateTextMock).toHaveBeenCalledTimes(4);
      expect(result.pages[0]?.parseFallbackUsed).toBe(false);
      expect(result.pages[0]?.parseFailedWindowCount).toBe(0);
      expect(result.pages[0]?.extractionMode).toBe("refined");
      expect(result.markdown).toContain("First half repaired");
      expect(result.markdown).toContain("Second half repaired");
    } finally {
      warnSpy.mockRestore();
      if (previousRetryAttempts === undefined) {
        delete process.env.KNOWLEDGE_PARSE_RETRY_ATTEMPTS;
      } else {
        process.env.KNOWLEDGE_PARSE_RETRY_ATTEMPTS = previousRetryAttempts;
      }
      if (previousRetryDelay === undefined) {
        delete process.env.KNOWLEDGE_PARSE_RETRY_BASE_DELAY_MS;
      } else {
        process.env.KNOWLEDGE_PARSE_RETRY_BASE_DELAY_MS = previousRetryDelay;
      }
    }
  });

  it("fails the page parse when strict failure mode rejects short output", async () => {
    generateTextMock.mockResolvedValueOnce({
      text: "too short",
    });

    await expect(
      parseDocumentToMarkdown({
        pages: [
          {
            pageNumber: 1,
            rawText:
              "This page has enough extracted text to require a real markdown reconstruction output.",
            normalizedText:
              "This page has enough extracted text to require a real markdown reconstruction output.",
            markdown:
              "This page has enough extracted text to require a real markdown reconstruction output.",
            fingerprint: "page-strict-fail",
            qualityScore: 0.2,
            extractionMode: "normalized",
            repairReason: "broken_reading_order",
          },
        ],
        documentTitle: "Strict Guide",
        parsingProvider: "openai",
        parsingModel: "gpt-4.1-mini",
        mode: "always",
        repairPolicy: "section-safe-reorder",
        failureMode: "fail",
      }),
    ).rejects.toThrow(/suspiciously short output/i);
  });

  it("classifies 429-style parsing failures as transient", () => {
    expect(
      isTransientKnowledgeParseError(new Error("429 rate limit exceeded")),
    ).toBe(true);
    expect(isTransientKnowledgeParseError(new Error("syntax error"))).toBe(
      false,
    );
  });
});
