/**
 * Core document ingestion pipeline.
 * Shared between the BullMQ background worker and the inline (no-queue) fallback.
 *
 * Pipeline:
 * 1. Process document → markdown
 * 2. Optional LLM-based parsing (contextx-model setting)
 * 3. Normalize markdown structure
 * 4. Auto-extract metadata
 * 5. Chunk with semantic boundary detection
 * 6. Enrich chunks with contextual summaries
 * 7. Embed enriched text
 * 8. Store chunks + update document status
 */
import { knowledgeRepository, settingsRepository } from "lib/db/repository";
import { serverFileStorage } from "lib/file-storage";
import {
  completeSourceDocumentVersion,
  markDocumentVersionFailed,
  prepareSourceDocumentVersion,
} from "./versioning";
import { materializeDocumentMarkdown } from "./materialize-markdown";
import { parseDocumentToMarkdown } from "./markdown-parser";
import { processDocument } from "./processor";
import { applyContextImageBlocks } from "./processor/image-markdown";
import type { ProcessedDocument } from "./processor/types";

/**
 * Run the full ingestion pipeline for a single document.
 *
 * @param documentId  DB document ID
 * @param groupId     Knowledge group ID
 * @param fileBuffer  Optional – when provided the file is processed directly
 *                    from memory, skipping the S3/storage download step.
 *                    Required when the document was not persisted to object
 *                    storage (inline / storage-less mode).
 */
export async function runIngestPipeline(
  documentId: string,
  groupId: string,
  fileBuffer?: Buffer,
): Promise<void> {
  /** Helper to update progress percentage (0–100) on the document row. */
  const reportProgress = (pct: number) =>
    knowledgeRepository.updateDocumentStatus(documentId, "processing", {
      processingProgress: Math.min(100, Math.max(0, Math.round(pct))),
    });

  await knowledgeRepository.updateDocumentStatus(documentId, "processing", {
    processingProgress: 0,
  });

  const doc = await knowledgeRepository.selectDocumentById(documentId);
  if (!doc) throw new Error(`Document not found: ${documentId}`);

  const group = await knowledgeRepository.selectGroupById(groupId, doc.userId);
  if (!group) throw new Error(`Knowledge group not found: ${groupId}`);
  const pendingVersion = await prepareSourceDocumentVersion(documentId);
  const documentTitle = doc.name || doc.originalFilename || "Untitled";
  const contextxConfig = (await settingsRepository.getSetting(
    "contextx-model",
  )) as { provider: string; model: string } | null | undefined;
  try {
    // ── 1. Get document content as markdown ────────────────────────────────
    await reportProgress(5);
    let processedDocument: ProcessedDocument;

    if (doc.fileType === "url" && doc.sourceUrl) {
      processedDocument = await processDocument("url", doc.sourceUrl, {
        documentTitle,
        imageAnalysis: contextxConfig,
      });
    } else if (fileBuffer) {
      // Inline mode: use the buffer that was already read (no S3 download needed)
      processedDocument = await processDocument(doc.fileType, fileBuffer, {
        documentTitle,
        imageAnalysis: contextxConfig,
      });
    } else if (doc.storagePath) {
      const buffer = await serverFileStorage.download(doc.storagePath);
      processedDocument = await processDocument(doc.fileType, buffer, {
        documentTitle,
        imageAnalysis: contextxConfig,
      });
    } else {
      throw new Error(
        "Document has no storage path, source URL, or file buffer",
      );
    }
    let markdown = processedDocument.markdown;

    // ── 2. Optional LLM-based markdown parsing ────────────────────────────
    await reportProgress(15);
    if (contextxConfig?.provider && contextxConfig?.model) {
      markdown = await parseDocumentToMarkdown(
        markdown,
        documentTitle,
        contextxConfig.provider,
        contextxConfig.model,
      );
    }
    markdown = applyContextImageBlocks(markdown, processedDocument.imageBlocks);

    // ── 3–8. Normalize, structure, enrich, embed, commit ──────────────────
    await reportProgress(35);
    const materialized = await materializeDocumentMarkdown({
      documentId,
      groupId,
      documentTitle,
      doc,
      group,
      markdown,
      reportProgress,
    });

    await reportProgress(90);
    await completeSourceDocumentVersion({
      versionId: pendingVersion.id,
      doc,
      group,
      materialized,
    });

    console.log(
      `[ContextX] Ingested document ${documentId}: ${materialized.chunks.length} chunks, ${materialized.totalTokens} tokens`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markDocumentVersionFailed({
      versionId: pendingVersion.id,
      errorMessage: message,
      updateDocumentStatus: true,
    });
    throw error;
  }
}
