CREATE TABLE IF NOT EXISTS "a2a_agent_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"input_url" text NOT NULL,
	"agent_card_url" text NOT NULL,
	"rpc_url" text NOT NULL,
	"auth_mode" varchar DEFAULT 'none' NOT NULL,
	"auth_header_name" text,
	"auth_secret" text,
	"agent_card" json NOT NULL,
	"last_discovered_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "a2a_agent_config_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "a2a_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "a2a_api_key_hash" text;
--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "a2a_api_key_preview" text;
--> statement-breakpoint
ALTER TABLE "chat_thread" ADD COLUMN IF NOT EXISTS "a2a_agent_id" uuid;
--> statement-breakpoint
ALTER TABLE "chat_thread" ADD COLUMN IF NOT EXISTS "a2a_context_id" text;
--> statement-breakpoint
ALTER TABLE "chat_thread" ADD COLUMN IF NOT EXISTS "a2a_task_id" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'a2a_agent_config_agent_id_agent_id_fk') THEN
    ALTER TABLE "a2a_agent_config" ADD CONSTRAINT "a2a_agent_config_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_thread_a2a_agent_id_agent_id_fk') THEN
    ALTER TABLE "chat_thread" ADD CONSTRAINT "chat_thread_a2a_agent_id_agent_id_fk" FOREIGN KEY ("a2a_agent_id") REFERENCES "public"."agent"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
