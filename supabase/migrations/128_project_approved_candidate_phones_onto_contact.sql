-- Migration 128: project an APPROVED candidate's official phone collection onto the contact
-- that its OWN approval created (Agente 2A · AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1)
--
-- ═══════════════════════════════════════════════════════════════════
-- THE GAP THIS CLOSES, STATED AS A FACT ABOUT THE SCHEMA
-- ═══════════════════════════════════════════════════════════════════
--
-- Promotion of a candidate's numbers onto an OFFICIAL contact happens in exactly two places in
-- this database, and both of them are one-shot events tied to a review verdict:
--
--   116 `approve_contact_candidate_with_phones`      — runs INSIDE the approval, and returns
--                                                      `already_approved` with ZERO writes for a
--                                                      candidate that is already `approved`;
--   117 `merge_contact_candidate_into_existing_contact`
--                                                    — refuses any candidate whose status is not
--                                                      `duplicate`, and any `p_contact_id` that is
--                                                      not the `matched_contacts_id` the server
--                                                      recorded for that duplicate verdict.
--
-- Neither of them can run for an APPROVED candidate. `110`/`111`/`122` — the functions that
-- persist a phone reveal — do not contain the words `contacts` or `contact_phones` at all: they
-- write the CANDIDATE's collection and stop there. So a number acquired AFTER the approval, by a
-- reveal started from anywhere, lands in `contact_enrichment_candidate_phones` and has no path to
-- the contact. It is not hidden by a policy or lost by a bug; there is no statement anywhere in
-- the schema that would move it.
--
-- That is the whole of the Priscilla case: candidate `approved`, contact created from it,
-- `contacts.phone` NULL, `contact_phones` empty. Revealing her phone with the pipeline that
-- already exists would have written a number nobody could ever read from her contact.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY A THIRD FUNCTION AND NOT A BRANCH IN 116 OR 117
-- ═══════════════════════════════════════════════════════════════════
--
-- For 116's own stated reason for not absorbing 117: 116 is LIVE in Production and runs every
-- time somebody approves a candidate. Re-issuing it with a branch that skips its INSERT — or
-- widening `c_approvable` to include `approved` — would put the path that runs every day at risk
-- to buy a path that runs after the fact. 117 is likewise the duplicate path and its refusal of
-- anything that is not `duplicate` is a load-bearing IDOR guard, not an accident to relax.
--
-- So this function is separate, it is ADDITIVE, and it creates nothing:
--
--   * there is no `INSERT INTO public.contacts` in this file. A contact is never created, never
--     duplicated, and `p_contact_id` must already exist;
--   * there is no `UPDATE public.contact_enrichment_candidates` in this file. The candidate is
--     read and locked, never re-terminalised: its verdict was reached by a human and this
--     function is not a second review;
--   * it calls no provider, reserves and consumes no credit, and writes no usage log, no
--     reservation and no waterfall row. Every number it promotes was already observed and
--     already paid for by the reveal that persisted it;
--   * it reaches no HubSpot.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHAT IT REFUSES TO DECIDE
-- ═══════════════════════════════════════════════════════════════════
--
-- WHO the contact is. There is not one comparison of an e-mail, a name, a phone number or a
-- LinkedIn URL in this file. The destination is read from `matched_contacts_id` — a column 116
-- wrote, inside the approval transaction, to the contact it had just created — and the caller's
-- `p_contact_id` must EQUAL it. A client that posts a different contact uuid is refused, so the
-- id in the request is a CONFIRMATION token and never an instruction. This is 117's guard,
-- verbatim, over 116's link instead of over the duplicate link.
--
-- WHETHER the operator MAY project. That is the server action's decision, taken with the same
-- role authority the reveal itself requires. What this function re-checks is what a pre-lock read
-- cannot promise: that the candidate is still `approved`, that it still points at this contact,
-- that the contact still exists in the same account and is not archived, and that the PERSON has
-- not been erased in the meantime.
--
-- ═══════════════════════════════════════════════════════════════════
-- THE INCUMBENT IS NEVER DEMOTED AND THE LEGACY SCALAR IS NEVER OVERWRITTEN
-- ═══════════════════════════════════════════════════════════════════
--
--   1. A LIVE OFFICIAL PRIMARY WINS, ALWAYS. If the contact already holds a primary in
--      `contact_phones`, this function keeps it and elects nothing. Projection is additive; it is
--      not a repriorisation. This is 117's layer 1.
--
--   2. THE LEGACY SCALAR `contacts.phone` IS WRITTEN ONLY WHEN IT WAS NULL, read under the
--      contact lock — AND only when the elected primary is a row THIS transaction inserted.
--
--      The second half is stricter than 117 and it is deliberate. A contact whose scalar is NULL
--      while live canonical rows exist is, among other things, exactly what 115's erasure leaves
--      behind when it withdraws the primary but not its siblings. Electing one of those siblings
--      and writing it into the scalar would be putting back, through a side door, a number an
--      erasure removed. So the scalar is only ever written from NEW evidence: the number this
--      projection actually brought.
--
--   3. NOTHING IS EVER RESURRECTED. Every canonical INSERT carries
--      `ON CONFLICT (contact_id, dedupe_key) DO NOTHING` and every provenance join requires
--      `suppressed_at IS NULL` on both sides, so an existing official tombstone is never
--      overwritten and never gains new provenance, and a SUPPRESSED candidate phone is never
--      promoted. There is no statement in this file that can set `suppressed_at` back to NULL.
--
-- ═══════════════════════════════════════════════════════════════════
-- THE ONE STATE IT REFUSES OUTRIGHT: SCALAR SET, COLLECTION EMPTY
-- ═══════════════════════════════════════════════════════════════════
--
-- `contacts.phone` NOT NULL with zero live rows in `contact_phones` is the LEGACY shape 117
-- describes at length, and 117 handles it by BOOTSTRAPPING the incumbent into the collection so
-- that the collection's primary and the scalar cannot disagree about the same person.
--
-- This function does not bootstrap and does not need to, because it refuses that state instead:
-- it returns `scalar_incumbent_unprojectable` having written NOTHING. Two reasons, and the
-- second is the load-bearing one:
--
--   * the product contract above it never offers a post-approval reveal to a contact that
--     already holds a phone — a contact with a number is offered reuse, not a new purchase — so
--     reaching this state means something raced, and refusing is the correct answer to a race;
--
--   * bootstrapping an incumbent means INVERTING its provenance, and a provenance that does not
--     invert unambiguously (`provider_payload`, `unknown`, NULL) must not be fabricated.
--     HISTORICAL_MANUAL_NULL_PROVENANCE_PENDING is 117's open question, not this milestone's, and
--     answering it twice in two functions is how the two end up disagreeing.
--
-- ═══════════════════════════════════════════════════════════════════
-- PRIVACY DISCOVERABILITY IS ALREADY SATISFIED, SO NO METADATA IS WRITTEN
-- ═══════════════════════════════════════════════════════════════════
--
-- 117 has to APPEND to `contacts.metadata.merged_candidate_ids`, because before its merge the
-- contact carried no attestation linking it to that candidate and the DSAR path authorises an
-- erasure only on the contact's own attestation of the write.
--
-- Here that attestation already exists and was written by the approval itself:
-- `contacts.metadata.source_candidate_id` (the contact was BORN of this candidate) and
-- `enrichment_metadata.review.created_contact_id` plus `matched_contacts_id` on the candidate
-- side. The DSAR propagation path already discovers this pair in both directions. Writing a
-- second, redundant link would add a third thing to keep in agreement and buy nothing.
--
-- ═══════════════════════════════════════════════════════════════════
-- CONCURRENCY
-- ═══════════════════════════════════════════════════════════════════
--
-- Lock order is candidate → contact → `contact_phones`, the SAME order 112/115/116/117 take, so
-- projection and erasure serialise against each other instead of deadlocking. The candidate lock
-- is also what makes a double click safe: the loser re-reads a state in which its numbers are
-- already promoted and every INSERT it attempts conflicts into DO NOTHING, so it writes nothing
-- and reports zero insertions. Idempotency is therefore a property of the unique indexes, not of
-- a flag this function has to remember to check.
--
-- ═══════════════════════════════════════════════════════════════════
-- IDEMPOTENT, ADDITIVE, REVERSIBLE
-- ═══════════════════════════════════════════════════════════════════
--
-- `CREATE OR REPLACE FUNCTION` only. This migration creates no table, no column, no index, no
-- trigger and no policy, and it edits no earlier migration. Rolling it back is dropping one
-- function; nothing in the database depends on it existing.

