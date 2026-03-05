CREATE TABLE IF NOT EXISTS "knowledge_group_source" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "source_group_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "knowledge_group_source_group_source_unique" UNIQUE ("group_id", "source_group_id"),
  CONSTRAINT "knowledge_group_source_no_self" CHECK ("group_id" <> "source_group_id")
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_group_source_group_id_knowledge_group_id_fk'
  ) THEN
    ALTER TABLE "knowledge_group_source"
      ADD CONSTRAINT "knowledge_group_source_group_id_knowledge_group_id_fk"
      FOREIGN KEY ("group_id")
      REFERENCES "public"."knowledge_group"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_group_source_source_group_id_knowledge_group_id_fk'
  ) THEN
    ALTER TABLE "knowledge_group_source"
      ADD CONSTRAINT "knowledge_group_source_source_group_id_knowledge_group_id_fk"
      FOREIGN KEY ("source_group_id")
      REFERENCES "public"."knowledge_group"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "knowledge_group_source_group_id_idx"
  ON "knowledge_group_source" USING btree ("group_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "knowledge_group_source_source_group_id_idx"
  ON "knowledge_group_source" USING btree ("source_group_id");
