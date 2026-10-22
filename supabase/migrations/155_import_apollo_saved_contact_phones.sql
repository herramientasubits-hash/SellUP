-- ═══════════════════════════════════════════════════════════════════
-- 155 — APOLLO-SAVED-CONTACT-PHONES-1
-- Import phones that Apollo ALREADY holds on our team's saved Contacts
-- ═══════════════════════════════════════════════════════════════════
--
-- WHY
--
-- Apollo support (human agent, 2026-10-21): a phone the team already revealed and SAVED as
-- an Apollo Contact is not charged again, and `POST /api/v1/contacts/search` (0 credits per
-- Apollo docs) returns it. A read-only plan on 2026-10-21 found 30 people with no phone in
-- SellUp whose number is already saved in Apollo (17 candidates, 13 official contacts).
--
-- This migration adds the two WRITERS for that one-off, operator-run import
-- (`scripts/ops/apollo-saved-contact-phones.mts --execute`). It is NOT wired to any runtime
-- path, flag, cron or UI.
--
-- VOCABULARY — deliberately NO new value
--
-- The numbers are recorded as provenance `(provider='apollo', acquisition_mode='reveal')`:
-- they ARE Apollo-revealed numbers — the team revealed them inside Apollo. The precise
-- origin is the provenance `source_event_key`, which this migration REQUIRES to start with
-- `apollo_saved_contact:` followed by the Apollo Contact id.
--
-- A new acquisition mode was considered and rejected on privacy grounds: the DSAR / erasure
-- writers of migrations 112, 115, 116, 117 and 128 translate `(provider, acquisition_mode)`
-- to the legacy `phone_source` with a hard-coded CASE, and only `apollo_reveal`,
-- `apollo_cache` and `lusha_reveal` are suppressible. An unknown mode maps to `unknown`, and
-- `(apollo, search)` maps to `apollo_search` — BOTH survive an Apollo erasure. Re-issuing five
-- erasure functions to teach them a new value is exactly the kind of change that leaves one
-- behind. `(apollo, reveal)` is already erased by every one of them.
--
-- WHAT THE WRITERS DO NOT DO
--
--   * no `phone_reveal_*` column on the candidate: SellUp did not run a reveal, spent nothing
--     and has no request id, reservation, run or usage log to point at;
--   * never overwrite: a target that already has a visible phone is left untouched
--     (`target_has_phone`), and the official contact also requires `mobile_phone IS NULL`;
--   * never delete (SECURITY INVOKER keeps the 109/114 privilege ceiling: no DELETE on phone
--     rows, no UPDATE on provenance rows);
--   * no usage log, reservation, waterfall row, budget, HubSpot or cache write.
--
-- WHAT THEY KEEP from 120/122
--
--   * `SELECT … FOR UPDATE` on the target;
--   * PERSON-level suppression re-checked INSIDE the lock (candidate:
--     `phone_reveal_candidate_suppression_exists`; official contact:
--     `phone_reveal_person_suppression_exists`). An official contact without an Apollo person
--     id is NOT evaluable and is refused — fail-closed;
--   * the per-number tombstone guard restated in the ON CONFLICT clause;
--   * the type ranking of `CANDIDATE_PHONE_TYPE_RANKING`, mirrored;
--   * idempotency by (owner, dedupe_key) and (phone row, source_event_key): re-running the
--     import is a no-op.
--
-- Additive only: two new functions, no table, column, constraint or existing function is
-- touched. Service-role only.