-- ═══════════════════════════════════════════════════════════════════
-- 1. The function
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.project_approved_candidate_phones_onto_contact(
  p_candidate_id    uuid,
  p_contact_id      uuid,
  p_scalar_fallback jsonb,
  p_actor_id        uuid,
  p_now             timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  -- 112 / 115 / 116 rankings, verbatim. A second ranking over the same vocabulary is how the
  -- candidate and the official collection end up electing different primaries for one person.
  c_type_ranking   text[] := ARRAY[
    'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
  ];
  c_source_ranking text[] := ARRAY[
    'apollo:reveal', 'lusha:reveal', 'apollo_cache:cache', 'apollo:search'
  ];

  -- The ONLY candidate status this function acts on. `pending_review` belongs to 116 and
  -- `duplicate` to 117; acting on either from here would be running an approval or a merge
  -- without its own guards.
  c_projectable    text[] := ARRAY['approved'];

  v_candidate      RECORD;
  v_contact        RECORD;
  v_account_id     uuid;
  v_person_id      text;

  v_fb_provider    text;
  v_fb_mode        text;
  v_fb_norm        text;
  v_fb_display     text;
  v_fb_key         text;
  v_fb_type        text;
  v_fb_event       text;
  v_fb_phone_id    uuid;
  v_scalar_fb      text    := 'absent';

  v_live_rows      integer := 0;
  v_seen           integer := 0;
  v_inserted       integer := 0;
  v_reused         integer := 0;
  v_skipped        integer := 0;
  v_src_seen       integer := 0;
  v_src_inserted   integer := 0;
  v_src_reused     integer := 0;

  v_existing_primary uuid;
  v_primary_id     uuid;
  v_primary_key    text;
  v_primary_new    boolean := false;
  v_primary        RECORD;
  v_src            RECORD;
  v_scalar         text;
  v_scalar_type    text;
  v_scalar_source  text;
  v_scalar_raw     text;
  v_scalar_at      timestamptz;
  v_scalar_basis   text;
  v_scalar_synced  boolean := false;
  v_rows           integer := 0;
  v_inserted_ids   uuid[]  := ARRAY[]::uuid[];
BEGIN
  -- ═══════════════════════════════════════════════════════════════
  -- Step 0 — validation. Fail closed BEFORE any write.
  -- ═══════════════════════════════════════════════════════════════

  IF p_candidate_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'candidate_id_missing');
  END IF;

  IF p_contact_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'contact_id_missing');
  END IF;

  IF p_now IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'now_missing');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 1 — lock the candidate. FIRST statement that touches a row.
  -- ═══════════════════════════════════════════════════════════════
  -- Everything below is decided on a snapshot this lock protects, never on the pre-call read
  -- the server action did.

  SELECT c.id,
         c.status,
         c.phone,
         c.matched_contacts_id,
         c.enrichment_run_id,
         c.apollo_person_id,
         c.source,
         c.source_contact_id,
         c.phone_processing_basis
    INTO v_candidate
  FROM public.contact_enrichment_candidates c
  WHERE c.id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'candidate_not_found', 'detail', 'candidate_missing');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 2 — the candidate must be APPROVED, under the lock.
  -- ═══════════════════════════════════════════════════════════════

  IF NOT (v_candidate.status = ANY (c_projectable)) THEN
    RETURN jsonb_build_object(
      'status', 'candidate_not_projectable',
      'detail', 'candidate_status_not_approved'
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 3 — the IDOR guard: the destination is the SERVER's link.
  -- ═══════════════════════════════════════════════════════════════
  -- 116 wrote `matched_contacts_id` to the contact it created, inside the approval transaction.
  -- The caller's id is a confirmation of that value, never a choice of destination.

  IF v_candidate.matched_contacts_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'contact_link_missing',
      'detail', 'candidate_has_no_matched_contact'
    );
  END IF;

  IF v_candidate.matched_contacts_id IS DISTINCT FROM p_contact_id THEN
    RETURN jsonb_build_object(
      'status', 'contact_link_mismatch',
      'detail', 'contact_id_is_not_matched_contact'
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 4 — PERSON suppression, re-checked UNDER the lock (4O-E3 / 113).
  -- ═══════════════════════════════════════════════════════════════
  -- 113's key resolution, statement for statement, exactly as 116 and 117 do it. No person id
  -- or no account means there is no key to match, and that limit is NOT turned into a block by
  -- inference — and no matching by phone, e-mail, name or LinkedIn is added here either.

  SELECT r.account_id INTO v_account_id
  FROM public.contact_enrichment_runs r
  WHERE r.id = v_candidate.enrichment_run_id;

  v_person_id := COALESCE(
    public.phone_reveal_normalized_apollo_person_id(v_candidate.apollo_person_id),
    CASE WHEN v_candidate.source = 'apollo'
      THEN public.phone_reveal_normalized_apollo_person_id(v_candidate.source_contact_id)
    END
  );

  IF v_person_id IS NOT NULL
     AND v_account_id IS NOT NULL
     AND public.phone_reveal_person_suppression_exists(v_person_id, v_account_id) THEN
    -- Fail closed with NOTHING written. An erasure that commits inside this window must win.
    RETURN jsonb_build_object(
      'status',       'person_suppressed',
      'candidate_id', p_candidate_id,
      'contact_id',   NULL,
      'detail',       'person_suppression_tombstone'
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 5 — lock the contact, in the position 115/116/117 take it.
  -- ═══════════════════════════════════════════════════════════════

  SELECT ct.id, ct.account_id, ct.phone, ct.archived_at
    INTO v_contact
  FROM public.contacts ct
  WHERE ct.id = p_contact_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'contact_not_found', 'detail', 'contact_missing');
  END IF;

  -- `matched_contacts_id` is a FK with no account clause. The account is re-asserted here so a
  -- candidate whose run belongs to one account can never write onto another account's contact.
  IF v_account_id IS NOT NULL AND v_contact.account_id IS DISTINCT FROM v_account_id THEN
    RETURN jsonb_build_object('status', 'contact_mismatch', 'detail', 'contact_account_mismatch');
  END IF;

  IF v_contact.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'contact_not_projectable',
      'detail', 'contact_archived'
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 6 — the legacy shape this function refuses.
  -- ═══════════════════════════════════════════════════════════════
  -- Scalar SET with an empty official collection is 117's bootstrap case. See the header: it is
  -- refused here rather than answered a second time, with NOTHING written.

  SELECT COUNT(*) INTO v_live_rows
  FROM public.contact_phones op
  WHERE op.contact_id = p_contact_id
    AND op.suppressed_at IS NULL;

  IF NULLIF(BTRIM(COALESCE(v_contact.phone, '')), '') IS NOT NULL AND v_live_rows = 0 THEN
    RETURN jsonb_build_object(
      'status',       'scalar_incumbent_unprojectable',
      'candidate_id', p_candidate_id,
      'contact_id',   p_contact_id,
      'detail',       'legacy_scalar_without_official_collection'
    );
  END IF;

  -- The incumbent primary is read BEFORE anything is inserted: layer 1 of the header depends on
  -- knowing whether the contact already had one, and after step 7 that is no longer knowable.
  SELECT op.id INTO v_existing_primary
  FROM public.contact_phones op
  WHERE op.contact_id = p_contact_id
    AND op.is_primary
    AND op.suppressed_at IS NULL
  LIMIT 1;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 7 — promote the LIVE candidate collection, additively.
  -- ═══════════════════════════════════════════════════════════════
  -- 116's step 6, with one difference: `RETURNING id` is collected, because the scalar rule of
  -- this function needs to know which rows are NEW.

  SELECT COUNT(*) INTO v_seen
  FROM public.contact_enrichment_candidate_phones p
  WHERE p.candidate_id = p_candidate_id;

  SELECT COUNT(*) INTO v_skipped
  FROM public.contact_enrichment_candidate_phones p
  WHERE p.candidate_id = p_candidate_id
    AND p.suppressed_at IS NOT NULL;

  WITH promoted AS (
    INSERT INTO public.contact_phones (
      contact_id, normalized_phone, display_phone, dedupe_key,
      phone_type, phone_status, is_primary, first_seen_at, last_seen_at
    )
    SELECT p_contact_id,
           p.normalized_phone,
           p.display_phone,
           p.dedupe_key,
           p.phone_type,
           p.phone_status,
           false,
           p.first_seen_at,
           p.last_seen_at
    FROM public.contact_enrichment_candidate_phones p
    WHERE p.candidate_id = p_candidate_id
      AND p.suppressed_at IS NULL
    ORDER BY p.dedupe_key
    ON CONFLICT (contact_id, dedupe_key) DO NOTHING
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_inserted_ids FROM promoted;

  v_inserted := COALESCE(array_length(v_inserted_ids, 1), 0);

  SELECT GREATEST(COUNT(*) - v_inserted, 0) INTO v_reused
  FROM public.contact_enrichment_candidate_phones p
  WHERE p.candidate_id = p_candidate_id
    AND p.suppressed_at IS NULL;

  -- ── Provenance ────────────────────────────────────────────────
  -- 116's step 6 provenance block, verbatim, including the `v1:promoted:` namespace: the SAME
  -- paid observation promoted by the approval and re-promoted here collapses onto ONE source row
  -- because the key is deterministic and operation-derived. That is what makes re-running this
  -- function free of duplicate provenance.

  SELECT COUNT(*) INTO v_src_seen
  FROM public.contact_enrichment_candidate_phone_sources s
  JOIN public.contact_enrichment_candidate_phones p ON p.id = s.candidate_phone_id
  WHERE p.candidate_id = p_candidate_id
    AND p.suppressed_at IS NULL;

  WITH promoted_sources AS (
    INSERT INTO public.contact_phone_sources (
      contact_phone_id, provider, acquisition_mode,
      raw_provider_type, raw_provider_status,
      waterfall_run_id, reservation_id, provider_usage_log_id,
      candidate_phone_id, source_event_key, observed_at
    )
    SELECT op.id,
           s.provider,
           s.acquisition_mode,
           s.raw_provider_type,
           s.raw_provider_status,
           s.waterfall_run_id,
           s.reservation_id,
           s.provider_usage_log_id,
           s.candidate_phone_id,
           'v1:promoted:' || s.source_event_key,
           s.observed_at
    FROM public.contact_enrichment_candidate_phone_sources s
    JOIN public.contact_enrichment_candidate_phones cp ON cp.id = s.candidate_phone_id
    JOIN public.contact_phones op
      ON op.contact_id = p_contact_id
     AND op.dedupe_key = cp.dedupe_key
     AND op.suppressed_at IS NULL
    WHERE cp.candidate_id = p_candidate_id
      AND cp.suppressed_at IS NULL
    ORDER BY op.id, s.source_event_key
    ON CONFLICT (contact_phone_id, source_event_key) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_src_inserted FROM promoted_sources;

  v_src_reused := GREATEST(v_src_seen - v_src_inserted, 0);

  -- ═══════════════════════════════════════════════════════════════
  -- Step 8 — the scalar-only candidate.
  -- ═══════════════════════════════════════════════════════════════
  -- 116's step 7, unchanged in substance: only when the collection produced NOTHING live, and
  -- only when the provenance inverted unambiguously in the caller's PURE builder
  -- (`buildCandidateScalarFallback`) — the same builder 116 and 117 use. The vocabularies are
  -- re-validated here and never trusted from the payload.

  IF v_inserted = 0 AND v_reused = 0 THEN
    IF p_scalar_fallback IS NULL OR jsonb_typeof(p_scalar_fallback) <> 'object' THEN
      v_scalar_fb := CASE
        WHEN NULLIF(BTRIM(COALESCE(v_candidate.phone, '')), '') IS NULL THEN 'absent'
        ELSE 'unrepresentable'
      END;
    ELSE
      v_fb_provider := p_scalar_fallback ->> 'provider';
      v_fb_mode     := p_scalar_fallback ->> 'acquisition_mode';
      v_fb_norm     := NULLIF(BTRIM(COALESCE(p_scalar_fallback ->> 'normalized_phone', '')), '');
      v_fb_display  := NULLIF(BTRIM(COALESCE(p_scalar_fallback ->> 'display_phone', '')), '');
      v_fb_key      := NULLIF(BTRIM(COALESCE(p_scalar_fallback ->> 'dedupe_key', '')), '');
      v_fb_type     := p_scalar_fallback ->> 'phone_type';
      v_fb_event    := NULLIF(BTRIM(COALESCE(p_scalar_fallback ->> 'source_event_key', '')), '');

      IF v_fb_provider IS NULL
         OR NOT (v_fb_provider = ANY (ARRAY['apollo', 'lusha', 'apollo_cache', 'manual', 'unknown']))
         OR v_fb_mode IS NULL
         OR NOT (v_fb_mode = ANY (ARRAY['search', 'reveal', 'waterfall', 'cache', 'manual']))
         OR v_fb_norm IS NULL
         OR v_fb_key IS NULL
         OR v_fb_event IS NULL THEN
        v_scalar_fb := 'unrepresentable';
      ELSE
        IF v_fb_type IS NOT NULL AND NOT (v_fb_type = ANY (c_type_ranking)) THEN
          v_fb_type := NULL;
        END IF;

        INSERT INTO public.contact_phones (
          contact_id, normalized_phone, display_phone, dedupe_key,
          phone_type, phone_status, is_primary, first_seen_at, last_seen_at
        )
        VALUES (
          p_contact_id, v_fb_norm, COALESCE(v_fb_display, v_fb_norm), v_fb_key,
          v_fb_type, 'unknown', false, p_now, p_now
        )
        ON CONFLICT (contact_id, dedupe_key) DO NOTHING
        RETURNING id INTO v_fb_phone_id;

        IF v_fb_phone_id IS NULL THEN
          -- A live row or a tombstone already holds this key. Never resurrected, never counted.
          v_scalar_fb := 'unrepresentable';
        ELSE
          v_inserted     := v_inserted + 1;
          v_seen         := v_seen + 1;
          v_inserted_ids := v_inserted_ids || v_fb_phone_id;

          INSERT INTO public.contact_phone_sources (
            contact_phone_id, provider, acquisition_mode,
            raw_provider_type, source_event_key, observed_at
          )
          VALUES (
            v_fb_phone_id, v_fb_provider, v_fb_mode,
            NULLIF(BTRIM(COALESCE(p_scalar_fallback ->> 'raw_provider_type', '')), ''),
            'v1:promoted:' || v_fb_event,
            p_now
          )
          ON CONFLICT (contact_phone_id, source_event_key) DO NOTHING;

          GET DIAGNOSTICS v_rows = ROW_COUNT;
          v_src_inserted := v_src_inserted + v_rows;
          v_src_seen     := v_src_seen + 1;
          v_scalar_fb    := 'promoted';
        END IF;
      END IF;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 9 — elect a primary ONLY when the contact has none.
  -- ═══════════════════════════════════════════════════════════════
  -- Layer 1 of the header. An incumbent live primary is kept exactly as it is: this is a
  -- projection, not a repriorisation, and a candidate arriving with a `personal_mobile` does not
  -- displace a `work` line somebody already chose.

  IF v_existing_primary IS NOT NULL THEN
    SELECT op.id, op.dedupe_key INTO v_primary
    FROM public.contact_phones op
    WHERE op.id = v_existing_primary;
    v_primary_id  := v_primary.id;
    v_primary_key := v_primary.dedupe_key;
  ELSE
    -- The candidate's OWN live primary first — the reveal persistence or the operator already
    -- made that choice on the staging row — then 115/116's shared ranking, rung for rung, with
    -- `dedupe_key` as the total tie-break so physical row order never participates.
    SELECT op.id, op.dedupe_key INTO v_primary
    FROM public.contact_enrichment_candidate_phones cp
    JOIN public.contact_phones op
      ON op.contact_id = p_contact_id
     AND op.dedupe_key = cp.dedupe_key
    WHERE cp.candidate_id = p_candidate_id
      AND cp.is_primary
      AND cp.suppressed_at IS NULL
      AND op.suppressed_at IS NULL
      AND op.normalized_phone IS NOT NULL
      AND op.phone_status <> 'invalid'
    LIMIT 1;

    IF FOUND THEN
      v_primary_id  := v_primary.id;
      v_primary_key := v_primary.dedupe_key;
    ELSE
      SELECT p.id, p.dedupe_key INTO v_primary
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
      END IF;
    END IF;

    IF v_primary_id IS NOT NULL THEN
      -- Demote first, promote second: `contact_phones_one_primary_idx` does not tolerate two
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
    END IF;
  END IF;

  v_primary_new := v_primary_id IS NOT NULL AND v_primary_id = ANY (v_inserted_ids);

  -- ═══════════════════════════════════════════════════════════════
  -- Step 10 — project the legacy scalar tuple, under BOTH guards.
  -- ═══════════════════════════════════════════════════════════════
  -- Layer 2 of the header: the scalar is written only when it was NULL under this lock AND the
  -- elected primary is a row THIS transaction inserted. Anything else leaves `phone`,
  -- `phone_type`, `phone_source`, `phone_raw_type`, `phone_revealed_at` and
  -- `phone_processing_basis` exactly as they were.
  --
  -- `mobile_phone` is NOT in this UPDATE and must not be — MOBILE_PHONE_PROVENANCE_PENDING
  -- (4O-E4.1) stands. `phone_confidence` is never written: it stays the dead column 4O-E4 found.

  IF v_primary_new AND NULLIF(BTRIM(COALESCE(v_contact.phone, '')), '') IS NULL THEN
    SELECT p.display_phone, p.normalized_phone, p.phone_type INTO v_primary
    FROM public.contact_phones p
    WHERE p.id = v_primary_id;

    v_scalar      := COALESCE(v_primary.display_phone, v_primary.normalized_phone);
    v_scalar_type := v_primary.phone_type;

    -- Provenance from the most SPECIFIC LIVE source of the elected row, 115/116's comparator
    -- verbatim. A scalar must never assert a provenance that has been withdrawn.
    SELECT s.provider, s.acquisition_mode, s.raw_provider_type, s.observed_at INTO v_src
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
      -- 112's mapping, verbatim.
      v_scalar_source := CASE
        WHEN v_src.provider = 'apollo_cache'                                THEN 'apollo_cache'
        WHEN v_src.provider = 'lusha'                                       THEN 'lusha_reveal'
        WHEN v_src.provider = 'apollo' AND v_src.acquisition_mode
               IN ('reveal', 'waterfall')                                   THEN 'apollo_reveal'
        WHEN v_src.provider = 'apollo' AND v_src.acquisition_mode = 'search' THEN 'apollo_search'
        WHEN v_src.provider = 'manual'                                      THEN 'manual'
        ELSE 'unknown'
      END;
      v_scalar_raw := v_src.raw_provider_type;
      v_scalar_at  := v_src.observed_at;
    ELSE
      v_scalar_source := 'unknown';
    END IF;

    -- The lawful basis of the operation that produced this number, carried from the candidate's
    -- own reveal record. 116 takes it from the approval payload because at that moment the
    -- reveal had already happened; here the reveal happened AFTER the approval, so the candidate
    -- column is the only place the basis exists. NULL is left as NULL — never invented.
    v_scalar_basis := NULLIF(BTRIM(COALESCE(v_candidate.phone_processing_basis, '')), '');

    UPDATE public.contacts
       SET phone                  = v_scalar,
           phone_type             = v_scalar_type,
           phone_source           = v_scalar_source,
           phone_raw_type         = v_scalar_raw,
           phone_revealed_at      = v_scalar_at,
           phone_processing_basis = COALESCE(v_scalar_basis, phone_processing_basis),
           updated_by             = COALESCE(p_actor_id, updated_by)
     WHERE id = p_contact_id
       AND (
         phone IS DISTINCT FROM v_scalar
         OR phone_type IS DISTINCT FROM v_scalar_type
         OR phone_source IS DISTINCT FROM v_scalar_source
         OR phone_raw_type IS DISTINCT FROM v_scalar_raw
         OR phone_revealed_at IS DISTINCT FROM v_scalar_at
       );

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_scalar_synced := v_rows > 0;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 11 — the envelope.
  -- ═══════════════════════════════════════════════════════════════
  -- Counts, booleans, opaque ids and a `dedupe_key` — a SHA-256 by 114's design and never the
  -- number. NO phone number, NO display form, NO name, NO e-mail leaves this function.

  RETURN jsonb_build_object(
    'status',                    'projected',
    'candidate_id',              p_candidate_id,
    'contact_id',                p_contact_id,
    'phones_seen',               v_seen,
    'phones_inserted',           v_inserted,
    'phones_reused',             v_reused,
    'phones_skipped_suppressed', v_skipped,
    'sources_inserted',          v_src_inserted,
    'sources_reused',            v_src_reused,
    'primary_dedupe_key',        v_primary_key,
    'primary_elected_now',       v_primary_new,
    'scalar_synced',             v_scalar_synced,
    'scalar_fallback',           v_scalar_fb
  );
END;
$function$;

COMMENT ON FUNCTION public.project_approved_candidate_phones_onto_contact(
  uuid, uuid, jsonb, uuid, timestamptz
) IS
  'AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 — projects the official phone collection of an ALREADY APPROVED candidate onto the contact that its own approval created, in ONE transaction. Closes the gap 116 and 117 physically cannot: 116 returns already_approved with zero writes for an approved candidate, 117 refuses anything that is not duplicate, and 110/111/122 (the reveal persistence) never name contacts or contact_phones at all — so before this function a phone acquired AFTER approval had no statement anywhere in the schema that could move it to the contact. Creates NO contact (there is no INSERT INTO public.contacts in the file) and re-terminalises NO candidate (there is no UPDATE of contact_enrichment_candidates either): the human verdict is read, never rewritten. Resolves NO identity — not one comparison of a name, an e-mail, a phone or a LinkedIn URL — the destination is read from matched_contacts_id, which 116 wrote inside the approval, and p_contact_id must EQUAL it, so the client id is a confirmation token and never an instruction. Re-checks under the candidate lock what a pre-lock read cannot promise: status still approved, link still this contact, contact still present in the same account and not archived, and PERSON-level suppression through 113''s key and 113''s helpers so a DSAR committed in the window wins. Refuses outright, with zero writes, the legacy shape scalar-set-with-empty-collection (scalar_incumbent_unprojectable): bootstrapping an incumbent means inverting its provenance and HISTORICAL_MANUAL_NULL_PROVENANCE_PENDING is 117''s open question, not this one''s. Additive only: a LIVE official primary is kept and nothing is elected; the legacy contacts scalar tuple is written ONLY when it was NULL under the lock AND the elected primary is a row this transaction inserted, which is stricter than 117 on purpose so that a scalar 115 erased is never restored from a surviving sibling row. Every canonical INSERT is ON CONFLICT (contact_id, dedupe_key) DO NOTHING and every provenance join requires suppressed_at IS NULL on both sides, so a tombstone is never resurrected and never gains new provenance and a suppressed candidate phone is never promoted; source_event_key reuses 116''s v1:promoted: namespace so re-running collapses onto the same provenance rows and the function is idempotent through the unique indexes rather than through a flag. Writes no metadata link because the approval already wrote both (contacts.metadata.source_candidate_id and review.created_contact_id), which is what the DSAR path already discovers. Lock order candidate then contact then phones, the same order 112/115/116/117 take. NEVER touches mobile_phone (4O-E4.1) and NEVER writes phone_confidence. Calls no provider, reserves and spends no credit, writes no usage log, reservation or waterfall row, and reaches no HubSpot. SECURITY INVOKER on purpose, so it runs under 114''s grant ceiling and physically cannot DELETE a phone row or rewrite a provenance column.';

-- ═══════════════════════════════════════════════════════════════════
-- 2. EXECUTE privileges
-- ═══════════════════════════════════════════════════════════════════
--
-- PostgreSQL grants EXECUTE to PUBLIC on every new function. For a function that WRITES onto an
-- official contact, that means reachability through PostgREST with the anon key, and the
-- REACHABILITY is the defect whether or not RLS would then reject the individual statements. So
-- PUBLIC, `anon` and `authenticated` are revoked explicitly and only `postgres` and
-- `service_role` are granted — the identical four-statement pattern 112, 113, 115, 116 and 117
-- use.
--
-- `authenticated` is revoked and NOT granted for the reason 114 gives the browser SELECT and
-- nothing else: projecting a number onto a contact is an authorisation decision and it belongs
-- to the server action that already checks the role. A client that could invoke this directly
-- would be writing without ever passing that check.

REVOKE ALL ON FUNCTION public.project_approved_candidate_phones_onto_contact(
  uuid, uuid, jsonb, uuid, timestamptz
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.project_approved_candidate_phones_onto_contact(
  uuid, uuid, jsonb, uuid, timestamptz
) FROM anon;

REVOKE ALL ON FUNCTION public.project_approved_candidate_phones_onto_contact(
  uuid, uuid, jsonb, uuid, timestamptz
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.project_approved_candidate_phones_onto_contact(
  uuid, uuid, jsonb, uuid, timestamptz
) TO postgres, service_role;
