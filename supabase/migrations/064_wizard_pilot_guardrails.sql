-- Migration 064: Wizard Pilot Guardrail Foundation (16AB.43.16)
--
-- Creates the structural foundation for a future controlled pilot of the
-- prospect wizard generation feature. This migration is intentionally inert:
-- pilot_enabled = false, participants = empty, budget periods = empty.
--
-- Nothing in this migration activates the pilot, modifies the wizard action,
-- or changes existing tables. It is purely additive.
--
-- Tables created:
--   1. wizard_pilot_settings          — singleton kill-switch + limits config
--   2. wizard_pilot_participants      — relational allowlist (empty at creation)
--   3. wizard_monthly_budget_periods  — internal budget periods (empty at creation)
--   4. wizard_budget_reservations     — atomic credit reservations
--
-- Functions created:
--   try_reserve_wizard_credits(user_id, client_request_id, requested_credits, period_start)
--   confirm_wizard_credits(reservation_id, actual_credits_consumed, batch_id)
--   release_wizard_credits(reservation_id, batch_id, reason)
--
-- Security model:
--   All tables are RLS-enabled with no public or authenticated access.
--   Functions are executable only by postgres and service_role.
--   No frontend can read or write these tables directly.
--
-- Idempotent seed:
--   wizard_pilot_settings gets exactly one row (pilot_enabled = false).
--   All other tables start empty.

-- ═══════════════════════════════════════════════════════════════
-- 1. wizard_pilot_settings — singleton kill-switch
-- ═══════════════════════════════════════════════════════════════
--
-- Enforces a single configuration row via check_wizard_pilot_settings_singleton().
-- The kill-switch (pilot_enabled) is the first thing try_reserve_wizard_credits
-- checks; setting it to false instantly blocks all future reservations.

CREATE TABLE IF NOT EXISTS public.wizard_pilot_settings (
  id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_enabled                   BOOLEAN     NOT NULL DEFAULT false,
  max_credits_per_execution       INTEGER     NOT NULL DEFAULT 10
    CONSTRAINT wizard_pilot_settings_max_credits_positive
      CHECK (max_credits_per_execution > 0),
  max_active_executions_per_user  INTEGER     NOT NULL DEFAULT 1
    CONSTRAINT wizard_pilot_settings_max_active_positive
      CHECK (max_active_executions_per_user >= 1),
  budget_timezone                 TEXT        NOT NULL DEFAULT 'America/Bogota',
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                      UUID        NULL
    REFERENCES public.internal_users(id) ON DELETE SET NULL
);

-- Singleton enforcement: only one row can ever exist.
CREATE OR REPLACE FUNCTION public.check_wizard_pilot_settings_singleton()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_temp
AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.wizard_pilot_settings) >= 1 THEN
    RAISE EXCEPTION 'wizard_pilot_settings_singleton_violation: only one configuration row is allowed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wizard_pilot_settings_singleton
  ON public.wizard_pilot_settings;
CREATE TRIGGER trg_wizard_pilot_settings_singleton
  BEFORE INSERT ON public.wizard_pilot_settings
  FOR EACH ROW EXECUTE FUNCTION public.check_wizard_pilot_settings_singleton();

DROP TRIGGER IF EXISTS wizard_pilot_settings_set_updated_at
  ON public.wizard_pilot_settings;
CREATE TRIGGER wizard_pilot_settings_set_updated_at
  BEFORE UPDATE ON public.wizard_pilot_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 2. wizard_pilot_participants — relational allowlist
-- ═══════════════════════════════════════════════════════════════
--
-- One row per internal_user ever added to the pilot allowlist.
-- Table starts empty. No user is a participant until explicitly added.
-- enabled_by tracks who added each participant (admin accountability).

CREATE TABLE IF NOT EXISTS public.wizard_pilot_participants (
  user_id     UUID        NOT NULL
    REFERENCES public.internal_users(id) ON DELETE CASCADE,
  is_enabled  BOOLEAN     NOT NULL DEFAULT true,
  enabled_at  TIMESTAMPTZ NULL,
  disabled_at TIMESTAMPTZ NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  enabled_by  UUID        NULL
    REFERENCES public.internal_users(id) ON DELETE SET NULL,

  CONSTRAINT wizard_pilot_participants_pk PRIMARY KEY (user_id)
);

