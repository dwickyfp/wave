CREATE TABLE IF NOT EXISTS "knowledge_document_image" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL REFERENCES "public"."knowledge_document"("id") ON DELETE cascade,
  "group_id" uuid NOT NULL REFERENCES "public"."knowledge_group"("id") ON DELETE cascade,
  "version_id" uuid REFERENCES "public"."knowledge_document_version"("id") ON DELETE set null,
  "kind" varchar(32) DEFAULT 'embedded' NOT NULL,
  "ordinal" integer NOT NULL,
  "marker" text NOT NULL,
  "label" text NOT NULL,
  "description" text NOT NULL,
  "heading_path" text,
  "step_hint" text,
  "storage_path" text,
  "source_url" text,
  "media_type" text,
  "page_number" integer,
  "width" integer,
  "height" integer,
  "alt_text" text,
  "caption" text,
  "surrounding_text" text,
  "is_renderable" boolean DEFAULT false NOT NULL,
  "manual_label" boolean DEFAULT false NOT NULL,
  "manual_description" boolean DEFAULT false NOT NULL,
  "embedding" vector,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_document_image_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version_id" uuid NOT NULL REFERENCES "public"."knowledge_document_version"("id") ON DELETE cascade,
  "document_id" uuid NOT NULL REFERENCES "public"."knowledge_document"("id") ON DELETE cascade,
  "group_id" uuid NOT NULL REFERENCES "public"."knowledge_group"("id") ON DELETE cascade,
  "kind" varchar(32) DEFAULT 'embedded' NOT NULL,
  "ordinal" integer NOT NULL,
  "marker" text NOT NULL,
  "label" text NOT NULL,
  "description" text NOT NULL,
  "heading_path" text,
  "step_hint" text,
  "storage_path" text,
  "source_url" text,
  "media_type" text,
  "page_number" integer,
  "width" integer,
  "height" integer,
  "alt_text" text,
  "caption" text,
  "surrounding_text" text,
  "is_renderable" boolean DEFAULT false NOT NULL,
  "manual_label" boolean DEFAULT false NOT NULL,
  "manual_description" boolean DEFAULT false NOT NULL,
  "embedding" vector,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_document_image_group_id_idx"
ON "knowledge_document_image" ("group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_document_image_document_id_idx"
ON "knowledge_document_image" ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_document_image_version_id_idx"
ON "knowledge_document_image" ("version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_document_image_document_ordinal_idx"
ON "knowledge_document_image" ("document_id", "ordinal");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_document_image_version_version_id_idx"
ON "knowledge_document_image_version" ("version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_document_image_version_document_id_idx"
ON "knowledge_document_image_version" ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_document_image_version_document_ordinal_idx"
ON "knowledge_document_image_version" ("document_id", "ordinal");
