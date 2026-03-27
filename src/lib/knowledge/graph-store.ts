import { and, eq, inArray, ne } from "drizzle-orm";
import { pgDb as db } from "lib/db/pg/db.pg";

const GRAPH_BATCH_SIZE = 200;
import {
  KnowledgeEntityMentionTable,
  KnowledgeEntityTable,
  KnowledgeRelationTable,
  KnowledgeSectionTable,
  KnowledgeDocumentTable,
} from "lib/db/pg/schema.pg";
import { extractKnowledgeEntities, normalizeEntityName } from "./entities";

type GraphChunk = {
  id: string;
  sectionId?: string | null;
  content: string;
  metadata?: {
    headingPath?: string;
    pageStart?: number;
    pageEnd?: number;
    entityTerms?: string[];
  } | null;
};

type GraphSection = {
  id: string;
  headingPath: string;
  heading: string;
  content: string;
  prevSectionId?: string | null;
  noteNumber?: string | null;
};

function normalizeHeading(value: string): string {
  return normalizeEntityName(value.replace(/\s*>\s*/g, " "));
}

function inferCrossDocumentRelationType(input: {
  sourceHeadingPath: string;
  targetHeadingPath: string;
  sourceNoteNumber?: string | null;
  targetNoteNumber?: string | null;
  targetUpdatedAt?: Date | null;
  currentUpdatedAt: Date;
}): "updates" | "related" {
  const sourceHeading = normalizeHeading(input.sourceHeadingPath);
  const targetHeading = normalizeHeading(input.targetHeadingPath);
  const sameHeading = sourceHeading && sourceHeading === targetHeading;
  const sameNote =
    input.sourceNoteNumber &&
    input.targetNoteNumber &&
    input.sourceNoteNumber === input.targetNoteNumber;

  if (
    (sameHeading || sameNote) &&
    input.targetUpdatedAt &&
    input.currentUpdatedAt >= input.targetUpdatedAt
  ) {
    return "updates";
  }

  return "related";
}

