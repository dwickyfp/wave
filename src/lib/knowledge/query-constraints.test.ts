import { describe, expect, it } from "vitest";

import {
  extractKnowledgeQueryConstraints,
  matchesRetrievalIdentityConstraints,
} from "./query-constraints";

describe("extractKnowledgeQueryConstraints", () => {
  it("extracts dynamic ticker constraints for arbitrary finance issuers", () => {
    const constraints = extractKnowledgeQueryConstraints(
      "TLKM note 7 marketable securities",
    );

    expect(constraints.ticker).toBe("TLKM");
    expect(constraints.noteNumber).toBe("7");
    expect(constraints.strictEntityMatch).toBe(true);
  });

  it("extracts formal issuer names dynamically from finance queries", () => {
    const constraints = extractKnowledgeQueryConstraints(
      "PT Telkom Indonesia (Persero) Tbk annual report page 42",
    );

    expect(constraints.issuer).toBe("PT Telkom Indonesia (Persero) Tbk");
    expect(constraints.page).toBe(42);
    expect(constraints.strictEntityMatch).toBe(true);
  });

  it("does not treat generic uppercase technical terms as finance tickers", () => {
    const constraints = extractKnowledgeQueryConstraints("JSON schema page 2");

    expect(constraints.ticker).toBeUndefined();
    expect(constraints.strictEntityMatch).toBe(false);
  });
});

describe("matchesRetrievalIdentityConstraints", () => {
  it("matches dynamic issuer aliases from retrieval identity metadata", () => {
    const matched = matchesRetrievalIdentityConstraints(
      {
        canonicalTitle:
          "PT Telkom Indonesia (Persero) Tbk / TLKM Financial Statements 2024",
        issuerName: "PT Telkom Indonesia (Persero) Tbk",
        issuerTicker: "TLKM",
        issuerAliases: ["Telkom Indonesia", "TLKM"],
        isFinancialStatement: true,
      },
      {
        issuer: "PT Telkom Indonesia (Persero) Tbk",
        ticker: "TLKM",
        strictEntityMatch: true,
      },
    );

    expect(matched).toBe(true);
  });
});
