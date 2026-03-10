import { createRequire } from "node:module";
import {
  createContextImageMarker,
  generateContextImageArtifacts,
  generateContextImageBlocks,
  type ImageCandidate,
} from "./image-markdown";
import type { DocumentProcessingOptions, ProcessedDocument } from "./types";

const _require = createRequire(import.meta.url);
const { PDFParse } = _require("pdf-parse") as {
  PDFParse: new (opts: { data: Uint8Array }) => {
    getText(): Promise<{
      text: string;
      pages: Array<{ num: number; text: string }>;
    }>;
    getImage(opts?: {
      imageThreshold?: number;
    }): Promise<{
      pages: Array<{
        pageNumber: number;
        images: Array<{
          data: Uint8Array;
          width: number;
          height: number;
          dataUrl?: string;
        }>;
      }>;
    }>;
    destroy(): Promise<void>;
  };
};

function formatPdfTextToMarkdown(rawText: string): string {
  if (!rawText.trim()) return "";

  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const output: string[] = [];
  let prevWasShort = false;

  for (const line of lines) {
    const wordCount = line.split(/\s+/).length;
    const isLikelySectionHeader =
      wordCount <= 8 && !line.endsWith(".") && line.length > 2;

    if (isLikelySectionHeader && prevWasShort) {
      output.push(`## ${line}`);
    } else {
      output.push(line);
    }
    prevWasShort = isLikelySectionHeader;
  }

  return output.join("\n").trim();
}

export async function processPdf(
  buffer: Buffer,
  options: DocumentProcessingOptions = {},
): Promise<ProcessedDocument> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    const textResult = await parser.getText();
    const imageResult = await parser.getImage({ imageThreshold: 80 });

    let imageIndex = 1;
    const imageCandidates: ImageCandidate[] = [];
    const markersByPage = new Map<number, string[]>();

    for (const page of imageResult.pages) {
      const pageText =
        textResult.pages.find((textPage) => textPage.num === page.pageNumber)
          ?.text ?? "";

      for (const image of page.images) {
        const marker = createContextImageMarker(imageIndex);
        const candidatesForPage = markersByPage.get(page.pageNumber) ?? [];
        candidatesForPage.push(marker);
        markersByPage.set(page.pageNumber, candidatesForPage);

        imageCandidates.push({
          index: imageIndex,
          marker,
          buffer: Buffer.from(image.data),
          mediaType:
            image.dataUrl?.match(/^data:([^;]+);/i)?.[1] ?? "image/png",
          pageNumber: page.pageNumber,
          surroundingText: pageText.trim(),
          width: image.width,
          height: image.height,
        });
        imageIndex += 1;
      }
    }

    const images = await generateContextImageArtifacts(
      imageCandidates,
      options,
    );
    const imageBlocks = await generateContextImageBlocks(images);

    const output: string[] = [];
    for (const page of textResult.pages) {
      const pageMarkdown = formatPdfTextToMarkdown(page.text);
      if (pageMarkdown) {
        output.push(pageMarkdown);
      }

      const pageMarkers = markersByPage.get(page.num) ?? [];
      for (const marker of pageMarkers) {
        output.push(marker);
      }
    }

    if (output.length === 0 && imageBlocks.length > 0) {
      for (const block of imageBlocks) {
        output.push(block.marker);
      }
    }

    return {
      markdown: output.join("\n\n").trim(),
      imageBlocks,
      images,
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}
