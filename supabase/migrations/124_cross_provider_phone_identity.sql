-- Migration 124: cross-provider phone identity resolution
-- (Agente 2A · AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1)
--
-- 🔴 NOT APPLIED IN PRODUCTION. This migration is created inside the PR and is
--    DELIBERATELY not applied to any remote Supabase project by this milestone.
--    `ENABLE_PHONE_REVEAL_WATERFALL` stays OFF and no flag is touched.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS
-- ═══════════════════════════════════════════════════════════════════
--
-- A candidate born in Apollo has `source = 'apollo'` and an Apollo
-- `source_contact_id`. Lusha's phone reveal needs a NATIVE Lusha contact id, and
-- those are different id spaces — reusing Apollo's is exactly the HTTP 422 root
-- cause documented in the async reveal RCA. So today the second phone leg is
-- skipped with `missing_lusha_contact_id` and the waterfall stops at Apollo.
--
-- Resolving that identity means calling `POST /v3/contacts/search`, which the
-- provider bills through `api_search` at 1 credit per API request — including
-- requests that return no results. That single fact is what this migration has to
-- make representable, because none of the three things it needs existed:
--
--   1. A HOME for the resolved id. `contact_enrichment_candidates` has a dedicated
--      `apollo_person_id` (migration 098) and nothing equivalent for Lusha. Writing
--      the Lusha id into `source_contact_id` would silently redefine what the
--      candidate's origin means, and `source` has a CHECK that says 'apollo'.
--
--   2. A RESERVATION GRAIN finer than the provider. `phone_reveal_credit_reservations`
--      is unique on (reservation_group_id, provider_key) and on
--      (candidate_id, provider_key) WHERE reserved, so ONE authorization could never
--      hold both a Lusha search leg and a Lusha reveal leg.
--
--   3. A CLAIM for the search. `phone_reveal_waterfall_runs` has exactly one
--      `lusha_attempted_at`, and it belongs to the REVEAL. Reusing it for the search
--      would make a crash between search and reveal indistinguishable from a reveal
--      that already ran — and would strand the resolved id forever.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION DOES **NOT** DO
-- ═══════════════════════════════════════════════════════════════════
--
--   * does not call any provider, spend any credit or reveal any phone
--   * does not change a single flag, grant, trigger or RLS policy of another table
--   * does not mutate, delete or destructively backfill one existing row
--   * does not widen `contact_enrichment_candidates.source`
--   * does not touch HubSpot, the approval flow, Agent 1 or Production
--
-- BACKWARD COMPATIBILITY IS THE HARD REQUIREMENT. Every legacy reservation row and
-- every legacy run row has to keep meaning exactly what it meant. The new
-- `operation_key` column is NOT NULL DEFAULT 'phone_reveal' precisely so that every
-- historic row reads as what it always was — a phone reveal leg — without an UPDATE
-- and without a table rewrite (PG 11+ stores the default in the catalog).
--
-- Idempotent throughout: CREATE TABLE / COLUMN / INDEX IF NOT EXISTS, constraints
-- guarded by pg_constraint lookups, functions via CREATE OR REPLACE.


-- ═══════════════════════════════════════════════════════════════════
-- 1. contact_provider_identities — the provider-native identity map
-- ═══════════════════════════════════════════════════════════════════
--
-- One row per (candidate, provider): "for THIS candidate, THIS provider knows the
-- person under THIS id". Deliberately a normalized table and NOT a column per
-- provider on the candidate:
--
--   * a column per provider makes every new provider a migration and a new writer;
--   * `source` / `source_contact_id` keep meaning ORIGIN — where the candidate came
--     from — which is a different question from "who else can identify this person";
--   * a candidate can legitimately be known by several providers at once, and the
--     row-per-provider shape says that without any column ever going ambiguous.
--
-- The Apollo→Lusha alias this whole milestone forbids is structurally impossible
-- here: `provider_key` is part of the key, so an id can only ever be read back for
-- the provider that issued it.

