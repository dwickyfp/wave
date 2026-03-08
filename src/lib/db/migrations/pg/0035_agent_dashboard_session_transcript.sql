ALTER TABLE "agent_external_usage_log"
ADD COLUMN IF NOT EXISTS "request_messages" json;
--> statement-breakpoint
ALTER TABLE "agent_external_usage_log"
ADD COLUMN IF NOT EXISTS "response_message" json;
