import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ChatKnowledgeCitation } from "app-types/chat";
import {
  enforceKnowledgeCitationCoverage,
  normalizeKnowledgeCitationLayout,
} from "lib/chat/knowledge-citations";
import { Markdown } from "./markdown";

vi.mock("server-only", () => ({}));

describe("Markdown citations", () => {
  it("preserves knowledge:// citation links for the inline citation renderer", () => {
    const citations: ChatKnowledgeCitation[] = [
      {
        number: 1,
        groupId: "group-1",
        groupName: "Docs",
        documentId: "doc-1",
        documentName: "Tax Guide",
        versionId: "version-1",
        sectionId: "section-1",
        sectionHeading: "Vape tax",
        pageStart: 12,
        pageEnd: 12,
        excerpt: "Vape is taxed.",
        relevanceScore: 0.93,
      },
    ];

    const html = renderToStaticMarkup(
      <Markdown knowledgeCitations={citations}>
        {"Vape is taxed [1]."}
      </Markdown>,
    );

    expect(html).toContain("<button");
    expect(html).toContain(">1<");
    expect(html).not.toContain('href=""');
    expect(html).not.toContain("<svg");
  });

  it("renders self-contained citation links without relying on citation-only hrefs", () => {
    const citations: ChatKnowledgeCitation[] = [
      {
        number: 1,
        groupId: "group-1",
        groupName: "Docs",
        documentId: "doc-1",
        documentName: "Tax Guide",
        versionId: "version-1",
        sectionId: "section-1",
        sectionHeading: "Vape tax",
        pageStart: 12,
        pageEnd: 12,
        excerpt: "Vape is taxed.",
        relevanceScore: 0.93,
      },
    ];

    const html = renderToStaticMarkup(
      <Markdown knowledgeCitations={citations}>
        {
          "Vape is taxed [1](knowledge://group-1/doc-1?citationNumber=1&documentName=Tax%20Guide&pageStart=12&pageEnd=12)."
        }
      </Markdown>,
    );

    expect(html).toContain("<button");
    expect(html).toContain(">1<");
  });

  it("can render without fade-in wrappers for streaming content", () => {
    const html = renderToStaticMarkup(
      <Markdown animate={false}>{"Streaming answer text."}</Markdown>,
    );

    expect(html).not.toContain("fade-in");
    expect(html).toContain("Streaming answer text.");
  });

  it("keeps citations interactive in non-animated streaming mode", () => {
    const citations: ChatKnowledgeCitation[] = [
      {
        number: 1,
        groupId: "group-1",
        groupName: "Docs",
        documentId: "doc-1",
        documentName: "Tax Guide",
        versionId: "version-1",
        sectionId: "section-1",
        sectionHeading: "Vape tax",
        pageStart: 12,
        pageEnd: 12,
        excerpt: "Vape is taxed.",
        relevanceScore: 0.93,
      },
    ];

    const html = renderToStaticMarkup(
      <Markdown animate={false} knowledgeCitations={citations}>
        {"Vape is taxed [1]."}
      </Markdown>,
    );

    expect(html).toContain("<button");
    expect(html).not.toContain('href=""');
    expect(html).not.toContain("fade-in");
  });

  it("keeps markdown rendering active during streaming", () => {
    const html = renderToStaticMarkup(
      <Markdown animate={false} streaming>
        {"**Bold** item\n\n- first"}
      </Markdown>,
    );

    expect(html).toContain("font-semibold");
    expect(html).toContain("Bold");
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
  });

  it("renders mermaid fences with the dedicated mermaid frame", () => {
    const html = renderToStaticMarkup(
      <Markdown animate={false}>
        {"```mermaid\nflowchart TD\nA[Start] --> B[End]\n```"}
      </Markdown>,
    );

    expect(html).toContain('data-mermaid-block="true"');
    expect(html).not.toContain('data-code-frame="true"');
    expect(html).toContain("Detailed diagram viewer");
  });

  it("renders mermaid fences in the snowflake variant with the mermaid frame", () => {
    const html = renderToStaticMarkup(
      <Markdown animate={false} variant="snowflake">
        {"```mermaid\nflowchart TD\nA[Start] --> B[End]\n```"}
      </Markdown>,
    );

    expect(html).toContain('data-mermaid-block="true"');
    expect(html).not.toContain('data-code-frame="true"');
  });

  it("renders citations inside markdown tables as interactive buttons", () => {
    const citations: ChatKnowledgeCitation[] = [
      {
        number: 1,
        groupId: "group-1",
        groupName: "Docs",
        documentId: "doc-1",
        documentName: "Tax Guide",
        versionId: "version-1",
        sectionId: "section-1",
        sectionHeading: "Vape tax",
        pageStart: 12,
        pageEnd: 12,
        excerpt: "Vape is taxed.",
        relevanceScore: 0.93,
      },
    ];

    const html = renderToStaticMarkup(
      <Markdown animate={false} knowledgeCitations={citations}>
        {"| Item |\n| --- |\n| Vape [1] |"}
      </Markdown>,
    );

    expect(html).toContain("<table");
    expect(html).toContain("<button");
    expect(html).not.toContain('target="_blank"');
  });

  it("keeps saved citation tables renderable after hydrated history linkification", () => {
    const citations: ChatKnowledgeCitation[] = [
      {
        number: 1,
        groupId: "group-1",
        groupName: "Docs",
        documentId: "doc-1",
        documentName: "Compliance Guide",
        versionId: "version-1",
        sectionId: "section-1",
        sectionHeading: "Initial reporting",
        pageStart: 6,
        pageEnd: 6,
        excerpt: "Initial reporting to customs office.",
        relevanceScore: 0.94,
      },
      {
        number: 2,
        groupId: "group-1",
        groupName: "Docs",
        documentId: "doc-1",
        documentName: "Compliance Guide",
        versionId: "version-1",
        sectionId: "section-2",
        sectionHeading: "Monthly reporting",
        pageStart: 7,
        pageEnd: 7,
        excerpt: "Monthly reporting due by the tenth day.",
        relevanceScore: 0.93,
      },
      {
        number: 3,
        groupId: "group-1",
        groupName: "Docs",
        documentId: "doc-1",
        documentName: "Compliance Guide",
        versionId: "version-1",
        sectionId: "section-3",
        sectionHeading: "Administrative sanctions",
        pageStart: 10,
        pageEnd: 10,
        excerpt: "Administrative sanctions for missed notices.",
        relevanceScore: 0.92,
      },
    ];

    const savedText = normalizeKnowledgeCitationLayout({
      text: enforceKnowledgeCitationCoverage({
        text: [
          "| Tahap | Kewajiban Utama | Tenggat Waktu | Sanksi |",
          "[1][2][3]",
          "| --- | --- | --- | --- |",
          "| Pelaporan Bulanan | Pemberitahuan data | Paling lambat tgl 10 bulan berikutnya | Denda administratif |",
        ].join("\n"),
        citations,
      }),
      citations,
    });

    const html = renderToStaticMarkup(
      <Markdown animate={false} knowledgeCitations={citations}>
        {savedText}
      </Markdown>,
    );

    expect(html).toContain("<table");
    expect(html).toContain("<button");
    expect(html).not.toContain("| --- | --- | --- | --- |");
  });

  it("repairs previously malformed saved citation tables during hydrated rendering", () => {
    const citations: ChatKnowledgeCitation[] = [
      {
        number: 1,
        groupId: "group-1",
        groupName: "Docs",
        documentId: "doc-1",
        documentName: "Compliance Guide",
        versionId: "version-1",
        sectionId: "section-1",
        sectionHeading: "Initial reporting",
        pageStart: 6,
        pageEnd: 6,
        excerpt: "Initial reporting to customs office.",
        relevanceScore: 0.94,
      },
      {
        number: 2,
        groupId: "group-1",
        groupName: "Docs",
        documentId: "doc-1",
        documentName: "Compliance Guide",
        versionId: "version-1",
        sectionId: "section-2",
        sectionHeading: "Monthly reporting",
        pageStart: 7,
        pageEnd: 7,
        excerpt: "Monthly reporting due by the tenth day.",
        relevanceScore: 0.93,
      },
      {
        number: 3,
        groupId: "group-1",
        groupName: "Docs",
        documentId: "doc-1",
        documentName: "Compliance Guide",
        versionId: "version-1",
        sectionId: "section-3",
        sectionHeading: "Administrative sanctions",
        pageStart: 10,
        pageEnd: 10,
        excerpt: "Administrative sanctions for missed notices.",
        relevanceScore: 0.92,
      },
    ];

    const malformedSavedText = [
      "| Tahap | Kewajiban Utama [1] | Tenggat Waktu [2] | Sanksi | [1][2] |",
      "| --- | --- | --- | --- |",
      "| Pelaporan Bulanan | Pemberitahuan data [2] | Paling lambat tgl 10 bulan berikutnya [2] | Denda administratif [3] | [2][3] |",
    ].join("\n");

    const html = renderToStaticMarkup(
      <Markdown animate={false} knowledgeCitations={citations}>
        {malformedSavedText}
      </Markdown>,
    );

    expect(html).toContain("<table");
    expect(html).toContain("<button");
    expect(html).not.toContain("| Tahap |");
  });

  it("does not linkify citation markers during streaming", () => {
    const citations: ChatKnowledgeCitation[] = [
      {
        number: 1,
        groupId: "group-1",
        groupName: "Docs",
        documentId: "doc-1",
        documentName: "Tax Guide",
        versionId: "version-1",
        sectionId: "section-1",
        sectionHeading: "Vape tax",
        pageStart: 12,
        pageEnd: 12,
        excerpt: "Vape is taxed.",
        relevanceScore: 0.93,
      },
    ];

    const html = renderToStaticMarkup(
      <Markdown animate={false} streaming knowledgeCitations={citations}>
        {"Vape is taxed [1]."}
      </Markdown>,
    );

    expect(html).not.toContain("<button");
    expect(html).toContain("[1]");
  });
});
