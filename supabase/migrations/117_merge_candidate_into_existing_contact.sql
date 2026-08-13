-- Migration 117: HUMAN-CONFIRMED additive merge of a duplicate candidate into an EXISTING
-- contact (Agente 2A · AGENT2A-PHONE-REVEAL-4O-H3-B)
--
-- ═══════════════════════════════════════════════════════════════════
-- WHAT 116 LEFT OPEN, AND WHY IT COULD NOT CLOSE IT
-- ═══════════════════════════════════════════════════════════════════
--
-- 116's own header says it: «WHY THERE IS NO EXISTING-CONTACT MERGE». Additive propagation onto
-- an existing contact needs a TRUSTED, HUMAN-CONFIRMED destination, and at the moment 116 runs
-- there is none — `findDuplicateContact()` has just terminalised the candidate as `duplicate`
-- and returned `ok: false`, so no approval whose destination is an existing contact exists.
--
-- Nothing about that has changed, and this migration does NOT change it. What it adds is a
-- SECOND, SEPARATE operation that starts exactly where the duplicate verdict ends:
--
--   approve  → duplicate detected → candidate terminalised `duplicate`,
--              `matched_contacts_id` written by the server with the matched contact
--        ↓
--   the human is SHOWN the match and chooses
--        ↓
--   «Agregar información al contacto existente»  → THIS FUNCTION
--
-- The destination is therefore not resolved here and not resolved by the client. It is read
-- from `matched_contacts_id` — a column the SERVER wrote, under its own dedup rules, before any
-- human was asked anything — and the caller's `p_contact_id` must EQUAL it. A client that posts
-- a different contact uuid is refused, so the id in the request is a CONFIRMATION token and
-- never an instruction.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHAT THIS FUNCTION DELIBERATELY DOES **NOT** DECIDE
-- ═══════════════════════════════════════════════════════════════════
--
-- It does not decide WHO the existing contact is. No matching by name, by phone, by fuzzy
-- similarity, by "first row returned" or by any inference happens in this file — there is not a
-- single comparison of an e-mail, a name or a number anywhere in it. The identity was decided
-- upstream, by exact normalised e-mail or exact normalised LinkedIn, and CONFIRMED by a human;
-- what this function does is refuse to act on anything that is not that.
--
-- It does not decide whether the human MAY merge. The authorisation is the server action's, the
-- same one approval already passes. This function re-checks what a pre-lock read cannot promise:
-- that the candidate is still the duplicate it was, that the destination is still the recorded
-- one, and that the PERSON has not been erased in the meantime.
--
-- It does not call a provider, reserve or consume a credit, write a usage log, a reservation or
-- a waterfall row, and it does not reach HubSpot. A merge spends nothing: every number it
-- promotes was already observed and already paid for.
--
-- It does not create a contact. `p_contact_id` must already exist; there is no INSERT INTO
-- `public.contacts` in this file. That is the whole difference from 116 and it is why the two
-- are separate functions rather than one function with a mode flag: 116 is LIVE in Production,
-- and re-issuing it with a branch that can skip its own INSERT would put the create path — the
-- one that runs every day — at risk to buy a merge path that runs rarely.
--
-- ═══════════════════════════════════════════════════════════════════
-- THE INCUMBENT IS NEVER DEMOTED, AND THE LEGACY SCALAR IS NEVER OVERWRITTEN
-- ═══════════════════════════════════════════════════════════════════
--
-- This is the rule the whole design turns on, and it has three layers:
--
--   1. A LIVE OFFICIAL PRIMARY WINS, ALWAYS. If the contact already has a primary in
--      `contact_phones`, this function keeps it and elects nothing. A merge is additive; it is
--      not a repriorisation. A candidate arriving with a `personal_mobile` does NOT displace an
--      incumbent `work` line, and a manual incumbent is protected by this rule before any
--      provider-specific reasoning is reached.
--
--   2. THE LEGACY SCALAR `contacts.phone` IS ONLY EVER WRITTEN WHEN IT WAS NULL. Read under the
--      contact lock, before anything is promoted. Not null ⇒ this function does not touch
--      `phone`, `phone_type`, `phone_source`, `phone_raw_type` or `phone_revealed_at`, whatever
--      the collection ends up looking like. An incumbent number is somebody's data — possibly
--      typed by hand, possibly the only one anybody has dialled — and gaining three provider
--      numbers is not a reason to replace it.
--
--   3. THE INCUMBENT IS BOOTSTRAPPED INTO THE COLLECTION WHEN, AND ONLY WHEN, ITS PROVENANCE
--      CAN BE STATED FAITHFULLY. See below.
--
-- ═══════════════════════════════════════════════════════════════════
-- THE LEGACY CONTACT: `contacts.phone` SET, ZERO `contact_phones`
-- ═══════════════════════════════════════════════════════════════════
--
-- That is EVERY contact in Production today, so it is not an edge case: it is the case. The
-- contact holds a number in the legacy scalar and the official collection does not exist for
-- it. Merging provider numbers into such a contact without doing anything about the incumbent
-- would leave a collection whose primary is a provider number while `contacts.phone` shows a
-- different one — the two surfaces disagreeing about the same person.
--
-- So the incumbent is BOOTSTRAPPED into the collection first, and it takes the primary. But
-- only when its provenance inverts without ambiguity, which is the same test 116 applies to a
-- scalar-only candidate, through the same 112 table read backwards, in the same TypeScript
-- authority (`LEGACY_SOURCE_TO_OFFICIAL_PAIR`):
--
--   apollo_search → (apollo, search)      apollo_reveal → (apollo, reveal)
--   apollo_cache  → (apollo_cache, cache) lusha_reveal  → (lusha, reveal)
--   manual        → (manual, manual)
--
--   * `manual` bootstraps as `(manual, manual)`. It then holds the primary AND is protected
--     from erasure by H2, which never withdraws a manual source. This is §11's absolute
--     protection expressed as data rather than as a special case in code.
--
--   * `provider_payload`, `unknown`, and a NULL `phone_source` do NOT invert.
--     HISTORICAL_MANUAL_NULL_PROVENANCE_PENDING is still open: a scalar whose provenance is
--     unknown may have been typed by a human or written by a provider, and writing either one
--     would be inventing the fact the table exists to make demonstrable. Nothing is
--     bootstrapped, the scalar is left exactly as it is (layer 2 above), and the envelope
--     reports `incumbent_bootstrap = 'unrepresentable'` so the case is countable rather than
--     silent. The provider numbers are still added as EXTRAS — that costs nothing and destroys
--     nothing — and they may take the primary of a collection whose scalar counterpart is
--     deliberately not synchronised. That disagreement is EXACTLY what 115 already produces
--     with its own scalar guard (`scalar_guarded_by_provenance`) for the same provenance
--     values, so it is a state the model already knows how to hold, not a new one.
--
-- The bootstrap runs ONLY when the contact has no LIVE canonical row at all. A contact that
-- already owns an official collection has already had its scalar projected from it, and a
-- contact holding only TOMBSTONES must not receive a number back through a side door — which
-- `ON CONFLICT (contact_id, dedupe_key) DO NOTHING` also refuses independently.
--
-- The bootstrap is additionally refused when `contacts.phone`, read under the lock, differs
-- from the value the caller inverted. The caller read the contact before the lock; somebody may
-- have retyped the number since. Promoting the stale one would attach a provenance to a number
-- that is no longer there.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY THE MERGE MARKS THE CONTACT — AND WHY THAT IS A PRIVACY REQUIREMENT
-- ═══════════════════════════════════════════════════════════════════
--
-- The DSAR path authorises an erasure on ONE proof and nothing weaker
-- (`resolveContactErasureProvenance`, 4O-E4 «FIX 1»): the contact ITSELF must attest that it was
-- created from one of the suppressed candidates, via `contacts.metadata.source_candidate_id`. A
-- duplicate match — even an exact one by e-mail — is explicitly NOT accepted, because matching
-- a person does not prove that THIS candidate put the number in THAT row.
--
-- A merged contact would fail that test. It was created earlier, from something else, so its
-- `source_candidate_id` names a different candidate — or none. Left as is, this function would
-- write provider-revealed numbers into a row that a later erasure for that same person could
-- discover but not touch: a privacy hole opened by the merge itself, and precisely the «route
-- around H2» the H3-B contract forbids.
--
-- So the merge APPENDS the candidate id to `contacts.metadata.merged_candidate_ids`, and the
-- erasure path accepts that array with the SAME strength as `source_candidate_id`. This is not
-- a weakening of FIX 1 — it is the same proof. FIX 1 refuses INFERENCE (a match means the same
-- person, not the same write); a merge is not an inference, it is the write itself, recorded by
-- the transaction that performed it. A duplicate the human DISCARDED writes nothing here and
-- stays exactly as unerasable as it is today.
--
-- The array is APPEND-ONLY and de-duplicated. `source_candidate_id` is never overwritten: it
-- records where the contact CAME FROM, and a merge does not change that.
--
-- ═══════════════════════════════════════════════════════════════════
-- LOCK ORDER — CANDIDATE, THEN CONTACT, THEN PHONES
-- ═══════════════════════════════════════════════════════════════════
--
-- Identical to 116, for identical reasons, and therefore identical to the DSAR path (112 locks
-- the candidate, then 115 locks the contact and then `contact_phones` in `id` order). Approval,
-- merge and erasure all take the same two locks in the same sequence, so no pair of them can
-- deadlock by taking them in opposite orders. `contact_phone_sources` is not locked directly:
-- it is reachable only through a canonical row, and every canonical row in scope is locked.
--
-- The candidate lock is what makes the double-click safe. Two concurrent merges of the same
-- candidate serialise on it; the loser re-reads a candidate that already carries
-- `review.merged_into_contact_id` and returns `already_merged` having written nothing.
--
-- ═══════════════════════════════════════════════════════════════════
-- A TOMBSTONE IS NEVER RESURRECTED
-- ═══════════════════════════════════════════════════════════════════
--
-- Unlike 116 — whose contact is brand new and therefore has no tombstones — this function
-- writes onto a contact that may well have them, so the guard is an EXERCISED path here and not
-- only a property of the statements:
--
--   * every canonical INSERT carries `ON CONFLICT (contact_id, dedupe_key) DO NOTHING`;
--   * every provenance join requires `op.suppressed_at IS NULL`, so a tombstoned canonical row
--     never gains a new source that would justify a number somebody erased;
--   * there is no `UPDATE … SET suppressed_at = NULL` in this file and no statement that
--     repopulates a tombstoned row's number;
--   * a SUPPRESSED CANDIDATE phone is never read (`p.suppressed_at IS NULL` on the staging row)
--     and is counted separately so the envelope shows it happened.
--
-- ═══════════════════════════════════════════════════════════════════
-- `SECURITY INVOKER`, FOR THE SAME REASON 115 AND 116 ARE
-- ═══════════════════════════════════════════════════════════════════
--
-- It runs under 114's grant ceiling: SELECT/INSERT/UPDATE on `contact_phones` with NO DELETE,
-- SELECT/INSERT on `contact_phone_sources` with COLUMN-LEVEL UPDATE limited to the suppression
-- triad. A writer that physically cannot delete a tombstone or rewrite a provenance column is a
-- stronger guarantee than a writer instructed not to. `search_path` is pinned and every object
-- is schema-qualified, so a `public` shadow cannot be introduced by a caller's session.
--
-- ⚠️ NOT APPLIED. This migration has NOT been applied to any remote Supabase project.
--   APPLIED IN PRODUCTION: NO
--
-- Backward compatibility: this migration ADDS one function and changes nothing else. No table,
-- column, constraint, index, grant or existing function is altered — 116 in particular is not
-- re-issued — so the runtime that is live today keeps working byte-for-byte while the schema is
-- ahead of the code. That is what makes the schema-first rollout safe.
--
-- Idempotent: `CREATE OR REPLACE FUNCTION`, and the REVOKE/GRANT block is declarative.

