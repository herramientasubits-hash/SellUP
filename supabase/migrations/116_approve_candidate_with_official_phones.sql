-- Migration 116: ATOMIC candidate approval → OFFICIAL multi-phone contact
-- (Agente 2A · AGENT2A-PHONE-REVEAL-4O-H3)
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS
-- ═══════════════════════════════════════════════════════════════════
--
-- Approval today is a SEQUENCE of independent PostgREST writes:
--
--   1. accounts INSERT/UPDATE          (HubSpot-only candidates)
--   2. contact_enrichment_runs UPDATE  (HubSpot-only candidates)
--   3. contacts INSERT
--   4. contact_enrichment_candidates UPDATE  → approved
--   5. contact_audit_log INSERT
--
-- Nothing wraps them. `runApproveCandidate()` even documents the hole in prose: when step 4
-- fails it returns `approveFailed` WITH a `contactId`, because the contact already exists and
-- the candidate is still `pending_review`. That is a contact nobody approved and a candidate
-- that can be approved again — a second contact for the same person, on the next click.
--
-- And step 3 writes ONE phone. Migration 109 gave the candidate a COLLECTION; migrations
-- 110/111 fill it from Apollo and Lusha reveals; 114 created the official destination. Between
-- them sits `buildContactInsertPayload()`, which reads `candidate.phone` — a single scalar —
-- and drops every other number the operator paid to reveal. A candidate holding a personal
-- mobile, a direct dial and a Lusha work line becomes a contact holding one of them, and the
-- other two are unreachable from the moment the candidate is archived.
--
-- This migration makes approval ONE transaction, and makes that transaction propagate the
-- WHOLE collection with its provenance intact.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHAT THIS FUNCTION DELIBERATELY DOES **NOT** DECIDE
-- ═══════════════════════════════════════════════════════════════════
--
-- It does not build the contact. `buildContactInsertPayload()` in
-- `candidate-review-core.ts` stays the ONE authority on how a candidate becomes a contact —
-- name parsing, e-mail sanitisation, LinkedIn normalisation, seniority mapping, the trace
-- metadata. Restating any of that in PL/pgSQL would create a second implementation that
-- drifts, and the H3 contract is explicit that approval's non-phone behaviour must not change.
-- So the payload arrives as `jsonb`, already built, and this function NAMES the columns and
-- inserts it. What it computes itself is exactly what it must read under the lock: the phones.
--
-- It does not decide WHETHER the human may approve. The identity gate (17B.4W.8), the
-- duplicate gate, the account resolution and the authorisation all stay in the server action,
-- ahead of this call, unchanged. What this function re-checks under the lock is what a
-- pre-lock read cannot promise: that the candidate is still approvable, and that the PERSON
-- has not been erased in the meantime.
--
-- It does not call a provider, reserve or consume a credit, write a usage log, a reservation
-- or a waterfall row, and it does not reach HubSpot. Approval spends nothing: every number it
-- promotes was already observed and already paid for.
--
-- ═══════════════════════════════════════════════════════════════════
-- `SECURITY INVOKER`, FOR THE SAME REASON H2 IS
-- ═══════════════════════════════════════════════════════════════════
--
-- The function runs under the caller's privileges, which for the only caller means 114's
-- grant ceiling: SELECT/INSERT/UPDATE on `contact_phones` with NO DELETE, and SELECT/INSERT on
-- `contact_phone_sources` with COLUMN-LEVEL UPDATE limited to the suppression triad. A writer
-- that physically cannot delete a tombstone or rewrite a provenance column is a stronger
-- guarantee than a writer instructed not to. `search_path` is still pinned and every object is
-- schema-qualified, so a `public` shadow cannot be introduced by a caller's session.
--
-- A `SECURITY DEFINER` owned by `postgres` would hand this function DELETE on both tables and
-- full UPDATE on provenance — the two capabilities H1 spent its privilege block withholding —
-- to buy nothing: `service_role` already holds everything the transaction needs.
--
-- ═══════════════════════════════════════════════════════════════════
-- LOCK ORDER — CANDIDATE, THEN CONTACT, THEN PHONES
-- ═══════════════════════════════════════════════════════════════════
--
-- This is NOT a free choice; it is the order the DSAR path already takes.
-- `phone-cache-suppression-actions.ts` propagates an erasure by calling
-- `suppress_candidate_phone_collection` (112 — locks the CANDIDATE) and only afterwards
-- `suppress_official_contact_phone_sources` (115 — locks the CONTACT, then `contact_phones` in
-- `id` order). Approval takes the same two locks in the same sequence, so approval and erasure
-- are strictly ordered against each other and cannot deadlock by taking them in opposite
-- orders. `contact_phone_sources` is not locked directly, for 115's reason: it is reachable
-- only through a canonical row, and every canonical row in scope is already locked.
--
-- The candidate lock is what makes the double-click safe. Two concurrent approvals of the same
-- candidate serialise on it; the loser re-reads a candidate that is no longer
-- `pending_review` and returns `already_approved` with the contact the winner created, having
-- written nothing.
--
-- ═══════════════════════════════════════════════════════════════════
-- PERSON SUPPRESSION IS RE-CHECKED HERE, NOT ONLY BEFORE
-- ═══════════════════════════════════════════════════════════════════
--
-- 4O-E3 established the property and migration 113 the mechanism: a DSAR erases a PERSON, and
-- a check that runs before the lock can be outrun by an erasure that commits inside the
-- window. Approval is exactly such a window — it promotes numbers that were revealed minutes
-- or days earlier — so it re-reads the SAME durable tombstone, with the SAME key
-- `(apollo, person, account)` in `phone_reveal_cache`, through the SAME two helper functions
-- 113 installed. No second suppression model is introduced and no inference is added: no
-- matching by phone, e-mail, name or LinkedIn happens here, exactly as 113 refuses to.
--
-- Erasure first ⇒ this SELECT sees the tombstone and NOTHING is written, not even the contact.
-- Approval first ⇒ the erasure that follows takes this same candidate lock, then the contact
-- lock, and tombstones what was written. Both orderings end suppressed.
--
-- ═══════════════════════════════════════════════════════════════════
-- A TOMBSTONE IS NEVER RESURRECTED
-- ═══════════════════════════════════════════════════════════════════
--
-- Two tombstones matter and they are handled by two different mechanisms:
--
--   * a SUPPRESSED CANDIDATE phone is never read. The propagation query filters
--     `suppressed_at IS NULL` on the staging row, so a number 112 erased has nothing to
--     promote. It is counted as skipped so the envelope shows it happened.
--
--   * an EXISTING OFFICIAL tombstone on the target contact is never overwritten. Every
--     canonical INSERT carries `ON CONFLICT (contact_id, dedupe_key) DO NOTHING` and every
--     reuse predicate carries `suppressed_at IS NULL`. There is no `UPDATE … SET suppressed_at
--     = NULL` in this file and no statement that repopulates a tombstoned row's number. In the
--     create-only mode this function ships with, the contact is BRAND NEW and therefore has no
--     tombstones at all — so the guard is a property of the statements rather than a live
--     branch, which is why it is asserted statically and not claimed as an exercised path.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY THERE IS NO EXISTING-CONTACT MERGE
-- ═══════════════════════════════════════════════════════════════════
--
-- Additive propagation onto an EXISTING contact would need a trusted, human-confirmed identity
-- for that contact. The current flow has none: `findDuplicateContact()` terminalises a
-- duplicate candidate as `duplicate` and returns `ok: false`. A duplicate candidate cannot be
-- approved AT ALL today, so there is no approval whose destination is an existing contact, and
-- inventing one here would be introducing a merge the operator never confirmed — resolved by a
-- fuzzy name, a first e-mail match or a phone collision, which is precisely what the H3
-- contract forbids.
--
-- So this function creates, or it recognises an approval that already happened. It does not
-- merge. `H3_EXISTING_CONTACT_MERGE_PENDING` stands, and with it the legacy-scalar bootstrap
-- question (§40–§44 of the H3 contract): an incumbent `contacts.phone` whose `phone_source` is
-- NULL has unknown provenance, `HISTORICAL_MANUAL_NULL_PROVENANCE_PENDING` is still open, and
-- there is no faithful way to promote it. A contact this function creates has no incumbent, so
-- the question does not arise on any path it can reach.
--
-- ═══════════════════════════════════════════════════════════════════
-- THE SCALAR-ONLY CANDIDATE
-- ═══════════════════════════════════════════════════════════════════
--
-- Most candidates in Production have `phone` set and ZERO collection rows: `contact-candidate-
-- writer.ts` writes the scalar from the Apollo SEARCH payload (PHONE-3A, free), and only the
-- REVEAL persistence of 110/111 ever writes the collection. So the case is not hypothetical,
-- it is the majority.
--
-- Such a scalar is promoted ONLY when its provenance can be stated faithfully. The evidence is
-- `enrichment_metadata.phone.source`, whose vocabulary is the legacy fused one, and 112 already
-- owns the exhaustive translation between that vocabulary and H1's `(provider,
-- acquisition_mode)` pair. Read BACKWARDS, four of its members invert without ambiguity and one
-- more is trivial:
--
--   apollo_search → (apollo, search)      apollo_reveal → (apollo, reveal)
--   apollo_cache  → (apollo_cache, cache) lusha_reveal  → (lusha, reveal)
--   manual        → (manual, manual)
--
-- `provider_payload`, `unknown`, and an absent or malformed `phone` object do NOT invert:
-- `provider_payload` names no provider, and `unknown` is the explicit absence of evidence.
-- Writing `(unknown, search)` for either would be fabricating an acquisition mode in the very
-- table whose purpose is to make provenance demonstrable, so nothing is promoted for them.
--
-- The INVERSION runs in TypeScript, not here, and so does the normalisation. H1 is explicit
-- that `normalizeCandidatePhone()` in `phone-collection-core.ts` is the ONE algorithm producing
-- a `dedupe_key` and that the migration adds no second one — a second normaliser would mean
-- the same number hashing to two keys depending on which writer saw it, which is the
-- deduplication failing silently and the tombstone failing with it. So the fallback arrives
-- ALREADY normalised, in `p_scalar_fallback`, and what this function does with it is validate
-- the vocabularies against 114's CHECKs and insert it. When the caller could not invert the
-- provenance it sends NULL, and nothing is promoted.
--
-- What happens then is deliberately NOT a failure. The contact is created exactly as it is
-- today, `contacts.phone` keeps the scalar the payload carried, and the official collection
-- stays EMPTY for that contact — which is the state every contact in Production is in right
-- now, and the state H2 already handles by returning `no_official_collection` and writing
-- nothing. No behaviour is lost and no provenance is invented. The envelope reports
-- `scalar_fallback = 'unrepresentable'` so the case is countable rather than silent.
--
-- ═══════════════════════════════════════════════════════════════════
-- `source_event_key` — THE OFFICIAL FORM
-- ═══════════════════════════════════════════════════════════════════
--
-- H1 requires a key that is deterministic, PII-free, derived from the OPERATION rather than
-- from the candidate row, excludes `observed_at`, and is not the staging key verbatim.
--
-- The staging key already satisfies the first four:
-- `buildCandidatePhoneSourceEventKey()` composes `v1`, provider, acquisition mode, phase and
-- the three accounting row ids, plus 4O-C's observation discriminator — and contains no
-- candidate id, no number and no clock. What it is not is DISTINGUISHABLE from an official
-- key, and the accounting ids are not columns on the staging source row: `phase` and the
-- discriminator survive only INSIDE the key. Recomposing an official key from the columns
-- alone would therefore silently collapse two observations that differ only by phase.
--
-- So the official key NAMESPACES the staging key rather than replacing or copying it:
--
--   'v1:promoted:' || <staging source_event_key>
--
-- Deterministic, PII-free, operation-derived, carrying the staging collapse semantics exactly,
-- and — because the staging key holds no candidate id — identical for the same paid
-- observation no matter which candidate carried it. Two candidates for the same person
-- promoting the same reveal onto the same contact produce ONE official source row, which is
-- the defect H1 named when it forbade putting a candidate id in the key.
--
-- ⚠️ NOT APPLIED. This migration has NOT been applied to any remote Supabase project.
--   APPLIED IN PRODUCTION: NO
--
-- Backward compatibility: this migration ADDS one function and changes nothing else. No table,
-- column, constraint, index, grant or existing function is altered, so the H2 runtime that is
-- live today keeps working byte-for-byte while the schema is ahead of the code. That is what
-- makes the schema-first rollout safe.
--
-- Idempotent: `CREATE OR REPLACE FUNCTION`, and the REVOKE/GRANT block is declarative.

-- ═══════════════════════════════════════════════════════════════════
-- 1. The approval transaction
-- ═══════════════════════════════════════════════════════════════════
--
--   0. validate, fail closed before any write
--   1. lock the candidate, re-read its state
--   2. idempotency: an already-approved candidate returns its contact, writing nothing
--   3. approvability gate under the lock
--   4. PERSON suppression re-check under the lock (113's key, 113's helpers)
--   5. create the contact from the caller's payload, then lock it
--   6. promote the LIVE candidate phones and their provenance
--   7. scalar-only fallback, only when provenance inverts faithfully
--   8. elect exactly one primary
--   9. project the legacy scalar tuple from the elected primary
--  10. terminalise the candidate
--  11. return a PII-free envelope

CREATE OR REPLACE FUNCTION public.approve_contact_candidate_with_phones(
  p_candidate_id     uuid,
  p_account_id       uuid,
  p_contact_payload  jsonb,
  p_review_patch     jsonb,
  p_scalar_fallback  jsonb,
  p_actor_id         uuid,
  p_now              timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  -- 112 / 115 rankings, verbatim. Not restated in a second incompatible order: two rankings
  -- over the same vocabulary is how the candidate and the official collection end up electing
  -- different primaries for the same person.
  c_type_ranking   text[] := ARRAY[
    'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
  ];
  c_source_ranking text[] := ARRAY[
    'apollo:reveal', 'lusha:reveal', 'apollo_cache:cache', 'apollo:search'
  ];

  -- The candidate statuses this function will act on. The CURRENT contract, not a new one:
  -- `runApproveCandidate()` refuses anything that is not `pending_review`.
  c_approvable     text[] := ARRAY['pending_review'];

  v_candidate      RECORD;
  v_account_id     uuid;
  v_person_id      text;
  v_contact_id     uuid;
  v_fb_provider    text;
  v_fb_mode        text;
  v_fb_norm        text;
  v_fb_display     text;
  v_fb_key         text;
  v_fb_type        text;
  v_fb_event       text;
  v_fb_phone_id    uuid;

  v_seen           integer := 0;
  v_inserted       integer := 0;
  v_reused         integer := 0;
  v_skipped        integer := 0;
  v_src_inserted   integer := 0;
  v_src_reused     integer := 0;
  v_src_seen       integer := 0;
  v_scalar_fb      text    := 'absent';

  v_primary_id     uuid;
  v_primary_key    text;
  v_primary        RECORD;
  v_src            RECORD;
  v_scalar         text;
  v_scalar_type    text;
  v_scalar_source  text;
  v_scalar_raw     text;
  v_scalar_at      timestamptz;
  v_scalar_synced  boolean := false;
  v_terminal_rows  integer := 0;
BEGIN
  -- ═══════════════════════════════════════════════════════════════
  -- Step 0 — validation. Fail closed BEFORE any write.
  -- ═══════════════════════════════════════════════════════════════

  IF p_candidate_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'candidate_id_missing');
  END IF;

  IF p_account_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'account_id_missing');
  END IF;

  IF p_contact_payload IS NULL OR jsonb_typeof(p_contact_payload) <> 'object' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'contact_payload_invalid');
  END IF;

  IF p_review_patch IS NULL OR jsonb_typeof(p_review_patch) <> 'object' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'review_patch_invalid');
  END IF;

  -- The patch may only terminalise the candidate as APPROVED. This function is the approval
  -- path; a patch carrying `discarded` or `duplicate` would be using the approval transaction —
  -- which creates a contact — to write somebody else's verdict.
  IF p_review_patch ->> 'status' IS DISTINCT FROM 'approved' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'review_patch_status_not_approved');
  END IF;

  IF p_now IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'now_missing');
  END IF;

  -- The payload's account must be the one the caller resolved AND a real account. A payload
  -- naming a different account than the parameter means the caller believes two things, and
  -- this function cannot know which — the same reason 115 rejects a provider passed alongside
  -- the all-providers scope.
  IF NULLIF(p_contact_payload ->> 'account_id', '')::uuid IS DISTINCT FROM p_account_id THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'account_id_mismatch');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = p_account_id) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'account_not_found');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 1 — lock the candidate. Everything after this reads a state
  --          no concurrent transaction can change underneath it.
  -- ═══════════════════════════════════════════════════════════════
  -- FIRST statement that touches a row, and deliberately so: every check that follows is
  -- decided on a snapshot the lock protects, not on the pre-call read the server action did.

  SELECT c.id,
         c.status,
         c.phone,
         c.matched_contacts_id,
         c.enrichment_run_id,
         c.apollo_person_id,
         c.source,
         c.source_contact_id
    INTO v_candidate
  FROM public.contact_enrichment_candidates c
  WHERE c.id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'candidate_not_found', 'detail', 'candidate_missing');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 2 — idempotency.
  -- ═══════════════════════════════════════════════════════════════
  -- An approval that already happened is not an error and must not be redone. The durable link
  -- is `matched_contacts_id`, which the CURRENT approval already sets to the created contact —
  -- so no new column and no parallel tracking table is needed to recognise the case.
  --
  -- This is also the losing half of a double-click: the winner committed while this
  -- transaction waited on the lock, so what this reads is the winner's terminal state. Zero
  -- writes, and the contact returned is the one that exists rather than a second one.

  IF v_candidate.status = 'approved' THEN
    RETURN jsonb_build_object(
      'status',                        'already_approved',
      'candidate_id',                  p_candidate_id,
      'contact_id',                    v_candidate.matched_contacts_id,
      'contact_mode',                  'existing_approved',
      'contact_created',               false,
      'phones_seen',                   0,
      'phones_inserted',               0,
      'phones_reused',                 0,
      'phones_skipped_suppressed',     0,
      'sources_inserted',              0,
      'sources_reused',                0,
      'primary_dedupe_key',            NULL,
      'scalar_synced',                 false,
      'scalar_fallback',               'absent',
      'candidate_terminal',            true
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 3 — approvability, under the lock.
  -- ═══════════════════════════════════════════════════════════════
  -- `discarded`, `duplicate` and every other terminal state are conclusions somebody else
  -- reached. Writing over them would be overwriting a human decision.

  IF NOT (v_candidate.status = ANY (c_approvable)) THEN
    RETURN jsonb_build_object(
      'status', 'candidate_not_approvable',
      'detail', 'candidate_status_not_pending'
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 4 — PERSON suppression, re-checked UNDER the lock (4O-E3 / 113).
  -- ═══════════════════════════════════════════════════════════════
  -- The key resolution is 113's, statement for statement, so the SQL and the TypeScript guard
  -- resolve the SAME person. No person id or no account means there is no key to match, and
  -- that limit is NOT turned into a block by inference.

  SELECT r.account_id INTO v_account_id
  FROM public.contact_enrichment_runs r
  WHERE r.id = v_candidate.enrichment_run_id;

  -- The run's account is authoritative when it has one. A HubSpot-only candidate has none
  -- until the server action resolves it, and in that case the parameter is what the erasure
  -- key must use — it is the account the contact is about to be created under.
  v_account_id := COALESCE(v_account_id, p_account_id);

  v_person_id := COALESCE(
    public.phone_reveal_normalized_apollo_person_id(v_candidate.apollo_person_id),
    CASE WHEN v_candidate.source = 'apollo'
      THEN public.phone_reveal_normalized_apollo_person_id(v_candidate.source_contact_id)
    END
  );

  IF v_person_id IS NOT NULL
     AND v_account_id IS NOT NULL
     AND public.phone_reveal_person_suppression_exists(v_person_id, v_account_id) THEN
    -- Fail closed with NOTHING written: no contact, no phone, no source, no scalar, and the
    -- candidate is NOT terminalised. An approval that created the contact and merely withheld
    -- the numbers would still have resurrected the person as a record.
    RETURN jsonb_build_object(
      'status',       'person_suppressed',
      'candidate_id', p_candidate_id,
      'contact_id',   NULL,
      'detail',       'person_suppression_tombstone'
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 5 — create the contact, from the caller's payload.
  -- ═══════════════════════════════════════════════════════════════
  -- The columns are NAMED here; the VALUES all come from `buildContactInsertPayload()`. This
  -- function adds no field, drops no field and normalises nothing — approval's non-phone
  -- behaviour is byte-for-byte what it was.
  --
  -- `phone` and its metadata tuple are taken from the payload TOO, and then re-projected in
  -- step 9 only if a primary is elected. That ordering is what keeps the scalar-only case
  -- (majority of Production) writing exactly today's value.

  INSERT INTO public.contacts (
    account_id, first_name, last_name, full_name, email, phone, linkedin_url,
    job_title, department, seniority, source, contact_status,
    phone_type, phone_source, phone_raw_type, phone_revealed_at, phone_processing_basis,
    metadata, created_by, updated_by
  )
  VALUES (
    p_account_id,
    p_contact_payload ->> 'first_name',
    p_contact_payload ->> 'last_name',
    p_contact_payload ->> 'full_name',
    p_contact_payload ->> 'email',
    p_contact_payload ->> 'phone',
    p_contact_payload ->> 'linkedin_url',
    p_contact_payload ->> 'job_title',
    p_contact_payload ->> 'department',
    p_contact_payload ->> 'seniority',
    p_contact_payload ->> 'source',
    COALESCE(p_contact_payload ->> 'contact_status', 'active'),
    p_contact_payload ->> 'phone_type',
    p_contact_payload ->> 'phone_source',
    p_contact_payload ->> 'phone_raw_type',
    NULLIF(p_contact_payload ->> 'phone_revealed_at', '')::timestamptz,
    p_contact_payload ->> 'phone_processing_basis',
    COALESCE(p_contact_payload -> 'metadata', '{}'::jsonb),
    NULLIF(p_contact_payload ->> 'created_by', '')::uuid,
    NULLIF(p_contact_payload ->> 'updated_by', '')::uuid
  )
  RETURNING id INTO v_contact_id;

  -- Take the contact lock explicitly, in the position 115 takes it. The INSERT already holds
  -- the row, so this acquires nothing new — what it does is make the ORDER a statement in the
  -- file rather than an accident of the insert, so a future edit that adds a read before this
  -- point cannot silently invert it against 115.
  PERFORM 1 FROM public.contacts c WHERE c.id = v_contact_id FOR UPDATE;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 6 — promote the LIVE candidate collection.
  -- ═══════════════════════════════════════════════════════════════
  -- `suppressed_at IS NULL` on the staging row is the whole tombstone rule: a number 112
  -- erased has nothing to promote, and its candidate row carries no number to promote anyway
  -- (109's `tombstone_is_empty` CHECK). Counted separately so the envelope shows it.
  --
  -- `is_primary` is deliberately NOT copied here. Election is step 8, and inserting a primary
  -- now would mean carrying the single-primary index through the middle of the loop for no
  -- gain.
  --
  -- `ON CONFLICT DO NOTHING` rather than an UPSERT: on a contact this function just created
  -- there is no conflict to hit, and on any contact there is a tombstone that must not be
  -- overwritten. DO NOTHING is correct in both readings and can never resurrect.

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
    SELECT v_contact_id,
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
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM promoted;

  -- Anything live that did NOT insert was already present as a live canonical row or as a
  -- tombstone. Both are "reused" in the sense that matters: the number is represented by a row
  -- this transaction did not create and must not modify.
  SELECT GREATEST(COUNT(*) - v_inserted, 0) INTO v_reused
  FROM public.contact_enrichment_candidate_phones p
  WHERE p.candidate_id = p_candidate_id
    AND p.suppressed_at IS NULL;

  -- ── Provenance ────────────────────────────────────────────────
  -- Every staging source of every LIVE staging number, joined to the official canonical row by
  -- `dedupe_key`. Apollo and Lusha observing the SAME number produce TWO source rows under ONE
  -- canonical row — the property H1 built the pair for — because the join is on the number,
  -- never on the provider.
  --
  -- The join is restricted to LIVE official canonical rows: a tombstone must not gain new
  -- provenance, or the next erasure would find a live source justifying an erased number.
  --
  -- `candidate_phone_id` is the audit pointer back to staging, SET NULL on delete by 114 and
  -- never load-bearing. The three accounting pointers are carried verbatim: they are what lets
  -- a number be traced to the operation that paid for it.

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
      ON op.contact_id = v_contact_id
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
  -- Step 7 — the scalar-only candidate.
  -- ═══════════════════════════════════════════════════════════════
  -- Only when the collection produced NOTHING live. A candidate that has a collection has
  -- already said everything it knows about its numbers, and the scalar is a projection of it.

  IF v_inserted = 0 AND v_reused = 0 THEN
    IF p_scalar_fallback IS NULL OR jsonb_typeof(p_scalar_fallback) <> 'object' THEN
      -- The caller found nothing to promote: either the candidate has no scalar at all, or its
      -- provenance did not invert. Which of the two it was is the caller's to report; from
      -- here both mean the collection stays empty and the scalar the payload wrote stands.
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

      -- The vocabularies are re-validated HERE and not trusted from the payload. 114's CHECKs
      -- would reject an invalid value anyway — with a constraint violation that aborts the
      -- whole approval. Refusing to promote is the better failure: the contact is still
      -- created, exactly as today, and only the (unrepresentable) promotion is dropped.
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
          v_contact_id, v_fb_norm, COALESCE(v_fb_display, v_fb_norm), v_fb_key,
          v_fb_type, 'unknown', false, p_now, p_now
        )
        ON CONFLICT (contact_id, dedupe_key) DO NOTHING
        RETURNING id INTO v_fb_phone_id;

        IF v_fb_phone_id IS NULL THEN
          -- A tombstone already holds this key. Never resurrected, never counted as promoted.
          v_scalar_fb := 'unrepresentable';
        ELSE
          v_inserted := v_inserted + 1;
          v_seen     := v_seen + 1;

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

          GET DIAGNOSTICS v_terminal_rows = ROW_COUNT;
          v_src_inserted := v_src_inserted + v_terminal_rows;
          v_src_seen     := v_src_seen + 1;
          v_scalar_fb    := 'promoted';
        END IF;
      END IF;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 8 — elect exactly one primary.
  -- ═══════════════════════════════════════════════════════════════
  -- The candidate's OWN live primary wins when it is still electable against 114's CHECK: the
  -- operator or the reveal persistence already made that choice on the staging row, and
  -- approval is not a repriorisation. When there is none, the shared ranking decides — the
  -- SAME ORDER BY 115 uses, rung for rung, with `dedupe_key` as the total tie-break so the
  -- physical row order never participates.

  SELECT op.id, op.dedupe_key INTO v_primary
  FROM public.contact_enrichment_candidate_phones cp
  JOIN public.contact_phones op
    ON op.contact_id = v_contact_id
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
    WHERE p.contact_id = v_contact_id
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
    -- Demote first, promote second. `contact_phones_one_primary_idx` does not tolerate two
    -- primaries even for one statement, and this order needs no window.
    UPDATE public.contact_phones
       SET is_primary = false
     WHERE contact_id = v_contact_id
       AND is_primary
       AND id <> v_primary_id;

    UPDATE public.contact_phones
       SET is_primary = true
     WHERE id = v_primary_id
       AND NOT is_primary;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 9 — project the legacy scalar tuple.
  -- ═══════════════════════════════════════════════════════════════
  -- ONLY when a primary was elected. With no official collection the scalar the payload wrote
  -- stands untouched — which is both today's behaviour and the state H2 already recognises as
  -- `no_official_collection`. There is no guard on `phone_source` here (115 has one) because
  -- there is no incumbent to protect: the contact was created in step 5 by this transaction,
  -- and the value being replaced is the one the same transaction just wrote.
  --
  -- `phone_processing_basis` is NOT projected — the official model has no column holding a
  -- legal basis, so any value would be fabricated; it keeps whatever the payload carried, which
  -- is the reveal's own record. `phone_confidence` is never written: it stays the dead column
  -- 4O-E4 found and H2 refused to resurrect. `mobile_phone` is not in this UPDATE and must not
  -- be — MOBILE_PHONE_PROVENANCE_PENDING (4O-E4.1) stands until H5.

  IF v_primary_id IS NOT NULL THEN
    SELECT p.display_phone, p.normalized_phone, p.phone_type INTO v_primary
    FROM public.contact_phones p
    WHERE p.id = v_primary_id;

    v_scalar      := COALESCE(v_primary.display_phone, v_primary.normalized_phone);
    v_scalar_type := v_primary.phone_type;

    -- Provenance from the most SPECIFIC LIVE source of the elected row, 115's comparator
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

    UPDATE public.contacts
       SET phone             = v_scalar,
           phone_type        = v_scalar_type,
           phone_source      = v_scalar_source,
           phone_raw_type    = v_scalar_raw,
           phone_revealed_at = v_scalar_at
     WHERE id = v_contact_id
       AND (
         phone IS DISTINCT FROM v_scalar
         OR phone_type IS DISTINCT FROM v_scalar_type
         OR phone_source IS DISTINCT FROM v_scalar_source
         OR phone_raw_type IS DISTINCT FROM v_scalar_raw
         OR phone_revealed_at IS DISTINCT FROM v_scalar_at
       );

    GET DIAGNOSTICS v_terminal_rows = ROW_COUNT;
    v_scalar_synced := v_terminal_rows > 0;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 10 — terminalise the candidate.
  -- ═══════════════════════════════════════════════════════════════
  -- LAST, and inside the same transaction as everything above. The failure window this whole
  -- migration exists to close is precisely "contact created, candidate still pending": here a
  -- failure at any point rolls the contact back with it.
  --
  -- The patch is the caller's — the same `CandidateReviewPatch` the current approval builds,
  -- including the review metadata and the identity override evidence — with
  -- `matched_contacts_id` forced to the contact this transaction created, because the caller
  -- could not know the id before the insert.
  --
  -- `status = 'pending_review'` is re-asserted in the WHERE against the value read under the
  -- lock. Belt and braces: the row is locked, so it cannot have changed — and if the lock were
  -- ever lost, this matches zero rows and the RAISE below aborts instead of writing a terminal
  -- state over somebody else's conclusion.

  UPDATE public.contact_enrichment_candidates
     SET status              = p_review_patch ->> 'status',
         duplicate_status    = p_review_patch ->> 'duplicate_status',
         matched_contacts_id = v_contact_id,
         review_notes        = p_review_patch ->> 'review_notes',
         reviewed_by         = NULLIF(p_review_patch ->> 'reviewed_by', '')::uuid,
         reviewed_at         = NULLIF(p_review_patch ->> 'reviewed_at', '')::timestamptz,
         -- `review.created_contact_id` is INJECTED here and not by the caller, because the
         -- caller cannot know the id before the INSERT. It is not decoration: the DSAR path
         -- (`phone-cache-suppression-actions.ts`) DISCOVERS the contacts to erase through it as
         -- well as through `matched_contacts_id`, so an approval that omitted it would leave a
         -- contact a later erasure could not find.
         enrichment_metadata =
           COALESCE(p_review_patch -> 'enrichment_metadata', '{}'::jsonb)
           || jsonb_build_object(
                'review',
                COALESCE(p_review_patch -> 'enrichment_metadata' -> 'review', '{}'::jsonb)
                  || jsonb_build_object('created_contact_id', v_contact_id::text)
              )
   WHERE id = p_candidate_id
     AND status = 'pending_review';

  GET DIAGNOSTICS v_terminal_rows = ROW_COUNT;

  IF v_terminal_rows <> 1 THEN
    -- Unreachable while the lock holds. If it were ever reached, aborting is the only answer
    -- that does not leave an unapproved contact behind: RAISE rolls back the contact, the
    -- phones and the sources with it.
    RAISE EXCEPTION 'approve_contact_candidate_with_phones: candidate terminal state not written'
      USING ERRCODE = 'serialization_failure';
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 11 — the envelope.
  -- ═══════════════════════════════════════════════════════════════
  -- Counts, booleans, opaque ids and a `dedupe_key` — which is a SHA-256 by 114's design and
  -- never the number. NO phone number, NO display form, NO name, NO e-mail leaves this
  -- function.

  RETURN jsonb_build_object(
    'status',                    'approved',
    'candidate_id',              p_candidate_id,
    'contact_id',                v_contact_id,
    'contact_mode',              'created',
    'contact_created',           true,
    'phones_seen',               v_seen,
    'phones_inserted',           v_inserted,
    'phones_reused',             v_reused,
    'phones_skipped_suppressed', v_skipped,
    'sources_inserted',          v_src_inserted,
    'sources_reused',            v_src_reused,
    'primary_dedupe_key',        v_primary_key,
    'scalar_synced',             v_scalar_synced,
    'scalar_fallback',           v_scalar_fb,
    'candidate_terminal',        true
  );
END;
$function$;

COMMENT ON FUNCTION public.approve_contact_candidate_with_phones(
  uuid, uuid, jsonb, jsonb, jsonb, uuid, timestamptz
) IS
  'AGENT2A-PHONE-REVEAL-4O-H3 — approves a contact enrichment candidate in ONE transaction: locks the candidate, re-checks approvability and PERSON-level suppression under that lock (113''s key and 113''s helpers, so a DSAR committed after the server action''s read cannot be outrun), creates the contact from the payload built by buildContactInsertPayload (this function names columns and invents no field — approval''s non-phone behaviour is unchanged), promotes EVERY live contact_enrichment_candidate_phones row and ALL of their provenance into contact_phones / contact_phone_sources, elects exactly one primary, projects the legacy contacts scalar tuple from it, and only then terminalises the candidate. Closes the failure window where a contact existed while its candidate stayed pending_review, and the data loss where a candidate holding three revealed numbers became a contact holding one. Lock order is candidate → contact → phones, the SAME order the DSAR propagation path already takes (112 then 115), so approval and erasure serialise instead of deadlocking. A suppressed candidate phone is never promoted and an existing official tombstone is never overwritten: every canonical INSERT is ON CONFLICT (contact_id, dedupe_key) DO NOTHING and every reuse predicate requires suppressed_at IS NULL; there is no statement in this function that can set suppressed_at back to NULL. Apollo + Lusha observing the same number produce ONE canonical row with TWO sources, because the join is on the number and never on the provider. source_event_key namespaces the staging key as v1:promoted:… — deterministic, PII-free, operation-derived, free of any candidate id, so the same paid observation promoted under two candidates collapses to one official source. A scalar-only candidate (the majority in Production, written from the free Apollo search payload) is promoted ONLY when enrichment_metadata.phone.source inverts unambiguously through 112''s mapping; provider_payload, unknown and absent provenance promote NOTHING and leave the contact exactly as it is today rather than fabricating a provider. Idempotent: an already-approved candidate returns its existing contact with zero writes, which is also the losing half of a double-click. Does NOT merge into an existing contact — duplicates are terminalised and never approved today, so no trusted human-confirmed destination exists (H3_EXISTING_CONTACT_MERGE_PENDING). NEVER touches mobile_phone (4O-E4.1) and NEVER writes phone_confidence. Calls no provider, spends no credit, writes no reservation, usage log or waterfall row, and reaches no HubSpot. SECURITY INVOKER on purpose, so it runs under 114''s grant ceiling and physically cannot DELETE a phone row or rewrite a provenance column.';

-- ═══════════════════════════════════════════════════════════════════
-- 2. EXECUTE privileges
-- ═══════════════════════════════════════════════════════════════════
--
-- PostgreSQL grants EXECUTE to PUBLIC on every new function. For a function that CREATES A
-- CONTACT and terminalises a human review, that means reachability through PostgREST with the
-- anon key, and the REACHABILITY is the defect whether or not RLS would then reject the
-- individual statements. So PUBLIC, `anon` and `authenticated` are revoked explicitly and only
-- `postgres` and `service_role` are granted — the identical four-statement pattern 112, 113
-- and 115 use.
--
-- `authenticated` is revoked and NOT granted, for the reason 114 gives the browser SELECT and
-- nothing else: approving a candidate is an authorisation decision, and it belongs to the
-- server action that already checks it. A client that could invoke this directly would be
-- approving without ever passing that check.

REVOKE ALL ON FUNCTION public.approve_contact_candidate_with_phones(
  uuid, uuid, jsonb, jsonb, jsonb, uuid, timestamptz
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.approve_contact_candidate_with_phones(
  uuid, uuid, jsonb, jsonb, jsonb, uuid, timestamptz
) FROM anon;

REVOKE ALL ON FUNCTION public.approve_contact_candidate_with_phones(
  uuid, uuid, jsonb, jsonb, jsonb, uuid, timestamptz
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.approve_contact_candidate_with_phones(
  uuid, uuid, jsonb, jsonb, jsonb, uuid, timestamptz
) TO postgres, service_role;
