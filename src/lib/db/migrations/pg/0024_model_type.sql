DO $$ BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'llm_model_config'
	) THEN
		ALTER TABLE "llm_model_config"
		ADD COLUMN IF NOT EXISTS "model_type" varchar DEFAULT 'llm' NOT NULL;
	END IF;
END $$;
