-- Migration 104: atomic credit reservations for the phone reveal waterfall
-- (Agente 2A · AGENT2A-PHONE-WATERFALL-4E, hardened in 4F)
--
-- WHAT 4F ADDED ON TOP OF 4E
--
--   * `reserve_and_create_phone_reveal_run` — reservation AND run in ONE transaction.
--     4E did them in two round trips, and the window between them produced orphan
--     exposure on process death, a lost response or a driver timeout.
--   * `phone_reveal_waterfall_runs.authorization_key` + its unique index — a stable
--     idempotency key generated before the operation, so a retry returns the same run
--     instead of authorizing a second one.
--   * REVOKE/GRANT on every function. PostgreSQL grants EXECUTE to PUBLIC by default;
--     on SECURITY DEFINER functions that bypass RLS, that default was a real hole.
--   * `SET search_path = pg_catalog, pg_temp` (pg_catalog FIRST, so no temp object can
--     shadow a built-in type or relation), pinned function owner, and the missing
--     constraints: strictly positive credit limit, valid period window, and one leg per
--     provider per reservation group.
--
-- WHY THIS EXISTS
--
-- The budget model of this platform is PER PROVIDER: `budget_rules` holds one rule
-- per (provider_key × scope), and `remaining_credits` is derived as
-- `limit_credits - consumed_credits`, where `consumed_credits` is an aggregation over
-- `provider_usage_logs` for that provider inside the rule's period. There is NO
-- reserved/in-flight counter anywhere in that model, so two authorizations that start
-- one after another both read the SAME availability and both pass — and the usage log
-- that would have revealed the first one only appears when the provider has already
-- been charged. AGENT2A-PHONE-WATERFALL-4D checked the balance before creating the
-- run, which closes the "no balance at all" hole but not the concurrency one.
--
-- This migration adds the missing piece: a reservation that is taken ATOMICALLY
-- before the run exists and before any provider is called, so the maximum exposure of
-- an authorization occupies availability for as long as the operation can still spend
-- it. Two concurrent candidates can no longer consume the same availability.
--
-- The wizard already has this shape (migration 064: `try_reserve_wizard_credits` /
-- `confirm_wizard_credits` / `release_wizard_credits`), and this migration follows its
-- conventions deliberately. It does NOT reuse those functions: they operate on
-- `wizard_monthly_budget_periods` — a single shared wizard pool keyed by
-- (user, client_request_id) and gated by the wizard pilot guardrails — which is a
-- different budget model with a different unit of account. Reusing it would have meant
-- charging phone reveals against the prospecting wizard's monthly pilot budget.
--
-- PER-PROVIDER, NOT SHARED. One reservation ROW PER LEG: a full waterfall reserves 8
-- against Apollo and 5 against Lusha, as two rows in the same reservation group,
-- all-or-nothing in one transaction. It is never one row of 13 against one pool,
-- because there is no pool that holds 13: Apollo's 8 can only come out of Apollo's
-- rule and Lusha's 5 out of Lusha's rule.
--
-- NO CREDIT RULE ⇒ NO RESERVATION. `limit_credits` is NOT NULL here on purpose: a
-- provider with no configured credit limit has no availability to reserve against, so
-- the waterfall refuses to start (`budget_not_configured`) instead of running on an
-- imaginary ceiling. That is a deliberate hardening of 4D, where an absent rule read
-- as `unlimited` and authorized the spend.
--
-- This migration is a LOCAL DRAFT ONLY. It has NOT been applied to any remote
-- Supabase project (local, preview or Production) as of AGENT2A-PHONE-WATERFALL-4E.
-- Migrations 102 and 103 ARE applied in Production; this one is strictly additive on
-- top of them and must be applied AFTER them.
--
-- ⚠️ DEPLOYMENT ORDER. `ENABLE_PHONE_REVEAL_WATERFALL` is ON in Production, and the
-- application code of this milestone requires the three functions below. Until this
-- migration is applied, every waterfall authorization fails CLOSED — 0 runs, 0
-- providers, 0 usage logs, 0 credits, and the operator reads "no fue posible verificar
-- el saldo de créditos" — so the failure mode is safe, but the feature is inert. This
-- migration must be applied BEFORE the code is merged and deployed.
--
-- This migration does NOT:
--   * insert, update or delete any row (no backfill, no data migration)
--   * touch `budget_rules`, `provider_usage_logs`, `tool_catalog`,
--     `wizard_monthly_budget_periods`, `wizard_budget_reservations`,
--     `contact_enrichment_candidates`, `phone_reveal_cache` or any other table
--     beyond adding TWO nullable columns to `phone_reveal_waterfall_runs`
--   * change RLS, policies or triggers of any pre-existing table
--   * drop a table, a column, a constraint or an index
--   * create or activate a feature flag
--   * reveal a phone, call Apollo/Lusha/HubSpot or spend credits
--   * contain any phone, email, name, linkedin or provider contact id
--
-- Privacy: PII-free by construction. Only SellUp row ids, provider keys, credit
-- counts, machine vocabularies and timestamps. There is deliberately no column that
-- could hold a phone number, an email, a name, a LinkedIn URL or a provider-side
-- contact id.
--
-- Safety: strictly additive. Every CHECK is created VALIDATED (no `NOT VALID`): the
-- table is brand new and empty, and the added column is nullable, so validating costs
-- nothing and leaves no pending maintenance. Idempotent: CREATE TABLE / INDEX / COLUMN
-- use IF NOT EXISTS, constraints and policies are guarded, and the functions use
-- CREATE OR REPLACE.

