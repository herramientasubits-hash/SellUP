-- Migration 122: "Buscar más números" — an EXPLICIT paid search for ADDITIONAL phones
-- (Agente 2A · AGENT2A-SEARCH-MORE-PHONES-1)
--
-- ═══════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION IS FOR
-- ═══════════════════════════════════════════════════════════════════
--
-- SellUp already has two phone operations and they are NOT this one:
--
--   * "Revelar teléfono"  — the candidate has NO phone. Apollo, then conditionally
--     Lusha. Governed by `run_mode` `full_waterfall`.
--   * "Ver más números"   — read-only. Opens the phones ALREADY stored. Zero provider
--     calls, zero credits. It touches nothing in this migration.
--
-- "Buscar más números" is a THIRD operation: the candidate ALREADY has a visible
-- phone, and the operator explicitly asks SellUp to consult LUSHA — the one provider
-- whose native identity the candidate row already carries and which has not yet been
-- asked — in order to APPEND numbers the collection does not have. It can cost
-- credits, so it is authorized like every other paid reveal — a run, a reservation, a
-- privacy gate — and it is never triggered by a background process.
--
-- v1 IS LUSHA-ONLY, AND THAT IS A CAPABILITY FACT, NOT A PHASING DECISION. There is no
-- Apollo Search More leg anywhere in this migration or in the application layer: Apollo's
-- terminal payload is already persisted in full (see the provider-capability note below),
-- so an Apollo leg here would reserve a budget pool for a charge no branch can make. The
-- ceiling of a Search More authorization is therefore ALWAYS 5 — one Lusha leg — never the
-- 8 of an Apollo leg and never the 13 of a full waterfall.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY `search_more` IS A NEW `run_mode` AND NOT A REUSED ONE
-- ═══════════════════════════════════════════════════════════════════
--
-- `legacy_lusha_only` (migration 103) is the closest existing modality and it is
-- deliberately NOT reused. Its entry condition is the exact OPPOSITE of this one:
-- `evaluatePhoneRevealWaterfallLegacyEligibility` requires
-- `phone_reveal_status = 'no_phone_found'` and refuses a candidate that already has a
-- phone (`existing_phone_present`). A Search More run starts from
-- `phone_reveal_status = 'revealed'`. Overloading one value to mean both would make
-- every audit query that asks "was Apollo exhausted for this candidate?" answer wrong,
-- and it would make the two ceilings indistinguishable in the ledger.
--
-- `full_waterfall` is not reusable either: it authorizes an APOLLO leg, and this
-- operation never calls Apollo again (see the provider-capability note below).
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY THERE IS A SECOND WRITER, AND WHY IT IS NOT A COMPETING ONE
-- ═══════════════════════════════════════════════════════════════════
--
-- `persist_candidate_lusha_phone_reveal_result` (migration 111, restated by 120) already
-- merges a Lusha response into the collection append-safely: it keeps a number the other
-- provider stored, gives it a second provenance row, and elects a new primary only on a
-- STRICT improvement. Every one of those properties is exactly what Search More needs,
-- and NONE of them is re-implemented here.
--
-- What that function ALSO does, unconditionally, is write the candidate's TERMINAL
-- reveal state: `phone_reveal_provider`, `phone_reveal_request_id`, `phone_revealed_at`,
-- `phone_reveal_cost_credits`, `phone_reveal_cost_source`, `phone_reveal_attempt_count`.
-- On its own path that is correct — it IS the transaction that closes the reveal. On a
-- Search More run it is FALSE and destructive:
--
--   * the candidate was revealed by APOLLO and, when Lusha only returns a lower-ranked
--     number, the visible phone is STILL Apollo's. Writing
--     `phone_reveal_provider = 'lusha'` would attribute a number to a provider that did
--     not produce it;
--   * `phone_reveal_cost_credits` would be OVERWRITTEN with the Lusha leg's figure,
--     erasing what the Apollo reveal actually cost. The per-leg truth lives in
--     `phone_reveal_waterfall_runs`, but the candidate mirror would now contradict it.
--
-- The caller cannot avoid this by choosing parameters, because whether the incumbent is
-- retained is decided UNDER THE LOCK, after the caller has already passed its arguments.
-- So the distinction has to live inside a function.
--
-- Section 3 therefore adds `append_candidate_search_more_phones`: the same collection
-- semantics, minus the terminal patch. It is STRICTLY SMALLER than the reveal writer —
-- no ownership token, no status/provider validation, no request-id clearing, no attempt
-- counter, no legacy scalar fallback — because a Search More run has no reveal lifecycle
-- to close. The candidate is already terminal; this transaction adds numbers to a
-- collection, it does not restate a conclusion.
--
-- Rewriting migration 120's 800-line function to carry a flag was the alternative and it
-- was rejected: it would put the entire existing reveal path back under test to buy a
-- branch that only one caller takes.
--
-- ═══════════════════════════════════════════════════════════════════
-- PROVIDER CAPABILITY — WHY NO PROVIDER IS EVER CALLED TWICE
-- ═══════════════════════════════════════════════════════════════════
--
-- This is a data-model consequence, so it is recorded here and not only in the
-- application layer.
--
-- Apollo's terminal payload carries EVERY phone Apollo holds, in up to three locations,
-- and since 4O-C `apollo-phone-collection-capture.ts` persists all of them. Lusha's
-- `/v3/contacts/enrich` with `reveal: ['phones']` returns `results[0].phones[]` and since
-- 4O-D `lusha-phone-fallback-phones.ts` reads the whole array. Neither provider exposes
-- an "additional phones" operation, and neither response is a page of a larger set.
--
-- Therefore calling a provider that already answered for this candidate would charge
-- again to receive the payload already stored. That is what makes Apollo structurally
-- ineligible for this operation and leaves exactly one consultable provider: LUSHA, and
-- only when the candidate row declares `source = 'lusha'` + `source_contact_id`, which is
-- Lusha's provider-NATIVE contact id.
--
-- There is no name+company search, no email lookup, no LinkedIn lookup, no fuzzy linkage,
-- no cross-provider identity inference and NO path to Lusha's general person search:
-- Phase 2 is untouched.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION DOES NOT DO
-- ═══════════════════════════════════════════════════════════════════
--
--   * does NOT insert, update or delete a single row (no backfill, no data migration)
--   * does NOT create or alter a TABLE, a column, an index, an RLS policy or a trigger
--   * does NOT modify migrations 120 or 121, and does not re-declare their functions
--   * does NOT touch `provider_suppressions`, `provider_suppression_audit`,
--     `phone_reveal_cache`, `phone_reveal_credit_reservations`, `provider_usage_logs`
--     or `wizard_monthly_budget_periods`
--   * does NOT relax any suppression rule. The person-level and number-level tombstone
--     re-checks of 4O-E3 / #295 are carried into the new function VERBATIM, including
--     the call to `phone_reveal_candidate_suppression_exists`
--   * does NOT widen `phone_reveal_waterfall_runs.status`: a Search More run uses
--     `authorized` → `lusha_running` → `completed_lusha` / `exhausted`, all of which
--     migration 102 already defines
--   * does NOT call a provider, reveal a phone, spend a credit or approve a candidate
--   * contains NO phone, email, name, LinkedIn URL or provider contact id
--
-- Safety: strictly additive. Exactly TWO CHECK vocabularies are widened — `run_mode` and
-- `lusha_outcome` — and one function is created. `lusha_skipped_reason` is deliberately NOT
-- widened: a Search More run is refused by the planner BEFORE any run row is created, so
-- no row would ever carry a "providers exhausted" skip reason, and adding a value nothing
-- writes would be vocabulary for its own sake. The CHECKs are widened with `NOT VALID` + `VALIDATE CONSTRAINT`, which is the
-- convention for a table that already holds rows (migrations 095/097/100/101): the
-- rewrite is cheap and the validation scan is separated from it. Idempotent: every
-- statement is guarded, so the migration can be re-run without error.
--
-- Privacy: PII-free by construction. The new function receives numbers in `p_phones` and
-- returns only counts, flags and a SHA-256 dedupe key — never a phone number.

