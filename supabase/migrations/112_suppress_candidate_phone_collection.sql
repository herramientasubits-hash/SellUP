-- Migration 112: propagation of a phone SUPPRESSION / DSAR to the canonical candidate
-- phone COLLECTION, with atomic re-election of the surviving primary
-- (Agente 2A · AGENT2A-PHONE-REVEAL-4O-E2)
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS
-- ═══════════════════════════════════════════════════════════════════
--
-- The DSAR path (`phone-cache-suppression-actions.ts`, APOLLO-PHONE-CACHE-1b) erases a
-- phone from four places: the cache row (tombstone), `contact_enrichment_candidates.phone`,
-- the `phone` block of that candidate's `enrichment_metadata`, and the official `contacts`
-- rows whose provenance proves they were created from one of those candidates.
--
-- Migration 109 added a FIFTH place and nothing told the DSAR about it:
--
--   contact_enrichment_candidate_phones
--
-- Today that table is empty in every environment, so the gap is not yet a live leak. It
-- becomes one the moment `ENABLE_PHONE_REVEAL_WATERFALL` resolves true and the 4O-C / 4O-D
-- writers start filling it, and the reachable state is this:
--
--   contact_enrichment_candidates.phone = NULL          ← the DSAR ran
--   contact_enrichment_candidate_phones:
--     +57…, mobile, suppressed_at IS NULL, is_primary   ← the DSAR never looked here
--
-- From there, migrations 110 and 111 do exactly what they were built to do. They read the
-- collection under the candidate lock, find a LIVE row with a number, elect it as primary,
-- and write its number back into the visible scalar. The erased number returns — not through
-- a bug in the erasure and not through a bug in the reveal, but through the seam between
-- them. This migration closes the seam: after a successful suppression it is not possible for
-- a suppressed number to still be live in the collection, and therefore not possible for the
-- reveal path to re-elect it.
--
-- ═══════════════════════════════════════════════════════════════════
-- TOMBSTONE, NEVER `DELETE`
-- ═══════════════════════════════════════════════════════════════════
--
-- The row survives the suppression WITHOUT the number:
--
--   normalized_phone → NULL      display_phone → NULL      phone_type → NULL
--   is_primary       → false     suppressed_at / _reason / _by → set
--   dedupe_key       → UNCHANGED
--
-- Deleting the row instead would un-block the number: `(candidate_id, dedupe_key)` is the
-- UNIQUE that makes the next observation collide with the tombstone instead of inserting a
-- fresh live row, so the row IS the block. Migration 109 withholds DELETE on the table for
-- this reason, and this function is SECURITY INVOKER precisely so it inherits that ceiling
-- rather than granting itself an exception (see below). The shape above is the same one
-- migration 109's `..._tombstone_is_empty` CHECK enforces and `applyCandidatePhoneSuppression`
-- computes in `phone-collection-core.ts`; if any of the three drifted, the CHECK would reject
-- the statement rather than let a "suppressed" row keep its number.
--
-- ⚠️ `dedupe_key` is deliberately NOT cleared, and that is a privacy trade-off stated rather
-- than glossed: it is an unsalted SHA-256 of a phone number, and the phone number space is
-- small enough to brute-force for anyone who already holds the row. It is not a
-- cryptographic control; it is what stops the number from remaining stored IN CLEAR while
-- still blocking re-insertion. The table-level privileges from 109 are what keep the rows out
-- of reach in the first place.
--
-- ═══════════════════════════════════════════════════════════════════
-- PROVENANCE IS PRESERVED, ON PURPOSE
-- ═══════════════════════════════════════════════════════════════════
--
-- `contact_enrichment_candidate_phone_sources` is NOT touched: not deleted, not updated.
-- Those rows carry no phone number by construction (provider and acquisition vocabularies,
-- the provider's raw type/status labels, SellUp's own opaque row ids, and a PII-free
-- `source_event_key`), so keeping them erases nothing personal. What they do carry is the
-- evidence that an observation happened and which operation paid for it — the record a
-- privacy operation has to be able to show afterwards. Migration 109 grants the service role
-- neither UPDATE nor DELETE on that table, so this function could not rewrite them even if it
-- tried; the guarantee is a privilege, not an intention.
--
-- ═══════════════════════════════════════════════════════════════════
-- THE TWO SUPPRESSION VOCABULARIES ARE NOT THE SAME VOCABULARY
-- ═══════════════════════════════════════════════════════════════════
--
-- `phone_reveal_cache.suppression_reason` / `phone_reveal_suppression_audit.reason_code`
-- (migration 099) record WHY the erasure was requested:
--
--   dsar_erasure_request · do_not_contact_request · legal_privacy_request
--   admin_privacy_correction · test_synthetic
--
-- `contact_enrichment_candidate_phones.suppression_reason` (migration 109) records WHO
-- exercised it:
--
--   data_subject_request · operator_request · provider_retraction
--
-- The two sets share ZERO values. Passing one through to the other would fail the CHECK on
-- every single row — which is the same class of defect as the 23514 that lost "Almacenes La
-- 14" on the Agente 1 side, arriving here through the same mistake of assuming two columns
-- with the same NAME hold the same VALUES. So this function accepts ONLY the 109 vocabulary
-- and rejects anything else with `invalid_input` before writing a byte. The translation lives
-- in one exhaustive pure function, `mapSuppressionReasonToCandidatePhoneReason()`, and a
-- pass-through is unrepresentable there.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHAT IS ATOMIC
-- ═══════════════════════════════════════════════════════════════════
--
-- INSIDE the function, therefore all-or-nothing:
--
--   * every tombstone in scope,
--   * the demotion of the previous primary,
--   * the promotion of exactly one surviving primary (or none),
--   * `contact_enrichment_candidates.phone`,
--   * `enrichment_metadata.phone`.
--
-- The invariants that follow, and that a caller can rely on after COMMIT:
--
--   * a tombstoned row is NEVER `is_primary`;
--   * `contact_enrichment_candidates.phone` is NEVER a tombstoned number;
--   * `phone` is NEVER NULL while an electable survivor exists;
--   * `enrichment_metadata.phone` always describes the SAME number as `phone`.
--
-- OUTSIDE, and unchanged by this migration: the cache tombstone, the `contacts` erasure and
-- the durable audit row. Those are separate statements in the existing DSAR flow and this
-- migration does not claim otherwise — see `phone-cache-suppression-actions.ts`, where the
-- cache tombstone is still written FIRST (so a later failure cannot leave the person
-- unblocked) and the audit is still attempted LAST and unconditionally (so a partial erasure
-- still leaves a trace). What changes is that the collection can no longer be the one place
-- that keeps a number nobody else kept.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY `SECURITY INVOKER`
-- ═══════════════════════════════════════════════════════════════════
--
-- Same argument as migrations 110 and 111, and it is load-bearing here rather than merely
-- consistent. The service role already holds every privilege this function uses. INVOKER
-- means it runs UNDER migration 109's ceiling, so it cannot DELETE a phone row (deleting a
-- tombstone would let the erased number back in) and cannot UPDATE a provenance row
-- (provenance whose writer can edit it is not provenance). A DEFINER function owned by
-- `postgres` would hand itself both, in the one operation whose entire purpose is erasure.
--
-- `search_path` is pinned and there is NO dynamic SQL: every column written is named
-- literally in the source below, so no caller can steer this function at a column it does
-- not name itself.
--
-- ═══════════════════════════════════════════════════════════════════
-- PRIVACY OF THE RETURN VALUE
-- ═══════════════════════════════════════════════════════════════════
--
-- Counts, booleans, a mechanical status, and `primary_dedupe_key` (a SHA-256 by 109's design,
-- never the number). No phone, no display form, no email, no name, no LinkedIn, no provider
-- person id. `detail` strings are closed literals naming WHICH FIELD was wrong, never its
-- value, and no exception message is built from a number.
--
-- ═══════════════════════════════════════════════════════════════════
-- SCOPE
-- ═══════════════════════════════════════════════════════════════════
--
-- Adds ONE function, ONE audit column and ONE CHECK. It does NOT alter the collection tables,
-- does NOT touch migrations 109/110/111, adds NO trigger, and backfills NOTHING: the
-- collection is empty in every environment, so there is no historical row to propagate a
-- suppression to. Nothing in this file activates a flag, calls a provider or moves a credit.
--
-- ✅ APPLIED IN PRODUCTION. Remote version 20260810163800 (2026-08-10), applied exactly once,
-- migration-first: it landed AHEAD of the code that calls it, so the function has existed with
-- zero callers ever since. Do NOT apply it again.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, the CHECK is guarded, CREATE OR REPLACE for the
-- function, and the REVOKE/GRANT block declares an end state.

