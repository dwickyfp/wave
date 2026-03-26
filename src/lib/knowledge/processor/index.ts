import { DocumentFileType } from "app-types/knowledge";
import { processPdf } from "./pdf-processor";
import { processDocx } from "./docx-processor";
import { processXlsx } from "./xlsx-processor";
import { processJson } from "./json-processor";
import { processEml } from "./eml-processor";
import { processCode } from "./code-processor";
import { processPptx } from "./pptx-processor";
import { processUrl, processHtml } from "./url-processor";
import type { DocumentProcessingOptions, ProcessedDocument } from "./types";

export async function processDocument(
  fileType: DocumentFileType,
  input: Buffer | string,
  options: DocumentProcessingOptions = {},
): Promise<ProcessedDocument> {
  switch (fileType) {
    case "pdf":
      return processPdf(input as Buffer, options);
    case "docx":
      return processDocx(input as Buffer, options);
    case "pptx":
      return { markdown: processPptx(input as Buffer) };
    case "xlsx":
    case "csv":
      return { markdown: processXlsx(input as Buffer) };
    case "json":
      return { markdown: processJson(input as Buffer) };
    case "eml":
      return { markdown: processEml(input as Buffer) };
    case "code":
      return {
        markdown: processCode(
          input as Buffer,
          options.originalFilename ?? options.documentTitle ?? null,
        ),
      };
    case "url":
      return processUrl(input as string, options);
    case "html":
      return processHtml(input as Buffer, options);
    case "txt":
    case "md":
    default:
      return { markdown: (input as Buffer).toString("utf-8") };
  }
}
