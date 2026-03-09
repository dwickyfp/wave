import type {
  KnowledgeChunkMetadata,
  KnowledgeDocument,
  KnowledgeGroup,
} from "app-types/knowledge";
import { generateUUID } from "lib/utils";
import { chunkKnowledgeSections } from "./chunker";
import { enrichChunksWithContext } from "./context-enricher";
import {
  buildDocumentMetadataEmbeddingText,
  extractAutoDocumentMetadata,
} from "./document-metadata";
import { embedSingleText, embedTexts } from "./embedder";
import { normalizeStructuredMarkdown } from "./markdown-structurer";
import {
  buildKnowledgeSectionGraph,
  SECTION_GRAPH_VERSION,
} from "./section-graph";

const DOC_META_VECTOR_ENABLED = process.env.DOC_META_VECTOR_ENABLED !== "false";

export type MaterializedKnowledgeSection = ReturnType<
  typeof buildKnowledgeSectionGraph
>[number];

export type MaterializedKnowledgeChunk = {
  id: string;
  documentId: string;
  groupId: string;
  sectionId?: string | null;
  content: string;
  contextSummary?: string | null;
  chunkIndex: number;
  tokenCount: number;
  metadata?: KnowledgeChunkMetadata | null;
  embedding: number[];
};

export type MaterializedDocumentState = {
  markdown: string;
  sections: MaterializedKnowledgeSection[];
  chunks: MaterializedKnowledgeChunk[];
  totalTokens: number;
  metadata: Record<string, unknown>;
  metadataEmbedding?: number[];
  resolvedTitle: string;
  resolvedDescription?: string | null;
};

type MaterializationInput = {
  documentId: string;
  groupId: string;
  documentTitle: string;
  doc: KnowledgeDocument;
  group: KnowledgeGroup;
  markdown: string;
  reportProgress?: (pct: number) => Promise<void> | void;
};

export async function materializeDocumentMarkdown({
  documentId,
  groupId,
  documentTitle,
  doc,
  group,
  markdown: inputMarkdown,
  reportProgress,
}: MaterializationInput): Promise<MaterializedDocumentState> {
  const markdown = normalizeStructuredMarkdown(inputMarkdown);

  await reportProgress?.(40);
  const sections = buildKnowledgeSectionGraph(markdown, documentId, groupId);
  const autoMeta = extractAutoDocumentMetadata(markdown, documentTitle);
  const resolvedTitle = doc.titleManual ? doc.name : autoMeta.title;
  const resolvedDescription = doc.descriptionManual
    ? (doc.description ?? null)
    : autoMeta.description;

  let metadataEmbedding: number[] | undefined;
  if (DOC_META_VECTOR_ENABLED) {
    const metadataText = buildDocumentMetadataEmbeddingText({
      title: resolvedTitle,
      description: resolvedDescription,
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

  const metadata = {
    ...(doc.metadata ?? {}),
    sectionGraphVersion: SECTION_GRAPH_VERSION,
  };

  await reportProgress?.(50);
  const chunks = chunkKnowledgeSections(
    sections,
    group.chunkSize,
    group.chunkOverlapPercent,
  );
  if (chunks.length === 0) {
    return {
      markdown,
      sections,
      chunks: [],
      totalTokens: 0,
      metadata,
      metadataEmbedding,
      resolvedTitle,
      resolvedDescription,
    };
  }

  await reportProgress?.(60);
  const enrichedChunks = await enrichChunksWithContext(
    chunks,
    autoMeta.title || documentTitle,
    sections.map((section) => ({
      id: section.id,
      headingPath: section.headingPath,
      content: section.content,
      summary: section.summary,
      parentSectionId: section.parentSectionId ?? null,
    })),
  );

  await reportProgress?.(75);
  const embeddings = await embedTexts(
    enrichedChunks.map((chunk) => chunk.embeddingText),
    group.embeddingProvider,
    group.embeddingModel,
  );

  const totalTokens = enrichedChunks.reduce((sum, chunk) => {
    return sum + chunk.tokenCount;
  }, 0);

  return {
    markdown,
    sections,
    chunks: enrichedChunks.map((chunk, index) => ({
      id: generateUUID(),
      documentId,
      groupId,
      sectionId: chunk.sectionId ?? null,
      content: chunk.content,
      contextSummary: chunk.contextSummary || null,
      chunkIndex: chunk.chunkIndex,
      tokenCount: chunk.tokenCount,
      metadata: chunk.metadata,
      embedding: embeddings[index] ?? [],
    })),
    totalTokens,
    metadata,
    metadataEmbedding,
    resolvedTitle,
    resolvedDescription,
  };
}