-- ── 1. Reservations table ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.phone_reveal_credit_reservations (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ties the legs of ONE authorization together. A full waterfall has two rows
  -- (Apollo + Lusha) sharing this id; Apollo-only and legacy have one. It is generated
  -- by the caller so the run row can carry it and the association survives even if the
  -- per-row back-reference below never gets written.
  reservation_group_id   uuid        NOT NULL,

  -- The candidate whose reveal this authorization pays for. CASCADE for the same
  -- reason as the run row: a deleted candidate has no reservation worth keeping.
  candidate_id           uuid        NOT NULL
    REFERENCES public.contact_enrichment_candidates(id) ON DELETE CASCADE,

  -- Back-reference to the run, written right AFTER the run is created. NULL while the
  -- reservation exists but the run does not yet — which is exactly the window in which
  -- an orphan can appear, so it is queryable (see the orphan index below). The
  -- AUTHORITATIVE association is the other direction
  -- (`phone_reveal_waterfall_runs.credit_reservation_group_id`, written atomically in
  -- the run INSERT); this column is the convenience side and never a gate.
  run_id                 uuid        NULL
    REFERENCES public.phone_reveal_waterfall_runs(id) ON DELETE SET NULL,

  -- Provider whose availability this row occupies. Closed set: these are the only two
  -- legs a phone reveal authorization can ever spend.
  provider_key           text        NOT NULL,

  -- Maximum this leg may cost: 8 for Apollo, 5 for Lusha. It is the CEILING the
  -- operator authorized, not a prediction, and it stays occupied in full for as long as
  -- the row is `reserved` — partially freeing it while the leg can still spend would
  -- re-open the hole this table exists to close.
  credits_reserved       numeric     NOT NULL
    CONSTRAINT phone_reveal_credit_reservations_reserved_positive
    CHECK (credits_reserved > 0),

  -- What the leg ACTUALLY cost, written at confirmation. NULL while `reserved` and
  -- forever on a `released` row. Never 0 as a stand-in for "not reported": an
  -- unreported cost is confirmed at the reserved ceiling with cost_truth
  -- 'assumed_cap', because a cost nobody reported is not a cost of zero.
  credits_confirmed      numeric     NULL
    CONSTRAINT phone_reveal_credit_reservations_confirmed_non_negative
    CHECK (credits_confirmed IS NULL OR credits_confirmed >= 0),

  -- Where `credits_confirmed` came from. Same vocabulary as
  -- `phone_reveal_waterfall_runs.*_cost_source`, minus 'unknown': a confirmation always
  -- lands on a number, and when the provider did not report one the number is the cap
  -- and this column says so.
  cost_truth             text        NULL,

  status                 text        NOT NULL DEFAULT 'reserved',

  -- ── Pool identity (which availability this row occupies) ────────
  -- Mirror of the budget rule that was resolved for this provider + user. Availability
  -- is scoped, so the reservation has to be scoped identically or the sum would mix
  -- pools: a 'user'-scoped rule only competes with that user's reservations, while
  -- 'global' competes with everybody's.
  scope_type             text        NOT NULL,
  -- users.id / group id / role key, or NULL for a global rule. Opaque, never printed.
  scope_id               text        NULL,
  period_start           timestamptz NOT NULL,
  period_end             timestamptz NOT NULL,
  -- Credit limit of the resolved rule. NOT NULL: no rule ⇒ no reservation.
  -- STRICTLY POSITIVE: a rule whose ceiling is 0 has no availability to reserve
  -- against, so `available = 0 - consumed - reserved` is never >= a positive
  -- requirement and no row could legitimately be written with it. Making the CHECK
  -- `> 0` turns "a zero-limit rule reached the insert" from an impossible-in-practice
  -- state into an impossible-by-construction one.
  limit_credits          numeric     NOT NULL
    CONSTRAINT phone_reveal_credit_reservations_limit_positive
    CHECK (limit_credits > 0),

  -- internal_users.id of the operator. NOT a FK, same reasoning as
  -- `phone_reveal_waterfall_runs.authorized_by`: this is an audit record of an
  -- authorization and must survive user-row churn.
  authorized_by          uuid        NOT NULL,

  created_at             timestamptz NOT NULL DEFAULT now(),
  confirmed_at           timestamptz NULL,
  released_at            timestamptz NULL,
  -- Machine code only, never a driver message. Says WHY the exposure was given back.
  release_reason         text        NULL
);

