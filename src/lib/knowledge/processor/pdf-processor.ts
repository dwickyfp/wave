import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  assessExtractedPageQuality,
  formatExtractedPageToMarkdown,
} from "../document-quality";
import { createPageMarker } from "../page-markers";
import {
  generateContextImageArtifacts,
  generateContextImageBlocks,
  type ImageCandidate,
  createContextImageMarker,
} from "./image-markdown";
import type {
  DocumentProcessingOptions,
  ProcessedDocument,
  ProcessedDocumentPage,
} from "./types";

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
    const pages: ProcessedDocumentPage[] = [];
    for (const page of textResult.pages) {
      const pageMarkdown = formatExtractedPageToMarkdown(page.text);
      const pageQuality = assessExtractedPageQuality(page.text, pageMarkdown);
      pages.push({
        pageNumber: page.num,
        rawText: page.text,
        normalizedText: pageMarkdown,
        markdown: pageMarkdown,
        fingerprint: createHash("sha1")
          .update(page.text)
          .update(`:${page.num}`)
          .digest("hex"),
        qualityScore: pageQuality.score,
        extractionMode: "normalized" as const,
        repairReason: pageQuality.reasons.join(", ") || null,
      });

      output.push(createPageMarker(page.num));
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
      pages,
      imageBlocks,
      images,
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}
