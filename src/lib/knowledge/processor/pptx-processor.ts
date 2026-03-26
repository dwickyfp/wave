import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function stripXml(value: string): string {
  return value
    .replace(/<a:br\s*\/>/g, "\n")
    .replace(/<\/a:p>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function processPptx(input: Buffer): string {
  const tempDir = mkdtempSync(join(tmpdir(), "contextx-pptx-"));
  const filePath = join(tempDir, "deck.pptx");
  writeFileSync(filePath, input);

  try {
    const entries = execFileSync("unzip", ["-Z1", filePath], {
      encoding: "utf-8",
    })
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^ppt\/slides\/slide\d+\.xml$/i.test(line))
      .sort((left, right) =>
        left.localeCompare(right, undefined, { numeric: true }),
      );

    const slides = entries.map((entry, index) => {
      const xml = execFileSync("unzip", ["-p", filePath, entry], {
        encoding: "utf-8",
      });
      const text = stripXml(xml);
      return `## Slide ${index + 1}\n\n${text || "_No text content_"}\n`;
    });

    return ["# Presentation", "", ...slides].join("\n");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
