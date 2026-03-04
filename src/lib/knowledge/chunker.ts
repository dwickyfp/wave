export interface TextChunk {
  content: string;
  chunkIndex: number;
  tokenCount: number;
  metadata: {
    section?: string;
    headings?: string[];
  };
}

// Simple token estimation: ~4 chars per token for English text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function splitIntoSections(
  markdown: string,
): Array<{ heading: string; content: string }> {
  const lines = markdown.split("\n");
  const sections: Array<{ heading: string; content: string }> = [];
  let currentHeading = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      if (currentLines.length > 0) {
        sections.push({
          heading: currentHeading,
          content: currentLines.join("\n").trim(),
        });
      }
      currentHeading = headingMatch[2];
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections.push({
      heading: currentHeading,
      content: currentLines.join("\n").trim(),
    });
  }

  return sections.filter((s) => s.content.length > 0);
}

function chunkText(
  text: string,
  chunkSize: number,
  overlapPercent: number,
  metadata: { section?: string; headings?: string[] },
  startIndex: number,
): TextChunk[] {
  const overlapChars = Math.floor((chunkSize * 4 * overlapPercent) / 100);
  const chunkChars = chunkSize * 4; // approximate

  if (text.length <= chunkChars) {
    return [
      {
        content: text,
        chunkIndex: startIndex,
        tokenCount: estimateTokens(text),
        metadata,
      },
    ];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let idx = startIndex;

  while (start < text.length) {
    let end = start + chunkChars;

    if (end < text.length) {
      // Try to break at sentence boundary
      const sentenceEnd = text.lastIndexOf(". ", end);
      const paraEnd = text.lastIndexOf("\n\n", end);
      const breakAt = Math.max(sentenceEnd, paraEnd);

      if (breakAt > start + chunkChars * 0.5) {
        end = breakAt + 1;
      }
    } else {
      end = text.length;
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push({
        content: chunk,
        chunkIndex: idx++,
        tokenCount: estimateTokens(chunk),
        metadata,
      });
    }

    start = end - overlapChars;
    if (start >= text.length) break;
  }

  return chunks;
}

export function chunkMarkdown(
  markdown: string,
  chunkSize = 512,
  overlapPercent = 20,
): TextChunk[] {
  const sections = splitIntoSections(markdown);

  // If no sections, treat as flat text
  if (sections.length === 0) {
    return chunkText(markdown, chunkSize, overlapPercent, {}, 0);
  }

  const allChunks: TextChunk[] = [];
  let headings: string[] = [];

  for (const section of sections) {
    if (section.heading) {
      headings = [section.heading];
    }

    const sectionChunks = chunkText(
      section.heading
        ? `## ${section.heading}\n\n${section.content}`
        : section.content,
      chunkSize,
      overlapPercent,
      { section: section.heading || undefined, headings: headings.slice() },
      allChunks.length,
    );

    allChunks.push(...sectionChunks);
  }

  return allChunks;
}
