-- Migration 110: TRANSACTIONAL persistence of an Apollo `revealed` phone result
-- (Agente 2A · AGENT2A-PHONE-REVEAL-4O-C-R1)
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS
-- ═══════════════════════════════════════════════════════════════════
--
-- 4O-C wired the capture of EVERY phone Apollo returns (migration 109's two tables) into
-- the webhook and the recovery poll. What it could not do — because it was not authorized
-- to add a migration — was make that write ATOMIC. It persisted, in sequence and through
-- PostgREST (which exposes no BEGIN/COMMIT):
--
--   1. the canonical phone rows,
--   2. their provenance rows,
--   3. the single primary election,
--   4. the candidate's scalar phone and its `revealed` terminal state.
--
-- Ordering step 4 last makes the WORST state unreachable (a visible phone with no
-- collection), and every step converges on retry. That is genuinely better than nothing,
-- and it is still not atomicity: a failure between 1 and 3 leaves a SUBSET of the
-- collection written, and "the next free poll will finish it" is a promise about a future
-- event, not a property of this one. This migration replaces the promise with a guarantee.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHAT IS ATOMIC, AND WHAT IS DELIBERATELY NOT
-- ═══════════════════════════════════════════════════════════════════
--
-- INSIDE the function, therefore all-or-nothing:
--
--   * contact_enrichment_candidate_phones        (insert / refresh)
--   * contact_enrichment_candidate_phone_sources (append, idempotent)
--   * the single-primary designation
--   * contact_enrichment_candidates.phone        (the visible scalar)
--   * every `revealed` terminal column the caller writes today
--
-- OUTSIDE, and on purpose:
--
--   * provider_usage_logs — the accounting ledger. Folding it in would put a log write in
--     the same rollback scope as the data write, so a failed persistence would also erase
--     the record THAT IT FAILED. The log is the evidence; it has to survive the failure it
--     describes.
--   * phone_reveal_credit_reservations / phone_reveal_waterfall_runs — the money. They are
--     reconciled by their own functions (migration 104) against their own invariants.
--     Reserving or confirming credits here would create a second set of books for the same
--     spend, which is precisely what migration 109 refused to do with a per-number cost
--     column.
--   * phone_reveal_cache — a pure optimizer. Best-effort by contract since
--     APOLLO-PHONE-CACHE-1b: a cache failure must never undo a phone that was paid for.
--
-- So the boundary is: EVERYTHING THAT DESCRIBES THE PHONE is atomic; everything that
-- describes the OPERATION stays where it already lives. Nothing that used to be
-- transactional stopped being so.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY `SECURITY INVOKER` AND NOT `SECURITY DEFINER`
-- ═══════════════════════════════════════════════════════════════════
--
-- Migration 104's three functions are DEFINER because they must read and write pools the
-- caller has no business reaching directly. This one needs nothing of the sort: the
-- service role already holds every privilege it uses (migration 109 granted it
-- SELECT/INSERT/UPDATE on the canonical table and SELECT/INSERT on provenance, and the
-- candidate table has been written by the same role since 068).
--
-- INVOKER is therefore not a shortcut, it is the stronger choice: the function inherits the
-- caller's envelope, so it CANNOT delete a phone row (109 withholds DELETE, because
-- deleting a row deletes a tombstone) and CANNOT rewrite a provenance row (109 withholds
-- UPDATE, because provenance whose writer can edit it is not provenance). A DEFINER
-- function owned by `postgres` would silently hand itself both. The privilege ceiling that
-- 109 argued for keeps applying because this function runs under it rather than above it.
--
-- EXECUTE is still revoked from PUBLIC/anon/authenticated: PostgreSQL grants EXECUTE to
-- PUBLIC by default, and a function reachable through PostgREST with the anon key is
-- reachable, full stop — even if RLS would then reject its statements, the reachability
-- itself is the defect (see migration 104 § 9).
--
-- ═══════════════════════════════════════════════════════════════════
-- NO DYNAMIC SQL, AND WHY THE COLLECTIONS ARE STILL `jsonb`
-- ═══════════════════════════════════════════════════════════════════
--
-- Every column this function writes is named literally in its source. There is no EXECUTE
-- of a composed string anywhere, so no caller can reach a column that is not written here
-- by name. The candidate's terminal fields are individual TYPED parameters for exactly that
-- reason: a single `p_patch jsonb` applied generically would be an arbitrary-column writer
-- wearing a function's clothes.
--
-- The two collections are `jsonb` because they are variable-length, and they are converted
-- through `jsonb_to_recordset` / `jsonb_to_record` with an EXPLICIT, CLOSED column list.
-- Keys the contract does not mention are dropped by that conversion — they cannot become
-- columns. Values are validated BEFORE the first write, so a malformed payload returns
-- `invalid_input` with nothing written rather than aborting halfway.
--
-- ═══════════════════════════════════════════════════════════════════
-- PRIVACY
-- ═══════════════════════════════════════════════════════════════════
--
-- The return value carries counts, flags, a status, and `primary_dedupe_key` (a SHA-256, by
-- migration 109's design, never the number). No phone number, no display form, and no
-- provider person id ever appears in it. The `invalid_input` details are closed mechanical
-- strings describing WHICH FIELD was wrong, never its value, and no exception message is
-- built from a number.
--
-- ═══════════════════════════════════════════════════════════════════
-- SCOPE
-- ═══════════════════════════════════════════════════════════════════
--
-- `revealed` ONLY. `no_phone_found`, `blocked_suppressed`, `error` and every non-terminal
-- outcome keep the single-statement candidate update they already use: they write no
-- collection, so there is nothing to make atomic WITH, and routing them through here would
-- be a refactor of paths this block was not asked to touch. The function rejects any
-- status other than `revealed` rather than quietly accepting one.
--
-- NO table is created, altered or dropped. NO row is backfilled. NO trigger is added. This
-- file adds exactly one function and its execution privileges.
--
-- ⚠️ NOT APPLIED. This migration has NOT been applied to any remote Supabase project.
--
-- Idempotent: CREATE OR REPLACE, and the REVOKE/GRANT block declares an end state.

-- ═══════════════════════════════════════════════════════════════════
-- 1. The function
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  -- ── Identity of the operation ────────────────────────────────────
  p_candidate_id                     uuid,
  -- Apollo async id this callback claims to be for. Compared, under the lock, against
  -- `contact_enrichment_candidates.phone_reveal_request_id` — the very column the webhook
  -- looked the candidate up by — so a callback for a SUPERSEDED reveal cannot land on a
  -- candidate that has since started a new one. NULL from the recovery poll, whose id
  -- lives in `provider_usage_logs.metadata.apollo_trace`, not on the candidate row: there
  -- the in-flight status check below is the whole guard, which is the same condition the
  -- poll already required before spending the call.
  p_expected_request_id              text,
  p_reveal_phase                     text,          -- 'webhook' | 'recovery_poll'
  p_observed_at                      timestamptz,

  -- ── The collection (validated recordsets, never arbitrary columns) ──
  p_phones                           jsonb,
  p_sources                          jsonb,
  -- Primary candidates IN ORDER OF PREFERENCE, each carrying the terminal triple the pure
  -- layer computed FOR THAT KEY (`resolvePrimaryPhoneForCandidate`). Pairing the key with
  -- its own scalar is what makes divergence between the collection's primary and the
  -- candidate's scalar structurally impossible: whichever key this function elects, it
  -- writes THAT key's number, never another's.
  p_primary_candidates               jsonb,

  -- ── Legacy fallback: what the pre-4O-C path would have written ───
  p_legacy_phone                     text,
  p_legacy_phone_type                text,
  p_legacy_raw_type                  text,
  -- The dedupe key OF that fallback number. Needed because the fallback is only safe
  -- to write if the number behind it is not itself a tombstone: without this key the
  -- function cannot tell, and the one path that reaches the fallback — no eligible
  -- primary — is exactly the path where a suppressed number would slip back into the
  -- visible field. See step 3.
  p_legacy_dedupe_key                text,

  -- ── Terminal `revealed` state (one typed parameter per column) ───
  p_phone_reveal_status              text,
  p_phone_reveal_provider            text,
  p_phone_revealed_at                timestamptz,
  p_phone_reveal_completed_at        timestamptz,
  -- Written by the webhook only; NULL leaves the column untouched (the recovery poll never
  -- received a callback, and claiming it did would be a lie about how the phone arrived).
  p_phone_reveal_webhook_received_at timestamptz,
  -- Written by the recovery poll only; NULL leaves the column untouched.
  p_phone_reveal_last_checked_at     timestamptz,
  -- ALWAYS written, and NULL is a VALUE here, not an absence: Apollo frequently reports no
  -- credit figure, and `phone_reveal_cost_source` is what distinguishes "not reported" from
  -- "nobody has looked".
  p_phone_reveal_cost_credits        integer,
  p_phone_reveal_cost_source         text,          -- 'reported' | 'unknown'
  -- ALWAYS written. On this path it is NULL by definition; the function refuses anything
  -- else rather than letting an error code ride along with a success.
  p_phone_reveal_error_code          text,
  -- Recovery preserves the existing basis; NULL leaves the column untouched.
  p_phone_processing_basis           text,
  -- Only ever SET, never cleared: NULL leaves the column untouched, exactly as the
  -- `if (patch.apollo_person_id)` guard in both callers does today.
  p_apollo_person_id                 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  -- Type priority, IDENTICAL to CANDIDATE_PHONE_TYPE_RANKING in phone-collection-core.ts.
  -- If these two lists diverged, a refreshed row would end up with a different aggregated
  -- type than the pure layer computed for the same observations.
  c_type_ranking      text[] := ARRAY[
    'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
  ];
  -- Same closed set as TERMINAL_STATUSES in phone-reveal-webhook-core.ts.
  c_terminal_statuses text[] := ARRAY['revealed', 'no_phone_found', 'error'];

  v_candidate         record;
  v_row               record;
  v_src               record;
  v_pref              record;

  v_incoming_count    integer := 0;
  v_distinct_count    integer := 0;
  v_suppressed_count  integer := 0;
  v_viable_preference integer := 0;
  v_legacy_suppressed boolean := false;
  v_existing_live     integer := 0;
  v_inserted_count    integer := 0;
  v_updated_count     integer := 0;
  v_source_count      integer := 0;
  v_affected          integer := 0;

  v_phone_id          uuid;
  v_primary_key       text := NULL;
  v_primary_id        uuid := NULL;
  v_scalar            text := NULL;
  v_meta_type         text := NULL;
  v_meta_raw_type     text := NULL;
  v_phone_meta        jsonb;
BEGIN
  -- ═══════════════════════════════════════════════════════════════
  -- Step 0 — shape validation. Fail-closed, and BEFORE any write.
  -- ═══════════════════════════════════════════════════════════════
  -- Every rejection below returns with zero rows touched. Validating after the first insert
  -- would mean relying on the rollback for something a check can prevent outright.

  IF p_candidate_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'candidate_id_missing');
  END IF;

  IF p_reveal_phase IS NULL OR p_reveal_phase NOT IN ('webhook', 'recovery_poll') THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'reveal_phase_unknown');
  END IF;

  IF p_observed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'observed_at_missing');
  END IF;

  -- This function is the `revealed` path and nothing else (see SCOPE above).
  IF p_phone_reveal_status IS DISTINCT FROM 'revealed' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'status_not_revealed');
  END IF;

  IF p_phone_reveal_error_code IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'error_code_not_null');
  END IF;

  IF p_phone_reveal_provider IS DISTINCT FROM 'apollo' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'provider_not_apollo');
  END IF;

  IF p_phone_reveal_cost_source IS NULL
     OR p_phone_reveal_cost_source NOT IN ('reported', 'unknown') THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'cost_source_unknown');
  END IF;

  IF p_phone_revealed_at IS NULL OR p_phone_reveal_completed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'terminal_timestamps_missing');
  END IF;

  -- Exactly one of the two phase-specific timestamps, matching the two callers: the webhook
  -- stamps `webhook_received_at`, the poll stamps `last_checked_at`. Both, or neither, would
  -- describe an operation that did not happen.
  IF (p_phone_reveal_webhook_received_at IS NOT NULL)
     = (p_phone_reveal_last_checked_at IS NOT NULL) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phase_timestamps_inconsistent');
  END IF;

  IF p_legacy_phone IS NULL OR LENGTH(BTRIM(p_legacy_phone)) = 0 THEN
    -- The legacy scalar is the floor: this path exists because Apollo delivered a phone.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'legacy_phone_missing');
  END IF;

  IF p_legacy_dedupe_key IS NULL OR LENGTH(BTRIM(p_legacy_dedupe_key)) = 0 THEN
    -- Without it the tombstone check on the fallback (step 3) cannot run, and a missing
    -- privacy check must never be silently skipped.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'legacy_dedupe_key_missing');
  END IF;

  IF p_phones IS NULL
     OR jsonb_typeof(p_phones) <> 'array'
     OR jsonb_array_length(p_phones) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phones_empty');
  END IF;

  IF p_sources IS NULL OR jsonb_typeof(p_sources) <> 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'sources_invalid');
  END IF;

  IF p_primary_candidates IS NULL OR jsonb_typeof(p_primary_candidates) <> 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'primary_candidates_invalid');
  END IF;

  -- Every element of the three arrays must be an OBJECT. `jsonb_to_recordset` raises on a
  -- scalar element, and a raise here would report as an infrastructure failure rather than
  -- as the malformed input it is.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_phones) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_sources) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_primary_candidates) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'collection_element_not_object');
  END IF;

  -- ── Per-row validation of the canonical collection ──────────────
  -- The vocabularies are re-checked here even though migration 109 has CHECK constraints
  -- for both: hitting the constraint would raise and roll back, which is correct but
  -- reports as an infrastructure failure. A caller sending a bad status deserves
  -- `invalid_input`, not a rollback that looks like the database broke.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_phones) AS x(
      dedupe_key       text,
      normalized_phone text,
      display_phone    text,
      phone_type       text,
      phone_status     text,
      first_seen_at    timestamptz,
      last_seen_at     timestamptz
    )
    WHERE x.dedupe_key IS NULL
       OR LENGTH(BTRIM(x.dedupe_key)) = 0
       OR x.phone_status IS NULL
       OR x.phone_status NOT IN ('valid', 'invalid', 'unknown')
       OR (x.phone_type IS NOT NULL AND NOT (x.phone_type = ANY (c_type_ranking)))
       OR x.first_seen_at IS NULL
       OR x.last_seen_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phone_row_invalid');
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT x.dedupe_key)
    INTO v_incoming_count, v_distinct_count
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text);

  IF v_incoming_count <> v_distinct_count THEN
    -- `mergeCandidatePhoneInputs` already collapses one key into one row. Two rows sharing a
    -- key would mean the pure layer and this function disagree about what a phone IS.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phone_key_duplicated');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_sources) AS s(
      dedupe_key       text,
      provider         text,
      acquisition_mode text,
      source_event_key text,
      observed_at      timestamptz
    )
    WHERE s.dedupe_key IS NULL
       OR LENGTH(BTRIM(s.dedupe_key)) = 0
       OR s.provider IS NULL
       OR s.provider NOT IN ('apollo', 'lusha', 'apollo_cache', 'manual', 'unknown')
       OR s.acquisition_mode IS NULL
       OR s.acquisition_mode NOT IN ('search', 'reveal', 'waterfall', 'cache', 'manual')
       OR s.source_event_key IS NULL
       OR LENGTH(BTRIM(s.source_event_key)) = 0
       OR s.observed_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'source_row_invalid');
  END IF;

  -- Every provenance row must belong to a phone in THIS payload. A source pointing at a key
  -- that is not being written is provenance for nothing.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_sources) AS s(dedupe_key text)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
      WHERE x.dedupe_key = s.dedupe_key
    )
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'source_key_orphan');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_primary_candidates) AS e(item)
    CROSS JOIN LATERAL jsonb_to_record(e.item) AS r(
      dedupe_key text, phone text, phone_type text, raw_type text
    )
    WHERE r.dedupe_key IS NULL
       OR LENGTH(BTRIM(r.dedupe_key)) = 0
       OR r.phone IS NULL
       OR LENGTH(BTRIM(r.phone)) = 0
       OR r.phone_type IS NULL
       OR NOT (r.phone_type = ANY (c_type_ranking))
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'primary_candidate_invalid');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 1 — LOCK the candidate.
  -- ═══════════════════════════════════════════════════════════════
  -- This is the serialization point for the whole subsystem. The webhook and the recovery
  -- poll can genuinely race — a callback arriving while the cron is polling the same
  -- candidate — and without this lock both would read "in flight", both would elect a
  -- primary, and the loser would either duplicate provenance or fight the single-primary
  -- index. Every check that follows is deliberately AFTER it, so nothing is decided on a
  -- snapshot that a concurrent transaction can invalidate.

  SELECT c.id,
         c.enrichment_metadata,
         c.phone_reveal_status,
         c.phone_reveal_request_id
    INTO v_candidate
  FROM public.contact_enrichment_candidates c
  WHERE c.id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'candidate_not_eligible', 'detail', 'candidate_not_found');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 2 — is this event still the one that owns the candidate?
  -- ═══════════════════════════════════════════════════════════════

  IF v_candidate.phone_reveal_status = ANY (c_terminal_statuses) THEN
    IF p_expected_request_id IS NOT NULL
       AND v_candidate.phone_reveal_status = 'revealed'
       AND v_candidate.phone_reveal_request_id IS NOT DISTINCT FROM p_expected_request_id THEN
      -- The SAME event already committed — a concurrent caller won the lock and did exactly
      -- this work. Rewriting it would be pointless; reporting failure would be false. The
      -- honest answer is that the desired state is already in place.
      RETURN jsonb_build_object(
        'status',                   'idempotent',
        'inserted_phone_count',     0,
        'updated_phone_count',      0,
        'inserted_source_count',    0,
        'suppressed_skipped_count', 0,
        'primary_dedupe_key',       NULL,
        'primary_set',              EXISTS (
          SELECT 1 FROM public.contact_enrichment_candidate_phones p
          WHERE p.candidate_id = p_candidate_id AND p.is_primary
        ),
        'candidate_terminalized',   true
      );
    END IF;
    -- A DIFFERENT terminal state, or a terminal state this event cannot claim. Writing over
    -- it would overwrite a conclusion somebody else reached.
    RETURN jsonb_build_object('status', 'stale_event', 'detail', 'candidate_already_terminal');
  END IF;

  IF p_expected_request_id IS NOT NULL
     AND v_candidate.phone_reveal_request_id IS DISTINCT FROM p_expected_request_id THEN
    -- The candidate has moved on to another reveal request. This callback is late mail for
    -- an address that no longer exists.
    RETURN jsonb_build_object('status', 'stale_event', 'detail', 'request_id_superseded');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 3 — tombstones, re-checked UNDER the lock.
  -- ═══════════════════════════════════════════════════════════════
  -- The TypeScript layer cannot own this check: it reads before the lock, and a suppression
  -- committed in that window would be invisible to it. Here the read is inside the
  -- serialized region, and the ON CONFLICT clauses below carry the same condition again so
  -- the guarantee survives even if this count were somehow wrong.

  SELECT COUNT(*) INTO v_suppressed_count
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
  JOIN public.contact_enrichment_candidate_phones e
    ON e.candidate_id = p_candidate_id
   AND e.dedupe_key = x.dedupe_key
  WHERE e.suppressed_at IS NOT NULL;

  -- ── Would the LEGACY FALLBACK resurrect a suppressed number? ────
  --
  -- The fallback is only reached when no preference key turns out to be electable. On that
  -- path the scalar becomes `p_legacy_phone` — and if the row behind THAT number is a
  -- tombstone, the suppressed number lands straight back in the visible field. Which is the
  -- precise failure the tombstone exists to prevent, arriving through the one door that
  -- does not consult it.
  --
  -- So both halves are computed BEFORE any write: whether the fallback number is suppressed,
  -- and whether any preference key survives to keep the fallback from being needed.
  SELECT EXISTS (
    SELECT 1 FROM public.contact_enrichment_candidate_phones e
    WHERE e.candidate_id = p_candidate_id
      AND e.dedupe_key = p_legacy_dedupe_key
      AND e.suppressed_at IS NOT NULL
  ) INTO v_legacy_suppressed;

  SELECT COUNT(*) INTO v_viable_preference
  FROM jsonb_array_elements(p_primary_candidates) AS e(item)
  CROSS JOIN LATERAL jsonb_to_record(e.item) AS r(
    dedupe_key text, phone text, phone_type text, raw_type text
  )
  WHERE NOT EXISTS (
    SELECT 1 FROM public.contact_enrichment_candidate_phones ex
    WHERE ex.candidate_id = p_candidate_id
      AND ex.dedupe_key = r.dedupe_key
      AND ex.suppressed_at IS NOT NULL
  );

  IF v_legacy_suppressed AND v_viable_preference = 0 THEN
    -- Nothing electable survives AND the fallback is a tombstone. Fail closed with nothing
    -- written and — the part that matters — WITHOUT terminalizing the candidate: a
    -- `revealed` row here would have to carry some number, and the only one left is one
    -- that was erased.
    --
    -- This subsumes the simpler "every number in the payload is a tombstone" case, since the
    -- legacy number is always one of the payload's numbers.
    --
    -- DECLARED LIMIT: a permanent tombstone makes this poll repeat and count as `failed` on
    -- every sweep, always at 0 credits, until an operator intervenes. That is chosen over
    -- putting an erased number back in front of a user.
    RETURN jsonb_build_object(
      'status',                   'suppressed',
      'inserted_phone_count',     0,
      'updated_phone_count',      0,
      'inserted_source_count',    0,
      'suppressed_skipped_count', v_suppressed_count,
      'primary_dedupe_key',       NULL,
      'primary_set',              false,
      'candidate_terminalized',   false
    );
  END IF;

  -- How many of the survivors already exist. Counted BEFORE the writes so that
  -- inserted/updated are facts rather than an interpretation of `xmax`.
  SELECT COUNT(*) INTO v_existing_live
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
  JOIN public.contact_enrichment_candidate_phones e
    ON e.candidate_id = p_candidate_id
   AND e.dedupe_key = x.dedupe_key
  WHERE e.suppressed_at IS NULL;

  v_updated_count := v_existing_live;
  v_inserted_count := v_incoming_count - v_suppressed_count - v_existing_live;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 4 — canonical phones: insert new, refresh known.
  -- ═══════════════════════════════════════════════════════════════
  -- `is_primary` is false for every write here and elected in step 6. Promoting during the
  -- insert would collide with the single-primary partial index while the previous primary
  -- is still standing.

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
        -- seen, and seeing it again does not change that.
        last_seen_at = p_observed_at
      -- The tombstone guard, restated where it is enforced rather than merely intended.
      -- Without it a tombstoned row would be handed back its number and its type by this
      -- very UPDATE, and migration 109's `..._tombstone_is_empty` CHECK would then reject
      -- the statement — turning a privacy rule into a rollback. Skipping the row keeps the
      -- rule as a rule.
      WHERE t.suppressed_at IS NULL
    RETURNING t.id INTO v_phone_id;

    -- A tombstoned row returns nothing: no provenance, no primary, no trace of the
    -- observation. Recording that a suppressed person was seen again is still recording it.
    IF v_phone_id IS NULL THEN
      CONTINUE;
    END IF;

    -- ═════════════════════════════════════════════════════════════
    -- Step 5 — provenance: append-only and idempotent.
    -- ═════════════════════════════════════════════════════════════
    -- ON CONFLICT DO NOTHING on (candidate_phone_id, source_event_key). Reprocessing the
    -- same callback recognises the same observation instead of appending a second row, and
    -- no UPDATE is needed — which matters, because migration 109 does not grant one.

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

  -- ═══════════════════════════════════════════════════════════════
  -- Step 6 — elect exactly one primary.
  -- ═══════════════════════════════════════════════════════════════
  -- The ORDER is the pure layer's decision (`buildPrimaryPreference`, whose first entry is
  -- the number the pre-4O-C path would have written, so the visible phone does not change
  -- for reasons nobody asked for). What this function decides is only ELIGIBILITY, and it
  -- decides it from the rows as they now stand: alive, numbered, not asserted invalid —
  -- the three conditions of migration 109's `..._primary_requires_live_number` CHECK, so a
  -- key this loop accepts can never be one the database would then reject.

  FOR v_pref IN
    SELECT r.dedupe_key, r.phone, r.phone_type, r.raw_type
    FROM jsonb_array_elements(p_primary_candidates) WITH ORDINALITY AS e(item, ord)
    CROSS JOIN LATERAL jsonb_to_record(e.item) AS r(
      dedupe_key text, phone text, phone_type text, raw_type text
    )
    ORDER BY e.ord
  LOOP
    SELECT p.id INTO v_primary_id
    FROM public.contact_enrichment_candidate_phones p
    WHERE p.candidate_id = p_candidate_id
      AND p.dedupe_key = v_pref.dedupe_key
      AND p.suppressed_at IS NULL
      AND p.normalized_phone IS NOT NULL
      AND p.phone_status <> 'invalid';

    IF v_primary_id IS NOT NULL THEN
      v_primary_key   := v_pref.dedupe_key;
      -- The scalar and its metadata come from the SAME entry as the elected key. This is
      -- the whole reason the triple travels with the key.
      v_scalar        := v_pref.phone;
      v_meta_type     := v_pref.phone_type;
      v_meta_raw_type := v_pref.raw_type;
      EXIT;
    END IF;
  END LOOP;

  IF v_primary_id IS NOT NULL THEN
    -- Demote first, promote second. The partial unique index does not tolerate two
    -- primaries even for an instant, and doing it in this order needs no window.
    UPDATE public.contact_enrichment_candidate_phones
       SET is_primary = false
     WHERE candidate_id = p_candidate_id
       AND is_primary
       AND id <> v_primary_id;

    UPDATE public.contact_enrichment_candidate_phones
       SET is_primary = true
     WHERE id = v_primary_id
       AND NOT is_primary;
  ELSE
    -- No preference from THIS event qualifies. The primary that was already there is left
    -- alone: nothing better turned up, and clearing it would leave the candidate with no
    -- primary without anyone having asked for that. The scalar then keeps the legacy
    -- behaviour, byte-for-byte what the caller wrote before 4O-C.
    SELECT p.dedupe_key INTO v_primary_key
    FROM public.contact_enrichment_candidate_phones p
    WHERE p.candidate_id = p_candidate_id AND p.is_primary;

    v_scalar        := p_legacy_phone;
    v_meta_type     := p_legacy_phone_type;
    v_meta_raw_type := p_legacy_raw_type;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 7 — the candidate: scalar phone plus terminal state.
  -- ═══════════════════════════════════════════════════════════════
  -- Same transaction as everything above, so the forbidden state — a visible phone with an
  -- incomplete collection — cannot be observed even for the duration of a query.

  v_phone_meta := jsonb_build_object(
    'number',   v_scalar,
    'type',     v_meta_type,
    'source',   'apollo_reveal',
    'raw_type', v_meta_raw_type
  );

  UPDATE public.contact_enrichment_candidates
     SET phone = v_scalar,
         -- Shallow merge of the single `phone` key, exactly as the callers'
         -- `{...candidate.enrichmentMetadata, phone: phoneMetadata}` does — except read
         -- from the LOCKED row, so a concurrent metadata write cannot be clobbered by a
         -- stale copy.
         enrichment_metadata = jsonb_set(
           COALESCE(enrichment_metadata, '{}'::jsonb), '{phone}', v_phone_meta, true
         ),
         phone_reveal_status              = p_phone_reveal_status,
         phone_reveal_provider            = p_phone_reveal_provider,
         phone_revealed_at                = p_phone_revealed_at,
         phone_reveal_completed_at        = p_phone_reveal_completed_at,
         -- COALESCE, not assignment: a NULL here means "this phase does not write this
         -- column", and overwriting it would erase the other phase's evidence.
         phone_reveal_webhook_received_at =
           COALESCE(p_phone_reveal_webhook_received_at, phone_reveal_webhook_received_at),
         phone_reveal_last_checked_at     =
           COALESCE(p_phone_reveal_last_checked_at, phone_reveal_last_checked_at),
         phone_reveal_cost_credits        = p_phone_reveal_cost_credits,
         phone_reveal_cost_source         = p_phone_reveal_cost_source,
         phone_reveal_error_code          = p_phone_reveal_error_code,
         phone_processing_basis           =
           COALESCE(p_phone_processing_basis, phone_processing_basis),
         apollo_person_id                 =
           COALESCE(p_apollo_person_id, apollo_person_id)
   WHERE id = p_candidate_id;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    -- Unreachable while the row is locked; raised rather than reported because it would
    -- mean the lock did not hold, and continuing would leave a collection with no terminal
    -- state. The message names the operation, never a value.
    RAISE EXCEPTION 'persist_candidate_apollo_phone_reveal_result: candidate terminal update did not affect exactly one row';
  END IF;

  RETURN jsonb_build_object(
    'status',                   'persisted',
    'inserted_phone_count',     v_inserted_count,
    'updated_phone_count',      v_updated_count,
    'inserted_source_count',    v_source_count,
    'suppressed_skipped_count', v_suppressed_count,
    'primary_dedupe_key',       v_primary_key,
    'primary_set',              v_primary_id IS NOT NULL,
    'candidate_terminalized',   true
  );