-- ── 2. Closed vocabularies (all VALIDATED on creation) ─────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_credit_reservations_provider_key_check'
  ) THEN
    ALTER TABLE public.phone_reveal_credit_reservations
      ADD CONSTRAINT phone_reveal_credit_reservations_provider_key_check
      CHECK (provider_key IN ('apollo', 'lusha'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_credit_reservations_status_check'
  ) THEN
    ALTER TABLE public.phone_reveal_credit_reservations
      ADD CONSTRAINT phone_reveal_credit_reservations_status_check
      CHECK (
        status IN (
          -- Exposure is OCCUPIED. The leg may still spend up to credits_reserved.
          'reserved',
          -- The leg finished. credits_confirmed holds what it really cost (or the cap
          -- when the provider never reported one). Exposure ends here.
          'confirmed',
          -- The leg provably never ran, so the exposure is given back in full.
          'released'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_credit_reservations_cost_truth_check'
  ) THEN
    ALTER TABLE public.phone_reveal_credit_reservations
      ADD CONSTRAINT phone_reveal_credit_reservations_cost_truth_check
      CHECK (
        cost_truth IS NULL
        OR cost_truth IN (
          -- The provider reported this number.
          'reported',
          -- The provider did NOT report a cost, so the ceiling is charged instead of
          -- pretending the leg was free.
          'assumed_cap'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_credit_reservations_scope_type_check'
  ) THEN
    ALTER TABLE public.phone_reveal_credit_reservations
      ADD CONSTRAINT phone_reveal_credit_reservations_scope_type_check
      CHECK (scope_type IN ('user', 'group', 'role', 'global'));
  END IF;

  -- PERIOD BOUNDARIES. The pool identity includes `period_start`, and the active
  -- exposure SUM groups by it, so an inverted or degenerate window would silently
  -- create a pool that nothing else can ever match — exposure that occupies nobody's
  -- availability. An empty window is not a budget period.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_credit_reservations_period_bounds_check'
  ) THEN
    ALTER TABLE public.phone_reveal_credit_reservations
      ADD CONSTRAINT phone_reveal_credit_reservations_period_bounds_check
      CHECK (period_end > period_start);
  END IF;

  -- A confirmed row must carry a number and its provenance; a reserved row must not
  -- pretend to have one. This is what keeps "unknown cost" from silently becoming 0.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_credit_reservations_confirmation_shape_check'
  ) THEN
    ALTER TABLE public.phone_reveal_credit_reservations
      ADD CONSTRAINT phone_reveal_credit_reservations_confirmation_shape_check
      CHECK (
        (status = 'confirmed' AND credits_confirmed IS NOT NULL AND cost_truth IS NOT NULL)
        OR (status <> 'confirmed' AND credits_confirmed IS NULL AND cost_truth IS NULL)
      );
  END IF;
END $$;

-- ── 3. Indexes ─────────────────────────────────────────────────────

-- AT MOST ONE ACTIVE RESERVATION PER (candidate, provider). Structural guarantee that
-- a double click cannot take the same leg's exposure twice, and the reason the reserve
-- function can report `already_reserved` instead of double-charging availability.
CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_reveal_credit_reservations_active_leg
  ON public.phone_reveal_credit_reservations (candidate_id, provider_key)
  WHERE status = 'reserved';

-- The hot path of the reserve function: SUM(credits_reserved) over one pool.
CREATE INDEX IF NOT EXISTS idx_phone_reveal_credit_reservations_active_pool
  ON public.phone_reveal_credit_reservations
     (provider_key, scope_type, scope_id, period_start)
  WHERE status = 'reserved';

-- Reconciliation lookup: from a terminal run to the legs it has to settle.
CREATE INDEX IF NOT EXISTS idx_phone_reveal_credit_reservations_group
  ON public.phone_reveal_credit_reservations (reservation_group_id);

-- UNAMBIGUOUS GROUP IDENTITY. One reservation group is one authorization, and an
-- authorization has AT MOST ONE leg per provider. Without this, a retry that reused
-- the group id could append a second Apollo leg to a group that already had one, and
-- reconciliation would settle a group whose shape it cannot predict. Unlike the
-- partial index above, this one covers EVERY status: once a group has settled its
-- Apollo leg, that leg cannot be re-added under the same id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_reveal_credit_reservations_group_leg
  ON public.phone_reveal_credit_reservations (reservation_group_id, provider_key);

-- ORPHAN DETECTION. A reservation that is still occupying availability but never got
-- attached to a run is, by definition, exposure nobody will ever settle. This index
-- makes the sweep cheap; it is a diagnostic, not a gate.
CREATE INDEX IF NOT EXISTS idx_phone_reveal_credit_reservations_orphans
  ON public.phone_reveal_credit_reservations (created_at)
  WHERE status = 'reserved' AND run_id IS NULL;

-- ── 4. Run → reservation group (authoritative association) ─────────
-- Written INSIDE the run INSERT, so a run and its reservation group are associated
-- atomically: there is no window in which a run exists whose exposure cannot be found.

ALTER TABLE public.phone_reveal_waterfall_runs
  ADD COLUMN IF NOT EXISTS credit_reservation_group_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_phone_reveal_waterfall_runs_credit_reservation_group
  ON public.phone_reveal_waterfall_runs (credit_reservation_group_id)
  WHERE credit_reservation_group_id IS NOT NULL;

-- ── 4b. Idempotency key of the authorization ───────────────────────
-- (AGENT2A-PHONE-WATERFALL-4F)
--
-- The application generates ONE key per authorization BEFORE calling the database, and
-- retries the same call with the same key. This unique index is what makes the retry
-- idempotent instead of a second authorization: the second attempt collides, the
-- function reads the run the first attempt created, and returns it.
--
-- It is per-AUTHORIZATION, not per-candidate: a later, genuinely new authorization for
-- the same candidate arrives with a NEW key and legitimately creates a new run. Opaque
-- machine value, never printed, PII-free.
ALTER TABLE public.phone_reveal_waterfall_runs
  ADD COLUMN IF NOT EXISTS authorization_key text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_reveal_waterfall_runs_authorization_key
  ON public.phone_reveal_waterfall_runs (authorization_key)
  WHERE authorization_key IS NOT NULL;

-- ── 5. RLS: service_role only ──────────────────────────────────────
-- Same pattern as migrations 099 / 102: RLS on, ONE policy for service_role, and NO
-- policy for `authenticated` or `anon`. The browser can never reach this table.

ALTER TABLE public.phone_reveal_credit_reservations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'phone_reveal_credit_reservations'
      AND policyname = 'service_role_all_phone_reveal_credit_reservations'
  ) THEN
    CREATE POLICY "service_role_all_phone_reveal_credit_reservations"
      ON public.phone_reveal_credit_reservations FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 6. confirm_phone_reveal_credits ────────────────────────────────
