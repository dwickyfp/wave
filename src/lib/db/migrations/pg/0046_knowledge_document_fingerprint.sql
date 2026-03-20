ALTER TABLE "knowledge_document"
ADD COLUMN IF NOT EXISTS "fingerprint" text;

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_document_group_fingerprint_unique"
ON "knowledge_document" USING btree ("group_id","fingerprint");
