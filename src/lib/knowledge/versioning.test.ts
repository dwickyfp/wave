import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildChunkSnapshotInsertRow,
  buildImageSnapshotInsertRow,
  buildLiveSectionInsertRow,
  getNextReservedVersionNumber,
  resolveMissingHistorySeedEventType,
  resolveDocumentVersionRetention,
  resolveKnowledgeDocumentFailureOutcome,
} from "./versioning";

describe("getNextReservedVersionNumber", () => {
  it("uses the highest existing version number, not just latest active version", () => {
    expect(
      getNextReservedVersionNumber({
        latestVersionNumber: 4,
        maxExistingVersionNumber: 5,
      }),
    ).toBe(6);
  });

  it("starts at version one when no versions exist yet", () => {
    expect(
      getNextReservedVersionNumber({
        latestVersionNumber: 0,
        maxExistingVersionNumber: 0,
      }),
    ).toBe(1);
  });

  it("keeps a live document ready when a reingest version fails", () => {
    expect(
      resolveKnowledgeDocumentFailureOutcome({
        activeVersionId: "version-1",
        errorMessage: "reingest failed",
      }),
    ).toEqual({
      status: "ready",
      errorMessage: "reingest failed",
    });
  });

  it("marks the document failed when the first ingest fails", () => {
    expect(
      resolveKnowledgeDocumentFailureOutcome({
        activeVersionId: null,
        errorMessage: "initial ingest failed",
      }),
    ).toEqual({
      status: "failed",
      errorMessage: "initial ingest failed",
    });
  });

  it("retains only the active version and in-flight processing versions", () => {
    expect(
      resolveDocumentVersionRetention({
        activeVersionId: "version-3",
        versions: [
          { id: "version-1", status: "ready" },
          { id: "version-2", status: "failed" },
          { id: "version-3", status: "ready" },
          { id: "version-4", status: "processing" },
        ],
      }),
    ).toEqual({
      retainedVersionIds: ["version-3", "version-4"],
      deletedVersionIds: ["version-1", "version-2"],
    });
  });

  it("keeps the active version even when it is still processing", () => {
    expect(
      resolveDocumentVersionRetention({
        activeVersionId: "version-9",
        versions: [{ id: "version-9", status: "processing" }],
      }),
    ).toEqual({
      retainedVersionIds: ["version-9"],
      deletedVersionIds: [],
    });
  });

  it("seeds missing history as created for first-ingest versions", () => {
    expect(
      resolveMissingHistorySeedEventType({
        activeVersionNumber: 1,
        activeVersionChangeType: "initial_ingest",
      }),
    ).toBe("created");
  });

  it("seeds missing history as bootstrap for later versioned documents", () => {
    expect(
      resolveMissingHistorySeedEventType({
        activeVersionNumber: 3,
        activeVersionChangeType: "edit",
      }),
    ).toBe("bootstrap");
  });

  it("preserves chunk embeddings in version snapshots", () => {
    expect(
      buildChunkSnapshotInsertRow({
        versionId: "version-1",
        documentId: "doc-1",
        groupId: "group-1",
        chunk: {
          id: "chunk-1",
          sectionId: "section-1",
          content: "chunk",
          contextSummary: "summary",
          embedding: [0.1, 0.2, 0.3],
          chunkIndex: 0,
          tokenCount: 12,
          metadata: null,
        },
      }),
    ).toMatchObject({
      embedding: [0.1, 0.2, 0.3],
    });
  });

  it("preserves image embeddings in version snapshots", () => {
    expect(
      buildImageSnapshotInsertRow({
        versionId: "version-1",
        documentId: "doc-1",
        groupId: "group-1",
        image: {
          id: "image-1",
          documentId: "doc-1",
          groupId: "group-1",
          versionId: "version-1",
          kind: "embedded",
          ordinal: 1,
          marker: "CTX_IMAGE_1",
          label: "Chart",
          description: "Description",
          headingPath: null,
          stepHint: null,
          sourceUrl: null,
          storagePath: null,
          mediaType: "image/png",
          pageNumber: 1,
          width: null,
          height: null,
          altText: null,
          caption: null,
          surroundingText: null,
          precedingText: null,
          followingText: null,
          imageType: "chart",
          ocrText: "Q1 12.4\nQ2 13.8",
          ocrConfidence: 0.88,
          exactValueSnippets: ["Q2 revenue: 13.8T"],
          structuredData: {
            chartData: {
              chartType: "bar chart",
              xAxisLabel: "Quarter",
              yAxisLabel: "Revenue",
            },
          },
          isRenderable: true,
          manualLabel: false,
          manualDescription: false,
          embedding: [0.4, 0.5, 0.6],
        },
      }),
    ).toMatchObject({
      embedding: [0.4, 0.5, 0.6],
      imageType: "chart",
      ocrText: "Q1 12.4\nQ2 13.8",
      exactValueSnippets: ["Q2 revenue: 13.8T"],
    });
  });

  it("preserves section embeddings in live materialization rows", () => {
    expect(
      buildLiveSectionInsertRow({
        documentId: "doc-1",
        groupId: "group-1",
        section: {
          id: "section-1",
          heading: "Heading",
          headingPath: "Heading",
          level: 1,
          partIndex: 0,
          partCount: 1,
          content: "content",
          summary: "summary",
          tokenCount: 24,
          embedding: [0.7, 0.8, 0.9],
        },
      }),
    ).toMatchObject({
      embedding: [0.7, 0.8, 0.9],
    });
  });
});