END $$;

COMMENT ON FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text
) IS
  'AGENT2A-PHONE-REVEAL-4O-C-R1 — persists an Apollo `revealed` phone result in ONE transaction: the canonical phone rows, their provenance, the single primary designation, the candidate scalar phone and the candidate revealed terminal state. Either all of it lands or none of it does; a partial collection is not reachable. Locks the candidate with SELECT FOR UPDATE, so a webhook and a recovery poll racing on the same candidate serialize instead of both electing a primary. Re-checks suppression tombstones INSIDE the lock and in the ON CONFLICT clauses: a tombstoned number is never rewritten, never gains provenance and never becomes primary, and a payload in which EVERY number is tombstoned fails closed without terminalizing the candidate. Idempotent by (candidate_id, dedupe_key) and (candidate_phone_id, source_event_key); a repeated event returns `idempotent` without rewriting anything, and an event the candidate has moved past returns `stale_event`. SECURITY INVOKER on purpose so migration 109 privilege ceiling still applies — it cannot DELETE a phone row or UPDATE a provenance row. No dynamic SQL, every written column named literally, terminal fields as individual typed parameters. Writes NO usage log, NO reservation and NO waterfall row: the accounting stays in phone_reveal_waterfall_runs / phone_reveal_credit_reservations / provider_usage_logs and must survive a failure it describes. Handles `revealed` ONLY and rejects any other status. Returns counts, flags and a SHA-256 dedupe key — never a phone number. Service-role only.';

-- ═══════════════════════════════════════════════════════════════════
-- 2. Execution privileges
-- ═══════════════════════════════════════════════════════════════════
-- PostgreSQL grants EXECUTE on a new function to PUBLIC. Left alone, that makes this
-- reachable through PostgREST with the anon key — and the argument from migration 104 § 9
-- applies unchanged: the reachability is the defect, whether or not RLS would then reject
-- the statements. `postgres` is included alongside `service_role` for the same reason 104
-- includes it: migrations and maintenance run as the owner.

REVOKE ALL ON FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text
) FROM anon;

REVOKE ALL ON FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text
) TO postgres, service_role;
