import { describe, expect, it } from "vitest";
import {
  normalizePdfPageNumber,
  resolveCitationInitialPage,
} from "./knowledge-document-viewer";

describe("knowledge document viewer page targeting", () => {
  it("uses the citation start page when present", () => {
    expect(resolveCitationInitialPage({ pageStart: 5, pageEnd: 7 })).toBe(5);
  });

  it("falls back to the citation end page when start page is missing", () => {
    expect(resolveCitationInitialPage({ pageStart: null, pageEnd: 9 })).toBe(9);
  });

  it("clamps invalid and out-of-range page numbers", () => {
    expect(normalizePdfPageNumber(undefined)).toBe(1);
    expect(normalizePdfPageNumber(0)).toBe(1);
    expect(normalizePdfPageNumber(14, 12)).toBe(12);
    expect(normalizePdfPageNumber(4, 12)).toBe(4);
  });
});
