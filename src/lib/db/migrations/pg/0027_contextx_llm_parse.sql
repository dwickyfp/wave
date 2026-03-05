-- Add LLM parsing model and retrieval threshold to knowledge_group
ALTER TABLE "knowledge_group"
  ADD COLUMN IF NOT EXISTS "parsing_model" text,
  ADD COLUMN IF NOT EXISTS "parsing_provider" text,
  ADD COLUMN IF NOT EXISTS "retrieval_threshold" real NOT NULL DEFAULT 0.0;
