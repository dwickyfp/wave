ALTER TABLE "llm_provider_config"
ADD COLUMN IF NOT EXISTS "settings" json DEFAULT '{}'::json NOT NULL;
