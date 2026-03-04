export interface TextChunk {
  content: string;
  chunkIndex: number;
  tokenCount: number;
  metadata: {
    section?: string;
    headings?: string[];
    /** Full heading breadcrumb path, e.g. "Guide > Installation > macOS" */
    headingPath?: string;
    /** Whether this chunk contains a table or code block */
    hasStructuredContent?: boolean;
  };
}

// ─── Token Estimation ──────────────────────────────────────────────────────────

/**
 * More accurate token estimation using word + punctuation heuristic.
 * English averages ~1.3 tokens per word; code/technical text ~1.5.
 */
function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  // Use 1.35 multiplier — good average for mixed prose+code
  return Math.max(1, Math.ceil(words * 1.35));
}

// ─── Text Cleaning & Normalization ─────────────────────────────────────────────

/**
 * Clean and normalize text before chunking:
 * - Normalize unicode (NFC form)
 * - Collapse excessive whitespace & blank lines
 * - Remove zero-width characters
 * - Trim trailing spaces per line
 * - Normalize line endings
 */
function cleanText(text: string): string {
  return (
    text
      // Normalize unicode
      .normalize("NFC")
      // Remove zero-width characters
      .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
      // Normalize line endings to \n
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      // Trim trailing whitespace per line
      .replace(/[^\S\n]+$/gm, "")
      // Collapse 3+ consecutive blank lines → 2
      .replace(/\n{4,}/g, "\n\n\n")
      // Collapse multiple spaces (but not newlines) into single space
      .replace(/[^\S\n]{2,}/g, " ")
      .trim()
  );
}

// ─── Section Parsing with Heading Hierarchy ────────────────────────────────────

interface ParsedSection {
  /** Heading text without the # prefix */
  heading: string;
  /** Heading level (1-6) */
  headingLevel: number;
  /** Full heading breadcrumb, e.g. ["Guide", "Installation", "macOS"] */
  headingBreadcrumb: string[];
  /** Section body content */
  content: string;
}

/**
 * Parse markdown into sections while maintaining heading hierarchy.
 * Tracks heading breadcrumb (parent > child) for context.
 */
function splitIntoSections(markdown: string): ParsedSection[] {
  const lines = markdown.split("\n");
  const sections: ParsedSection[] = [];

  // Track heading stack for breadcrumb
  const headingStack: Array<{ level: number; text: string }> = [];
  let currentHeading = "";
  let currentLevel = 0;
  let currentLines: string[] = [];

  const flushSection = () => {
    const content = currentLines.join("\n").trim();
    if (content.length > 0) {
      const breadcrumb = headingStack.map((h) => h.text);
      sections.push({
        heading: currentHeading,
        headingLevel: currentLevel,
        headingBreadcrumb: breadcrumb.length > 0 ? [...breadcrumb] : [],
        content,
      });
    }
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      // Flush previous section
      flushSection();
      currentLines = [];

      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();

      // Pop headings of equal or lower level from the stack
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].level >= level
      ) {
        headingStack.pop();
      }

      headingStack.push({ level, text });
      currentHeading = text;
      currentLevel = level;
    } else {
      currentLines.push(line);
    }
  }

  // Final section
  flushSection();

  return sections;
}

// ─── Semantic Block Detection ──────────────────────────────────────────────────

interface ContentBlock {
  type: "paragraph" | "code" | "table" | "list" | "blockquote" | "other";
  content: string;
}

/**
 * Split section content into semantic blocks (paragraphs, code blocks,
 * tables, lists, blockquotes) so we can avoid breaking within them.
 */
