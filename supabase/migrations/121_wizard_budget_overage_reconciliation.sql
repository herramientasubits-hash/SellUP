-- Migration 121: TRUTHFUL, TERMINAL settlement when the provider spends MORE
-- than the run reserved (Agente 1 · AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1)
--
-- APPLIED IN PRODUCTION: NO
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS
-- ═══════════════════════════════════════════════════════════════════
--
-- Migration 064 built the budget guardrails on one assumption that is not true of
-- an external provider: that actual spend can never exceed what was reserved. It
-- encoded that assumption twice —
--
--     CONSTRAINT wizard_budget_reservations_consumed_le_reserved
--       CHECK (credits_consumed <= credits_reserved)
--
--     -- confirm_wizard_credits:
--     IF p_actual_credits_consumed > v_res.credits_reserved THEN
--       RETURN 'invalid_actual_credits';
--
-- — and the reservation counter is what makes that assumption dangerous rather
-- than merely wrong. `credits_reserved` is a RESERVATION, not a spend cap: nothing
-- in the wizard, in Apollo, in Tavily or in Lusha asks the provider to stop at the
-- reserved number. The reserved amount is a worst-case ESTIMATE computed before the
-- provider exists (`estimateLushaRunCredits()` → 2; `estimateCreditsForProvider`
-- for Apollo/Tavily), and a provider that bills one credit more than the estimate
-- predicted is an ordinary external fact, not a bug in the caller.
--
-- What happened when that fact arrived:
--
--   1. `confirm_wizard_credits` returned `invalid_actual_credits` and changed
--      NOTHING — not the reservation, not the period.
--   2. Nobody looked. Every settlement call site discards the RPC's answer:
--      the Lusha route awaits `settleReservation(...).catch(() => undefined)` with
--      `settleReservation(): Promise<void>`, and the shared Apollo/Tavily route
--      calls `deps.confirmBudget(...)` in three places without inspecting the
--      returned `ConfirmWizardCreditsOutput` at all. A rejected settlement and a
--      successful one are indistinguishable from the caller's side.
--   3. The reservation stayed `status = 'reserved'` FOREVER. That is the part that
--      hurts: `idx_wizard_budget_reservations_one_active_per_user` is a partial
--      unique index over `(user_id) WHERE status = 'reserved'`, and step 9 of
--      `try_reserve_wizard_credits` returns `concurrent_execution_active` when a
--      reserved row exists. So one overage permanently BLOCKS that user's next run,
--      and the period keeps counting credits that were already spent as merely
--      "reserved" — understating consumption while overstating headroom.
--
-- This is provider-agnostic. Neither the Lusha route nor the shared Apollo/Tavily
-- route inspects the status, so the same silent dead-end applies to all three. Only
-- the trigger differs: Lusha confirms whatever `billing.creditsCharged` reported
-- (`decideLushaCreditsToConfirm` deliberately does NOT clamp), while Apollo/Tavily
-- confirm what `provider_usage_logs` recorded.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION DOES
-- ═══════════════════════════════════════════════════════════════════
--
-- It makes an overage REPRESENTABLE and TERMINAL, and it records the FULL amount.
--
--   * The reservation CHECK is replaced so that `credits_consumed` may exceed
--     `credits_reserved` in exactly one state: `confirmed`. A live reservation
--     (`reserved`) still cannot claim spend above its own reservation, and neither
--     `released` nor `failed` can — those two states mean "no spend recorded here".
--   * `confirm_wizard_credits` stops rejecting `actual > reserved` and instead
--     settles it, returning a distinct code, `confirmed_with_overage`, so the
--     caller can log the overage instead of inferring it.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- ═══════════════════════════════════════════════════════════════════
--
-- IT DOES NOT CLAMP. `LEAST(actual, reserved)` or `min(actual, reserved)` would make
-- every write satisfy the OLD constraint and would look like a fix. It is the
-- opposite of one: it writes a number the provider did not bill, and it understates
-- spend by exactly the amount that matters — the part that went over budget. The
-- authoritative value is what the provider reported, in both the reservation and
-- the period.
--
-- IT DOES NOT CAP THE PERIOD. No constraint is added forcing
-- `credits_consumed <= budget_credits` on `wizard_monthly_budget_periods`. A period
-- CAN truthfully end up overspent (budget 289, consumed 290) because the overspend
-- already happened outside this database; a constraint would only make the true
-- number unstorable and force the clamp back in through the other door. The next
-- run is blocked by ARITHMETIC, not by a constraint: step 10 of
-- `try_reserve_wizard_credits` compares
-- `consumed + reserved + requested > budget_credits`, which is already true when the
-- period is overspent, so the following reservation returns `insufficient_budget`.
--
-- IT DOES NOT WIDEN THE RESERVATION. `credits_reserved` is never rewritten to the
-- actual amount. Reserved-vs-actual is the evidence that an overage occurred; making
-- them equal after the fact would erase it.
--
-- IT DOES NOT CHANGE `try_reserve_wizard_credits` OR `release_wizard_credits`. It
-- does not touch pilot settings, participants, flags, budgets or any row of data.
-- It creates no table and drops no column.
--
-- ═══════════════════════════════════════════════════════════════════
-- ECONOMIC CONTRACT AFTER THIS MIGRATION
-- ═══════════════════════════════════════════════════════════════════
--
--   reserved 6, actual 4 → reservation confirmed/4; period reserved −6, consumed +4
--                          → 'confirmed'              (2 unused credits return)
--   reserved 6, actual 6 → reservation confirmed/6; period reserved −6, consumed +6
--                          → 'confirmed'
--   reserved 6, actual 7 → reservation confirmed/7; period reserved −6, consumed +7
--                          → 'confirmed_with_overage' (the FULL 7 is authoritative)
--
-- In all three the reservation reaches a TERMINAL state, so it leaves the partial
-- unique index and the next run is no longer blocked by a stuck row.
--
-- ═══════════════════════════════════════════════════════════════════
-- SAFETY
-- ═══════════════════════════════════════════════════════════════════
--
-- Backward compatible with existing rows: the new CHECK is strictly WEAKER than the
-- one it replaces (it adds a disjunct), so every row that satisfied the old
-- constraint satisfies the new one and the validation scan cannot fail.
--
-- Repeat-safe: every statement is `DROP ... IF EXISTS` + re-create, or
-- `CREATE OR REPLACE`. Applying this file twice leaves the same state.
--
-- Security preserved verbatim from 064: `SECURITY DEFINER`,
-- `SET search_path = pg_temp`, `FOR UPDATE` row locks on both the reservation and
-- the period, and `REVOKE ALL … FROM PUBLIC, anon, authenticated` +
-- `GRANT EXECUTE … TO postgres, service_role`. The signature is unchanged, so no
-- grant is orphaned on an old overload.
--
-- No provider is called. No credit is spent. No row is inserted, updated or deleted.