-- ═══════════════════════════════════════════════════════════════════
-- 1. Candidate writer
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.import_candidate_apollo_saved_phones(
  p_candidate_id       uuid,
  -- The Apollo person id the pure layer resolved for this candidate (or, failing that, the
  -- one on the matched saved Contact). Passed to the person-level suppression re-check.
  p_apollo_person_id   text,
  p_observed_at        timestamptz,
  p_phones             jsonb,
  p_sources            jsonb,
  p_primary_candidates jsonb,
  p_processing_basis   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_type_ranking   text[] := ARRAY[
    'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
  ];

  v_candidate      record;
  v_row            record;
  v_src            record;
  v_pref           record;

  v_incoming_count   integer := 0;
  v_suppressed_count integer := 0;
  v_existing_live    integer := 0;
  v_source_count     integer := 0;
  v_affected         integer := 0;

  v_phone_id       uuid;
  v_chosen_id      uuid := NULL;
  v_chosen_key     text := NULL;
  v_chosen_phone   text := NULL;
  v_chosen_type    text := NULL;
  v_chosen_raw     text := NULL;
BEGIN
  -- ── Step 0 — shape validation, fail-closed, nothing written ────
  IF p_candidate_id IS NULL OR p_observed_at IS NULL OR p_processing_basis IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'missing_identity');
  END IF;

  IF p_phones IS NULL OR jsonb_typeof(p_phones) <> 'array'
     OR p_sources IS NULL OR jsonb_typeof(p_sources) <> 'array'
     OR p_primary_candidates IS NULL OR jsonb_typeof(p_primary_candidates) <> 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'collection_malformed');
  END IF;

  v_incoming_count := jsonb_array_length(p_phones);
  IF v_incoming_count = 0 THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'no_incoming_phones');
  END IF;

  -- Every provenance row must be THIS import and nothing else: Apollo, reveal, the
  -- saved-contact key, and no accounting pointer (there was no paid operation to point at).
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_sources) AS s(
      provider text, acquisition_mode text, source_event_key text,
      waterfall_run_id uuid, reservation_id uuid, provider_usage_log_id uuid
    )
    WHERE s.provider IS DISTINCT FROM 'apollo'
       OR s.acquisition_mode IS DISTINCT FROM 'reveal'
       OR s.source_event_key IS NULL
       OR s.source_event_key NOT LIKE 'apollo_saved_contact:%'
       OR s.waterfall_run_id IS NOT NULL
       OR s.reservation_id IS NOT NULL
       OR s.provider_usage_log_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'foreign_provenance');
  END IF;

  -- ── Step 1 — lock and eligibility ──────────────────────────────
  SELECT c.id, c.phone, c.status, c.source
    INTO v_candidate
  FROM public.contact_enrichment_candidates c
  WHERE c.id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'target_not_eligible', 'detail', 'candidate_not_found');
  END IF;

  IF v_candidate.source IS DISTINCT FROM 'apollo'
     OR v_candidate.status NOT IN ('pending_review', 'approved') THEN
    RETURN jsonb_build_object('status', 'target_not_eligible', 'detail', 'candidate_state');
  END IF;

  -- Never overwrite. A phone that appeared since the plan was computed wins.
  IF v_candidate.phone IS NOT NULL AND btrim(v_candidate.phone) <> '' THEN
    RETURN jsonb_build_object('status', 'target_has_phone');
  END IF;

  -- ── Step 2 — PERSON-level suppression, UNDER the lock ──────────
  IF public.phone_reveal_candidate_suppression_exists(p_candidate_id, p_apollo_person_id) THEN
    RETURN jsonb_build_object('status', 'suppressed');
  END IF;

  -- ── Step 3 — number-level tombstones ───────────────────────────
  SELECT COUNT(*) INTO v_suppressed_count
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
  JOIN public.contact_enrichment_candidate_phones e
    ON e.candidate_id = p_candidate_id AND e.dedupe_key = x.dedupe_key
  WHERE e.suppressed_at IS NOT NULL;

  SELECT COUNT(*) INTO v_existing_live
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
  JOIN public.contact_enrichment_candidate_phones e
    ON e.candidate_id = p_candidate_id AND e.dedupe_key = x.dedupe_key
  WHERE e.suppressed_at IS NULL;

  -- ── Step 4 — canonical phones + provenance ─────────────────────
  FOR v_row IN
    SELECT x.dedupe_key, x.normalized_phone, x.display_phone, x.phone_type, x.phone_status
    FROM jsonb_to_recordset(p_phones) AS x(
      dedupe_key text, normalized_phone text, display_phone text,
      phone_type text, phone_status text
    )
  LOOP
    v_phone_id := NULL;

    INSERT INTO public.contact_enrichment_candidate_phones AS t (
      candidate_id, normalized_phone, display_phone, dedupe_key,
      phone_type, phone_status, is_primary, first_seen_at, last_seen_at
    ) VALUES (
      p_candidate_id, v_row.normalized_phone, v_row.display_phone, v_row.dedupe_key,
      v_row.phone_type, v_row.phone_status, false, p_observed_at, p_observed_at
    )
    ON CONFLICT (candidate_id, dedupe_key) DO UPDATE
      SET
        phone_status = CASE
          WHEN 'valid' IN (t.phone_status, excluded.phone_status) THEN 'valid'
          WHEN t.phone_status = 'invalid'
               AND excluded.phone_status IN ('invalid', 'unknown') THEN 'invalid'
          WHEN excluded.phone_status = 'invalid'
               AND t.phone_status IN ('invalid', 'unknown') THEN 'invalid'
          ELSE 'unknown'
        END,
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
        last_seen_at = p_observed_at
      WHERE t.suppressed_at IS NULL
    RETURNING t.id INTO v_phone_id;

    IF v_phone_id IS NULL THEN
      CONTINUE;
    END IF;

    FOR v_src IN
      SELECT s.provider, s.acquisition_mode, s.raw_provider_type, s.raw_provider_status,
             s.source_event_key
      FROM jsonb_to_recordset(p_sources) AS s(
        dedupe_key text, provider text, acquisition_mode text,
        raw_provider_type text, raw_provider_status text, source_event_key text
      )
      WHERE s.dedupe_key = v_row.dedupe_key
    LOOP
      INSERT INTO public.contact_enrichment_candidate_phone_sources (
        candidate_phone_id, provider, acquisition_mode, raw_provider_type,
        raw_provider_status, waterfall_run_id, reservation_id, provider_usage_log_id,
        source_event_key, observed_at
      ) VALUES (
        v_phone_id, v_src.provider, v_src.acquisition_mode, v_src.raw_provider_type,
        v_src.raw_provider_status, NULL, NULL, NULL,
        v_src.source_event_key, p_observed_at
      )
      ON CONFLICT (candidate_phone_id, source_event_key) DO NOTHING;

      GET DIAGNOSTICS v_affected = ROW_COUNT;
      v_source_count := v_source_count + v_affected;
    END LOOP;
  END LOOP;

  -- ── Step 5 — elect the primary ─────────────────────────────────
  -- The target has NO visible phone (step 1), so whatever is marked primary is not what the
  -- operator sees. The first eligible key in the pure layer's order becomes the primary.
  FOR v_pref IN
    SELECT r.dedupe_key, r.phone, r.phone_type, r.raw_type
    FROM jsonb_array_elements(p_primary_candidates) WITH ORDINALITY AS e(item, ord)
    CROSS JOIN LATERAL jsonb_to_record(e.item) AS r(
      dedupe_key text, phone text, phone_type text, raw_type text
    )
    ORDER BY e.ord
  LOOP
    SELECT p.id INTO v_chosen_id
    FROM public.contact_enrichment_candidate_phones p
    WHERE p.candidate_id = p_candidate_id
      AND p.dedupe_key = v_pref.dedupe_key
      AND p.suppressed_at IS NULL
      AND p.normalized_phone IS NOT NULL
      AND p.phone_status <> 'invalid';

    IF v_chosen_id IS NOT NULL THEN
      v_chosen_key   := v_pref.dedupe_key;
      v_chosen_phone := v_pref.phone;
      v_chosen_type  := v_pref.phone_type;
      v_chosen_raw   := v_pref.raw_type;
      EXIT;
    END IF;
  END LOOP;

  IF v_chosen_id IS NULL OR v_chosen_phone IS NULL OR btrim(v_chosen_phone) = '' THEN
    RETURN jsonb_build_object(
      'status',                   'persisted_without_primary',
      'inserted_phone_count',     v_incoming_count - v_suppressed_count - v_existing_live,
      'inserted_source_count',    v_source_count,
      'suppressed_skipped_count', v_suppressed_count,
      'candidate_scalar_updated', false
    );
  END IF;

  UPDATE public.contact_enrichment_candidate_phones
     SET is_primary = false
   WHERE candidate_id = p_candidate_id AND is_primary AND id <> v_chosen_id;

  UPDATE public.contact_enrichment_candidate_phones
     SET is_primary = true
   WHERE id = v_chosen_id AND NOT is_primary;

  -- ── Step 6 — the visible scalar ────────────────────────────────
  -- `source` is the legacy value of (apollo, reveal), so every reader and every erasure
  -- writer treats it as an Apollo-revealed number. `acquired_via` records the precise origin.
  -- NO phone_reveal_* column is written.
  UPDATE public.contact_enrichment_candidates
     SET phone = v_chosen_phone,
         phone_processing_basis = COALESCE(phone_processing_basis, p_processing_basis),
         enrichment_metadata = jsonb_set(
           COALESCE(enrichment_metadata, '{}'::jsonb),
           '{phone}',
           jsonb_build_object(
             'number',       v_chosen_phone,
             'type',         v_chosen_type,
             'source',       'apollo_reveal',
             'raw_type',     v_chosen_raw,
             'acquired_via', 'apollo_saved_contact'
           ),
           true
         )
   WHERE id = p_candidate_id
     AND (phone IS NULL OR btrim(phone) = '');

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'import_candidate_apollo_saved_phones: candidate scalar update did not affect exactly one row';
  END IF;

  RETURN jsonb_build_object(
    'status',                   'persisted',
    'inserted_phone_count',     v_incoming_count - v_suppressed_count - v_existing_live,
    'inserted_source_count',    v_source_count,
    'suppressed_skipped_count', v_suppressed_count,
    'primary_dedupe_key',       v_chosen_key,
    'candidate_scalar_updated', true
  );