function splitIntoBlocks(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.match(/^```/)) {
      const codeLines = [line];
      i++;
      while (i < lines.length && !lines[i].match(/^```/)) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) codeLines.push(lines[i++]); // closing ```
      blocks.push({ type: "code", content: codeLines.join("\n") });
      continue;
    }

    // Table (lines starting with | or --- separator)
    if (line.match(/^\|/) || line.match(/^\s*\|?\s*:?-{3,}:?\s*\|/)) {
      const tableLines = [line];
      i++;
      while (
        i < lines.length &&
        (lines[i].match(/^\|/) || lines[i].match(/^\s*\|?\s*:?-{3,}:?\s*\|/))
      ) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "table", content: tableLines.join("\n") });
      continue;
    }

    // List items (-, *, numbered)
    if (line.match(/^[\s]*[-*+]\s/) || line.match(/^[\s]*\d+[.)]\s/)) {
      const listLines = [line];
      i++;
      while (
        i < lines.length &&
        (lines[i].match(/^[\s]*[-*+]\s/) ||
          lines[i].match(/^[\s]*\d+[.)]\s/) ||
          lines[i].match(/^\s{2,}/) || // continuation indent
          lines[i].trim() === "")
      ) {
        listLines.push(lines[i]);
        i++;
      }
      // Trim trailing blank lines from list
      while (
        listLines.length > 0 &&
        listLines[listLines.length - 1].trim() === ""
      ) {
        listLines.pop();
      }
      blocks.push({ type: "list", content: listLines.join("\n") });
      continue;
    }

    // Blockquote
    if (line.match(/^>/)) {
      const quoteLines = [line];
      i++;
      while (
        i < lines.length &&
        (lines[i].match(/^>/) || lines[i].trim() !== "")
      ) {
        if (!lines[i].match(/^>/) && lines[i].trim() === "") break;
        quoteLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "blockquote", content: quoteLines.join("\n") });
      continue;
    }

    // Blank line — skip
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Regular paragraph — collect until blank line
    const paraLines = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "") {
      // Stop if next line starts a new block type
      if (
        lines[i].match(/^```/) ||
        lines[i].match(/^\|/) ||
        lines[i].match(/^[\s]*[-*+]\s/) ||
        lines[i].match(/^[\s]*\d+[.)]\s/) ||
        lines[i].match(/^>/)
      ) {
        break;
      }
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", content: paraLines.join("\n") });
  }

  return blocks;
}

// ─── Smart Text Chunking ───────────────────────────────────────────────────────

/**
 * Split text at the best semantic boundary near `targetEnd`.
 * Tries (in order): paragraph break, sentence end, clause boundary, word boundary.
 */
function findBestBreakPoint(
  text: string,
  targetEnd: number,
  minPos: number,
): number {
  // 1. Paragraph break (\n\n)
  const paraBreak = text.lastIndexOf("\n\n", targetEnd);
  if (paraBreak > minPos) return paraBreak + 2;

  // 2. Sentence boundary (. ! ? followed by space or newline)
  const sentenceRegex = /[.!?][\s\n]/g;
  let lastSentenceEnd = -1;
  let match;
  while ((match = sentenceRegex.exec(text)) !== null) {
    if (match.index > targetEnd) break;
    if (match.index > minPos) lastSentenceEnd = match.index + 1;
  }
  if (lastSentenceEnd > minPos) return lastSentenceEnd;

  // 3. Line break
  const lineBreak = text.lastIndexOf("\n", targetEnd);
  if (lineBreak > minPos) return lineBreak + 1;

  // 4. Clause boundary (; , :)
  const clauseRegex = /[;,:]\s/g;
  let lastClauseEnd = -1;
  while ((match = clauseRegex.exec(text)) !== null) {
    if (match.index > targetEnd) break;
    if (match.index > minPos) lastClauseEnd = match.index + 1;
  }
  if (lastClauseEnd > minPos) return lastClauseEnd;

  // 5. Word boundary (space)
  const wordBreak = text.lastIndexOf(" ", targetEnd);
  if (wordBreak > minPos) return wordBreak + 1;

  // Fallback — hard cut
  return targetEnd;
}

/**
 * Chunk text with overlap using semantic boundary detection.
 * Respects content block boundaries where possible.
 */
function chunkText(
  text: string,
  chunkSize: number,
  overlapPercent: number,
  metadata: TextChunk["metadata"],
  startIndex: number,
): TextChunk[] {
  const chunkChars = chunkSize * 4; // approximate chars per chunk
  const overlapChars = Math.floor((chunkChars * overlapPercent) / 100);

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
    let end = Math.min(start + chunkChars, text.length);

    if (end < text.length) {
      // Find best break point (at least 50% of target chunk size)
      const minPos = start + Math.floor(chunkChars * 0.5);
      end = findBestBreakPoint(text, end, minPos);
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push({
        content: chunk,
        chunkIndex: idx++,
        tokenCount: estimateTokens(chunk),
        metadata: {
          ...metadata,
          hasStructuredContent: chunk.includes("```") || chunk.includes("| "),
        },
      });
    }

    // Advance with overlap
    const nextStart = end - overlapChars;
    if (nextStart <= start) {
      // Prevent infinite loop — move forward
      start = end;
    } else {
      start = nextStart;
    }
    if (start >= text.length) break;
  }

  return chunks;
}

// ─── Block-Aware Section Chunking ──────────────────────────────────────────────

/**
 * Chunk a section's content while respecting semantic block boundaries.
 * Keeps code blocks, tables, and lists intact when possible.
 */
