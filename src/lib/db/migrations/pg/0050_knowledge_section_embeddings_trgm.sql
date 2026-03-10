CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE knowledge_section
ADD COLUMN IF NOT EXISTS embedding vector;

ALTER TABLE knowledge_section_version
ADD COLUMN IF NOT EXISTS embedding vector;
