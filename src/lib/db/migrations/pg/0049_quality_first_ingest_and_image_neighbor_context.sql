ALTER TABLE "knowledge_group"
ALTER COLUMN "parse_mode" SET DEFAULT 'always',
ALTER COLUMN "parse_repair_policy" SET DEFAULT 'section-safe-reorder',
ALTER COLUMN "context_mode" SET DEFAULT 'always-llm',
ALTER COLUMN "image_mode" SET DEFAULT 'always';

UPDATE "knowledge_group"
SET
  "parse_mode" = 'always',
  "parse_repair_policy" = 'section-safe-reorder',
  "context_mode" = 'always-llm',
  "image_mode" = 'always',
  "updated_at" = CURRENT_TIMESTAMP
WHERE
  "parse_mode" IS DISTINCT FROM 'always'
  OR "parse_repair_policy" IS DISTINCT FROM 'section-safe-reorder'
  OR "context_mode" IS DISTINCT FROM 'always-llm'
  OR "image_mode" IS DISTINCT FROM 'always';

ALTER TABLE "knowledge_document_image"
ADD COLUMN IF NOT EXISTS "preceding_text" text,
ADD COLUMN IF NOT EXISTS "following_text" text;

ALTER TABLE "knowledge_document_image_version"
ADD COLUMN IF NOT EXISTS "preceding_text" text,
ADD COLUMN IF NOT EXISTS "following_text" text;

INSERT INTO "system_settings" ("key", "value")
VALUES ('knowledge-image-neighbor-context-enabled', 'true'::json)
ON CONFLICT ("key") DO NOTHING;
