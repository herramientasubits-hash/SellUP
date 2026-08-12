-- Migration 115: PRIVACY for the OFFICIAL multiple-phone model
-- (Agente 2A · AGENT2A-PHONE-REVEAL-4O-H2)
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS
-- ═══════════════════════════════════════════════════════════════════
--
-- 114 created `contact_phones` + `contact_phone_sources` and wired NOTHING. It shipped the
-- shape of provider-specific erasure — a canonical number with N withdrawable provenances —
-- and deliberately left the OPERATION that performs it to this migration. The order is not
-- cosmetic: H3 will let candidate approval WRITE those tables, and a collection that can be
-- written but not erased is a collection that cannot honour a DSAR. So privacy lands FIRST,
-- while both tables are still empty in every environment and the operation is provably inert.
--
-- The contract 114 could only describe, and this migration implements:
--
--   Apollo and Lusha both justify the SAME number
--     → Apollo erasure withdraws the Apollo provenance ONLY
--     → the Lusha provenance stays live
--     → the canonical number stays live, and NOTHING is deleted
--   later, Lusha erasure
--     → the last live provenance is gone
--     → the canonical row becomes a TOMBSTONE
--     → if it was the primary, a new primary is elected deterministically
--     → the legacy `contacts.phone` projection is re-synchronised in the SAME transaction
--
-- ═══════════════════════════════════════════════════════════════════
-- WHAT THIS BLOCK DOES **NOT** DO
-- ═══════════════════════════════════════════════════════════════════
--
--   structural change to contact_phones          0   provider HTTP call        0
--   structural change to contact_phone_sources   0   credit / reservation      0
--   rows inserted anywhere                       0   backfill                  0
--   feature flag read or written                 0   UI change                 0
--   HubSpot write                                0   approval-path change      0
--   widening of any grant created by 114         0   DELETE of any phone row   0
--
-- 114 closed the SHAPE of both tables. This migration adds no column, no constraint and no
-- index to either of them: if H2 had needed one, that would have contradicted H1 and the
-- correct move would have been to stop. What it adds is two audit COUNTERS on the existing
-- `phone_reveal_suppression_audit` and ONE transactional function.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY `SECURITY INVOKER`, AND WHY THAT IS THE WHOLE SAFETY ARGUMENT
-- ═══════════════════════════════════════════════════════════════════
--
-- Migration 112 established this and the reasoning transfers verbatim, only stronger here.
-- INVOKER means the function runs under 114's grant ceiling, so it CANNOT:
--
--   * DELETE a `contact_phones` row — nobody holds DELETE, and deleting a tombstone would
--     un-block the erased number: the next observation would re-insert it as though the
--     erasure had never happened;
--   * DELETE a `contact_phone_sources` row — nobody holds DELETE, and a deleted provenance
--     is evidence destroyed in the one operation that most needs to be auditable after;
--   * rewrite provenance — `service_role` holds UPDATE on exactly three columns of
--     `contact_phone_sources` (`suppressed_at`, `suppression_reason`, `suppressed_by`), so
--     `provider`, `acquisition_mode`, the raw provider labels, the three accounting
--     pointers, `candidate_phone_id`, `source_event_key`, `observed_at` and `created_at` are
--     immutable to this function BY PRIVILEGE rather than by intention.
--
-- A `SECURITY DEFINER` function owned by `postgres` would hand itself all three, in the one
-- operation whose entire purpose is erasure. That is why DEFINER is not used, and it is why
-- `search_path` is still pinned to `pg_catalog, pg_temp` with every reference schema-
-- qualified and no dynamic SQL anywhere: the caller must not be able to bend name resolution
-- even though the function holds no extra rights.
--
-- ═══════════════════════════════════════════════════════════════════
-- THE SUPPRESSIBILITY PREDICATE IS **DERIVED**, NOT INVENTED
-- ═══════════════════════════════════════════════════════════════════
--
-- 114's provenance is a PAIR — `(provider, acquisition_mode)`. The legacy scalar
-- `contacts.phone_source` is one fused string, and 4O-E4 already decided, and pinned in
-- tests, exactly which of its values a privacy erasure is authorised to destroy:
--
--   SUPPRESSIBLE_CONTACT_PHONE_SOURCES = { apollo_reveal, apollo_cache, lusha_reveal }
--
-- and therefore NEVER `manual`, NEVER `unknown`, NEVER `apollo_search`, NEVER
-- `provider_payload`, NEVER NULL. Migration 112 already owns the exhaustive, lossless
-- translation from the pair to that fused string. So this migration does NOT author a second
-- authority over which provenance may be erased. It COMPOSES the two that exist:
--
--   suppressible(pair) ⇔ legacy_source_of(pair) ∈ SUPPRESSIBLE_CONTACT_PHONE_SOURCES
--
-- Applying 112's mapping to every representable pair yields exactly:
--
--   (apollo,       reveal)     → apollo_reveal   → SUPPRESSIBLE
--   (apollo,       waterfall)  → apollo_reveal   → SUPPRESSIBLE
--   (apollo_cache, *)          → apollo_cache    → SUPPRESSIBLE
--   (lusha,        *)          → lusha_reveal    → SUPPRESSIBLE
--   (apollo,       search)     → apollo_search   → protected
--   (apollo,       cache)      → unknown         → protected
--   (apollo,       manual)     → unknown         → protected
--   (manual,       *)          → manual          → protected
--   (unknown,      *)          → unknown         → protected
--
-- Two consequences are DECLARED rather than discovered later, and both are pinned by tests:
--
--   * `manual` provenance survives an Apollo erasure AND a Lusha erasure. A DSAR aimed at a
--     provider has no authority over evidence a human typed. This is 4O-E4's "FIX M1"
--     applied to the official collection.
--   * `unknown` provenance survives too. Provider-specific suppression must not CLAIM that
--     unattributed provenance belonged to Apollo; the fail-closed direction for an erasure
--     AUTHORITY is to erase less, never to erase on a guess.
--   * `(apollo, search)` survives an Apollo erasure. That is not an oversight: the legacy
--     contract has never authorised destroying an `apollo_search` scalar, and widening the
--     blast radius on the way to the official model would be this migration inventing an
--     authority nobody granted it. If that decision is ever revisited it must be revisited
--     in ONE place — the legacy allowlist — and both layers will move together.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY THE LEGACY DSAR MAPS TO **ALL** SUPPRESSIBLE PROVIDERS
-- ═══════════════════════════════════════════════════════════════════
--
-- The one wired privacy entry point (`suppressPhoneCacheEntryAction`) is keyed by an Apollo
-- person id, and it is tempting to read that as "an Apollo erasure". It is not. The Apollo id
-- is the CACHE KEY — it identifies WHICH PERSON — and what the operation then erases already
-- spans providers today: it tombstones the candidate's ENTIRE phone collection
-- (`all_candidate_phones`) and it clears a `contacts` scalar whose provenance is
-- `lusha_reveal`. It is a PERSON-level erasure wearing a provider-shaped key.
--
-- So the wired caller passes the `all_suppressible_providers` scope. Wiring it to
-- `single_provider = apollo` would have been a privacy REGRESSION dressed as precision: the
-- Lusha provenance would stay live, the canonical number would stay live, and the legacy
-- scalar would be cleared next to it — an official collection still holding the number a
-- DSAR was told to erase, and a contact whose two representations disagree.
--
-- `single_provider` exists because 114's model is what makes it representable and because it
-- is the ONLY correct shape for the two operations that come later — a provider retraction,
-- and a per-provider erasure request. It is implemented, granted and tested here; it simply
-- has no wired caller yet, exactly as 112's `exact_phone` scope does not.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY THE SCALAR PROJECTION IS GATED ON AN EXISTING COLLECTION
-- ═══════════════════════════════════════════════════════════════════
--
-- `contacts.phone` is NOT derived from `contact_phones` today: 114 is inert and both tables
-- are empty in every environment. A function that unconditionally re-projected the scalar
-- from the official collection would therefore compute "no live primary" for EVERY contact
-- and NULL a legacy phone that the official model never had an opinion about — turning a
-- privacy operation into data loss, and bypassing the very allowlist 4O-E4 exists to enforce.
--
-- So the function refuses the whole operation, writing nothing, when the contact has NO
-- `contact_phones` row at all (`status = 'no_official_collection'`). In Production today that
-- is every contact, which is precisely why this migration is a provable no-op there. The
-- projection begins to matter the day H3 populates the collection, and not one moment before.
--
-- The scalar is additionally protected by the legacy allowlist INSIDE the transaction: if
-- `contacts.phone_source` is not suppressible (`manual`, `unknown`, `apollo_search`,
-- `provider_payload`, NULL), the scalar tuple is left untouched even when the official
-- primary changed. A number whose provenance this operation has no authority to destroy must
-- not be destroyed as a side effect of re-projecting a collection.
--
-- ═══════════════════════════════════════════════════════════════════
-- SAFETY
-- ═══════════════════════════════════════════════════════════════════
--
-- Nothing in this file activates a flag, calls a provider, moves a credit, writes HubSpot,
-- creates a contact, performs a backfill or inserts a single row. The function it creates
-- writes NO usage log, NO reservation and NO waterfall row: a provider that was already
-- called was already charged, and privacy withholds the NUMBER, never the cost.
--
-- APPLIED IN PRODUCTION: NO — pendiente de autorización explícita posterior al merge.

