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
import { chunkMarkdown } from "./chunker";
import { enrichChunksWithContext } from "./context-enricher";
import {
  buildDocumentMetadataEmbeddingText,
  extractAutoDocumentMetadata,
} from "./document-metadata";
import { embedSingleText, embedTexts } from "./embedder";
import { parseDocumentToMarkdown } from "./markdown-parser";
import { normalizeStructuredMarkdown } from "./markdown-structurer";
import { processDocument } from "./processor";

const DOC_META_VECTOR_ENABLED = process.env.DOC_META_VECTOR_ENABLED !== "false";

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

  // ── 1. Get document content as markdown ──────────────────────────────────
  await reportProgress(5);
  let markdown: string;

  if (doc.fileType === "url" && doc.sourceUrl) {
    markdown = await processDocument("url", doc.sourceUrl);
  } else if (fileBuffer) {
    // Inline mode: use the buffer that was already read (no S3 download needed)
    markdown = await processDocument(doc.fileType, fileBuffer);
  } else if (doc.storagePath) {
    const buffer = await serverFileStorage.download(doc.storagePath);
    markdown = await processDocument(doc.fileType, buffer);
  } else {
    throw new Error("Document has no storage path, source URL, or file buffer");
  }

  // ── 2. Optional LLM-based markdown parsing ──────────────────────────────
  await reportProgress(15);
  const documentTitle = doc.name || doc.originalFilename || "Untitled";
  const contextxConfig = (await settingsRepository.getSetting(
    "contextx-model",
  )) as { provider: string; model: string } | null | undefined;
  if (contextxConfig?.provider && contextxConfig?.model) {
    markdown = await parseDocumentToMarkdown(
      markdown,
      documentTitle,
      contextxConfig.provider,
      contextxConfig.model,
    );
  }

  // ── 3. Normalize markdown ─────────────────────────────────────────────────
  await reportProgress(35);
  markdown = normalizeStructuredMarkdown(markdown);

  // ── 4. Auto metadata extraction ──────────────────────────────────────────
  await reportProgress(40);
  const autoMeta = extractAutoDocumentMetadata(markdown, documentTitle);
  const effectiveMetaTitle = doc.titleManual ? doc.name : autoMeta.title;
  const effectiveMetaDescription = doc.descriptionManual
    ? (doc.description ?? null)
    : autoMeta.description;

  let metadataEmbedding: number[] | undefined;
  if (DOC_META_VECTOR_ENABLED) {
    const metadataText = buildDocumentMetadataEmbeddingText({
      title: effectiveMetaTitle,
      description: effectiveMetaDescription,
      originalFilename: doc.originalFilename,
      sourceUrl: doc.sourceUrl,
    });
    if (metadataText) {
      try {
        metadataEmbedding = await embedSingleText(
          metadataText,
          group.embeddingProvider,
          group.embeddingModel,
        );
      } catch (err) {
        console.warn(
          `[ContextX] Metadata embedding failed for document ${documentId}:`,
          err,
        );
      }
    }
  }

  // Store full markdown (Context7-style: keep full doc for retrieval)
  await reportProgress(45);
  await knowledgeRepository.updateDocumentStatus(documentId, "processing", {
    markdownContent: markdown,
    processingProgress: 45,
  });
  await knowledgeRepository.updateDocumentAutoMetadata(documentId, {
    title: autoMeta.title,
    description: autoMeta.description,
    ...(metadataEmbedding !== undefined ? { metadataEmbedding } : {}),
  });

  // ── 5. Chunk ──────────────────────────────────────────────────────────────
  await reportProgress(50);
  await knowledgeRepository.deleteChunksByDocumentId(documentId);

  const chunks = chunkMarkdown(
    markdown,
    group.chunkSize,
    group.chunkOverlapPercent,
  );
  if (chunks.length === 0) {
    await knowledgeRepository.updateDocumentStatus(documentId, "ready", {
      chunkCount: 0,
      tokenCount: 0,
    });
    return;
  }

  // ── 6. Enrich chunks with contextual summaries ────────────────────────────
  await reportProgress(60);
  const enrichedChunks = await enrichChunksWithContext(
    chunks,
    autoMeta.title || documentTitle,
    markdown,
  );

  // ── 7. Embed chunks ───────────────────────────────────────────────────────
  await reportProgress(75);
  const embeddingTexts = enrichedChunks.map((c) => c.embeddingText);
  const embeddings = await embedTexts(
    embeddingTexts,
    group.embeddingProvider,
    group.embeddingModel,
  );

  const totalTokens = enrichedChunks.reduce((sum, c) => sum + c.tokenCount, 0);

  // ── 8. Store chunks ───────────────────────────────────────────────────────
  await reportProgress(90);
  await knowledgeRepository.insertChunks(
    enrichedChunks.map((c, i) => ({
      documentId,
      groupId,
      content: c.content,
      contextSummary: c.contextSummary || null,
      chunkIndex: c.chunkIndex,
      tokenCount: c.tokenCount,
      metadata: c.metadata,
      embedding: embeddings[i],
    })),
  );

  await knowledgeRepository.updateDocumentStatus(documentId, "ready", {
    chunkCount: enrichedChunks.length,
    tokenCount: totalTokens,
  });

  console.log(
    `[ContextX] Ingested document ${documentId}: ${enrichedChunks.length} chunks, ${totalTokens} tokens`,
  );
}
