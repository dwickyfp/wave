import { Fragment, type PropsWithChildren, type ReactNode } from "react";

type PilotMarkdownBlock =
  | {
      type: "heading";
      depth: number;
      text: string;
    }
  | {
      type: "paragraph";
      text: string;
    }
  | {
      type: "code";
      language?: string;
      text: string;
    }
  | {
      type: "list";
      ordered: boolean;
      items: string[];
    };

function isBlankLine(line: string) {
  return line.trim().length === 0;
}

function parseListMarker(line: string) {
  const orderedMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
  if (orderedMatch) {
    return {
      ordered: true,
      content: orderedMatch[2] ?? "",
    };
  }

  const unorderedMatch = line.match(/^\s*[-*+]\s+(.*)$/);
  if (unorderedMatch) {
    return {
      ordered: false,
      content: unorderedMatch[1] ?? "",
    };
  }

  return null;
}

function collectParagraph(lines: string[], startIndex: number) {
  const paragraphLines: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (
      isBlankLine(line) ||
      /^```/.test(line) ||
      /^\s{0,3}#{1,6}\s+/.test(line) ||
      Boolean(parseListMarker(line))
    ) {
      break;
    }

    paragraphLines.push(line.trim());
    index += 1;
  }

  return {
    block: {
      type: "paragraph",
      text: paragraphLines.join(" "),
    } satisfies PilotMarkdownBlock,
    nextIndex: index,
  };
}

function collectList(lines: string[], startIndex: number) {
  const firstMarker = parseListMarker(lines[startIndex] ?? "");
  if (!firstMarker) {
    return null;
  }

  const items: string[] = [firstMarker.content.trim()];
  let index = startIndex + 1;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (isBlankLine(line)) {
      break;
    }

    const marker = parseListMarker(line);
    if (!marker) {
      const previousIndex = items.length - 1;
      items[previousIndex] = `${items[previousIndex]} ${line.trim()}`.trim();
      index += 1;
      continue;
    }

    if (marker.ordered !== firstMarker.ordered) {
      break;
    }

    items.push(marker.content.trim());
    index += 1;
  }

  return {
    block: {
      type: "list",
      ordered: firstMarker.ordered,
      items,
    } satisfies PilotMarkdownBlock,
    nextIndex: index,
  };
}

function collectCodeFence(lines: string[], startIndex: number) {
  const openingLine = lines[startIndex] ?? "";
  const language = openingLine.slice(3).trim() || undefined;
  const codeLines: string[] = [];
  let index = startIndex + 1;

  while (index < lines.length && !/^```/.test(lines[index] ?? "")) {
    codeLines.push(lines[index] ?? "");
    index += 1;
  }

  return {
    block: {
      type: "code",
      language,
      text: codeLines.join("\n"),
    } satisfies PilotMarkdownBlock,
    nextIndex: index < lines.length ? index + 1 : index,
  };
}

export function parsePilotMarkdownBlocks(markdown: string) {
  const normalized = markdown.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return [] as PilotMarkdownBlock[];
  }

  const lines = normalized.split("\n");
  const blocks: PilotMarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (isBlankLine(line)) {
      index += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const result = collectCodeFence(lines, index);
      blocks.push(result.block);
      index = result.nextIndex;
      continue;
    }

    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        depth: headingMatch[1]?.length ?? 1,
        text: headingMatch[2]?.trim() ?? "",
      });
      index += 1;
      continue;
    }

    const listResult = collectList(lines, index);
    if (listResult) {
      blocks.push(listResult.block);
      index = listResult.nextIndex;
      continue;
    }

    const paragraphResult = collectParagraph(lines, index);
    blocks.push(paragraphResult.block);
    index = paragraphResult.nextIndex;
  }

  return blocks;
}

