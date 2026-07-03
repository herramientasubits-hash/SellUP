-- Migration 078 — Contact Enrichment Bulk Runs (Agente 2A)
-- Hito 17A.10B — Backend base: tabla bulk + FK en runs + eligibility foundation
-- Aditivo: no modifica lógica existente de contact_enrichment_runs.

-- ============================================================
-- contact_enrichment_bulk_runs
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contact_enrichment_bulk_runs (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  triggered_by              uuid        NOT NULL REFERENCES public.internal_users(id),

  status                    text        NOT NULL DEFAULT 'created'
    CONSTRAINT contact_enrichment_bulk_runs_status_check
    CHECK (status IN (
      'created',
      'running',
      'completed',
      'completed_with_errors',
      'failed'
    )),

  selected_account_ids      uuid[]      NOT NULL,
  eligible_account_ids      uuid[]      NOT NULL DEFAULT '{}',

  skipped_accounts          jsonb       NOT NULL DEFAULT '[]'::jsonb,

  total_selected            int         NOT NULL DEFAULT 0,
  total_eligible            int         NOT NULL DEFAULT 0,
  total_processed           int         NOT NULL DEFAULT 0,
  total_succeeded           int         NOT NULL DEFAULT 0,
  total_failed              int         NOT NULL DEFAULT 0,
  total_skipped             int         NOT NULL DEFAULT 0,
  total_candidates_created  int         NOT NULL DEFAULT 0,

  estimated_apollo_credits  int         NOT NULL DEFAULT 0,

  started_at                timestamptz NULL,
  completed_at              timestamptz NULL,

  summary                   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  metadata                  jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Índices
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_contact_enrichment_bulk_runs_triggered_by
  ON public.contact_enrichment_bulk_runs(triggered_by);

CREATE INDEX IF NOT EXISTS idx_contact_enrichment_bulk_runs_status
  ON public.contact_enrichment_bulk_runs(status);

CREATE INDEX IF NOT EXISTS idx_contact_enrichment_bulk_runs_created_at
  ON public.contact_enrichment_bulk_runs(created_at DESC);

-- ============================================================
-- Trigger updated_at — reutiliza set_updated_at() de migración 038
-- ============================================================

DROP TRIGGER IF EXISTS contact_enrichment_bulk_runs_set_updated_at
  ON public.contact_enrichment_bulk_runs;
CREATE TRIGGER contact_enrichment_bulk_runs_set_updated_at
  BEFORE UPDATE ON public.contact_enrichment_bulk_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- RLS — service_role gestiona; authenticated puede leer
-- (mismo patrón que contact_enrichment_runs en migración 068)
-- ============================================================

ALTER TABLE public.contact_enrichment_bulk_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_contact_enrichment_bulk_runs_all"
  ON public.contact_enrichment_bulk_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_contact_enrichment_bulk_runs_select"
  ON public.contact_enrichment_bulk_runs
  FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- FK nullable bulk_run_id en contact_enrichment_runs
-- ============================================================

ALTER TABLE public.contact_enrichment_runs
  ADD COLUMN IF NOT EXISTS bulk_run_id uuid NULL
  REFERENCES public.contact_enrichment_bulk_runs(id);

CREATE INDEX IF NOT EXISTS idx_contact_enrichment_runs_bulk_run_id
  ON public.contact_enrichment_runs(bulk_run_id);
