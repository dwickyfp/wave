ALTER TABLE "knowledge_group"
  ALTER COLUMN "image_mode" SET DEFAULT 'auto';
--> statement-breakpoint

UPDATE "knowledge_group"
SET "image_mode" = 'auto'
WHERE "image_mode" = 'always';
--> statement-breakpoint

ALTER TABLE "knowledge_document_image"
  ADD COLUMN IF NOT EXISTS "image_type" varchar(32),
  ADD COLUMN IF NOT EXISTS "ocr_text" text,
  ADD COLUMN IF NOT EXISTS "ocr_confidence" real,
  ADD COLUMN IF NOT EXISTS "exact_value_snippets" json,
  ADD COLUMN IF NOT EXISTS "structured_data" json;
--> statement-breakpoint

ALTER TABLE "knowledge_document_image_version"
  ADD COLUMN IF NOT EXISTS "image_type" varchar(32),
  ADD COLUMN IF NOT EXISTS "ocr_text" text,
  ADD COLUMN IF NOT EXISTS "ocr_confidence" real,
  ADD COLUMN IF NOT EXISTS "exact_value_snippets" json,
  ADD COLUMN IF NOT EXISTS "structured_data" json;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "knowledge_document_image_search_simple_idx"
  ON "knowledge_document_image"
  USING gin (
    to_tsvector(
      'simple',
      coalesce("label", '') || ' ' ||
      coalesce("description", '') || ' ' ||
      coalesce("heading_path", '') || ' ' ||
      coalesce("step_hint", '') || ' ' ||
      coalesce("caption", '') || ' ' ||
      coalesce("alt_text", '') || ' ' ||
      coalesce("surrounding_text", '') || ' ' ||
      coalesce("preceding_text", '') || ' ' ||
      coalesce("following_text", '') || ' ' ||
      coalesce("image_type", '') || ' ' ||
      coalesce("ocr_text", '') || ' ' ||
      coalesce("exact_value_snippets"::text, '') || ' ' ||
      coalesce("structured_data"::text, '')
    )
  );
--> statement-breakpoint

INSERT INTO "system_settings" ("key", "value")
VALUES (
  'contextx-rollout',
  '{"coreRetrieval":true,"multiVectorRead":false,"graphRead":false,"memoryFusion":false,"llmRerankFallback":true,"contentRouting":true,"imageEvidenceRead":false,"imageEvidenceContext":false}'::json
)
ON CONFLICT ("key") DO UPDATE
SET "value" = (
  COALESCE("system_settings"."value"::jsonb, '{}'::jsonb) ||
  '{"imageEvidenceRead":false,"imageEvidenceContext":false}'::jsonb
)::json;
