CREATE TABLE IF NOT EXISTS "chat_thread_compaction_checkpoint" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "thread_id" uuid NOT NULL,
  "schema_version" integer DEFAULT 1 NOT NULL,
  "summary_json" json NOT NULL,
  "summary_text" text NOT NULL,
  "compacted_message_count" integer DEFAULT 0 NOT NULL,
  "source_token_count" integer DEFAULT 0 NOT NULL,
  "summary_token_count" integer DEFAULT 0 NOT NULL,
  "model_provider" text NOT NULL,
  "model_name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_thread_compaction_checkpoint_thread_id_chat_thread_id_fk'
  ) THEN
    ALTER TABLE "chat_thread_compaction_checkpoint"
      ADD CONSTRAINT "chat_thread_compaction_checkpoint_thread_id_chat_thread_id_fk"
      FOREIGN KEY ("thread_id") REFERENCES "public"."chat_thread"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_thread_compaction_checkpoint_thread_id_unique"
  ON "chat_thread_compaction_checkpoint" USING btree ("thread_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_thread_compaction_checkpoint_thread_id_idx"
  ON "chat_thread_compaction_checkpoint" USING btree ("thread_id");
