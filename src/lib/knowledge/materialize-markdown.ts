import type {
  KnowledgeContextMode,
  KnowledgeChunkMetadata,
  KnowledgeDocument,
  KnowledgeDocumentImage,
  KnowledgeGroup,
} from "app-types/knowledge";
import { generateUUID } from "lib/utils";
import { chunkKnowledgeSections } from "./chunker";
import { enrichChunksWithContext } from "./context-enricher";
import { buildDocumentImageEmbeddingText } from "./document-images";
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
import type {
  ProcessedDocumentImage,
  ProcessedDocumentPage,
} from "./processor/types";

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

export type MaterializedKnowledgeImage = Omit<
  KnowledgeDocumentImage,
  "createdAt" | "updatedAt"
> & {
  embedding?: number[] | null;
};

export type MaterializedDocumentState = {
  markdown: string;
  sections: MaterializedKnowledgeSection[];
  chunks: MaterializedKnowledgeChunk[];
  images: MaterializedKnowledgeImage[];
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
  images?: ProcessedDocumentImage[];
  pages?: ProcessedDocumentPage[];
  contextMode?: KnowledgeContextMode;
  contextModel?: { provider: string; model: string } | null;
  reportProgress?: (pct: number) => Promise<void> | void;
};

export async function materializeDocumentMarkdown({
  documentId,
  groupId,
  documentTitle,
  doc,
  group,
  markdown: inputMarkdown,
  images: inputImages,
  pages: inputPages,
  contextMode = "deterministic",
  contextModel = null,
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
    pageStates: (inputPages ?? []).map((page) => ({
      pageNumber: page.pageNumber,
      fingerprint: page.fingerprint,
      qualityScore: page.qualityScore,
      extractionMode: page.extractionMode,
      repairReason: page.repairReason ?? null,
    })),
  };

  const imageEmbeddingTexts = (inputImages ?? [])
    .map((image) =>
      buildDocumentImageEmbeddingText({
        documentTitle: resolvedTitle,
        image,
      }),
    )
    .filter(Boolean);
  let imageEmbeddings: number[][] = [];
  if (imageEmbeddingTexts.length > 0) {
    try {
      imageEmbeddings = await embedTexts(
        imageEmbeddingTexts,
        group.embeddingProvider,
        group.embeddingModel,
      );
    } catch (err) {
      console.warn(
        `[ContextX] Image embedding failed for document ${documentId}:`,
        err,
      );
    }
  }

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
      images: (inputImages ?? []).map((image, index) => ({
        id: generateUUID(),
        documentId,
        groupId,
        versionId: null,
        kind: image.kind,
        ordinal: image.index,
        marker: image.marker,
        label: image.label,
        description: image.description,
        headingPath: image.headingPath ?? null,
        stepHint: image.stepHint ?? null,
        sourceUrl: image.sourceUrl ?? null,
        storagePath: image.storagePath ?? null,
        mediaType: image.mediaType ?? null,
        pageNumber: image.pageNumber ?? null,
        width: image.width ?? null,
        height: image.height ?? null,
        altText: image.altText ?? null,
        caption: image.caption ?? null,
        surroundingText: image.surroundingText ?? null,
        isRenderable: image.isRenderable ?? false,
        manualLabel: image.manualLabel ?? false,
        manualDescription: image.manualDescription ?? false,
        embedding: imageEmbeddings[index] ?? null,
      })),
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
    {
      mode: contextMode,
      modelConfig: contextModel,
    },
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
    images: (inputImages ?? []).map((image, index) => ({
      id: generateUUID(),
      documentId,
      groupId,
      versionId: null,
      kind: image.kind,
      ordinal: image.index,
      marker: image.marker,
      label: image.label,
      description: image.description,
      headingPath: image.headingPath ?? null,
      stepHint: image.stepHint ?? null,
      sourceUrl: image.sourceUrl ?? null,
      storagePath: image.storagePath ?? null,
      mediaType: image.mediaType ?? null,
      pageNumber: image.pageNumber ?? null,
      width: image.width ?? null,
      height: image.height ?? null,
      altText: image.altText ?? null,
      caption: image.caption ?? null,
      surroundingText: image.surroundingText ?? null,
      isRenderable: image.isRenderable ?? false,
      manualLabel: image.manualLabel ?? false,
      manualDescription: image.manualDescription ?? false,
      embedding: imageEmbeddings[index] ?? null,
    })),
    totalTokens,
    metadata,
    metadataEmbedding,
    resolvedTitle,
    resolvedDescription,
  };
}
