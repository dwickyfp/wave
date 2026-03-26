import { describe, expect, it } from "vitest";

import {
  buildFinancialStatementRetrievalIdentity,
  classifyFinancialStatementDocument,
} from "./financial-statement";

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

  it("extracts issuer metadata dynamically for other listed issuers", () => {
    const identity = buildFinancialStatementRetrievalIdentity({
      markdown:
        "# PT Telkom Indonesia (Persero) Tbk (TLKM)\n\nLaporan keuangan konsolidasian untuk tahun yang berakhir 31 Desember 2024.\n\nCatatan 2. Kas dan setara kas.",
      fallbackTitle: "PT Telkom Indonesia (Persero) Tbk",
      originalFilename: "tlkm-2024-financial-statements.pdf",
      autoTitle: "PT Telkom Indonesia (Persero) Tbk (TLKM)",
      pageCount: 140,
    });

    expect(identity.isFinancialStatement).toBe(true);
    expect(identity.issuerName).toBe("PT Telkom Indonesia (Persero) Tbk");
    expect(identity.issuerTicker).toBe("TLKM");
    expect(identity.issuerAliases).toEqual(
      expect.arrayContaining([
        "PT Telkom Indonesia (Persero) Tbk",
        "Telkom Indonesia",
        "TLKM",
      ]),
    );
  });

  it("extracts tickers from explicit ticker labels for arbitrary issuers", () => {
    const identity = buildFinancialStatementRetrievalIdentity({
      markdown: [
        "# PT Bank Syariah Indonesia Tbk",
        "",
        "Kode saham: BRIS",
        "",
        "Laporan keuangan konsolidasian untuk tahun yang berakhir 31 Desember 2024.",
        "",
        "Catatan 3. Instrumen keuangan.",
      ].join("\n"),
      fallbackTitle: "PT Bank Syariah Indonesia Tbk",
      originalFilename: "bank-syariah-indonesia-2024-report.pdf",
      autoTitle: "PT Bank Syariah Indonesia Tbk",
      pageCount: 110,
    });

    expect(identity.isFinancialStatement).toBe(true);
    expect(identity.issuerTicker).toBe("BRIS");
    expect(identity.issuerAliases).toContain("Bank Syariah Indonesia");
  });

  it("does not classify long non-financial documents as financial from filename hints alone", () => {
    const classification = classifyFinancialStatementDocument({
      markdown:
        "# Peraturan Menteri Keuangan Republik Indonesia\n\n" +
        "Peraturan ini mengatur perubahan atas pemberitahuan barang kena cukai yang selesai dibuat.\n\n" +
        "Ketentuan ini berlaku untuk proses administrasi dan pengawasan kepabeanan.",
      filename: "bbri-2019-laporan-kepatuhan.pdf",
      pageCount: 120,
    });

    expect(classification.isFinancialStatement).toBe(false);
  });
});
