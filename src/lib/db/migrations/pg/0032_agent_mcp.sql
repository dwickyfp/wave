ALTER TABLE "agent"
ADD COLUMN IF NOT EXISTS "mcp_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent"
ADD COLUMN IF NOT EXISTS "mcp_api_key_hash" text;
--> statement-breakpoint
ALTER TABLE "agent"
ADD COLUMN IF NOT EXISTS "mcp_api_key_preview" text;
