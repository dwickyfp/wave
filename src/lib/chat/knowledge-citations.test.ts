import { describe, expect, it } from "vitest";
import {
  applyFinalizedAssistantText,
  buildKnowledgeCitations,
  enforceKnowledgeCitationCoverage,
  linkifyKnowledgeCitationMarkers,
  linkifyAssistantKnowledgeCitations,
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
});
