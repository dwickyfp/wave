import "load-env";

import { and, eq, inArray } from "drizzle-orm";
import { pgDb as db } from "lib/db/pg/db.pg";
import { KnowledgeDocumentTable } from "lib/db/pg/schema.pg";
import { runIngestPipeline } from "lib/knowledge/ingest-pipeline";

function parseArg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

const groupId = parseArg("group");
const documentId = parseArg("document");
const limit = Number.parseInt(parseArg("limit") ?? "0", 10) || 0;

const where = documentId
  ? eq(KnowledgeDocumentTable.id, documentId)
  : groupId
    ? and(
        eq(KnowledgeDocumentTable.groupId, groupId),
        inArray(KnowledgeDocumentTable.status, ["ready", "failed"]),
      )
    : inArray(KnowledgeDocumentTable.status, ["ready", "failed"]);

const docs = await db
  .select({
    id: KnowledgeDocumentTable.id,
    groupId: KnowledgeDocumentTable.groupId,
    name: KnowledgeDocumentTable.name,
  })
  .from(KnowledgeDocumentTable)
  .where(where)
  .limit(limit > 0 ? limit : 10_000);

console.info(`[ContextX] Reindexing ${docs.length} document(s)`);

for (const doc of docs) {
  console.info(`[ContextX] Reindex ${doc.id} (${doc.name})`);
  await runIngestPipeline(doc.id, doc.groupId);
}

console.info("[ContextX] Reindex completed");
