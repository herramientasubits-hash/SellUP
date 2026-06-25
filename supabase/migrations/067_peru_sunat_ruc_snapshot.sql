-- ============================================================
-- Migration 067: Peru SUNAT RUC Snapshot (Perú.5A)
-- ============================================================
-- Tabla para snapshot normalizado del Padrón Reducido SUNAT.
-- Se carga SOLO via worker/script local (fuera de Vercel).
-- SellUp consulta esta tabla server-side por RUC para
-- validación legal de candidatos Perú.
--
-- GUARDRAIL: Ningún código Vercel debe poblar esta tabla
-- directamente desde padron_reducido_ruc.zip.
-- La carga masiva queda para un worker/importer separado.
-- Ver docs/PERU_MVP_ACTIVATION_PLAN.md §2.4 y §9.
-- ============================================================

CREATE TABLE IF NOT EXISTS peru_sunat_ruc_snapshot (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  ruc                 text        NOT NULL,
  legal_name          text        NOT NULL,
  taxpayer_status     text,
  domicile_condition  text,
  ubigeo              text,
  department          text,
  province            text,
  district            text,
  address             text,
  source_key          text        NOT NULL DEFAULT 'pe_sunat_bulk',
  snapshot_period     text,
  snapshot_loaded_at  timestamptz,
  is_active           boolean     NOT NULL DEFAULT false,
  is_habido           boolean     NOT NULL DEFAULT false,
  raw_line_hash       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT peru_sunat_ruc_snapshot_pkey PRIMARY KEY (id),
  CONSTRAINT peru_sunat_ruc_snapshot_ruc_key UNIQUE (ruc)
);

-- ── Indexes ────────────────────────────────────────────────────

-- Primary access pattern: lookup by RUC
CREATE INDEX IF NOT EXISTS peru_sunat_ruc_snapshot_ruc_idx
  ON peru_sunat_ruc_snapshot (ruc);

-- Bulk analytics: active + habido companies
CREATE INDEX IF NOT EXISTS peru_sunat_ruc_snapshot_active_habido_idx
  ON peru_sunat_ruc_snapshot (is_active, is_habido)
  WHERE is_active = true AND is_habido = true;

-- Geographic filtering by department
CREATE INDEX IF NOT EXISTS peru_sunat_ruc_snapshot_department_idx
  ON peru_sunat_ruc_snapshot (department);

-- Source tracking
CREATE INDEX IF NOT EXISTS peru_sunat_ruc_snapshot_source_key_idx
  ON peru_sunat_ruc_snapshot (source_key);

-- ── Row Level Security ─────────────────────────────────────────

ALTER TABLE peru_sunat_ruc_snapshot ENABLE ROW LEVEL SECURITY;

-- Service role: read snapshot for server-side legal validation
CREATE POLICY "service_role_select_sunat_snapshot"
  ON peru_sunat_ruc_snapshot
  FOR SELECT
  TO service_role
  USING (true);

-- Service role: write for offline worker import only
CREATE POLICY "service_role_insert_sunat_snapshot"
  ON peru_sunat_ruc_snapshot
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "service_role_update_sunat_snapshot"
  ON peru_sunat_ruc_snapshot
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "service_role_delete_sunat_snapshot"
  ON peru_sunat_ruc_snapshot
  FOR DELETE
  TO service_role
  USING (true);

-- No authenticated or anon access — legal data, internal only

-- ── updated_at trigger ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_peru_sunat_ruc_snapshot_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_peru_sunat_ruc_snapshot_updated_at
  BEFORE UPDATE ON peru_sunat_ruc_snapshot
  FOR EACH ROW
  EXECUTE FUNCTION update_peru_sunat_ruc_snapshot_updated_at();

-- ── Verification ───────────────────────────────────────────────

SELECT
  table_name,
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'peru_sunat_ruc_snapshot'
ORDER BY ordinal_position;