--
-- Settles ONE leg against what it really cost. Returns TEXT:
--   confirmed | already_confirmed | already_released | not_found | invalid_input
--
-- `p_credits_confirmed` is never NULL and never a stand-in for "unknown": the caller
-- that cannot obtain a reported cost must pass the reserved ceiling with
-- p_cost_truth = 'assumed_cap'. Confirming at 0 on an unreported cost would hand back
-- availability the provider may well have charged.

CREATE OR REPLACE FUNCTION public.confirm_phone_reveal_credits(
  p_reservation_id    uuid,
  p_credits_confirmed numeric,
  p_cost_truth        text
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  IF p_reservation_id IS NULL
     OR p_credits_confirmed IS NULL
     OR p_credits_confirmed < 0
     OR p_cost_truth IS NULL
     OR p_cost_truth NOT IN ('reported', 'assumed_cap') THEN
    RETURN 'invalid_input';
  END IF;

  SELECT status INTO v_status
  FROM public.phone_reveal_credit_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_status = 'confirmed' THEN RETURN 'already_confirmed'; END IF;
  IF v_status = 'released'  THEN RETURN 'already_released';  END IF;

  UPDATE public.phone_reveal_credit_reservations
  SET status            = 'confirmed',
      credits_confirmed = p_credits_confirmed,
      cost_truth        = p_cost_truth,
      confirmed_at      = now()
  WHERE id = p_reservation_id;

  RETURN 'confirmed';
END $$;

-- ── 7. release_phone_reveal_credits ────────────────────────────────
--
-- Gives back the exposure of ONE leg that provably never ran. Returns TEXT:
--   released | already_confirmed | already_released | not_found | invalid_input
--
-- "Provably never ran" is the whole contract of this function. Legitimate reasons:
-- the run could not be created after the reservation was taken, the unique index
-- rejected it (23505), or the run reached a terminal state with the leg never claimed
-- (`lusha_attempted_at IS NULL`, which the atomic claim makes trustworthy). A leg that
-- WAS attempted is never released — even when its cost is unknown — because releasing
-- it would declare a spend of zero that nobody verified.

CREATE OR REPLACE FUNCTION public.release_phone_reveal_credits(
  p_reservation_id uuid,
  p_reason         text
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  IF p_reservation_id IS NULL THEN RETURN 'invalid_input'; END IF;

  SELECT status INTO v_status
  FROM public.phone_reveal_credit_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_status = 'confirmed' THEN RETURN 'already_confirmed'; END IF;
  IF v_status = 'released'  THEN RETURN 'already_released';  END IF;

  UPDATE public.phone_reveal_credit_reservations
  SET status         = 'released',
      released_at    = now(),
      release_reason = LEFT(COALESCE(p_reason, 'unspecified'), 60)
  WHERE id = p_reservation_id;

  RETURN 'released';
END $$;

-- ── 8. reserve_and_create_phone_reveal_run ─────────────────────────
-- (AGENT2A-PHONE-WATERFALL-4F)
--
-- THE HOLE THIS CLOSES. 4E reserved atomically and then created the run in a SECOND
-- round trip. Between those two statements there is a window in which the reservation
-- is committed and the run does not exist yet, and three ordinary events land inside
-- it: the process dies, the RPC response is lost on the wire after the COMMIT, or the
-- driver times out. In every one of those the compensating release never runs, and the
-- result is an ORPHAN — exposure occupying availability that nobody will ever settle,
-- because settlement is driven from the run. No amount of application-side retry can
-- close it: the application cannot distinguish "the reservation did not happen" from
-- "the reservation happened and I did not hear about it".
--
-- So the two writes become ONE statement, in ONE transaction: lock the pools, recompute
-- availability, insert every leg, insert the run carrying the group id, back-reference
-- the legs, return both ids. Any failure at any step rolls the whole thing back, so a
-- reservation without a run is not merely unlikely — it is unrepresentable.
--
-- IDEMPOTENCY. `p_authorization_key` is generated by the application BEFORE the call
-- and reused verbatim on retry. Two paths make the retry safe:
--   * the key already has a run  ⇒ short-circuit, return it, reserve nothing;
--   * two callers race on the key ⇒ one wins, the loser's unique_violation rolls its
--     own reservations back and it re-reads the winner's run.
-- A genuinely new authorization for the same candidate arrives with a NEW key and is
-- correctly treated as new work.
--
-- WHY THE WRITES SIT IN AN INNER BLOCK. A plpgsql EXCEPTION block rolls back to the
-- savepoint taken at ITS OWN entry. Putting the reservation INSERTs and the run INSERT
-- inside the same block as the handler is what guarantees that catching the run's
-- 23505 also undoes the reservations. A handler placed at function level would leave
-- them committed — which is the very orphan this function exists to make impossible.
--
-- Returns a jsonb envelope:
--   {"status":"created","run_id":…,"reservation_group_id":…,"reservations":[…]}
--   {"status":"already_created","run_id":…,"reservation_group_id":…}   ← idempotent hit
--   {"status":"insufficient_credits","legs":[{provider_key,required,available},…]}
--   {"status":"budget_not_configured","legs":[{provider_key},…]}
--   {"status":"already_reserved"}
--   {"status":"create_conflict"}
--   {"status":"invalid_input","detail":"…"}

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
  v_lock_key        text;
  v_reserved_active numeric;
  v_available       numeric;
  v_required        numeric;
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
  -- Runs BEFORE any lock and any write. A retry of an authorization that already
  -- succeeded must cost nothing and reserve nothing.
  SELECT * INTO v_existing_run
  FROM public.phone_reveal_waterfall_runs
  WHERE authorization_key = p_authorization_key;

  IF FOUND THEN
    -- The key is the identity of ONE authorization of ONE candidate. A key that
    -- resurfaced under a different candidate is a caller bug, and silently returning
    -- the other candidate's run would attribute this operator's spend to it.
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

  -- ── Step 4: availability, per leg, inside the locks ─────────────
  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_legs) LOOP
    v_required := (v_leg->>'credits')::numeric;

    SELECT COALESCE(SUM(r.credits_reserved), 0)
    INTO v_reserved_active
    FROM public.phone_reveal_credit_reservations r
    WHERE r.status = 'reserved'
      AND r.provider_key = (v_leg->>'provider_key')
      AND r.scope_type   = (v_leg->>'scope_type')
      AND r.scope_id IS NOT DISTINCT FROM (v_leg->>'scope_id')
      AND r.period_start = (v_leg->>'period_start')::timestamptz;

    v_available :=
      (v_leg->>'limit_credits')::numeric
      - COALESCE((v_leg->>'consumed_credits')::numeric, 0)
      - v_reserved_active;

    IF v_available < v_required THEN
      v_insufficient := v_insufficient || jsonb_build_array(
        jsonb_build_object(
          'provider_key', v_leg->>'provider_key',
          'required',     v_required,
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
        reservation_group_id, candidate_id, provider_key, credits_reserved,
        status, scope_type, scope_id, period_start, period_end, limit_credits,
        authorized_by
      ) VALUES (
        p_reservation_group_id,
        p_candidate_id,
        v_leg->>'provider_key',
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
          'credits_reserved', (v_leg->>'credits')::numeric
        )
      );
    END LOOP;

    -- The run is born WITH its reservation group and its authorization key. The
    -- single-active-run index (migration 102) is still the authority on "one live
    -- authorization per candidate": if it rejects this insert, the reservations above
    -- are rolled back with it.
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

    -- Convenience back-reference. Free here: same transaction, no extra window.
    UPDATE public.phone_reveal_credit_reservations
    SET run_id = v_run_id
    WHERE reservation_group_id = p_reservation_group_id;

  EXCEPTION
    WHEN unique_violation THEN
      -- Rolled back to the start of THIS block: no reservation and no run survive.
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;

      IF v_constraint = 'uq_phone_reveal_waterfall_runs_authorization_key' THEN
        -- A concurrent caller used the same key and won. Idempotency is the point:
        -- return THEIR run instead of failing this authorization.
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

      IF v_constraint IN (
        'uq_phone_reveal_credit_reservations_active_leg',
        'uq_phone_reveal_credit_reservations_group_leg'
      ) THEN
        RETURN jsonb_build_object('status', 'already_reserved');
      END IF;

      -- uq_phone_reveal_waterfall_runs_active_candidate, or any other: another live
      -- authorization won the race. Benign, and nothing is left occupied.
      RETURN jsonb_build_object('status', 'create_conflict');
  END;

  RETURN jsonb_build_object(
    'status',               'created',
    'run_id',               v_run_id,
    'reservation_group_id', p_reservation_group_id,
    'reservations',         v_created
  );
END $$;

-- ── 9. Execution privileges ────────────────────────────────────────
-- (AGENT2A-PHONE-WATERFALL-4F)
--
-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default. On a SECURITY
-- DEFINER function that inserts reservations and runs — and that bypasses the RLS this
-- migration just enabled — that default is a hole, not a formality: anyone holding the
-- anon key could reach these through PostgREST. The three functions are revoked from
-- PUBLIC/anon/authenticated and granted only to the roles the server actually uses,
-- exactly as migration 064 does for the wizard's equivalents.

REVOKE ALL ON FUNCTION public.confirm_phone_reveal_credits(uuid, numeric, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_phone_reveal_credits(uuid, numeric, text)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.release_phone_reveal_credits(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_phone_reveal_credits(uuid, text)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.reserve_and_create_phone_reveal_run(uuid, uuid, text, uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_and_create_phone_reveal_run(uuid, uuid, text, uuid, jsonb, jsonb)
  TO postgres, service_role;

-- OWNER. A SECURITY DEFINER function runs with its OWNER's privileges, so the owner is
-- part of the security contract and is pinned explicitly instead of being whatever role
-- happened to run the migration. Guarded: if the executing role cannot reassign
-- ownership, the migration reports it rather than failing — the REVOKEs above are the
-- load-bearing control and they have already been applied.
DO $$
BEGIN
  ALTER FUNCTION public.confirm_phone_reveal_credits(uuid, numeric, text)
    OWNER TO postgres;
  ALTER FUNCTION public.release_phone_reveal_credits(uuid, text)
    OWNER TO postgres;
  ALTER FUNCTION public.reserve_and_create_phone_reveal_run(uuid, uuid, text, uuid, jsonb, jsonb)
    OWNER TO postgres;
EXCEPTION
  WHEN insufficient_privilege OR undefined_object THEN
    RAISE NOTICE 'migration 104: could not pin function owner to postgres; EXECUTE revokes remain in force';
END $$;

-- ── 10. Comments ───────────────────────────────────────────────────

COMMENT ON TABLE public.phone_reveal_credit_reservations IS
  'AGENT2A-PHONE-WATERFALL-4E — one row per PROVIDER LEG of one phone reveal authorization, taken atomically BEFORE the run exists and BEFORE any provider call. Closes the concurrency hole of the per-provider budget model (budget_rules + provider_usage_logs have no reserved counter, so two authorizations read the same availability). A full waterfall reserves 8 against Apollo and 5 against Lusha as two rows in one reservation_group_id, all-or-nothing; there is no single pool that holds 13. A provider with no credit rule cannot be reserved against (limit_credits NOT NULL), so the waterfall refuses to start instead of running on an imaginary ceiling. PII-free by construction.';

COMMENT ON COLUMN public.phone_reveal_credit_reservations.credits_reserved IS
  'Ceiling this leg may cost (Apollo 8 / Lusha 5). Stays occupied IN FULL while status = reserved: partially freeing it while the leg can still spend would re-open the double-spend hole.';

COMMENT ON COLUMN public.phone_reveal_credit_reservations.credits_confirmed IS
  'What the leg really cost, written at confirmation. NULL while reserved and on released rows. NEVER 0 as a stand-in for "not reported": an unreported cost is confirmed at credits_reserved with cost_truth = assumed_cap.';

COMMENT ON COLUMN public.phone_reveal_credit_reservations.run_id IS
  'Convenience back-reference, written right after the run is created. The AUTHORITATIVE association is phone_reveal_waterfall_runs.credit_reservation_group_id, written atomically inside the run INSERT. A reserved row with run_id NULL and an old created_at is an orphan candidate (see idx_phone_reveal_credit_reservations_orphans).';

COMMENT ON COLUMN public.phone_reveal_credit_reservations.scope_type IS
  'Scope of the budget rule that was resolved (user | group | role | global), mirrored so the active-exposure SUM never mixes pools. A user-scoped rule only competes with that user''s reservations; a global rule competes with everybody''s.';

COMMENT ON COLUMN public.phone_reveal_waterfall_runs.credit_reservation_group_id IS
  'AGENT2A-PHONE-WATERFALL-4E — reservation group whose legs pay for this run, written INSIDE the run INSERT so run and exposure are associated atomically. NULL only on runs created before this migration.';

COMMENT ON FUNCTION public.confirm_phone_reveal_credits(uuid, numeric, text) IS
  'AGENT2A-PHONE-WATERFALL-4E — settles one leg at its real cost. p_credits_confirmed is never NULL: a caller with no reported cost passes the reserved ceiling with cost_truth = assumed_cap, because confirming 0 on an unreported cost hands back availability the provider may have charged.';

COMMENT ON FUNCTION public.release_phone_reveal_credits(uuid, text) IS
  'AGENT2A-PHONE-WATERFALL-4E — gives back the exposure of one leg that PROVABLY never ran (run creation failed, 23505 conflict, or terminal run with the leg never claimed). A leg that was attempted is never released, even with unknown cost.';

COMMENT ON COLUMN public.phone_reveal_waterfall_runs.authorization_key IS
  'AGENT2A-PHONE-WATERFALL-4F — idempotency key of ONE authorization, generated by the application BEFORE the call and reused verbatim on retry. Unique (partial index), so a retry after a lost response returns the run that already exists instead of authorizing a second one. Per-authorization, NOT per-candidate: a later genuine authorization for the same candidate carries a new key. Opaque machine value, PII-free, never printed.';

COMMENT ON FUNCTION public.reserve_and_create_phone_reveal_run(uuid, uuid, text, uuid, jsonb, jsonb) IS
  'AGENT2A-PHONE-WATERFALL-4F — reserves every leg AND creates the run in ONE transaction, so a reservation without a run is unrepresentable rather than merely unlikely. 4E did the two writes in separate round trips, leaving a window (process death, lost response, driver timeout) in which the committed reservation had no run to settle it and the compensating release never ran. Idempotent on p_authorization_key: an existing run short-circuits before any lock or write, and a concurrent race on the key rolls the loser back and returns the winner run. Returns created | already_created | insufficient_credits | budget_not_configured | already_reserved | create_conflict | invalid_input.';
