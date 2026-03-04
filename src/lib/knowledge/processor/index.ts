import { DocumentFileType } from "app-types/knowledge";
import { processPdf } from "./pdf-processor";
import { processDocx } from "./docx-processor";
import { processXlsx } from "./xlsx-processor";
import { processUrl, processHtml } from "./url-processor";

export async function processDocument(
  fileType: DocumentFileType,
  input: Buffer | string,
): Promise<string> {
  switch (fileType) {
    case "pdf":
      return processPdf(input as Buffer);
    case "docx":
      return processDocx(input as Buffer);
    case "xlsx":
    case "csv":
      return processXlsx(input as Buffer);
    case "url":
      return processUrl(input as string);
    case "html":
      return processHtml(input as Buffer);
    case "txt":
    case "md":
    default:
      return (input as Buffer).toString("utf-8");
  }
}
