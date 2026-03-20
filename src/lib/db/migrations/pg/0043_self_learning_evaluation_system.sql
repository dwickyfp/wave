ALTER TABLE "knowledge_group"
ADD COLUMN IF NOT EXISTS "purpose" varchar(32) DEFAULT 'default' NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_group"
ADD COLUMN IF NOT EXISTS "is_system_managed" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "self_learning_user_config" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "personalization_enabled" boolean DEFAULT true NOT NULL,
  "hidden_knowledge_group_id" uuid,
  "hidden_knowledge_document_id" uuid,
  "last_manual_run_at" timestamp with time zone,
  "last_evaluated_at" timestamp with time zone,
  "last_reset_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "self_learning_signal_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "thread_id" uuid,
  "message_id" text,
  "signal_type" varchar(64) NOT NULL,
  "value" real DEFAULT 0 NOT NULL,
  "payload" json,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "self_learning_run" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "trigger" varchar(32) NOT NULL,
  "status" varchar(32) DEFAULT 'queued' NOT NULL,
  "queued_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "total_candidates" integer DEFAULT 0 NOT NULL,
  "processed_candidates" integer DEFAULT 0 NOT NULL,
  "applied_memory_count" integer DEFAULT 0 NOT NULL,
  "skipped_memory_count" integer DEFAULT 0 NOT NULL,
  "error_message" text,
  "metadata" json,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "self_learning_memory" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "category" varchar(32) NOT NULL,
  "status" varchar(32) DEFAULT 'inactive' NOT NULL,
  "is_auto_safe" boolean DEFAULT false NOT NULL,
  "fingerprint" text NOT NULL,
  "contradiction_fingerprint" text,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "support_count" integer DEFAULT 0 NOT NULL,
  "distinct_thread_count" integer DEFAULT 0 NOT NULL,
  "source_evaluation_id" uuid,
  "superseded_by_memory_id" uuid,
  "last_applied_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "self_learning_evaluation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "thread_id" uuid,
  "message_id" text,
  "signal_event_id" uuid,
  "status" varchar(32) DEFAULT 'proposed' NOT NULL,
  "explicit_score" real DEFAULT 0 NOT NULL,
  "implicit_score" real DEFAULT 0 NOT NULL,
  "llm_score" real DEFAULT 0 NOT NULL,
  "composite_score" real DEFAULT 0 NOT NULL,
  "confidence" real DEFAULT 0 NOT NULL,
  "category" varchar(32),
  "candidate_fingerprint" text,
  "candidate_title" text,
  "candidate_content" text,
  "judge_output" json,
  "metrics" json,
  "applied_memory_id" uuid,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "self_learning_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "actor_user_id" uuid,
  "run_id" uuid,
  "evaluation_id" uuid,
  "memory_id" uuid,
  "action" varchar(64) NOT NULL,
  "details" json,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'self_learning_user_config_user_id_unique'
  ) THEN
    ALTER TABLE "self_learning_user_config"
    ADD CONSTRAINT "self_learning_user_config_user_id_unique"
    UNIQUE ("user_id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'self_learning_memory_user_id_fingerprint_unique'
  ) THEN
    ALTER TABLE "self_learning_memory"
    ADD CONSTRAINT "self_learning_memory_user_id_fingerprint_unique"
    UNIQUE ("user_id","fingerprint");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'self_learning_user_config_user_id_fk'
  ) THEN
    ALTER TABLE "self_learning_user_config"
    ADD CONSTRAINT "self_learning_user_config_user_id_fk"
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
    WHERE conname = 'self_learning_user_config_hidden_knowledge_group_id_fk'
  ) THEN
    ALTER TABLE "self_learning_user_config"
    ADD CONSTRAINT "self_learning_user_config_hidden_knowledge_group_id_fk"
    FOREIGN KEY ("hidden_knowledge_group_id") REFERENCES "public"."knowledge_group"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'self_learning_user_config_hidden_knowledge_document_id_fk'
  ) THEN
    ALTER TABLE "self_learning_user_config"
    ADD CONSTRAINT "self_learning_user_config_hidden_knowledge_document_id_fk"
    FOREIGN KEY ("hidden_knowledge_document_id") REFERENCES "public"."knowledge_document"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'self_learning_signal_event_user_id_fk'
  ) THEN
    ALTER TABLE "self_learning_signal_event"
    ADD CONSTRAINT "self_learning_signal_event_user_id_fk"
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
    WHERE conname = 'self_learning_signal_event_thread_id_fk'
  ) THEN
    ALTER TABLE "self_learning_signal_event"
    ADD CONSTRAINT "self_learning_signal_event_thread_id_fk"
    FOREIGN KEY ("thread_id") REFERENCES "public"."chat_thread"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'self_learning_signal_event_message_id_fk'
  ) THEN
    ALTER TABLE "self_learning_signal_event"
    ADD CONSTRAINT "self_learning_signal_event_message_id_fk"
    FOREIGN KEY ("message_id") REFERENCES "public"."chat_message"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'self_learning_run_user_id_fk'
  ) THEN
    ALTER TABLE "self_learning_run"
    ADD CONSTRAINT "self_learning_run_user_id_fk"
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
    WHERE conname = 'self_learning_memory_user_id_fk'
  ) THEN
    ALTER TABLE "self_learning_memory"
    ADD CONSTRAINT "self_learning_memory_user_id_fk"
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
    WHERE conname = 'self_learning_evaluation_run_id_fk'
  ) THEN
    ALTER TABLE "self_learning_evaluation"
    ADD CONSTRAINT "self_learning_evaluation_run_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."self_learning_run"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'self_learning_evaluation_user_id_fk'
  ) THEN
    ALTER TABLE "self_learning_evaluation"
    ADD CONSTRAINT "self_learning_evaluation_user_id_fk"
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
    WHERE conname = 'self_learning_evaluation_thread_id_fk'
  ) THEN
    ALTER TABLE "self_learning_evaluation"
    ADD CONSTRAINT "self_learning_evaluation_thread_id_fk"
    FOREIGN KEY ("thread_id") REFERENCES "public"."chat_thread"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'self_learning_evaluation_message_id_fk'
  ) THEN
    ALTER TABLE "self_learning_evaluation"
    ADD CONSTRAINT "self_learning_evaluation_message_id_fk"
    FOREIGN KEY ("message_id") REFERENCES "public"."chat_message"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'self_learning_evaluation_signal_event_id_fk'
  ) THEN
    ALTER TABLE "self_learning_evaluation"
    ADD CONSTRAINT "self_learning_evaluation_signal_event_id_fk"
    FOREIGN KEY ("signal_event_id") REFERENCES "public"."self_learning_signal_event"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'self_learning_evaluation_applied_memory_id_fk'
  ) THEN
    ALTER TABLE "self_learning_evaluation"
    ADD CONSTRAINT "self_learning_evaluation_applied_memory_id_fk"
    FOREIGN KEY ("applied_memory_id") REFERENCES "public"."self_learning_memory"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'self_learning_audit_log_user_id_fk'
  ) THEN
    ALTER TABLE "self_learning_audit_log"
    ADD CONSTRAINT "self_learning_audit_log_user_id_fk"
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
    WHERE conname = 'self_learning_audit_log_actor_user_id_fk'
  ) THEN
    ALTER TABLE "self_learning_audit_log"
    ADD CONSTRAINT "self_learning_audit_log_actor_user_id_fk"
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
    WHERE conname = 'self_learning_audit_log_run_id_fk'
  ) THEN
    ALTER TABLE "self_learning_audit_log"
    ADD CONSTRAINT "self_learning_audit_log_run_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."self_learning_run"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'self_learning_audit_log_evaluation_id_fk'
  ) THEN
    ALTER TABLE "self_learning_audit_log"
    ADD CONSTRAINT "self_learning_audit_log_evaluation_id_fk"
    FOREIGN KEY ("evaluation_id") REFERENCES "public"."self_learning_evaluation"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'self_learning_audit_log_memory_id_fk'
  ) THEN
    ALTER TABLE "self_learning_audit_log"
    ADD CONSTRAINT "self_learning_audit_log_memory_id_fk"
    FOREIGN KEY ("memory_id") REFERENCES "public"."self_learning_memory"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_group_purpose_idx"
ON "knowledge_group" USING btree ("purpose");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_group_user_id_purpose_idx"
ON "knowledge_group" USING btree ("user_id","purpose");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_learning_user_config_user_id_idx"
ON "self_learning_user_config" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_learning_signal_event_user_id_idx"
ON "self_learning_signal_event" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_learning_signal_event_message_id_idx"
ON "self_learning_signal_event" USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_learning_signal_event_created_at_idx"
ON "self_learning_signal_event" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_learning_run_user_id_idx"
ON "self_learning_run" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_learning_run_status_idx"
ON "self_learning_run" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_learning_run_created_at_idx"
ON "self_learning_run" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_learning_memory_user_id_idx"
ON "self_learning_memory" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_learning_memory_status_idx"
ON "self_learning_memory" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_learning_evaluation_run_id_idx"
ON "self_learning_evaluation" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_learning_evaluation_user_id_idx"
ON "self_learning_evaluation" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_learning_evaluation_status_idx"
ON "self_learning_evaluation" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_learning_evaluation_message_id_idx"
ON "self_learning_evaluation" USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_learning_audit_log_user_id_idx"
ON "self_learning_audit_log" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_learning_audit_log_created_at_idx"
ON "self_learning_audit_log" USING btree ("created_at");
