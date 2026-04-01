import type { ChatKnowledgeCitation } from "app-types/chat";
import { describe, expect, it } from "vitest";
import {
  applyFinalizedAssistantText,
  buildKnowledgeCitations,
  enforceKnowledgeCitationCoverage,
  linkifyAssistantKnowledgeCitations,
  linkifyKnowledgeCitationMarkers,
  normalizeKnowledgeCitationLayout,
  stripAssistantKnowledgeCitationLinks,
  stripKnowledgeCitationLinks,
  validateKnowledgeCitationText,
} from "./knowledge-citations";

describe("knowledge citations", () => {
  const citations = buildKnowledgeCitations({
    retrievedGroups: [
      {
        groupId: "group-1",
        groupName: "Docs",
        docs: [
          {
            documentId: "doc-1",
            documentName: "Guide",
            versionId: "version-1",
            documentContext: {
              documentId: "doc-1",
              documentName: "Guide",
              canonicalTitle: "Guide",
              baseTitle: "Guide",
            },
            sourceContext: {
              libraryId: null,
              libraryVersion: null,
              sourcePath: null,
              sheetName: null,
              sourceGroupName: "Docs",
            },
            display: {
              documentLabel: "Guide",
              variantLabel: null,
              topicLabel: null,
              locationLabel: null,
            },
            relevanceScore: 0.92,
            chunkHits: 2,
            markdown: "### Guide > Authentication\n\nAuthentication excerpt",
            matchedSections: [
              { heading: "Guide > Authentication", score: 0.92 },
            ],
            citationCandidates: [
              {
                versionId: "version-1",
                sectionId: "section-1",
                sectionHeading: "Guide > Authentication",
                pageStart: 3,
                pageEnd: 3,
                excerpt: "Authentication excerpt",
                relevanceScore: 0.92,
              },
              {
                versionId: "version-1",
                sectionId: "section-1",
                sectionHeading: "Guide > Authentication",
                pageStart: 3,
                pageEnd: 3,
                excerpt: "Authentication excerpt",
                relevanceScore: 0.92,
              },
            ],
          },
        ],
      },
    ],
  });

  it("dedupes retrieval evidence into stable citation numbers", () => {
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({
      number: 1,
      documentId: "doc-1",
      versionId: "version-1",
      pageStart: 3,
      pageEnd: 3,
      sectionHeading: "Guide > Authentication",
    });
  });

  it("strips control markers from excerpts and infers missing page numbers", () => {
    const inferred = buildKnowledgeCitations({
      retrievedGroups: [
        {
          groupId: "group-1",
          groupName: "Docs",
          docs: [
            {
              documentId: "doc-2",
              documentName: "Law",
              versionId: "version-2",
              documentContext: {
                documentId: "doc-2",
                documentName: "Law",
                canonicalTitle: "Law",
                baseTitle: "Law",
              },
              sourceContext: {
                libraryId: null,
                libraryVersion: null,
                sourcePath: null,
                sheetName: null,
                sourceGroupName: "Docs",
              },
              display: {
                documentLabel: "Law",
                variantLabel: null,
                topicLabel: null,
                locationLabel: null,
              },
              relevanceScore: 0.88,
              chunkHits: 1,
              markdown: "Unused",
              citationCandidates: [
                {
                  versionId: "version-2",
                  sectionId: "section-2",
                  sectionHeading: "Pasal 1",
                  pageStart: null,
                  pageEnd: null,
                  excerpt: "<!--CTX_PAGE:9--> Vape termasuk barang kena cukai.",
                  relevanceScore: 0.88,
                },
              ],
            },
          ],
        },
      ],
    });

    expect(inferred[0]).toMatchObject({
      pageStart: 9,
      pageEnd: 9,
      excerpt: "Vape termasuk barang kena cukai.",
    });
  });

  it("flags missing and invalid citations", () => {
    const validation = validateKnowledgeCitationText({
      text: "Authentication uses passkeys.\n\nThis line cites a missing source [9].",
      citations,
    });

    expect(validation.isValid).toBe(false);
    expect(validation.missingCitations).toHaveLength(1);
    expect(validation.invalidCitationNumbers).toEqual([9]);
  });

  it("adds deterministic fallback citations to uncovered lines", () => {
    const output = enforceKnowledgeCitationCoverage({
      text: "Authentication uses passkeys.",
      citations,
    });

    expect(output).toContain("[1]");
    expect(
      validateKnowledgeCitationText({
        text: output,
        citations,
      }).isValid,
    ).toBe(true);
  });

  it("requires citations for short factual bullets and labels with values", () => {
    const output = enforceKnowledgeCitationCoverage({
      text: ["- Uses passkeys", "Status: enabled", "Summary:"].join("\n"),
      citations,
    });

    expect(output).toContain("- Uses passkeys [1]");
    expect(output).toContain("Status: enabled [1]");
    expect(output).toContain("Summary:");
    expect(
      validateKnowledgeCitationText({
        text: output,
        citations,
      }).isValid,
    ).toBe(true);
  });

  it("replaces a wrong existing citation with the better page-matched citation", () => {
    const multiPageCitations = [
      {
        ...citations[0],
        number: 1,
        pageStart: 3,
        pageEnd: 3,
        excerpt: "Traditional tobacco reporting before the vape update.",
      },
      {
        ...citations[0],
        number: 2,
        pageStart: 6,
        pageEnd: 6,
        excerpt: "Vape products are integrated into Hasil Tembakau reporting.",
      },
    ];

    const output = enforceKnowledgeCitationCoverage({
      text: "Vape products are integrated into Hasil Tembakau reporting [1].",
      citations: multiPageCitations,
    });

    expect(output).toContain("[2]");
    expect(output).not.toContain("[1].");
  });

  it("re-scores markdown table cells independently for PMK comparison rows", () => {
    const pmkCitations: ChatKnowledgeCitation[] = [
      {
        number: 1,
        groupId: "group-1",
        groupName: "LegalDocument",
        documentId: "doc-94",
        documentName: "94/PMK.04/2016",
        versionId: "version-94",
        sectionId: "section-hari-kerja-94",
        sectionHeading:
          "15. Hari Kerja di Lingkungan Direktorat Jenderal Bea dan",
        pageStart: 4,
        pageEnd: 4,
        excerpt:
          "15. Hari Kerja di Lingkungan Direktorat Jenderal Bea dan Cukai yang selanjutnya disebut Hari Kerja adalah hari yang dimulai dari hari Senin sampai dengah hari Jumat.",
        relevanceScore: 0.95,
      },
      {
        number: 2,
        groupId: "group-1",
        groupName: "LegalDocument",
        documentId: "doc-94",
        documentName: "94/PMK.04/2016",
        versionId: "version-94",
        sectionId: "section-data-94",
        sectionHeading:
          "15. Hari Kerja di Lingkungan Direktorat Jenderal Bea dan > d. merek hasil tembakau, harga jual eceran, 1s1",
        pageStart: 8,
        pageEnd: 8,
        excerpt:
          "d. merek hasil tembakau, harga jual eceran, 1s1 masing-masing kemasan, dan jumlah kemasan.",
        relevanceScore: 0.88,
      },
      {
        number: 3,
        groupId: "group-1",
        groupName: "LegalDocument",
        documentId: "doc-161",
        documentName: "161/PMK.04/2022",
        versionId: "version-161",
        sectionId: "section-hari-kerja-161",
        sectionHeading:
          "18. Harl Kerja di Lingkungan DirektoratJenderal Beadan",
        pageStart: 4,
        pageEnd: 4,
        excerpt:
          "18. Harl Kerja di Lingkungan DirektoratJenderal Beadan CukaiyangselanjutnyadisebutHarlKerjaadalahharl yangdimulaidarlharlSellinsampaidenganharlJumat.",
        relevanceScore: 0.94,
      },
      {
        number: 4,
        groupId: "group-1",
        groupName: "LegalDocument",
        documentId: "doc-161",
        documentName: "161/PMK.04/2022",
        versionId: "version-161",
        sectionId: "section-data-161",
        sectionHeading:
          "1. HasilTembakauuntukjenisHPTLberupatembakau > c. merekHasilTembakau,hargajualeceran,isimasing-",
        pageStart: 7,
        pageEnd: 7,
        excerpt:
          "c. merekHasilTembakau,hargajualeceran,isimasing-masingkemasan,danjumlahkemasan.",
        relevanceScore: 0.91,
      },
      {
        number: 5,
        groupId: "group-1",
        groupName: "LegalDocument",
        documentId: "doc-134",
        documentName: "134/PMK.04/2019",
        versionId: "version-134",
        sectionId: "section-hptl-134",
        sectionHeading: "tembakau jenis HPTL diatur dengan·Peraturan",
        pageStart: 4,
        pageEnd: 4,
        excerpt:
          "tembakau jenis HPTL diatur dengan Peraturan DirekturJenderal.",
        relevanceScore: 0.9,
      },
    ];

    const output = enforceKnowledgeCitationCoverage({
      text: [
        "| Aspek | PMK 94 | PMK 161 | PMK 134 |",
        "| --- | --- | --- | --- |",
        "| Perubahan | Senin - Jumat (5 hari) [2] | + Merek, HJE, Isi Kemasan, Jumlah Kemasan [5] | HPTL diatur dengan Peraturan Direktur Jenderal [4] |",
      ].join("\n"),
      citations: pmkCitations,
    });

    expect(output).toContain(
      "| Perubahan | Senin - Jumat (5 hari) [1] | + Merek, HJE, Isi Kemasan, Jumlah Kemasan [4] | HPTL diatur dengan Peraturan Direktur Jenderal [5] |",
    );
  });

  it("matches OCR-noisy PMK 161 hari kerja excerpts instead of drifting to HPTL pages", () => {
    const pmk161Citations: ChatKnowledgeCitation[] = [
      {
        number: 1,
        groupId: "group-1",
        groupName: "LegalDocument",
        documentId: "doc-161",
        documentName: "161/PMK.04/2022",
        versionId: "version-161",
        sectionId: "section-hari-kerja-161",
        sectionHeading:
          "18. Harl Kerja di Lingkungan DirektoratJenderal Beadan",
        pageStart: 4,
        pageEnd: 4,
        excerpt:
          "18. Harl Kerja di Lingkungan DirektoratJenderal Beadan CukaiyangselanjutnyadisebutHarlKerjaadalahharl yangdimulaidarlharlSellinsampaidenganharlJumat.",
        relevanceScore: 0.94,
      },
      {
        number: 2,
        groupId: "group-1",
        groupName: "LegalDocument",
        documentId: "doc-161",
        documentName: "161/PMK.04/2022",
        versionId: "version-161",
        sectionId: "section-hptl-161",
        sectionHeading:
          "18. Harl Kerja di Lingkungan DirektoratJenderal Beadan > j. HasilTembakauuntukjenisHPTLberupatembakau",
        pageStart: 5,
        pageEnd: 5,
        excerpt:
          "j. HasilTembakauuntukjenisHPTLberupatembakaumolasses yaitu pada saat proses pengolahan daun tembakau.",
        relevanceScore: 0.89,
      },
    ];

    const output = enforceKnowledgeCitationCoverage({
      text: "| Hari kerja pelaporan | Hari kerja sampai Jumat [2] |",
      citations: pmk161Citations,
    });

    expect(output).toContain(
      "| Hari kerja pelaporan | Hari kerja sampai Jumat [1] |",
    );
  });

  it("keeps PMK 161 pasal 3, pasal 7, and pasal 13 on distinct citation pages", () => {
    const legalCitations: ChatKnowledgeCitation[] = [
      {
        number: 1,
        groupId: "group-1",
        groupName: "LegalDocument",
        documentId: "doc-161",
        documentName: "161_PMK.04_2022.pdf",
        versionId: "version-161",
        sectionId: "section-pasal-3",
        sectionHeading: "Pasal 3",
        pageStart: 6,
        pageEnd: 6,
        excerpt:
          "Pengusaha Pabrik wajib memberitahukan secara berkala kepada Kepala Kantor mengenai barang kena cukai yang selesai dibuat.",
        relevanceScore: 0.96,
      },
      {
        number: 2,
        groupId: "group-1",
        groupName: "LegalDocument",
        documentId: "doc-161",
        documentName: "161_PMK.04_2022.pdf",
        versionId: "version-161",
        sectionId: "section-pasal-7",
        sectionHeading: "Pasal 7",
        pageStart: 7,
        pageEnd: 7,
        excerpt:
          "Pemberitahuan bulanan disampaikan oleh Pengusaha Pabrik paling lambat pada tanggal 10 (sepuluh) bulan berikutnya.",
        relevanceScore: 0.95,
      },
      {
        number: 3,
        groupId: "group-1",
        groupName: "LegalDocument",
        documentId: "doc-161",
        documentName: "161_PMK.04_2022.pdf",
        versionId: "version-161",
        sectionId: "section-pasal-13",
        sectionHeading: "Pasal 13",
        pageStart: 10,
        pageEnd: 10,
        excerpt:
          "Pengusaha Pabrik yang tidak menyampaikan pemberitahuan dikenai sanksi administrasi sesuai ketentuan peraturan perundang-undangan di bidang cukai.",
        relevanceScore: 0.94,
      },
    ];

    const output = enforceKnowledgeCitationCoverage({
      text: [
        "- Pelaporan awal ke Direktorat Jenderal Bea dan Cukai (Pasal 3) [2].",
        "- Pemberitahuan bulanan, paling lambat tanggal 10 bulan berikutnya (Pasal 7) [1].",
        "- Sanksi jika tidak patuh: denda administratif sesuai UU Cukai (Pasal 13) [1].",
      ].join("\n"),
      citations: legalCitations,
    });

    expect(output).toContain("(Pasal 3) [1].");
    expect(output).toContain("(Pasal 7) [2].");
    expect(output).toContain("(Pasal 13) [3].");
  });

  it("re-scores table references with exact pasal anchors instead of reusing an earlier page", () => {
    const legalCitations: ChatKnowledgeCitation[] = [
      {
        number: 1,
        groupId: "group-1",
        groupName: "LegalDocument",
        documentId: "doc-161",
        documentName: "161_PMK.04_2022.pdf",
        versionId: "version-161",
        sectionId: "section-pasal-3",
        sectionHeading: "Pasal 3",
        pageStart: 6,
        pageEnd: 6,
        excerpt:
          "Pengusaha Pabrik wajib memberitahukan secara berkala kepada Kepala Kantor mengenai barang kena cukai yang selesai dibuat.",
        relevanceScore: 0.96,
      },
      {
        number: 2,
        groupId: "group-1",
        groupName: "LegalDocument",
        documentId: "doc-161",
        documentName: "161_PMK.04_2022.pdf",
        versionId: "version-161",
        sectionId: "section-pasal-7",
        sectionHeading: "Pasal 7",
        pageStart: 7,
        pageEnd: 7,
        excerpt:
          "Pemberitahuan bulanan disampaikan oleh Pengusaha Pabrik paling lambat pada tanggal 10 (sepuluh) bulan berikutnya.",
        relevanceScore: 0.95,
      },
    ];

    const output = enforceKnowledgeCitationCoverage({
      text: [
        "| Aspek | Detail | Referensi |",
        "| --- | --- | --- |",
        "| Tenggat pelaporan | Paling lambat tanggal 10 bulan berikutnya | Pasal 7 [1] |",
      ].join("\n"),
      citations: legalCitations,
    });

    expect(output).toContain(
      "| Tenggat pelaporan | Paling lambat tanggal 10 bulan berikutnya [2] | Pasal 7 [2] |",
    );
  });

  it("preserves markdown table headers and drops detached citation-only lines around tables", () => {
    const tableCitations: ChatKnowledgeCitation[] = [
      {
        number: 1,
        groupId: "group-1",
        groupName: "LegalDocument",
        documentId: "doc-161",
        documentName: "161_PMK.04_2022.pdf",
        versionId: "version-161",
        sectionId: "section-pasal-3",
        sectionHeading: "Pasal 3",
        pageStart: 6,
        pageEnd: 6,
        excerpt:
          "Pengusaha Pabrik wajib memberitahukan secara berkala kepada Kepala Kantor mengenai barang kena cukai yang selesai dibuat.",
        relevanceScore: 0.96,
      },
      {
        number: 2,
        groupId: "group-1",
        groupName: "LegalDocument",
        documentId: "doc-161",
        documentName: "161_PMK.04_2022.pdf",
        versionId: "version-161",
        sectionId: "section-pasal-7",
        sectionHeading: "Pasal 7",
        pageStart: 7,
        pageEnd: 7,
        excerpt:
          "Pemberitahuan bulanan disampaikan oleh Pengusaha Pabrik paling lambat pada tanggal 10 (sepuluh) bulan berikutnya.",
        relevanceScore: 0.95,
      },
      {
        number: 3,
        groupId: "group-1",
        groupName: "LegalDocument",
        documentId: "doc-161",
        documentName: "161_PMK.04_2022.pdf",
        versionId: "version-161",
        sectionId: "section-pasal-13",
        sectionHeading: "Pasal 13",
        pageStart: 10,
        pageEnd: 10,
        excerpt:
          "Pengusaha Pabrik yang tidak menyampaikan pemberitahuan dikenai sanksi administrasi sesuai ketentuan peraturan perundang-undangan di bidang cukai.",
        relevanceScore: 0.94,
      },
    ];

    const finalized = normalizeKnowledgeCitationLayout({
      text: enforceKnowledgeCitationCoverage({
        text: [
          "| Tahap | Kewajiban Utama | Tenggat Waktu | Sanksi |",
          "[1][2][3]",
          "| --- | --- | --- | --- |",
          "| Pelaporan Bulanan | Pemberitahuan data | Paling lambat tgl 10 bulan berikutnya | Denda administratif |",
        ].join("\n"),
        citations: tableCitations,
      }),
      citations: tableCitations,
    });

    expect(finalized).toContain(
      "| Tahap | Kewajiban Utama | Tenggat Waktu | Sanksi |",
    );
    expect(finalized).toContain("| --- | --- | --- | --- |");
    expect(finalized).not.toContain("| Tahap | Kewajiban Utama [");
    expect(finalized).not.toContain("[1][2][3]");
  });

  it("replaces a wrong generic citation with the better same-document section citation", () => {
    const manualCitations: ChatKnowledgeCitation[] = [
      {
        number: 1,
        groupId: "group-1",
        groupName: "Docs",
        documentId: "doc-manual",
        documentName: "Product Manual",
        versionId: "version-manual",
        sectionId: "section-installation",
        sectionHeading: "Product Manual > Installation",
        pageStart: 2,
        pageEnd: 2,
        excerpt: "Install the desktop app from the downloads page and sign in.",
        relevanceScore: 0.95,
      },
      {
        number: 2,
        groupId: "group-1",
        groupName: "Docs",
        documentId: "doc-manual",
        documentName: "Product Manual",
        versionId: "version-manual",
        sectionId: "section-settings",
        sectionHeading: "Product Manual > Workspace Settings",
        pageStart: 5,
        pageEnd: 5,
        excerpt:
          "To enable automatic backup, open Settings > Backup and toggle Auto Backup.",
        relevanceScore: 0.92,
      },
    ];

    const output = enforceKnowledgeCitationCoverage({
      text: "To enable automatic backup, open Settings > Backup and toggle Auto Backup [1].",
      citations: manualCitations,
    });

    expect(output).toContain("[2].");
    expect(output).not.toContain("[1].");
  });

  it("validates missing citations inside markdown table cells", () => {
    const pmkCitations: ChatKnowledgeCitation[] = [
      {
        number: 1,
        groupId: "group-1",
        groupName: "LegalDocument",
        documentId: "doc-94",
        documentName: "94/PMK.04/2016",
        versionId: "version-94",
        sectionId: "section-hari-kerja-94",
        sectionHeading:
          "15. Hari Kerja di Lingkungan Direktorat Jenderal Bea dan",
        pageStart: 4,
        pageEnd: 4,
        excerpt:
          "15. Hari Kerja di Lingkungan Direktorat Jenderal Bea dan Cukai yang selanjutnya disebut Hari Kerja adalah hari yang dimulai dari hari Senin sampai dengah hari Jumat.",
        relevanceScore: 0.95,
      },
      {
        number: 2,
        groupId: "group-1",
        groupName: "LegalDocument",
        documentId: "doc-161",
        documentName: "161/PMK.04/2022",
        versionId: "version-161",
        sectionId: "section-data-161",
        sectionHeading:
          "1. HasilTembakauuntukjenisHPTLberupatembakau > c. merekHasilTembakau,hargajualeceran,isimasing-",
        pageStart: 7,
        pageEnd: 7,
        excerpt:
          "c. merekHasilTembakau,hargajualeceran,isimasing-masingkemasan,danjumlahkemasan.",
        relevanceScore: 0.91,
      },
    ];

    const validation = validateKnowledgeCitationText({
      text: [
        "| Aspek | PMK 94 | PMK 161 |",
        "| --- | --- | --- |",
        "| Perubahan | Senin - Jumat (5 hari) | + Merek, HJE, Isi Kemasan, Jumlah Kemasan [2] |",
      ].join("\n"),
      citations: pmkCitations,
    });

    expect(validation.isValid).toBe(false);
    expect(validation.missingCitations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line: "Senin - Jumat (5 hari)",
        }),
      ]),
    );
  });

  it("linkifies markers outside code blocks and inline code only", () => {
    const linked = linkifyKnowledgeCitationMarkers({
      text: [
        "Auth uses passkeys [1].",
        "",
        "`keep [1] raw`",
        "",
        "```md",
        "do not link [1]",
        "```",
      ].join("\n"),
      citations,
    });

    expect(linked).toContain("[1](knowledge://group-1/doc-1?");
    expect(linked).toContain("citationNumber=1");
    expect(linked).toContain("pageStart=3");
    expect(linked).toContain("`keep [1] raw`");
    expect(linked).toContain("do not link [1]");
  });

  it("can strip self-contained knowledge citation links back to plain markers", () => {
    const stripped = stripKnowledgeCitationLinks(
      "Auth uses passkeys [1](knowledge://group-1/doc-1?citationNumber=1&pageStart=3).",
    );

    expect(stripped).toBe("Auth uses passkeys [1].");
  });

  it("merges detached citation lines into the preceding sentence", () => {
    const normalized = normalizeKnowledgeCitationLayout({
      text: [
        "Authentication uses passkeys.",
        "[1]",
        "",
        "- Status: enabled",
        "[1]",
      ].join("\n"),
      citations,
    });

    expect(normalized).toBe(
      ["Authentication uses passkeys [1].", "", "- Status: enabled [1]"].join(
        "\n",
      ),
    );
  });

  it("does not duplicate citations when the line already ends with cited punctuation", () => {
    const normalized = normalizeKnowledgeCitationLayout({
      text: [
        "Authentication uses passkeys [1].",
        "",
        "Status: enabled [1][1].",
        "",
        "Recovery codes stay available [1][2][1][2].",
      ].join("\n"),
      citations,
    });

    expect(normalized).toBe(
      [
        "Authentication uses passkeys [1].",
        "",
        "Status: enabled [1].",
        "",
        "Recovery codes stay available [1][2].",
      ].join("\n"),
    );
  });

  it("repairs duplicated saved citation markers before linkifying hydrated history", () => {
    const linked = linkifyKnowledgeCitationMarkers({
      text: [
        "Authentication uses passkeys [1] [1].",
        "",
        "Recovery codes stay available [1][1].",
      ].join("\n"),
      citations,
    });

    expect(linked).toContain(
      "Authentication uses passkeys [1](knowledge://group-1/doc-1?",
    );
    expect(linked).not.toContain(
      "[1](knowledge://group-1/doc-1?citationNumber=1&pageStart=3&pageEnd=3&sectionHeading=Guide+%3E+Authentication&excerpt=Authentication+excerpt) [1](knowledge://group-1/doc-1?",
    );
    expect(linked.match(/\[1\]\(knowledge:\/\/group-1\/doc-1\?/g)).toHaveLength(
      2,
    );
  });

  it("removes trailing citation appendices unless explicitly preserved", () => {
    const appendixCitations = citations.map((citation) => ({
      ...citation,
      documentName: "Authentication Guide",
    }));
    const normalized = normalizeKnowledgeCitationLayout({
      text: [
        "Authentication uses passkeys [1]",
        "",
        "1. Authentication Guide",
        "[1]",
      ].join("\n"),
      citations: appendixCitations,
    });

    expect(normalized).toBe("Authentication uses passkeys [1]");
  });

  it("replaces the persisted assistant text with the finalized answer", () => {
    const message = applyFinalizedAssistantText(
      {
        id: "assistant-1",
        role: "assistant",
        metadata: {},
        parts: [
          { type: "reasoning", text: "thinking", state: "done" },
          { type: "text", text: "Draft answer", state: "done" },
        ],
      },
      "Final answer [1]",
      {
        knowledgeCitations: citations,
      },
    );

    expect(message.parts.find((part) => part.type === "text")).toMatchObject({
      text: expect.stringContaining(
        "[1](knowledge://group-1/doc-1?citationNumber=1",
      ),
    });
    expect((message.metadata as any).knowledgeCitations).toHaveLength(1);
  });

  it("can keep finalized client text plain while still patching citation metadata", () => {
    const message = applyFinalizedAssistantText(
      {
        id: "assistant-3",
        role: "assistant",
        metadata: {},
        parts: [{ type: "text", text: "Draft answer", state: "done" }],
      },
      "Final answer [1]",
      {
        knowledgeCitations: citations,
      },
      {
        linkifyCitations: false,
      },
    );

    expect(message.parts.find((part) => part.type === "text")).toMatchObject({
      text: "Final answer [1]",
    });
    expect((message.metadata as any).knowledgeCitations).toHaveLength(1);
  });

  it("preserves tool-call ordering when finalizing a multi-step assistant reply", () => {
    const message = applyFinalizedAssistantText(
      {
        id: "assistant-4",
        role: "assistant",
        metadata: {},
        parts: [
          { type: "text", text: "", state: "done" },
          {
            type: "tool-webSearch",
            toolCallId: "call-1",
            state: "output-available",
            input: { query: "passkeys" },
            output: { results: ["Guide"] },
          },
          { type: "text", text: "Draft final answer", state: "done" },
        ],
      } as any,
      "Final answer [1]",
      {
        knowledgeCitations: citations,
      },
    );

    expect(message.parts.map((part) => part.type)).toEqual([
      "text",
      "tool-webSearch",
      "text",
    ]);
    expect((message.parts[0] as any).text).toBe("");
    expect((message.parts[2] as any).text).toContain(
      "knowledge://group-1/doc-1?",
    );
  });

  it("can linkify hydrated assistant history and strip it for model reuse", () => {
    const hydrated = linkifyAssistantKnowledgeCitations({
      id: "assistant-2",
      role: "assistant",
      metadata: {
        knowledgeCitations: citations,
      },
      parts: [{ type: "text", text: "Final answer [1].", state: "done" }],
    });

    expect(hydrated.parts.find((part) => part.type === "text")).toMatchObject({
      text: expect.stringContaining("knowledge://group-1/doc-1?"),
    });

    const sanitized = stripAssistantKnowledgeCitationLinks(hydrated);
    expect(sanitized.parts.find((part) => part.type === "text")).toMatchObject({
      text: "Final answer [1].",
    });
  });

  it("can hydrate saved assistant history from persisted knowledge tool outputs", () => {
    const hydrated = linkifyAssistantKnowledgeCitations({
      id: "assistant-6",
      role: "assistant",
      parts: [
        {
          type: "tool-get_docs_group_1",
          toolCallId: "call-knowledge-1",
          state: "output-available",
          input: { query: "passkeys" },
          output: {
            source: "attached_agent_knowledge",
            hasResults: true,
            citations,
          },
        },
        { type: "text", text: "Final answer [1].", state: "done" },
      ],
    } as any);

    expect((hydrated.parts[1] as any).text).toContain(
      "knowledge://group-1/doc-1?",
    );
  });

  it("updates the trailing assistant answer when linkifying hydrated history", () => {
    const hydrated = linkifyAssistantKnowledgeCitations({
      id: "assistant-5",
      role: "assistant",
      metadata: {
        knowledgeCitations: citations,
      },
      parts: [
        { type: "text", text: "", state: "done" },
        {
          type: "tool-webSearch",
          toolCallId: "call-2",
          state: "output-available",
          input: { query: "passkeys" },
          output: { results: ["Guide"] },
        },
        { type: "text", text: "Final answer [1].", state: "done" },
      ],
    } as any);

    expect((hydrated.parts[0] as any).text).toBe("");
    expect((hydrated.parts[2] as any).text).toContain(
      "knowledge://group-1/doc-1?",
    );

    const sanitized = stripAssistantKnowledgeCitationLinks(hydrated);
    expect((sanitized.parts[2] as any).text).toBe("Final answer [1].");
  });
});