-- ═══════════════════════════════════════════════════════════════════
-- 1. `run_mode` — the new modality
-- ═══════════════════════════════════════════════════════════════════
-- Mirror of PHONE_REVEAL_WATERFALL_RUN_MODES in
-- src/modules/contact-enrichment/phone-reveal-waterfall-core.ts. A static test compares
-- the two lists in BOTH directions, so a modality cannot be added on one side only.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_waterfall_runs_run_mode_check'
  ) THEN
    ALTER TABLE public.phone_reveal_waterfall_runs
      DROP CONSTRAINT phone_reveal_waterfall_runs_run_mode_check;
  END IF;

  ALTER TABLE public.phone_reveal_waterfall_runs
    ADD CONSTRAINT phone_reveal_waterfall_runs_run_mode_check
    CHECK (
      run_mode IN (
        -- Apollo then (conditionally) Lusha, both inside this authorization. Ceiling 13.
        'full_waterfall',
        -- Apollo already ran historically and returned `no_phone_found` before the runs
        -- table existed. ONLY the Lusha leg is authorized. Ceiling 5.
        'legacy_lusha_only',
        -- AGENT2A-SEARCH-MORE-PHONES-1. The candidate ALREADY has a stored phone and the
        -- operator explicitly authorized consulting LUSHA for ADDITIONAL numbers. ONLY
        -- the Lusha leg is authorized (ceiling 5 — never 8, never 13), Apollo is never
        -- re-called, and the existing phone is never replaced or deleted.
        'search_more'
      )
    ) NOT VALID;

  ALTER TABLE public.phone_reveal_waterfall_runs
    VALIDATE CONSTRAINT phone_reveal_waterfall_runs_run_mode_check;
