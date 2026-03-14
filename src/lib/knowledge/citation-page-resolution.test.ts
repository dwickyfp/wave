import { describe, expect, it } from "vitest";
import { inferCitationPageFromMarkdown } from "./citation-page-resolution";

describe("inferCitationPageFromMarkdown", () => {
  it("pins PMK 161 pasal 7 monthly reporting to page 7", () => {
    const markdown = [
      "<!--CTX_PAGE:6-->",
      "Pasal 3",
      "Pengusaha Pabrik wajib memberitahukan secara berkala kepada Kepala Kantor mengenai barang kena cukai yang selesai dibuat.",
      "",
      "<!--CTX_PAGE:7-->",
      "Pasal 7",
      "Pemberitahuan bulanan sebagaimana dimaksud dalam Pasal 5 ayat (1) huruf b disampaikan oleh Pengusaha Pabrik paling lambat pada tanggal 10 (sepuluh) bulan berikutnya.",
      "",
      "<!--CTX_PAGE:10-->",
      "Pasal 13",
      "Pengusaha Pabrik yang tidak menyampaikan pemberitahuan dikenai sanksi administrasi sesuai ketentuan peraturan perundang-undangan di bidang cukai.",
    ].join("\n");

    expect(
      inferCitationPageFromMarkdown({
        markdown,
        snippets: [
          "Pasal 7",
          "Pemberitahuan bulanan, paling lambat tanggal 10 bulan berikutnya.",
        ],
      }),
    ).toMatchObject({
      pageNumber: 7,
      usedLegalReference: true,
    });
  });

  it("pins PMK 161 pasal 13 sanctions to page 10", () => {
    const markdown = [
      "<!--CTX_PAGE:6-->",
      "Pasal 3",
      "Pengusaha Pabrik wajib memberitahukan secara berkala kepada Kepala Kantor mengenai barang kena cukai yang selesai dibuat.",
      "",
      "<!--CTX_PAGE:7-->",
      "Pasal 7",
      "Pemberitahuan bulanan paling lambat pada tanggal 10 (sepuluh) bulan berikutnya.",
      "",
      "<!--CTX_PAGE:10-->",
      "Pasal 13",
      "Pengusaha Pabrik yang tidak menyampaikan pemberitahuan dikenai sanksi administrasi sesuai ketentuan peraturan perundang-undangan di bidang cukai.",
    ].join("\n");

    expect(
      inferCitationPageFromMarkdown({
        markdown,
        snippets: [
          "Pasal 13",
          "Sanksi jika tidak patuh: denda administratif sesuai UU Cukai.",
        ],
      }),
    ).toMatchObject({
      pageNumber: 10,
      usedLegalReference: true,
    });
  });

  it("pins PMK 94 hari kerja Monday-Friday text to page 4", () => {
    const markdown = [
      "<!--CTX_PAGE:3-->",
      "Ketentuan umum lainnya.",
      "",
      "<!--CTX_PAGE:4-->",
      "15. Hari Kerja di Lingkungan Direktorat Jenderal Bea dan Cukai yang selanjutnya disebut Hari Kerja adalah hari yang dimulai dari hari Senin sampai dengan hari Jumat.",
      "",
      "<!--CTX_PAGE:8-->",
      "d. merek hasil tembakau, harga jual eceran, isi masing-masing kemasan, dan jumlah kemasan.",
    ].join("\n");

    expect(
      inferCitationPageFromMarkdown({
        markdown,
        snippets: [
          "Hari Kerja",
          "Hari kerja dimulai dari hari Senin sampai dengan hari Jumat.",
        ],
      }),
    ).toMatchObject({
      pageNumber: 4,
    });
  });

  it("pins PMK 134 HPTL director general rule to page 4", () => {
    const markdown = [
      "<!--CTX_PAGE:2-->",
      "Ketentuan awal perubahan.",
      "",
      "<!--CTX_PAGE:4-->",
      "Hasil Tembakau untuk jenis HPTL diatur dengan Peraturan Direktur Jenderal.",
      "",
      "<!--CTX_PAGE:6-->",
      "Ketentuan tarif lanjutan.",
    ].join("\n");

    expect(
      inferCitationPageFromMarkdown({
        markdown,
        snippets: [
          "HPTL",
          "Hasil Tembakau untuk jenis HPTL diatur dengan Peraturan Direktur Jenderal.",
        ],
      }),
    ).toMatchObject({
      pageNumber: 4,
    });
  });

  it("pins a general product manual citation to the exact settings page", () => {
    const markdown = [
      "<!--CTX_PAGE:2-->",
      "Installation",
      "Connect the device to power and wait for the status light.",
      "",
      "<!--CTX_PAGE:5-->",
      "Workspace Settings",
      "To enable automatic backup, open Settings > Backup and toggle Auto Backup.",
      "",
      "<!--CTX_PAGE:8-->",
      "Troubleshooting",
      "If the backup fails, restart the device and retry.",
    ].join("\n");

    expect(
      inferCitationPageFromMarkdown({
        markdown,
        snippets: [
          "Workspace Settings",
          "Open Settings > Backup and toggle Auto Backup.",
        ],
      }),
    ).toMatchObject({
      pageNumber: 5,
      usedLegalReference: false,
    });
  });
});
