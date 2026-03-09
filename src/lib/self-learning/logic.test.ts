import { describe, expect, it } from "vitest";
import {
  buildContradictionFingerprint,
  buildMemoryFingerprint,
  computeCompositeScore,
  getImplicitSignalScore,
  normalizeLearningText,
  renderLearnedUserPersonalizationPrompt,
  renderPersonalizationKnowledgeMarkdown,
} from "./logic";

describe("self-learning logic", () => {
  it("normalizes whitespace and casing for learning text", () => {
    expect(normalizeLearningText("  Prefer   Short\nReplies  ")).toBe(
      "prefer short replies",
    );
  });

  it("generates stable memory fingerprints for equivalent content", () => {
    const first = buildMemoryFingerprint({
      category: "style",
      title: "Short replies",
      content: "Prefer short, direct answers.",
    });
    const second = buildMemoryFingerprint({
      category: "STYLE",
      title: " short   replies ",
      content: "prefer short, direct answers.",
    });

    expect(first).toBe(second);
  });

  it("groups contradictions using the provided hint when available", () => {
    const first = buildContradictionFingerprint({
      category: "format",
      hint: "response length",
      title: "Use bullet lists",
    });
    const second = buildContradictionFingerprint({
      category: "format",
      hint: " Response   Length ",
      title: "Write prose paragraphs",
    });

    expect(first).toBe(second);
  });

  it("weights explicit signals above llm and implicit signals", () => {
    expect(
      computeCompositeScore({
        explicitScore: 1,
        llmScore: 0.5,
        implicitScore: 0,
      }),
    ).toBe(0.65);

    expect(
      computeCompositeScore({
        explicitScore: 4,
        llmScore: -1,
        implicitScore: 0.5,
      }),
    ).toBe(0.525);
  });

  it("returns the expected implicit signal ordering", () => {
    expect(getImplicitSignalScore("regenerate_response")).toBeGreaterThan(
      getImplicitSignalScore("delete_response"),
    );
    expect(getImplicitSignalScore("delete_response")).toBeGreaterThan(
      getImplicitSignalScore("follow_up_continue"),
    );
  });

  it("renders a bounded personalization prompt", () => {
    const prompt = renderLearnedUserPersonalizationPrompt(
      [
        { title: "A", content: "First" },
        { title: "B", content: "Second" },
        { title: "C", content: "Third" },
      ] as any,
      2,
    );

    expect(prompt).toContain("<learned_user_personalization>");
    expect(prompt).toContain("1. A: First");
    expect(prompt).toContain("2. B: Second");
    expect(prompt).not.toContain("3. C: Third");
  });

  it("renders empty personalization prompt as false", () => {
    expect(
      renderLearnedUserPersonalizationPrompt([
        { title: "A", content: "   " },
      ] as any),
    ).toBe(false);
  });

  it("renders personalization knowledge markdown with categories", () => {
    const markdown = renderPersonalizationKnowledgeMarkdown([
      {
        title: "Keep it concise",
        category: "style",
        content: "Prefer short paragraphs and direct wording.",
      },
    ] as any);

    expect(markdown).toContain("# Emma Personalization Memory");
    expect(markdown).toContain("## Keep it concise");
    expect(markdown).toContain("- Category: style");
    expect(markdown).toContain("- Guidance: Prefer short paragraphs");
  });
});
