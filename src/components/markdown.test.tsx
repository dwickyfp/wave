import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ChatKnowledgeCitation } from "app-types/chat";
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