CREATE TABLE IF NOT EXISTS public.contact_provider_identities (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE for the same reason as the run and reservation rows: an identity map for
  -- a deleted candidate is not worth keeping, and keeping it would outlive the
  -- privacy decision that deleted the candidate.
  candidate_id        uuid        NOT NULL
    REFERENCES public.contact_enrichment_candidates(id) ON DELETE CASCADE,

  -- Closed set, same vocabulary as the reservation table. A provider we cannot
  -- reserve against is a provider we cannot pay, so it has no business owning an
  -- identity row.
  provider_key        text        NOT NULL,

  -- The provider's OWN id for this person. Opaque, never printed, never logged, and
  -- never sent to a different provider. Not PII by itself: it is an internal
  -- provider handle, not a name, email, phone or LinkedIn URL.
  provider_contact_id text        NOT NULL,

  -- HOW this id was obtained. Auditable provenance is what lets a future reader tell
  -- "the candidate was born here" apart from "we paid a search to learn this", which
  -- are economically very different facts.
  resolution_source   text        NOT NULL,

  -- The run whose authorization paid for the resolution. NULL for a native origin
  -- (nobody paid a search) and for legacy backfills that will never happen. SET NULL
  -- rather than CASCADE: the identity outlives the run that discovered it — that is
  -- the entire point of persisting it.
  resolved_run_id     uuid        NULL
    REFERENCES public.phone_reveal_waterfall_runs(id) ON DELETE SET NULL,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_provider_identities_provider_key_check'
  ) THEN
    ALTER TABLE public.contact_provider_identities
      ADD CONSTRAINT contact_provider_identities_provider_key_check
      CHECK (provider_key IN ('apollo', 'lusha'));
  END IF;

  -- An empty or blank id is not an identity. Without this CHECK a whitespace string
  -- would occupy the unique slot and permanently block the real resolution from ever
  -- being written — a paid search whose result can never land.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_provider_identities_contact_id_non_empty'
  ) THEN
    ALTER TABLE public.contact_provider_identities
      ADD CONSTRAINT contact_provider_identities_contact_id_non_empty
      CHECK (LENGTH(TRIM(provider_contact_id)) > 0);
  END IF;

  -- Closed provenance vocabulary. `provider_native_origin` is the candidate's own
  -- provider (no search was paid); the four `provider_search_*` values name the
  -- EXACT matching key that produced the single unambiguous hit, in the priority
  -- order the application applies. Fuzzy, title-based and company-only matching are
  -- absent on purpose: they are not representable, so they cannot be recorded.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_provider_identities_resolution_source_check'
  ) THEN
    ALTER TABLE public.contact_provider_identities
      ADD CONSTRAINT contact_provider_identities_resolution_source_check
      CHECK (
        resolution_source IN (
          'provider_native_origin',
          'provider_search_linkedin_url',
          'provider_search_email',
          'provider_search_name_company_domain',
          'provider_search_name_company_name'
        )
      );
  END IF;
END $$;

-- THE IDEMPOTENCY GUARANTEE OF THE WHOLE MILESTONE. At most one identity per
-- (candidate, provider) means a second paid search can never produce a second row:
-- the writer's ON CONFLICT DO NOTHING turns the race into a read of the winner.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_provider_identities_candidate_provider
  ON public.contact_provider_identities (candidate_id, provider_key);

-- Reverse lookup: "which candidate does this provider id belong to". Not unique —
-- two candidates legitimately collapsing onto one provider person is a real
-- situation, and making it a constraint violation would break the writer instead of
-- surfacing the duplicate.
CREATE INDEX IF NOT EXISTS idx_contact_provider_identities_provider_contact
  ON public.contact_provider_identities (provider_key, provider_contact_id);

DROP TRIGGER IF EXISTS contact_provider_identities_set_updated_at
  ON public.contact_provider_identities;
CREATE TRIGGER contact_provider_identities_set_updated_at
  BEFORE UPDATE ON public.contact_provider_identities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: service_role ONLY. Same pattern as migrations 099 / 102 / 104 / 120 — one
