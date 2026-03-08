CREATE TABLE IF NOT EXISTS "llm_provider_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"api_key" text,
	"base_url" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "llm_provider_config_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_model_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"api_name" text NOT NULL,
	"ui_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"supports_tools" boolean DEFAULT true NOT NULL,
	"supports_image_input" boolean DEFAULT false NOT NULL,
	"supports_image_generation" boolean DEFAULT false NOT NULL,
	"supports_file_input" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "llm_model_config_provider_id_ui_name_unique" UNIQUE("provider_id","ui_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" json,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "system_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'llm_model_config_provider_id_llm_provider_config_id_fk'
	) THEN
		ALTER TABLE "llm_model_config"
		ADD CONSTRAINT "llm_model_config_provider_id_llm_provider_config_id_fk"
		FOREIGN KEY ("provider_id")
		REFERENCES "public"."llm_provider_config"("id")
		ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_model_config_provider_id_idx" ON "llm_model_config" USING btree ("provider_id");