END $$;

COMMENT ON COLUMN public.phone_reveal_waterfall_runs.run_mode IS
  'Modality of the authorization: full_waterfall (Apollo then conditionally Lusha, ceiling 13) | legacy_lusha_only (Apollo already returned no_phone_found historically; ONLY the Lusha leg, ceiling 5, Apollo never re-called) | search_more (AGENT2A-SEARCH-MORE-PHONES-1: the candidate ALREADY has a stored phone and the operator authorized consulting LUSHA for ADDITIONAL numbers; Lusha-only, ceiling ALWAYS 5, Apollo never re-called, the existing collection is never replaced). Directly queryable so an audit never infers the modality from apollo_attempted_at IS NULL. The three are mutually exclusive and none is a relabelling of another: legacy_lusha_only requires the candidate to have NO phone, search_more requires it to HAVE one.';

-- ═══════════════════════════════════════════════════════════════════
-- 2. `lusha_outcome` — telling "no new number" from "no number"
-- ═══════════════════════════════════════════════════════════════════
-- A Search More leg has an outcome the reveal path cannot produce: Lusha DID answer with
-- phones, was charged for answering, and every number it returned was already stored.
--
-- Recording that as `no_phone_found` would be a lie in the ledger — it asserts the
-- provider holds no phone for this person, when in fact it holds the same one — and it
-- would make the operator's copy wrong in the one direction that matters: "no encontramos
-- números adicionales" is true, "este contacto no tiene teléfono" is false. Recording it
-- as `revealed` would be equally wrong: nothing was revealed that SellUp did not have.
--
-- So the vocabulary gains the honest third value instead of borrowing a dishonest one.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_waterfall_runs_lusha_outcome_check'
  ) THEN
    ALTER TABLE public.phone_reveal_waterfall_runs
      DROP CONSTRAINT phone_reveal_waterfall_runs_lusha_outcome_check;
  END IF;

  ALTER TABLE public.phone_reveal_waterfall_runs
    ADD CONSTRAINT phone_reveal_waterfall_runs_lusha_outcome_check
    CHECK (
      lusha_outcome IS NULL
      OR lusha_outcome IN (
        'revealed',
        'no_phone_found',
        'error',
        -- AGENT2A-SEARCH-MORE-PHONES-1. Lusha answered and was charged, but every number
        -- it returned was ALREADY in the collection, so the run added nothing distinct.
        -- Never collapsed into `no_phone_found`: the provider does hold a phone.
        'no_new_distinct_phone'
      )
    ) NOT VALID;

  ALTER TABLE public.phone_reveal_waterfall_runs
    VALIDATE CONSTRAINT phone_reveal_waterfall_runs_lusha_outcome_check;
END $$;

COMMENT ON COLUMN public.phone_reveal_waterfall_runs.lusha_outcome IS
  'Outcome of the Lusha leg: revealed | no_phone_found | error | no_new_distinct_phone. The last one (AGENT2A-SEARCH-MORE-PHONES-1) means Lusha ANSWERED and was charged but every number it returned was already stored — it is never collapsed into no_phone_found, which asserts the provider has no phone at all, nor into revealed, which asserts SellUp gained a number it did not have.';