-- policy for service_role, and NO policy for `authenticated` or `anon`, so the
-- browser can never read a provider-native id.
ALTER TABLE public.contact_provider_identities ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'contact_provider_identities'
      AND policyname = 'service_role_all_contact_provider_identities'
  ) THEN
    CREATE POLICY "service_role_all_contact_provider_identities"
      ON public.contact_provider_identities FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE public.contact_provider_identities IS
  'AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1: provider-native contact ids per candidate. Never an alias: provider_key is part of the key, so an Apollo id can never be read back as a Lusha id.';


-- ═══════════════════════════════════════════════════════════════════
-- 2. Reservation grain: provider × OPERATION, not provider alone
-- ═══════════════════════════════════════════════════════════════════
--
-- One authorization must be able to hold three legs at once:
--
--     apollo / phone_reveal     (up to 8)
--     lusha  / contact_search   (up to 1)
--     lusha  / phone_reveal     (up to 5)
--
-- NOT NULL DEFAULT 'phone_reveal' is what makes this backward compatible: every
-- existing row — all of which ARE phone reveal legs — reads correctly with no
-- UPDATE, no backfill and no rewrite.

ALTER TABLE public.phone_reveal_credit_reservations
  ADD COLUMN IF NOT EXISTS operation_key text NOT NULL DEFAULT 'phone_reveal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_credit_reservations_operation_key_check'
  ) THEN
    ALTER TABLE public.phone_reveal_credit_reservations
      ADD CONSTRAINT phone_reveal_credit_reservations_operation_key_check
      CHECK (
        operation_key IN (
          -- Paying a provider to hand back a phone number.
          'phone_reveal',
          -- Paying a provider to tell us WHICH of its contacts this person is. It
          -- reveals nothing: no email, no phone. It is billed anyway.
          'contact_search'
        )
      );
  END IF;
END $$;

-- ── 2b. Re-grain the two unique indexes ────────────────────────────
--
-- Both old indexes are subsets of the new ones (every legacy row carries
-- operation_key = 'phone_reveal', so the 3-column index enforces exactly the same
-- thing for them). Creating the replacements BEFORE dropping the originals means
-- there is no instant in which the double-charge protection is absent.

CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_reveal_credit_reservations_active_op
  ON public.phone_reveal_credit_reservations (candidate_id, provider_key, operation_key)
  WHERE status = 'reserved';

CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_reveal_credit_reservations_group_op
  ON public.phone_reveal_credit_reservations
     (reservation_group_id, provider_key, operation_key);

DROP INDEX IF EXISTS public.uq_phone_reveal_credit_reservations_active_leg;
DROP INDEX IF EXISTS public.uq_phone_reveal_credit_reservations_group_leg;

-- The pool aggregation index gains nothing from operation_key: availability is
-- summed per (provider × scope × period) regardless of which operation occupies it.
-- Money is money — a search credit and a reveal credit come out of the same Lusha
-- pool, and pretending otherwise would let the two legs each see the full balance.

COMMENT ON COLUMN public.phone_reveal_credit_reservations.operation_key IS
  'AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1: phone_reveal | contact_search. Legacy rows default to phone_reveal, which is what they always were.';


-- ═══════════════════════════════════════════════════════════════════
-- 3. Independent, durable claim for the identity search
-- ═══════════════════════════════════════════════════════════════════
--
-- `lusha_attempted_at` belongs to the REVEAL and keeps belonging to it. The search
-- gets its own timestamp so the four states stay distinguishable:
--
--   search not attempted / attempted+unresolved / attempted+resolved / reveal claimed
--
-- Deliberately NO `lusha_identity_search_cost_credits` column. The cost of that leg
-- already has two authoritative homes — its reservation row (`credits_confirmed` +
-- `cost_truth`) and its `provider_usage_logs` row (operation_key
-- 'lusha_contact_search') — and a third copy could only ever disagree with them.

ALTER TABLE public.phone_reveal_waterfall_runs
  ADD COLUMN IF NOT EXISTS lusha_identity_search_attempted_at timestamptz NULL;

