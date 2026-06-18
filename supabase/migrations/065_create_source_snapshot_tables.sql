-- Migration 065: Generic source snapshot tables
-- Purpose: store company records from validated source snapshots for post-discovery enrichment.
-- These tables are used by enrichment adapters (co_siis, and future sources).
-- The wizard NEVER depends on these tables existing with data — adapters return 'skipped' gracefully.

CREATE TABLE IF NOT EXISTS source_snapshot_runs (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  source_key      text        NOT NULL,
  country_code    text        NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  started_at      timestamptz,
  completed_at    timestamptz,
  source_year     int,
  records_found   int         DEFAULT 0,
  records_upserted int        DEFAULT 0,
  error_message   text,
  metadata        jsonb       DEFAULT '{}'::jsonb,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_company_snapshots (
  id                   uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  source_key           text        NOT NULL,
  country_code         text        NOT NULL,
  source_year          int         NOT NULL,
  tax_id               text,
  legal_name           text,
  normalized_tax_id    text,
  normalized_legal_name text,
  sector               text,
  city                 text,
  department           text,
  region               text,
  priority_score       numeric     DEFAULT 0,
  signals              jsonb       DEFAULT '{}'::jsonb,
  financials           jsonb       DEFAULT '{}'::jsonb,
  raw_data             jsonb       DEFAULT '{}'::jsonb,
  imported_at          timestamptz DEFAULT now(),
  UNIQUE (source_key, country_code, source_year, normalized_tax_id)
);

-- Indexes for enrichment adapter lookups
CREATE INDEX IF NOT EXISTS idx_source_company_snapshots_source_key
  ON source_company_snapshots (source_key);

CREATE INDEX IF NOT EXISTS idx_source_company_snapshots_normalized_tax_id
  ON source_company_snapshots (source_key, normalized_tax_id);

CREATE INDEX IF NOT EXISTS idx_source_company_snapshots_normalized_name
  ON source_company_snapshots (source_key, normalized_legal_name);

CREATE INDEX IF NOT EXISTS idx_source_snapshot_runs_source_key
  ON source_snapshot_runs (source_key, country_code);

-- RLS: These tables are internal server-side only. No public access.
ALTER TABLE source_snapshot_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_company_snapshots ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (for ETL and enrichment adapters)
CREATE POLICY "Service role full access snapshot runs"
  ON source_snapshot_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access company snapshots"
  ON source_company_snapshots FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
