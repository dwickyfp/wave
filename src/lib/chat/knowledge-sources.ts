import type { ChatKnowledgeImage, ChatKnowledgeSource } from "app-types/chat";
import type { RetrievedKnowledgeImage } from "lib/knowledge/retriever";
import { buildKnowledgeImageAssetUrl } from "lib/knowledge/document-images";

type KnowledgeSourceDocLike = {
  documentId: string;
  documentName: string;
  sourceGroupId?: string | null;
  sourceGroupName?: string | null;
  isInherited?: boolean;
  matchedSections?: Array<{ heading: string }>;
};

function trimMatchedSections(
  matchedSections?: Array<{ heading: string }>,
): string[] | undefined {
  if (!matchedSections?.length) return undefined;

  const headings = Array.from(
    new Set(
      matchedSections
        .map((section) => section.heading?.trim())
        .filter((heading): heading is string => Boolean(heading)),
    ),
  ).slice(0, 3);

  return headings.length ? headings : undefined;
}

export function dedupeChatKnowledgeSources(
  sources: ChatKnowledgeSource[],
): ChatKnowledgeSource[] {
  const deduped = new Map<string, ChatKnowledgeSource>();

  for (const source of sources) {
    const key = `${source.groupId}:${source.documentId}`;
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, source);
      continue;
    }

    deduped.set(key, {
      ...existing,
      matchedSections: Array.from(
        new Set([
          ...(existing.matchedSections ?? []),
          ...(source.matchedSections ?? []),
        ]),
      ).slice(0, 3),
    });
  }

  return Array.from(deduped.values());
}

export function buildChatKnowledgeSources(input: {
  groupId: string;
  groupName: string;
  docs: KnowledgeSourceDocLike[];
}): ChatKnowledgeSource[] {
  const { groupId, groupName, docs } = input;

  return dedupeChatKnowledgeSources(
    docs.map((doc) => ({
      groupId,
      groupName,
      documentId: doc.documentId,
      documentName: doc.documentName,
      sourceGroupId: doc.sourceGroupId,
      sourceGroupName: doc.sourceGroupName,
      isInherited: doc.isInherited,
      matchedSections: trimMatchedSections(doc.matchedSections),
    })),
  );
}

export function dedupeChatKnowledgeImages(
  images: ChatKnowledgeImage[],
): ChatKnowledgeImage[] {
  const deduped = new Map<string, ChatKnowledgeImage>();
  for (const image of images) {
    const key = `${image.groupId}:${image.documentId}:${image.imageId}:${image.versionId ?? "live"}`;
    if (!deduped.has(key)) {
      deduped.set(key, image);
    }
  }
  return Array.from(deduped.values());
}

export function buildChatKnowledgeImages(input: {
  groupId: string;
  groupName: string;
  docs: Array<{
    documentId: string;
    documentName: string;
    matchedImages?: RetrievedKnowledgeImage[];
  }>;
}): ChatKnowledgeImage[] {
  const { groupId, groupName, docs } = input;
  return dedupeChatKnowledgeImages(
    docs.flatMap((doc) =>
      (doc.matchedImages ?? []).map((image) => ({
        groupId,
        groupName,
        documentId: doc.documentId,
        documentName: doc.documentName,
        imageId: image.id,
        versionId: image.versionId ?? null,
        label: image.label,
        description: image.description,
        headingPath: image.headingPath ?? null,
        stepHint: image.stepHint ?? null,
        pageNumber: image.pageNumber ?? null,
        assetUrl: buildKnowledgeImageAssetUrl({
          groupId,
          documentId: doc.documentId,
          imageId: image.id,
          versionId: image.versionId ?? null,
        }),
      })),
    ),
  );
}

export function mergeChatKnowledgeMetadata(input: {
  existingSources?: ChatKnowledgeSource[];
  existingImages?: ChatKnowledgeImage[];
  retrievedGroups: Array<{
    groupId: string;
    groupName: string;
    docs: Array<
      KnowledgeSourceDocLike & {
        matchedImages?: RetrievedKnowledgeImage[];
      }
    >;
  }>;
  maxImages?: number;
}): {
  knowledgeSources?: ChatKnowledgeSource[];
  knowledgeImages?: ChatKnowledgeImage[];
} {
  const retrievedSources = input.retrievedGroups.flatMap((group) =>
    buildChatKnowledgeSources({
      groupId: group.groupId,
      groupName: group.groupName,
      docs: group.docs,
    }),
  );
  const retrievedImages = input.retrievedGroups.flatMap((group) =>
    buildChatKnowledgeImages({
      groupId: group.groupId,
      groupName: group.groupName,
      docs: group.docs,
    }),
  );

  const mergedSources = dedupeChatKnowledgeSources([
    ...(input.existingSources ?? []),
    ...retrievedSources,
  ]);
  const mergedImages = dedupeChatKnowledgeImages([
    ...retrievedImages,
    ...(input.existingImages ?? []),
  ]).slice(0, input.maxImages ?? Number.POSITIVE_INFINITY);

  return {
    knowledgeSources: mergedSources.length ? mergedSources : undefined,
    knowledgeImages: mergedImages.length ? mergedImages : undefined,
  };
}