ALTER TABLE public.phone_reveal_waterfall_runs
  ADD COLUMN IF NOT EXISTS lusha_identity_search_outcome text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_waterfall_runs_identity_search_outcome_check'
  ) THEN
    ALTER TABLE public.phone_reveal_waterfall_runs
      ADD CONSTRAINT phone_reveal_waterfall_runs_identity_search_outcome_check
      CHECK (
        lusha_identity_search_outcome IS NULL
        OR lusha_identity_search_outcome IN (
          -- Exactly one unambiguous identity. It is persisted; the reveal may run.
          'resolved',
          -- The provider answered, and it does not know this person. Terminal.
          'not_found',
          -- More than one candidate identity, or one incompatible with the company.
          -- Picking any of them would be a guess, so nothing is picked. Terminal.
          'ambiguous',
          -- Provider error or timeout. We do not know what the provider knows, and
          -- we may well have been billed anyway. Terminal, fail-closed.
          'error',
          -- No usable exact identifier existed, so NO search was issued and NO credit
          -- was spent. Distinct from 'not_found', which cost a credit to learn.
          'no_identifier',
          -- The identity was already persisted from an earlier authorization. 0 calls,
          -- 0 credits. Recorded so an auditor can see WHY this run has no search cost.
          'reused_persisted'
        )
      )
      NOT VALID;
  END IF;
END $$;

-- NOT VALID: existing rows all carry NULL here and are not re-scanned on deploy.
-- New and updated rows are checked. Validating later is optional and online.

COMMENT ON COLUMN public.phone_reveal_waterfall_runs.lusha_identity_search_attempted_at IS
  'AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1: atomic claim of the PAID Lusha identity search. Never conflated with lusha_attempted_at, which claims the reveal.';


-- ═══════════════════════════════════════════════════════════════════
-- 3b. `lusha_skipped_reason` — four new ways the Lusha leg can be skipped
-- ═══════════════════════════════════════════════════════════════════
--
-- Mirror of PHONE_REVEAL_WATERFALL_LUSHA_SKIPPED_REASONS in
-- src/modules/contact-enrichment/phone-reveal-waterfall-core.ts. A static test compares
-- the two lists in BOTH directions, so a reason cannot be added on one side only.
-- Same widening shape migration 122 used for `run_mode`: DROP + re-ADD NOT VALID +
-- VALIDATE, which never rewrites the table and never rejects an existing row (every
-- pre-124 value survives verbatim in the new list).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_waterfall_runs_lusha_skipped_reason_check'
  ) THEN
    ALTER TABLE public.phone_reveal_waterfall_runs
      DROP CONSTRAINT phone_reveal_waterfall_runs_lusha_skipped_reason_check;
  END IF;

  ALTER TABLE public.phone_reveal_waterfall_runs
    ADD CONSTRAINT phone_reveal_waterfall_runs_lusha_skipped_reason_check
    CHECK (
      lusha_skipped_reason IS NULL
      OR lusha_skipped_reason IN (
        -- ── Pre-124 vocabulary, unchanged and in the same order ──
        'missing_lusha_contact_id',
        'apollo_revealed',
        'suppressed',
        'suppression_check_unavailable',
        'dnc',
        'authorization_expired',
        'role_not_allowed',
        'feature_disabled',
        'already_attempted',
        'not_needed',
        'provider_error',
        -- ── Cross-provider identity resolution ──
        -- These four are NOT collapsible into 'missing_lusha_contact_id'. That value
        -- means "this candidate can never reach Lusha". These four mean "it could, and
        -- here is what happened when we tried" — and three of them cost a credit.
        --
        -- No usable exact identifier existed, so NO search was issued. 0 credits.
        'lusha_identity_unresolvable',
        -- Lusha answered and does not know this person. Cost 1 credit to learn.
        'lusha_identity_not_found',
        -- More than one identity, or one that contradicts the company. Cost 1 credit.
        -- Never resolved by picking the first result.
        'lusha_identity_ambiguous',
        -- Search errored or timed out. Fail-closed, and possibly billed anyway.
        'lusha_identity_error'
      )
    ) NOT VALID;

  ALTER TABLE public.phone_reveal_waterfall_runs
    VALIDATE CONSTRAINT phone_reveal_waterfall_runs_lusha_skipped_reason_check;
END $$;


