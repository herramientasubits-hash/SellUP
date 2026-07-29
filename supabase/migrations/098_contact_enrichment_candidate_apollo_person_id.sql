-- Migration 098: Persist Apollo person id on contact_enrichment_candidates
-- Agente 2A — APOLLO-PHONE-CACHE-1a. Add a queryable, nullable column that stores
-- the Apollo *person id* (MongoDB ObjectId, 24 hex chars) resolved during a phone
-- reveal (START response, webhook callback, or recovery poll).
--
-- Why: this is a TECHNICAL PREREQUISITE only — a future, separate milestone may
-- build an Apollo phone cache keyed by person id. Making the id queryable now
-- lets that future work reuse an already-known person id instead of re-resolving
-- it. This migration is the persistence prerequisite and NOTHING more.
--
-- This migration does NOT:
--   * build a phone_reveal_cache table (no cache here)
--   * serve any phone from cache (no fast path)
--   * reveal any phone, call Apollo/Lusha, or spend credits
--   * activate ENABLE_APOLLO_PHONE_REVEAL or any flag
--   * touch UI, add a button, write HubSpot
--   * backfill or mutate any existing row
--   * change RLS, policies or triggers
--
-- Safety guarantees (same additive pattern as migrations 092–097):
--   * additive only — one nullable column, no data mutation, no backfill
--   * the column stays nullable (legacy rows keep NULL, harmless)
--   * a PARTIAL index covers only non-null values (legacy rows unconstrained)
--   * RLS / policies / triggers are untouched
--   * only contact_enrichment_candidates is touched
--   * idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
--
-- The Apollo person id is an opaque correlation identifier, NOT PII: it is not a
-- phone, email, linkedin, name or raw payload. The application layer validates
-- that only a real Apollo id (24 hex chars, never a Lusha `v1.<token>` id) is
-- written; this migration only provides the column and an index for lookups.

-- ── 1. Apollo person id column (nullable, additive) ────────────────

ALTER TABLE public.contact_enrichment_candidates
  ADD COLUMN IF NOT EXISTS apollo_person_id text;

-- ── 2. Partial index for future person-id lookups (non-null only) ──
-- A future cache / reuse path will look candidates up by person id. A partial
-- index keeps the (overwhelmingly NULL) legacy rows out of the index. It is NOT
-- unique: the same Apollo person could legitimately appear across multiple
-- candidates/runs; the prerequisite only needs the id to be queryable.

CREATE INDEX IF NOT EXISTS
  contact_enrichment_candidates_apollo_person_id_idx
  ON public.contact_enrichment_candidates (apollo_person_id)
  WHERE apollo_person_id IS NOT NULL;

-- ── 3. Column comment ──────────────────────────────────────────────

COMMENT ON COLUMN public.contact_enrichment_candidates.apollo_person_id IS
  'APOLLO-PHONE-CACHE-1a — Apollo person id (MongoDB ObjectId, 24 hex chars) resolved during a phone reveal (start/webhook/recovery). Opaque correlation id, NOT PII. Reusable technical prerequisite for a FUTURE Apollo phone cache; this hito does not build or serve any cache. NULL until resolved. Never a Lusha v1.<token> id.';
