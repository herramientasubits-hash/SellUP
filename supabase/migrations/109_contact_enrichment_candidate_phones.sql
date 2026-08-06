-- Migration 109: canonical MULTIPLE-PHONE model for contact enrichment candidates
-- (Agente 2A · AGENT2A-PHONE-REVEAL-4O-B)
--
-- WHAT THIS IS FOR
--
-- Audit 4O-A established four facts. Apollo can return MULTIPLE phone numbers for one
-- person. Lusha can too. SellUp reduces those N numbers to exactly 1 before persisting.
-- The additional array entries are dropped in the normalizer and never reach the database,
-- so they are not recoverable later from anything SellUp stored — a second number that the
-- operator already PAID for is lost at write time, and re-obtaining it would mean paying
-- for the same reveal again.
--
-- This migration creates the two tables that stop that loss. It creates ONLY the shape:
-- 4O-B deliberately wires nothing. No provider client, webhook, recovery path, cache,
-- waterfall, candidate approval or UI reads or writes these tables in this block, so after
-- it lands both tables are EMPTY and the visible behaviour of the product is byte-for-byte
-- what it was before.
--
-- WHY TWO TABLES AND NOT ONE
--
-- A single table with one `provider` column cannot represent the fact that the SAME number
-- was observed by BOTH Apollo and Lusha. Forcing it into one row means either duplicating
-- the number (which breaks deduplication and invites double-counting credits per number) or
-- picking one provider and discarding the other (which destroys the provenance that makes
-- the record auditable). So provenance is a separate, many-per-phone table:
--
--   contact_enrichment_candidate_phones          — ONE row per distinct number per candidate
--   contact_enrichment_candidate_phone_sources    — N rows per number, one per observation
--
-- Same number from Apollo and Lusha ⇒ 1 canonical row + 2 provenance rows.
--
-- WHAT DOES **NOT** LIVE HERE: MONEY
--
-- There is deliberately NO cost, credit or spend column on either table. Splitting a
-- reveal's credits across the numbers it returned would invent a per-number price that
-- nobody charged, and would produce a second, competing set of books. The accounting stays
-- exactly where it already is and remains the only truth:
--
--   phone_reveal_waterfall_runs · phone_reveal_credit_reservations · provider_usage_logs
--
-- The provenance table carries NULLABLE pointers to those rows (run / reservation /
-- usage log) so a number can be traced back to the operation that paid for it, which is the
-- opposite of restating the amount.
--
-- THE SCALAR PHONE IS UNCHANGED
--
-- `contact_enrichment_candidates.phone` remains the visible source of truth for the primary
-- phone throughout this block. These tables are ADDITIVE and not yet consumed. There is
-- deliberately NO trigger synchronising the collection into that scalar: a trigger would be
-- a live runtime behaviour, and this block is authorized to add a model, not to change what
-- production does. The `is_primary` flag is where that future reconciliation will read from.
--
-- HISTORY IS NOT RECOVERABLE, SO IT IS NOT ATTEMPTED
--
-- Zero backfill. Both tables start empty. 4O-A established that the dropped array entries
-- were never persisted anywhere — not in the candidate row, not in the cache, not in the
-- run metadata — so there is no local source to backfill FROM. Reconstructing them would
-- mean re-calling the providers, i.e. paying again, which is out of scope and unauthorized.
-- The model captures numbers from the moment a future block wires it; everything observed
-- before that stays as it is.
--
-- PRIVACY — WHY `dedupe_key` IS A HASH
--
-- `dedupe_key` is a SHA-256 with a prefix declaring only the KIND of key
-- (`e164:` / `digits:` / `opaque:`). It never contains the number. That is load-bearing
-- precisely because of the tombstone: a suppressed row must KEEP its key (the key is the
-- UNIQUE that stops the number being re-inserted) while NOT keeping the number. With a
-- plaintext key, `normalized_phone = NULL` would be theatre — the number would still be
-- sitting in readable form in the column next to it.
--
-- Stated plainly rather than glossed: the phone number space is small, so an unsalted
-- SHA-256 is brute-forceable by anyone who already has the row. The hash is NOT a
-- cryptographic control against an attacker holding the table; it is what stops a suppressed
-- number from remaining stored IN CLEAR, which is the guarantee the tombstone actually
-- makes. The table-level hardening below is what keeps the rows out of reach in the first
-- place.
--
-- `source_event_key` carries no PII at all by construction — closed vocabularies plus
-- SellUp's own opaque row ids. No phone, email, name, LinkedIn, or provider-side person id.
--
-- ⚠️ NUMBERING. This file is 109, not 108, ON PURPOSE. The repo max on `main` is 107, but
-- PR #234 (Agente 1, a different thread) is OPEN carrying `108_add_prospect_candidates_
-- linkedin_url.sql`. Taking 108 here would produce two different migrations sharing one
-- number the moment both merge. A gap at 108 costs nothing if #234 is never merged —
-- migrations are applied in filename order and the remote numbering has already diverged
-- from the repo's (105/106 were renumbered on apply) — whereas a collision is a real defect.
--
-- ⚠️ NOT APPLIED. This migration has NOT been applied to any remote Supabase project. It is
-- a repo-only draft, exactly like 102/103 were at their own hito.
--
-- Idempotent: CREATE TABLE / INDEX use IF NOT EXISTS, constraints and policies are guarded,
-- and the REVOKE/GRANT block is declarative (it sets an end state, so re-applying converges).

-- ═══════════════════════════════════════════════════════════════════
-- 1. Canonical phones — ONE row per distinct number per candidate
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.contact_enrichment_candidate_phones (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The candidate this number belongs to. CASCADE: a deleted candidate has no phone
  -- collection worth keeping, and leaving orphan phone rows would be leaving orphan PII.
  candidate_id       uuid        NOT NULL
    REFERENCES public.contact_enrichment_candidates(id) ON DELETE CASCADE,

  -- Conservative canonical form of the number. E.164 (`+…`) ONLY when the input carried a
  -- verifiable international prefix; otherwise the national digits AS GIVEN, with no
  -- fabricated country code. NULL only for a tombstone or an entry with no usable digits.
  normalized_phone   text        NULL,
  -- The number as the provider formatted it, for display. NULL in a tombstone.
  display_phone      text        NULL,

  -- SHA-256 of the canonical form, prefixed with the key kind. NEVER the number itself.
  -- Survives suppression: it is what keeps a suppressed number from being re-inserted.
  dedupe_key         text        NOT NULL,

  -- Internal vocabulary, identical to `PhoneType` in phone-classification.ts. NULL in a
  -- tombstone: suppression erases the type along with the number.
  phone_type         text        NULL
    CONSTRAINT contact_enrichment_candidate_phones_phone_type_check
    CHECK (phone_type IS NULL OR phone_type IN (
      'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
    )),

  -- Closed, minimal vocabulary. `unknown` is the absence of evidence and must stay
  -- distinguishable from a provider ASSERTING the number is invalid.
  phone_status       text        NOT NULL DEFAULT 'unknown'
    CONSTRAINT contact_enrichment_candidate_phones_phone_status_check
    CHECK (phone_status IN ('valid', 'invalid', 'unknown')),

  -- Exactly one live primary per candidate; enforced by the partial index below, not by
  -- this default.
  is_primary         boolean     NOT NULL DEFAULT false,

  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),

  -- ── Suppression (tombstone) ─────────────────────────────────────
  -- The row SURVIVES suppression without the number. Deleting it instead would un-block the
  -- number: the next observation would re-insert it as if nothing had been erased.
  suppressed_at      timestamptz NULL,
  suppression_reason text        NULL
    CONSTRAINT contact_enrichment_candidate_phones_suppression_reason_check
    CHECK (suppression_reason IS NULL OR suppression_reason IN (
      'data_subject_request', 'operator_request', 'provider_retraction'
    )),
  -- internal_users.id of the operator. NOT a FK: an erasure record must survive user-row
  -- churn. Opaque id, no PII.
  suppressed_by      uuid        NULL,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- One canonical row per number per candidate. This is what makes "same number from Apollo
  -- and Lusha" collapse into one row instead of two.
  CONSTRAINT contact_enrichment_candidate_phones_candidate_dedupe_key_unique
    UNIQUE (candidate_id, dedupe_key),

  -- A primary must be live, have a number, and not be asserted invalid. Mirrored exactly by
  -- `isCandidatePhoneEligibleForPrimary()` in phone-collection-core.ts, so the pure chooser
  -- can never elect a row the database would then reject.
  CONSTRAINT contact_enrichment_candidate_phones_primary_requires_live_number
    CHECK (
      is_primary = false
      OR (
        suppressed_at IS NULL
        AND normalized_phone IS NOT NULL
        AND phone_status <> 'invalid'
      )
    ),

  -- A tombstone keeps the key and loses everything that identifies the person. Without this
  -- CHECK, "suppressed" would be a flag someone could set while leaving the number in place.
  CONSTRAINT contact_enrichment_candidate_phones_tombstone_is_empty
    CHECK (
      suppressed_at IS NULL
      OR (
        normalized_phone IS NULL
        AND display_phone IS NULL
        AND phone_type IS NULL
        AND is_primary = false
      )
    )
);

-- Exactly ONE primary per candidate. A partial UNIQUE index rather than a constraint because
-- the uniqueness only applies to the `true` rows: every candidate may have many non-primary
-- phones, and a candidate with zero live numbers legitimately has no primary at all.
CREATE UNIQUE INDEX IF NOT EXISTS contact_enrichment_candidate_phones_one_primary_idx
  ON public.contact_enrichment_candidate_phones (candidate_id)
  WHERE is_primary;

-- Reading a candidate's live collection is the access path the future writer and UI need.
CREATE INDEX IF NOT EXISTS contact_enrichment_candidate_phones_candidate_live_idx
  ON public.contact_enrichment_candidate_phones (candidate_id)
  WHERE suppressed_at IS NULL;

-- Reuses set_updated_at() from migration 038, exactly as 099 does for the cache table.
DROP TRIGGER IF EXISTS contact_enrichment_candidate_phones_set_updated_at
  ON public.contact_enrichment_candidate_phones;
CREATE TRIGGER contact_enrichment_candidate_phones_set_updated_at
  BEFORE UPDATE ON public.contact_enrichment_candidate_phones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════
-- 2. Provenance — N observations per canonical phone
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.contact_enrichment_candidate_phone_sources (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  candidate_phone_id    uuid        NOT NULL
    REFERENCES public.contact_enrichment_candidate_phones(id) ON DELETE CASCADE,

  provider              text        NOT NULL
    CONSTRAINT contact_enrichment_candidate_phone_sources_provider_check
    CHECK (provider IN ('apollo', 'lusha', 'apollo_cache', 'manual', 'unknown')),

  acquisition_mode      text        NOT NULL
    CONSTRAINT contact_enrichment_candidate_phone_sources_acquisition_mode_check
    CHECK (acquisition_mode IN ('search', 'reveal', 'waterfall', 'cache', 'manual')),

  -- The provider's OWN words, kept verbatim and never normalised away. This is what makes a
  -- disagreement between two providers about the same number reconstructable later.
  raw_provider_type     text        NULL,
  raw_provider_status   text        NULL,

  -- Pointers to the accounting rows. SET NULL rather than CASCADE: losing the operation
  -- record must not silently delete the evidence that the number was observed.
  waterfall_run_id      uuid        NULL
    REFERENCES public.phone_reveal_waterfall_runs(id) ON DELETE SET NULL,
  reservation_id        uuid        NULL
    REFERENCES public.phone_reveal_credit_reservations(id) ON DELETE SET NULL,
  provider_usage_log_id uuid        NULL
    REFERENCES public.provider_usage_logs(id) ON DELETE SET NULL,

  -- Deterministic, idempotent, PII-FREE identity of the observation. Built ONLY from closed
  -- vocabularies, the operation phase, and SellUp's own opaque row ids — never from the
  -- number. `observed_at` is deliberately NOT part of it: reprocessing the same webhook with
  -- a fresh clock must recognise the same provenance rather than append a second row.
  source_event_key      text        NOT NULL,

  observed_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),

  -- Same observation recorded twice ⇒ one row. This is the idempotency guarantee.
  CONSTRAINT contact_enrichment_candidate_phone_sources_event_key_unique
    UNIQUE (candidate_phone_id, source_event_key)
);

CREATE INDEX IF NOT EXISTS contact_enrichment_candidate_phone_sources_phone_idx
  ON public.contact_enrichment_candidate_phone_sources (candidate_phone_id);

-- ═══════════════════════════════════════════════════════════════════
-- 3. RLS + table-level privilege hardening
-- ═══════════════════════════════════════════════════════════════════
-- Following the pattern validated in migrations 106 and 107, and applied HERE IN THE SAME
-- MIGRATION that creates the tables rather than in a later cleanup.
--
-- The reason it cannot wait: Supabase ships
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated,
--   service_role
-- so EVERY table born in `public` starts with the full eight-privilege set for the two
-- browser-reachable roles. "RLS on + one service_role policy" is therefore NOT
-- service-role-only: RLS decides which ROWS a role may touch, while the table-level GRANT
-- decides whether it may touch the table AT ALL — and TRUNCATE is not filtered by RLS in any
-- way. That is exactly the hole 106 and 107 had to come back and close on four existing
-- tables. These two hold phone numbers and their tombstones, so they are hardened at birth.
--
-- `GRANT` only ADDS, so `service_role` is REVOKED first and then granted a shorter list.
-- Revoke-then-grant runs inside one block: there is no window in which the server lacks what
-- it needs.

ALTER TABLE public.contact_enrichment_candidate_phones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_enrichment_candidate_phone_sources ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contact_enrichment_candidate_phones'
      AND policyname = 'contact_enrichment_candidate_phones_service_role'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY contact_enrichment_candidate_phones_service_role
        ON public.contact_enrichment_candidate_phones
        FOR ALL TO service_role USING (true) WITH CHECK (true)
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contact_enrichment_candidate_phone_sources'
      AND policyname = 'contact_enrichment_candidate_phone_sources_service_role'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY contact_enrichment_candidate_phone_sources_service_role
        ON public.contact_enrichment_candidate_phone_sources
        FOR ALL TO service_role USING (true) WITH CHECK (true)
    $policy$;
  END IF;
END $$;

DO $$
BEGIN
  -- ── contact_enrichment_candidate_phones ────────────────────────
  -- `PUBLIC` is revoked too: a grant to PUBLIC reaches every role that exists now or later,
  -- so revoking it is the statement whose whole value is in what it PREVENTS.
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.contact_enrichment_candidate_phones FROM PUBLIC';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.contact_enrichment_candidate_phones FROM anon';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.contact_enrichment_candidate_phones FROM authenticated';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.contact_enrichment_candidate_phones FROM service_role';

  -- SELECT / INSERT / UPDATE, and NO DELETE.
  --
  -- Honest framing, because the 106/107 rule is "grant only what the call sites demonstrate"
  -- and 4O-B has ZERO call sites by design: this is the envelope the model REQUIRES, not a
  -- set of observed usages. SELECT to read a candidate's collection; INSERT to add a newly
  -- observed number; UPDATE for `last_seen_at`, for `is_primary` re-election, and for the
  -- suppression patch that NULLs the number.
  --
  -- DELETE is withheld for the same reason 107 withholds it on `phone_reveal_cache`:
  -- suppression here is a hard delete of the VALUE via UPDATE, never a row DELETE, because
  -- the row IS the block. Deleting a tombstone would let a suppressed number be re-inserted
  -- by the next observation as though the erasure had never happened. The one path that can
  -- still remove rows is the `candidate_id` CASCADE, which referential integrity executes
  -- with the constraint owner's rights and does NOT consult this grant.
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.contact_enrichment_candidate_phones TO service_role';

  -- ── contact_enrichment_candidate_phone_sources ─────────────────
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.contact_enrichment_candidate_phone_sources FROM PUBLIC';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.contact_enrichment_candidate_phone_sources FROM anon';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.contact_enrichment_candidate_phone_sources FROM authenticated';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.contact_enrichment_candidate_phone_sources FROM service_role';

  -- APPEND-AND-READ ONLY. UPDATE and DELETE are absent on purpose and their absence is the
  -- guarantee: provenance whose writer can rewrite or erase it is not provenance. An
  -- observation that turns out to be wrong is corrected by recording the later observation,
  -- never by editing the earlier one.
  EXECUTE 'GRANT SELECT, INSERT ON TABLE public.contact_enrichment_candidate_phone_sources TO service_role';

  -- NOT granted to anybody on either table: TRUNCATE (ignores RLS entirely and would erase
  -- every tombstone at once, silently making suppressed numbers revealable again — a privacy
  -- failure that would then present as a cost line), REFERENCES (pointing an FK at these is
  -- a migration-time act by the owner), TRIGGER (the ability to attach code running with the
  -- owner's reach next to the phone numbers, i.e. an exfiltration hook), and MAINTAIN.
END $$;

COMMENT ON TABLE public.contact_enrichment_candidate_phones IS
  'AGENT2A-PHONE-REVEAL-4O-B — canonical collection of MULTIPLE phone numbers per contact enrichment candidate: one row per distinct number, deduplicated by a SHA-256 dedupe_key that never contains the number. Exists because Apollo and Lusha both return arrays and SellUp used to keep only the first, silently discarding numbers already paid for. Suppression is a tombstone: the row survives without the number (that is what blocks re-insertion), enforced by a CHECK. Holds NO cost or credit column on purpose — the accounting stays in phone_reveal_waterfall_runs / phone_reveal_credit_reservations / provider_usage_logs. Starts EMPTY: no backfill is possible because the discarded values were never persisted anywhere. Not yet consumed by any runtime path; contact_enrichment_candidates.phone remains the visible primary. Service-role only: SELECT/INSERT/UPDATE, no DELETE (deleting a row deletes a tombstone), nothing for PUBLIC/anon/authenticated, and TRUNCATE/REFERENCES/TRIGGER/MAINTAIN granted to nobody.';

COMMENT ON TABLE public.contact_enrichment_candidate_phone_sources IS
  'AGENT2A-PHONE-REVEAL-4O-B — provenance of each canonical candidate phone, many per number. Exists so that the SAME number observed by BOTH Apollo and Lusha is one canonical row with TWO provenances, instead of a duplicated number or a discarded provider. Keeps each provider raw type/status verbatim and points at the run / reservation / usage log that paid for the observation WITHOUT restating any amount. source_event_key is deterministic, idempotent and PII-free (closed vocabularies plus SellUp opaque row ids, never the number, and deliberately excluding observed_at so a reprocessed webhook does not append a duplicate). Service-role only and APPEND-AND-READ ONLY: SELECT and INSERT, never UPDATE or DELETE, nothing for PUBLIC/anon/authenticated, and TRUNCATE/REFERENCES/TRIGGER/MAINTAIN granted to nobody.';
