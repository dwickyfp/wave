ALTER TABLE "knowledge_document"
ADD COLUMN "fingerprint" text;

CREATE UNIQUE INDEX "knowledge_document_group_fingerprint_unique"
ON "knowledge_document" USING btree ("group_id","fingerprint");