-- ═══════════════════════════════════════════════════════════════════
-- 3. `append_candidate_search_more_phones`
-- ═══════════════════════════════════════════════════════════════════
--
-- ONE transaction that APPENDS a provider response to a collection that already has a
-- terminal reveal behind it. See the header for why this is not the reveal writer.
--
-- WHAT IT KEEPS from migration 120's writer, deliberately unchanged:
--
--   * `SELECT … FOR UPDATE` on the candidate, so a Search More run and a concurrent
--     erasure serialize instead of interleaving;
--   * `phone_reveal_candidate_suppression_exists` re-checked INSIDE the lock — the
--     person-level guarantee of #295 / M120. The application gate reads BEFORE the
--     provider call and OUTSIDE this lock, so it cannot own this;
--   * the per-number tombstone guard, restated in the `ON CONFLICT … WHERE` clause where
--     it is enforced rather than merely intended;
--   * `aggregateCandidatePhoneStatus` / `aggregateCandidatePhoneType`, mirrored exactly,
--     so a refreshed row aggregates the same way the pure layer computed it;
--   * one primary only, elected on a STRICT improvement over the live incumbent.
--
-- WHAT IT DROPS, and why each is right for this operation:
--
--   * the terminal patch — the candidate's reveal already closed. Restating it would
--     re-attribute an Apollo number to Lusha and overwrite Apollo's recorded cost;
--   * the ownership token (`p_expected_phone_reveal_status`) — there is no reveal
--     lifecycle to own here. The Search More run's own atomic claim
--     (`lusha_attempted_at IS NULL`, migration 102) is what makes the leg run at most
--     once, and it is taken BEFORE the provider call, not here;
--   * the legacy scalar fallback — a Search More run starts from a candidate that already
--     HAS a visible phone. If nothing electable arrives, the correct action is to change
--     nothing, not to install a fallback number.
--
-- SECURITY INVOKER on purpose, exactly like 110/111/120: the privilege ceiling of
-- migration 109 still applies, so this function CANNOT delete a phone row (deleting one
-- deletes a tombstone) and CANNOT update a provenance row.
--
-- Writes NO usage log, NO reservation and NO waterfall row. That accounting lives in
-- `phone_reveal_waterfall_runs` / `phone_reveal_credit_reservations` /
-- `provider_usage_logs` and must survive a failure this function reports.