function renderInlineNodes(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;
  let tokenIndex = 0;

  const pushText = (value: string) => {
    if (value) {
      nodes.push(value);
    }
  };

  while (index < text.length) {
    if (text.startsWith("**", index)) {
      const closingIndex = text.indexOf("**", index + 2);
      if (closingIndex > index + 2) {
        nodes.push(
          <strong key={`${keyPrefix}-strong-${tokenIndex}`}>
            {renderInlineNodes(
              text.slice(index + 2, closingIndex),
              `${keyPrefix}-strong-${tokenIndex}`,
            )}
          </strong>,
        );
        index = closingIndex + 2;
        tokenIndex += 1;
        continue;
      }
    }

    if (text[index] === "*" || text[index] === "_") {
      const marker = text[index];
      const closingIndex = text.indexOf(marker, index + 1);
      if (closingIndex > index + 1) {
        nodes.push(
          <em key={`${keyPrefix}-em-${tokenIndex}`}>
            {renderInlineNodes(
              text.slice(index + 1, closingIndex),
              `${keyPrefix}-em-${tokenIndex}`,
            )}
          </em>,
        );
        index = closingIndex + 1;
        tokenIndex += 1;
        continue;
      }
    }

    if (text[index] === "`") {
      const closingIndex = text.indexOf("`", index + 1);
      if (closingIndex > index + 1) {
        nodes.push(
          <code key={`${keyPrefix}-code-${tokenIndex}`}>
            {text.slice(index + 1, closingIndex)}
          </code>,
        );
        index = closingIndex + 1;
        tokenIndex += 1;
        continue;
      }
    }

    if (text[index] === "[") {
      const closingLabelIndex = text.indexOf("](", index + 1);
      const closingHrefIndex =
        closingLabelIndex >= 0 ? text.indexOf(")", closingLabelIndex + 2) : -1;

      if (
        closingLabelIndex > index + 1 &&
        closingHrefIndex > closingLabelIndex
      ) {
        const label = text.slice(index + 1, closingLabelIndex);
        const href = text.slice(closingLabelIndex + 2, closingHrefIndex).trim();
        nodes.push(
          <a
            key={`${keyPrefix}-link-${tokenIndex}`}
            href={href}
            target="_blank"
            rel="noreferrer"
          >
            {renderInlineNodes(label, `${keyPrefix}-link-${tokenIndex}`)}
          </a>,
        );
        index = closingHrefIndex + 1;
        tokenIndex += 1;
        continue;
      }
    }

    const nextInlineIndex = [
      text.indexOf("**", index),
      text.indexOf("*", index),
      text.indexOf("_", index),
      text.indexOf("`", index),
      text.indexOf("[", index),
    ]
      .filter((value) => value >= 0)
      .sort((left, right) => left - right)[0];

    const nextIndex =
      nextInlineIndex == null || nextInlineIndex === index
        ? index + 1
        : nextInlineIndex;

    pushText(text.slice(index, nextIndex));
    index = nextIndex;
  }

  return nodes;
}

function renderBlock(block: PilotMarkdownBlock, index: number) {
  switch (block.type) {
    case "heading": {
      const content = renderInlineNodes(block.text, `heading-${index}`);
      switch (Math.min(block.depth, 6)) {
        case 1:
          return <h1 key={`heading-${index}`}>{content}</h1>;
        case 2:
          return <h2 key={`heading-${index}`}>{content}</h2>;
        case 3:
          return <h3 key={`heading-${index}`}>{content}</h3>;
        case 4:
          return <h4 key={`heading-${index}`}>{content}</h4>;
        case 5:
          return <h5 key={`heading-${index}`}>{content}</h5>;
        default:
          return <h6 key={`heading-${index}`}>{content}</h6>;
      }
    }

    case "paragraph":
      return (
        <p key={`paragraph-${index}`}>
          {renderInlineNodes(block.text, `paragraph-${index}`)}
        </p>
      );

    case "code":
      return (
        <pre key={`code-${index}`}>
          <code
            className={
              block.language ? `language-${block.language}` : undefined
            }
          >
            {block.text}
          </code>
        </pre>
      );

    case "list": {
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <ListTag key={`list-${index}`}>
          {block.items.map((item, itemIndex) => (
            <li key={`list-${index}-${itemIndex}`}>
              {renderInlineNodes(item, `list-${index}-${itemIndex}`)}
            </li>
          ))}
        </ListTag>
      );
    }
  }
}

export function PilotMarkdown(props: PropsWithChildren) {
  const blocks = parsePilotMarkdownBlocks(String(props.children ?? ""));

  if (blocks.length === 0) {
    return null;
  }

  return (
    <>
      {blocks.map((block, index) => (
        <Fragment key={`pilot-markdown-${index}`}>
          {renderBlock(block, index)}
        </Fragment>
      ))}
    </>
  );
}
