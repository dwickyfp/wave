-- Add LLM parsing model and retrieval threshold to knowledge_group
ALTER TABLE "knowledge_group"
  ADD COLUMN "parsing_model" text,
  ADD COLUMN "parsing_provider" text,
  ADD COLUMN "retrieval_threshold" real NOT NULL DEFAULT 0.0;