-- ═══════════════════════════════════════════════════════════════════
-- 4. claim_lusha_identity_search — at most one paid search, ever
-- ═══════════════════════════════════════════════════════════════════
--
-- Conditional UPDATE, exactly the shape of the reveal claim: it succeeds for the
-- first caller and fails for every other one, including a caller racing in another
-- process. Returns TEXT rather than boolean so "somebody else has it" and "the
-- authorization expired" are not collapsed into one false.
--
--   claimed | already_claimed | run_not_found | run_terminal | authorization_expired
--
-- The 24 h TTL is re-checked HERE and not only in the application, because the
-- application's clock is not the one that decides whether money may be spent.

CREATE OR REPLACE FUNCTION public.claim_lusha_identity_search(
  p_run_id uuid
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_run public.phone_reveal_waterfall_runs%ROWTYPE;
BEGIN
  IF p_run_id IS NULL THEN RETURN 'run_not_found'; END IF;

  SELECT * INTO v_run
  FROM public.phone_reveal_waterfall_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN 'run_not_found'; END IF;

  IF v_run.lusha_identity_search_attempted_at IS NOT NULL THEN
    RETURN 'already_claimed';
  END IF;

  -- A terminal run has no authorization left to spend. Checked against the same
  -- vocabulary migration 102 established.
  IF v_run.status IN ('revealed', 'no_phone_found', 'failed', 'aborted') THEN
    RETURN 'run_terminal';
  END IF;

  IF v_run.authorized_at <= now() - interval '24 hours' THEN
    RETURN 'authorization_expired';
  END IF;

  UPDATE public.phone_reveal_waterfall_runs
  SET lusha_identity_search_attempted_at = now()
  WHERE id = p_run_id
    AND lusha_identity_search_attempted_at IS NULL;

  IF NOT FOUND THEN RETURN 'already_claimed'; END IF;

  RETURN 'claimed';
END $$;


-- ═══════════════════════════════════════════════════════════════════
-- 5. persist_contact_provider_identity — write-once, race-safe
-- ═══════════════════════════════════════════════════════════════════
--
-- ON CONFLICT DO NOTHING and then READ. The first writer wins and every later one
-- reads the winner's id, which is what makes "once resolved, never search again"
-- true across processes rather than only within one.
--
-- It NEVER overwrites an existing id. An identity that changed under us is not a
-- correction we can make safely from here: overwriting would silently repoint a
-- candidate at a different person, and the reveal that follows would bill for
-- somebody else's phone.
--
--   inserted | already_present | invalid_input | candidate_not_found

CREATE OR REPLACE FUNCTION public.persist_contact_provider_identity(
  p_candidate_id        uuid,
  p_provider_key        text,
  p_provider_contact_id text,
  p_resolution_source   text,
  p_resolved_run_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_id       uuid;
  v_existing public.contact_provider_identities%ROWTYPE;
BEGIN
  IF p_candidate_id IS NULL
     OR p_provider_key IS NULL
     OR p_provider_contact_id IS NULL
     OR LENGTH(TRIM(p_provider_contact_id)) = 0
     OR p_resolution_source IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.contact_enrichment_candidates WHERE id = p_candidate_id
  ) THEN
    RETURN jsonb_build_object('status', 'candidate_not_found');
  END IF;

  INSERT INTO public.contact_provider_identities (
    candidate_id, provider_key, provider_contact_id, resolution_source, resolved_run_id
  ) VALUES (
    p_candidate_id,
    p_provider_key,
    TRIM(p_provider_contact_id),
    p_resolution_source,
    p_resolved_run_id
  )
  ON CONFLICT (candidate_id, provider_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'inserted', 'identity_id', v_id);
  END IF;

  SELECT * INTO v_existing
  FROM public.contact_provider_identities
  WHERE candidate_id = p_candidate_id AND provider_key = p_provider_key;

  RETURN jsonb_build_object(
    'status',              'already_present',
    'identity_id',         v_existing.id,
    'provider_contact_id', v_existing.provider_contact_id
  );
END $$;


-- ═══════════════════════════════════════════════════════════════════
-- 6. reserve_and_create_phone_reveal_run — re-grained, and a real fix
-- ═══════════════════════════════════════════════════════════════════
--
-- Same signature, so this is a pure CREATE OR REPLACE and every existing caller
-- keeps working untouched. Two changes:
--
-- (a) OPERATION GRAIN. Each leg may carry `operation_key`. Absent ⇒ 'phone_reveal',
--     which is exactly what every pre-124 caller means, so old payloads produce
--     byte-identical rows.
--
-- (b) 🔴 AVAILABILITY IS NOW AGGREGATED PER POOL, AND THIS IS A BUG FIX.
--     The 104 version checked each leg against the pool SEPARATELY. With one leg per
--     provider that was correct by accident: no two legs ever shared a pool. The
--     moment one authorization holds `lusha/contact_search` (1) AND
--     `lusha/phone_reveal` (5), the old loop asks "is 1 available?" and "is 5
--     available?" — and a pool holding 5 answers yes to both, then gets 6 inserted
--     into it. Legs that share a pool must be summed BEFORE the comparison, so the
--     question asked is the true one: "is 6 available?".
--
--     This cannot regress any existing caller. Summing a single-element group returns
--     that element, so every pre-124 shape evaluates exactly as it did before.

CREATE OR REPLACE FUNCTION public.reserve_and_create_phone_reveal_run(
  p_candidate_id         uuid,
  p_authorized_by        uuid,
  p_authorization_key    text,
  p_reservation_group_id uuid,
  p_legs                 jsonb,
  p_run                  jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_leg             jsonb;
  v_pool            record;
  v_lock_key        text;
  v_reserved_active numeric;
  v_available       numeric;
  v_missing_budget  jsonb := '[]'::jsonb;
  v_insufficient    jsonb := '[]'::jsonb;
  v_created         jsonb := '[]'::jsonb;
  v_new_id          uuid;
  v_run_id          uuid;
  v_existing_run    public.phone_reveal_waterfall_runs%ROWTYPE;
  v_constraint      text;
BEGIN
  -- ── Step 0: shape validation (fail-closed, nothing written) ─────
  IF p_candidate_id IS NULL
     OR p_authorized_by IS NULL
     OR p_reservation_group_id IS NULL
     OR p_authorization_key IS NULL
     OR LENGTH(TRIM(p_authorization_key)) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'missing_identity');
  END IF;

  IF p_run IS NULL
     OR jsonb_typeof(p_run) <> 'object'
     OR (p_run->>'status') IS NULL
     OR (p_run->>'run_mode') IS NULL
     OR (p_run->>'max_credits_authorized') IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'run_incomplete');
  END IF;

  IF p_legs IS NULL
     OR jsonb_typeof(p_legs) <> 'array'
     OR jsonb_array_length(p_legs) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'legs_empty');
  END IF;

  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_legs) LOOP
    IF (v_leg->>'provider_key') IS NULL
       OR (v_leg->>'credits') IS NULL
       OR (v_leg->>'scope_type') IS NULL
       OR (v_leg->>'period_start') IS NULL
       OR (v_leg->>'period_end') IS NULL THEN
      RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'leg_incomplete');
    END IF;

    IF (v_leg->>'credits')::numeric <= 0 THEN
      RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'leg_credits_not_positive');
    END IF;

    -- An unknown operation is rejected here rather than at the CHECK: a leg whose
    -- meaning we cannot name is a leg whose money we cannot account for.
    IF COALESCE(v_leg->>'operation_key', 'phone_reveal')
         NOT IN ('phone_reveal', 'contact_search') THEN
      RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'leg_operation_unknown');
    END IF;

    IF (v_leg->>'limit_credits') IS NULL THEN
      v_missing_budget := v_missing_budget || jsonb_build_array(
        jsonb_build_object('provider_key', v_leg->>'provider_key')
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_missing_budget) > 0 THEN
    RETURN jsonb_build_object('status', 'budget_not_configured', 'legs', v_missing_budget);
  END IF;

  -- ── Step 1: idempotent short-circuit ────────────────────────────
  SELECT * INTO v_existing_run
  FROM public.phone_reveal_waterfall_runs
  WHERE authorization_key = p_authorization_key;

  IF FOUND THEN
    IF v_existing_run.candidate_id <> p_candidate_id THEN
      RETURN jsonb_build_object(
        'status', 'invalid_input',
        'detail', 'authorization_key_candidate_mismatch'
      );
    END IF;
    RETURN jsonb_build_object(
      'status',               'already_created',
      'run_id',               v_existing_run.id,
      'reservation_group_id', v_existing_run.credit_reservation_group_id
    );
  END IF;

  -- ── Step 2: lock every pool, in a deterministic order ───────────
  -- DISTINCT already collapses the two Lusha legs onto one lock: they share a pool,
  -- so they share the lock, and taking it twice would be a self-deadlock risk for no
  -- benefit. operation_key is deliberately NOT part of the key — the pool is money.
  FOR v_lock_key IN
    SELECT DISTINCT
      (leg->>'provider_key') || '|' ||
      (leg->>'scope_type')   || '|' ||
      COALESCE(leg->>'scope_id', '') || '|' ||
      (leg->>'period_start')
    FROM jsonb_array_elements(p_legs) AS leg
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext(v_lock_key));
  END LOOP;

  -- ── Step 3: one live authorization per candidate ────────────────
  IF EXISTS (
    SELECT 1
    FROM public.phone_reveal_credit_reservations r
    WHERE r.candidate_id = p_candidate_id
      AND r.status = 'reserved'
  ) THEN
    RETURN jsonb_build_object('status', 'already_reserved');
  END IF;

  -- ── Step 4: availability, per POOL, inside the locks ────────────
  -- The GROUP BY is the fix. Legs sharing (provider, scope, period) are one demand on
  -- one balance, and they are compared as one.
  FOR v_pool IN
    SELECT
      leg->>'provider_key'                        AS provider_key,
      leg->>'scope_type'                          AS scope_type,
      leg->>'scope_id'                            AS scope_id,
      (leg->>'period_start')::timestamptz         AS period_start,
      MIN((leg->>'limit_credits')::numeric)       AS limit_credits,
      MIN(COALESCE((leg->>'consumed_credits')::numeric, 0)) AS consumed_credits,
      SUM((leg->>'credits')::numeric)             AS required_credits
    FROM jsonb_array_elements(p_legs) AS leg
    GROUP BY 1, 2, 3, 4
  LOOP
    SELECT COALESCE(SUM(r.credits_reserved), 0)
    INTO v_reserved_active
    FROM public.phone_reveal_credit_reservations r
    WHERE r.status = 'reserved'
      AND r.provider_key = v_pool.provider_key
      AND r.scope_type   = v_pool.scope_type
      AND r.scope_id IS NOT DISTINCT FROM v_pool.scope_id
      AND r.period_start = v_pool.period_start;

    v_available := v_pool.limit_credits - v_pool.consumed_credits - v_reserved_active;

    IF v_available < v_pool.required_credits THEN
      v_insufficient := v_insufficient || jsonb_build_array(
        jsonb_build_object(
          'provider_key', v_pool.provider_key,
          'required',     v_pool.required_credits,
          'available',    v_available
        )
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_insufficient) > 0 THEN
    RETURN jsonb_build_object('status', 'insufficient_credits', 'legs', v_insufficient);
  END IF;

  -- ── Step 5: reserve AND create, all inside one rollback scope ───
  BEGIN
    FOR v_leg IN SELECT * FROM jsonb_array_elements(p_legs) LOOP
      INSERT INTO public.phone_reveal_credit_reservations (
        reservation_group_id, candidate_id, provider_key, operation_key,
        credits_reserved, status, scope_type, scope_id, period_start, period_end,
        limit_credits, authorized_by
      ) VALUES (
        p_reservation_group_id,
        p_candidate_id,
        v_leg->>'provider_key',
        COALESCE(v_leg->>'operation_key', 'phone_reveal'),
        (v_leg->>'credits')::numeric,
        'reserved',
        v_leg->>'scope_type',
        v_leg->>'scope_id',
        (v_leg->>'period_start')::timestamptz,
        (v_leg->>'period_end')::timestamptz,
        (v_leg->>'limit_credits')::numeric,
        p_authorized_by
      )
      RETURNING id INTO v_new_id;

      v_created := v_created || jsonb_build_array(
        jsonb_build_object(
          'id',               v_new_id,
          'provider_key',     v_leg->>'provider_key',
          'operation_key',    COALESCE(v_leg->>'operation_key', 'phone_reveal'),
          'credits_reserved', (v_leg->>'credits')::numeric
        )
      );
    END LOOP;

    INSERT INTO public.phone_reveal_waterfall_runs (
      candidate_id, status, run_mode, authorized_at, authorized_by, authorized_by_role,
      max_credits_authorized, apollo_attempted_at, apollo_outcome, apollo_cost_source,
      lusha_eligible, lusha_skipped_reason,
      credit_reservation_group_id, authorization_key
    ) VALUES (
      p_candidate_id,
      p_run->>'status',
      p_run->>'run_mode',
      COALESCE((p_run->>'authorized_at')::timestamptz, now()),
      p_authorized_by,
      p_run->>'authorized_by_role',
      (p_run->>'max_credits_authorized')::integer,
      (p_run->>'apollo_attempted_at')::timestamptz,
      p_run->>'apollo_outcome',
      p_run->>'apollo_cost_source',
      (p_run->>'lusha_eligible')::boolean,
      p_run->>'lusha_skipped_reason',
      p_reservation_group_id,
      p_authorization_key
    )
    RETURNING id INTO v_run_id;

    UPDATE public.phone_reveal_credit_reservations
    SET run_id = v_run_id
    WHERE reservation_group_id = p_reservation_group_id;

  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;

      IF v_constraint = 'uq_phone_reveal_waterfall_runs_authorization_key' THEN
        SELECT * INTO v_existing_run
        FROM public.phone_reveal_waterfall_runs
        WHERE authorization_key = p_authorization_key;

        IF FOUND THEN
          RETURN jsonb_build_object(
            'status',               'already_created',
            'run_id',               v_existing_run.id,
            'reservation_group_id', v_existing_run.credit_reservation_group_id
          );
        END IF;
        RETURN jsonb_build_object('status', 'create_conflict');
      END IF;

      -- Both the pre-124 index names and the re-grained ones are listed. The old
      -- names cannot fire after this migration, and keeping them costs nothing while
      -- making the handler correct if this function is ever replayed against a
      -- database where 124's index swap has not run yet.
      IF v_constraint IN (
        'uq_phone_reveal_credit_reservations_active_leg',
        'uq_phone_reveal_credit_reservations_group_leg',
        'uq_phone_reveal_credit_reservations_active_op',
        'uq_phone_reveal_credit_reservations_group_op'
      ) THEN
        RETURN jsonb_build_object('status', 'already_reserved');
      END IF;

      RETURN jsonb_build_object('status', 'create_conflict');
  END;

  RETURN jsonb_build_object(
    'status',               'created',
    'run_id',               v_run_id,
    'reservation_group_id', p_reservation_group_id,
    'reservations',         v_created
  );
