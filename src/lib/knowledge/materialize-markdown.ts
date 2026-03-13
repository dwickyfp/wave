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
  buildDocumentRetrievalIdentity,
  extractAutoDocumentMetadata,
  generateDocumentMetadata,
} from "./document-metadata";
import { embedSingleTextWithUsage, embedTextsWithUsage } from "./embedder";
import { normalizeStructuredMarkdown } from "./markdown-structurer";
import { classifyFinancialStatementDocument } from "./financial-statement";
import {
  buildKnowledgeSectionGraph,
  SECTION_GRAPH_VERSION,
} from "./section-graph";
import type {
  ProcessedDocumentImage,
  ProcessedDocumentPage,
} from "./processor/types";

const DOC_META_VECTOR_ENABLED = process.env.DOC_META_VECTOR_ENABLED !== "false";

type SectionGraphSection = ReturnType<
  typeof buildKnowledgeSectionGraph
>[number];

export type MaterializedKnowledgeSection = SectionGraphSection & {
  embedding?: number[] | null;
};

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

export type MaterializedEmbeddingUsage = {
  totalTokens: number;
  metadataTokens: number;
  imageTokens: number;
  sectionTokens: number;
  chunkTokens: number;
  provider: string;
  model: string;
};

export type MaterializedDocumentState = {
  markdown: string;
  sections: MaterializedKnowledgeSection[];
  chunks: MaterializedKnowledgeChunk[];
  images: MaterializedKnowledgeImage[];
  totalTokens: number;
  embeddingTokenCount: number;
  embeddingUsage: MaterializedEmbeddingUsage;
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
  reportProgress?: (
    pct: number,
    processingState?: {
      stage: "materializing" | "embedding";
    },
  ) => Promise<void> | void;
};

function formatSectionPageSpan(section: {
  pageStart?: number;
  pageEnd?: number;
}) {
  const start = section.pageStart;
  const end = section.pageEnd;
  if (!start) return "";
  if (!end || end === start) return `Page ${start}`;
  return `Pages ${start}-${end}`;
}

