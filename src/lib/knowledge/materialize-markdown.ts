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
import { detectChunkLanguage, resolveContentKind } from "./content-routing";
import { buildDocumentImageEmbeddingText } from "./document-images";
import {
  buildKnowledgeBaseTitle,
  buildKnowledgeDisplayContext,
  buildKnowledgeLocationLabel,
  buildKnowledgeTopicLabel,
  buildKnowledgeVariantLabel,
  buildDocumentMetadataEmbeddingText,
  buildDocumentCanonicalTitle,
  deriveKnowledgeTemporalHints,
  extractAutoDocumentMetadata,
  generateDocumentMetadata,
} from "./document-metadata";
import { buildEntityEmbeddingText, extractKnowledgeEntities } from "./entities";
import { embedSingleTextWithUsage, embedTextsWithUsage } from "./embedder";
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
  contentEmbedding?: number[] | null;
  contextEmbedding?: number[] | null;
  identityEmbedding?: number[] | null;
  entityEmbedding?: number[] | null;
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

type EmbeddingWarning = {
  stage: string;
  message: string;
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

function buildChunkIdentityText(chunk: {
  content: string;
  contextSummary?: string | null;
  metadata?: KnowledgeChunkMetadata | null;
}): string {
  const metadata = chunk.metadata ?? null;
  const display = metadata?.display ?? null;
  const documentContext = metadata?.documentContext ?? null;
  const sourceContext = metadata?.sourceContext ?? null;
  return [
    display?.documentLabel || documentContext?.canonicalTitle
      ? `Document: ${display?.documentLabel ?? documentContext?.canonicalTitle}`
      : "",
    display?.variantLabel ? `Variant: ${display.variantLabel}` : "",
    display?.topicLabel ? `Topic: ${display.topicLabel}` : "",
    display?.locationLabel ? `Location: ${display.locationLabel}` : "",
    metadata?.headingPath ? `Section path: ${metadata.headingPath}` : "",
    metadata?.sectionTitle ? `Section title: ${metadata.sectionTitle}` : "",
    sourceContext?.libraryId || metadata?.libraryId
      ? `Library: ${sourceContext?.libraryId ?? metadata?.libraryId}`
      : "",
    sourceContext?.libraryVersion || metadata?.libraryVersion
      ? `Library version: ${sourceContext?.libraryVersion ?? metadata?.libraryVersion}`
      : "",
    metadata?.contentKind ? `Content kind: ${metadata.contentKind}` : "",
    metadata?.language ? `Language: ${metadata.language}` : "",
    metadata?.noteNumber
      ? `Note: ${metadata.noteSubsection ? `${metadata.noteNumber}.${metadata.noteSubsection}` : metadata.noteNumber}`
      : "",
    metadata?.noteTitle ? `Note title: ${metadata.noteTitle}` : "",
    metadata?.temporalHints?.effectiveAt
      ? `Effective at: ${metadata.temporalHints.effectiveAt}`
      : "",
    chunk.contextSummary ? `Context: ${chunk.contextSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getEmbeddingErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function embedTextsSafely(input: {
  label: string;
  documentId: string;
  texts: string[];
  provider: string;
  model: string;
  warnings: EmbeddingWarning[];
}): Promise<{ embeddings: number[][]; usageTokens: number }> {
  if (input.texts.length === 0) {
    return {
      embeddings: [],
      usageTokens: 0,
    };
  }

  try {
    return await embedTextsWithUsage(input.texts, input.provider, input.model);
  } catch (error) {
    input.warnings.push({
      stage: input.label,
      message: getEmbeddingErrorMessage(error),
    });
    console.warn(
      `[ContextX] ${input.label} embedding failed for document ${input.documentId}:`,
      error,
    );
    return {
      embeddings: [],
      usageTokens: 0,
    };
  }
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
  const retrievalCanonicalTitle = buildDocumentCanonicalTitle({
    markdown,
    fallbackTitle: generatedMeta.title || autoMeta.title || documentTitle,
  });
  const resolvedTitle = doc.titleManual
    ? doc.name
    : generatedMeta.title || retrievalCanonicalTitle || autoMeta.title;
  const resolvedDescription = doc.descriptionManual
    ? (doc.description ?? null)
    : (generatedMeta.description ?? autoMeta.description);
  const contentKind = resolveContentKind(doc.fileType);
  const canonicalTitle =
    retrievalCanonicalTitle || resolvedTitle || documentTitle;
  const documentTemporalHints = deriveKnowledgeTemporalHints({
    title: canonicalTitle,
    originalFilename: doc.originalFilename,
    sourceUrl: doc.sourceUrl,
    content: markdown,
  });
  const documentContext = {
    documentId,
    documentName: resolvedTitle || documentTitle,
    canonicalTitle,
    baseTitle: buildKnowledgeBaseTitle(canonicalTitle),
  };
  const documentDisplay = buildKnowledgeDisplayContext({
    documentLabel: canonicalTitle,
    variantLabel: buildKnowledgeVariantLabel({
      title: canonicalTitle,
      originalFilename: doc.originalFilename,
      sourceUrl: doc.sourceUrl,
      temporalHints: documentTemporalHints,
    }),
  });
  const documentSourceContext = {
    libraryId: null,
    libraryVersion: null,
    sourcePath: doc.sourceUrl ?? doc.originalFilename ?? null,
    sheetName: null,
    sourceGroupName: group.name,
  };
  const sections = buildKnowledgeSectionGraph(markdown, documentId, groupId, {
    canonicalTitle: resolvedTitle,
  });
  let metadataTokens = 0;
  let imageTokens = 0;
  let sectionTokens = 0;
  let chunkTokens = 0;
  const embeddingWarnings: EmbeddingWarning[] = [];

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
        const result = await embedSingleTextWithUsage(
          metadataText,
          group.embeddingProvider,
          group.embeddingModel,
          { cache: false },
        );
        metadataEmbedding = result.embedding;
        metadataTokens = result.usageTokens;
      } catch (err) {
        embeddingWarnings.push({
          stage: "document_metadata",
          message: getEmbeddingErrorMessage(err),
        });
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
    generatedMetadata: {
      title: generatedMeta.title,
      description: generatedMeta.description ?? null,
    },
    documentContext,
    sourceContext: documentSourceContext,
    temporalHints: documentTemporalHints,
    display: documentDisplay,
    pageStates: (inputPages ?? []).map((page) => ({
      pageNumber: page.pageNumber,
      fingerprint: page.fingerprint,
      qualityScore: page.qualityScore,
      extractionMode: page.extractionMode,
      repairReason: page.repairReason ?? null,
      parseFallbackUsed: page.parseFallbackUsed ?? false,
      parseWindowCount: page.parseWindowCount ?? null,
      parseFailedWindowCount: page.parseFailedWindowCount ?? null,
      parseError: page.parseError ?? null,
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
      embeddingWarnings.push({
        stage: "section",
        message: getEmbeddingErrorMessage(err),
      });
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
      embeddingWarnings.push({
        stage: "image",
        message: getEmbeddingErrorMessage(err),
      });
      console.warn(
        `[ContextX] Image embedding failed for document ${documentId}:`,
        err,
      );
    }
  }

  await reportProgress?.(50, { stage: "materializing" });
  const chunkableSections = sections.map((section) => {
    const language = detectChunkLanguage({
      fileType: doc.fileType,
      originalFilename: doc.originalFilename,
      content: section.content,
    });
    const sectionTemporalHints =
      deriveKnowledgeTemporalHints({
        title: canonicalTitle,
        originalFilename: doc.originalFilename,
        sourceUrl: section.sourcePath ?? doc.sourceUrl,
        content: section.content,
      }) ?? documentTemporalHints;
    const topicLabel = buildKnowledgeTopicLabel({
      headingPath: section.headingPath,
      sectionTitle: section.heading,
      noteNumber: section.noteNumber ?? null,
      noteSubsection: section.noteSubsection ?? null,
      noteTitle: section.noteTitle ?? null,
      sourcePath: section.sourcePath ?? null,
    });
    const locationLabel = buildKnowledgeLocationLabel({
      headingPath: section.headingPath,
      noteNumber: section.noteNumber ?? null,
      noteSubsection: section.noteSubsection ?? null,
      noteTitle: section.noteTitle ?? null,
      pageStart: section.pageStart ?? null,
      pageEnd: section.pageEnd ?? null,
    });
    const variantLabel =
      buildKnowledgeVariantLabel({
        title: [canonicalTitle, section.headingPath].filter(Boolean).join("\n"),
        originalFilename: doc.originalFilename,
        sourceUrl: section.sourcePath ?? doc.sourceUrl,
        libraryVersion: section.libraryVersion ?? null,
        temporalHints: sectionTemporalHints,
        fallback: documentDisplay.variantLabel ?? null,
      }) ?? documentDisplay.variantLabel;
    const sourceContext = {
      libraryId: section.libraryId ?? null,
      libraryVersion: section.libraryVersion ?? null,
      sourcePath:
        section.sourcePath ?? doc.sourceUrl ?? doc.originalFilename ?? null,
      sheetName: null,
      sourceGroupName: group.name,
    };
    const locationContext = {
      sectionId: section.id,
      headingPath: section.headingPath,
      noteNumber: section.noteSubsection
        ? `${section.noteNumber ?? ""}.${section.noteSubsection}`
        : (section.noteNumber ?? null),
      noteTitle: section.noteTitle ?? null,
      pageStart: section.pageStart ?? null,
      pageEnd: section.pageEnd ?? null,
      chunkIndex: null,
    };
    const display = buildKnowledgeDisplayContext({
      documentLabel: documentDisplay.documentLabel ?? canonicalTitle,
      variantLabel,
      topicLabel,
      locationLabel,
    });
    const sectionMetadata: KnowledgeChunkMetadata = {
      canonicalTitle: section.canonicalTitle,
      section: section.heading,
      sectionTitle: section.heading,
      headingPath: section.headingPath,
      libraryId: section.libraryId,
      libraryVersion: section.libraryVersion,
      noteTitle: section.noteTitle ?? undefined,
      noteNumber: section.noteNumber ?? undefined,
      noteSubsection: section.noteSubsection ?? undefined,
      sourcePath: section.sourcePath ?? undefined,
      pageStart: section.pageStart ?? undefined,
      pageEnd: section.pageEnd ?? undefined,
      documentContext,
      sourceContext,
      locationContext,
      display,
      temporalHints: sectionTemporalHints,
    };
    const entityTerms = extractKnowledgeEntities({
      headingPath: section.headingPath,
      content: section.content,
      metadata: sectionMetadata,
    }).map((entity) => entity.canonicalName);

    return {
      ...section,
      contentKind,
      ...(language ? { language } : {}),
      entityTerms,
      documentContext,
      sourceContext,
      locationContext,
      display,
      temporalHints: sectionTemporalHints,
    };
  });
  const chunks = chunkKnowledgeSections(
    chunkableSections,
    group.chunkSize,
    group.chunkOverlapPercent,
    {
      sourceMarkdown: markdown,
    },
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
        imageType: image.imageType ?? null,
        ocrText: image.ocrText ?? null,
        ocrConfidence: image.ocrConfidence ?? null,
        exactValueSnippets: image.exactValueSnippets ?? null,
        structuredData: image.structuredData ?? null,
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
        ...(embeddingWarnings.length > 0 ? { embeddingWarnings } : {}),
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
  const contentTexts = enrichedChunks.map((chunk) => chunk.content);
  const contextTexts = enrichedChunks.map(
    (chunk) => chunk.contextSummary || chunk.embeddingText,
  );
  const identityTexts = enrichedChunks.map(
    (chunk) => buildChunkIdentityText(chunk) || chunk.embeddingText,
  );
  const entityTexts = enrichedChunks.map((chunk) => {
    const entityText = buildEntityEmbeddingText({
      metadata: chunk.metadata,
      content: chunk.content,
    });
    return entityText || chunk.embeddingText;
  });

  const [
    legacyEmbeddingResult,
    contentEmbeddingResult,
    contextEmbeddingResult,
    identityEmbeddingResult,
    entityEmbeddingResult,
  ] = await Promise.all([
    embedTextsSafely({
      label: "legacy_chunk",
      documentId,
      texts: enrichedChunks.map((chunk) => chunk.embeddingText),
      provider: group.embeddingProvider,
      model: group.embeddingModel,
      warnings: embeddingWarnings,
    }),
    embedTextsSafely({
      label: "content_chunk",
      documentId,
      texts: contentTexts,
      provider: group.embeddingProvider,
      model: group.embeddingModel,
      warnings: embeddingWarnings,
    }),
    embedTextsSafely({
      label: "context_chunk",
      documentId,
      texts: contextTexts,
      provider: group.embeddingProvider,
      model: group.embeddingModel,
      warnings: embeddingWarnings,
    }),
    embedTextsSafely({
      label: "identity_chunk",
      documentId,
      texts: identityTexts,
      provider: group.embeddingProvider,
      model: group.embeddingModel,
      warnings: embeddingWarnings,
    }),
    embedTextsSafely({
      label: "entity_chunk",
      documentId,
      texts: entityTexts,
      provider: group.embeddingProvider,
      model: group.embeddingModel,
      warnings: embeddingWarnings,
    }),
  ]);
  const embeddings = enrichedChunks.map(
    (_, index) =>
      legacyEmbeddingResult.embeddings[index] ??
      contentEmbeddingResult.embeddings[index] ??
      contextEmbeddingResult.embeddings[index] ??
      identityEmbeddingResult.embeddings[index] ??
      entityEmbeddingResult.embeddings[index] ??
      [],
  );
  const contentEmbeddings = contentEmbeddingResult.embeddings;
  const contextEmbeddings = contextEmbeddingResult.embeddings;
  const identityEmbeddings = identityEmbeddingResult.embeddings;
  const entityEmbeddings = entityEmbeddingResult.embeddings;
  chunkTokens =
    legacyEmbeddingResult.usageTokens +
    contentEmbeddingResult.usageTokens +
    contextEmbeddingResult.usageTokens +
    identityEmbeddingResult.usageTokens +
    entityEmbeddingResult.usageTokens;

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
      contentEmbedding: contentEmbeddings[index] ?? null,
      contextEmbedding: contextEmbeddings[index] ?? null,
      identityEmbedding: identityEmbeddings[index] ?? null,
      entityEmbedding: entityEmbeddings[index] ?? null,
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
      imageType: image.imageType ?? null,
      ocrText: image.ocrText ?? null,
      ocrConfidence: image.ocrConfidence ?? null,
      exactValueSnippets: image.exactValueSnippets ?? null,
      structuredData: image.structuredData ?? null,
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
      ...(embeddingWarnings.length > 0 ? { embeddingWarnings } : {}),
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