END $$;


-- ═══════════════════════════════════════════════════════════════════
-- 7. Execution privileges for the two NEW functions
-- ═══════════════════════════════════════════════════════════════════
--
-- PostgreSQL grants EXECUTE to PUBLIC by default. On SECURITY DEFINER functions that
-- write a claim and an identity row — and that bypass the RLS enabled above — that
-- default is a hole. Same treatment as migration 104's three functions.
--
-- `reserve_and_create_phone_reveal_run` keeps the grants 104 already applied:
-- CREATE OR REPLACE preserves privileges and ownership of an existing function.

REVOKE ALL ON FUNCTION public.claim_lusha_identity_search(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_lusha_identity_search(uuid)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.persist_contact_provider_identity(uuid, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_contact_provider_identity(uuid, text, text, text, uuid)
  TO postgres, service_role;

DO $$
BEGIN
  ALTER FUNCTION public.claim_lusha_identity_search(uuid) OWNER TO postgres;
  ALTER FUNCTION public.persist_contact_provider_identity(uuid, text, text, text, uuid)
    OWNER TO postgres;
EXCEPTION
  WHEN insufficient_privilege OR undefined_object THEN
    RAISE NOTICE 'Could not reassign function ownership; REVOKE/GRANT above still apply.';
END $$;
