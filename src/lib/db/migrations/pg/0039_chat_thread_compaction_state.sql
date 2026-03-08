CREATE TABLE IF NOT EXISTS "chat_thread_compaction_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "thread_id" uuid NOT NULL,
  "status" text NOT NULL,
  "source" text NOT NULL,
  "before_tokens" integer,
  "after_tokens" integer,
  "failure_code" text,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_thread_compaction_state_thread_id_chat_thread_id_fk'
  ) THEN
    ALTER TABLE "chat_thread_compaction_state"
      ADD CONSTRAINT "chat_thread_compaction_state_thread_id_chat_thread_id_fk"
      FOREIGN KEY ("thread_id") REFERENCES "public"."chat_thread"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_thread_compaction_state_thread_id_unique"
  ON "chat_thread_compaction_state" USING btree ("thread_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_thread_compaction_state_thread_id_idx"
  ON "chat_thread_compaction_state" USING btree ("thread_id");
