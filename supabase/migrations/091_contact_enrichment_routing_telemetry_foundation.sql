-- Migration 091 — Contact Enrichment Routing Telemetry Foundation
-- Hito 17B.4X.7C.4B — Provider Routing Telemetry Foundation for Apollo
-- Default + Lusha Fallback
--
-- Purely additive, forward-only. Adds four labeling columns to
-- contact_enrichment_runs so a future routing/fallback engine (Apollo
-- default, Lusha automatic fallback) can be measured and audited from the
-- day it ships. This migration does NOT activate automatic fallback, does
-- NOT change the default provider, does NOT evaluate any routing policy,
-- and does NOT touch the pure observe_only evaluator in
-- src/modules/contact-enrichment-routing (Hito 17B.4X.7A) — that module
-- remains unwired.
--
-- Every attempt-creation path live today — the legacy direct insert in
-- startContactEnrichmentRun (contact-enrichment-runner.ts), the bulk runner
-- that calls it, and the request-linked create_contact_enrichment_attempt
-- RPC (migration 086) — is a human picking a provider through the wizard UI.
-- No path evaluates a primary/fallback decision and no path has ever
-- created a fallback attempt. The 'manual' / 'manual' / 'not_applicable'
-- defaults below are therefore factually true for 100% of existing rows,
-- not a guess and not a backfill of unknown history.

ALTER TABLE public.contact_enrichment_runs
  ADD COLUMN IF NOT EXISTS routing_mode text NOT NULL DEFAULT 'manual';

ALTER TABLE public.contact_enrichment_runs
  ADD COLUMN IF NOT EXISTS provider_attempt_role text NOT NULL DEFAULT 'manual';

ALTER TABLE public.contact_enrichment_runs
  ADD COLUMN IF NOT EXISTS fallback_reason text NULL DEFAULT 'not_applicable';

ALTER TABLE public.contact_enrichment_runs
  ADD COLUMN IF NOT EXISTS routing_policy_version text NULL;

ALTER TABLE public.contact_enrichment_runs
  ADD CONSTRAINT contact_enrichment_runs_routing_mode_check
  CHECK (routing_mode IN ('manual', 'observed', 'automatic'));

ALTER TABLE public.contact_enrichment_runs
  ADD CONSTRAINT contact_enrichment_runs_provider_attempt_role_check
  CHECK (provider_attempt_role IN ('primary', 'fallback', 'manual'));

ALTER TABLE public.contact_enrichment_runs
  ADD CONSTRAINT contact_enrichment_runs_fallback_reason_check
  CHECK (
    fallback_reason IS NULL
    OR fallback_reason IN (
      'provider_error',
      'zero_reviewable_candidates',
      'only_duplicates',
      'budget_guardrail',
      'not_applicable'
    )
  );

COMMENT ON COLUMN public.contact_enrichment_runs.routing_mode IS
  'How the provider for this attempt was selected: manual (human picked it — every path today), observed (a routing policy computed a recommendation without executing it), automatic (a routing policy executed a fallback). No automatic mode exists yet — Hito 17B.4X.7C.4B is telemetry foundation only.';

COMMENT ON COLUMN public.contact_enrichment_runs.provider_attempt_role IS
  'Role of this attempt within its routing decision: primary, fallback, or manual (human-picked, no policy assigned a role). manual for every attempt created today.';

COMMENT ON COLUMN public.contact_enrichment_runs.fallback_reason IS
  'Why a fallback attempt was created, meaningful only when provider_attempt_role = fallback. not_applicable for manual/primary attempts. No fallback attempt has ever been created automatically as of this migration — this column exists so a future routing engine has somewhere truthful to write to.';

COMMENT ON COLUMN public.contact_enrichment_runs.routing_policy_version IS
  'Identifier of the routing policy version evaluated for this attempt (e.g. contact_enrichment_routing_v1). NULL for manual attempts, since no policy is evaluated for them.';

-- ============================================================
-- Request-linked attempt creation RPC — explicit routing telemetry
-- ============================================================
--
-- CREATE OR REPLACE of create_contact_enrichment_attempt (migration 086).
-- Same signature, same behavior in every other respect. The only change is
-- the attempt INSERT now sets routing_mode/provider_attempt_role/
-- fallback_reason explicitly instead of relying solely on column defaults,
-- so the SQL body stays self-documenting for whoever wires the first
-- automatic fallback attempt (order 2) here.

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
    -- routing_mode/provider_attempt_role/fallback_reason are set explicitly
    -- here (matching the column defaults added above) — this RPC is the
    -- only production path that creates request-linked attempts, and no
    -- caller here ever creates attempt_order = 2 or a policy-assigned role
    -- yet, so every attempt is manual with no fallback considered.
    INSERT INTO public.contact_enrichment_runs (
      agent_run_id, account_id, company_name, company_domain, company_country_code,
      hubspot_company_id, status, triggered_by, providers_used, summary,
      estimated_cost_usd, bulk_run_id, request_id, attempt_order, intended_provider,
      routing_mode, provider_attempt_role, fallback_reason
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
      p_intended_provider,
      'manual',
      'manual',
      'not_applicable'
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
