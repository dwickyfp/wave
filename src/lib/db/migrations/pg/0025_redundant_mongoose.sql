-- Fix model_type column type from varchar(32) (added in 0024) to plain varchar
ALTER TABLE "llm_model_config" ALTER COLUMN "model_type" TYPE varchar;