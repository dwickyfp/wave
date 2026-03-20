ALTER TABLE "knowledge_group" ADD COLUMN IF NOT EXISTS "parse_mode" varchar(16) NOT NULL DEFAULT 'auto';
ALTER TABLE "knowledge_group" ADD COLUMN IF NOT EXISTS "parse_repair_policy" varchar(32) NOT NULL DEFAULT 'section-safe-reorder';
ALTER TABLE "knowledge_group" ADD COLUMN IF NOT EXISTS "context_mode" varchar(20) NOT NULL DEFAULT 'deterministic';
ALTER TABLE "knowledge_group" ADD COLUMN IF NOT EXISTS "image_mode" varchar(16) NOT NULL DEFAULT 'auto';
ALTER TABLE "knowledge_group" ADD COLUMN IF NOT EXISTS "lazy_refinement_enabled" boolean NOT NULL DEFAULT true;

ALTER TABLE "knowledge_group"
ALTER COLUMN "chunk_size" SET DEFAULT 768,
ALTER COLUMN "chunk_overlap_percent" SET DEFAULT 10;
