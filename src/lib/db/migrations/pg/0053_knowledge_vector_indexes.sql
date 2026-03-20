DO $$
DECLARE
  dim integer;
BEGIN
  FOREACH dim IN ARRAY ARRAY[384, 512, 768, 1024, 1536]
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON knowledge_document USING ivfflat ((metadata_embedding::vector(%s)) vector_cosine_ops) WITH (lists = 100) WHERE metadata_embedding IS NOT NULL AND vector_dims(metadata_embedding) = %s',
      'knowledge_document_metadata_embedding_idx_' || dim,
      dim,
      dim
    );
  END LOOP;

  FOR dim IN
    SELECT DISTINCT vector_dims(metadata_embedding)
    FROM knowledge_document
    WHERE metadata_embedding IS NOT NULL
      AND vector_dims(metadata_embedding) IS NOT NULL
      AND vector_dims(metadata_embedding) <= 2000
      AND vector_dims(metadata_embedding) NOT IN (384, 512, 768, 1024, 1536)
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON knowledge_document USING ivfflat ((metadata_embedding::vector(%s)) vector_cosine_ops) WITH (lists = 100) WHERE metadata_embedding IS NOT NULL AND vector_dims(metadata_embedding) = %s',
      'knowledge_document_metadata_embedding_idx_' || dim,
      dim,
      dim
    );
  END LOOP;
END $$;
--> statement-breakpoint

DO $$
DECLARE
  dim integer;
BEGIN
  FOREACH dim IN ARRAY ARRAY[384, 512, 768, 1024, 1536]
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON knowledge_section USING ivfflat ((embedding::vector(%s)) vector_cosine_ops) WITH (lists = 100) WHERE embedding IS NOT NULL AND vector_dims(embedding) = %s',
      'knowledge_section_embedding_idx_' || dim,
      dim,
      dim
    );
  END LOOP;

  FOR dim IN
    SELECT DISTINCT vector_dims(embedding)
    FROM knowledge_section
    WHERE embedding IS NOT NULL
      AND vector_dims(embedding) IS NOT NULL
      AND vector_dims(embedding) <= 2000
      AND vector_dims(embedding) NOT IN (384, 512, 768, 1024, 1536)
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON knowledge_section USING ivfflat ((embedding::vector(%s)) vector_cosine_ops) WITH (lists = 100) WHERE embedding IS NOT NULL AND vector_dims(embedding) = %s',
      'knowledge_section_embedding_idx_' || dim,
      dim,
      dim
    );
  END LOOP;
END $$;
--> statement-breakpoint

DO $$
DECLARE
  dim integer;
BEGIN
  FOREACH dim IN ARRAY ARRAY[384, 512, 768, 1024, 1536]
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON knowledge_document_image USING ivfflat ((embedding::vector(%s)) vector_cosine_ops) WITH (lists = 100) WHERE embedding IS NOT NULL AND vector_dims(embedding) = %s',
      'knowledge_document_image_embedding_idx_' || dim,
      dim,
      dim
    );
  END LOOP;

  FOR dim IN
    SELECT DISTINCT vector_dims(embedding)
    FROM knowledge_document_image
    WHERE embedding IS NOT NULL
      AND vector_dims(embedding) IS NOT NULL
      AND vector_dims(embedding) <= 2000
      AND vector_dims(embedding) NOT IN (384, 512, 768, 1024, 1536)
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON knowledge_document_image USING ivfflat ((embedding::vector(%s)) vector_cosine_ops) WITH (lists = 100) WHERE embedding IS NOT NULL AND vector_dims(embedding) = %s',
      'knowledge_document_image_embedding_idx_' || dim,
      dim,
      dim
    );
  END LOOP;
END $$;
