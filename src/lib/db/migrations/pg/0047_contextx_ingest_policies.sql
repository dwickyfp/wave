ALTER TABLE "knowledge_group"
ADD COLUMN "parse_mode" varchar(16) NOT NULL DEFAULT 'auto',
ADD COLUMN "parse_repair_policy" varchar(32) NOT NULL DEFAULT 'section-safe-reorder',
ADD COLUMN "context_mode" varchar(20) NOT NULL DEFAULT 'deterministic',
ADD COLUMN "image_mode" varchar(16) NOT NULL DEFAULT 'auto',
ADD COLUMN "lazy_refinement_enabled" boolean NOT NULL DEFAULT true;

ALTER TABLE "knowledge_group"
ALTER COLUMN "chunk_size" SET DEFAULT 768,
ALTER COLUMN "chunk_overlap_percent" SET DEFAULT 10;
