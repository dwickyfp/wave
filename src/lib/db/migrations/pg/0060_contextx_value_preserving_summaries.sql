ALTER TABLE "knowledge_section"
  ADD COLUMN IF NOT EXISTS "summary_data" json;
--> statement-breakpoint

ALTER TABLE "knowledge_section_version"
  ADD COLUMN IF NOT EXISTS "summary_data" json;
