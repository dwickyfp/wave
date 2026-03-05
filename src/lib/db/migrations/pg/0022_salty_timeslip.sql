ALTER TABLE "chat_thread" ADD COLUMN "snowflake_thread_id" text;--> statement-breakpoint
ALTER TABLE "chat_thread" ADD COLUMN "snowflake_parent_message_id" integer;