CREATE OR REPLACE FUNCTION public.append_candidate_search_more_phones(
  p_candidate_id       uuid,
  p_observed_at        timestamptz,
  -- The canonical collection the pure layer built from the provider response.
  p_phones             jsonb,
  p_sources            jsonb,
  -- Primary candidates IN ORDER OF PREFERENCE, each carrying the scalar triple for THAT
  -- key. Pairing key and scalar is what makes "primary MOBILE / scalar DIRECT" divergence
  -- structurally impossible: whichever key this function elects, it writes THAT scalar.
  p_primary_candidates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  -- IDENTICAL to CANDIDATE_PHONE_TYPE_RANKING in phone-collection-core.ts and to the
  -- copies in migrations 110/111/120. A divergence here would rank the incumbent on a
  -- different scale than the pure layer used.
  c_type_ranking       text[] := ARRAY[
    'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
  ];

  v_candidate          record;
  v_row                record;
  v_src                record;
  v_pref               record;

  v_incoming_count     integer := 0;
  v_suppressed_count   integer := 0;
  v_existing_live      integer := 0;
  v_inserted_count     integer := 0;
  v_updated_count      integer := 0;
  v_source_count       integer := 0;
  v_affected           integer := 0;

  v_phone_id           uuid;
  v_chosen_id          uuid    := NULL;
  v_chosen_key         text    := NULL;
  v_chosen_phone       text    := NULL;
  v_chosen_type        text    := NULL;
  v_chosen_raw_type    text    := NULL;
  v_chosen_rank        integer := NULL;
  v_chosen_status_rank integer := NULL;

  v_inc_id             uuid    := NULL;
  v_inc_key            text    := NULL;
  v_inc_rank           integer := NULL;
  v_inc_status_rank    integer := NULL;

  v_primary_id         uuid    := NULL;
  v_primary_key        text    := NULL;
  v_scalar_updated     boolean := false;
  v_scalar             text    := NULL;
  v_meta_type          text    := NULL;
  v_meta_raw_type      text    := NULL;
  v_phone_meta         jsonb;
BEGIN
  -- ── Step 0 — shape validation, fail-closed, nothing written ────
  IF p_candidate_id IS NULL OR p_observed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'missing_identity');
  END IF;

  IF p_phones IS NULL OR jsonb_typeof(p_phones) <> 'array'
     OR p_sources IS NULL OR jsonb_typeof(p_sources) <> 'array'
     OR p_primary_candidates IS NULL OR jsonb_typeof(p_primary_candidates) <> 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'collection_malformed');
  END IF;

  v_incoming_count := jsonb_array_length(p_phones);

  IF v_incoming_count = 0 THEN
    -- The provider answered with no numbers at all. Nothing to append and nothing to
    -- decide; reported as its own status so the caller does not have to read a zero count
    -- to learn it. This is NOT `no_new_distinct_phone`: the two are different facts and
    -- the run records them differently.
    RETURN jsonb_build_object(
      'status',                   'no_incoming_phones',
      'inserted_phone_count',     0,
      'updated_phone_count',      0,
      'inserted_source_count',    0,
      'suppressed_skipped_count', 0,
      'new_distinct_phone_count', 0,
      'primary_dedupe_key',       NULL,
      'primary_set',              false,
      'candidate_scalar_updated', false
    );
  END IF;

  -- ── Step 1 — lock the candidate ────────────────────────────────
  -- Every check below is deliberately AFTER this, so nothing is decided on a snapshot a
  -- concurrent transaction can invalidate.

  SELECT c.id, c.enrichment_metadata
    INTO v_candidate
  FROM public.contact_enrichment_candidates c
  WHERE c.id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'candidate_not_eligible', 'detail', 'candidate_not_found');
  END IF;

  -- ── Step 2 — PERSON-level suppression, re-checked UNDER the lock ──
  -- Carried verbatim from migration 120 § 8.2. A DSAR erases a PERSON; a number this
  -- provider never returned before has no tombstone to match, so the number-level check
  -- below would wave it through and the erased person would have a live phone again.
  --
  -- The provider was already called and already charged by the time this runs. This step
  -- withholds the NUMBER, never the cost: no usage log, reservation or run row is written
  -- from inside this function, so the spend survives exactly as recorded.

  IF public.phone_reveal_candidate_suppression_exists(p_candidate_id, NULL) THEN
    RETURN jsonb_build_object(
      'status',                   'suppressed',
      'inserted_phone_count',     0,
      'updated_phone_count',      0,
      'inserted_source_count',    0,
      'suppressed_skipped_count', 0,
      'new_distinct_phone_count', 0,
      'primary_dedupe_key',       NULL,
      'primary_set',              false,
      'candidate_scalar_updated', false
    );
  END IF;

  -- ── Step 3 — number-level tombstones, counted under the lock ───
  -- Unlike the reveal writer there is no "everything is a tombstone ⇒ fail closed"
  -- branch, and its absence is deliberate: that branch exists there to avoid terminalizing
  -- a reveal with an erased number as its only candidate. Here nothing is terminalized and
  -- the visible phone is the incumbent, which is already known to be live. A payload of
  -- nothing but tombstones simply appends nothing.

  SELECT COUNT(*) INTO v_suppressed_count
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
  JOIN public.contact_enrichment_candidate_phones e
    ON e.candidate_id = p_candidate_id
   AND e.dedupe_key = x.dedupe_key
  WHERE e.suppressed_at IS NOT NULL;

  -- How many survivors already exist. Counted BEFORE the writes so inserted/updated are
  -- facts rather than an interpretation of `xmax`.
  SELECT COUNT(*) INTO v_existing_live
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
  JOIN public.contact_enrichment_candidate_phones e
    ON e.candidate_id = p_candidate_id
   AND e.dedupe_key = x.dedupe_key
  WHERE e.suppressed_at IS NULL;

  v_updated_count  := v_existing_live;
  v_inserted_count := v_incoming_count - v_suppressed_count - v_existing_live;

  -- ── Step 4 — canonical phones: insert new, refresh known ───────
  -- `is_primary` is false for every INSERT and elected in step 6. Promoting during the
  -- insert would collide with the single-primary partial index while the incumbent is
  -- still standing — and on this path there is ALWAYS an incumbent.

  FOR v_row IN
    SELECT x.dedupe_key,
           x.normalized_phone,
           x.display_phone,
           x.phone_type,
           x.phone_status,
           x.first_seen_at,
           x.last_seen_at
    FROM jsonb_to_recordset(p_phones) AS x(
      dedupe_key       text,
      normalized_phone text,
      display_phone    text,
      phone_type       text,
      phone_status     text,
      first_seen_at    timestamptz,
      last_seen_at     timestamptz
    )
  LOOP
    -- Reset per iteration: `RETURNING … INTO` on a row the tombstone guard skipped must
    -- leave NULL here, not the id of the previous phone.
    v_phone_id := NULL;

    INSERT INTO public.contact_enrichment_candidate_phones AS t (
      candidate_id, normalized_phone, display_phone, dedupe_key,
      phone_type, phone_status, is_primary, first_seen_at, last_seen_at
    ) VALUES (
      p_candidate_id, v_row.normalized_phone, v_row.display_phone, v_row.dedupe_key,
      v_row.phone_type, v_row.phone_status, false, v_row.first_seen_at, v_row.last_seen_at
    )
    ON CONFLICT (candidate_id, dedupe_key) DO UPDATE
      SET
        -- `aggregateCandidatePhoneStatus`, mirrored: a provider that fails to verify a
        -- number is reporting its own coverage, so `invalid` never demotes a `valid`.
        phone_status = CASE
          WHEN 'valid' IN (t.phone_status, excluded.phone_status) THEN 'valid'
          WHEN t.phone_status = 'invalid'
               AND excluded.phone_status IN ('invalid', 'unknown') THEN 'invalid'
          WHEN excluded.phone_status = 'invalid'
               AND t.phone_status IN ('invalid', 'unknown') THEN 'invalid'
          ELSE 'unknown'
        END,
        -- `aggregateCandidatePhoneType`, mirrored: the better-ranked of the two wins, and
        -- every raw type stays intact in the provenance rows regardless.
        phone_type = CASE
          WHEN t.phone_type IS NULL THEN COALESCE(excluded.phone_type, 'unknown')
          WHEN COALESCE(array_position(c_type_ranking, t.phone_type),
                        array_length(c_type_ranking, 1) + 1)
               <= COALESCE(array_position(c_type_ranking,
                                          COALESCE(excluded.phone_type, 'unknown')),
                           array_length(c_type_ranking, 1) + 1)
            THEN t.phone_type
          ELSE COALESCE(excluded.phone_type, 'unknown')
        END,
        -- `first_seen_at` is deliberately untouched: it is the first time the number was
        -- seen, and seeing it again does not change that. This is also what makes
        -- "Search More returned a duplicate" observable — the row keeps its original
        -- first sighting and gains only a later `last_seen_at` and a new provenance row.
        last_seen_at = p_observed_at
      -- The tombstone guard, restated where it is ENFORCED rather than merely intended.
      -- Without it a tombstoned row would be handed back its number by this very UPDATE,
      -- and migration 109's `..._tombstone_is_empty` CHECK would then reject the
      -- statement — turning a privacy rule into a rollback.
      WHERE t.suppressed_at IS NULL
    RETURNING t.id INTO v_phone_id;

    -- A tombstoned row returns nothing: no provenance, no primary, no trace of the
    -- observation. Recording that a suppressed person was seen again is still recording it.
    IF v_phone_id IS NULL THEN
      CONTINUE;
    END IF;

    -- ── Step 5 — provenance: append-only and idempotent ──────────
    -- ON CONFLICT DO NOTHING on (candidate_phone_id, source_event_key), and no UPDATE is
    -- needed — which matters, because migration 109 does not grant one.
    --
    -- This is where the contract of §10 materializes: a number Apollo already stored and
    -- Lusha now returns stays ONE canonical row and gains a SECOND provenance row,
    -- because the keys differ by provider and neither overwrites the other. The Apollo
    -- provenance — with its own `waterfall_run_id`, `reservation_id` and
    -- `provider_usage_log_id` — is untouched.

    FOR v_src IN
      SELECT s.provider,
             s.acquisition_mode,
             s.raw_provider_type,
             s.raw_provider_status,
             s.waterfall_run_id,
             s.reservation_id,
             s.provider_usage_log_id,
             s.source_event_key,
             s.observed_at
      FROM jsonb_to_recordset(p_sources) AS s(
        dedupe_key            text,
        provider              text,
        acquisition_mode      text,
        raw_provider_type     text,
        raw_provider_status   text,
        waterfall_run_id      uuid,
        reservation_id        uuid,
        provider_usage_log_id uuid,
        source_event_key      text,
        observed_at           timestamptz
      )
      WHERE s.dedupe_key = v_row.dedupe_key
    LOOP
      INSERT INTO public.contact_enrichment_candidate_phone_sources (
        candidate_phone_id, provider, acquisition_mode, raw_provider_type,
        raw_provider_status, waterfall_run_id, reservation_id, provider_usage_log_id,
        source_event_key, observed_at
      ) VALUES (
        v_phone_id, v_src.provider, v_src.acquisition_mode, v_src.raw_provider_type,
        v_src.raw_provider_status, v_src.waterfall_run_id, v_src.reservation_id,
        v_src.provider_usage_log_id, v_src.source_event_key, v_src.observed_at
      )
      ON CONFLICT (candidate_phone_id, source_event_key) DO NOTHING;

      GET DIAGNOSTICS v_affected = ROW_COUNT;
      v_source_count := v_source_count + v_affected;
    END LOOP;
  END LOOP;

  -- ── Step 6 — elect one primary, never a worse one ──────────────
  -- The ORDER is the pure layer's decision. What this function decides is ELIGIBILITY —
  -- from the rows as they NOW stand: alive, numbered, not asserted invalid, which are
  -- exactly migration 109's `..._primary_requires_live_number` conditions, so a key this
  -- loop accepts can never be one the database would then reject — and whether the winner
  -- actually IMPROVES on the incumbent.

  FOR v_pref IN
    SELECT r.dedupe_key, r.phone, r.phone_type, r.raw_type
    FROM jsonb_array_elements(p_primary_candidates) WITH ORDINALITY AS e(item, ord)
    CROSS JOIN LATERAL jsonb_to_record(e.item) AS r(
      dedupe_key text, phone text, phone_type text, raw_type text
    )
    ORDER BY e.ord
  LOOP
    SELECT p.id,
           COALESCE(array_position(c_type_ranking, COALESCE(p.phone_type, 'unknown')),
                    array_length(c_type_ranking, 1) + 1),
           CASE p.phone_status WHEN 'valid' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END
      INTO v_chosen_id, v_chosen_rank, v_chosen_status_rank
    FROM public.contact_enrichment_candidate_phones p
    WHERE p.candidate_id = p_candidate_id
      AND p.dedupe_key = v_pref.dedupe_key
      AND p.suppressed_at IS NULL
      AND p.normalized_phone IS NOT NULL
      AND p.phone_status <> 'invalid';

    IF v_chosen_id IS NOT NULL THEN
      v_chosen_key      := v_pref.dedupe_key;
      -- The scalar and its metadata come from the SAME entry as the elected key.
      v_chosen_phone    := v_pref.phone;
      v_chosen_type     := v_pref.phone_type;
      v_chosen_raw_type := v_pref.raw_type;
      EXIT;
    END IF;
  END LOOP;

  -- The live incumbent, read AFTER the upserts so its aggregated type is the current one.
  SELECT p.id,
         p.dedupe_key,
         COALESCE(array_position(c_type_ranking, COALESCE(p.phone_type, 'unknown')),
                  array_length(c_type_ranking, 1) + 1),
         CASE p.phone_status WHEN 'valid' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END
    INTO v_inc_id, v_inc_key, v_inc_rank, v_inc_status_rank
  FROM public.contact_enrichment_candidate_phones p
  WHERE p.candidate_id = p_candidate_id
    AND p.is_primary
    AND p.suppressed_at IS NULL;

  IF v_chosen_id IS NOT NULL THEN
    IF v_inc_id IS NOT NULL
       AND v_inc_id <> v_chosen_id
       AND (v_chosen_rank, v_chosen_status_rank) >= (v_inc_rank, v_inc_status_rank) THEN
      -- The incumbent is as good or better. It KEEPS the designation and the visible
      -- fields are left exactly as they are — which on THIS path is the common case: the
      -- operator asked for MORE numbers, not for a different visible one.
      v_primary_id     := v_inc_id;
      v_primary_key    := v_inc_key;
      v_scalar_updated := false;
    ELSE
      -- A strict improvement (or the incumbent IS this key). Search More found something
      -- better-ranked than what was visible, so it becomes the primary.
      v_primary_id      := v_chosen_id;
      v_primary_key     := v_chosen_key;
      v_scalar_updated  := true;
      v_scalar          := v_chosen_phone;
      v_meta_type       := v_chosen_type;
      v_meta_raw_type   := v_chosen_raw_type;
    END IF;
  ELSE
    -- Nothing from this response qualifies. The standing primary is kept and the visible
    -- fields are left alone.
    --
    -- There is NO third branch here, and that is the structural difference from the reveal
    -- writer: it needs one because a reveal must end with SOME visible number, so a
    -- candidate with no electable row falls back to the legacy scalar. A Search More run
    -- starts from a candidate that already has a visible phone, so "nothing electable
    -- arrived" resolves to "change nothing" — never to installing a fallback.
    v_primary_id     := v_inc_id;
    v_primary_key    := v_inc_key;
    v_scalar_updated := false;
  END IF;

  IF v_primary_id IS NOT NULL AND v_scalar_updated THEN
    -- Demote first, promote second. The partial unique index does not tolerate two
    -- primaries even for an instant, and this order needs no window. Both statements are
    -- no-ops when the incumbent already IS the elected row.
    UPDATE public.contact_enrichment_candidate_phones
       SET is_primary = false
     WHERE candidate_id = p_candidate_id
       AND is_primary
       AND id <> v_primary_id;

    UPDATE public.contact_enrichment_candidate_phones
       SET is_primary = true
     WHERE id = v_primary_id
       AND NOT is_primary;
  END IF;

  -- ── Step 7 — the candidate scalar, and ONLY when it improved ───
  -- The single most important difference from the reveal writer: NO `phone_reveal_*`
  -- column is written here, on any branch. The candidate's reveal already closed under a
  -- different authorization, with a different provider and a different cost, and all three
  -- of those facts stay true. A Search More run that appends a work line to a candidate
  -- revealed by Apollo leaves `phone_reveal_provider = 'apollo'`,
  -- `phone_reveal_cost_credits` at Apollo's figure and `phone_revealed_at` at Apollo's
  -- timestamp — because that is what happened.
  --
  -- When the scalar was NOT improved, this step writes NOTHING AT ALL: not a no-op UPDATE,
  -- not an `updated_at` touch. The candidate row is left byte-identical.

  IF v_scalar_updated THEN
    v_phone_meta := jsonb_build_object(
      'number',   v_scalar,
      'type',     v_meta_type,
      'source',   'search_more_reveal',
      'raw_type', v_meta_raw_type
    );

    UPDATE public.contact_enrichment_candidates
       SET phone = v_scalar,
           -- Shallow merge of the single `phone` key, read from the LOCKED row so a
           -- concurrent metadata write cannot be clobbered by a stale copy.
           enrichment_metadata = jsonb_set(
             COALESCE(enrichment_metadata, '{}'::jsonb), '{phone}', v_phone_meta, true
           )
     WHERE id = p_candidate_id;

    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 1 THEN
      -- Unreachable while the row is locked; raised rather than reported because it would
      -- mean the lock did not hold. The message names the operation, never a value.
      RAISE EXCEPTION 'append_candidate_search_more_phones: candidate scalar update did not affect exactly one row';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status',                   'persisted',
    'inserted_phone_count',     v_inserted_count,
    'updated_phone_count',      v_updated_count,
    'inserted_source_count',    v_source_count,
    'suppressed_skipped_count', v_suppressed_count,
    -- DERIVED, not stored: the numbers that did not exist in this collection before this
    -- transaction. `0` with a non-zero `updated_phone_count` is exactly the
    -- `no_new_distinct_phone` outcome — the provider answered, was charged, and every
    -- number was already here.
    'new_distinct_phone_count', v_inserted_count,
    'primary_dedupe_key',       v_primary_key,
    'primary_set',              v_primary_id IS NOT NULL,
    'candidate_scalar_updated', v_scalar_updated
  );