-- ═══════════════════════════════════════════════════════════════
-- 1. Reservation invariant — overage only in the terminal confirmed state
-- ═══════════════════════════════════════════════════════════════
--
-- The old constraint (`credits_consumed <= credits_reserved`, unconditional) made a
-- truthful overage physically unstorable. The new one keeps that bound everywhere it
-- still means something and lifts it ONLY for `confirmed`:
--
--   reserved  + consumed > reserved → REJECT  (a live reservation cannot claim
--                                              spend it has not settled)
--   confirmed + consumed > reserved → ALLOW   (the settled truth, this migration)
--   released  + consumed > reserved → REJECT  (released means no spend recorded)
--   failed    + consumed > reserved → REJECT  (same)
--
-- `credits_consumed >= 0` (`…_consumed_nonneg`) and `credits_reserved > 0`
-- (`…_reserved_positive`) are untouched: a negative consumption is still impossible
-- at the schema level, independently of what the RPC validates.
--
-- Why one constraint over two columns and not a trigger: PostgreSQL evaluates a
-- table CHECK against the FINAL row of the statement, so the single UPDATE in
-- `confirm_wizard_credits` that sets `status = 'confirmed'` and
-- `credits_consumed = <actual>` together is validated once, against the row it
-- produces. There is no intermediate state in which the row is still `reserved`
-- while already carrying the overage, and therefore no ordering hazard to work
-- around.

ALTER TABLE public.wizard_budget_reservations
  DROP CONSTRAINT IF EXISTS wizard_budget_reservations_consumed_le_reserved;

ALTER TABLE public.wizard_budget_reservations
  DROP CONSTRAINT IF EXISTS wizard_budget_reservations_consumed_bounded_unless_confirmed;

ALTER TABLE public.wizard_budget_reservations
  ADD CONSTRAINT wizard_budget_reservations_consumed_bounded_unless_confirmed
  CHECK (credits_consumed <= credits_reserved OR status = 'confirmed');

COMMENT ON CONSTRAINT wizard_budget_reservations_consumed_bounded_unless_confirmed
  ON public.wizard_budget_reservations IS
  'AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1: credits_consumed may exceed credits_reserved '
  'ONLY when status = confirmed, i.e. when a provider truthfully billed more than the '
  'run reserved and the reservation has been settled. Replaces migration 064 '
  'wizard_budget_reservations_consumed_le_reserved, which made that fact unstorable '
  'and left the reservation stuck in status = reserved forever.';

