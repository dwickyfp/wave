ALTER TABLE knowledge_section
  ADD COLUMN IF NOT EXISTS page_start integer,
  ADD COLUMN IF NOT EXISTS page_end integer,
  ADD COLUMN IF NOT EXISTS note_number text,
  ADD COLUMN IF NOT EXISTS note_title text,
  ADD COLUMN IF NOT EXISTS note_subsection text,
  ADD COLUMN IF NOT EXISTS continued boolean NOT NULL DEFAULT false;

ALTER TABLE knowledge_section_version
  ADD COLUMN IF NOT EXISTS page_start integer,
  ADD COLUMN IF NOT EXISTS page_end integer,
  ADD COLUMN IF NOT EXISTS note_number text,
  ADD COLUMN IF NOT EXISTS note_title text,
  ADD COLUMN IF NOT EXISTS note_subsection text,
  ADD COLUMN IF NOT EXISTS continued boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS knowledge_section_note_number_idx
  ON knowledge_section (group_id, note_number);

CREATE INDEX IF NOT EXISTS knowledge_section_page_span_idx
  ON knowledge_section (group_id, page_start, page_end);

CREATE INDEX IF NOT EXISTS knowledge_document_retrieval_ticker_idx
  ON knowledge_document ((upper(COALESCE(metadata::jsonb->'retrievalIdentity'->>'issuerTicker', ''))));

CREATE INDEX IF NOT EXISTS knowledge_document_retrieval_name_trgm_idx
  ON knowledge_document
  USING gin ((lower(COALESCE(metadata::jsonb->'retrievalIdentity'->>'issuerName', ''))) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS knowledge_document_retrieval_title_trgm_idx
  ON knowledge_document
  USING gin ((lower(COALESCE(metadata::jsonb->'retrievalIdentity'->>'canonicalTitle', ''))) gin_trgm_ops);
