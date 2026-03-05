/**
 * ContextX Knowledge Ingestion Worker
 * Run with: pnpm worker:knowledge
 *
 * Pipeline:
 * 1. Process document → markdown
 * 2. Chunk with semantic boundary detection
 * 3. Enrich chunks with contextual summaries (Anthropic technique)
 * 4. Embed enriched text (context + content)
 * 5. Store chunks with contextSummary + embeddings
 */
import { Job, Worker } from "bullmq";
import IORedis from "ioredis";
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
import { KnowledgeJob } from "./worker-client";

const QUEUE_NAME = "contextx-ingest";
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const DOC_META_VECTOR_ENABLED = process.env.DOC_META_VECTOR_ENABLED !== "false";

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

async function handleIngestDocument(
  documentId: string,
  groupId: string,
): Promise<void> {
  // Mark as processing
  await knowledgeRepository.updateDocumentStatus(documentId, "processing");

  const doc = await knowledgeRepository.selectDocumentById(documentId);
  if (!doc) throw new Error(`Document not found: ${documentId}`);

  const group = await knowledgeRepository.selectGroupById(groupId, doc.userId);
  if (!group) throw new Error(`Knowledge group not found: ${groupId}`);

  let markdown: string;

  if (doc.fileType === "url" && doc.sourceUrl) {
    markdown = await processDocument("url", doc.sourceUrl);
  } else if (doc.storagePath) {
    const buffer = await serverFileStorage.download(doc.storagePath);
    markdown = await processDocument(doc.fileType, buffer);
  } else {
    throw new Error("Document has no storage path or source URL");
  }

  // ── Optional: LLM-based markdown parsing ─────────────────────────────
  // Use the globally configured ContextX model for LLM-based parsing.
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

  // Normalize markdown into stable section-based format.
  markdown = normalizeStructuredMarkdown(markdown);

  // Auto metadata extraction (preserved when user has not manually edited).
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
          `[ContextX Worker] Metadata embedding failed for document ${documentId}:`,
          err,
        );
      }
    }
  }

  // ── Store full markdown (Context7-style: keep full doc for retrieval) ──
  // This enables Context7-like full-document retrieval alongside chunk-based RAG.
  await knowledgeRepository.updateDocumentStatus(documentId, "processing", {
    markdownContent: markdown,
  });
  await knowledgeRepository.updateDocumentAutoMetadata(documentId, {
    title: autoMeta.title,
    description: autoMeta.description,
    ...(metadataEmbedding !== undefined ? { metadataEmbedding } : {}),
  });

  // Delete existing chunks for this document
  await knowledgeRepository.deleteChunksByDocumentId(documentId);

  // Step 1: Chunk the markdown (with text cleaning & smart splitting)
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

  // Step 2: Enrich chunks with contextual summaries
  const enrichedChunks = await enrichChunksWithContext(
    chunks,
    autoMeta.title || documentTitle,
    markdown,
  );

  // Step 3: Embed the enriched text (contextSummary + content)
  const embeddingTexts = enrichedChunks.map((c) => c.embeddingText);
  const embeddings = await embedTexts(
    embeddingTexts,
    group.embeddingProvider,
    group.embeddingModel,
  );

  const totalTokens = enrichedChunks.reduce((sum, c) => sum + c.tokenCount, 0);

  // Step 4: Store chunks with contextSummary and embeddings
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
    `[ContextX Worker] Ingested document ${documentId}: ${enrichedChunks.length} chunks, ${totalTokens} tokens (contextual enrichment enabled)`,
  );
}

async function handleReembedGroup(groupId: string): Promise<void> {
  const docs = await knowledgeRepository.selectDocumentsByGroupId(groupId);
  const readyDocs = docs.filter((d) => d.status === "ready");

  for (const doc of readyDocs) {
    try {
      await handleIngestDocument(doc.id, groupId);
    } catch (err) {
      console.error(
        `[ContextX Worker] Failed to re-embed document ${doc.id}:`,
        err,
      );
      await knowledgeRepository.updateDocumentStatus(doc.id, "failed", {
        errorMessage: String(err),
      });
    }
  }
}

const worker = new Worker<KnowledgeJob>(
  QUEUE_NAME,
  async (job: Job<KnowledgeJob>) => {
    const data = job.data;

    if (data.type === "ingest-document") {
      await handleIngestDocument(data.documentId, data.groupId);
    } else if (data.type === "reembed-group") {
      await handleReembedGroup(data.groupId);
    }
  },
  {
    connection: connection as any,
    concurrency: 2,
  },
);

worker.on("completed", (job) => {
  console.log(`[ContextX Worker] Job ${job.id} completed`);
});

worker.on("failed", async (job, err) => {
  console.error(`[ContextX Worker] Job ${job?.id} failed:`, err);
  if (job?.data?.type === "ingest-document") {
    await knowledgeRepository
      .updateDocumentStatus((job.data as any).documentId, "failed", {
        errorMessage: String(err),
      })
      .catch(() => {});
  }
});

console.log("[ContextX Worker] Started, listening on queue:", QUEUE_NAME);

export { worker };
