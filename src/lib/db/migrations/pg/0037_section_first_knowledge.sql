CREATE TABLE IF NOT EXISTS "knowledge_section" (
  "id" uuid PRIMARY KEY NOT NULL,
  "document_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "parent_section_id" uuid,
  "prev_section_id" uuid,
  "next_section_id" uuid,
  "heading" text NOT NULL,
  "heading_path" text NOT NULL,
  "level" integer NOT NULL DEFAULT 1,
  "part_index" integer NOT NULL DEFAULT 0,
  "part_count" integer NOT NULL DEFAULT 1,
  "content" text NOT NULL,
  "summary" text NOT NULL,
  "token_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_section_document_id_knowledge_document_id_fk') THEN
    ALTER TABLE "knowledge_section"
      ADD CONSTRAINT "knowledge_section_document_id_knowledge_document_id_fk"
      FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_document"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_section_group_id_knowledge_group_id_fk') THEN
    ALTER TABLE "knowledge_section"
      ADD CONSTRAINT "knowledge_section_group_id_knowledge_group_id_fk"
      FOREIGN KEY ("group_id") REFERENCES "public"."knowledge_group"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "knowledge_chunk"
  ADD COLUMN IF NOT EXISTS "section_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_chunk_section_id_knowledge_section_id_fk') THEN
    ALTER TABLE "knowledge_chunk"
      ADD CONSTRAINT "knowledge_chunk_section_id_knowledge_section_id_fk"
      FOREIGN KEY ("section_id") REFERENCES "public"."knowledge_section"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_section_group_id_idx"
  ON "knowledge_section" USING btree ("group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_section_document_id_idx"
  ON "knowledge_section" USING btree ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_section_parent_section_id_idx"
  ON "knowledge_section" USING btree ("parent_section_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunk_section_id_idx"
  ON "knowledge_chunk" USING btree ("section_id");