function buildSectionEmbeddingText(section: SectionGraphSection): string {
  const excerpt = section.content.trim().slice(0, 1200);
  return [
    section.canonicalTitle ? `Document: ${section.canonicalTitle}` : "",
    section.issuerName ? `Issuer: ${section.issuerName}` : "",
    section.issuerTicker ? `Ticker: ${section.issuerTicker}` : "",
    section.reportType ? `Report type: ${section.reportType}` : "",
    section.fiscalYear ? `Fiscal year: ${section.fiscalYear}` : "",
    `Section path: ${section.headingPath}`,
    section.noteNumber
      ? `Note: ${section.noteSubsection ? `${section.noteNumber}.${section.noteSubsection}` : section.noteNumber}`
      : "",
    section.noteTitle ? `Note title: ${section.noteTitle}` : "",
    section.summary ? `Summary: ${section.summary}` : "",
    excerpt ? `Excerpt: ${excerpt}` : "",
    formatSectionPageSpan(section),
  ]
    .filter(Boolean)
    .join("\n");
}

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

  await reportProgress?.(40, { stage: "materializing" });
  const autoMeta = extractAutoDocumentMetadata(markdown, documentTitle);
  const generatedMeta =
    doc.titleManual && doc.descriptionManual
      ? autoMeta
      : await generateDocumentMetadata({
          markdown,
          fallbackTitle: autoMeta.title || documentTitle,
          originalFilename: doc.originalFilename,
          sourceUrl: doc.sourceUrl,
          pageCount: inputPages?.length ?? null,
          modelConfig: contextModel,
        });
  const retrievalIdentity = buildDocumentRetrievalIdentity({
    markdown,
    fallbackTitle: generatedMeta.title || autoMeta.title || documentTitle,
    originalFilename: doc.originalFilename,
    pageCount: inputPages?.length ?? null,
  });
  const classification = classifyFinancialStatementDocument({
    markdown,
    pageCount: inputPages?.length ?? undefined,
    filename: doc.originalFilename,
  });
  const resolvedTitle = doc.titleManual
    ? doc.name
    : generatedMeta.title || retrievalIdentity.canonicalTitle || autoMeta.title;
  const resolvedDescription = doc.descriptionManual
    ? (doc.description ?? null)
    : (generatedMeta.description ?? autoMeta.description);
  const sections = buildKnowledgeSectionGraph(markdown, documentId, groupId, {
    retrievalIdentity,
    classification,
  });
  let metadataTokens = 0;
  let imageTokens = 0;
  let sectionTokens = 0;
  let chunkTokens = 0;

  let metadataEmbedding: number[] | undefined;
  if (DOC_META_VECTOR_ENABLED) {
    const metadataText = buildDocumentMetadataEmbeddingText({
      title: resolvedTitle,
      description: resolvedDescription,
      originalFilename: doc.originalFilename,
      sourceUrl: doc.sourceUrl,
      retrievalIdentity,
    });
    if (metadataText) {
      try {
        const result = await embedSingleTextWithUsage(
          metadataText,
          group.embeddingProvider,
          group.embeddingModel,
          { cache: false },
        );
        metadataEmbedding = result.embedding;
        metadataTokens = result.usageTokens;
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
    retrievalIdentity,
    generatedMetadata: {
      title: generatedMeta.title,
      description: generatedMeta.description ?? null,
    },
    pageStates: (inputPages ?? []).map((page) => ({
      pageNumber: page.pageNumber,
      fingerprint: page.fingerprint,
      qualityScore: page.qualityScore,
      extractionMode: page.extractionMode,
      repairReason: page.repairReason ?? null,
    })),
  };
  const existingIngestUsage =
    ((doc.metadata as Record<string, unknown> | null | undefined)
      ?.ingestUsage as Record<string, unknown> | undefined) ?? {};

  let sectionEmbeddings: number[][] = [];
  if (sections.length > 0) {
    try {
      const result = await embedTextsWithUsage(
        sections.map(buildSectionEmbeddingText),
        group.embeddingProvider,
        group.embeddingModel,
      );
      sectionEmbeddings = result.embeddings;
      sectionTokens = result.usageTokens;
    } catch (err) {
      console.warn(
        `[ContextX] Section embedding failed for document ${documentId}:`,
        err,
      );
    }
  }

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
      const result = await embedTextsWithUsage(
        imageEmbeddingTexts,
        group.embeddingProvider,
        group.embeddingModel,
      );
      imageEmbeddings = result.embeddings;
      imageTokens = result.usageTokens;
    } catch (err) {
      console.warn(
        `[ContextX] Image embedding failed for document ${documentId}:`,
        err,
      );
    }
  }

  await reportProgress?.(50, { stage: "materializing" });
  const chunks = chunkKnowledgeSections(
    sections,
    group.chunkSize,
    group.chunkOverlapPercent,
  );
  if (chunks.length === 0) {
    const embeddingUsage = {
      totalTokens: metadataTokens + imageTokens + sectionTokens,
      metadataTokens,
      imageTokens,
      sectionTokens,
      chunkTokens,
      provider: group.embeddingProvider,
      model: group.embeddingModel,
    } satisfies MaterializedEmbeddingUsage;

    return {
      markdown,
      sections: sections.map((section, index) => ({
        ...section,
        embedding: sectionEmbeddings[index] ?? null,
      })),
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
        precedingText: image.precedingText ?? null,
        followingText: image.followingText ?? null,
        isRenderable: image.isRenderable ?? false,
        manualLabel: image.manualLabel ?? false,
        manualDescription: image.manualDescription ?? false,
        embedding: imageEmbeddings[index] ?? null,
      })),
      totalTokens: 0,
      embeddingTokenCount: embeddingUsage.totalTokens,
      embeddingUsage,
      metadata: {
        ...metadata,
        ingestUsage: {
          ...existingIngestUsage,
          embedding: embeddingUsage,
        },
      },
      metadataEmbedding,
      resolvedTitle,
      resolvedDescription,
    };
  }

  await reportProgress?.(60, { stage: "materializing" });
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

  await reportProgress?.(75, { stage: "embedding" });
  const chunkEmbeddingResult = await embedTextsWithUsage(
    enrichedChunks.map((chunk) => chunk.embeddingText),
    group.embeddingProvider,
    group.embeddingModel,
  );
  const embeddings = chunkEmbeddingResult.embeddings;
  chunkTokens = chunkEmbeddingResult.usageTokens;

  const totalTokens = enrichedChunks.reduce((sum, chunk) => {
    return sum + chunk.tokenCount;
  }, 0);
  const embeddingUsage = {
    totalTokens: metadataTokens + imageTokens + sectionTokens + chunkTokens,
    metadataTokens,
    imageTokens,
    sectionTokens,
    chunkTokens,
    provider: group.embeddingProvider,
    model: group.embeddingModel,
  } satisfies MaterializedEmbeddingUsage;

  return {
    markdown,
    sections: sections.map((section, index) => ({
      ...section,
      embedding: sectionEmbeddings[index] ?? null,
    })),
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
      precedingText: image.precedingText ?? null,
      followingText: image.followingText ?? null,
      isRenderable: image.isRenderable ?? false,
      manualLabel: image.manualLabel ?? false,
      manualDescription: image.manualDescription ?? false,
      embedding: imageEmbeddings[index] ?? null,
    })),
    totalTokens,
    embeddingTokenCount: embeddingUsage.totalTokens,
    embeddingUsage,
    metadata: {
      ...metadata,
      ingestUsage: {
        ...existingIngestUsage,
        embedding: embeddingUsage,
      },
    },
    metadataEmbedding,
    resolvedTitle,
    resolvedDescription,
  };
}
