-- Migration 095: Candidate phone reveal audit fields
-- Agente 2A — PHONE-3D.2. Prepare contact_enrichment_candidates to record the
-- audit trail of a FUTURE, explicitly authorized Apollo phone reveal.
--
-- Purpose: additive schema expand step so that a later phase (PHONE-3D.3 server
-- action + PHONE-3D.4 UI modal) can persist, per candidate, the status of a
-- reveal attempt, the actor who triggered it, the timestamp, the provider, the
-- estimated/real credit + USD cost, an error code, the lawful processing basis
-- and a free-text note. Today `contact_enrichment_candidates` has nowhere to
-- store any of this.
--
-- This migration does NOT reveal any phone, does NOT call Apollo/Lusha, does
-- NOT create a server action, does NOT touch UI, does NOT activate the flag
-- ENABLE_APOLLO_PHONE_REVEAL, does NOT spend credits and does NOT populate any
-- existing row (no backfill). Reveal execution is out of scope for this hito.
--
-- Legal/product contract approved for the FUTURE reveal path (enforced by the
-- future server action, NOT by this migration):
--   * reveal is individual per candidate — no bulk, no automatic reveal
--   * human cost confirmation mandatory (up to 8 Apollo credits per candidate)
--   * phone_processing_basis mandatory on the reveal path
--   * authorized roles: Administrador and Manager comercial
--   * no Lusha fallback, no auto-write to HubSpot
--   * no phones in provider_usage_logs.metadata / run viewer / history
--
-- Safety guarantees (this hito):
--   * additive only — no data mutation, no cleanup, no backfill
--   * columns stay nullable (no NOT NULL, no uniqueness, no index)
--   * check constraints are marked NOT VALID (not checked against legacy rows);
--     obligatory NOT NULL enforcement is deferred to the future server action,
--     not imposed on legacy candidates here
--   * RLS is untouched
--   * policies are untouched
--   * triggers are untouched
--   * only contact_enrichment_candidates is touched (provider_usage_logs, run
--     history, contacts, accounts are untouched)
--   * follows the same safety pattern as migrations 092, 093 and 094
--   * idempotent: columns use IF NOT EXISTS; constraints are guarded via
--     pg_constraint so the migration can be re-run without error

-- ── 1. Columns (nullable, additive) ───────────────────────────────

ALTER TABLE public.contact_enrichment_candidates
  ADD COLUMN IF NOT EXISTS phone_reveal_status text;

ALTER TABLE public.contact_enrichment_candidates
  ADD COLUMN IF NOT EXISTS phone_revealed_at timestamptz;

ALTER TABLE public.contact_enrichment_candidates
  ADD COLUMN IF NOT EXISTS phone_revealed_by uuid;

ALTER TABLE public.contact_enrichment_candidates
  ADD COLUMN IF NOT EXISTS phone_reveal_provider text;

ALTER TABLE public.contact_enrichment_candidates
  ADD COLUMN IF NOT EXISTS phone_reveal_cost_credits integer;

ALTER TABLE public.contact_enrichment_candidates
  ADD COLUMN IF NOT EXISTS phone_reveal_cost_usd numeric;

ALTER TABLE public.contact_enrichment_candidates
  ADD COLUMN IF NOT EXISTS phone_reveal_error_code text;

ALTER TABLE public.contact_enrichment_candidates
  ADD COLUMN IF NOT EXISTS phone_processing_basis text;

ALTER TABLE public.contact_enrichment_candidates
  ADD COLUMN IF NOT EXISTS phone_processing_basis_note text;

-- ── 2. Actor FK (phone_revealed_by → internal_users) ──────────────
-- Clear existing pattern in the codebase: actor columns reference
-- public.internal_users(id) ON DELETE SET NULL (see 068_contact_enrichment_tables
-- triggered_by / reviewed_by, and many others). Added as a named, guarded
-- constraint so the migration stays idempotent. NULL actor values (all legacy
-- rows) never violate a FK, so no NOT VALID is needed here.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_enrichment_candidates_phone_revealed_by_fkey'
  ) THEN
    ALTER TABLE public.contact_enrichment_candidates
      ADD CONSTRAINT contact_enrichment_candidates_phone_revealed_by_fkey
      FOREIGN KEY (phone_revealed_by)
      REFERENCES public.internal_users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ── 3. Check constraints (NOT VALID, idempotent guards) ────────────
