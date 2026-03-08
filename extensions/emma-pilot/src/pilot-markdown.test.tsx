import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parsePilotMarkdownBlocks, PilotMarkdown } from "./pilot-markdown";

describe("pilot markdown", () => {
  it("parses paragraphs, lists, and code fences", () => {
    expect(
      parsePilotMarkdownBlocks(
        [
          "# Title",
          "",
          "Hello **Emma**",
          "",
          "- First",
          "- Second",
          "",
          "```ts",
          "const x = 1;",
          "```",
        ].join("\n"),
      ),
    ).toEqual([
      {
        type: "heading",
        depth: 1,
        text: "Title",
      },
      {
        type: "paragraph",
        text: "Hello **Emma**",
      },
      {
        type: "list",
        ordered: false,
        items: ["First", "Second"],
      },
      {
        type: "code",
        language: "ts",
        text: "const x = 1;",
      },
    ]);
  });

  it("renders common markdown without react-markdown", () => {
    const html = renderToStaticMarkup(
      <PilotMarkdown>
        {
          "Hello **Emma** with [docs](https://example.com)\n\n- One\n- Two\n\n`code`"
        }
      </PilotMarkdown>,
    );

    expect(html).toContain("<p>Hello <strong>Emma</strong> with ");
    expect(html).toContain(
      '<a href="https://example.com" target="_blank" rel="noreferrer">docs</a>',
    );
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>One</li>");
    expect(html).toContain("<code>code</code>");
  });
});