-- ═══════════════════════════════════════════════════════════════════
-- 1. Audit counter — how many candidate-phone rows were tombstoned
-- ═══════════════════════════════════════════════════════════════════
-- The 4O-E0 audit noted that the durable audit row counts `candidates_cleared`,
-- `contacts_cleared` and `cache_rows_suppressed` and says NOTHING about the collection. With
-- the propagation wired but uncounted, "the DSAR succeeded" and "the DSAR reached the
-- collection" would be indistinguishable in the only record that survives the process.
--
-- A typed column rather than a key inside `metadata`: the other three counts are columns with
-- their own `>= 0` CHECK, and hiding the fourth in a free-form jsonb blob would make it the
-- one number nobody can constrain or query the same way.

ALTER TABLE public.phone_reveal_suppression_audit
  ADD COLUMN IF NOT EXISTS candidate_phone_rows_suppressed integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_suppression_audit_candidate_phone_rows_check'
  ) THEN
    ALTER TABLE public.phone_reveal_suppression_audit
      ADD CONSTRAINT phone_reveal_suppression_audit_candidate_phone_rows_check
      CHECK (candidate_phone_rows_suppressed >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.phone_reveal_suppression_audit.candidate_phone_rows_suppressed IS
  'AGENT2A-PHONE-REVEAL-4O-E2 — how many contact_enrichment_candidate_phones rows this suppression turned into tombstones, as reported by the database and never by the plan. Exists so that "the DSAR succeeded" and "the DSAR reached the canonical collection" stop being indistinguishable in the only record that survives the process. A count, never a number: it cannot hold a phone.';

-- ═══════════════════════════════════════════════════════════════════
-- 2. The propagation function
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.suppress_candidate_phone_collection(
  p_candidate_id               uuid,

  -- The run the caller resolved the candidate's ACCOUNT through. The collection table has no
  -- account column, and account scope is what makes this operation legitimate, so the run is
  -- re-asserted here under the lock exactly as the pre-4O-E2 candidate UPDATE did with
  -- `.eq('enrichment_run_id', …)` (FIX M2/M3). NULL means the caller could not resolve it and
  -- deliberately does not constrain — never that it constrained and matched.
  p_expected_enrichment_run_id uuid,

  -- 'all_candidate_phones' — every number this candidate has. This is what the DSAR flow
  --   asks for and the ONLY scope with a caller today: the existing erasure clears the
  --   candidate's phone outright, it does not target one of several numbers.
  -- 'exact_phone' — one number, addressed by its `dedupe_key`. It has NO production caller in
  --   4O-E2 and is not a speculative generalisation: partial suppression is the only way the
  --   re-election path (§ 8/§ 9 of the block) can be exercised at all, and the difference
  --   between "a survivor is promoted" and "everything is erased" is precisely what the
  --   tombstone-must-not-stay-primary invariant is about. Declared, tested, unwired.
  p_scope                      text,
  p_dedupe_key                 text,

  -- Migration 109's vocabulary and ONLY it. The cache/audit vocabulary is REJECTED here, and
  -- that rejection is the mapping contract enforced at the boundary instead of trusted.
  p_suppression_reason         text,

  -- `internal_users.id` of the operator. Opaque id, no PII, and NOT a foreign key on the
  -- collection table on purpose: an erasure record must survive user-row churn.
  p_suppressed_by              uuid,
  p_suppressed_at              timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  -- Type priority. IDENTICAL to CANDIDATE_PHONE_TYPE_RANKING in phone-collection-core.ts and
  -- to the same array in migrations 110/111. A divergence here would elect a different
  -- survivor than the pure layer would, and nothing would fail until a user saw the wrong
  -- number.
  c_type_ranking   text[] := ARRAY[
    'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
  ];

  -- Provenance specificity, mirroring SOURCE_SPECIFICITY_RANKING in phone-collection-core.ts:
  -- a paid reveal is the most specific observation, a cache read is an old reveal reused, and
  -- the type that comes free with a search is the weakest. Used ONLY as a tie-break, after
  -- type and status, exactly as `compareCandidatePhones` does.
  --
  -- The absolute values differ from TypeScript's by one (array_position is 1-based, the TS
  -- indexes are 0-based) and that is irrelevant: only the ORDER is read, never the number.
  c_source_ranking text[] := ARRAY[
    'apollo:reveal', 'lusha:reveal', 'apollo_cache:cache', 'apollo:search'
  ];

  -- Migration 109's CHECK, restated so a bad reason is `invalid_input` instead of a rollback
  -- that reports as an infrastructure failure.
  c_reasons        text[] := ARRAY[
    'data_subject_request', 'operator_request', 'provider_retraction'
  ];

  v_candidate            record;
  v_primary              record;
  v_src                  record;

  v_in_scope_count       integer := 0;
  v_already_suppressed   integer := 0;
  v_suppressed_count     integer := 0;
  v_survivor_count       integer := 0;
  v_demoted              integer := 0;
  v_promoted             integer := 0;
  v_candidate_rows       integer := 0;

  v_previous_primary_key text := NULL;
  v_primary_id           uuid := NULL;
  v_primary_key          text := NULL;
  v_scalar               text := NULL;
  v_meta_type            text := NULL;
  v_meta_raw_type        text := NULL;
  v_meta_source          text := NULL;
  v_next_metadata        jsonb;
  v_status               text;
BEGIN
  -- ═══════════════════════════════════════════════════════════════
  -- Step 0 — validation. Fail-closed, and BEFORE any write.
  -- ═══════════════════════════════════════════════════════════════

  IF p_candidate_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'candidate_id_missing');
  END IF;

  IF p_scope IS NULL OR p_scope NOT IN ('all_candidate_phones', 'exact_phone') THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'scope_unknown');
  END IF;

  IF p_scope = 'exact_phone'
     AND (p_dedupe_key IS NULL OR LENGTH(BTRIM(p_dedupe_key)) = 0) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'dedupe_key_missing');
  END IF;

  -- A key supplied alongside the wide scope is refused rather than ignored: silently widening
  -- a request that LOOKS targeted from one number to all of them is the kind of over-erasure
  -- a privacy operation must never perform by accident.
  IF p_scope = 'all_candidate_phones' AND p_dedupe_key IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'dedupe_key_not_allowed');
  END IF;

  -- The vocabulary gate. A caller passing `dsar_erasure_request` — the cache/audit value for
  -- the very same erasure — lands here, with nothing written.
  IF p_suppression_reason IS NULL
     OR NOT (p_suppression_reason = ANY (c_reasons)) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'suppression_reason_unknown');
  END IF;

  IF p_suppressed_at IS NULL THEN
    -- The tombstone's `suppressed_at` is what makes the row a tombstone at all: migration
    -- 109's CHECK reads it, and so does every "is this live" predicate in the subsystem.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'suppressed_at_missing');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 1 — LOCK the candidate.
  -- ═══════════════════════════════════════════════════════════════
  -- The same serialization point migrations 110 and 111 use, which is what makes this
  -- operation and the reveal writers mutually exclusive on a given candidate. Without it, a
  -- suppression and an in-flight persistence could each read a snapshot in which their own
  -- primary election was valid, and the loser would either fight the single-primary partial
  -- index or hand the scalar a number the other one had just erased.
  --
  -- Two concurrent suppressions of the SAME candidate serialize here too: the second one sees
  -- the tombstones the first committed and reports `already_suppressed` instead of
  -- re-tombstoning or resurrecting anything.

  SELECT c.id,
         c.phone,
         c.enrichment_metadata,
         c.enrichment_run_id,
         c.phone_reveal_error_code
    INTO v_candidate
  FROM public.contact_enrichment_candidates c
  WHERE c.id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'candidate_not_found', 'detail', 'candidate_missing'
    );
  END IF;

  IF p_expected_enrichment_run_id IS NOT NULL
     AND v_candidate.enrichment_run_id IS DISTINCT FROM p_expected_enrichment_run_id THEN
    -- The run is how the caller established the account scope. If the candidate is not in
    -- that run, this suppression has not proven it may touch this row.
    RETURN jsonb_build_object(
      'status', 'candidate_not_found', 'detail', 'enrichment_run_mismatch'
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 2 — what is in scope, and what is already a tombstone.
  -- ═══════════════════════════════════════════════════════════════
  -- Read AFTER the lock, so the counts cannot be invalidated by a concurrent transaction
  -- between here and the UPDATE.

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE p.suppressed_at IS NOT NULL)
    INTO v_in_scope_count, v_already_suppressed
  FROM public.contact_enrichment_candidate_phones p
  WHERE p.candidate_id = p_candidate_id
    AND (p_scope = 'all_candidate_phones' OR p.dedupe_key = p_dedupe_key);

  -- A targeted request whose target does not exist changes NOTHING — and in particular does
  -- not touch the scalar. The asymmetry with the wide scope is deliberate: erasing "this one
  -- number" when that number is not there must not fall through to erasing the visible phone
  -- of a candidate nobody asked about.
  IF p_scope = 'exact_phone' AND v_in_scope_count = 0 THEN
    RETURN jsonb_build_object(
      'status',                   'no_matching_phone_rows',
      'suppressed_count',         0,
      'already_suppressed_count', 0,
      'survivor_count',           (
        SELECT COUNT(*) FROM public.contact_enrichment_candidate_phones p
        WHERE p.candidate_id = p_candidate_id
          AND p.suppressed_at IS NULL
          AND p.normalized_phone IS NOT NULL
          AND p.phone_status <> 'invalid'
      ),
      'primary_dedupe_key',       (
        SELECT p.dedupe_key FROM public.contact_enrichment_candidate_phones p
        WHERE p.candidate_id = p_candidate_id AND p.is_primary
      ),
      'primary_changed',          false,
      'candidate_phone_cleared',  false,
      'candidate_updated',        false,
      'candidate_settled',        false
    );
  END IF;

  -- The primary as it stands, for `primary_changed`. Read before anything moves.
  SELECT p.dedupe_key INTO v_previous_primary_key
  FROM public.contact_enrichment_candidate_phones p
  WHERE p.candidate_id = p_candidate_id AND p.is_primary;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 3 — TOMBSTONE the rows in scope.
  -- ═══════════════════════════════════════════════════════════════
  -- `suppressed_at IS NULL` in the WHERE is what makes a repeated DSAR idempotent: a row that
  -- is already a tombstone is not matched, so it cannot have its `suppressed_at`,
  -- `suppression_reason` or `suppressed_by` rewritten by a later erasure — and, far more
  -- importantly, cannot be handed anything back.
  --
  -- Every column that could identify the person is set to NULL in the SAME statement that
  -- sets `suppressed_at`. Splitting them would create a window in which a row claims to be
  -- suppressed while still holding the number; migration 109's `..._tombstone_is_empty` CHECK
  -- would reject that window anyway, which is the point — the constraint and this statement
  -- agree, so there is no ordering to get wrong.

  UPDATE public.contact_enrichment_candidate_phones
     SET normalized_phone   = NULL,
         display_phone      = NULL,
         phone_type         = NULL,
         is_primary         = false,
         suppressed_at      = p_suppressed_at,
         suppression_reason = p_suppression_reason,
         suppressed_by      = p_suppressed_by
   WHERE candidate_id = p_candidate_id
     AND suppressed_at IS NULL
     AND (p_scope = 'all_candidate_phones' OR dedupe_key = p_dedupe_key);

  GET DIAGNOSTICS v_suppressed_count = ROW_COUNT;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 4 — elect the best SURVIVING primary.
  -- ═══════════════════════════════════════════════════════════════
  -- Eligibility is migration 109's `..._primary_requires_live_number` CHECK, restated:
  -- alive, numbered, not asserted invalid. It is also exactly
  -- `isCandidatePhoneEligibleForPrimary()`, so a row this query accepts is never one the
  -- database would then reject.
  --
  -- The ORDER BY is `compareCandidatePhones()`, escalón por escalón:
  --   1. best PhoneType
  --   2. `valid` over `unknown`
  --   3. most specific provenance (reveal > cache > search)
  --   4. most recent `last_seen_at`
  --   5. `dedupe_key` ascending — always present and unique, so the comparator is total and
  --      the arrival order of the provider's array never participates in any step.

  SELECT p.id, p.dedupe_key, p.display_phone, p.normalized_phone, p.phone_type
    INTO v_primary
  FROM public.contact_enrichment_candidate_phones p
  WHERE p.candidate_id = p_candidate_id
    AND p.suppressed_at IS NULL
    AND p.normalized_phone IS NOT NULL
    AND p.phone_status <> 'invalid'
  ORDER BY
    COALESCE(array_position(c_type_ranking, p.phone_type),
             array_length(c_type_ranking, 1) + 1),
    CASE p.phone_status WHEN 'valid' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END,
    COALESCE((
      SELECT MIN(COALESCE(
               array_position(c_source_ranking, s.provider || ':' || s.acquisition_mode),
               array_length(c_source_ranking, 1) + 1))
      FROM public.contact_enrichment_candidate_phone_sources s
      WHERE s.candidate_phone_id = p.id
    ), array_length(c_source_ranking, 1) + 1),
    p.last_seen_at DESC,
    p.dedupe_key ASC
  LIMIT 1;

  IF FOUND THEN
    v_primary_id  := v_primary.id;
    v_primary_key := v_primary.dedupe_key;
    -- `resolveScalarPhoneFromCollection`, mirrored: the display form is what the operator
    -- reads, and the normalized form is the fallback when the provider gave no display form.
    v_scalar      := COALESCE(v_primary.display_phone, v_primary.normalized_phone);
    v_meta_type   := v_primary.phone_type;
  END IF;

  SELECT COUNT(*) INTO v_survivor_count
  FROM public.contact_enrichment_candidate_phones p
  WHERE p.candidate_id = p_candidate_id
    AND p.suppressed_at IS NULL
    AND p.normalized_phone IS NOT NULL
    AND p.phone_status <> 'invalid';

  -- ═══════════════════════════════════════════════════════════════
  -- Step 5 — exactly one primary, or none.
  -- ═══════════════════════════════════════════════════════════════
  -- Demote first, promote second. The partial unique index does not tolerate two primaries
  -- even for an instant, and this order needs no window.

  IF v_primary_id IS NOT NULL THEN
    UPDATE public.contact_enrichment_candidate_phones
       SET is_primary = false
     WHERE candidate_id = p_candidate_id
       AND is_primary
       AND id <> v_primary_id;
    GET DIAGNOSTICS v_demoted = ROW_COUNT;

    UPDATE public.contact_enrichment_candidate_phones
       SET is_primary = true
     WHERE id = v_primary_id
       AND NOT is_primary;
    GET DIAGNOSTICS v_promoted = ROW_COUNT;
  ELSE
    -- Nothing electable is left. Defence in depth rather than a live path: migration 109's
    -- CHECK already makes "primary and not electable" unrepresentable, so a primary can only
    -- exist while an electable row exists, and step 3 cleared `is_primary` on everything it
    -- tombstoned. This statement therefore normally affects zero rows — and if the invariant
    -- were ever violated, it repairs it instead of leaving a primary pointing at a number no
    -- one may use.
    UPDATE public.contact_enrichment_candidate_phones
       SET is_primary = false
     WHERE candidate_id = p_candidate_id
       AND is_primary;
    GET DIAGNOSTICS v_demoted = ROW_COUNT;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 6 — the metadata block for the survivor, from PROVENANCE.
  -- ═══════════════════════════════════════════════════════════════
  -- `enrichment_metadata.phone` must describe the SAME number as the scalar. `number` and
  -- `type` come from the elected row; `source` and `raw_type` come from that row's most
  -- SPECIFIC provenance, which is the only place the provider's own label survived.
  --
  -- Nothing is invented. When the provenance cannot be mapped to one of the phone-source
  -- values the subsystem already uses, `source` is `'unknown'` — which is a truthful
  -- statement about SellUp's knowledge and an existing member of that vocabulary, not a
  -- guess dressed as a fact. `raw_type` stays NULL when no provider label was recorded.

  IF v_primary_id IS NOT NULL THEN
    SELECT s.provider, s.acquisition_mode, s.raw_provider_type
      INTO v_src
    FROM public.contact_enrichment_candidate_phone_sources s
    WHERE s.candidate_phone_id = v_primary_id
    ORDER BY
      COALESCE(array_position(c_source_ranking, s.provider || ':' || s.acquisition_mode),
               array_length(c_source_ranking, 1) + 1),
      s.observed_at DESC,
      s.id ASC
    LIMIT 1;

    IF FOUND THEN
      v_meta_raw_type := v_src.raw_provider_type;
      v_meta_source := CASE
        WHEN v_src.provider = 'apollo_cache'                              THEN 'apollo_cache'
        WHEN v_src.provider = 'lusha'                                     THEN 'lusha_reveal'
        WHEN v_src.provider = 'apollo' AND v_src.acquisition_mode
               IN ('reveal', 'waterfall')                                 THEN 'apollo_reveal'
        WHEN v_src.provider = 'apollo' AND v_src.acquisition_mode = 'search'
                                                                          THEN 'apollo_search'
        WHEN v_src.provider = 'manual'                                    THEN 'manual'
        ELSE 'unknown'
      END;
    ELSE
      -- A canonical row with no provenance at all. It should not happen through any wired
      -- writer, and saying `unknown` is the honest answer rather than picking a provider.
      v_meta_source := 'unknown';
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 7 — the candidate scalar and its metadata.
  -- ═══════════════════════════════════════════════════════════════
  -- No survivor ⇒ the whole logical `phone` block is removed from the metadata and the scalar
  -- becomes NULL. `- 'phone'` is `delete next.phone` in `stripPhoneFromEnrichmentMetadata()`,
  -- key for key: relevance, completion and the provider traces are all preserved, and ONLY
  -- the personal datum disappears.

  IF v_primary_id IS NULL THEN
    v_next_metadata := COALESCE(v_candidate.enrichment_metadata, '{}'::jsonb) - 'phone';
  ELSE
    v_next_metadata := jsonb_set(
      COALESCE(v_candidate.enrichment_metadata, '{}'::jsonb),
      '{phone}',
      jsonb_build_object(
        'number',   v_scalar,
        'type',     v_meta_type,
        'source',   v_meta_source,
        'raw_type', v_meta_raw_type
      ),
      true
    );
  END IF;

  -- `phone_reveal_error_code = NULL` reproduces `CandidatePhoneSuppressionPatch` byte for
  -- byte: it is what the pre-4O-E2 erasure wrote, and this block is not authorized to change
  -- what a DSAR does to the reveal audit columns. The rest of that audit — status, provider,
  -- processing basis — is deliberately left alone: it is not PII and it documents that a
  -- treatment took place.
  --
  -- The WHERE only matches when something would actually CHANGE, so `ROW_COUNT` is a fact
  -- about the data and not about the statement. That is what lets a repeated DSAR be reported
  -- as `already_suppressed` instead of as a second successful erasure.
  UPDATE public.contact_enrichment_candidates
     SET phone                   = v_scalar,
         enrichment_metadata     = v_next_metadata,
         phone_reveal_error_code = NULL
   WHERE id = p_candidate_id
     AND (
       phone IS DISTINCT FROM v_scalar
       OR COALESCE(enrichment_metadata, '{}'::jsonb) IS DISTINCT FROM v_next_metadata
       OR phone_reveal_error_code IS NOT NULL
     );

  GET DIAGNOSTICS v_candidate_rows = ROW_COUNT;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 8 — mechanical verdict.
  -- ═══════════════════════════════════════════════════════════════
  -- `suppressed` when this call CHANGED something; `already_suppressed` when the desired end
  -- state was already in place. Reporting the second as a success would make an idempotent
  -- retry indistinguishable from a first erasure in the audit.

  IF v_suppressed_count > 0
     OR v_candidate_rows > 0
     OR v_demoted > 0
     OR v_promoted > 0 THEN
    v_status := 'suppressed';
  ELSE
    v_status := 'already_suppressed';
  END IF;

  RETURN jsonb_build_object(
    'status',                   v_status,
    'suppressed_count',         v_suppressed_count,
    'already_suppressed_count', v_already_suppressed,
    'survivor_count',           v_survivor_count,
    'primary_dedupe_key',       v_primary_key,
    'primary_changed',          v_primary_key IS DISTINCT FROM v_previous_primary_key,
    'candidate_phone_cleared',  v_scalar IS NULL,
    'candidate_updated',        v_candidate_rows > 0,
    -- The candidate was reached, locked and left in the state the suppression asked for.
    -- Distinct from `candidate_updated`, which is false on an idempotent repeat.
    'candidate_settled',        true
  );
