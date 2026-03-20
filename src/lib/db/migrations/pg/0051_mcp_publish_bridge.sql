ALTER TABLE "mcp_server"
ADD COLUMN IF NOT EXISTS "publish_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "mcp_server"
ADD COLUMN IF NOT EXISTS "publish_auth_mode" varchar DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE "mcp_server"
ADD COLUMN IF NOT EXISTS "publish_api_key_hash" text;
--> statement-breakpoint
ALTER TABLE "mcp_server"
ADD COLUMN IF NOT EXISTS "publish_api_key_preview" text;
