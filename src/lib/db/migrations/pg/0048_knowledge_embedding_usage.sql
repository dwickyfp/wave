ALTER TABLE "knowledge_document"
ADD COLUMN "embedding_token_count" integer NOT NULL DEFAULT 0;

ALTER TABLE "knowledge_document_version"
ADD COLUMN "embedding_token_count" integer NOT NULL DEFAULT 0;
