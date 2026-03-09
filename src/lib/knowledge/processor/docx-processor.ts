import mammoth from "mammoth";
import { convertHtmlFragmentToProcessedDocument } from "./image-markdown";
import type { DocumentProcessingOptions, ProcessedDocument } from "./types";

export async function processDocx(
  buffer: Buffer,
  options: DocumentProcessingOptions = {},
): Promise<ProcessedDocument> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  return convertHtmlFragmentToProcessedDocument(html, options);
}
