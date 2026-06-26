-- Migration 068 — Contact Enrichment Staging Tables (Agente 2A)
-- Hito 17A.1 — Scaffold: wizard + company resolver + staging tables
-- Aditivo: no modifica tablas del Agente 1.

-- ============================================================
-- contact_enrichment_runs
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contact_enrichment_runs (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id           uuid        NULL REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  account_id             uuid        NULL REFERENCES public.accounts(id) ON DELETE SET NULL,
  company_name           text        NOT NULL,
  company_domain         text        NULL,
  company_country_code   text        NULL,
  hubspot_company_id     text        NULL,
  status                 text        NOT NULL DEFAULT 'pending'
    CONSTRAINT contact_enrichment_runs_status_check
    CHECK (status IN (
      'pending',
      'resolving',
      'ready_to_enrich',
      'enriching',
      'ready_for_review',
      'completed',
      'failed'
    )),
  triggered_by           uuid        NULL REFERENCES public.internal_users(id) ON DELETE SET NULL,
  providers_used         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  summary                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  estimated_cost_usd     numeric     NOT NULL DEFAULT 0,
  real_cost_usd          numeric     NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- contact_enrichment_candidates
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contact_enrichment_candidates (
  id                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  enrichment_run_id            uuid        NOT NULL REFERENCES public.contact_enrichment_runs(id) ON DELETE CASCADE,
  first_name                   text        NULL,
  last_name                    text        NULL,
  full_name                    text        NOT NULL,
  title                        text        NULL,
  seniority                    text        NULL,
  department                   text        NULL,
  country                      text        NULL,
  linkedin_url                 text        NULL,
  email                        text        NULL,
  phone                        text        NULL,
  source                       text        NOT NULL
    CONSTRAINT contact_enrichment_candidates_source_check
    CHECK (source IN ('apollo', 'lusha', 'hubspot', 'manual', 'mock')),
  source_contact_id            text        NULL,
  confidence                   numeric     NOT NULL DEFAULT 0,
  status                       text        NOT NULL DEFAULT 'pending_review'
    CONSTRAINT contact_enrichment_candidates_status_check
    CHECK (status IN ('pending_review', 'approved', 'discarded', 'duplicate')),
  duplicate_status             text        NOT NULL DEFAULT 'unchecked'
    CONSTRAINT contact_enrichment_candidates_duplicate_status_check
    CHECK (duplicate_status IN ('unchecked', 'no_match', 'possible_duplicate', 'exact_duplicate')),
  matched_hubspot_contact_id   text        NULL,
  matched_contacts_id          uuid        NULL REFERENCES public.contacts(id) ON DELETE SET NULL,
  enrichment_metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  review_notes                 text        NULL,
  reviewed_by                  uuid        NULL REFERENCES public.internal_users(id) ON DELETE SET NULL,
  reviewed_at                  timestamptz NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Índices
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_contact_enrichment_runs_agent_run_id
  ON public.contact_enrichment_runs(agent_run_id);

CREATE INDEX IF NOT EXISTS idx_contact_enrichment_runs_account_id
  ON public.contact_enrichment_runs(account_id);

CREATE INDEX IF NOT EXISTS idx_contact_enrichment_runs_hubspot_company_id
  ON public.contact_enrichment_runs(hubspot_company_id);

CREATE INDEX IF NOT EXISTS idx_contact_enrichment_runs_status
  ON public.contact_enrichment_runs(status);

CREATE INDEX IF NOT EXISTS idx_contact_enrichment_candidates_enrichment_run_id
  ON public.contact_enrichment_candidates(enrichment_run_id);

CREATE INDEX IF NOT EXISTS idx_contact_enrichment_candidates_status
  ON public.contact_enrichment_candidates(status);

CREATE INDEX IF NOT EXISTS idx_contact_enrichment_candidates_linkedin_url
  ON public.contact_enrichment_candidates(linkedin_url);

CREATE INDEX IF NOT EXISTS idx_contact_enrichment_candidates_email
  ON public.contact_enrichment_candidates(email);

-- ============================================================
-- Triggers updated_at — reutiliza set_updated_at() de migración 038
-- ============================================================

DROP TRIGGER IF EXISTS contact_enrichment_runs_set_updated_at ON public.contact_enrichment_runs;
CREATE TRIGGER contact_enrichment_runs_set_updated_at
  BEFORE UPDATE ON public.contact_enrichment_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS contact_enrichment_candidates_set_updated_at ON public.contact_enrichment_candidates;
CREATE TRIGGER contact_enrichment_candidates_set_updated_at
  BEFORE UPDATE ON public.contact_enrichment_candidates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- RLS — service_role gestiona; authenticated puede leer sus propios runs
-- ============================================================

ALTER TABLE public.contact_enrichment_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_enrichment_candidates ENABLE ROW LEVEL SECURITY;

-- service_role acceso completo
CREATE POLICY "service_role_contact_enrichment_runs_all"
  ON public.contact_enrichment_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "service_role_contact_enrichment_candidates_all"
  ON public.contact_enrichment_candidates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated puede leer todos los runs (misma política que prospect_batches)
CREATE POLICY "authenticated_contact_enrichment_runs_select"
  ON public.contact_enrichment_runs
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_contact_enrichment_candidates_select"
  ON public.contact_enrichment_candidates
  FOR SELECT
  TO authenticated
  USING (true);