-- ═══════════════════════════════════════════════════════════════
-- 2. Function: confirm_wizard_credits (replaces the 064 body)
-- ═══════════════════════════════════════════════════════════════
--
-- Same signature, same locks, same security, same idempotency. Two changes:
--
--   * the upper-bound rejection (`actual > reserved → invalid_actual_credits`) is
--     GONE. A negative actual is still rejected — that is a caller bug, not a
--     provider fact, and no amount of provider truth makes spend negative.
--   * an overage returns `confirmed_with_overage` instead of `confirmed`, so the
--     caller can emit telemetry for it rather than having to re-read the row to
--     discover it happened.
--
-- Period accounting is IDENTICAL in all cases and unchanged from 064:
-- `credits_reserved` drops by the FULL reservation (the reservation is over, so its
-- hold is released whatever was spent) and `credits_consumed` grows by the FULL
-- actual. Only the actual amount differs between the normal and the overage case,
-- and it is never adjusted.
--
-- Idempotency is what keeps an overage from being counted twice: the `status =
-- 'confirmed'` short-circuit returns `already_confirmed` BEFORE any counter moves,
-- so a retried settlement adds nothing. That check runs after `FOR UPDATE`, so two
-- concurrent settlements of the same reservation serialize and the second one sees
-- the first one's committed status.
--
-- Returns:
--   confirmed              — settled; actual <= reserved
--   confirmed_with_overage — settled; actual > reserved (FULL actual recorded)
--   already_confirmed      — idempotent no-op; counters untouched
--   reservation_not_found  — no such row, or the row is released/failed
--   invalid_actual_credits — actual < 0

CREATE OR REPLACE FUNCTION public.confirm_wizard_credits(
  p_reservation_id          UUID,
  p_actual_credits_consumed INTEGER,
  p_batch_id                UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  v_res       RECORD;
  v_is_overage BOOLEAN;
BEGIN
  -- ── Lock reservation row ────────────────────────────────────────
  SELECT
    id, period_start, status, credits_reserved, credits_consumed
  INTO v_res
  FROM public.wizard_budget_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'reservation_not_found';
  END IF;

  -- ── Idempotency: already confirmed ─────────────────────────────
  -- Returns BEFORE touching any counter, so a retry never double-counts an
  -- overage into the period.
  IF v_res.status = 'confirmed' THEN
    RETURN 'already_confirmed';
  END IF;

  -- ── Cannot confirm a released or failed reservation ─────────────
  IF v_res.status IN ('released', 'failed') THEN
    RETURN 'reservation_not_found';
  END IF;

  -- ── Validate actual consumption ────────────────────────────────
  -- Only the lower bound survives. `actual > credits_reserved` is NOT an error:
  -- it is the provider overage this migration exists to settle.
  IF p_actual_credits_consumed < 0 THEN
    RETURN 'invalid_actual_credits';
  END IF;

  v_is_overage := p_actual_credits_consumed > v_res.credits_reserved;

  -- ── Lock period row ─────────────────────────────────────────────
  PERFORM 1
  FROM public.wizard_monthly_budget_periods
  WHERE period_start = v_res.period_start
  FOR UPDATE;

  -- ── Update period counters ──────────────────────────────────────
  -- The FULL reservation leaves `credits_reserved` and the FULL actual enters
  -- `credits_consumed`. When actual < reserved the difference is implicitly freed;
  -- when actual > reserved the period truthfully records the excess, and may end up
  -- with `credits_consumed > budget_credits`. That is intentional: the overspend
  -- already happened, and step 10 of `try_reserve_wizard_credits` will refuse the
  -- next reservation with `insufficient_budget` on the arithmetic alone.
  UPDATE public.wizard_monthly_budget_periods
  SET
    credits_reserved = GREATEST(0, credits_reserved - v_res.credits_reserved),
    credits_consumed = credits_consumed + p_actual_credits_consumed,
    updated_at       = now()
  WHERE period_start = v_res.period_start;

  -- ── Close reservation ───────────────────────────────────────────
  -- `status` and `credits_consumed` move in ONE statement so the row the CHECK
  -- validates is the final, confirmed one. `credits_reserved` is deliberately left
  -- as reserved: the pair (reserved, consumed) is the record that an overage
  -- occurred and by how much.
  UPDATE public.wizard_budget_reservations
  SET
    status           = 'confirmed',
    credits_consumed = p_actual_credits_consumed,
    batch_id         = COALESCE(p_batch_id, batch_id),
    confirmed_at     = now()
  WHERE id = p_reservation_id;

  IF v_is_overage THEN
    RETURN 'confirmed_with_overage';
  END IF;

  RETURN 'confirmed';
END;
$$;

-- Security contract preserved verbatim from migration 064. `CREATE OR REPLACE` on
-- an existing function keeps its ACL, so these two statements are a re-assertion
-- rather than a repair — and they are what makes the file safe to apply to a
-- database where the function does not exist yet.
REVOKE ALL ON FUNCTION public.confirm_wizard_credits(UUID, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_wizard_credits(UUID, INTEGER, UUID)
  TO postgres, service_role;

COMMENT ON FUNCTION public.confirm_wizard_credits(UUID, INTEGER, UUID) IS
  'AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1: settles a wizard budget reservation with the '
  'amount the provider actually billed, including an amount ABOVE what was reserved '
  '(returns confirmed_with_overage). Never clamps to credits_reserved: the full actual '
  'is authoritative in both the reservation and the period. Idempotent via the '
  'already_confirmed short-circuit. Replaces the migration 064 body, which rejected '
  'actual > reserved with invalid_actual_credits and left the reservation stuck in '
  'status = reserved, blocking the user next run through the one-active-reservation '
  'partial unique index.';
