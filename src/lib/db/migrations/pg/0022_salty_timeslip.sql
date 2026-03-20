ALTER TABLE "chat_thread" ADD COLUMN IF NOT EXISTS "snowflake_thread_id" text;--> statement-breakpoint
ALTER TABLE "chat_thread" ADD COLUMN IF NOT EXISTS "snowflake_parent_message_id" integer;