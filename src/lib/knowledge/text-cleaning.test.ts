import { describe, expect, it } from "vitest";
import { formatExtractedPageToMarkdown } from "./document-quality";
import { normalizeStructuredMarkdown } from "./markdown-structurer";
import { normalizeWhitespaceArtifacts } from "./text-cleaning";

describe("knowledge text cleaning", () => {
  it("decodes html whitespace entities into regular spaces", () => {
    expect(
      normalizeWhitespaceArtifacts(
        "PT BANK&nbsp;&nbsp;&nbsp;CENTRAL ASIA&#160;Tbk&#xA0;DAN ENTITAS ANAK",
      ),
    ).toBe("PT BANK   CENTRAL ASIA Tbk DAN ENTITAS ANAK");
  });

  it("collapses nbsp-heavy extracted page lines into readable markdown", () => {
    expect(
      formatExtractedPageToMarkdown(
        "PT BANK CENTRAL ASIA Tbk&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Lampiran 5/107",
      ),
    ).toBe("PT BANK CENTRAL ASIA Tbk Lampiran 5/107");
  });

  it("removes nbsp artifacts from structured markdown without touching indented code", () => {
    const input = [
      "PT BANK CENTRAL ASIA Tbk&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Lampiran 5/107",
      "",
      '    const label = "A&nbsp;&nbsp;B";',
    ].join("\n");

    expect(normalizeStructuredMarkdown(input)).toBe(
      [
        "PT BANK CENTRAL ASIA Tbk Lampiran 5/107",
        "",
        '    const label = "A  B";',
      ].join("\n"),
    );
  });
});