function chunkSectionContent(
  blocks: ContentBlock[],
  chunkSize: number,
  overlapPercent: number,
  metadata: TextChunk["metadata"],
  startIndex: number,
): TextChunk[] {
  const chunkChars = chunkSize * 4;
  const allChunks: TextChunk[] = [];
  let idx = startIndex;

  // Accumulate blocks into chunks, respecting block boundaries
  let buffer = "";

  const flushBuffer = () => {
    if (buffer.trim().length === 0) return;
    const subChunks = chunkText(
      buffer.trim(),
      chunkSize,
      overlapPercent,
      metadata,
      idx,
    );
    allChunks.push(...subChunks);
    idx += subChunks.length;
    buffer = "";
  };

  for (const block of blocks) {
    const blockContent = block.content;

    // If this is a structured block (code/table) that fits in one chunk,
    // keep it atomic — don't let it be split across chunks
    if (
      (block.type === "code" || block.type === "table") &&
      blockContent.length <= chunkChars * 1.2 // allow 20% overflow for atomic blocks
    ) {
      // If buffer + block exceeds chunk size, flush buffer first
      if (
        buffer.length + blockContent.length > chunkChars &&
        buffer.length > 0
      ) {
        flushBuffer();
      }
      buffer += (buffer ? "\n\n" : "") + blockContent;
      continue;
    }

    // For large blocks or regular text, just accumulate
    const combined = buffer + (buffer ? "\n\n" : "") + blockContent;
    if (combined.length > chunkChars) {
      // Flush what we have, then add new block
      if (buffer.length > 0) {
        flushBuffer();
      }
      // If the block itself is oversized, chunk it with text splitting
      if (blockContent.length > chunkChars) {
        const subChunks = chunkText(
          blockContent,
          chunkSize,
          overlapPercent,
          {
            ...metadata,
            hasStructuredContent:
              block.type === "code" || block.type === "table",
          },
          idx,
        );
        allChunks.push(...subChunks);
        idx += subChunks.length;
      } else {
        buffer = blockContent;
      }
    } else {
      buffer = combined;
    }
  }

  // Flush remaining buffer
  flushBuffer();

  return allChunks;
}

// ─── Deduplication ─────────────────────────────────────────────────────────────

/**
 * Remove near-duplicate chunks (>90% content overlap).
 * This can happen when overlap + short sections produce redundant chunks.
 */
function deduplicateChunks(chunks: TextChunk[]): TextChunk[] {
  if (chunks.length <= 1) return chunks;

  const result: TextChunk[] = [chunks[0]];

  for (let i = 1; i < chunks.length; i++) {
    const current = chunks[i].content;
    const prev = result[result.length - 1].content;

    // Check if current chunk is substantially contained in previous
    const shorter = current.length < prev.length ? current : prev;
    const longer = current.length >= prev.length ? current : prev;

    if (shorter.length / longer.length > 0.9 && longer.includes(shorter)) {
      // Skip near-duplicate — keep the longer one
      if (current.length > prev.length) {
        result[result.length - 1] = chunks[i];
      }
      continue;
    }

    result.push(chunks[i]);
  }

  // Re-index
  return result.map((c, i) => ({ ...c, chunkIndex: i }));
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Chunk markdown into well-formed, semantically coherent text chunks.
 *
 * Pipeline:
 * 1. Clean & normalize text
 * 2. Split into sections with heading hierarchy tracking
 * 3. Split each section into semantic blocks (paragraphs, code, tables, lists)
 * 4. Assemble chunks respecting block boundaries
 * 5. Deduplicate near-identical chunks
 */
export function chunkMarkdown(
  markdown: string,
  chunkSize = 512,
  overlapPercent = 20,
): TextChunk[] {
  // Step 1: Clean & normalize
  const cleaned = cleanText(markdown);
  if (cleaned.length === 0) return [];

  // Step 2: Parse into sections with heading hierarchy
  const sections = splitIntoSections(cleaned);

  // If no sections found, treat as flat text with block detection
  if (sections.length === 0) {
    const blocks = splitIntoBlocks(cleaned);
    const chunks = chunkSectionContent(
      blocks,
      chunkSize,
      overlapPercent,
      {},
      0,
    );
    return deduplicateChunks(chunks);
  }

  // Step 3 & 4: Process each section with block-aware chunking
  const allChunks: TextChunk[] = [];

  for (const section of sections) {
    const headingPrefix = section.heading
      ? `${"#".repeat(section.headingLevel)} ${section.heading}\n\n`
      : "";
    const fullContent = headingPrefix + section.content;

    const blocks = splitIntoBlocks(fullContent);

    const headingPath =
      section.headingBreadcrumb.length > 0
        ? section.headingBreadcrumb.join(" > ")
        : undefined;

    const sectionChunks = chunkSectionContent(
      blocks,
      chunkSize,
      overlapPercent,
      {
        section: section.heading || undefined,
        headings:
          section.headingBreadcrumb.length > 0
            ? section.headingBreadcrumb
            : undefined,
        headingPath,
      },
      allChunks.length,
    );

    allChunks.push(...sectionChunks);
  }

  // Step 5: Deduplicate
  return deduplicateChunks(allChunks);
}
