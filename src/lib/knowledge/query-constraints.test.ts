import { describe, expect, it } from "vitest";

import { extractKnowledgeQueryConstraints } from "./query-constraints";

describe("extractKnowledgeQueryConstraints", () => {
  it("extracts note number from finance-style queries", () => {
    const constraints = extractKnowledgeQueryConstraints(
      "note 7 marketable securities",
    );

    expect(constraints.noteNumber).toBe("7");
  });

  it("extracts page number from queries", () => {
    const constraints = extractKnowledgeQueryConstraints(
      "annual report page 42",
    );

    expect(constraints.page).toBe(42);
  });

  it("does not extract page number for queries without page markers", () => {
    const constraints = extractKnowledgeQueryConstraints("JSON schema page 2");

    expect(constraints.page).toBe(2);
    expect(constraints.noteNumber).toBeUndefined();
  });
});
