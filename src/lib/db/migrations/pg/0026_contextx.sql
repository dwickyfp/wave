-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "knowledge_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" json,
	"user_id" uuid NOT NULL,
	"visibility" varchar DEFAULT 'private' NOT NULL,
	"embedding_model" text DEFAULT 'text-embedding-3-small' NOT NULL,
	"embedding_provider" text DEFAULT 'openai' NOT NULL,
	"reranking_model" text,
	"reranking_provider" text,
	"mcp_enabled" boolean DEFAULT false NOT NULL,
	"mcp_api_key_hash" text,
	"mcp_api_key_preview" text,
	"chunk_size" integer DEFAULT 512 NOT NULL,
	"chunk_overlap_percent" integer DEFAULT 20 NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "knowledge_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"original_filename" text NOT NULL,
	"file_type" varchar NOT NULL,
	"file_size" bigint,
	"storage_path" text,
	"source_url" text,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"metadata" json,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "knowledge_chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"content" text NOT NULL,
	"context_summary" text,
	"embedding" vector(1536),
	"chunk_index" integer NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"metadata" json,
	"search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "knowledge_group_agent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "knowledge_group_agent_agent_id_group_id_unique" UNIQUE("agent_id","group_id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "knowledge_usage_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid,
	"query" text NOT NULL,
	"source" varchar DEFAULT 'chat' NOT NULL,
	"chunks_retrieved" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"metadata" json,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_group_user_id_user_id_fk') THEN
    ALTER TABLE "knowledge_group" ADD CONSTRAINT "knowledge_group_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_document_group_id_knowledge_group_id_fk') THEN
    ALTER TABLE "knowledge_document" ADD CONSTRAINT "knowledge_document_group_id_knowledge_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."knowledge_group"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_document_user_id_user_id_fk') THEN
    ALTER TABLE "knowledge_document" ADD CONSTRAINT "knowledge_document_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_chunk_document_id_knowledge_document_id_fk') THEN
    ALTER TABLE "knowledge_chunk" ADD CONSTRAINT "knowledge_chunk_document_id_knowledge_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_document"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_chunk_group_id_knowledge_group_id_fk') THEN
    ALTER TABLE "knowledge_chunk" ADD CONSTRAINT "knowledge_chunk_group_id_knowledge_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."knowledge_group"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_group_agent_agent_id_agent_id_fk') THEN
    ALTER TABLE "knowledge_group_agent" ADD CONSTRAINT "knowledge_group_agent_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_group_agent_group_id_knowledge_group_id_fk') THEN
    ALTER TABLE "knowledge_group_agent" ADD CONSTRAINT "knowledge_group_agent_group_id_knowledge_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."knowledge_group"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_usage_log_group_id_knowledge_group_id_fk') THEN
    ALTER TABLE "knowledge_usage_log" ADD CONSTRAINT "knowledge_usage_log_group_id_knowledge_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."knowledge_group"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_usage_log_user_id_user_id_fk') THEN
    ALTER TABLE "knowledge_usage_log" ADD CONSTRAINT "knowledge_usage_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "knowledge_chunk_group_id_idx" ON "knowledge_chunk" USING btree ("group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunk_document_id_idx" ON "knowledge_chunk" USING btree ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunk_search_vector_idx" ON "knowledge_chunk" USING gin ("search_vector");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunk_embedding_idx" ON "knowledge_chunk" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_document_group_id_idx" ON "knowledge_document" USING btree ("group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_usage_log_group_id_idx" ON "knowledge_usage_log" USING btree ("group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_usage_log_created_at_idx" ON "knowledge_usage_log" USING btree ("created_at");