export async function replaceDocumentKnowledgeGraph(input: {
  documentId: string;
  groupId: string;
  sections: GraphSection[];
  chunks: GraphChunk[];
  documentUpdatedAt?: Date | null;
}) {
  await db
    .delete(KnowledgeRelationTable)
    .where(
      and(
        eq(KnowledgeRelationTable.groupId, input.groupId),
        eq(KnowledgeRelationTable.sourceDocumentId, input.documentId),
      ),
    );
  await db
    .delete(KnowledgeEntityMentionTable)
    .where(
      and(
        eq(KnowledgeEntityMentionTable.groupId, input.groupId),
        eq(KnowledgeEntityMentionTable.documentId, input.documentId),
      ),
    );

  const sectionById = new Map(
    input.sections.map((section) => [section.id, section]),
  );
  const extracted = new Map<
    string,
    {
      canonicalName: string;
      normalizedName: string;
      entityType: string;
      aliases: string[];
      mentions: Array<{
        sectionId?: string | null;
        chunkId?: string | null;
        matchedText: string;
        weight: number;
        pageStart?: number | null;
        pageEnd?: number | null;
      }>;
    }
  >();

  for (const chunk of input.chunks) {
    const entities = extractKnowledgeEntities({
      headingPath:
        chunk.metadata?.headingPath ??
        (chunk.sectionId ? sectionById.get(chunk.sectionId)?.headingPath : ""),
      content: chunk.content,
      metadata: chunk.metadata ?? null,
    });
    for (const entity of entities) {
      const existing = extracted.get(entity.normalizedName);
      if (!existing) {
        extracted.set(entity.normalizedName, {
          canonicalName: entity.canonicalName,
          normalizedName: entity.normalizedName,
          entityType: entity.entityType,
          aliases: entity.aliases,
          mentions: [
            {
              sectionId: chunk.sectionId ?? null,
              chunkId: chunk.id,
              matchedText: entity.matchedText,
              weight: entity.entityType === "code" ? 0.8 : 1,
              pageStart: chunk.metadata?.pageStart ?? null,
              pageEnd: chunk.metadata?.pageEnd ?? null,
            },
          ],
        });
        continue;
      }

      existing.aliases = Array.from(
        new Set([...existing.aliases, ...entity.aliases]),
      );
      existing.mentions.push({
        sectionId: chunk.sectionId ?? null,
        chunkId: chunk.id,
        matchedText: entity.matchedText,
        weight: entity.entityType === "code" ? 0.8 : 1,
        pageStart: chunk.metadata?.pageStart ?? null,
        pageEnd: chunk.metadata?.pageEnd ?? null,
      });
    }
  }

  const extractedEntities = Array.from(extracted.values());
  if (extractedEntities.length > 0) {
    const rows: Array<{ id: string; normalizedName: string }> = [];
    for (let i = 0; i < extractedEntities.length; i += GRAPH_BATCH_SIZE) {
      const batch = extractedEntities.slice(i, i + GRAPH_BATCH_SIZE);
      const batchRows = await db
        .insert(KnowledgeEntityTable)
        .values(
          batch.map((entity) => ({
            groupId: input.groupId,
            documentId: input.documentId,
            canonicalName: entity.canonicalName,
            normalizedName: entity.normalizedName,
            entityType: entity.entityType,
            aliases: entity.aliases,
            updatedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [
            KnowledgeEntityTable.groupId,
            KnowledgeEntityTable.normalizedName,
          ],
          set: {
            documentId: input.documentId,
            updatedAt: new Date(),
          },
        })
        .returning({
          id: KnowledgeEntityTable.id,
          normalizedName: KnowledgeEntityTable.normalizedName,
        });
      rows.push(...batchRows);
    }

    const entityIdByNormalizedName = new Map(
      rows.map((row) => [row.normalizedName, row.id]),
    );

    const mentionRows = extractedEntities.flatMap((entity) => {
      const entityId = entityIdByNormalizedName.get(entity.normalizedName);
      if (!entityId) return [];
      return entity.mentions.map((mention) => ({
        groupId: input.groupId,
        documentId: input.documentId,
        entityId,
        sectionId: mention.sectionId ?? null,
        chunkId: mention.chunkId ?? null,
        matchedText: mention.matchedText,
        weight: mention.weight,
        pageStart: mention.pageStart ?? null,
        pageEnd: mention.pageEnd ?? null,
      }));
    });

    if (mentionRows.length > 0) {
      for (let i = 0; i < mentionRows.length; i += GRAPH_BATCH_SIZE) {
        const batch = mentionRows.slice(i, i + GRAPH_BATCH_SIZE);
        await db.insert(KnowledgeEntityMentionTable).values(batch);
      }
    }

    const currentUpdatedAt = input.documentUpdatedAt ?? new Date();
    const currentMentionSectionIds = Array.from(
      new Set(
        mentionRows
          .map((row) => row.sectionId)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const intraDocRelations = input.sections
      .filter((section) => section.prevSectionId)
      .map((section) => ({
        groupId: input.groupId,
        sourceDocumentId: input.documentId,
        sourceSectionId: section.prevSectionId!,
        targetDocumentId: input.documentId,
        targetSectionId: section.id,
        relationType: "extends" as const,
        weight: 0.55,
      }));

    const peerRows =
      rows.length === 0
        ? []
        : await db
            .select({
              entityId: KnowledgeEntityMentionTable.entityId,
              sectionId: KnowledgeEntityMentionTable.sectionId,
              documentId: KnowledgeEntityMentionTable.documentId,
              headingPath: KnowledgeSectionTable.headingPath,
              noteNumber: KnowledgeSectionTable.noteNumber,
              updatedAt: KnowledgeDocumentTable.updatedAt,
            })
            .from(KnowledgeEntityMentionTable)
            .innerJoin(
              KnowledgeSectionTable,
              eq(
                KnowledgeSectionTable.id,
                KnowledgeEntityMentionTable.sectionId,
              ),
            )
            .innerJoin(
              KnowledgeDocumentTable,
              eq(
                KnowledgeDocumentTable.id,
                KnowledgeEntityMentionTable.documentId,
              ),
            )
            .where(
              and(
                eq(KnowledgeEntityMentionTable.groupId, input.groupId),
                inArray(
                  KnowledgeEntityMentionTable.entityId,
                  rows.map((row) => row.id),
                ),
                ne(KnowledgeEntityMentionTable.documentId, input.documentId),
              ),
            );

    const mentionRowsByEntity = new Map<string, typeof mentionRows>();
    for (const mention of mentionRows) {
      const existing = mentionRowsByEntity.get(mention.entityId) ?? [];
      existing.push(mention);
      mentionRowsByEntity.set(mention.entityId, existing);
    }

    const crossDocRelations: Array<{
      groupId: string;
      sourceDocumentId: string;
      sourceSectionId: string;
      targetDocumentId: string;
      targetSectionId: string;
      relationType: "updates" | "related";
      weight: number;
    }> = [];

    for (const peer of peerRows) {
      const sources = mentionRowsByEntity.get(peer.entityId) ?? [];
      for (const source of sources) {
        if (!source.sectionId || !peer.sectionId) continue;
        if (!currentMentionSectionIds.includes(source.sectionId)) continue;
        const sourceSection = sectionById.get(source.sectionId);
        if (!sourceSection) continue;
        crossDocRelations.push({
          groupId: input.groupId,
          sourceDocumentId: input.documentId,
          sourceSectionId: source.sectionId,
          targetDocumentId: peer.documentId,
          targetSectionId: peer.sectionId,
          relationType: inferCrossDocumentRelationType({
            sourceHeadingPath: sourceSection.headingPath,
            targetHeadingPath: peer.headingPath,
            sourceNoteNumber: sourceSection.noteNumber ?? null,
            targetNoteNumber: peer.noteNumber ?? null,
            targetUpdatedAt: peer.updatedAt,
            currentUpdatedAt,
          }),
          weight: 0.72,
        });
      }
    }

    const relationRows = Array.from(
      new Map(
        [...intraDocRelations, ...crossDocRelations].map((relation) => [
          [
            relation.sourceSectionId,
            relation.targetSectionId,
            relation.relationType,
          ].join(":"),
          relation,
        ]),
      ).values(),
    );

    if (relationRows.length > 0) {
      for (let i = 0; i < relationRows.length; i += GRAPH_BATCH_SIZE) {
        const batch = relationRows.slice(i, i + GRAPH_BATCH_SIZE);
        await db.insert(KnowledgeRelationTable).values(
          batch.map((relation) => ({
            ...relation,
            effectiveAt: currentUpdatedAt,
            expiresAt: null,
            updatedAt: new Date(),
          })),
        );
      }
    }
  }
}

export async function searchKnowledgeEntities(
  groupId: string,
  terms: string[],
  limit = 12,
) {
  const normalizedTerms = Array.from(
    new Set(terms.map(normalizeEntityName).filter(Boolean)),
  );
  if (normalizedTerms.length === 0) return [];

  const rows = await db
    .select({
      entityId: KnowledgeEntityTable.id,
      normalizedName: KnowledgeEntityTable.normalizedName,
    })
    .from(KnowledgeEntityTable)
    .where(
      and(
        eq(KnowledgeEntityTable.groupId, groupId),
        inArray(KnowledgeEntityTable.normalizedName, normalizedTerms),
      ),
    )
    .limit(limit);

  return rows;
}

export async function getSectionSeedsForEntities(
  groupId: string,
  entityIds: string[],
  limit = 24,
) {
  if (entityIds.length === 0) return [];

  const rows = await db
    .select({
      sectionId: KnowledgeEntityMentionTable.sectionId,
      documentId: KnowledgeEntityMentionTable.documentId,
      weight: KnowledgeEntityMentionTable.weight,
    })
    .from(KnowledgeEntityMentionTable)
    .where(
      and(
        eq(KnowledgeEntityMentionTable.groupId, groupId),
        inArray(KnowledgeEntityMentionTable.entityId, entityIds),
      ),
    )
    .limit(limit * 2);

  return rows
    .filter(
      (row): row is { sectionId: string; documentId: string; weight: number } =>
        Boolean(row.sectionId),
    )
    .slice(0, limit);
}

export async function getRelatedGraphSections(
  groupId: string,
  seedSectionIds: string[],
  maxHops = 2,
) {
  const visited = new Set(seedSectionIds);
  let frontier = [...seedSectionIds];
  const results: Array<{ sectionId: string; score: number }> = [];
  let decay = 1;

  for (let hop = 0; hop < maxHops; hop += 1) {
    if (frontier.length === 0) break;
    const rows = await db
      .select({
        sourceSectionId: KnowledgeRelationTable.sourceSectionId,
        targetSectionId: KnowledgeRelationTable.targetSectionId,
        weight: KnowledgeRelationTable.weight,
      })
      .from(KnowledgeRelationTable)
      .where(
        and(
          eq(KnowledgeRelationTable.groupId, groupId),
          inArray(KnowledgeRelationTable.sourceSectionId, frontier),
        ),
      );

    frontier = [];
    for (const row of rows) {
      if (visited.has(row.targetSectionId)) continue;
      visited.add(row.targetSectionId);
      frontier.push(row.targetSectionId);
      results.push({
        sectionId: row.targetSectionId,
        score: Number(row.weight ?? 1) * decay,
      });
    }
    decay *= 0.6;
  }

  return results;
}
