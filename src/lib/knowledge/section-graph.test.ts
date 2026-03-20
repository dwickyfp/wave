import { describe, expect, it } from "vitest";
import {
  buildKnowledgeSectionGraph,
  SECTION_GRAPH_VERSION,
} from "./section-graph";

function makeLongParagraph(label: string, count: number) {
  return Array.from(
    { length: count },
    (_, index) =>
      `${label} paragraph ${index + 1} explains the section context in detail for retrieval accuracy.`,
  ).join("\n\n");
}

describe("section-graph", () => {
  it("creates introduction, heading hierarchy, and split section parts", () => {
    const markdown = `
Intro text before any heading so the graph needs a synthetic introduction.

# Overview

Top level summary.

## Installation

Install guidance starts here.

\`\`\`ts
const config = {
  apiKey: "demo",
};
\`\`\`

| Env | Value |
| --- | --- |
| NODE_ENV | production |

${makeLongParagraph("Install", 220)}

### Advanced

Advanced nested guidance.
`.trim();

    const sections = buildKnowledgeSectionGraph(markdown, "doc-1", "group-1");

    expect(SECTION_GRAPH_VERSION).toBe(2);

    const introduction = sections.find(
      (section) => section.headingPath === "Introduction",
    );
    expect(introduction).toBeDefined();
    expect(introduction?.parentSectionId).toBeNull();

    const overview = sections.find(
      (section) => section.headingPath === "Overview",
    );
    expect(overview).toBeDefined();

    const installationParts = sections.filter(
      (section) => section.headingPath === "Overview > Installation",
    );
    expect(installationParts.length).toBeGreaterThan(1);
    expect(installationParts[0]?.parentSectionId).toBe(overview?.id);
    expect(installationParts[1]?.prevSectionId).toBe(installationParts[0]?.id);
    expect(installationParts[0]?.nextSectionId).toBe(installationParts[1]?.id);

    const advanced = sections.find(
      (section) => section.headingPath === "Overview > Installation > Advanced",
    );
    expect(advanced?.parentSectionId).toBe(installationParts[0]?.id);

    const codeBlockPart = installationParts.find((section) =>
      section.content.includes("const config"),
    );
    expect(codeBlockPart?.content.match(/```/g)?.length).toBe(2);

    const tablePart = installationParts.find((section) =>
      section.content.includes("| Env | Value |"),
    );
    expect(tablePart?.content).toContain("| NODE_ENV | production |");
  });

  it("creates synthetic Part sections for headingless documents", () => {
    const markdown = makeLongParagraph("Headingless", 260);

    const sections = buildKnowledgeSectionGraph(markdown, "doc-2", "group-1");

    expect(sections.length).toBeGreaterThan(1);
    expect(sections[0]?.heading).toBe("Part 1");
    expect(sections[1]?.heading).toBe("Part 2");
    expect(sections[1]?.prevSectionId).toBe(sections[0]?.id);
  });

  it("tracks page spans from hidden page markers", () => {
    const markdown = `
<!--CTX_PAGE:1-->
# Guide

Intro content.

<!--CTX_PAGE:2-->
## Setup

Step one.
`.trim();

    const sections = buildKnowledgeSectionGraph(markdown, "doc-3", "group-1");
    const guide = sections.find((section) => section.headingPath === "Guide");
    const setup = sections.find(
      (section) => section.headingPath === "Guide > Setup",
    );

    expect(guide?.pageStart).toBe(1);
    expect(guide?.pageEnd).toBe(1);
    expect(setup?.pageStart).toBe(2);
    expect(setup?.pageEnd).toBe(2);
  });

  it("groups financial statement note continuations instead of table-like pseudo headings", () => {
    const markdown = `
<!--CTX_PAGE:63-->
14. EFEK-EFEK UNTUK TUJUAN INVESTASI

a. Berdasarkan jenis

Obligasi pemerintah dan MTN.

<!--CTX_PAGE:64-->
14. EFEK-EFEK UNTUK TUJUAN INVESTASI(lanjutan)

Rincian obligasi lanjutan.

<!--CTX_PAGE:65-->
b. Berdasarkan mata uang

Rupiah dan valuta asing.
`.trim();

    const sections = buildKnowledgeSectionGraph(markdown, "doc-fs", "group-1", {
      classification: {
        isFinancialStatement: true,
        noteHeadingCount: 2,
        pageCount: 3,
        matchedPhrases: ["notes to the financial statements"],
      },
    });
    const noteSections = sections.filter(
      (section) => section.noteNumber === "14",
    );

    expect(noteSections.length).toBeGreaterThan(1);
    expect(
      noteSections.some(
        (section) =>
          section.noteTitle === "EFEK-EFEK UNTUK TUJUAN INVESTASI" &&
          section.pageStart === 63 &&
          section.pageEnd === 64,
      ),
    ).toBe(true);
    expect(noteSections.some((section) => section.noteSubsection === "b")).toBe(
      true,
    );
    expect(
      sections.some((section) =>
        section.headingPath.includes("Obligasi pemerintah dan MTN"),
      ),
    ).toBe(false);
  });
});
