-- Migration 101: Lusha phone reveal fallback scaffold
-- Agente 2A — LUSHA-PHONE-FALLBACK-1S. Prepare contact_enrichment_candidates'
-- phone-reveal vocabulary for a FUTURE, explicitly authorized Lusha phone
-- reveal fallback that runs manually, per-candidate, only after Apollo's own
-- reveal already returned `no_phone_found`.
--
-- This migration is a LOCAL DRAFT ONLY. It has NOT been applied to any remote
-- Supabase project (local, preview or Production) as of LUSHA-PHONE-FALLBACK-1S.
--
-- Why now: `contact_enrichment_candidates_phone_reveal_provider_check`
-- (migration 095) explicitly limits phone_reveal_provider to ('apollo') —
-- "no Lusha fallback" was the correct statement at the time. The Lusha
-- fallback has since been approved internally (Legal/Compliance GO, Product
-- GO as manual fallback, Spend GO conditioned), so the vocabulary needs a
-- path to widen. This migration prepares that path without activating
-- anything: no flag reads it, no server action writes to it, no UI surfaces
-- it, and a senior Lusha support ticket (v1.-id reuse, phones-reveal
-- entitlement) is still pending — see evaluateLushaPhoneFallbackEligibility in
-- src/modules/contact-enrichment/lusha-phone-fallback-eligibility.ts, whose
-- lushaContactIdReuseConfirmed / lushaPhoneEntitlementConfirmed inputs cannot
-- be truthfully set until that ticket resolves, independent of this migration.
--
-- This migration does NOT reveal any phone, does NOT call Apollo/Lusha, does
-- NOT create a server action, does NOT touch UI, does NOT activate
-- ENABLE_LUSHA_PHONE_REVEAL_FALLBACK (which is not even configured in any
-- environment), does NOT spend credits and does NOT populate any existing row
-- (no backfill).
--
-- Legal/product contract for the FUTURE reveal path (enforced by the future
-- server action, NOT by this migration):
--   * reveal is individual per candidate — no bulk, no automatic reveal
--   * human cost confirmation mandatory; billing.creditsCharged is the real
--     cost source, never assumed
--   * authorized roles: Administrador only (narrower than Apollo's reveal)
--   * no automatic retry, no auto-write to HubSpot
--   * phone_type is always 'unknown' for Lusha-sourced reveals
--
-- Safety guarantees (this hito):
--   * additive only — no data mutation, no cleanup, no backfill
--   * the new column stays nullable (no NOT NULL, no uniqueness, no index)
--   * check constraints are marked NOT VALID (not checked against legacy rows)
--   * RLS is untouched
--   * policies are untouched
--   * triggers are untouched
--   * only contact_enrichment_candidates is touched
--   * follows the same safety pattern as migrations 095, 097 and 100
--   * idempotent: columns use IF NOT EXISTS; constraints are guarded via
--     pg_constraint so the migration can be re-run without error

-- ── 1. Widen phone_reveal_provider vocabulary to include 'lusha' ──
-- Migration 095 created contact_enrichment_candidates_phone_reveal_provider_check
-- with ('apollo') only. We drop it (if present) and re-add it with the
-- extended vocabulary, still NOT VALID so legacy rows are not re-checked —
-- same swap pattern migration 097 used to extend phone_reveal_status.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_enrichment_candidates_phone_reveal_provider_check'
  ) THEN
    ALTER TABLE public.contact_enrichment_candidates
      DROP CONSTRAINT contact_enrichment_candidates_phone_reveal_provider_check;
  END IF;

  ALTER TABLE public.contact_enrichment_candidates
    ADD CONSTRAINT contact_enrichment_candidates_phone_reveal_provider_check
    CHECK (
      phone_reveal_provider IS NULL
      OR phone_reveal_provider IN (
        'apollo',
        'lusha'
      )
    ) NOT VALID;
END $$;

-- ── 2. New column: phone_reveal_cost_source (nullable, additive) ──
-- Records how confident SellUp is about what a reveal actually cost, since a
-- Lusha fallback's real cost comes only from billing.creditsCharged and must
-- never be assumed.

ALTER TABLE public.contact_enrichment_candidates
  ADD COLUMN IF NOT EXISTS phone_reveal_cost_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_enrichment_candidates_phone_reveal_cost_source_check'
  ) THEN
    ALTER TABLE public.contact_enrichment_candidates
      ADD CONSTRAINT contact_enrichment_candidates_phone_reveal_cost_source_check
      CHECK (
        phone_reveal_cost_source IS NULL
        OR phone_reveal_cost_source IN (
          'reported',
          'assumed_cap',
          'unknown'
        )
      ) NOT VALID;
  END IF;
END $$;

-- ── 3. Column comments ─────────────────────────────────────────────

COMMENT ON COLUMN public.contact_enrichment_candidates.phone_reveal_provider IS
  'LUSHA-PHONE-FALLBACK-1S — provider used for the reveal. Vocabulary widened to apollo | lusha (was apollo-only, migration 095). Lusha phone reveal remains globally disabled (isLushaPhoneRevealEnabled(): false) and this scaffold has no live caller; NULL until a reveal runs.';

COMMENT ON COLUMN public.contact_enrichment_candidates.phone_reveal_cost_source IS
  'LUSHA-PHONE-FALLBACK-1S — confidence source for phone_reveal_cost_credits/usd: reported (from provider billing.creditsCharged), assumed_cap (a worst-case cap was used instead), or unknown. Disabled by default; no live provider calls in this scaffold. NULL until a reveal runs.';
