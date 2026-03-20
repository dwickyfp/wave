ALTER TABLE "knowledge_document"
ADD COLUMN IF NOT EXISTS "embedding_token_count" integer NOT NULL DEFAULT 0;

ALTER TABLE "knowledge_document_version"
ADD COLUMN IF NOT EXISTS "embedding_token_count" integer NOT NULL DEFAULT 0;
