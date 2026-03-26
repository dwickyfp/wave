ALTER TABLE "knowledge_chunk"
  ADD COLUMN IF NOT EXISTS "content_embedding" vector,
  ADD COLUMN IF NOT EXISTS "context_embedding" vector,
  ADD COLUMN IF NOT EXISTS "identity_embedding" vector,
  ADD COLUMN IF NOT EXISTS "entity_embedding" vector;
--> statement-breakpoint

ALTER TABLE "knowledge_chunk_version"
  ADD COLUMN IF NOT EXISTS "content_embedding" vector,
  ADD COLUMN IF NOT EXISTS "context_embedding" vector,
  ADD COLUMN IF NOT EXISTS "identity_embedding" vector,
  ADD COLUMN IF NOT EXISTS "entity_embedding" vector;
--> statement-breakpoint

ALTER TABLE "self_learning_memory"
  ADD COLUMN IF NOT EXISTS "embedding" vector;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "knowledge_entity" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL REFERENCES "public"."knowledge_group"("id") ON DELETE cascade,
  "document_id" uuid REFERENCES "public"."knowledge_document"("id") ON DELETE set null,
  "canonical_name" text NOT NULL,
  "normalized_name" text NOT NULL,
  "entity_type" text NOT NULL,
  "aliases" json,
  "embedding" vector,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "knowledge_entity_group_normalized_unique" UNIQUE ("group_id", "normalized_name")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "knowledge_entity_mention" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL REFERENCES "public"."knowledge_group"("id") ON DELETE cascade,
  "document_id" uuid NOT NULL REFERENCES "public"."knowledge_document"("id") ON DELETE cascade,
  "entity_id" uuid NOT NULL REFERENCES "public"."knowledge_entity"("id") ON DELETE cascade,
  "section_id" uuid REFERENCES "public"."knowledge_section"("id") ON DELETE set null,
  "chunk_id" uuid REFERENCES "public"."knowledge_chunk"("id") ON DELETE set null,
  "matched_text" text NOT NULL,
  "weight" real DEFAULT 1 NOT NULL,
  "page_start" integer,
  "page_end" integer,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "knowledge_relation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL REFERENCES "public"."knowledge_group"("id") ON DELETE cascade,
  "source_document_id" uuid NOT NULL REFERENCES "public"."knowledge_document"("id") ON DELETE cascade,
  "source_section_id" uuid NOT NULL REFERENCES "public"."knowledge_section"("id") ON DELETE cascade,
  "target_document_id" uuid NOT NULL REFERENCES "public"."knowledge_document"("id") ON DELETE cascade,
  "target_section_id" uuid NOT NULL REFERENCES "public"."knowledge_section"("id") ON DELETE cascade,
  "relation_type" varchar(32) NOT NULL,
  "weight" real DEFAULT 1 NOT NULL,
  "effective_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "knowledge_entity_group_id_idx"
  ON "knowledge_entity" ("group_id");
CREATE INDEX IF NOT EXISTS "knowledge_entity_document_id_idx"
  ON "knowledge_entity" ("document_id");
CREATE INDEX IF NOT EXISTS "knowledge_entity_mention_group_id_idx"
  ON "knowledge_entity_mention" ("group_id");
CREATE INDEX IF NOT EXISTS "knowledge_entity_mention_entity_id_idx"
  ON "knowledge_entity_mention" ("entity_id");
CREATE INDEX IF NOT EXISTS "knowledge_entity_mention_document_id_idx"
  ON "knowledge_entity_mention" ("document_id");
CREATE INDEX IF NOT EXISTS "knowledge_entity_mention_section_id_idx"
  ON "knowledge_entity_mention" ("section_id");
CREATE INDEX IF NOT EXISTS "knowledge_entity_mention_chunk_id_idx"
  ON "knowledge_entity_mention" ("chunk_id");
CREATE INDEX IF NOT EXISTS "knowledge_relation_group_id_idx"
  ON "knowledge_relation" ("group_id");
CREATE INDEX IF NOT EXISTS "knowledge_relation_source_section_id_idx"
  ON "knowledge_relation" ("source_section_id");
CREATE INDEX IF NOT EXISTS "knowledge_relation_target_section_id_idx"
  ON "knowledge_relation" ("target_section_id");
CREATE INDEX IF NOT EXISTS "knowledge_relation_type_idx"
  ON "knowledge_relation" ("relation_type");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "self_learning_memory_search_simple_idx"
  ON "self_learning_memory"
  USING gin (
    to_tsvector(
      'simple',
      coalesce("title", '') || ' ' || coalesce("content", '')
    )
  );
--> statement-breakpoint

INSERT INTO "system_settings" ("key", "value")
VALUES (
  'contextx-rollout',
  '{"coreRetrieval":true,"multiVectorRead":false,"graphRead":false,"memoryFusion":false,"llmRerankFallback":true,"contentRouting":true}'::json
)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

DO $$
DECLARE
  dim integer;
  embedding_columns text[] := ARRAY[
    'content_embedding',
    'context_embedding',
    'identity_embedding',
    'entity_embedding'
  ];
  column_name text;
BEGIN
  FOREACH column_name IN ARRAY embedding_columns
  LOOP
    FOREACH dim IN ARRAY ARRAY[384, 512, 768, 1024, 1536]
    LOOP
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON knowledge_chunk USING ivfflat ((%I::vector(%s)) vector_cosine_ops) WITH (lists = 100) WHERE %I IS NOT NULL AND vector_dims(%I) = %s',
        'knowledge_chunk_' || column_name || '_idx_' || dim,
        column_name,
        dim,
        column_name,
        column_name,
        dim
      );
    END LOOP;
  END LOOP;
END $$;
--> statement-breakpoint

DO $$
DECLARE
  dim integer;
BEGIN
  FOREACH dim IN ARRAY ARRAY[384, 512, 768, 1024, 1536]
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON self_learning_memory USING ivfflat ((embedding::vector(%s)) vector_cosine_ops) WITH (lists = 50) WHERE embedding IS NOT NULL AND vector_dims(embedding) = %s',
      'self_learning_memory_embedding_idx_' || dim,
      dim,
      dim
    );
  END LOOP;
END $$;