-- Vocabularies are the ones approved by legal/product for PHONE-3D.
-- NOT VALID => legacy rows are not re-checked; only new/updated rows enforce it.

DO $$
BEGIN
  -- phone_reveal_status vocabulary.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_enrichment_candidates_phone_reveal_status_check'
  ) THEN
    ALTER TABLE public.contact_enrichment_candidates
      ADD CONSTRAINT contact_enrichment_candidates_phone_reveal_status_check
      CHECK (
        phone_reveal_status IS NULL
        OR phone_reveal_status IN (
          'not_requested',
          'revealed',
          'no_phone_found',
          'error'
        )
      ) NOT VALID;
  END IF;

  -- phone_reveal_provider vocabulary (Apollo only; no Lusha fallback).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_enrichment_candidates_phone_reveal_provider_check'
  ) THEN
    ALTER TABLE public.contact_enrichment_candidates
      ADD CONSTRAINT contact_enrichment_candidates_phone_reveal_provider_check
      CHECK (
        phone_reveal_provider IS NULL
        OR phone_reveal_provider IN (
          'apollo'
        )
      ) NOT VALID;
  END IF;

  -- phone_processing_basis vocabulary (approved lawful bases).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_enrichment_candidates_phone_processing_basis_check'
  ) THEN
    ALTER TABLE public.contact_enrichment_candidates
      ADD CONSTRAINT contact_enrichment_candidates_phone_processing_basis_check
      CHECK (
        phone_processing_basis IS NULL
        OR phone_processing_basis IN (
          'legitimate_interest_b2b',
          'consent_obtained',
          'existing_business_relationship',
          'customer_requested_contact',
          'other_approved_basis'
        )
      ) NOT VALID;
  END IF;
END $$;

-- ── 4. Column comments ────────────────────────────────────────────

COMMENT ON COLUMN public.contact_enrichment_candidates.phone_reveal_status IS
  'PHONE-3D.2 — status of a phone reveal attempt (not_requested / revealed / no_phone_found / error). NULL until a future, explicitly authorized reveal (PHONE-3D.3) runs. No reveal happens in this hito.';

COMMENT ON COLUMN public.contact_enrichment_candidates.phone_revealed_at IS
  'PHONE-3D.2 — timestamp of an explicit phone reveal. NULL until PHONE-3D.3. No reveal happens in this hito.';

COMMENT ON COLUMN public.contact_enrichment_candidates.phone_revealed_by IS
  'PHONE-3D.2 — internal_users.id of the actor (Administrador / Manager comercial) who triggered the reveal. FK ON DELETE SET NULL. NULL until PHONE-3D.3.';

COMMENT ON COLUMN public.contact_enrichment_candidates.phone_reveal_provider IS
  'PHONE-3D.2 — provider used for the reveal. Vocabulary limited to apollo (no Lusha fallback). NULL until PHONE-3D.3.';

COMMENT ON COLUMN public.contact_enrichment_candidates.phone_reveal_cost_credits IS
  'PHONE-3D.2 — estimated/real Apollo credits charged for the reveal (up to 8 per candidate per legal/product contract). NULL until PHONE-3D.3.';

COMMENT ON COLUMN public.contact_enrichment_candidates.phone_reveal_cost_usd IS
  'PHONE-3D.2 — estimated/real USD cost derived from the credits charged. NULL until PHONE-3D.3.';

COMMENT ON COLUMN public.contact_enrichment_candidates.phone_reveal_error_code IS
  'PHONE-3D.2 — machine-readable error code when phone_reveal_status = error. NULL otherwise. No reveal happens in this hito.';

COMMENT ON COLUMN public.contact_enrichment_candidates.phone_processing_basis IS
  'PHONE-3D.2 — lawful processing basis recorded on the reveal path (legitimate_interest_b2b / consent_obtained / existing_business_relationship / customer_requested_contact / other_approved_basis). Mandatory in the FUTURE server action, nullable here because no server action exists yet.';

COMMENT ON COLUMN public.contact_enrichment_candidates.phone_processing_basis_note IS
  'PHONE-3D.2 — free-text justification required by the future server action when phone_processing_basis = other_approved_basis. Nullable in this migration (no server action yet).';
