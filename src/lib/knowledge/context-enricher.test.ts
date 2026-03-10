import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("lib/db/repository", () => ({
  settingsRepository: {
    getSetting: vi.fn(async () => null),
    getProviderByName: vi.fn(async () => null),
    getModelForChat: vi.fn(async () => null),
  },
}));

vi.mock("lib/ai/provider-factory", () => ({
  createModelFromConfig: vi.fn(() => null),
}));

const { enrichChunksWithContext } = await import("./context-enricher");

describe("context-enricher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses section-local fallback context for late-section chunks", async () => {
    const enriched = await enrichChunksWithContext(
      [
        {
          sectionId: "section-2",
          content: "Late section chunk content.",
          chunkIndex: 0,
          tokenCount: 20,
          metadata: {
            headingPath: "Guide > Tail Section",
            pageStart: 9,
            pageEnd: 10,
          },
        },
      ],
      "Guide",
      [
        {
          id: "parent-1",
          headingPath: "Guide",
          content: "Parent intro",
          summary: "Guide parent summary.",
          parentSectionId: null,
        },
        {
          id: "section-2",
          headingPath: "Guide > Tail Section",
          content:
            "Tail section excerpt that should be used instead of the document opening.",
          summary: "Tail section summary.",
          parentSectionId: "parent-1",
        },
      ],
    );

    expect(enriched[0]?.contextSummary).toContain('From document: "Guide".');
    expect(enriched[0]?.contextSummary).toContain(
      "Section: Guide > Tail Section.",
    );
    expect(enriched[0]?.contextSummary).toContain("Pages: 9-10.");
    expect(enriched[0]?.contextSummary).toContain("Guide parent summary.");
    expect(enriched[0]?.embeddingText).toContain(enriched[0]?.contextSummary);
  });
});