END $$;

COMMENT ON FUNCTION public.append_candidate_search_more_phones(
  uuid, timestamptz, jsonb, jsonb, jsonb
) IS
  'AGENT2A-SEARCH-MORE-PHONES-1 — APPENDS a provider response to a candidate phone collection whose reveal ALREADY closed, in ONE transaction: canonical phone rows, their provenance, and the single primary designation. Writes NO phone_reveal_* column on any branch: the reveal was closed by another authorization, with another provider and another cost, and re-stating it would attribute an Apollo number to Lusha and overwrite Apollo recorded cost. Never deletes or replaces an existing phone. Locks the candidate with SELECT FOR UPDATE, re-checks PERSON-level provider-native suppression inside the lock via phone_reveal_candidate_suppression_exists (the #295 / M120 guarantee) and re-states the per-number tombstone guard in its ON CONFLICT clause, so a tombstoned number is never rewritten, never gains provenance and never becomes primary. Elects a primary only on a STRICT improvement over the live incumbent by (type rank, status rank), so an additional work line never displaces an existing mobile; when the incumbent is retained the candidate row is not written at all. Merges rather than replaces: a number the other provider already stored keeps its row and gains a second provenance. Idempotent by (candidate_id, dedupe_key) and (candidate_phone_id, source_event_key). Returns new_distinct_phone_count DERIVED from what did not exist before, so no redundant column is added. Writes NO usage log, NO reservation and NO waterfall row: that accounting lives in phone_reveal_waterfall_runs / phone_reveal_credit_reservations / provider_usage_logs and must survive a failure this function reports. SECURITY INVOKER on purpose so migration 109 privilege ceiling still applies: it cannot DELETE a phone row or UPDATE a provenance row. No dynamic SQL, every written column named literally. Returns counts, flags and a SHA-256 dedupe key, never a phone number. Service-role only.';

-- ═══════════════════════════════════════════════════════════════════
-- 4. Privileges — the same ceiling as 110 / 111 / 120
-- ═══════════════════════════════════════════════════════════════════
-- Declared explicitly rather than inherited, so this migration end state is readable
-- without opening another file. `PUBLIC`, `anon` and `authenticated` are revoked; only
-- `service_role` may execute. A browser session can never reach this function.

REVOKE ALL ON FUNCTION public.append_candidate_search_more_phones(
  uuid, timestamptz, jsonb, jsonb, jsonb
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.append_candidate_search_more_phones(
  uuid, timestamptz, jsonb, jsonb, jsonb
) FROM anon;

REVOKE ALL ON FUNCTION public.append_candidate_search_more_phones(
  uuid, timestamptz, jsonb, jsonb, jsonb
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.append_candidate_search_more_phones(
  uuid, timestamptz, jsonb, jsonb, jsonb
) TO service_role;
