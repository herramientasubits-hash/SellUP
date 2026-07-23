-- Migration 094: Add phone type/source traceability columns to contacts
-- Agente 2A — PHONE-3C. Persist phone metadata to the official contact.
--
-- Purpose: additive schema expand step so that, when an enriched candidate is
-- approved into an official `contacts` row, the phone TYPE and SOURCE that
-- PHONE-3A already preserved for free in `enrichment_metadata.phone`
-- (from the Apollo search payload) are not lost. Today `contacts` only stores
-- the scalar `phone`, so the type/source/traceability get dropped on approval.
--
-- This migration does NOT reveal any phone, does NOT call Apollo/Lusha, does
-- NOT spend credits and does NOT populate any existing row (no backfill).
-- Existing rows stay NULL until a later, separate, explicitly authorized phase
-- decides on backfill.
--
-- Safety guarantees (this hito):
--   * additive only — no data mutation, no cleanup, no backfill
--   * columns stay nullable (no NOT NULL, no uniqueness, no index)
--   * check constraints are marked NOT VALID (not checked against legacy rows)
--   * RLS is untouched
--   * triggers are untouched
--   * accounts, contact_audit and contact_enrichment_candidates are untouched
--   * follows the same safety pattern as migrations 092 and 093
--   * idempotent: columns use IF NOT EXISTS; constraints are guarded so the
--     migration can be re-run without error

-- ── 1. Columns (nullable, additive) ───────────────────────────────

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS phone_type text;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS phone_source text;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS phone_raw_type text;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS phone_revealed_at timestamptz;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS phone_processing_basis text;

-- ── 2. Check constraints (NOT VALID, idempotent guards) ────────────
-- phone_type / phone_source use the same stable vocabulary as the pure module
-- src/server/agents/contact-enrichment-toolkit/phone-classification.ts.
-- NOT VALID => legacy rows are not re-checked; only new/updated rows enforce it.
-- phone_processing_basis has no defined vocabulary yet (no legal policy in this
-- hito) so it stays free-form nullable text with no CHECK.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_phone_type_check'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_phone_type_check
      CHECK (
        phone_type IS NULL
        OR phone_type IN (
          'personal_mobile',
          'mobile',
          'direct_dial',
          'work',
          'hq',
          'other',
          'unknown'
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_phone_source_check'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_phone_source_check
      CHECK (
        phone_source IS NULL
        OR phone_source IN (
          'apollo_search',
          'apollo_reveal',
          'lusha_reveal',
          'provider_payload',
          'manual',
          'unknown'
        )
      ) NOT VALID;
  END IF;
END $$;

-- ── 3. Column comments ────────────────────────────────────────────

COMMENT ON COLUMN public.contacts.phone_type IS
  'PHONE-3C — normalized phone type (personal_mobile / mobile / direct_dial / work / hq / other / unknown) copied from the candidate enrichment metadata on approval. Nullable; phone is never mandatory.';

COMMENT ON COLUMN public.contacts.phone_source IS
  'PHONE-3C — provenance of the phone data (apollo_search / apollo_reveal / lusha_reveal / provider_payload / manual / unknown). In V1 the only real emitter is apollo_search (type delivered free in Apollo search, no reveal). Nullable.';

COMMENT ON COLUMN public.contacts.phone_raw_type IS
  'PHONE-3C — original raw provider phone-type label kept for traceability. Nullable.';

COMMENT ON COLUMN public.contacts.phone_revealed_at IS
  'PHONE-3C — timestamp of an explicit phone reveal. NULL for apollo_search / search-derived phones. No reveal happens in this hito; reserved for a later authorized phase.';

COMMENT ON COLUMN public.contacts.phone_processing_basis IS
  'PHONE-3C — lawful processing basis recorded when a phone is revealed (Habeas Data / LOPDP). NULL for apollo_search and until a legal policy is defined in a later phase.';
