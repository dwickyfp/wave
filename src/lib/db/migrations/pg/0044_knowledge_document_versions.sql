ALTER TABLE "knowledge_document"
ADD COLUMN IF NOT EXISTS "active_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "knowledge_document"
ADD COLUMN IF NOT EXISTS "latest_version_number" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_document_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "status" varchar(32) DEFAULT 'processing' NOT NULL,
  "change_type" varchar(32) NOT NULL,
  "markdown_content" text,
  "resolved_title" text NOT NULL,
  "resolved_description" text,
  "metadata" json,
  "metadata_embedding" vector,
  "embedding_provider" text NOT NULL,
  "embedding_model" text NOT NULL,
  "chunk_count" integer DEFAULT 0 NOT NULL,
  "token_count" integer DEFAULT 0 NOT NULL,
  "source_version_id" uuid,
  "created_by_user_id" uuid,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_section_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "parent_section_id" uuid,
  "prev_section_id" uuid,
  "next_section_id" uuid,
  "heading" text NOT NULL,
  "heading_path" text NOT NULL,
  "level" integer DEFAULT 1 NOT NULL,
  "part_index" integer DEFAULT 0 NOT NULL,
  "part_count" integer DEFAULT 1 NOT NULL,
  "content" text NOT NULL,
  "summary" text NOT NULL,
  "token_count" integer DEFAULT 0 NOT NULL,
  "source_path" text,
  "library_id" text,
  "library_version" text,
  "include_heading_in_chunk_content" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_chunk_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "section_version_id" uuid,
  "content" text NOT NULL,
  "context_summary" text,
  "embedding" vector,
  "chunk_index" integer NOT NULL,
  "token_count" integer DEFAULT 0 NOT NULL,
  "metadata" json,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_document_history_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "actor_user_id" uuid,
  "event_type" varchar(32) NOT NULL,
  "from_version_id" uuid,
  "to_version_id" uuid,
  "details" json,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_document_version_document_version_unique"
ON "knowledge_document_version" ("document_id","version_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_document_version_document_id_idx"
ON "knowledge_document_version" ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_document_version_group_id_idx"
ON "knowledge_document_version" ("group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_document_version_source_version_id_idx"
ON "knowledge_document_version" ("source_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_section_version_version_id_idx"
ON "knowledge_section_version" ("version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_section_version_document_id_idx"
ON "knowledge_section_version" ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunk_version_version_id_idx"
ON "knowledge_chunk_version" ("version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunk_version_document_id_idx"
ON "knowledge_chunk_version" ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunk_version_section_version_id_idx"
ON "knowledge_chunk_version" ("section_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_document_history_event_document_id_idx"
ON "knowledge_document_history_event" ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_document_history_event_group_id_idx"
ON "knowledge_document_history_event" ("group_id");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_document_active_version_id_fk'
  ) THEN
    ALTER TABLE "knowledge_document"
    ADD CONSTRAINT "knowledge_document_active_version_id_fk"
    FOREIGN KEY ("active_version_id") REFERENCES "public"."knowledge_document_version"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_document_version_document_id_fk'
  ) THEN
    ALTER TABLE "knowledge_document_version"
    ADD CONSTRAINT "knowledge_document_version_document_id_fk"
    FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_document"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_document_version_group_id_fk'
  ) THEN
    ALTER TABLE "knowledge_document_version"
    ADD CONSTRAINT "knowledge_document_version_group_id_fk"
    FOREIGN KEY ("group_id") REFERENCES "public"."knowledge_group"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_document_version_user_id_fk'
  ) THEN
    ALTER TABLE "knowledge_document_version"
    ADD CONSTRAINT "knowledge_document_version_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_document_version_source_version_id_fk'
  ) THEN
    ALTER TABLE "knowledge_document_version"
    ADD CONSTRAINT "knowledge_document_version_source_version_id_fk"
    FOREIGN KEY ("source_version_id") REFERENCES "public"."knowledge_document_version"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_document_version_created_by_user_id_fk'
  ) THEN
    ALTER TABLE "knowledge_document_version"
    ADD CONSTRAINT "knowledge_document_version_created_by_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_section_version_version_id_fk'
  ) THEN
    ALTER TABLE "knowledge_section_version"
    ADD CONSTRAINT "knowledge_section_version_version_id_fk"
    FOREIGN KEY ("version_id") REFERENCES "public"."knowledge_document_version"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_section_version_document_id_fk'
  ) THEN
    ALTER TABLE "knowledge_section_version"
    ADD CONSTRAINT "knowledge_section_version_document_id_fk"
    FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_document"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_section_version_group_id_fk'
  ) THEN
    ALTER TABLE "knowledge_section_version"
    ADD CONSTRAINT "knowledge_section_version_group_id_fk"
    FOREIGN KEY ("group_id") REFERENCES "public"."knowledge_group"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_chunk_version_version_id_fk'
  ) THEN
    ALTER TABLE "knowledge_chunk_version"
    ADD CONSTRAINT "knowledge_chunk_version_version_id_fk"
    FOREIGN KEY ("version_id") REFERENCES "public"."knowledge_document_version"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_chunk_version_document_id_fk'
  ) THEN
    ALTER TABLE "knowledge_chunk_version"
    ADD CONSTRAINT "knowledge_chunk_version_document_id_fk"
    FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_document"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_chunk_version_group_id_fk'
  ) THEN
    ALTER TABLE "knowledge_chunk_version"
    ADD CONSTRAINT "knowledge_chunk_version_group_id_fk"
    FOREIGN KEY ("group_id") REFERENCES "public"."knowledge_group"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_chunk_version_section_version_id_fk'
  ) THEN
    ALTER TABLE "knowledge_chunk_version"
    ADD CONSTRAINT "knowledge_chunk_version_section_version_id_fk"
    FOREIGN KEY ("section_version_id") REFERENCES "public"."knowledge_section_version"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_document_history_event_document_id_fk'
  ) THEN
    ALTER TABLE "knowledge_document_history_event"
    ADD CONSTRAINT "knowledge_document_history_event_document_id_fk"
    FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_document"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_document_history_event_group_id_fk'
  ) THEN
    ALTER TABLE "knowledge_document_history_event"
    ADD CONSTRAINT "knowledge_document_history_event_group_id_fk"
    FOREIGN KEY ("group_id") REFERENCES "public"."knowledge_group"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_document_history_event_user_id_fk'
  ) THEN
    ALTER TABLE "knowledge_document_history_event"
    ADD CONSTRAINT "knowledge_document_history_event_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_document_history_event_actor_user_id_fk'
  ) THEN
    ALTER TABLE "knowledge_document_history_event"
    ADD CONSTRAINT "knowledge_document_history_event_actor_user_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_document_history_event_from_version_id_fk'
  ) THEN
    ALTER TABLE "knowledge_document_history_event"
    ADD CONSTRAINT "knowledge_document_history_event_from_version_id_fk"
    FOREIGN KEY ("from_version_id") REFERENCES "public"."knowledge_document_version"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_document_history_event_to_version_id_fk'
  ) THEN
    ALTER TABLE "knowledge_document_history_event"
    ADD CONSTRAINT "knowledge_document_history_event_to_version_id_fk"
    FOREIGN KEY ("to_version_id") REFERENCES "public"."knowledge_document_version"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
