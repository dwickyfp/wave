ALTER TABLE "agent"
ADD COLUMN IF NOT EXISTS "mcp_model_provider" text;
--> statement-breakpoint
ALTER TABLE "agent"
ADD COLUMN IF NOT EXISTS "mcp_model_name" text;
