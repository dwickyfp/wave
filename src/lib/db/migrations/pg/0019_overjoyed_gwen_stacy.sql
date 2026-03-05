CREATE TABLE "snowflake_agent_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"account_locator" text NOT NULL,
	"account" text NOT NULL,
	"snowflake_user" text NOT NULL,
	"private_key_pem" text NOT NULL,
	"database" text NOT NULL,
	"schema" text NOT NULL,
	"cortex_agent_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "snowflake_agent_config_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "agent_type" varchar DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "snowflake_agent_config" ADD CONSTRAINT "snowflake_agent_config_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;