-- Migration 086 — Contact Enrichment Request / Attempt Persistence Foundation
-- Hito 17B.4X.7C.1 — PARENT_REQUEST_PROVIDER_ATTEMPTS foundation
-- Aditivo: no modifica lógica ni datos existentes de contact_enrichment_runs.
--
-- Esta migración NO activa live routing, NO conecta el wizard, y NO agrega
-- orquestación de proveedores a nivel de request. Solo crea la persistencia
-- de fundación (tabla de request + linkage de attempt + creación atómica).

-- ============================================================
-- 1. contact_enrichment_requests
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contact_enrichment_requests (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                  uuid        NULL REFERENCES public.accounts(id) ON DELETE SET NULL,
  company_name                text        NOT NULL,
  company_domain               text        NULL,
  company_country_code         text        NULL,
  hubspot_company_id           text        NULL,
  company_resolution_source    text        NOT NULL
    CONSTRAINT contact_enrichment_requests_resolution_source_check
    CHECK (company_resolution_source IN ('sellup', 'hubspot', 'manual')),
  triggered_by                uuid        NULL REFERENCES public.internal_users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_enrichment_requests_account_id
  ON public.contact_enrichment_requests(account_id);

CREATE INDEX IF NOT EXISTS idx_contact_enrichment_requests_created_at
  ON public.contact_enrichment_requests(created_at DESC);

DROP TRIGGER IF EXISTS contact_enrichment_requests_set_updated_at
  ON public.contact_enrichment_requests;
CREATE TRIGGER contact_enrichment_requests_set_updated_at
  BEFORE UPDATE ON public.contact_enrichment_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS — mismo patrón que contact_enrichment_runs (migración 068) y
-- contact_enrichment_bulk_runs (migración 078): service_role gestiona,
-- authenticated solo lectura.

ALTER TABLE public.contact_enrichment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_contact_enrichment_requests_all"
  ON public.contact_enrichment_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_contact_enrichment_requests_select"
  ON public.contact_enrichment_requests
  FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- 2. contact_enrichment_runs — attempt linkage columns
-- ============================================================

ALTER TABLE public.contact_enrichment_runs
  ADD COLUMN IF NOT EXISTS request_id uuid NULL
    REFERENCES public.contact_enrichment_requests(id);

ALTER TABLE public.contact_enrichment_runs
  ADD COLUMN IF NOT EXISTS attempt_order smallint NULL;

ALTER TABLE public.contact_enrichment_runs
  ADD COLUMN IF NOT EXISTS intended_provider text NULL;

-- No ON DELETE clause on request_id → defaults to NO ACTION (RESTRICT-like):
-- a contact_enrichment_requests row cannot be deleted while an attempt
-- references it. Deliberately not SET NULL, not CASCADE.

CREATE INDEX IF NOT EXISTS idx_contact_enrichment_runs_request_id
  ON public.contact_enrichment_runs(request_id);

-- ── Tuple coherence (§7) ─────────────────────────────────────
-- Either the row is a legacy/bulk row (all three columns NULL) or it is a
-- fully-orchestrated request-linked attempt (all three columns present,
-- attempt_order in {1,2}, intended_provider in {apollo,lusha}, and never
-- also bulk-owned). No partial state is allowed.

ALTER TABLE public.contact_enrichment_runs
  ADD CONSTRAINT contact_enrichment_runs_request_attempt_tuple_check
  CHECK (
    (
      request_id IS NULL
      AND attempt_order IS NULL
      AND intended_provider IS NULL
    )
    OR
    (
      request_id IS NOT NULL
      AND attempt_order IN (1, 2)
      AND intended_provider IN ('apollo', 'lusha')
      AND bulk_run_id IS NULL
    )
  );

-- ── Unique guarantee (§8) ────────────────────────────────────
-- One request can own at most one attempt per attempt_order. Legacy and
-- bulk rows (request_id NULL) are outside this guarantee.

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_enrichment_runs_request_attempt_order
  ON public.contact_enrichment_runs (request_id, attempt_order)
  WHERE request_id IS NOT NULL;

-- ============================================================
-- 3. Atomic attempt creation RPC
-- ============================================================
--
-- create_contact_enrichment_attempt — creates one agent_runs row and one
-- request-linked contact_enrichment_runs row transactionally. Follows the
-- SECURITY DEFINER / search_path / grant conventions established by
-- try_reserve_wizard_credits (migration 064).
--
-- Responsibilities:
--   1. Validate intended_provider and attempt_order before touching data.
--   2. Lock the request row (FOR UPDATE) — this is what makes duplicate
--      concurrent creation for the same (request_id, attempt_order) safe:
--      a second concurrent call blocks on the same row lock and, once the
--      first transaction commits, observes the already-created attempt and
--      returns 'already_exists' instead of racing the unique index.
--   3. Copy request company context into the attempt (account_id,
--      company_name, company_domain, company_country_code,
--      hubspot_company_id) — never accepts company context as caller input.
--   4. Persist the caller-supplied existing-contacts snapshot into the
--      attempt's initial summary.existing_contacts_snapshot in the SAME
--      insert that creates the row — no follow-up UPDATE ever produces a
--      ready_to_enrich attempt with an incomplete snapshot.
--   5. Preserve the existing same-account ready_to_enrich supersede
--      lifecycle (17A.9E): previous ready_to_enrich runs for the account
--      are marked superseded, and superseded_by_run_id is backfilled, all
--      before the new attempt row exists (so it can never supersede
--      itself).
--   6. On a unique-violation race (defensive backstop beyond the row lock),
--      delete the orphaned agent_runs row it just created and return the
--      existing attempt as 'already_exists' — no orphan agent_run survives
--      any code path.
--
-- Returns jsonb: { status, attempt_id, agent_run_id }
--   status values: created | already_exists | invalid_request |
--                   invalid_provider | invalid_attempt_order
--
-- 7C.1 production callers only ever pass p_attempt_order = 1. The function
-- itself supports 1 or 2 so the DB layer does not need to change again when
-- 7C.2 introduces a second attempt/fallback order — but no live caller in
-- this hito creates order 2.

CREATE OR REPLACE FUNCTION public.create_contact_enrichment_attempt(
  p_request_id                 uuid,
  p_attempt_order               smallint,
  p_intended_provider           text,
  p_triggered_by                uuid,
  p_existing_contacts_snapshot  jsonb,
  p_agent_run_input_params      jsonb DEFAULT '{}'::jsonb,
  p_agent_run_metadata          jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  v_request        RECORD;
  v_existing       RECORD;
  v_agent_run_id   uuid;
  v_attempt_id     uuid;
BEGIN
  -- ── Step 1: Validate intended provider ─────────────────────────
  IF p_intended_provider NOT IN ('apollo', 'lusha') THEN
    RETURN jsonb_build_object('status', 'invalid_provider', 'attempt_id', NULL, 'agent_run_id', NULL);
  END IF;

  -- ── Step 2: Validate attempt order ──────────────────────────────
  IF p_attempt_order NOT IN (1, 2) THEN
    RETURN jsonb_build_object('status', 'invalid_attempt_order', 'attempt_id', NULL, 'agent_run_id', NULL);
  END IF;

  -- ── Step 3: Load + lock request row ─────────────────────────────
  SELECT
    id, account_id, company_name, company_domain, company_country_code,
    hubspot_company_id, company_resolution_source
  INTO v_request
  FROM public.contact_enrichment_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid_request', 'attempt_id', NULL, 'agent_run_id', NULL);
  END IF;

  -- ── Step 4: Duplicate pre-check (fast path) ─────────────────────
  -- The request row lock above already serializes concurrent calls for the
  -- same request_id, so by the time we reach this SELECT any earlier
  -- concurrent creation for this request has already committed or rolled
  -- back. This check turns that into a typed result instead of a raw
  -- unique-violation.
  SELECT id, agent_run_id
  INTO v_existing
  FROM public.contact_enrichment_runs
  WHERE request_id = p_request_id
    AND attempt_order = p_attempt_order;

  IF FOUND THEN
    RETURN jsonb_build_object('status', 'already_exists', 'attempt_id', v_existing.id, 'agent_run_id', v_existing.agent_run_id);
  END IF;

  -- ── Step 5: Create agent_run ────────────────────────────────────
  INSERT INTO public.agent_runs (
    agent_key, agent_name, triggered_by, status, input_params, metadata, started_at
  ) VALUES (
    'agent_2a_contact_enrichment',
    'Enriquecimiento de contactos por empresa',
    p_triggered_by,
    'running',
    COALESCE(p_agent_run_input_params, '{}'::jsonb),
    COALESCE(p_agent_run_metadata, '{}'::jsonb),
    now()
  )
  RETURNING id INTO v_agent_run_id;

  BEGIN
    -- ── Step 6: Supersede previous ready_to_enrich runs (17A.9E) ──
    -- Runs strictly before the new attempt row is inserted, so the new
    -- attempt can never supersede itself.
    IF v_request.account_id IS NOT NULL THEN
      UPDATE public.contact_enrichment_runs
      SET
        status  = 'superseded',
        summary = COALESCE(summary, '{}'::jsonb)
                  || jsonb_build_object(
                       'superseded_at', to_jsonb(now()),
                       'superseded_reason', 'new_ready_to_enrich_run_created',
                       'original_status', to_jsonb(status)
                     )
      WHERE account_id = v_request.account_id
        AND status = 'ready_to_enrich';
    END IF;

    -- ── Step 7: Insert the request-linked attempt row ──────────────
    -- Company context is copied from the locked request row, never from
    -- caller input. The existing-contacts snapshot is persisted in this
    -- same insert (SNAPSHOT_AT_ATTEMPT_CREATION, §13/§31).
    INSERT INTO public.contact_enrichment_runs (
      agent_run_id, account_id, company_name, company_domain, company_country_code,
      hubspot_company_id, status, triggered_by, providers_used, summary,
      estimated_cost_usd, bulk_run_id, request_id, attempt_order, intended_provider
    ) VALUES (
      v_agent_run_id,
      v_request.account_id,
      v_request.company_name,
      v_request.company_domain,
      v_request.company_country_code,
      v_request.hubspot_company_id,
      'ready_to_enrich',
      p_triggered_by,
      '[]'::jsonb,
      jsonb_build_object(
        'totalCandidates', 0,
        'company_resolution_source', v_request.company_resolution_source,
        'existing_contacts_snapshot', COALESCE(p_existing_contacts_snapshot, '{}'::jsonb)
      ),
      0,
      NULL,
      p_request_id,
      p_attempt_order,
      p_intended_provider
    )
    RETURNING id INTO v_attempt_id;

    -- ── Step 8: Backfill superseded_by_run_id (17A.9E trace) ────────
    IF v_request.account_id IS NOT NULL THEN
      UPDATE public.contact_enrichment_runs
      SET summary = summary || jsonb_build_object('superseded_by_run_id', to_jsonb(v_attempt_id))
      WHERE account_id = v_request.account_id
        AND status = 'superseded'
        AND id <> v_attempt_id
        AND NOT (summary ? 'superseded_by_run_id');
    END IF;

  EXCEPTION WHEN unique_violation THEN
    -- Defensive backstop: a duplicate slipped past the pre-check somehow.
    -- Clean up the orphaned agent_run and report the existing attempt.
    DELETE FROM public.agent_runs WHERE id = v_agent_run_id;

    SELECT id, agent_run_id
    INTO v_existing
    FROM public.contact_enrichment_runs
    WHERE request_id = p_request_id
      AND attempt_order = p_attempt_order;

    RETURN jsonb_build_object('status', 'already_exists', 'attempt_id', v_existing.id, 'agent_run_id', v_existing.agent_run_id);
  END;

  RETURN jsonb_build_object('status', 'created', 'attempt_id', v_attempt_id, 'agent_run_id', v_agent_run_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_contact_enrichment_attempt(uuid, smallint, text, uuid, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_contact_enrichment_attempt(uuid, smallint, text, uuid, jsonb, jsonb, jsonb)
  TO postgres, service_role;