-- ═══════════════════════════════════════════════════════════════════
-- 1. The merge transaction
-- ═══════════════════════════════════════════════════════════════════
--
--   0. validate, fail closed before any write
--   1. lock the candidate, re-read its state
--   2. idempotency: an already-merged candidate returns its contact, writing nothing
--   3. mergeability gate under the lock — duplicate, and pointing at THIS contact
--   4. PERSON suppression re-check under the lock (113's key, 113's helpers)
--   5. lock the EXISTING contact and read the incumbent scalar
--   6. bootstrap the incumbent into the collection, only if its provenance inverts
--   7. promote the LIVE candidate phones and their provenance
--   8. scalar-only candidate fallback, only when provenance inverts faithfully
--   9. elect a primary ONLY if the contact has none — an incumbent is never demoted
--  10. project the legacy scalar ONLY when it was NULL
--  11. record the merge on the contact — the erasure link
--  12. terminalise the candidate as a MERGED duplicate
--  13. return a PII-free envelope

CREATE OR REPLACE FUNCTION public.merge_contact_candidate_into_existing_contact(
  p_candidate_id        uuid,
  p_contact_id          uuid,
  p_account_id          uuid,
  p_review_patch        jsonb,
  p_scalar_fallback     jsonb,
  p_incumbent_bootstrap jsonb,
  p_actor_id            uuid,
  p_now                 timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  -- 112 / 115 / 116 rankings, verbatim. A static test asserts these two arrays are
  -- byte-identical to 116's, because two rankings over the same vocabulary is how the same
  -- person ends up with different primaries on two surfaces.
  c_type_ranking   text[] := ARRAY[
    'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
  ];
  c_source_ranking text[] := ARRAY[
    'apollo:reveal', 'lusha:reveal', 'apollo_cache:cache', 'apollo:search'
  ];

  -- The candidate statuses this function will act on. A merge starts from the verdict the
  -- duplicate gate already wrote; `pending_review` is 116's territory and is refused here so
  -- the two transactions can never both terminalise the same candidate.
  c_mergeable      text[] := ARRAY['duplicate'];

  v_candidate      RECORD;
  v_contact        RECORD;
  v_account_id     uuid;
  v_person_id      text;
  v_review         jsonb;
  v_merged_prev    text;
  v_merged_ids     jsonb;

  v_fb_provider    text;
  v_fb_mode        text;
  v_fb_norm        text;
  v_fb_display     text;
  v_fb_key         text;
  v_fb_type        text;
  v_fb_event       text;
  v_fb_phone_id    uuid;

  v_inc_phone_id   uuid;
  v_inc_state      text    := 'absent';
  v_inc_live_rows  integer := 0;

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
  v_primary_kept   boolean := false;
  v_primary        RECORD;
  v_src            RECORD;
  v_scalar         text;
  v_scalar_type    text;
  v_scalar_source  text;
  v_scalar_raw     text;
  v_scalar_at      timestamptz;
  v_scalar_state   text    := 'incumbent_preserved';
  v_rows           integer := 0;
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

  IF p_account_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'account_id_missing');
  END IF;

  IF p_review_patch IS NULL OR jsonb_typeof(p_review_patch) <> 'object' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'review_patch_invalid');
  END IF;

  -- The patch may only re-state the DUPLICATE verdict. A patch carrying `approved` would be
  -- using the merge transaction — which creates no contact — to claim an approval, and one
  -- carrying `discarded` would be writing the opposite of the decision the human just took.
  IF p_review_patch ->> 'status' IS DISTINCT FROM 'duplicate' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'review_patch_status_not_duplicate');
  END IF;

  IF p_now IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'now_missing');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 1 — lock the candidate.
  -- ═══════════════════════════════════════════════════════════════
  -- FIRST statement that touches a row. Every check that follows is decided on a snapshot the
  -- lock protects, not on the pre-call read the server action did.

  SELECT c.id,
         c.status,
         c.phone,
         c.matched_contacts_id,
         c.enrichment_run_id,
         c.enrichment_metadata,
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
  -- The durable link is `enrichment_metadata.review.merged_into_contact_id`, written by step 12
  -- of this same function. `matched_contacts_id` cannot serve here the way it does in 116: the
  -- duplicate gate writes it on BOTH outcomes, so a discarded duplicate and a merged duplicate
  -- carry the same value and only this key tells them apart.
  --
  -- This is also the losing half of a double-click: the winner committed while this transaction
  -- waited on the lock, so what this reads is the winner's terminal state. Zero writes.

  v_review := COALESCE(v_candidate.enrichment_metadata -> 'review', '{}'::jsonb);
  v_merged_prev := v_review ->> 'merged_into_contact_id';

  IF v_merged_prev IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status',                    'already_merged',
      'candidate_id',              p_candidate_id,
      'contact_id',                v_merged_prev,
      'contact_created',           false,
      'phones_seen',               0,
      'phones_inserted',           0,
      'phones_reused',             0,
      'phones_skipped_suppressed', 0,
      'sources_inserted',          0,
      'sources_reused',            0,
      'primary_dedupe_key',        NULL,
      'primary_preserved',         true,
      'scalar_projection',         'incumbent_preserved',
      'scalar_fallback',           'absent',
      'incumbent_bootstrap',       'absent',
      'candidate_terminal',        true
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 3 — mergeability, under the lock.
  -- ═══════════════════════════════════════════════════════════════
  -- `pending_review` is not merged (it is 116's), and `approved` / `discarded` are conclusions
  -- somebody else reached.

  IF NOT (v_candidate.status = ANY (c_mergeable)) THEN
    RETURN jsonb_build_object(
      'status', 'candidate_not_mergeable',
      'detail', 'candidate_status_not_duplicate'
    );
  END IF;

  -- THE IDOR GUARD, and the reason the client's contact id is only ever a confirmation. The
  -- destination is the one the SERVER recorded when it detected the duplicate; a request naming
  -- any other contact is refused here, under the lock, before a single row is written.
  IF v_candidate.matched_contacts_id IS DISTINCT FROM p_contact_id THEN
    RETURN jsonb_build_object(
      'status', 'contact_mismatch',
      'detail', 'contact_id_not_the_recorded_match'
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 4 — PERSON suppression, re-checked UNDER the lock (4O-E3 / 113).
  -- ═══════════════════════════════════════════════════════════════
  -- 113's key resolution, statement for statement, so the SQL and the TypeScript guard resolve
  -- the SAME person. No person id or no account means there is no key to match, and that limit
  -- is NOT turned into a block by inference.
  --
  -- Erasure first ⇒ this SELECT sees the tombstone and NOTHING is written. Merge first ⇒ the
  -- erasure that follows takes this same candidate lock, then the contact lock, and tombstones
  -- what was written — reaching it through the link step 11 leaves behind. Both orderings end
  -- suppressed.

  SELECT r.account_id INTO v_account_id
  FROM public.contact_enrichment_runs r
  WHERE r.id = v_candidate.enrichment_run_id;

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
    RETURN jsonb_build_object(
      'status',       'person_suppressed',
      'candidate_id', p_candidate_id,
      'contact_id',   NULL,
      'detail',       'person_suppression_tombstone'
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 5 — lock the EXISTING contact, read the incumbent scalar.
  -- ═══════════════════════════════════════════════════════════════
  -- Second lock, in 115's position. The account is re-asserted here and not trusted from the
  -- parameter: `matched_contacts_id` is a FK with no account clause, and a contact that has
  -- since moved account is out of scope for this merge. An ARCHIVED contact is refused too —
  -- the dedup read that produced the match filtered `archived_at IS NULL`, and a contact
  -- archived since is a destination the human was never shown.

  SELECT c.id,
         c.account_id,
         c.phone,
         c.phone_type,
         c.phone_source,
         c.phone_raw_type,
         c.phone_revealed_at,
         c.metadata,
         c.archived_at
    INTO v_contact
  FROM public.contacts c
  WHERE c.id = p_contact_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'contact_not_found', 'detail', 'contact_missing');
  END IF;

  IF v_contact.account_id IS DISTINCT FROM p_account_id THEN
    RETURN jsonb_build_object('status', 'contact_mismatch', 'detail', 'contact_account_mismatch');
  END IF;

  IF v_contact.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'contact_not_mergeable', 'detail', 'contact_archived');
  END IF;

  SELECT COUNT(*) INTO v_inc_live_rows
  FROM public.contact_phones p
  WHERE p.contact_id = p_contact_id
    AND p.suppressed_at IS NULL;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 6 — bootstrap the incumbent scalar into the collection.
  -- ═══════════════════════════════════════════════════════════════
  -- ONLY for the legacy contact: a scalar and no live canonical row. The caller inverted the
  -- provenance in TypeScript, through the SAME table 116 uses, and normalised the number with
  -- THE normaliser — a second normaliser would mean the same number hashing to two keys
  -- depending on which writer saw it, which is deduplication failing silently and the tombstone
  -- failing with it. Here the vocabularies are re-validated and the row is inserted.
  --
  -- `observed_at` is the incumbent's OWN `phone_revealed_at` when it has one. Stamping `p_now`
  -- over a number that was revealed months ago would be back-dating an observation forward.

  IF p_incumbent_bootstrap IS NULL OR jsonb_typeof(p_incumbent_bootstrap) <> 'object' THEN
    v_inc_state := CASE
      WHEN NULLIF(BTRIM(COALESCE(v_contact.phone, '')), '') IS NULL THEN 'absent'
      ELSE 'unrepresentable'
    END;
  ELSIF v_inc_live_rows > 0 THEN
    -- The contact already owns an official collection; there is nothing legacy to bootstrap and
    -- its scalar has already been projected from that collection by whoever wrote it.
    v_inc_state := 'collection_present';
  ELSIF NULLIF(BTRIM(COALESCE(v_contact.phone, '')), '')
        IS DISTINCT FROM NULLIF(BTRIM(COALESCE(p_incumbent_bootstrap ->> 'observed_phone', '')), '') THEN
    -- The scalar changed between the caller's read and this lock. Promoting the stale value
    -- would attach a provenance to a number that is no longer on the row.
    v_inc_state := 'stale';
  ELSE
    v_fb_provider := p_incumbent_bootstrap ->> 'provider';
    v_fb_mode     := p_incumbent_bootstrap ->> 'acquisition_mode';
    v_fb_norm     := NULLIF(BTRIM(COALESCE(p_incumbent_bootstrap ->> 'normalized_phone', '')), '');
    v_fb_display  := NULLIF(BTRIM(COALESCE(p_incumbent_bootstrap ->> 'display_phone', '')), '');
    v_fb_key      := NULLIF(BTRIM(COALESCE(p_incumbent_bootstrap ->> 'dedupe_key', '')), '');
    v_fb_type     := p_incumbent_bootstrap ->> 'phone_type';
    v_fb_event    := NULLIF(BTRIM(COALESCE(p_incumbent_bootstrap ->> 'source_event_key', '')), '');

    IF v_fb_provider IS NULL
       OR NOT (v_fb_provider = ANY (ARRAY['apollo', 'lusha', 'apollo_cache', 'manual', 'unknown']))
       OR v_fb_mode IS NULL
       OR NOT (v_fb_mode = ANY (ARRAY['search', 'reveal', 'waterfall', 'cache', 'manual']))
       OR v_fb_norm IS NULL
       OR v_fb_key IS NULL
       OR v_fb_event IS NULL THEN
      v_inc_state := 'unrepresentable';
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
        v_fb_type, 'unknown', false,
        COALESCE(v_contact.phone_revealed_at, p_now),
        COALESCE(v_contact.phone_revealed_at, p_now)
      )
      ON CONFLICT (contact_id, dedupe_key) DO NOTHING
      RETURNING id INTO v_inc_phone_id;

      IF v_inc_phone_id IS NULL THEN
        -- A tombstone already holds this key. Never resurrected, never counted as promoted.
        v_inc_state := 'unrepresentable';
      ELSE
        INSERT INTO public.contact_phone_sources (
          contact_phone_id, provider, acquisition_mode,
          raw_provider_type, source_event_key, observed_at
        )
        VALUES (
          v_inc_phone_id, v_fb_provider, v_fb_mode,
          NULLIF(BTRIM(COALESCE(p_incumbent_bootstrap ->> 'raw_provider_type', '')), ''),
          'v1:incumbent:' || v_fb_event,
          COALESCE(v_contact.phone_revealed_at, p_now)
        )
        ON CONFLICT (contact_phone_id, source_event_key) DO NOTHING;

        v_inc_state := 'promoted';
      END IF;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 7 — promote the LIVE candidate collection.
  -- ═══════════════════════════════════════════════════════════════
  -- 116's step 6, unchanged except for the destination. `suppressed_at IS NULL` on the staging
  -- row is the whole tombstone rule: a number 112 erased has nothing to promote, and its
  -- candidate row carries no number to promote anyway (109's `tombstone_is_empty` CHECK).
  --
  -- `is_primary` is deliberately NOT copied. The candidate's own primary means nothing on a
  -- contact that already has one, and election is step 9.

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
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM promoted;

  -- Anything live that did NOT insert was already present as a live canonical row or as a
  -- tombstone. Both are "reused" in the sense that matters: the number is represented by a row
  -- this transaction did not create and must not modify. On an EXISTING contact this is a real,
  -- exercised path — the number the operator revealed may already be there.
  SELECT GREATEST(COUNT(*) - v_inserted, 0) INTO v_reused
  FROM public.contact_enrichment_candidate_phones p
  WHERE p.candidate_id = p_candidate_id
    AND p.suppressed_at IS NULL;

  -- ── Provenance ────────────────────────────────────────────────
  -- Every staging source of every LIVE staging number, joined to the official canonical row by
  -- `dedupe_key`. Apollo and Lusha observing the SAME number produce TWO source rows under ONE
  -- canonical row, because the join is on the number and never on the provider — and on an
  -- existing contact that also means a number ALREADY there simply gains the new provenance
  -- instead of being duplicated.
  --
  -- The join is restricted to LIVE official canonical rows: a tombstone must not gain new
  -- provenance, or the next erasure would find a live source justifying an erased number.

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
  -- 116's step 7, unchanged except for the destination. Only when the candidate's collection
  -- produced NOTHING live: a candidate that has a collection has already said everything it
  -- knows about its numbers, and its scalar is a projection of it.

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

          GET DIAGNOSTICS v_rows = ROW_COUNT;
          v_src_inserted := v_src_inserted + v_rows;
          v_src_seen     := v_src_seen + 1;
          v_scalar_fb    := 'promoted';
        END IF;
      END IF;
    END IF;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 9 — the primary. An incumbent is NEVER demoted.
  -- ═══════════════════════════════════════════════════════════════
  -- THE central rule of this migration, and the reason it does not reuse 116's election. 116
  -- elects on a contact it just created, where there is nothing to displace. Here there may be
  -- a primary the operator or an earlier reveal chose, and an ADDITIVE merge is not a
  -- repriorisation: a candidate arriving with a `personal_mobile` does not take the primary
  -- from an incumbent `work` line, and a MANUAL incumbent — which the ranking below would place
  -- first anyway — is protected before the ranking is even consulted.
  --
  -- Election only happens when the contact has NO live primary at all. Then, in order:
  --   * the incumbent scalar just bootstrapped, if there is one. It IS the number this contact
  --     has always had, and the collection must not start by preferring a stranger to it;
  --   * otherwise the shared ranking, which is 115's and 116's rung for rung, with `dedupe_key`
  --     as the total tie-break so the physical row order never participates.

  SELECT p.id, p.dedupe_key INTO v_primary
  FROM public.contact_phones p
  WHERE p.contact_id = p_contact_id
    AND p.is_primary
    AND p.suppressed_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    v_primary_id    := v_primary.id;
    v_primary_key   := v_primary.dedupe_key;
    v_primary_kept  := true;
  ELSIF v_inc_phone_id IS NOT NULL THEN
    SELECT p.id, p.dedupe_key INTO v_primary
    FROM public.contact_phones p
    WHERE p.id = v_inc_phone_id
      AND p.suppressed_at IS NULL
      AND p.normalized_phone IS NOT NULL
      AND p.phone_status <> 'invalid';
    IF FOUND THEN
      v_primary_id  := v_primary.id;
      v_primary_key := v_primary.dedupe_key;
    END IF;
  END IF;

  IF v_primary_id IS NULL THEN
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

  -- No demotion sweep. When the incumbent was kept there is nothing to change, and when there
  -- was no primary there is nothing to demote — every row this transaction inserted was
  -- inserted with `is_primary = false`. A blanket `UPDATE … SET is_primary = false` would be a
  -- statement capable of demoting an incumbent, and this function must not contain one.
  IF v_primary_id IS NOT NULL AND NOT v_primary_kept THEN
    UPDATE public.contact_phones
       SET is_primary = true
     WHERE id = v_primary_id
       AND NOT is_primary;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 10 — the legacy scalar. Written ONLY when it was NULL.
  -- ═══════════════════════════════════════════════════════════════
  -- Read under the contact lock in step 5, BEFORE anything was promoted. A contact that already
  -- had a number keeps it, with its type, its provenance and its timestamp, whatever the
  -- collection now looks like — including the case where the incumbent could not be
  -- bootstrapped, which is `HISTORICAL_MANUAL_NULL_PROVENANCE_PENDING` and stays open.
  --
  -- `phone_processing_basis` is NOT projected — the official model has no column holding a legal
  -- basis, so any value would be fabricated. `phone_confidence` is never written: it stays the
  -- dead column 4O-E4 found and H2 refused to resurrect. `mobile_phone` is not in this UPDATE
  -- and must not be — MOBILE_PHONE_PROVENANCE_PENDING (4O-E4.1) stands until H5.

  IF v_primary_id IS NOT NULL
     AND NULLIF(BTRIM(COALESCE(v_contact.phone, '')), '') IS NULL THEN
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
     WHERE id = p_contact_id
       -- The scalar is re-asserted NULL in the predicate. The row is locked so it cannot have
       -- changed; if the lock were ever lost, this matches zero rows instead of overwriting a
       -- number somebody typed in the meantime.
       AND NULLIF(BTRIM(COALESCE(phone, '')), '') IS NULL;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_scalar_state := CASE WHEN v_rows > 0 THEN 'projected' ELSE 'incumbent_preserved' END;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 11 — record the merge ON THE CONTACT. The erasure link.
  -- ═══════════════════════════════════════════════════════════════
  -- Not decoration. `resolveContactErasureProvenance` authorises a DSAR deletion only when the
  -- contact ITSELF attests the write, and without this the numbers promoted above would be
  -- discoverable by a later erasure but not erasable by it. Append-only and de-duplicated;
  -- `source_candidate_id` is never touched, because it records where the contact CAME FROM and
  -- a merge does not change that.

  v_merged_ids := COALESCE(v_contact.metadata -> 'merged_candidate_ids', '[]'::jsonb);
  IF jsonb_typeof(v_merged_ids) <> 'array' THEN
    v_merged_ids := '[]'::jsonb;
  END IF;
  IF NOT (v_merged_ids @> to_jsonb(ARRAY[p_candidate_id::text])) THEN
    v_merged_ids := v_merged_ids || to_jsonb(p_candidate_id::text);
  END IF;

  UPDATE public.contacts
     SET metadata   = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('merged_candidate_ids', v_merged_ids),
         updated_by = COALESCE(p_actor_id, updated_by)
   WHERE id = p_contact_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'merge_contact_candidate_into_existing_contact: erasure link not written'
      USING ERRCODE = 'serialization_failure';
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 12 — terminalise the candidate as a MERGED duplicate.
  -- ═══════════════════════════════════════════════════════════════
  -- LAST, and inside the same transaction as everything above: a failure at any point rolls the
  -- phones, the sources and the erasure link back with it.
  --
  -- The status stays `duplicate` — it IS one, and 068's CHECK has no better member; inventing a
  -- fifth would mean a migration on a column every list filter already reads. What distinguishes
  -- a MERGED duplicate from a DISCARDED one is `review.merged_into_contact_id`, injected here,
  -- which is also the idempotency key of step 2. `matched_contacts_id` cannot carry that
  -- distinction: the duplicate gate writes it on both outcomes.
  --
  -- `status = 'duplicate'` is re-asserted in the WHERE against the value read under the lock.

  UPDATE public.contact_enrichment_candidates
     SET status              = p_review_patch ->> 'status',
         duplicate_status    = COALESCE(p_review_patch ->> 'duplicate_status', duplicate_status),
         review_notes        = p_review_patch ->> 'review_notes',
         reviewed_by         = NULLIF(p_review_patch ->> 'reviewed_by', '')::uuid,
         reviewed_at         = NULLIF(p_review_patch ->> 'reviewed_at', '')::timestamptz,
         enrichment_metadata =
           COALESCE(p_review_patch -> 'enrichment_metadata', '{}'::jsonb)
           || jsonb_build_object(
                'review',
                COALESCE(p_review_patch -> 'enrichment_metadata' -> 'review', '{}'::jsonb)
                  || jsonb_build_object(
                       'merged_into_contact_id', p_contact_id::text,
                       'merged_at',              to_jsonb(p_now)
                     )
              )
   WHERE id = p_candidate_id
     AND status = 'duplicate';

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'merge_contact_candidate_into_existing_contact: candidate terminal state not written'
      USING ERRCODE = 'serialization_failure';
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 13 — the envelope.
  -- ═══════════════════════════════════════════════════════════════
  -- Counts, booleans, opaque ids and a `dedupe_key` — which is a SHA-256 by 114's design and
  -- never the number. NO phone number, NO display form, NO name, NO e-mail leaves this function.

  RETURN jsonb_build_object(
    'status',                    'merged',
    'candidate_id',              p_candidate_id,
    'contact_id',                p_contact_id,
    'contact_created',           false,
    'phones_seen',               v_seen,
    'phones_inserted',           v_inserted,
    'phones_reused',             v_reused,
    'phones_skipped_suppressed', v_skipped,
    'sources_inserted',          v_src_inserted,
    'sources_reused',            v_src_reused,
    'primary_dedupe_key',        v_primary_key,
    'primary_preserved',         v_primary_kept,
    'scalar_projection',         v_scalar_state,
    'scalar_fallback',           v_scalar_fb,
    'incumbent_bootstrap',       v_inc_state,
    'candidate_terminal',        true
  );
END;
$function$;

COMMENT ON FUNCTION public.merge_contact_candidate_into_existing_contact(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, uuid, timestamptz
) IS
  'AGENT2A-PHONE-REVEAL-4O-H3-B — adds a duplicate candidate''s OFFICIAL phone collection to an EXISTING contact in ONE transaction, after an explicit human decision. Creates NO contact (that is 116''s job and 116 is untouched): it locks the candidate, refuses anything that is not already `duplicate`, refuses any p_contact_id that is not the `matched_contacts_id` the SERVER itself recorded when it detected the duplicate (the IDOR guard — the client id is a confirmation token, never an instruction), re-checks PERSON-level suppression under that lock with 113''s key and 113''s helpers, then locks the contact. Resolves NO identity: there is not one comparison of a name, an e-mail or a number in the whole function. The incumbent is never demoted — a LIVE official primary is kept as it is, and nothing is elected unless the contact has none; a legacy contact (scalar set, zero contact_phones — every contact in Production today) has its scalar BOOTSTRAPPED into the collection and takes the primary, but only when its provenance inverts unambiguously through 112''s table read backwards (apollo_search / apollo_reveal / apollo_cache / lusha_reveal / manual); provider_payload, unknown and NULL do NOT invert and bootstrap NOTHING, leaving HISTORICAL_MANUAL_NULL_PROVENANCE_PENDING open rather than fabricating a provider. The legacy scalar `contacts.phone` is written ONLY when it was NULL under the lock: an incumbent number, its type, its provenance and its timestamp survive the merge untouched in every other case. Every canonical INSERT is ON CONFLICT (contact_id, dedupe_key) DO NOTHING and every provenance join requires suppressed_at IS NULL, so an existing tombstone is never resurrected and never gains new provenance; a suppressed CANDIDATE phone is never promoted. Apollo and Lusha observing the same number produce ONE canonical row with TWO sources, and a number the contact already had simply gains the new provenance. APPENDS the candidate id to contacts.metadata.merged_candidate_ids — that is a privacy REQUIREMENT, not bookkeeping: the DSAR path authorises an erasure only on the contact''s own attestation of the write, so without it the merge would leave provider numbers a later erasure could find but not erase. Idempotent through review.merged_into_contact_id, which is also what distinguishes a MERGED duplicate from a DISCARDED one (matched_contacts_id is written on both outcomes) and the losing half of a double-click. Lock order candidate → contact → phones, the same order 112/115/116 take. NEVER touches mobile_phone (4O-E4.1) and NEVER writes phone_confidence. Calls no provider, spends no credit, writes no reservation, usage log or waterfall row, and reaches no HubSpot. SECURITY INVOKER on purpose, so it runs under 114''s grant ceiling and physically cannot DELETE a phone row or rewrite a provenance column.';

-- ═══════════════════════════════════════════════════════════════════
-- 2. EXECUTE privileges
-- ═══════════════════════════════════════════════════════════════════
--
-- PostgreSQL grants EXECUTE to PUBLIC on every new function. For a function that WRITES phone
-- data onto an existing contact and terminalises a human review, that means reachability
-- through PostgREST with the anon key, and the REACHABILITY is the defect whether or not RLS
-- would then reject the individual statements. So PUBLIC, `anon` and `authenticated` are revoked
-- explicitly and only `postgres` and `service_role` are granted — the identical four-statement
-- pattern 112, 113, 115 and 116 use.
--
-- `authenticated` is revoked and NOT granted: merging is an authorisation decision and it
-- belongs to the server action that already checks it. A client that could invoke this directly
-- would be merging without ever passing that check — and, worse, would be the only caller able
-- to choose its own arguments.

REVOKE ALL ON FUNCTION public.merge_contact_candidate_into_existing_contact(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, uuid, timestamptz
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.merge_contact_candidate_into_existing_contact(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, uuid, timestamptz
) FROM anon;

REVOKE ALL ON FUNCTION public.merge_contact_candidate_into_existing_contact(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, uuid, timestamptz
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.merge_contact_candidate_into_existing_contact(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, uuid, timestamptz
) TO postgres, service_role;
