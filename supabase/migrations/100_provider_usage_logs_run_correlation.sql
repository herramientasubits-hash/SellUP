-- Migration 100: Run-level correlation columns on provider_usage_logs
-- Agente 1 — A1-APOLLO-BUDGET-RECONCILIATION-1.
--
-- Why: reconciling what a wizard run reserved against what it actually spent
-- currently has only `batch_id` to work with. `batch_id` already exists and is
-- already populated for Apollo rows — this migration deliberately does NOT add
-- a second batch id. What is missing is a way to tell one *reservation* from
-- another when they share a batch:
--
--   * `agent_run_id` is NULL for wizard runs, so it cannot discriminate;
--   * a retry can legitimately reuse a batch id;
--   * two concurrent runs would otherwise only be separable by timestamp, and
--     timestamps are not a correlation key (clock skew, retries, out-of-order
--     logging).
--
-- The application reconciles on batch_id + reservation_id + client_request_id.
-- `wizard_run_id`, `request_fingerprint`, `idempotency_key` and `billing_state`
-- make that reconciliation reproducible and auditable.
--
-- This migration does NOT:
--   * call any provider or spend any credit
--   * change any flag, RLS policy, trigger, grant or view
--   * mutate, backfill or delete a single existing row
--   * duplicate batch_id or make agent_run_id required
--   * get applied to Production by this milestone
--
-- Safety guarantees (same additive pattern as migrations 092–099):
--   * additive only — nullable columns, no defaults that rewrite the table
--   * legacy rows keep NULL in every new column and stay fully readable
--   * PARTIAL indexes cover only non-null values, so legacy rows stay out
--   * idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
--   * only public.provider_usage_logs is touched
--
-- None of these values is PII or a secret: they are opaque correlation ids and
-- hashes derived from a user id, a client request id and request parameters.

-- ── 1. Correlation columns (nullable, additive) ────────────────────

ALTER TABLE public.provider_usage_logs
  ADD COLUMN IF NOT EXISTS reservation_id uuid;

ALTER TABLE public.provider_usage_logs
  ADD COLUMN IF NOT EXISTS client_request_id text;

ALTER TABLE public.provider_usage_logs
  ADD COLUMN IF NOT EXISTS wizard_run_id text;

ALTER TABLE public.provider_usage_logs
  ADD COLUMN IF NOT EXISTS request_fingerprint text;

ALTER TABLE public.provider_usage_logs
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Billing confidence for the row: how sure we are about what the provider
-- actually charged. Deliberately a plain text column with a CHECK rather than
-- an enum type, so adding a state later is another additive migration and not
-- an ALTER TYPE on a live enum.
ALTER TABLE public.provider_usage_logs
  ADD COLUMN IF NOT EXISTS billing_state text;

-- ── 2. billing_state domain constraint ─────────────────────────────
-- NULL stays valid: every legacy row keeps NULL and no row is rewritten.
-- 'recorded' means "our own usage log says so"; 'provider_confirmed' means an
-- external provider statement confirmed it. The application never promotes
-- 'recorded' to 'provider_confirmed' on its own.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'provider_usage_logs_billing_state_check'
  ) THEN
    ALTER TABLE public.provider_usage_logs
      ADD CONSTRAINT provider_usage_logs_billing_state_check
      CHECK (
        billing_state IS NULL
        OR billing_state IN ('unknown', 'estimated', 'recorded', 'provider_confirmed')
      )
      NOT VALID;
  END IF;
END
$$;

-- NOT VALID above means existing rows are not re-scanned on deploy. New and
-- updated rows are still checked. Validating later is optional and online:
--   ALTER TABLE public.provider_usage_logs
--     VALIDATE CONSTRAINT provider_usage_logs_billing_state_check;

-- ── 3. Partial indexes for the real reconciliation queries ─────────
-- The reconciliation reads "all usage rows of this reservation" and, as a
-- fallback when the reservation id was not yet known at write time, "all usage
-- rows of this client request". Both are partial so the overwhelmingly NULL
-- legacy rows never enter the index.

CREATE INDEX IF NOT EXISTS provider_usage_logs_reservation_id_idx
  ON public.provider_usage_logs (reservation_id)
  WHERE reservation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS provider_usage_logs_client_request_id_idx
  ON public.provider_usage_logs (client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Reconciliation always filters by operation as well ("only the Apollo
-- operations of this run"), so the composite index matches the real predicate
-- instead of forcing a second lookup.
CREATE INDEX IF NOT EXISTS provider_usage_logs_run_operation_idx
  ON public.provider_usage_logs (wizard_run_id, provider_key, operation_key)
  WHERE wizard_run_id IS NOT NULL;

-- ── 4. Documentation ───────────────────────────────────────────────

COMMENT ON COLUMN public.provider_usage_logs.reservation_id IS
  'A1-APOLLO-BUDGET-RECONCILIATION-1: wizard_budget_reservations.id that paid for this call. Nullable; no FK so a released reservation never blocks usage history.';

COMMENT ON COLUMN public.provider_usage_logs.client_request_id IS
  'A1-APOLLO-BUDGET-RECONCILIATION-1: client request id of the wizard run. Discriminates concurrent runs that share a batch.';

COMMENT ON COLUMN public.provider_usage_logs.wizard_run_id IS
  'A1-APOLLO-BUDGET-RECONCILIATION-1: deterministic hash of (user_id, client_request_id). Not PII.';

COMMENT ON COLUMN public.provider_usage_logs.request_fingerprint IS
  'A1-APOLLO-BUDGET-RECONCILIATION-1: hash of the requested parameters. Detects a replayed run id with different parameters.';

COMMENT ON COLUMN public.provider_usage_logs.idempotency_key IS
  'A1-APOLLO-BUDGET-RECONCILIATION-1: key under which this run reconciles. Repeated reconciliation of the same reservation is a no-op.';

COMMENT ON COLUMN public.provider_usage_logs.billing_state IS
  'A1-APOLLO-BUDGET-RECONCILIATION-1: unknown | estimated | recorded | provider_confirmed. Internal usage logs never reach provider_confirmed automatically.';
