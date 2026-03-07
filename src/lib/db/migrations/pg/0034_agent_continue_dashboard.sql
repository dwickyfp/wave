ALTER TABLE "agent"
ADD COLUMN IF NOT EXISTS "mcp_coding_mode" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "agent"
ADD COLUMN IF NOT EXISTS "mcp_autocomplete_model_provider" text;
--> statement-breakpoint
ALTER TABLE "agent"
ADD COLUMN IF NOT EXISTS "mcp_autocomplete_model_name" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_external_chat_session" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL REFERENCES "agent"("id") ON DELETE cascade,
  "client_fingerprint" text NOT NULL,
  "first_user_message_hash" text NOT NULL,
  "first_user_preview" text NOT NULL,
  "last_transcript_message_hash" text NOT NULL,
  "last_message_count" integer NOT NULL DEFAULT 0,
  "summary_preview" text,
  "turn_count" integer NOT NULL DEFAULT 0,
  "prompt_tokens" integer NOT NULL DEFAULT 0,
  "completion_tokens" integer NOT NULL DEFAULT 0,
  "total_tokens" integer NOT NULL DEFAULT 0,
  "last_model_provider" text,
  "last_model_name" text,
  "last_status" text NOT NULL DEFAULT 'success',
  "created_at" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_external_chat_session_agent_id_idx"
  ON "agent_external_chat_session" ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_external_chat_session_updated_at_idx"
  ON "agent_external_chat_session" ("updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_external_usage_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL REFERENCES "agent"("id") ON DELETE cascade,
  "session_id" uuid REFERENCES "agent_external_chat_session"("id") ON DELETE set null,
  "transport" text NOT NULL,
  "kind" text NOT NULL,
  "model_provider" text,
  "model_name" text,
  "prompt_tokens" integer NOT NULL DEFAULT 0,
  "completion_tokens" integer NOT NULL DEFAULT 0,
  "total_tokens" integer NOT NULL DEFAULT 0,
  "finish_reason" text,
  "status" text NOT NULL DEFAULT 'success',
  "request_preview" text,
  "response_preview" text,
  "request_message_count" integer,
  "client_fingerprint" text,
  "user_agent" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_external_usage_log_agent_id_idx"
  ON "agent_external_usage_log" ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_external_usage_log_session_id_idx"
  ON "agent_external_usage_log" ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_external_usage_log_created_at_idx"
  ON "agent_external_usage_log" ("created_at");
