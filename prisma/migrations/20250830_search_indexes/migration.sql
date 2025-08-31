-- Enable useful extensions (safe if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Full-text GIN index over title + summary (adjust columns if yours differ)
CREATE INDEX IF NOT EXISTS study_fts_idx
ON "Study"
USING GIN (to_tsvector('english', unaccent(coalesce("title",'') || ' ' || coalesce("summary",''))));

-- Trigram indexes for fuzzy matches
CREATE INDEX IF NOT EXISTS study_title_trgm_idx
ON "Study" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS study_slug_trgm_idx
ON "Study" USING GIN ("slug" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS study_summary_trgm_idx
ON "Study" USING GIN ("summary" gin_trgm_ops);
