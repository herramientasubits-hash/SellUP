-- Migration 111: TRANSACTIONAL persistence of a Lusha `revealed` phone result
-- (Agente 2A · AGENT2A-PHONE-REVEAL-4O-D)
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS
-- ═══════════════════════════════════════════════════════════════════
--
-- Migration 110 made the Apollo `revealed` write atomic. Lusha was left out of that
-- block, and its fallback still did two things wrong at once:
--
--   1. it reduced `results[0].phones[]` to `phones[0]`, so a mobile in slot 1 lost to a
--      work line in slot 0 and was never stored at all — a number already paid for;
--   2. it wrote the candidate with a single UPDATE and no collection, so there was
--      nothing to be atomic WITH.
--
-- 4O-D fixes both. This function is the second half: every phone Lusha returned, its
-- provenance, the single primary designation, the visible scalar and the terminal
-- `revealed` state land together or not at all.
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
--   * every `revealed` terminal column the Lusha path writes today
--
-- OUTSIDE, and on purpose — the same boundary migration 110 argued for, unchanged:
--
--   * provider_usage_logs — the accounting ledger. Folding it in would put a log write
--     in the same rollback scope as the data write, so a failed persistence would also
--     erase the record THAT IT FAILED. The log is the evidence; it has to survive the
--     failure it describes. It also stays outside because the Lusha leg writes its log
--     on EVERY path, including the ones that never reach this function.
--   * phone_reveal_credit_reservations / phone_reveal_waterfall_runs — the money. They
--     are reconciled by their own functions (migration 104) against their own
--     invariants, one reservation and one run row per leg. Reserving or confirming
--     credits here would create a second set of books for the same spend.
--   * phone_reveal_cache — a pure optimizer, best-effort by contract, and untouched by
--     this milestone in any case.
--
-- So: EVERYTHING THAT DESCRIBES THE PHONE is atomic; everything that describes the
-- OPERATION stays where it already lives. Nothing that used to be transactional
-- stopped being so.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY A SEPARATE FUNCTION AND NOT AN EXTENDED 110
-- ═══════════════════════════════════════════════════════════════════
--
-- `persist_candidate_apollo_phone_reveal_result` carries its provider IN ITS NAME.
-- Making it write Lusha without renaming it would leave a function that lies about
-- what it does. Beyond the name, the two terminal states are NOT the same set of
-- columns: the async reveal stamps `phone_reveal_webhook_received_at` /
-- `phone_reveal_last_checked_at` and never touches `phone_revealed_by`,
-- `phone_reveal_attempt_count` or `phone_reveal_request_id`; Lusha resolves
-- synchronously and writes exactly those three — including a
-- `phone_reveal_request_id = NULL` that CLEARS the previous attempt's id rather than
-- leaving an orphan id next to `phone_reveal_provider = 'lusha'`. A merged function
-- would have to accept, on each path, parameters that path never uses.
--
-- Consequence, and the point of the choice: this file does not modify one line of
-- migration 110. Privileges and tests for the two functions are independent, and a
-- future change to the Lusha contract cannot reach the Apollo path.
--
-- ═══════════════════════════════════════════════════════════════════
-- THE OWNERSHIP TOKEN IS THE STATUS, BECAUSE THERE IS NO REQUEST ID
-- ═══════════════════════════════════════════════════════════════════
--
-- Migration 110 can ask "is this callback still the one that owns the candidate?" by
-- comparing an Apollo async id. Lusha issues no tracking id at all: the call is
-- synchronous and its client contract has no such field. So the token here is the
-- `phone_reveal_status` the caller OBSERVED when it loaded the candidate and decided
-- the leg was authorized — in practice always `no_phone_found`, which is exactly what
-- the eligibility gate requires. Under the lock, the row must still be in that state.
-- If another writer moved it in the window between the load and this call, the result
-- no longer belongs to this candidate and nothing is written.
--
-- That also means this function must NOT reject a candidate merely for being in a
-- terminal status — `no_phone_found` IS terminal, and it is the expected starting
-- point. What it rejects is a status that is not the one that authorized the leg.
--
-- ═══════════════════════════════════════════════════════════════════
-- CROSS-PROVIDER PRIMARY: NEVER SILENTLY WORSE
-- ═══════════════════════════════════════════════════════════════════
--
-- Migration 110 elects among the keys of its own event and, if none qualifies, leaves
-- whatever primary was already there. That is correct for a first reveal, and not
-- enough for a SECOND provider: a Lusha `work` line qualifies perfectly well, so a
-- naive election would promote it over an existing `mobile` and make the candidate's
-- visible phone worse than it was.
--
-- So step 6 compares the elected key against the LIVE INCUMBENT primary by
-- (type rank, status rank) and promotes only on a strict improvement. A tie keeps the
-- incumbent: nothing turned up better, and churning the visible number for a tie is a
-- change nobody asked for.
--
-- When the incumbent is retained, `phone` and `enrichment_metadata.phone` are NOT
-- touched. They already describe that number correctly, including its own provenance;
-- overwriting them with Lusha's would produce the "primary MOBILE / scalar WORK"
-- divergence this subsystem exists to prevent, and would relabel another provider's
-- number as `lusha_reveal`. The RESULT reports which happened
-- (`candidate_scalar_updated`), so the caller never has to guess.
--
-- Reachability, stated honestly: today's eligibility gate requires
-- `phone_reveal_status = 'no_phone_found'` AND no existing phone before a Lusha leg is
-- allowed, so a live incumbent primary is not reachable through the two wired paths.
-- The rule is implemented anyway because it is the invariant the data model owes, it
-- is cheap, and the gate that makes it unreachable is a gate — not a guarantee about
-- what the table contains.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY `SECURITY INVOKER` AND NOT `SECURITY DEFINER`
-- ═══════════════════════════════════════════════════════════════════
--
-- Same argument as migration 110, and it has not weakened. The service role already
-- holds every privilege this function uses: migration 109 granted it
-- SELECT/INSERT/UPDATE on the canonical table and SELECT/INSERT on provenance, and the
-- candidate table has been written by the same role since 068.
--
-- INVOKER is not a shortcut, it is the stronger choice: the function inherits the
-- caller's envelope, so it CANNOT delete a phone row (109 withholds DELETE, because
-- deleting a row deletes a tombstone) and CANNOT rewrite a provenance row (109
-- withholds UPDATE, because provenance whose writer can edit it is not provenance). A
-- DEFINER function owned by `postgres` would silently hand itself both.
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
-- Every column this function writes is named literally in its source. There is no
-- EXECUTE of a composed string anywhere. The candidate's terminal fields are
-- individual TYPED parameters for exactly that reason: a single `p_patch jsonb` applied
-- generically would be an arbitrary-column writer wearing a function's clothes.
--
-- The three collections are `jsonb` because they are variable-length, and they are
-- converted through `jsonb_to_recordset` / `jsonb_to_record` with an EXPLICIT, CLOSED
-- column list. Keys the contract does not mention are dropped by that conversion — they
-- cannot become columns. Values are validated BEFORE the first write, so a malformed
-- payload returns `invalid_input` with nothing written rather than aborting halfway.
--
-- Provenance rows are additionally required to be `lusha` / `reveal`. This is the Lusha
-- writer; accepting another provider's provenance here would let one path write
-- evidence about a provider it never called.
--
-- ═══════════════════════════════════════════════════════════════════
-- COST
-- ═══════════════════════════════════════════════════════════════════
--
-- `p_phone_reveal_cost_credits` is the cost of the RESPONSE, exactly as Lusha reported
-- it in `billing.creditsCharged`. It is written once, to one column, whether the
-- response carried one phone or five. There is no per-number cost column here and
-- migration 109 refused to add one for the same reason: a second set of books for the
-- same spend. A response that is fully paid for and yields only duplicates or
-- unusable numbers still records its real cost — the phones are what may be zero, not
-- the charge.
--
-- ═══════════════════════════════════════════════════════════════════
-- PRIVACY
-- ═══════════════════════════════════════════════════════════════════
--
-- The return value carries counts, flags, a status, and `primary_dedupe_key` (a
-- SHA-256, by migration 109's design, never the number). No phone number and no
-- display form ever appears in it. The `invalid_input` details are closed mechanical
-- strings describing WHICH FIELD was wrong, never its value, and no exception message
-- is built from a number.
--
-- ═══════════════════════════════════════════════════════════════════
-- SCOPE
-- ═══════════════════════════════════════════════════════════════════
--
-- `revealed` ONLY, and Lusha only. `no_phone_found` and `error` keep the
-- single-statement candidate update they already use (and in waterfall mode they do not
-- touch the candidate at all): they write no collection, so there is nothing to make
-- atomic WITH. The function rejects any status other than `revealed` and any provider
-- other than `lusha` rather than quietly accepting one.
--
-- NO table is created, altered or dropped. NO row is backfilled. NO trigger is added.
-- Migration 110 is not modified. This file adds exactly one function and its execution
-- privileges.
--
-- ⚠️ NOT APPLIED. This migration has NOT been applied to any remote Supabase project.
--
-- Idempotent: CREATE OR REPLACE, and the REVOKE/GRANT block declares an end state.

-- ═══════════════════════════════════════════════════════════════════
-- 1. The function
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  -- ── Identity of the operation ────────────────────────────────────
  p_candidate_id                  uuid,
  -- The `phone_reveal_status` the caller observed when it loaded the candidate and
  -- decided this leg was authorized. Compared, under the lock, against the live row.
  -- See "THE OWNERSHIP TOKEN IS THE STATUS" above.
  p_expected_phone_reveal_status  text,
  p_observed_at                   timestamptz,

  -- ── The collection (validated recordsets, never arbitrary columns) ──
  p_phones                        jsonb,
  p_sources                       jsonb,
  -- Primary candidates IN ORDER OF PREFERENCE, each carrying the terminal triple the
  -- pure layer computed FOR THAT KEY. Pairing the key with its own scalar is what makes
  -- divergence between the collection's primary and the candidate's scalar structurally
  -- impossible: whichever key this function elects, it writes THAT key's number.
  p_primary_candidates            jsonb,

  -- ── Legacy fallback: what the pre-4O-D path would have written ───
  p_legacy_phone                  text,
  p_legacy_phone_type             text,
  p_legacy_raw_type               text,
  -- The dedupe key OF that fallback number. Needed because the fallback is only safe to
  -- write if the number behind it is not itself a tombstone.
  p_legacy_dedupe_key             text,

  -- ── Terminal `revealed` state (one typed parameter per column) ───
  p_phone_reveal_status           text,          -- must be 'revealed'
  p_phone_reveal_provider         text,          -- must be 'lusha'
  -- ALWAYS written, and NULL is a VALUE here, not an absence: Lusha issues no tracking
  -- id, and writing the NULL is what CLEARS a previous provider's orphan id instead of
  -- leaving it next to `phone_reveal_provider = 'lusha'`.
  p_phone_reveal_request_id       text,
  p_phone_revealed_at             timestamptz,
  p_phone_reveal_completed_at     timestamptz,
  p_phone_revealed_by             uuid,
  -- ALWAYS written, and NULL is a VALUE: a response may report no figure, and
  -- `phone_reveal_cost_source` is what distinguishes "not reported" from "nobody looked".
  p_phone_reveal_cost_credits     integer,
  p_phone_reveal_cost_source      text,          -- 'reported' | 'assumed_cap' | 'unknown'
  -- ALWAYS written. On this path it is NULL by definition; the function refuses anything
  -- else rather than letting an error code ride along with a success.
  p_phone_reveal_error_code       text,
  p_phone_reveal_attempt_count    integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  -- Type priority, IDENTICAL to CANDIDATE_PHONE_TYPE_RANKING in phone-collection-core.ts
  -- and to migration 110's copy. If these lists diverged, a refreshed row would end up
  -- with a different aggregated type than the pure layer computed for the same
  -- observations, and the incumbent comparison below would rank on a different scale.
  c_type_ranking       text[] := ARRAY[
    'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
  ];

  v_candidate          record;
  v_row                record;
  v_src                record;
  v_pref               record;

  v_incoming_count     integer := 0;
  v_distinct_count     integer := 0;
  v_suppressed_count   integer := 0;
  v_viable_preference  integer := 0;
  v_legacy_suppressed  boolean := false;
  v_has_live_primary   boolean := false;
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

  -- Scalars and NOT a record on purpose: a `SELECT … INTO record` that matches no row
  -- leaves a record whose field access is legal but whose emptiness is easy to misread.
  -- Four plainly-typed NULLs make "there is no incumbent" a value, not a shape.
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
  -- ═══════════════════════════════════════════════════════════════
  -- Step 0 — shape validation. Fail-closed, and BEFORE any write.
  -- ═══════════════════════════════════════════════════════════════
  -- Every rejection below returns with zero rows touched. Validating after the first
  -- insert would mean relying on the rollback for something a check can prevent outright.

  IF p_candidate_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'candidate_id_missing');
  END IF;

  IF p_expected_phone_reveal_status IS NULL
     OR LENGTH(BTRIM(p_expected_phone_reveal_status)) = 0 THEN
    -- Without the token there is no ownership check, and a missing ownership check must
    -- never be silently skipped.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'expected_status_missing');
  END IF;

  IF p_observed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'observed_at_missing');
  END IF;

  -- This function is the `revealed` path of ONE provider and nothing else (see SCOPE).
  IF p_phone_reveal_status IS DISTINCT FROM 'revealed' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'status_not_revealed');
  END IF;

  IF p_phone_reveal_provider IS DISTINCT FROM 'lusha' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'provider_not_lusha');
  END IF;

  IF p_phone_reveal_error_code IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'error_code_not_null');
  END IF;

  IF p_phone_reveal_cost_source IS NULL
     OR p_phone_reveal_cost_source NOT IN ('reported', 'assumed_cap', 'unknown') THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'cost_source_unknown');
  END IF;

  IF p_phone_revealed_at IS NULL OR p_phone_reveal_completed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'terminal_timestamps_missing');
  END IF;

  IF p_phone_revealed_by IS NULL THEN
    -- The actor is audit evidence for a paid operation, not an optional label.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'revealed_by_missing');
  END IF;

  IF p_phone_reveal_attempt_count IS NULL OR p_phone_reveal_attempt_count < 1 THEN
    -- This path only exists because an attempt was made; a count below 1 would deny it.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'attempt_count_invalid');
  END IF;

  IF p_legacy_phone IS NULL OR LENGTH(BTRIM(p_legacy_phone)) = 0 THEN
    -- The legacy scalar is the floor: this path exists because Lusha delivered a phone.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'legacy_phone_missing');
  END IF;

  IF p_legacy_phone_type IS NULL OR NOT (p_legacy_phone_type = ANY (c_type_ranking)) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'legacy_phone_type_invalid');
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
    -- `mergeCandidatePhoneInputs` already collapses one key into one row. Two rows sharing
    -- a key would mean the pure layer and this function disagree about what a phone IS.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phone_key_duplicated');
  END IF;

  -- Provenance must be LUSHA provenance, acquired as a paid reveal. This is the Lusha
  -- writer: accepting another provider here would let one path write evidence about a
  -- provider it never called.
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
       OR s.provider IS DISTINCT FROM 'lusha'
       OR s.acquisition_mode IS DISTINCT FROM 'reveal'
       OR s.source_event_key IS NULL
       OR LENGTH(BTRIM(s.source_event_key)) = 0
       OR s.observed_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'source_row_invalid');
  END IF;

  -- Every provenance row must belong to a phone in THIS payload. A source pointing at a
  -- key that is not being written is provenance for nothing.
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

  -- Every preference key must be one of the payload's phones. A preference for a key that
  -- is not being written could promote a row this event never observed.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_primary_candidates) AS r(dedupe_key text)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
      WHERE x.dedupe_key = r.dedupe_key
    )
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'primary_candidate_orphan');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 1 — LOCK the candidate.
  -- ═══════════════════════════════════════════════════════════════
  -- The serialization point. Two triggers can genuinely reach the same candidate — the
  -- waterfall continuation runs best-effort from the webhook, the recovery cron and the
  -- manual L3 review — and although the run-level `claimLushaAttempt` is already atomic,
  -- a lock here is what makes the DATA write serialize too. Every check that follows is
  -- deliberately AFTER it, so nothing is decided on a snapshot a concurrent transaction
  -- can invalidate.

  SELECT c.id,
         c.enrichment_metadata,
         c.phone_reveal_status,
         c.phone_reveal_provider
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

  IF v_candidate.phone_reveal_status = 'revealed'
     AND v_candidate.phone_reveal_provider = 'lusha' THEN
    -- Already closed as a Lusha reveal: a concurrent caller won the lock and did exactly
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
      'candidate_scalar_updated', false,
      'candidate_terminalized',   true
    );
  END IF;

  IF v_candidate.phone_reveal_status IS DISTINCT FROM p_expected_phone_reveal_status THEN
    -- The candidate is no longer in the state that authorized this leg. Writing over it
    -- would overwrite a conclusion somebody else reached.
    RETURN jsonb_build_object('status', 'stale_event', 'detail', 'expected_status_superseded');
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

  -- A live primary already standing means the visible scalar does NOT depend on the legacy
  -- fallback, so a tombstoned legacy number cannot reach the visible field through it.
  SELECT EXISTS (
    SELECT 1 FROM public.contact_enrichment_candidate_phones e
    WHERE e.candidate_id = p_candidate_id
      AND e.is_primary
      AND e.suppressed_at IS NULL
  ) INTO v_has_live_primary;

  IF v_legacy_suppressed AND v_viable_preference = 0 AND NOT v_has_live_primary THEN
    -- Nothing electable survives, the fallback is a tombstone, and there is no standing
    -- primary to fall back on. Fail closed with nothing written and — the part that matters
    -- — WITHOUT terminalizing the candidate: a `revealed` row here would have to carry some
    -- number, and the only one left is one that was erased.
    --
    -- This subsumes the simpler "every number in the payload is a tombstone" case, since the
    -- legacy number is always one of the payload's numbers.
    --
    -- DECLARED LIMIT, identical to migration 110's: a permanent tombstone makes the leg
    -- resolve as unterminalized on every retry, always at whatever the provider already
    -- charged, until an operator intervenes. That is chosen over putting an erased number
    -- back in front of a user. The general suppression terminal policy is NOT resolved here.
    RETURN jsonb_build_object(
      'status',                   'suppressed',
      'inserted_phone_count',     0,
      'updated_phone_count',      0,
      'inserted_source_count',    0,
      'suppressed_skipped_count', v_suppressed_count,
      'primary_dedupe_key',       NULL,
      'primary_set',              false,
      'candidate_scalar_updated', false,
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
  -- `is_primary` is false for every INSERT here and elected in step 6. Promoting during the
  -- insert would collide with the single-primary partial index while the previous primary is
  -- still standing. The ON CONFLICT branch does NOT touch `is_primary`, so a row that was
  -- already primary and shows up again in this payload keeps its designation until step 6
  -- decides otherwise.

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
        -- number is reporting its own coverage, so `invalid` never demotes a `valid`. This
        -- is what lets a number the other provider confirmed keep its `valid` when Lusha —
        -- which reports no per-number status at all — observes it again as `unknown`.
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
      -- the statement — turning a privacy rule into a rollback.
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
    -- same response recognises the same observation instead of appending a second row, and
    -- no UPDATE is needed — which matters, because migration 109 does not grant one.
    --
    -- This is also where the cross-provider guarantee materialises: the same number seen by
    -- both providers is ONE canonical row with TWO provenance rows, because the keys differ
    -- by provider and neither overwrites the other.

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
  -- Step 6 — elect exactly one primary, never a worse one.
  -- ═══════════════════════════════════════════════════════════════
  -- The ORDER is the pure layer's decision. What this function decides is ELIGIBILITY —
  -- from the rows as they NOW stand: alive, numbered, not asserted invalid, which are the
  -- three conditions of migration 109's `..._primary_requires_live_number` CHECK, so a key
  -- this loop accepts can never be one the database would then reject — and, unlike
  -- migration 110, whether the winner actually IMPROVES on the incumbent.

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
      -- The scalar and its metadata come from the SAME entry as the elected key. This is
      -- the whole reason the triple travels with the key.
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
      -- The incumbent is as good or better. It KEEPS the designation, and the visible
      -- fields are left exactly as they are: they already describe that number, with its
      -- own provenance. Relabelling it as this provider's reveal, or replacing it with a
      -- worse number, are both changes nobody asked for.
      v_primary_id     := v_inc_id;
      v_primary_key    := v_inc_key;
      v_scalar_updated := false;
    ELSE
      -- A strict improvement (or there was no incumbent, or the incumbent IS this key).
      v_primary_id      := v_chosen_id;
      v_primary_key     := v_chosen_key;
      v_scalar_updated  := true;
      v_scalar          := v_chosen_phone;
      v_meta_type       := v_chosen_type;
      v_meta_raw_type   := v_chosen_raw_type;
    END IF;
  ELSIF v_inc_id IS NOT NULL THEN
    -- Nothing from this response qualifies, but a primary is already standing. It is kept
    -- and the visible fields are left alone — the coherent reading, and the one that cannot
    -- put a worse number in front of a user.
    v_primary_id     := v_inc_id;
    v_primary_key    := v_inc_key;
    v_scalar_updated := false;
  ELSE
    -- No primary at all: neither this response nor the table has an electable number. The
    -- scalar keeps the LEGACY behaviour, byte-for-byte what the caller wrote before 4O-D.
    -- The collection is left without a primary, which is the honest reading of a number
    -- that migration 109's CHECK will not let be one.
    v_primary_id     := NULL;
    v_primary_key    := NULL;
    v_scalar_updated := true;
    v_scalar         := p_legacy_phone;
    v_meta_type      := p_legacy_phone_type;
    v_meta_raw_type  := p_legacy_raw_type;
  END IF;

  IF v_primary_id IS NOT NULL THEN
    -- Demote first, promote second. The partial unique index does not tolerate two
    -- primaries even for an instant, and doing it in this order needs no window. Both
    -- statements are no-ops when the incumbent already IS the elected row.
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

  -- ═══════════════════════════════════════════════════════════════
  -- Step 7 — the candidate: scalar phone plus terminal state.
  -- ═══════════════════════════════════════════════════════════════
  -- Same transaction as everything above, so the forbidden state — a visible phone with an
  -- incomplete collection — cannot be observed even for the duration of a query.
  --
  -- `phone` and `enrichment_metadata` are written ONLY when this response's number won.
  -- When the incumbent was retained they are conditionally skipped by the CASE below
  -- rather than by a second statement, so there is still exactly one UPDATE and one
  -- ROW_COUNT to verify.

  v_phone_meta := jsonb_build_object(
    'number',   v_scalar,
    'type',     v_meta_type,
    'source',   'lusha_reveal',
    'raw_type', v_meta_raw_type
  );

  UPDATE public.contact_enrichment_candidates
     SET phone = CASE WHEN v_scalar_updated THEN v_scalar ELSE phone END,
         -- Shallow merge of the single `phone` key, exactly as the caller's
         -- `{...candidate.enrichmentMetadata, phone: phoneMetadata}` does — except read
         -- from the LOCKED row, so a concurrent metadata write cannot be clobbered by a
         -- stale copy.
         enrichment_metadata = CASE
           WHEN v_scalar_updated THEN jsonb_set(
             COALESCE(enrichment_metadata, '{}'::jsonb), '{phone}', v_phone_meta, true
           )
           ELSE enrichment_metadata
         END,
         phone_reveal_status        = p_phone_reveal_status,
         phone_reveal_provider      = p_phone_reveal_provider,
         -- Written unconditionally, NULL included: that NULL is what clears a previous
         -- provider's orphan correlation id off a row whose provider is now `lusha`.
         phone_reveal_request_id    = p_phone_reveal_request_id,
         phone_revealed_at          = p_phone_revealed_at,
         phone_reveal_completed_at  = p_phone_reveal_completed_at,
         phone_revealed_by          = p_phone_revealed_by,
         phone_reveal_cost_credits  = p_phone_reveal_cost_credits,
         phone_reveal_cost_source   = p_phone_reveal_cost_source,
         phone_reveal_error_code    = p_phone_reveal_error_code,
         phone_reveal_attempt_count = p_phone_reveal_attempt_count
   WHERE id = p_candidate_id;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    -- Unreachable while the row is locked; raised rather than reported because it would
    -- mean the lock did not hold, and continuing would leave a collection with no terminal
    -- state. The message names the operation, never a value.
    RAISE EXCEPTION 'persist_candidate_lusha_phone_reveal_result: candidate terminal update did not affect exactly one row';
  END IF;

  RETURN jsonb_build_object(
    'status',                   'persisted',
    'inserted_phone_count',     v_inserted_count,
    'updated_phone_count',      v_updated_count,
    'inserted_source_count',    v_source_count,
    'suppressed_skipped_count', v_suppressed_count,
    'primary_dedupe_key',       v_primary_key,
    'primary_set',              v_primary_id IS NOT NULL,
    'candidate_scalar_updated', v_scalar_updated,
    'candidate_terminalized',   true
  );
END $$;

COMMENT ON FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text, text,
  timestamptz, timestamptz, uuid, integer, text, text, integer
) IS
  'AGENT2A-PHONE-REVEAL-4O-D — persists a Lusha `revealed` phone result in ONE transaction: every canonical phone the response carried, their provenance, the single primary designation, the candidate scalar phone and the candidate revealed terminal state. Either all of it lands or none of it does; a partial collection is not reachable. Locks the candidate with SELECT FOR UPDATE. Its ownership token is the observed `phone_reveal_status` (Lusha issues no tracking id): under the lock the row must still be in the state that authorized the leg, otherwise `stale_event`. Elects a primary only on a STRICT improvement over the live incumbent by (type rank, status rank), so a Lusha work line never displaces an existing mobile; when the incumbent is retained, `phone` and `enrichment_metadata.phone` are left untouched and `candidate_scalar_updated` is false. Re-checks suppression tombstones INSIDE the lock and in the ON CONFLICT clauses: a tombstoned number is never rewritten, never gains provenance and never becomes primary, and a payload whose only usable number is tombstoned fails closed without terminalizing the candidate. Merges rather than replaces, so a number the other provider already stored keeps its row and gains a second provenance. Idempotent by (candidate_id, dedupe_key) and (candidate_phone_id, source_event_key); a candidate already closed as a Lusha reveal returns `idempotent` without rewriting anything. Accepts ONLY `lusha` / `reveal` provenance and ONLY the `revealed` status. Cost is PER RESPONSE, written once to phone_reveal_cost_credits and never divided among or multiplied by the numbers. Writes NO usage log, NO reservation and NO waterfall row: the accounting stays in phone_reveal_waterfall_runs / phone_reveal_credit_reservations / provider_usage_logs and must survive a failure it describes. SECURITY INVOKER on purpose so migration 109 privilege ceiling still applies — it cannot DELETE a phone row or UPDATE a provenance row. Does not modify migration 110. No dynamic SQL, every written column named literally, terminal fields as individual typed parameters. Returns counts, flags and a SHA-256 dedupe key — never a phone number. Service-role only.';

-- ═══════════════════════════════════════════════════════════════════
-- 2. Execution privileges
-- ═══════════════════════════════════════════════════════════════════
-- PostgreSQL grants EXECUTE on a new function to PUBLIC. Left alone, that makes this
-- reachable through PostgREST with the anon key — and the argument from migration 104 § 9
-- applies unchanged: the reachability is the defect, whether or not RLS would then reject
-- the statements. `postgres` is included alongside `service_role` for the same reason 104
-- includes it: migrations and maintenance run as the owner.

REVOKE ALL ON FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text, text,
  timestamptz, timestamptz, uuid, integer, text, text, integer
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text, text,
  timestamptz, timestamptz, uuid, integer, text, text, integer
) FROM anon;

REVOKE ALL ON FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text, text,
  timestamptz, timestamptz, uuid, integer, text, text, integer
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text, text,
  timestamptz, timestamptz, uuid, integer, text, text, integer
) TO postgres, service_role;