END $$;

COMMENT ON FUNCTION public.import_candidate_apollo_saved_phones(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text
) IS
  'APOLLO-SAVED-CONTACT-PHONES-1 — writes onto a contact_enrichment_candidates row that has NO phone the numbers Apollo already holds on the team''s saved Contact (contacts/search, 0 credits). One transaction: canonical phone rows, provenance (apollo, reveal, source_event_key apollo_saved_contact:<Apollo Contact id>, no accounting pointers — enforced), one primary and the visible scalar with enrichment_metadata.phone.source=apollo_reveal and acquired_via=apollo_saved_contact. Refuses a candidate that is not source=apollo or not pending_review/approved, and never overwrites an existing phone (target_has_phone). Locks the candidate, re-checks PERSON-level suppression inside the lock and re-states the per-number tombstone guard. Writes NO phone_reveal_* column, usage log, reservation or waterfall row: SellUp ran no reveal and spent nothing. phone_processing_basis is set only when empty. SECURITY INVOKER so the 109 privilege ceiling applies. Returns counts and a SHA-256 dedupe key, never a number. Service-role only.';

-- ═══════════════════════════════════════════════════════════════════
-- 2. Official contact writer
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.import_contact_apollo_saved_phones(
  p_contact_id         uuid,
  p_apollo_person_id   text,
  p_observed_at        timestamptz,
  p_phones             jsonb,
  p_sources            jsonb,
  p_primary_candidates jsonb,
  p_processing_basis   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_type_ranking   text[] := ARRAY[
    'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
  ];

  v_contact        record;
  v_row            record;
  v_src            record;
  v_pref           record;

  v_incoming_count   integer := 0;
  v_suppressed_count integer := 0;
  v_existing_live    integer := 0;
  v_source_count     integer := 0;
  v_affected         integer := 0;

  v_phone_id       uuid;
  v_chosen_id      uuid := NULL;
  v_chosen_key     text := NULL;
  v_chosen_phone   text := NULL;
  v_chosen_type    text := NULL;
  v_chosen_raw     text := NULL;
BEGIN
  -- ── Step 0 — shape validation, fail-closed, nothing written ────
  IF p_contact_id IS NULL OR p_observed_at IS NULL OR p_processing_basis IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'missing_identity');
  END IF;

  -- An official contact carries no provider identity of its own. Without the Apollo person
  -- id of the matched saved Contact the person-level suppression cannot be evaluated, and
  -- "could not check" is never "allowed".
  IF p_apollo_person_id IS NULL OR p_apollo_person_id !~ '^[0-9a-f]{24}$' THEN
    RETURN jsonb_build_object('status', 'suppression_not_evaluable');
  END IF;

  IF p_phones IS NULL OR jsonb_typeof(p_phones) <> 'array'
     OR p_sources IS NULL OR jsonb_typeof(p_sources) <> 'array'
     OR p_primary_candidates IS NULL OR jsonb_typeof(p_primary_candidates) <> 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'collection_malformed');
  END IF;

  v_incoming_count := jsonb_array_length(p_phones);
  IF v_incoming_count = 0 THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'no_incoming_phones');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_sources) AS s(
      provider text, acquisition_mode text, source_event_key text,
      waterfall_run_id uuid, reservation_id uuid, provider_usage_log_id uuid
    )
    WHERE s.provider IS DISTINCT FROM 'apollo'
       OR s.acquisition_mode IS DISTINCT FROM 'reveal'
       OR s.source_event_key IS NULL
       OR s.source_event_key NOT LIKE 'apollo_saved_contact:%'
       OR s.waterfall_run_id IS NOT NULL
       OR s.reservation_id IS NOT NULL
       OR s.provider_usage_log_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'foreign_provenance');
  END IF;

  -- ── Step 1 — lock and eligibility ──────────────────────────────
  SELECT c.id, c.account_id, c.phone, c.mobile_phone, c.archived_at
    INTO v_contact
  FROM public.contacts c
  WHERE c.id = p_contact_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'target_not_eligible', 'detail', 'contact_not_found');
  END IF;

  IF v_contact.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'target_not_eligible', 'detail', 'contact_archived');
  END IF;

  IF (v_contact.phone IS NOT NULL AND btrim(v_contact.phone) <> '')
     OR (v_contact.mobile_phone IS NOT NULL AND btrim(v_contact.mobile_phone) <> '') THEN
    RETURN jsonb_build_object('status', 'target_has_phone');
  END IF;

  -- ── Step 2 — PERSON-level suppression, UNDER the lock ──────────
  IF public.phone_reveal_person_suppression_exists(p_apollo_person_id, v_contact.account_id) THEN
    RETURN jsonb_build_object('status', 'suppressed');
  END IF;

  -- ── Step 3 — number-level tombstones ───────────────────────────
  SELECT COUNT(*) INTO v_suppressed_count
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
  JOIN public.contact_phones e
    ON e.contact_id = p_contact_id AND e.dedupe_key = x.dedupe_key
  WHERE e.suppressed_at IS NOT NULL;

  SELECT COUNT(*) INTO v_existing_live
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
  JOIN public.contact_phones e
    ON e.contact_id = p_contact_id AND e.dedupe_key = x.dedupe_key
  WHERE e.suppressed_at IS NULL;

  -- ── Step 4 — canonical phones + provenance ─────────────────────
  FOR v_row IN
    SELECT x.dedupe_key, x.normalized_phone, x.display_phone, x.phone_type, x.phone_status
    FROM jsonb_to_recordset(p_phones) AS x(
      dedupe_key text, normalized_phone text, display_phone text,
      phone_type text, phone_status text
    )
  LOOP
    v_phone_id := NULL;

    INSERT INTO public.contact_phones AS t (
      contact_id, normalized_phone, display_phone, dedupe_key,
      phone_type, phone_status, is_primary, first_seen_at, last_seen_at
    ) VALUES (
      p_contact_id, v_row.normalized_phone, v_row.display_phone, v_row.dedupe_key,
      v_row.phone_type, v_row.phone_status, false, p_observed_at, p_observed_at
    )
    ON CONFLICT (contact_id, dedupe_key) DO UPDATE
      SET
        phone_status = CASE
          WHEN 'valid' IN (t.phone_status, excluded.phone_status) THEN 'valid'
          WHEN t.phone_status = 'invalid'
               AND excluded.phone_status IN ('invalid', 'unknown') THEN 'invalid'
          WHEN excluded.phone_status = 'invalid'
               AND t.phone_status IN ('invalid', 'unknown') THEN 'invalid'
          ELSE 'unknown'
        END,
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
        last_seen_at = p_observed_at
      WHERE t.suppressed_at IS NULL
    RETURNING t.id INTO v_phone_id;

    IF v_phone_id IS NULL THEN
      CONTINUE;
    END IF;

    FOR v_src IN
      SELECT s.provider, s.acquisition_mode, s.raw_provider_type, s.raw_provider_status,
             s.source_event_key
      FROM jsonb_to_recordset(p_sources) AS s(
        dedupe_key text, provider text, acquisition_mode text,
        raw_provider_type text, raw_provider_status text, source_event_key text
      )
      WHERE s.dedupe_key = v_row.dedupe_key
    LOOP
      INSERT INTO public.contact_phone_sources (
        contact_phone_id, provider, acquisition_mode, raw_provider_type,
        raw_provider_status, waterfall_run_id, reservation_id, provider_usage_log_id,
        candidate_phone_id, source_event_key, observed_at
      ) VALUES (
        v_phone_id, v_src.provider, v_src.acquisition_mode, v_src.raw_provider_type,
        v_src.raw_provider_status, NULL, NULL, NULL,
        NULL, v_src.source_event_key, p_observed_at
      )
      ON CONFLICT (contact_phone_id, source_event_key) DO NOTHING;

      GET DIAGNOSTICS v_affected = ROW_COUNT;
      v_source_count := v_source_count + v_affected;
    END LOOP;
  END LOOP;

  -- ── Step 5 — elect the primary ─────────────────────────────────
  FOR v_pref IN
    SELECT r.dedupe_key, r.phone, r.phone_type, r.raw_type
    FROM jsonb_array_elements(p_primary_candidates) WITH ORDINALITY AS e(item, ord)
    CROSS JOIN LATERAL jsonb_to_record(e.item) AS r(
      dedupe_key text, phone text, phone_type text, raw_type text
    )
    ORDER BY e.ord
  LOOP
    SELECT p.id INTO v_chosen_id
    FROM public.contact_phones p
    WHERE p.contact_id = p_contact_id
      AND p.dedupe_key = v_pref.dedupe_key
      AND p.suppressed_at IS NULL
      AND p.normalized_phone IS NOT NULL
      AND p.phone_status <> 'invalid';

    IF v_chosen_id IS NOT NULL THEN
      v_chosen_key   := v_pref.dedupe_key;
      v_chosen_phone := v_pref.phone;
      v_chosen_type  := v_pref.phone_type;
      v_chosen_raw   := v_pref.raw_type;
      EXIT;
    END IF;
  END LOOP;

  IF v_chosen_id IS NULL OR v_chosen_phone IS NULL OR btrim(v_chosen_phone) = '' THEN
    RETURN jsonb_build_object(
      'status',                   'persisted_without_primary',
      'inserted_phone_count',     v_incoming_count - v_suppressed_count - v_existing_live,
      'inserted_source_count',    v_source_count,
      'suppressed_skipped_count', v_suppressed_count,
      'contact_scalar_updated',   false
    );
  END IF;

  UPDATE public.contact_phones
     SET is_primary = false
   WHERE contact_id = p_contact_id AND is_primary AND id <> v_chosen_id;

  UPDATE public.contact_phones
     SET is_primary = true
   WHERE id = v_chosen_id AND NOT is_primary;

  -- ── Step 6 — the visible scalar ────────────────────────────────
  -- `apollo_reveal` is in the legacy suppressible allowlist (4O-E4), so an Apollo DSAR erases
  -- this scalar exactly like a number SellUp revealed itself. `mobile_phone` is never written:
  -- it has no provenance column (4O-E4.1).
  UPDATE public.contacts
     SET phone                  = v_chosen_phone,
         phone_type             = v_chosen_type,
         phone_source           = 'apollo_reveal',
         phone_raw_type         = v_chosen_raw,
         phone_revealed_at      = p_observed_at,
         phone_processing_basis = COALESCE(phone_processing_basis, p_processing_basis)
   WHERE id = p_contact_id
     AND (phone IS NULL OR btrim(phone) = '');

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'import_contact_apollo_saved_phones: contact scalar update did not affect exactly one row';
  END IF;

  RETURN jsonb_build_object(
    'status',                   'persisted',
    'inserted_phone_count',     v_incoming_count - v_suppressed_count - v_existing_live,
    'inserted_source_count',    v_source_count,
    'suppressed_skipped_count', v_suppressed_count,
    'primary_dedupe_key',       v_chosen_key,
    'contact_scalar_updated',   true
  );