END $$;

COMMENT ON FUNCTION public.suppress_candidate_phone_collection(
  uuid, uuid, text, text, text, uuid, timestamptz
) IS
  'AGENT2A-PHONE-REVEAL-4O-E2 — propagates a phone suppression / DSAR into contact_enrichment_candidate_phones in ONE transaction: tombstones the rows in scope, demotes the old primary, promotes exactly one surviving primary (or none), and syncs contact_enrichment_candidates.phone and enrichment_metadata.phone to THAT survivor. Exists because the erasure cleared the candidate scalar, the cache and the contacts but never the canonical collection, leaving a live is_primary row that migrations 110/111 would re-elect — putting the erased number back in the visible field through the seam between the two operations. Tombstone, never DELETE: the row keeps its dedupe_key (that UNIQUE is what blocks re-insertion) and loses normalized_phone, display_phone, phone_type and is_primary, exactly as migration 109 tombstone_is_empty CHECK requires. contact_enrichment_candidate_phone_sources is NOT touched: it holds no phone number and it is the evidence the observation happened. Accepts ONLY migration 109 suppression vocabulary (data_subject_request / operator_request / provider_retraction) and REJECTS the cache/audit vocabulary, because the two sets share zero values and a pass-through would fail the CHECK on every row. Locks the candidate with SELECT FOR UPDATE, so two concurrent suppressions serialize and a suppression cannot interleave with a reveal persistence. Idempotent: a row that is already a tombstone is never matched, never rewritten and never resurrected, and a repeat returns already_suppressed. Scope all_candidate_phones is the only one with a caller; exact_phone is declared and tested but unwired. SECURITY INVOKER on purpose so migration 109 privilege ceiling still applies — it cannot DELETE a phone row or UPDATE a provenance row. No dynamic SQL, every written column named literally. Writes NO cache row, NO contacts row, NO audit row, NO usage log and NO reservation. Returns counts, flags and a SHA-256 dedupe key — never a phone number. Service-role only.';

-- ═══════════════════════════════════════════════════════════════════
-- 3. Execution privileges
-- ═══════════════════════════════════════════════════════════════════
-- PostgreSQL grants EXECUTE on a new function to PUBLIC. Left alone, that makes an ERASURE
-- function reachable through PostgREST with the anon key — the argument from migration 104
-- § 9 applies unchanged, and with more force here: the reachability is the defect, whether or
-- not RLS would then reject the statements. `postgres` is included alongside `service_role`
-- because migrations and maintenance run as the owner.

REVOKE ALL ON FUNCTION public.suppress_candidate_phone_collection(
  uuid, uuid, text, text, text, uuid, timestamptz
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.suppress_candidate_phone_collection(
  uuid, uuid, text, text, text, uuid, timestamptz
) FROM anon;

REVOKE ALL ON FUNCTION public.suppress_candidate_phone_collection(
  uuid, uuid, text, text, text, uuid, timestamptz
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.suppress_candidate_phone_collection(
  uuid, uuid, text, text, text, uuid, timestamptz
) TO postgres, service_role;
