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
import {
  applyContextImageBlocks,
  generateContextImageBlocks,
  resolveContextImageLocations,
} from "./processor/image-markdown";
import type {
  ProcessedDocument,
  ProcessedDocumentImage,
} from "./processor/types";

export const KNOWLEDGE_INGEST_CANCELED_MESSAGE = "Canceled by user";

class KnowledgeIngestSkippedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeIngestSkippedError";
  }
}

class KnowledgeIngestCanceledError extends KnowledgeIngestSkippedError {
  constructor(documentId: string) {
    super(
      `[ContextX] Ingestion canceled for document ${documentId}: ${KNOWLEDGE_INGEST_CANCELED_MESSAGE}`,
    );
    this.name = "KnowledgeIngestCanceledError";
  }
}

function isCanceledDocumentState(input: {
  status?: string | null;
  errorMessage?: string | null;
}): boolean {
  return (
    input.status === "failed" &&
    (input.errorMessage ?? null) === KNOWLEDGE_INGEST_CANCELED_MESSAGE
  );
}

async function assertDocumentIngestNotCanceled(
  documentId: string,
): Promise<void> {
  const current = await knowledgeRepository.selectDocumentById(documentId);
  if (!current) {
    throw new KnowledgeIngestSkippedError(
      `[ContextX] Skipping ingest for deleted document ${documentId}`,
    );
  }
  if (isCanceledDocumentState(current)) {
    throw new KnowledgeIngestCanceledError(documentId);
  }
}

function getImageFileExtension(mediaType?: string | null): string {
  const subtype = mediaType?.split("/")?.[1]?.toLowerCase();
  switch (subtype) {
    case "jpeg":
      return "jpg";
    case "svg+xml":
      return "svg";
    default:
      return subtype || "png";
  }
}

async function persistProcessedImages(input: {
  documentId: string;
  versionId: string;
  images: ProcessedDocumentImage[] | undefined;
}): Promise<ProcessedDocumentImage[]> {
  if (!input.images?.length) return [];

  const persisted: ProcessedDocumentImage[] = [];

  for (const image of input.images) {
    if (!image.buffer) {
      persisted.push({
        ...image,
        isRenderable: Boolean(image.sourceUrl),
      });
      continue;
    }

    try {
      const ext = getImageFileExtension(image.mediaType);
      const uploaded = await serverFileStorage.upload(image.buffer, {
        filename: `knowledge-images/${input.documentId}/${input.versionId}/image-${image.index}.${ext}`,
        contentType: image.mediaType || "image/png",
      });

      persisted.push({
        ...image,
        storagePath: uploaded.key,
        sourceUrl: uploaded.sourceUrl ?? image.sourceUrl ?? null,
        isRenderable: true,
      });
    } catch (error) {
      console.warn(
        `[ContextX] Failed to persist document image ${image.index} for ${input.documentId}:`,
        error,
      );
      persisted.push({
        ...image,
        isRenderable: Boolean(image.sourceUrl),
      });
    }
  }

  return persisted;
}

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
): Promise<"completed" | "skipped"> {
  /** Helper to update progress percentage (0–100) on the document row. */
  const reportProgress = async (pct: number) => {
    await assertDocumentIngestNotCanceled(documentId);
    await knowledgeRepository.updateDocumentStatus(documentId, "processing", {
      processingProgress: Math.min(100, Math.max(0, Math.round(pct))),
    });
  };

  const doc = await knowledgeRepository.selectDocumentById(documentId);
  if (!doc) {
    return "skipped";
  }
  if (isCanceledDocumentState(doc)) {
    return "skipped";
  }

  const group = await knowledgeRepository.selectGroupById(groupId, doc.userId);
  if (!group) {
    return "skipped";
  }
  const documentTitle = doc.name || doc.originalFilename || "Untitled";
  const contextxConfig = (await settingsRepository.getSetting(
    "contextx-model",
  )) as { provider: string; model: string } | null | undefined;
  let pendingVersion: Awaited<
    ReturnType<typeof prepareSourceDocumentVersion>
  > | null = null;
  try {
    await reportProgress(0);
    pendingVersion = await prepareSourceDocumentVersion(documentId);

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
    const resolvedImages = resolveContextImageLocations(
      markdown,
      processedDocument.images,
    );
    const persistedImages = await persistProcessedImages({
      documentId,
      versionId: pendingVersion.id,
      images: resolvedImages,
    });
    const imageBlocks = await generateContextImageBlocks(persistedImages);
    markdown = applyContextImageBlocks(markdown, imageBlocks);

    // ── 3–8. Normalize, structure, enrich, embed, commit ──────────────────
    await reportProgress(35);
    const materialized = await materializeDocumentMarkdown({
      documentId,
      groupId,
      documentTitle,
      doc,
      group,
      markdown,
      images: persistedImages,
      reportProgress,
    });

    await reportProgress(90);
    await assertDocumentIngestNotCanceled(documentId);
    await completeSourceDocumentVersion({
      versionId: pendingVersion.id,
      doc,
      group,
      materialized,
    });

    console.log(
      `[ContextX] Ingested document ${documentId}: ${materialized.chunks.length} chunks, ${materialized.totalTokens} tokens`,
    );
    return "completed";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (pendingVersion) {
      await markDocumentVersionFailed({
        versionId: pendingVersion.id,
        errorMessage: message,
        updateDocumentStatus: true,
      });
    }
    if (error instanceof KnowledgeIngestSkippedError) {
      return "skipped";
    }
    throw error;
  }
}