END $$;

COMMENT ON FUNCTION public.import_contact_apollo_saved_phones(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text
) IS
  'APOLLO-SAVED-CONTACT-PHONES-1 — writes onto an official contacts row that has NO phone and NO mobile_phone the numbers Apollo already holds on the team''s saved Contact (contacts/search, 0 credits). One transaction: contact_phones rows, contact_phone_sources provenance (apollo, reveal, source_event_key apollo_saved_contact:<Apollo Contact id>, no accounting pointers — enforced), one primary and the visible scalar with phone_source=apollo_reveal (in the 4O-E4 suppressible allowlist, so an Apollo DSAR erases it). Refuses archived contacts, never overwrites (target_has_phone) and refuses without a valid Apollo person id (suppression_not_evaluable). Locks the contact, re-checks PERSON-level suppression (phone_reveal_person_suppression_exists with the contact account) inside the lock and re-states the per-number tombstone guard. Never writes mobile_phone, usage logs, reservations or waterfall rows. phone_processing_basis is set only when empty. SECURITY INVOKER so the 114 privilege ceiling applies. Returns counts and a SHA-256 dedupe key, never a number. Service-role only.';

-- ═══════════════════════════════════════════════════════════════════
-- 3. Privileges — service_role only
-- ═══════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.import_candidate_apollo_saved_phones(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_candidate_apollo_saved_phones(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text
) FROM anon;
REVOKE ALL ON FUNCTION public.import_candidate_apollo_saved_phones(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.import_candidate_apollo_saved_phones(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text
) TO service_role;

REVOKE ALL ON FUNCTION public.import_contact_apollo_saved_phones(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_contact_apollo_saved_phones(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text
) FROM anon;
REVOKE ALL ON FUNCTION public.import_contact_apollo_saved_phones(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.import_contact_apollo_saved_phones(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text
) TO service_role;
