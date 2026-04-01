import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("lib/db/repository", () => ({
  knowledgeRepository: {
    selectDocumentsByGroupScope: vi.fn(),
    getSectionsByDocumentId: vi.fn(),
  },
}));

vi.mock("lib/cache", () => ({
  serverCache: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
  },
}));

const { summarizeKnowledgeDocumentById, resolveKnowledgeDocumentByName } =
  await import("./document-summary");
const { knowledgeRepository } = await import("lib/db/repository");

describe("document-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a document summary with outline, value digest, and citations", async () => {
    vi.mocked(
      knowledgeRepository.selectDocumentsByGroupScope,
    ).mockResolvedValue([
      {
        id: "doc-1",
        name: "Annual Report 2025",
        originalFilename: "annual-report-2025.pdf",
        status: "ready",
        activeVersionId: "version-1",
      },
    ] as any);
    vi.mocked(knowledgeRepository.getSectionsByDocumentId).mockResolvedValue([
      {
        id: "section-1",
        documentId: "doc-1",
        groupId: "group-1",
        heading: "Results",
        headingPath: "Report > Results",
        level: 1,
        partIndex: 0,
        partCount: 2,
        content: "Revenue section",
        summary: "Results summary",
        summaryData: {
          logicalSectionKey: "Report > Results::::",
          partSummary: "Part summary.",
          logicalSectionSummary:
            "Results summary with revenue 120.5 and margin 32%.",
          continuation: {
            partIndex: 0,
            partCount: 2,
            usesPrevPart: false,
            usesNextPart: true,
          },
          valueDigest: [
            {
              kind: "numeric_sentence",
              text: "Revenue 120.5",
              pageStart: 10,
              pageEnd: 10,
            },
          ],
          tableDigest: [],
          coverageFlags: {
            hasTable: false,
            hasDenseNumbers: true,
            hasResearchResults: false,
            hasContinuation: true,
          },
        },
        tokenCount: 100,
        pageStart: 10,
        pageEnd: 10,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: "section-2",
        documentId: "doc-1",
        groupId: "group-1",
        heading: "Results",
        headingPath: "Report > Results",
        level: 1,
        partIndex: 1,
        partCount: 2,
        content: "Continuation section",
        summary: "Continuation summary",
        summaryData: {
          logicalSectionKey: "Report > Results::::",
          partSummary: "Continuation part.",
          logicalSectionSummary:
            "Results summary with revenue 120.5 and margin 32%.",
          continuation: {
            partIndex: 1,
            partCount: 2,
            usesPrevPart: true,
            usesNextPart: false,
          },
          valueDigest: [
            {
              kind: "numeric_sentence",
              text: "Margin 32%",
              pageStart: 11,
              pageEnd: 11,
            },
          ],
          tableDigest: [],
          coverageFlags: {
            hasTable: false,
            hasDenseNumbers: true,
            hasResearchResults: false,
            hasContinuation: true,
          },
        },
        tokenCount: 100,
        pageStart: 11,
        pageEnd: 11,
        createdAt: new Date("2026-01-01T00:01:00Z"),
      },
    ] as any);

    const result = await summarizeKnowledgeDocumentById({
      group: { id: "group-1", name: "Reports" },
      documentId: "doc-1",
      tokens: 1200,
    });

    expect(result?.documentId).toBe("doc-1");
    expect(result?.outline).toHaveLength(1);
    expect(result?.outline[0]).toMatchObject({
      headingPath: "Report > Results",
      hasContinuation: true,
    });
    expect(result?.summary).toContain("Annual Report 2025");
    expect(result?.valueDigest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Revenue 120.5" }),
        expect.objectContaining({ text: "Margin 32%" }),
      ]),
    );
    expect(result?.citations[0]).toMatchObject({
      sectionHeading: "Report > Results",
      pageStart: 10,
      pageEnd: 11,
    });
  });

  it("returns ambiguous resolution when multiple docs match a name", async () => {
    vi.mocked(
      knowledgeRepository.selectDocumentsByGroupScope,
    ).mockResolvedValue([
      {
        id: "doc-1",
        name: "Annual Report 2025",
        originalFilename: "annual-report-2025.pdf",
        status: "ready",
      },
      {
        id: "doc-2",
        name: "Annual Report 2024",
        originalFilename: "annual-report-2024.pdf",
        status: "ready",
      },
    ] as any);

    const resolution = await resolveKnowledgeDocumentByName({
      groupId: "group-1",
      document: "annual report",
    });

    expect(resolution.status).toBe("ambiguous");
  });
});
