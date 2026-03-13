import { describe, expect, it } from "vitest";

import { buildFinancialStatementRetrievalIdentity } from "./financial-statement";

describe("financial statement retrieval identity", () => {
  it("does not infer financial issuer metadata from filename alone for non-financial documents", () => {
    const identity = buildFinancialStatementRetrievalIdentity({
      markdown:
        "# Peraturan Menteri Keuangan Republik Indonesia\n\nPeraturan ini mengatur perubahan atas pemberitahuan barang kena cukai yang selesai dibuat.",
      fallbackTitle: "Peraturan Menteri Keuangan Republik Indonesia",
      originalFilename: "PT Bank Rakyat Indonesia (Persero) Tbk BBRI 2019.pdf",
      autoTitle: "Peraturan Menteri Keuangan Republik Indonesia",
      pageCount: 3,
    });

    expect(identity.canonicalTitle).toBe(
      "Peraturan Menteri Keuangan Republik Indonesia",
    );
    expect(identity.isFinancialStatement).toBe(false);
    expect(identity.issuerTicker).toBeNull();
  });

  it("still builds issuer metadata for actual financial statements", () => {
    const identity = buildFinancialStatementRetrievalIdentity({
      markdown:
        "# PT Bank Rakyat Indonesia (Persero) Tbk\n\nLaporan keuangan konsolidasian untuk tahun yang berakhir 31 Desember 2019.\n\nCatatan 1. Kebijakan akuntansi.",
      fallbackTitle: "PT Bank Rakyat Indonesia (Persero) Tbk",
      originalFilename: "bbri-2019-financial-statements.pdf",
      autoTitle: "PT Bank Rakyat Indonesia (Persero) Tbk",
      pageCount: 120,
    });

    expect(identity.isFinancialStatement).toBe(true);
    expect(identity.issuerTicker).toBe("BBRI");
  });
});
