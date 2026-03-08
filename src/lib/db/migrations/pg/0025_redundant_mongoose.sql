-- Fix model_type column type from varchar(32) (added in 0024) to plain varchar
DO $$ BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'llm_model_config'
			AND column_name = 'model_type'
	) THEN
		ALTER TABLE "llm_model_config" ALTER COLUMN "model_type" TYPE varchar;
	END IF;
END $$;