DROP TRIGGER IF EXISTS wizard_pilot_participants_set_updated_at
  ON public.wizard_pilot_participants;
CREATE TRIGGER wizard_pilot_participants_set_updated_at
  BEFORE UPDATE ON public.wizard_pilot_participants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 3. wizard_monthly_budget_periods — internal monthly budget
-- ═══════════════════════════════════════════════════════════════
--
-- Represents the internal credit budget assigned to SellUp for one calendar
-- month. This is NOT the Tavily account balance — it is SellUp's internal
-- allocation decision. Table starts empty.
--
-- period_start must be the first day of a calendar month.
-- credits_reserved and credits_consumed track live counters.
-- The following invariant must hold at all times:
--   credits_consumed + credits_reserved <= budget_credits

CREATE TABLE IF NOT EXISTS public.wizard_monthly_budget_periods (
  period_start      DATE        NOT NULL,
  budget_credits    INTEGER     NOT NULL
    CONSTRAINT wizard_monthly_budget_periods_budget_positive
      CHECK (budget_credits > 0),
  credits_reserved  INTEGER     NOT NULL DEFAULT 0
    CONSTRAINT wizard_monthly_budget_periods_reserved_nonneg
      CHECK (credits_reserved >= 0),
  credits_consumed  INTEGER     NOT NULL DEFAULT 0
    CONSTRAINT wizard_monthly_budget_periods_consumed_nonneg
      CHECK (credits_consumed >= 0),
  is_closed         BOOLEAN     NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID        NULL
    REFERENCES public.internal_users(id) ON DELETE SET NULL,

  CONSTRAINT wizard_monthly_budget_periods_pk
    PRIMARY KEY (period_start),

  -- period_start must be the first calendar day of the month
  CONSTRAINT wizard_monthly_budget_periods_first_day
    CHECK (EXTRACT(DAY FROM period_start) = 1)
);

DROP TRIGGER IF EXISTS wizard_monthly_budget_periods_set_updated_at
  ON public.wizard_monthly_budget_periods;
CREATE TRIGGER wizard_monthly_budget_periods_set_updated_at
  BEFORE UPDATE ON public.wizard_monthly_budget_periods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 4. wizard_budget_reservations — atomic credit reservations
-- ═══════════════════════════════════════════════════════════════
--
-- Each row represents a single budget reservation created before a wizard
-- execution. The reservation lifecycle: reserved → confirmed | released.
--
-- Idempotency: UNIQUE(user_id, client_request_id) ensures that the same
-- wizard request never creates two reservations.
--
-- Single active execution per user: the partial unique index on
-- (user_id) WHERE status = 'reserved' prevents a user from having
-- two simultaneous active reservations.

