import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
const { PDFParse } = _require("pdf-parse") as {
  PDFParse: new (opts: { data: Uint8Array }) => {
    getText(): Promise<{ text: string }>;
  };
};

export async function processPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const parsed = await parser.getText();
  const rawText = parsed.text;

  // Basic markdown structure: split into paragraphs, detect headings by short lines
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const output: string[] = [];
  let prevWasShort = false;

  for (const line of lines) {
    const wordCount = line.split(/\s+/).length;
    const isLikelySectionHeader =
      wordCount <= 8 && !line.endsWith(".") && line.length > 2;

    if (isLikelySectionHeader && prevWasShort) {
      // Treat consecutive short non-sentence lines as heading
      output.push(`\n## ${line}\n`);
    } else {
      output.push(line);
    }
    prevWasShort = isLikelySectionHeader;
  }

  return output.join("\n");
}
