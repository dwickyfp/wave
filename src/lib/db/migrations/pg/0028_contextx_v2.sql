ALTER TABLE "knowledge_document"
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "description_manual" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "title_manual" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "metadata_embedding" vector;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "knowledge_document_updated_at_idx"
  ON "knowledge_document" USING btree ("updated_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "knowledge_document_meta_simple_idx"
  ON "knowledge_document"
  USING gin (
    to_tsvector(
      'simple',
      coalesce("name", '') || ' ' ||
      coalesce("description", '') || ' ' ||
      coalesce("original_filename", '') || ' ' ||
      coalesce("source_url", '')
    )
  );
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "knowledge_document_meta_english_idx"
  ON "knowledge_document"
  USING gin (
    to_tsvector(
      'english',
      coalesce("name", '') || ' ' ||
      coalesce("description", '') || ' ' ||
      coalesce("original_filename", '') || ' ' ||
      coalesce("source_url", '')
    )
  );
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "knowledge_chunk_search_english_idx"
  ON "knowledge_chunk"
  USING gin (
    to_tsvector(
      'english',
      coalesce("context_summary", '') || ' ' ||
      coalesce("content", '') || ' ' ||
      coalesce("metadata"->>'headingPath', '') || ' ' ||
      coalesce("metadata"->>'section', '')
    )
  );
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "knowledge_chunk_search_simple_idx"
  ON "knowledge_chunk"
  USING gin (
    to_tsvector(
      'simple',
      coalesce("context_summary", '') || ' ' ||
      coalesce("content", '') || ' ' ||
      coalesce("metadata"->>'headingPath', '') || ' ' ||
      coalesce("metadata"->>'section', '')
    )
  );