CREATE TABLE IF NOT EXISTS public.wizard_budget_reservations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start      DATE        NOT NULL
    REFERENCES public.wizard_monthly_budget_periods(period_start),
  user_id           UUID        NOT NULL
    REFERENCES public.internal_users(id) ON DELETE RESTRICT,
  client_request_id UUID        NOT NULL,
  batch_id          UUID        NULL
    REFERENCES public.prospect_batches(id) ON DELETE SET NULL,
  credits_reserved  INTEGER     NOT NULL
    CONSTRAINT wizard_budget_reservations_reserved_positive
      CHECK (credits_reserved > 0),
  credits_consumed  INTEGER     NOT NULL DEFAULT 0
    CONSTRAINT wizard_budget_reservations_consumed_nonneg
      CHECK (credits_consumed >= 0),
  -- credits_consumed may not exceed credits_reserved
  CONSTRAINT wizard_budget_reservations_consumed_le_reserved
    CHECK (credits_consumed <= credits_reserved),
  status            TEXT        NOT NULL DEFAULT 'reserved'
    CONSTRAINT wizard_budget_reservations_status_valid
      CHECK (status IN ('reserved', 'confirmed', 'released', 'failed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at      TIMESTAMPTZ NULL,
  released_at       TIMESTAMPTZ NULL,
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,

  -- Idempotency: same wizard execution never creates two reservations
  CONSTRAINT wizard_budget_reservations_idempotency_key
    UNIQUE (user_id, client_request_id)
);

-- Prevents two simultaneous active reservations for the same user.
-- Satisfies the one-active-execution-per-user invariant atomically.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wizard_budget_reservations_one_active_per_user
  ON public.wizard_budget_reservations (user_id)
  WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_wizard_budget_reservations_period
  ON public.wizard_budget_reservations (period_start);

CREATE INDEX IF NOT EXISTS idx_wizard_budget_reservations_status
  ON public.wizard_budget_reservations (status);

-- ═══════════════════════════════════════════════════════════════
-- 5. RLS policies
-- ═══════════════════════════════════════════════════════════════
--
-- All four tables are service-role-only. No anon, authenticated, or frontend
-- user may read or write them directly. All writes go through the server-side
-- functions below or through authenticated service_role calls from the
-- application layer.

ALTER TABLE public.wizard_pilot_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wizard_pilot_participants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wizard_monthly_budget_periods  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wizard_budget_reservations     ENABLE ROW LEVEL SECURITY;

-- wizard_pilot_settings: service_role only
DROP POLICY IF EXISTS "service_role full access" ON public.wizard_pilot_settings;
CREATE POLICY "service_role full access"
  ON public.wizard_pilot_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- wizard_pilot_participants: service_role only
DROP POLICY IF EXISTS "service_role full access" ON public.wizard_pilot_participants;
CREATE POLICY "service_role full access"
  ON public.wizard_pilot_participants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- wizard_monthly_budget_periods: service_role only
DROP POLICY IF EXISTS "service_role full access" ON public.wizard_monthly_budget_periods;
CREATE POLICY "service_role full access"
  ON public.wizard_monthly_budget_periods
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- wizard_budget_reservations: service_role only
DROP POLICY IF EXISTS "service_role full access" ON public.wizard_budget_reservations;
CREATE POLICY "service_role full access"
  ON public.wizard_budget_reservations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- 6. Function: try_reserve_wizard_credits
-- ═══════════════════════════════════════════════════════════════
--
-- Atomically validates all pilot guardrails and, if all checks pass, creates
-- a credit reservation and increments the period's credits_reserved counter.
--
-- The period row is locked with FOR UPDATE to prevent two concurrent calls
-- from double-spending the same available budget.
--
-- Returns a TEXT status code:
--   reserved                   — success; reservation created
--   already_reserved           — same (user_id, client_request_id) already exists
--   pilot_paused               — pilot_enabled = false in settings
--   user_not_allowed           — user not in allowlist or is_enabled = false
--   period_not_configured      — no period row found for given period_start
--   period_closed              — period is_closed = true
--   execution_limit_exceeded   — requested_credits > max_credits_per_execution
--   insufficient_budget        — not enough budget_credits remaining
--   concurrent_execution_active — user already has a 'reserved' row (different request)

CREATE OR REPLACE FUNCTION public.try_reserve_wizard_credits(
  p_user_id          UUID,
  p_client_request_id UUID,
  p_requested_credits INTEGER,
  p_period_start     DATE
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  v_settings         RECORD;
  v_is_participant   BOOLEAN;
  v_existing_res_id  UUID;
  v_period           RECORD;
  v_new_reservation  UUID;
BEGIN
  -- ── Step 1: Load singleton configuration ───────────────────────
  SELECT
    pilot_enabled,
    max_credits_per_execution,
    max_active_executions_per_user
  INTO v_settings
  FROM public.wizard_pilot_settings
  LIMIT 1;

  IF NOT FOUND THEN
    -- Settings not seeded yet — treat as paused
    RETURN 'pilot_paused';
  END IF;

  -- ── Step 2: Kill-switch ─────────────────────────────────────────
  IF NOT v_settings.pilot_enabled THEN
    RETURN 'pilot_paused';
  END IF;

  -- ── Step 3: Validate participant membership ─────────────────────
  SELECT is_enabled
  INTO v_is_participant
  FROM public.wizard_pilot_participants
  WHERE user_id = p_user_id;

  IF NOT FOUND OR NOT v_is_participant THEN
    RETURN 'user_not_allowed';
  END IF;

  -- ── Step 4: Validate requested_credits is positive ──────────────
  IF p_requested_credits <= 0 THEN
    RETURN 'execution_limit_exceeded';
  END IF;

  -- ── Step 5: Validate credit limit per execution ─────────────────
  IF p_requested_credits > v_settings.max_credits_per_execution THEN
    RETURN 'execution_limit_exceeded';
  END IF;

  -- ── Step 6: Detect existing reservation for same identity ───────
  SELECT id
  INTO v_existing_res_id
  FROM public.wizard_budget_reservations
  WHERE user_id = p_user_id
    AND client_request_id = p_client_request_id;

  IF FOUND THEN
    RETURN 'already_reserved';
  END IF;

  -- ── Step 7: Lock period row for atomic budget update ────────────
  SELECT
    period_start,
    budget_credits,
    credits_reserved,
    credits_consumed,
    is_closed
  INTO v_period
  FROM public.wizard_monthly_budget_periods
  WHERE period_start = p_period_start
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'period_not_configured';
  END IF;

  -- ── Step 8: Validate period is open ─────────────────────────────
  IF v_period.is_closed THEN
    RETURN 'period_closed';
  END IF;

  -- ── Step 9: Validate single active execution per user ───────────
  -- The partial unique index prevents two reserved rows for the same user,
  -- but we check here to return a clear status code before attempting insert.
  IF EXISTS (
    SELECT 1
    FROM public.wizard_budget_reservations
    WHERE user_id = p_user_id
      AND status = 'reserved'
  ) THEN
    RETURN 'concurrent_execution_active';
  END IF;

  -- ── Step 10: Validate sufficient available budget ───────────────
  -- available = budget_credits - credits_consumed - credits_reserved
  IF (v_period.credits_consumed + v_period.credits_reserved + p_requested_credits)
       > v_period.budget_credits THEN
    RETURN 'insufficient_budget';
  END IF;

  -- ── Step 11: Create reservation ─────────────────────────────────
  INSERT INTO public.wizard_budget_reservations
    (period_start, user_id, client_request_id, credits_reserved, status)
  VALUES
    (p_period_start, p_user_id, p_client_request_id, p_requested_credits, 'reserved')
  RETURNING id INTO v_new_reservation;

  -- ── Step 12: Increment period reserved counter ──────────────────
  UPDATE public.wizard_monthly_budget_periods
  SET
    credits_reserved = credits_reserved + p_requested_credits,
    updated_at       = now()
  WHERE period_start = p_period_start;

  RETURN 'reserved';
END;
$$;

REVOKE ALL ON FUNCTION public.try_reserve_wizard_credits(UUID, UUID, INTEGER, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_reserve_wizard_credits(UUID, UUID, INTEGER, DATE)
  TO postgres, service_role;

-- ═══════════════════════════════════════════════════════════════
-- 7. Function: confirm_wizard_credits
-- ═══════════════════════════════════════════════════════════════
--
-- Closes a reservation by recording actual consumption. The full reserved
-- amount is subtracted from credits_reserved, and only the actual consumed
-- amount is added to credits_consumed — the difference is implicitly freed.
--
-- Policy for unverifiable consumption (see section 20 of spec):
-- If actual consumption cannot be confirmed (e.g., provider_usage_logs failed),
-- callers SHOULD pass actual_credits_consumed = credits_reserved to avoid
-- underestimating budget. This is a caller convention, not enforced here.
--
-- Returns:
--   confirmed         — success
--   already_confirmed — reservation was already confirmed (idempotent)
--   reservation_not_found — no row found for given id
--   invalid_actual_credits — actual > reserved or actual < 0

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
  v_res    RECORD;
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
  IF v_res.status = 'confirmed' THEN
    RETURN 'already_confirmed';
  END IF;

  -- ── Cannot confirm a released or failed reservation ─────────────
  IF v_res.status IN ('released', 'failed') THEN
    RETURN 'reservation_not_found';
  END IF;

  -- ── Validate actual consumption range ──────────────────────────
  IF p_actual_credits_consumed < 0
    OR p_actual_credits_consumed > v_res.credits_reserved THEN
    RETURN 'invalid_actual_credits';
  END IF;

  -- ── Lock period row ─────────────────────────────────────────────
  PERFORM 1
  FROM public.wizard_monthly_budget_periods
  WHERE period_start = v_res.period_start
  FOR UPDATE;

  -- ── Update period counters ──────────────────────────────────────
  -- Remove the full reservation from reserved; add only actual to consumed.
  -- The unused credits (reserved - consumed) are implicitly freed.
  UPDATE public.wizard_monthly_budget_periods
  SET
    credits_reserved = GREATEST(0, credits_reserved - v_res.credits_reserved),
    credits_consumed = credits_consumed + p_actual_credits_consumed,
    updated_at       = now()
  WHERE period_start = v_res.period_start;

  -- ── Close reservation ───────────────────────────────────────────
  UPDATE public.wizard_budget_reservations
  SET
    status           = 'confirmed',
    credits_consumed = p_actual_credits_consumed,
    batch_id         = COALESCE(p_batch_id, batch_id),
    confirmed_at     = now()
  WHERE id = p_reservation_id;

  RETURN 'confirmed';
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_wizard_credits(UUID, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_wizard_credits(UUID, INTEGER, UUID)
  TO postgres, service_role;

-- ═══════════════════════════════════════════════════════════════
-- 8. Function: release_wizard_credits
-- ═══════════════════════════════════════════════════════════════
--
-- Cancels a reservation without recording consumption. The reserved amount
-- is returned to the available budget. Use when a wizard execution fails,
-- is cancelled, or never reaches the provider call.
--
-- Returns:
--   released           — success; credits returned
--   already_released   — idempotent; reservation already released
--   already_confirmed  — cannot release a confirmed reservation
--   reservation_not_found — no row found for given id

CREATE OR REPLACE FUNCTION public.release_wizard_credits(
  p_reservation_id UUID,
  p_batch_id       UUID DEFAULT NULL,
  p_reason         TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  v_res RECORD;
BEGIN
  -- ── Lock reservation row ────────────────────────────────────────
  SELECT
    id, period_start, status, credits_reserved
  INTO v_res
  FROM public.wizard_budget_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'reservation_not_found';
  END IF;

  -- ── Idempotency ─────────────────────────────────────────────────
  IF v_res.status = 'released' THEN
    RETURN 'already_released';
  END IF;

  -- ── Cannot release a confirmed reservation ──────────────────────
  IF v_res.status = 'confirmed' THEN
    RETURN 'already_confirmed';
  END IF;

  -- ── Lock period row ─────────────────────────────────────────────
  PERFORM 1
  FROM public.wizard_monthly_budget_periods
  WHERE period_start = v_res.period_start
  FOR UPDATE;

  -- ── Return reserved credits to available pool ───────────────────
  UPDATE public.wizard_monthly_budget_periods
  SET
    credits_reserved = GREATEST(0, credits_reserved - v_res.credits_reserved),
    updated_at       = now()
  WHERE period_start = v_res.period_start;

  -- ── Mark reservation as released ────────────────────────────────
  -- p_reason is stored in metadata. Stack traces and secrets are never stored.
  UPDATE public.wizard_budget_reservations
  SET
    status      = 'released',
    batch_id    = COALESCE(p_batch_id, batch_id),
    released_at = now(),
    metadata    = CASE
                    WHEN p_reason IS NOT NULL
                    THEN jsonb_set(metadata, '{release_reason}', to_jsonb(p_reason))
                    ELSE metadata
                  END
  WHERE id = p_reservation_id;

  RETURN 'released';
END;
$$;

REVOKE ALL ON FUNCTION public.release_wizard_credits(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_wizard_credits(UUID, UUID, TEXT)
  TO postgres, service_role;

-- ═══════════════════════════════════════════════════════════════
-- 9. Singleton helper function
-- ═══════════════════════════════════════════════════════════════
--
-- Used internally and from tests to read the current settings row.

REVOKE ALL ON FUNCTION public.check_wizard_pilot_settings_singleton()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_wizard_pilot_settings_singleton()
  TO postgres, service_role;

-- ═══════════════════════════════════════════════════════════════
-- 10. Idempotent seed — pilot disabled, all counters at zero
-- ═══════════════════════════════════════════════════════════════
--
-- Creates the singleton settings row if it does not already exist.
-- pilot_enabled = false ensures that even if the Vercel feature flag were
-- accidentally set, the DB-side kill-switch still blocks all executions.
--
-- Approved values from 16AB.43.15 revalidation:
--   max_credits_per_execution = 10  (validated technical maximum per run)
--   max_active_executions_per_user = 1
--   budget_timezone = America/Bogota

INSERT INTO public.wizard_pilot_settings
  (pilot_enabled, max_credits_per_execution, max_active_executions_per_user, budget_timezone)
SELECT
  false, 10, 1, 'America/Bogota'
WHERE NOT EXISTS (SELECT 1 FROM public.wizard_pilot_settings);
