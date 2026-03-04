/**
 * ContextX Knowledge Ingestion Worker
 * Run with: pnpm worker:knowledge
 */
import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { knowledgeRepository } from "lib/db/repository";
import { processDocument } from "./processor";
import { chunkMarkdown } from "./chunker";
import { embedTexts } from "./embedder";
import { KnowledgeJob } from "./worker-client";
import { serverFileStorage } from "lib/file-storage";

const QUEUE_NAME = "contextx-ingest";
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

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

  // Delete existing chunks for this document
  await knowledgeRepository.deleteChunksByDocumentId(documentId);

  // Chunk the markdown
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

  // Embed all chunks
  const texts = chunks.map((c) => c.content);
  const embeddings = await embedTexts(
    texts,
    group.embeddingProvider,
    group.embeddingModel,
  );

  const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);

  // Store chunks with embeddings
  await knowledgeRepository.insertChunks(
    chunks.map((c, i) => ({
      documentId,
      groupId,
      content: c.content,
      chunkIndex: c.chunkIndex,
      tokenCount: c.tokenCount,
      metadata: c.metadata,
      embedding: embeddings[i],
    })),
  );

  await knowledgeRepository.updateDocumentStatus(documentId, "ready", {
    chunkCount: chunks.length,
    tokenCount: totalTokens,
  });

  console.log(
    `[ContextX Worker] Ingested document ${documentId}: ${chunks.length} chunks, ${totalTokens} tokens`,
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
