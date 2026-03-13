import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getNextReservedVersionNumber,
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
});
