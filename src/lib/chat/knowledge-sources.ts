import type { ChatKnowledgeSource } from "app-types/chat";

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