-- ═══════════════════════════════════════════════════════════════════
-- 1. Audit counters for the OFFICIAL collection
-- ═══════════════════════════════════════════════════════════════════
--
-- `phone_reveal_suppression_audit` (099, extended once by 112) already distinguishes the
-- cache tombstone (`cache_rows_suppressed`), the legacy scalar (`contacts_cleared`), the
-- candidates reached (`candidates_cleared`) and the candidate collection
-- (`candidate_phone_rows_suppressed`). The official collection is a FIFTH, independent
-- surface, and "how many official provenances were withdrawn" is not answerable from any of
-- the four. Without these two columns an official erasure would be invisible in the only
-- durable record of the operation — and 4O-E2 added its counter for exactly this reason.
--
-- Two counters and not one, because they answer different questions and can legitimately
-- disagree: withdrawing three provenances that leave a fourth alive tombstones nothing, and
-- one withdrawal can tombstone a number that had a single source. The pair is what makes
-- "cross-provider survival happened" reconstructable after the fact.
--
-- Same shape as 112's ADD COLUMN: additive, `IF NOT EXISTS`, NOT NULL with a 0 default so
-- every historical row reads as "no official surface touched" (which is true — there was
-- none), and the non-negativity CHECK added under a `pg_constraint` guard so re-application
-- is safe. The table's 107 grants are NOT restated: `service_role` holds SELECT + INSERT and
-- deliberately no UPDATE and no DELETE, and an append-only audit gains nothing from being
-- re-granted.

