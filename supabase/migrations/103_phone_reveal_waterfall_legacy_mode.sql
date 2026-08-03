-- Migration 103: run modality for phone reveal waterfall runs
-- (Agente 2A · AGENT2A-PHONE-WATERFALL-2)
--
-- Adds `phone_reveal_waterfall_runs.run_mode` so an audit can tell the TWO
-- modalities apart DIRECTLY, without inferring anything:
--
--   * 'full_waterfall'     — the normal run created by AGENT2A-PHONE-WATERFALL-1.
--                            Apollo runs inside the run, and Lusha only if Apollo
--                            terminated as `no_phone_found`. Ceiling 13 (8 + 5).
--   * 'legacy_lusha_only'  — a run for a candidate whose Apollo attempt already
--                            happened and already terminated `no_phone_found`
--                            BEFORE this table existed. Apollo is NOT executed
--                            again (0 calls, 0 credits, 0 new usage logs) and the
--                            operator authorizes ONLY the Lusha leg. Ceiling 5.
--
-- Why a column and not an inference: without it the only available signal would be
-- `apollo_attempted_at IS NULL`, which is a side effect, not a statement. A future
-- code path that forgets to stamp that timestamp would silently look like a legacy
-- run, and an auditor reading the table could not tell "Apollo was deliberately not
-- executed because it already ran historically" apart from "the Apollo leg was
-- never recorded". The modality is a FACT about the authorization the operator
-- granted, so it gets its own NOT NULL column with a closed vocabulary.
--
-- Migration 102 is NOT rewritten. It is already merged in `main`, and silently
-- editing an applied-or-mergeable migration would make the same version number
-- mean two different schemas depending on when it ran. 103 is strictly additive on
-- top of it and must be applied AFTER it.
--
-- This migration is a LOCAL DRAFT ONLY. It has NOT been applied to any remote
-- Supabase project (local, preview or Production) as of
-- AGENT2A-PHONE-WATERFALL-2. Migration 102 is likewise still unapplied remotely
-- (Production's latest is 101_lusha_phone_reveal_scaffold), so the correct remote
-- order is 102 then 103.
--
-- This migration does NOT:
--   * insert, update or delete any row (no backfill, no data migration) — the
--     table is empty in every environment, so the NOT NULL default rewrites nothing
--   * touch `contact_enrichment_candidates`, `phone_reveal_cache`,
--     `phone_reveal_suppression_audit`, `provider_usage_logs` or any other table
--   * change RLS, policies or triggers (102's service_role-only policy is left
--     exactly as it is, and no policy is added for `authenticated` or `anon`)
--   * add a trigger or a SQL function
--   * drop a table, a column, a constraint or an index
--   * create or activate a feature flag (ENABLE_PHONE_REVEAL_WATERFALL remains
--     unset in every environment)
--   * reveal a phone, call Apollo/Lusha/HubSpot or spend credits
--   * contain any phone, email, name, linkedin or provider contact id
--
-- Safety: the CHECK is created VALIDATED (no `NOT VALID`), for the same reason
-- migration 102 validates all of its CHECKs — the table is brand new and empty, so
-- validating costs nothing and leaves no pending maintenance. Idempotent: the
-- column uses IF NOT EXISTS and the constraint is guarded via pg_constraint.

-- ── 1. run_mode column ─────────────────────────────────────────────
-- NOT NULL with DEFAULT 'full_waterfall': every run created by the pre-existing
-- START path (which does not name a modality) is a full waterfall, so the default
-- is the compatible value and no caller has to change to keep working. A legacy
-- run must state its modality explicitly.

ALTER TABLE public.phone_reveal_waterfall_runs
  ADD COLUMN IF NOT EXISTS run_mode text NOT NULL DEFAULT 'full_waterfall';

-- ── 2. Closed vocabulary (VALIDATED on creation) ───────────────────
-- Mirror of PHONE_REVEAL_WATERFALL_RUN_MODES in
-- src/modules/contact-enrichment/phone-reveal-waterfall-core.ts. A static test
-- compares the two lists in BOTH directions so a modality cannot be added on one
-- side only.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_waterfall_runs_run_mode_check'
  ) THEN
    ALTER TABLE public.phone_reveal_waterfall_runs
      ADD CONSTRAINT phone_reveal_waterfall_runs_run_mode_check
      CHECK (
        run_mode IN (
          -- Apollo then (conditionally) Lusha, both inside this authorization.
          'full_waterfall',
          -- Apollo already ran and already returned `no_phone_found` BEFORE this
          -- table existed. This authorization covers the Lusha leg ONLY: Apollo is
          -- never called again and its historical cost is never re-attributed here.
          'legacy_lusha_only'
        )
      );
  END IF;
END $$;

-- ── 3. Comments ────────────────────────────────────────────────────

COMMENT ON COLUMN public.phone_reveal_waterfall_runs.run_mode IS
  'AGENT2A-PHONE-WATERFALL-2 — modality of the authorization: full_waterfall (Apollo then conditionally Lusha, ceiling 13) or legacy_lusha_only (Apollo already ran historically and returned no_phone_found before this table existed; ONLY the Lusha leg is authorized, ceiling 5, Apollo is never called again). Directly queryable so an audit never has to infer the modality from apollo_attempted_at IS NULL. Default full_waterfall keeps every pre-existing START path correct without changes.';

COMMENT ON COLUMN public.phone_reveal_waterfall_runs.apollo_attempted_at IS
  'When Apollo was attempted INSIDE this run. NULL in a legacy_lusha_only run: Apollo was not executed under this authorization (it ran historically, and that evidence lives on the candidate row), and a timestamp is never fabricated to make the leg look executed. Read together with run_mode, never alone.';

COMMENT ON COLUMN public.phone_reveal_waterfall_runs.apollo_outcome IS
  'Outcome of the Apollo leg. In a full_waterfall run it is what Apollo returned inside the run. In a legacy_lusha_only run it transcribes the candidate''s pre-existing terminal outcome (always no_phone_found — that is the entry condition), with apollo_cost_credits NULL and apollo_cost_source unknown, because the historical cost belongs to the authorization that actually paid it and is never re-attributed to this one.';
