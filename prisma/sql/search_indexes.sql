-- Enable extensions (safe if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Create an english_unaccent text search configuration if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'english_unaccent') THEN
    CREATE TEXT SEARCH CONFIGURATION public.english_unaccent ( COPY = pg_catalog.english );
    -- Apply unaccent before stemming
    ALTER TEXT SEARCH CONFIGURATION public.english_unaccent
      ALTER MAPPING FOR hword, hword_part, word WITH unaccent, english_stem;
  END IF;
END$$;

-- Skip everything gracefully if Study table doesn't exist
DO $$
BEGIN
  IF to_regclass('public."Study"') IS NULL THEN
    RAISE NOTICE 'Table "Study" not found, skipping search index creation.';
    RETURN;
  END IF;
END$$;

-- Full-text index (NO unaccent() calls in the expression)
CREATE INDEX IF NOT EXISTS study_fts_idx
ON "Study"
USING GIN (
  to_tsvector(
    'english_unaccent',
    coalesce("title",'') || ' ' || coalesce("summary",'')
  )
);

-- Trigram indexes (column-based, fine for fuzzy matches)
CREATE INDEX IF NOT EXISTS study_title_trgm_idx
ON "Study" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS study_slug_trgm_idx
ON "Study" USING GIN ("slug" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS study_summary_trgm_idx
ON "Study" USING GIN ("summary" gin_trgm_ops);
