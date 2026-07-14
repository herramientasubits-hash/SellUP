-- Migration 090: Activate Provider Industry Raw Label Observation Capture
--                 (Q3F-5AU.5) — RPC-only write activation
-- ============================================================
-- Migration 089 installed public.provider_industry_raw_label_observations
-- inert/read-only: RLS enabled, SELECT-only grants to authenticated and
-- service_role, no INSERT/UPDATE/DELETE grant to any role, no RPC.
--
-- Q3F-5AU.4 designed the write-activation boundary and closed with a
-- mandatory correction to its own draft: service_role MUST NOT receive a
-- direct table DML grant (no GRANT INSERT/UPDATE/DELETE/ALL). All writes
-- into this table must pass exclusively through a single SECURITY DEFINER
-- RPC, following the same narrow-EXECUTE-activation pattern already used
-- for the provider-industry-mapping lifecycle RPCs (082 -> 083 -> 085).
--
-- This migration activates write access by creating exactly ONE RPC:
--
--   public.capture_provider_industry_raw_label_observations(
--     p_source_vocabulary_key text,
--     p_provider_key          text,
--     p_operation_key         text,
--     p_observations          jsonb,
--     p_country_code          text DEFAULT NULL,
--     p_requested_industry    text DEFAULT NULL,
--     p_agent_run_id          uuid DEFAULT NULL,
--     p_source_context        jsonb DEFAULT '{}'::jsonb
--   ) RETURNS jsonb
--
-- and granting EXECUTE on it to service_role ONLY (after an explicit
-- baseline REVOKE from PUBLIC/anon/authenticated/service_role).
--
-- Scope of this migration: RPC DDL + EXECUTE privilege GRANT/REVOKE. This
-- migration does NOT:
--   - grant INSERT, UPDATE, DELETE, or ALL on
--     public.provider_industry_raw_label_observations to service_role or
--     any other role — the table's 089 SELECT-only grant posture is
--     untouched, and it remains the ONLY sanctioned write path into this
--     table;
--   - change the table's RLS policy, indexes, constraints, or trigger;
--   - seed, insert, update, or delete any row;
--   - touch provider_industry_mapping_snapshots,
--     provider_industry_concept_entries,
--     provider_industry_mapping_associations, or the mapping
--     draft/publish/archive/delete-draft lifecycle in any way;
--   - wire any provider (Apollo/Lusha/Tavily) to call this RPC.
--
-- Capture semantics (unchanged from 089's table comment): observations
-- captured through this RPC are runtime telemetry about raw provider
-- industry labels — NOT mappings. Calling this RPC creates no concept
-- entry, has no snapshot lifecycle effect, and has no automatic promotion
-- to a concept entry. It has zero effect on any candidate, candidate
-- status, scoring, or ranking.
--
-- Upsert identity (matches the 089 unique index
-- idx_pirlo_observation_identity exactly): (source_vocabulary_key,
-- operation_key, normalized_lookup_key, COALESCE(country_code, '')). On a
-- repeat observation, observed_count increments by 1, last_observed_at and
-- last_observed_run_id advance, and source_context is replaced by the
-- newest observation's context. first_observed_at, first_observed_run_id,
-- raw_label, provider_key, and requested_industry are NEVER overwritten by
-- a conflicting observation — they remain frozen at whatever the first
-- observation established.
-- ============================================================

CREATE OR REPLACE FUNCTION public.capture_provider_industry_raw_label_observations(
  p_source_vocabulary_key text,
  p_provider_key          text,
  p_operation_key         text,
  p_observations          jsonb,
  p_country_code          text DEFAULT NULL,
  p_requested_industry    text DEFAULT NULL,
  p_agent_run_id          uuid DEFAULT NULL,
  p_source_context        jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  v_item           jsonb;
  v_raw_label      text;
  v_normalized_key text;
  v_inserted_count integer := 0;
  v_updated_count  integer := 0;
  v_skipped_count  integer := 0;
  v_was_insert     boolean;
BEGIN
  -- ── Common-context validation (fails closed, no exception) ──────────
  -- Every branch below is reached by a plain IF check performed before any
  -- table access, so shape/context errors this RPC is documented to handle
  -- never reach an INSERT and never raise a Postgres exception.

  IF p_source_vocabulary_key IS NULL OR trim(p_source_vocabulary_key) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'inserted_count', 0,
      'updated_count', 0,
      'skipped_count', 0,
      'observed_count_delta', 0,
      'error_code', 'invalid_source_vocabulary_key'
    );
  END IF;

  IF p_provider_key IS NULL OR trim(p_provider_key) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'inserted_count', 0,
      'updated_count', 0,
      'skipped_count', 0,
      'observed_count_delta', 0,
      'error_code', 'invalid_provider_key'
    );
  END IF;

  IF p_operation_key IS NULL OR trim(p_operation_key) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'inserted_count', 0,
      'updated_count', 0,
      'skipped_count', 0,
      'observed_count_delta', 0,
      'error_code', 'invalid_operation_key'
    );
  END IF;

  IF p_observations IS NULL OR jsonb_typeof(p_observations) <> 'array' THEN
    RETURN jsonb_build_object(
      'success', false,
      'inserted_count', 0,
      'updated_count', 0,
      'skipped_count', 0,
      'observed_count_delta', 0,
      'error_code', 'invalid_observations_shape'
    );
  END IF;

  IF jsonb_array_length(p_observations) > 300 THEN
    RETURN jsonb_build_object(
      'success', false,
      'inserted_count', 0,
      'updated_count', 0,
      'skipped_count', 0,
      'observed_count_delta', 0,
      'error_code', 'too_many_observations'
    );
  END IF;

  IF p_source_context IS NULL OR jsonb_typeof(p_source_context) <> 'object' THEN
    RETURN jsonb_build_object(
      'success', false,
      'inserted_count', 0,
      'updated_count', 0,
      'skipped_count', 0,
      'observed_count_delta', 0,
      'error_code', 'invalid_source_context'
    );
  END IF;

  -- ── Per-item processing ──────────────────────────────────────────────
  -- Each array element is validated independently; an invalid item is
  -- skipped (counted in skipped_count) rather than failing the whole call.

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_observations)
  LOOP
    v_raw_label := v_item ->> 'raw_label';
    v_normalized_key := v_item ->> 'normalized_lookup_key';

    IF v_raw_label IS NULL OR trim(v_raw_label) = ''
       OR v_normalized_key IS NULL OR trim(v_normalized_key) = '' THEN
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.provider_industry_raw_label_observations (
      source_vocabulary_key,
      provider_key,
      operation_key,
      raw_label,
      normalized_lookup_key,
      country_code,
      requested_industry,
      first_observed_run_id,
      last_observed_run_id,
      source_context
    ) VALUES (
      p_source_vocabulary_key,
      p_provider_key,
      p_operation_key,
      v_raw_label,
      v_normalized_key,
      p_country_code,
      p_requested_industry,
      p_agent_run_id,
      p_agent_run_id,
      p_source_context
    )
    ON CONFLICT (
      source_vocabulary_key,
      operation_key,
      normalized_lookup_key,
      (COALESCE(country_code, ''::text))
    )
    DO UPDATE SET
      observed_count = public.provider_industry_raw_label_observations.observed_count + 1,
      last_observed_at = now(),
      last_observed_run_id = EXCLUDED.last_observed_run_id,
      source_context = EXCLUDED.source_context,
      updated_at = now()
    RETURNING (xmax = 0) INTO v_was_insert;

    IF v_was_insert THEN
      v_inserted_count := v_inserted_count + 1;
    ELSE
      v_updated_count := v_updated_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'inserted_count', v_inserted_count,
    'updated_count', v_updated_count,
    'skipped_count', v_skipped_count,
    'observed_count_delta', v_inserted_count + v_updated_count,
    'error_code', NULL
  );
END;
$$;

-- ============================================================
-- EXECUTE privilege — deterministic baseline REVOKE, then narrow GRANT
-- ============================================================
-- No table privilege statement appears anywhere in this migration: the
-- table keeps exactly the SELECT-only grants installed by 089. This RPC is
-- the only sanctioned write path.

REVOKE EXECUTE ON FUNCTION public.capture_provider_industry_raw_label_observations(text, text, text, jsonb, text, text, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.capture_provider_industry_raw_label_observations(text, text, text, jsonb, text, text, uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.capture_provider_industry_raw_label_observations(text, text, text, jsonb, text, text, uuid, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.capture_provider_industry_raw_label_observations(text, text, text, jsonb, text, text, uuid, jsonb) FROM service_role;

GRANT EXECUTE ON FUNCTION public.capture_provider_industry_raw_label_observations(text, text, text, jsonb, text, text, uuid, jsonb) TO service_role;