ALTER TABLE public.phone_reveal_suppression_audit
  ADD COLUMN IF NOT EXISTS official_phone_sources_suppressed integer NOT NULL DEFAULT 0;

ALTER TABLE public.phone_reveal_suppression_audit
  ADD COLUMN IF NOT EXISTS official_phone_rows_tombstoned integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_suppression_audit_official_sources_check'
  ) THEN
    ALTER TABLE public.phone_reveal_suppression_audit
      ADD CONSTRAINT phone_reveal_suppression_audit_official_sources_check
      CHECK (official_phone_sources_suppressed >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_suppression_audit_official_tombstones_check'
  ) THEN
    ALTER TABLE public.phone_reveal_suppression_audit
      ADD CONSTRAINT phone_reveal_suppression_audit_official_tombstones_check
      CHECK (official_phone_rows_tombstoned >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.phone_reveal_suppression_audit.official_phone_sources_suppressed IS
  'AGENT2A-PHONE-REVEAL-4O-H2 — how many contact_phone_sources rows this erasure WITHDREW (tombstoned, never deleted). Independent of official_phone_rows_tombstoned: withdrawing provenances that leave another live source tombstones no number, which is exactly what cross-provider survival looks like in the audit trail.';

COMMENT ON COLUMN public.phone_reveal_suppression_audit.official_phone_rows_tombstoned IS
  'AGENT2A-PHONE-REVEAL-4O-H2 — how many canonical contact_phones rows lost their LAST live provenance and became tombstones. A tombstone keeps contact_id + dedupe_key and loses the number, which is what blocks re-insertion; it is never a DELETE.';

-- ═══════════════════════════════════════════════════════════════════
-- 2. The transactional erasure
-- ═══════════════════════════════════════════════════════════════════
--
-- ONE function, because every step below has to succeed or fail together. Split across
-- statements from the application, a failure between "withdraw the provenance" and
-- "tombstone the number" leaves a canonical row that is live with zero live sources — a
-- number the model says is erased and the database still serves — and a failure before the
-- scalar sync leaves `contacts.phone` asserting a provenance that is already withdrawn.
--
-- Steps, in order:
--
--   0. validate — fail closed before ANY write
--   1. lock the contact, then its canonical rows, in a deterministic order
--   2. refuse if the contact has no official collection (the Production no-op)
--   3. withdraw the matching LIVE, SUPPRESSIBLE provenances
--   4. tombstone every canonical row left with no live provenance
--   5. re-elect a primary ONLY if the incumbent stopped being live
--   6. re-project the legacy `contacts` scalar tuple, under the legacy allowlist
--   7. return a PII-free envelope of counts, booleans and a mechanical status

CREATE OR REPLACE FUNCTION public.suppress_official_contact_phone_sources(
  p_contact_id         uuid,
  p_provider_scope     text,
  p_provider           text,
  p_dedupe_key         text,
  p_suppression_reason text,
  p_suppressed_by      uuid,
  p_suppressed_at      timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  -- `compareCandidatePhones()` / migration 112 step 4, verbatim. Reused and NOT restated in a
  -- second incompatible order: two rankings over the same vocabulary is how the candidate and
  -- the official collection end up electing different primaries for the same person.
  c_type_ranking   text[] := ARRAY[
    'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
  ];

  -- 112's provenance-specificity ranking, verbatim: reveal > cache > search. `manual:manual`
  -- is deliberately ABSENT — manual precedence is a PRIOR TIER (see step 5), not a rung on
  -- this ladder, because a manual `work` number must outrank a provider `personal_mobile`
  -- and no reordering of a single ladder can express that.
  c_source_ranking text[] := ARRAY[
    'apollo:reveal', 'lusha:reveal', 'apollo_cache:cache', 'apollo:search'
  ];

  -- 114's suppression vocabulary (which is 109's). NOT the cache/audit vocabulary of 099 —
  -- the two sets share zero values and 112 owns the translation.
  c_reasons        text[] := ARRAY[
    'data_subject_request', 'operator_request', 'provider_retraction'
  ];

  c_scopes         text[] := ARRAY['all_suppressible_providers', 'single_provider'];

  -- 114's provider vocabulary, for validating `p_provider` before it can select nothing
  -- silently.
  c_providers      text[] := ARRAY['apollo', 'lusha', 'apollo_cache', 'manual', 'unknown'];

  -- The legacy allowlist of 4O-E4, which governs the SCALAR only.
  c_suppressible_legacy_sources text[] := ARRAY[
    'apollo_reveal', 'apollo_cache', 'lusha_reveal'
  ];

  v_contact                RECORD;
  v_official_rows          integer := 0;
  v_sources_suppressed     integer := 0;
  v_tombstoned             integer := 0;
  v_incumbent_id           uuid;
  v_incumbent_live         boolean := false;
  v_primary                RECORD;
  v_primary_id             uuid;
  v_primary_key            text;
  v_previous_primary_key   text;
  v_survivor_count         integer := 0;
  v_scalar                 text;
  v_scalar_type            text;
  v_scalar_source          text;
  v_scalar_raw_type        text;
  v_scalar_revealed_at     timestamptz;
  v_src                    RECORD;
  v_contact_rows           integer := 0;
  v_scalar_synced          boolean := false;
  v_scalar_guarded         boolean := false;
BEGIN
  -- ═══════════════════════════════════════════════════════════════
  -- Step 0 — validation. Fail closed BEFORE any write.
  -- ═══════════════════════════════════════════════════════════════
  -- Every arm returns a mechanical `invalid_input` and writes nothing. An erasure that
  -- silently matched zero rows because its scope was misspelled would report success while
  -- leaving the number live, so an unrecognised scope is an ERROR and never an empty match.

  IF p_contact_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'contact_id_missing');
  END IF;

  IF p_provider_scope IS NULL OR NOT (p_provider_scope = ANY (c_scopes)) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'provider_scope_unknown');
  END IF;

  IF p_provider_scope = 'single_provider' THEN
    IF p_provider IS NULL OR NOT (p_provider = ANY (c_providers)) THEN
      RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'provider_unknown');
    END IF;
  ELSIF p_provider IS NOT NULL THEN
    -- A provider passed alongside the all-providers scope means the caller believes one of
    -- the two, and the function cannot know which. Rejecting is the only answer that cannot
    -- silently erase more or less than intended.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'provider_not_allowed');
  END IF;

  IF p_dedupe_key IS NOT NULL AND LENGTH(BTRIM(p_dedupe_key)) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'dedupe_key_blank');
  END IF;

  IF p_suppression_reason IS NULL
     OR NOT (p_suppression_reason = ANY (c_reasons)) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'suppression_reason_unknown');
  END IF;

  IF p_suppressed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'suppressed_at_missing');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 1 — lock the contact, then its canonical rows.
  -- ═══════════════════════════════════════════════════════════════
  -- The CONTACT row is the serialisation point, and locking it first is what makes two
  -- concurrent erasures on the same person strictly ordered instead of interleaved. Without
  -- it, two provider-specific erasures could each observe the other's provenance as still
  -- live, each conclude a live source remains, and both decline to tombstone a number whose
  -- last two sources are now withdrawn.
  --
  -- `contact_phones` rows are then locked in `id` order so two operations touching the same
  -- collection can never deadlock by taking the same locks in opposite orders.
  --
  -- `contact_phone_sources` is deliberately NOT locked directly: it is reachable ONLY through
  -- a canonical row, and every canonical row in scope is already locked. Locking it as well
  -- would add a dependency on `SELECT … FOR UPDATE` being satisfied by 114's COLUMN-LEVEL
  -- UPDATE grant — a subtlety worth not relying on when the parent lock is already sufficient.

  SELECT c.id, c.phone, c.phone_source
    INTO v_contact
  FROM public.contacts c
  WHERE c.id = p_contact_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'contact_not_found', 'detail', 'contact_missing');
  END IF;

  PERFORM 1
  FROM public.contact_phones p
  WHERE p.contact_id = p_contact_id
  ORDER BY p.id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_official_rows
  FROM public.contact_phones p
  WHERE p.contact_id = p_contact_id;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 2 — the Production no-op.
  -- ═══════════════════════════════════════════════════════════════
  -- No official collection ⇒ this function has NOTHING to say about the contact, and in
  -- particular no authority to re-project `contacts.phone` from an empty set. Returning here
  -- is what keeps 4O-E4 the sole owner of the legacy scalar until H3 populates the collection.

  IF v_official_rows = 0 THEN
    RETURN jsonb_build_object(
      'status',                     'no_official_collection',
      'sources_suppressed',         0,
      'phones_tombstoned',          0,
      'survivor_count',             0,
      'primary_dedupe_key',         NULL,
      'primary_changed',            false,
      'scalar_synced',              false,
      'scalar_guarded_by_provenance', false,
      'contact_settled',            true
    );
  END IF;

  -- The incumbent primary, read BEFORE anything is withdrawn. Step 5 needs to know whether
  -- the primary the operator had is still live, not merely which row ranks best now.
  SELECT p.id, p.dedupe_key
    INTO v_primary
  FROM public.contact_phones p
  WHERE p.contact_id = p_contact_id AND p.is_primary
  LIMIT 1;

  IF FOUND THEN
    v_incumbent_id         := v_primary.id;
    v_previous_primary_key := v_primary.dedupe_key;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 3 — withdraw the matching LIVE, SUPPRESSIBLE provenances.
  -- ═══════════════════════════════════════════════════════════════
  -- Only the suppression triad is written. `provider`, `acquisition_mode`, the raw provider
  -- labels, the accounting pointers, `candidate_phone_id`, `source_event_key`, `observed_at`
  -- and `created_at` are untouched — and could not be touched even by a bug, because 114
  -- grants UPDATE on three columns and no more. The row survives as evidence.
  --
  -- `suppressed_at IS NULL` is what makes a repeated erasure idempotent: the second call
  -- matches zero rows rather than re-stamping a withdrawal with a later timestamp and a
  -- possibly different actor.
  --
  -- The suppressibility predicate is 112's mapping composed with 4O-E4's allowlist, written
  -- out as the four positive cases it reduces to. `manual`, `unknown` and `(apollo, search)`
  -- are absent BY CONSTRUCTION, not by omission.

  UPDATE public.contact_phone_sources s
     SET suppressed_at      = p_suppressed_at,
         suppression_reason = p_suppression_reason,
         suppressed_by      = p_suppressed_by
   WHERE s.suppressed_at IS NULL
     AND s.contact_phone_id IN (
       SELECT p.id FROM public.contact_phones p
       WHERE p.contact_id = p_contact_id
         AND (p_dedupe_key IS NULL OR p.dedupe_key = p_dedupe_key)
     )
     AND (
       p_provider_scope = 'all_suppressible_providers'
       OR s.provider = p_provider
     )
     AND (
       s.provider = 'apollo_cache'
       OR s.provider = 'lusha'
       OR (s.provider = 'apollo' AND s.acquisition_mode IN ('reveal', 'waterfall'))
     );

  GET DIAGNOSTICS v_sources_suppressed = ROW_COUNT;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 4 — tombstone every canonical row with no live provenance left.
  -- ═══════════════════════════════════════════════════════════════
  -- This is the LAST-LIVE-SOURCE rule, and it is evaluated INSIDE the transaction that
  -- performed the withdrawal — which is the only place the answer is not a race.
  --
  -- The tombstone shape is 114's `contact_phones_tombstone_is_empty` CHECK restated: the row
  -- keeps `contact_id`, `dedupe_key`, `created_at` and its identity, and loses the number,
  -- the display form, the type and `is_primary`. Nothing is deleted, because the row IS the
  -- block: deleting it would let the next observation re-insert the erased number.
  --
  -- A canonical row whose sources were ALL ALREADY withdrawn before this call is included by
  -- `suppressed_at IS NULL` on the parent — that is a repair, not a new erasure, and it is
  -- the state a crash between step 3 and step 4 of an earlier attempt would have left. It is
  -- counted, so the audit shows it happened.

  UPDATE public.contact_phones p
     SET normalized_phone   = NULL,
         display_phone      = NULL,
         phone_type         = NULL,
         is_primary         = false,
         suppressed_at      = p_suppressed_at,
         suppression_reason = p_suppression_reason,
         suppressed_by      = p_suppressed_by
   WHERE p.contact_id = p_contact_id
     AND p.suppressed_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.contact_phone_sources s
       WHERE s.contact_phone_id = p.id
         AND s.suppressed_at IS NULL
     );

  GET DIAGNOSTICS v_tombstoned = ROW_COUNT;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 5 — re-elect a primary ONLY if the incumbent stopped being live.
  -- ═══════════════════════════════════════════════════════════════
  -- INCUMBENT STABILITY is a deliberate property, not an optimisation. An erasure must not
  -- reshuffle a collection it did not erase: if the operator's primary is still live, it
  -- STAYS the primary even when another row would now rank higher. Re-ranking on every
  -- provider erasure would silently move the number the whole product displays, for reasons
  -- that have nothing to do with the request.

  SELECT EXISTS (
    SELECT 1 FROM public.contact_phones p
    WHERE p.id = v_incumbent_id
      AND p.suppressed_at IS NULL
      AND p.normalized_phone IS NOT NULL
      AND p.phone_status <> 'invalid'
      AND p.is_primary
  ) INTO v_incumbent_live;

  SELECT COUNT(*) INTO v_survivor_count
  FROM public.contact_phones p
  WHERE p.contact_id = p_contact_id
    AND p.suppressed_at IS NULL
    AND p.normalized_phone IS NOT NULL
    AND p.phone_status <> 'invalid';

  IF v_incumbent_live THEN
    v_primary_id  := v_incumbent_id;
    v_primary_key := v_previous_primary_key;
  ELSE
    -- Eligibility is 114's `contact_phones_primary_requires_live_number` CHECK restated:
    -- alive, numbered, not asserted invalid. A row this query accepts is therefore never one
    -- the database would then reject.
    --
    -- The ORDER BY, rung by rung:
    --   1. MANUAL PRECEDENCE — a live `manual` provenance wins outright. This is 4O-H0's
    --      decision and it is a TIER above the type ladder: a human-typed `work` number beats
    --      a provider-supplied `personal_mobile`, because the provider number is the one a
    --      privacy request can take away and the human one is the one somebody verified.
    --   2. best PhoneType (112's ranking, unchanged)
    --   3. `valid` over `unknown`
    --   4. most specific provenance (reveal > cache > search)
    --   5. most recent `last_seen_at`
    --   6. `dedupe_key` ascending — NOT NULL and unique per contact, so the comparator is
    --      TOTAL and the physical row order never participates in any step. Without a total
    --      comparator the "deterministic re-election" of two equally-ranked rows would be
    --      whatever the planner returned that day.
    SELECT p.id, p.dedupe_key, p.display_phone, p.normalized_phone, p.phone_type
      INTO v_primary
    FROM public.contact_phones p
    WHERE p.contact_id = p_contact_id
      AND p.suppressed_at IS NULL
      AND p.normalized_phone IS NOT NULL
      AND p.phone_status <> 'invalid'
    ORDER BY
      CASE WHEN EXISTS (
        SELECT 1 FROM public.contact_phone_sources s
        WHERE s.contact_phone_id = p.id
          AND s.suppressed_at IS NULL
          AND s.provider = 'manual'
      ) THEN 0 ELSE 1 END,
      COALESCE(array_position(c_type_ranking, p.phone_type),
               array_length(c_type_ranking, 1) + 1),
      CASE p.phone_status WHEN 'valid' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END,
      COALESCE((
        SELECT MIN(COALESCE(
                 array_position(c_source_ranking, s.provider || ':' || s.acquisition_mode),
                 array_length(c_source_ranking, 1) + 1))
        FROM public.contact_phone_sources s
        WHERE s.contact_phone_id = p.id
          AND s.suppressed_at IS NULL
      ), array_length(c_source_ranking, 1) + 1),
      p.last_seen_at DESC,
      p.dedupe_key ASC
    LIMIT 1;

    IF FOUND THEN
      v_primary_id  := v_primary.id;
      v_primary_key := v_primary.dedupe_key;

      -- Demote first, promote second. `contact_phones_one_primary_idx` does not tolerate two
      -- primaries even for one statement, and this order needs no window.
      UPDATE public.contact_phones
         SET is_primary = false
       WHERE contact_id = p_contact_id
         AND is_primary
         AND id <> v_primary_id;

      UPDATE public.contact_phones
         SET is_primary = true
       WHERE id = v_primary_id
         AND NOT is_primary;
    ELSE
      -- Nothing electable survives. Defence in depth rather than a live path: step 4 already
      -- cleared `is_primary` on everything it tombstoned, and 114's CHECK makes "primary and
      -- not electable" unrepresentable. If the invariant were ever violated this repairs it
      -- instead of leaving a primary pointing at a number nobody may use.
      UPDATE public.contact_phones
         SET is_primary = false
       WHERE contact_id = p_contact_id
         AND is_primary;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 6 — re-project the legacy `contacts` scalar tuple.
  -- ═══════════════════════════════════════════════════════════════
  -- The scalar is a COMPATIBILITY PROJECTION of the live primary, never a second source of
  -- truth. The real multi-source provenance lives in `contact_phone_sources` and is not
  -- reducible to one string; what the projection owes the legacy column is a value that is
  -- TRUE about a LIVE source, which is a weaker claim and an achievable one.
  --
  -- THE GUARD. If `contacts.phone_source` is not in 4O-E4's allowlist — `manual`, `unknown`,
  -- `apollo_search`, `provider_payload` or NULL — the tuple is left ENTIRELY alone. Not
  -- overwritten with the new primary, not cleared. This operation has no authority over that
  -- number: it may have been typed by a human, and 4O-E4's "FIX M1" is that a provider
  -- erasure never destroys curated data. Overwriting it with a provider number would be
  -- destroying it just as effectively as nulling it.

  IF NOT (COALESCE(BTRIM(v_contact.phone_source), '') = ANY (c_suppressible_legacy_sources)) THEN
    v_scalar_guarded := true;
  ELSE
    IF v_primary_id IS NOT NULL THEN
      SELECT p.display_phone, p.normalized_phone, p.phone_type
        INTO v_primary
      FROM public.contact_phones p
      WHERE p.id = v_primary_id;

      -- `resolveScalarPhoneFromCollection`, mirrored from 112: the display form is what the
      -- operator reads; the normalized form is the fallback when no display form was given.
      v_scalar      := COALESCE(v_primary.display_phone, v_primary.normalized_phone);
      v_scalar_type := v_primary.phone_type;

      -- Provenance comes from the most SPECIFIC **LIVE** source of the elected row. `AND
      -- s.suppressed_at IS NULL` is the whole point of §23: a scalar must never assert a
      -- provenance that has been withdrawn. When Apollo is erased and Lusha survives, this is
      -- what turns `apollo_reveal` into `lusha_reveal` in the same transaction.
      SELECT s.provider, s.acquisition_mode, s.raw_provider_type, s.observed_at
        INTO v_src
      FROM public.contact_phone_sources s
      WHERE s.contact_phone_id = v_primary_id
        AND s.suppressed_at IS NULL
      ORDER BY
        COALESCE(array_position(c_source_ranking, s.provider || ':' || s.acquisition_mode),
                 array_length(c_source_ranking, 1) + 1),
        s.observed_at DESC,
        s.id ASC
      LIMIT 1;

      IF FOUND THEN
        -- 112's mapping, verbatim. Nothing is invented: when the pair maps to no value the
        -- legacy vocabulary already uses, `unknown` is a truthful statement about SellUp's
        -- knowledge and an existing member of that vocabulary, not a guess dressed as a fact.
        v_scalar_source := CASE
          WHEN v_src.provider = 'apollo_cache'                              THEN 'apollo_cache'
          WHEN v_src.provider = 'lusha'                                     THEN 'lusha_reveal'
          WHEN v_src.provider = 'apollo' AND v_src.acquisition_mode
                 IN ('reveal', 'waterfall')                                 THEN 'apollo_reveal'
          WHEN v_src.provider = 'apollo' AND v_src.acquisition_mode = 'search'
                                                                            THEN 'apollo_search'
          WHEN v_src.provider = 'manual'                                    THEN 'manual'
          ELSE 'unknown'
        END;
        -- Metadata is re-derived from the SURVIVING source and never carried over. Keeping
        -- Apollo's raw label next to a Lusha provenance would be asserting a fact about an
        -- observation that has been withdrawn.
        v_scalar_raw_type    := v_src.raw_provider_type;
        v_scalar_revealed_at := v_src.observed_at;
      ELSE
        -- A live canonical row with no live provenance cannot exist after step 4; if it
        -- somehow did, `unknown` is the honest answer rather than picking a provider.
        v_scalar_source := 'unknown';
      END IF;
    END IF;

    -- `phone_processing_basis` and `phone_confidence` are NOT projected.
    --
    -- `phone_processing_basis` is a LEGAL basis recorded by the reveal that observed the
    -- number; the official model has no column holding it, so any value written here would be
    -- fabricated. It is CLEARED alongside the number it belonged to, exactly as 4O-E4's patch
    -- clears it, and re-established by the writer that actually knows it.
    --
    -- `phone_confidence` remains the dead column 4O-E4 found: no writer populates it. H2 does
    -- not start. It is cleared with the rest of the tuple and never invented.
    --
    -- `mobile_phone` is NOT in this UPDATE and must not be: it has no provenance column at
    -- all (4O-E4.1), so a provider-specific erasure cannot know whether the number came from
    -- the provider it is erasing or from a human. MOBILE_PHONE_PROVENANCE_PENDING stands.
    UPDATE public.contacts
       SET phone                  = v_scalar,
           phone_type             = v_scalar_type,
           phone_source           = v_scalar_source,
           phone_raw_type         = v_scalar_raw_type,
           phone_revealed_at      = v_scalar_revealed_at,
           phone_processing_basis = NULL,
           phone_confidence       = NULL
     WHERE id = p_contact_id
       -- The provenance predicate is re-asserted at write time against the value READ under
       -- the lock. Belt and braces: the row is locked, so it cannot have changed — and if the
       -- lock were ever lost, this matches zero rows instead of erasing a tuple nobody observed.
       AND phone_source IS NOT DISTINCT FROM v_contact.phone_source
       AND (
         phone IS DISTINCT FROM v_scalar
         OR phone_type IS DISTINCT FROM v_scalar_type
         OR phone_source IS DISTINCT FROM v_scalar_source
         OR phone_raw_type IS DISTINCT FROM v_scalar_raw_type
         OR phone_revealed_at IS DISTINCT FROM v_scalar_revealed_at
         OR phone_processing_basis IS NOT NULL
         OR phone_confidence IS NOT NULL
       );

    GET DIAGNOSTICS v_contact_rows = ROW_COUNT;
    v_scalar_synced := v_contact_rows > 0;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 7 — the envelope.
  -- ═══════════════════════════════════════════════════════════════
  -- Counts, booleans, a mechanical status and `primary_dedupe_key` — which is a SHA-256 by
  -- 114's design and never the number. NO phone number, NO display form, NO name, NO email
  -- leaves this function: an erasure that logged what it erased would be the leak it exists
  -- to prevent.
  --
  -- `already_suppressed` vs `suppressed` is decided by whether ANYTHING changed, so a
  -- repeated call is distinguishable from a first one WITHOUT being an error. `contact_settled`
  -- is the caller's single "the official surface of this contact is now consistent" signal.

  RETURN jsonb_build_object(
    'status',                       CASE
                                      WHEN v_sources_suppressed > 0
                                        OR v_tombstoned > 0
                                        OR v_contact_rows > 0
                                      THEN 'suppressed'
                                      ELSE 'already_suppressed'
                                    END,
    'sources_suppressed',           v_sources_suppressed,
    'phones_tombstoned',            v_tombstoned,
    'survivor_count',               v_survivor_count,
    'primary_dedupe_key',           v_primary_key,
    'primary_changed',              v_primary_key IS DISTINCT FROM v_previous_primary_key,
    'scalar_synced',                v_scalar_synced,
    'scalar_guarded_by_provenance', v_scalar_guarded,
    'contact_settled',              true
  );
END;
$function$;

COMMENT ON FUNCTION public.suppress_official_contact_phone_sources(
  uuid, text, text, text, text, uuid, timestamptz
) IS
  'AGENT2A-PHONE-REVEAL-4O-H2 — provider-specific privacy erasure over the OFFICIAL multi-phone model of migration 114, in ONE transaction. Withdraws the matching LIVE and SUPPRESSIBLE contact_phone_sources rows (tombstone of the suppression triad only — provenance is immutable by PRIVILEGE, not by intention), then tombstones every canonical contact_phones row left with no live provenance, then re-elects a primary ONLY when the incumbent stopped being live (incumbent stability: an erasure must not reshuffle a collection it did not erase), then re-projects the legacy contacts scalar tuple. Suppressibility is DERIVED, not invented: 112''s exhaustive (provider, acquisition_mode) → contacts.phone_source mapping composed with 4O-E4''s SUPPRESSIBLE_CONTACT_PHONE_SOURCES allowlist, so manual, unknown and (apollo, search) provenance survive BOTH an Apollo and a Lusha erasure. Re-election puts MANUAL provenance in a tier ABOVE the phone-type ladder (4O-H0), then reuses 112''s ranking rung for rung with dedupe_key as a total tie-break, so the physical row order never decides. Refuses with no_official_collection, writing NOTHING, when the contact has no contact_phones row — which is every contact in Production today, and what keeps 4O-E4 the sole owner of the legacy scalar until H3. The scalar is additionally left ENTIRELY untouched when contacts.phone_source is outside the legacy allowlist, so a manually curated number is neither cleared nor overwritten. NEVER deletes a row (deleting a tombstone would un-block the erased number), NEVER touches mobile_phone (no provenance column exists — 4O-E4.1), NEVER writes phone_confidence (a dead column H2 does not resurrect), and returns only counts, booleans and a SHA-256 dedupe key — never a phone number. Calls no provider, moves no credit, writes no usage log, reservation or waterfall row: the provider was already charged and privacy withholds the NUMBER, never the cost. SECURITY INVOKER on purpose, so it runs under 114''s grant ceiling and physically cannot DELETE a phone row or rewrite a provenance column.';

-- ═══════════════════════════════════════════════════════════════════
-- 3. EXECUTE privileges
-- ═══════════════════════════════════════════════════════════════════
--
-- PostgreSQL grants EXECUTE to PUBLIC on every new function. For an ERASURE function that
-- means reachability through PostgREST with the anon key, and the REACHABILITY is the defect
-- whether or not RLS would then reject the individual statements. So PUBLIC, `anon` and
-- `authenticated` are revoked explicitly and only `postgres` and `service_role` are granted —
-- the identical four-statement pattern 112 and 113 use for every privacy function.
--
-- `authenticated` is revoked and not granted for the same reason 114 gives the browser SELECT
-- and nothing else: a client must never be able to initiate an erasure. The authorisation
-- decision belongs to the server action, which is ADMIN-only.

REVOKE ALL ON FUNCTION public.suppress_official_contact_phone_sources(
  uuid, text, text, text, text, uuid, timestamptz
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.suppress_official_contact_phone_sources(
  uuid, text, text, text, text, uuid, timestamptz
) FROM anon;

REVOKE ALL ON FUNCTION public.suppress_official_contact_phone_sources(
  uuid, text, text, text, text, uuid, timestamptz
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.suppress_official_contact_phone_sources(
  uuid, text, text, text, text, uuid, timestamptz
) TO postgres, service_role;
