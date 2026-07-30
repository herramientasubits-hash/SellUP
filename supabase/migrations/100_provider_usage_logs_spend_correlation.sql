-- =============================================================================
-- Migration 100 — provider_usage_logs: spend correlation + economic observability
-- A1-APOLLO-BUDGET-RECONCILIATION-1
--
-- STATUS: NOT APPLIED. Created and reviewed in this hito; applying it to
-- Production is a separate, explicitly authorised step.
--
-- WHY
-- ---
-- Reconciling a single Apollo credit required matching `created_at` timestamps.
-- In A1-APOLLO-LIVE-QA-1 (batch 7a75df68-aaa2-4558-9118-0846486a3e97) the two
-- Apollo logs carried `batch_id` but nothing linking them to the budget
-- reservation, and `agent_run_id` was NULL, so 4 recorded credits could not be
-- tied to a 3-credit reservation by identity alone.
--
-- These columns make the identifiers the application already computes queryable
-- and indexable. The SAME data is written to `metadata` today (keys
-- `run_correlation` and `spend_observability`), so reconciliation already works
-- without this migration — this only removes the need to traverse jsonb.
--
-- BACKWARD COMPATIBILITY
-- ----------------------
--   * Additive only. No column is dropped, renamed or retyped.
--   * Every new column is NULLABLE with NO default, so existing rows are NOT
--     rewritten and no historical value changes. `ADD COLUMN` with no default is
--     a metadata-only operation in modern Postgres — no table rewrite, no long
--     lock on a large table.
--   * No constraint is added that existing rows could violate.
--   * Writers stay compatible in BOTH directions: the application only names
--     these columns when ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS is true, so
--     code deployed before this migration keeps inserting successfully, and code
--     deployed after it keeps working with the flag off.
--   * Indexes are created CONCURRENTLY-safe by being partial (WHERE ... NOT NULL):
--     they stay empty until the writer flag is switched on.
--
-- ROLLBACK
-- --------
-- Dropping the columns is safe while the writer flag is off. See the commented
-- rollback block at the end; it is intentionally not executed here.
-- =============================================================================

-- ── Correlation identifiers (§1, §3) ─────────────────────────────────────────
-- `batch_id` and `agent_run_id` already exist. These add the missing links: the
-- budget reservation, the client request that started the run, and the optional
-- wizard run / fingerprint / idempotency identifiers.

ALTER TABLE public.provider_usage_logs
  ADD COLUMN IF NOT EXISTS reservation_id      uuid,
  ADD COLUMN IF NOT EXISTS client_request_id   text,
  ADD COLUMN IF NOT EXISTS wizard_run_id       text,
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS idempotency_key     text;

COMMENT ON COLUMN public.provider_usage_logs.reservation_id IS
  'wizard_budget_reservations.id this call is billed against. NULL for calls outside a reserved wizard run. A1-APOLLO-BUDGET-RECONCILIATION-1.';
COMMENT ON COLUMN public.provider_usage_logs.client_request_id IS
  'Client request id that started the run — the idempotency anchor shared with wizard_budget_reservations.';
COMMENT ON COLUMN public.provider_usage_logs.wizard_run_id IS
  'Optional wizard run identifier. Nullable by contract; reconciliation never depends on it.';
COMMENT ON COLUMN public.provider_usage_logs.request_fingerprint IS
  'Deterministic fingerprint of the provider request (no secrets, no full query).';
COMMENT ON COLUMN public.provider_usage_logs.idempotency_key IS
  'Run-scoped key for one billable operation; a retry collides here instead of double-counting.';

-- Deliberately NO foreign key on reservation_id.
--
-- provider_usage_logs is an append-only economic ledger. A FK would let a
-- reservation row's lifecycle (or a cascade) mutate or erase spend evidence, and
-- an insert that fails on a FK after a real Apollo call means credits spent with
-- no record — the exact failure mode Q3F-5AU.10S documented for batch_id.
-- Integrity here is enforced by the application, which builds the correlation
-- before the first paid call and fails closed when it cannot.

-- ── Economic observability (§10) ─────────────────────────────────────────────
-- All nullable: an absent measurement must stay NULL. A fabricated 0 is
-- indistinguishable from a real 0, and `rate_limit_minute_remaining = 0` means
-- "quota exhausted" while NULL means "the provider did not tell us".

ALTER TABLE public.provider_usage_logs
  ADD COLUMN IF NOT EXISTS http_status                  integer,
  ADD COLUMN IF NOT EXISTS latency_ms                   integer,
  ADD COLUMN IF NOT EXISTS page                         integer,
  ADD COLUMN IF NOT EXISTS per_page                     integer,
  ADD COLUMN IF NOT EXISTS pagination_page              integer,
  ADD COLUMN IF NOT EXISTS pagination_total_pages       integer,
  ADD COLUMN IF NOT EXISTS pagination_total_entries     integer,
  ADD COLUMN IF NOT EXISTS rate_limit_minute            integer,
  ADD COLUMN IF NOT EXISTS rate_limit_minute_remaining  integer,
  ADD COLUMN IF NOT EXISTS rate_limit_hourly            integer,
  ADD COLUMN IF NOT EXISTS rate_limit_hourly_remaining  integer,
  ADD COLUMN IF NOT EXISTS rate_limit_24_hour           integer,
  ADD COLUMN IF NOT EXISTS rate_limit_24_hour_remaining integer,
  ADD COLUMN IF NOT EXISTS retry_after_seconds          integer,
  ADD COLUMN IF NOT EXISTS billing_state                text,
  ADD COLUMN IF NOT EXISTS estimated_credits            numeric(12, 4),
  ADD COLUMN IF NOT EXISTS recorded_usage_credits       numeric(12, 4),
  ADD COLUMN IF NOT EXISTS confirmed_provider_credits   numeric(12, 4);

COMMENT ON COLUMN public.provider_usage_logs.billing_state IS
  'charged | not_charged | unknown. NULL = not recorded. ''unknown'' is a real state and must never be collapsed to not_charged.';
COMMENT ON COLUMN public.provider_usage_logs.estimated_credits IS
  'Credits this call was expected to cost, from the shared pricing table. NULL when unknown — never a fabricated 0.';
COMMENT ON COLUMN public.provider_usage_logs.recorded_usage_credits IS
  'Credits this call recorded internally. Distinct from confirmed_provider_credits: an internal record is not a settled charge.';
COMMENT ON COLUMN public.provider_usage_logs.confirmed_provider_credits IS
  'Credits confirmed by reliable EXTERNAL provider evidence (invoice/export). Stays NULL — unknown — until such evidence exists. Never derived from internal logs.';

-- `billing_state` is intentionally left without a CHECK constraint: adding one
-- would have to be validated against every historical row, and a future provider
-- vocabulary change would then require another migration on a hot ledger table.
-- The application validates the value (isProviderBillingState) and treats any
-- unrecognised value as 'unknown'.

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- Partial indexes: they cover only rows that actually carry the identifier, so
-- they stay empty until the writer flag is enabled and cost nothing meanwhile.

CREATE INDEX IF NOT EXISTS provider_usage_logs_reservation_id_idx
  ON public.provider_usage_logs (reservation_id)
  WHERE reservation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS provider_usage_logs_client_request_id_idx
  ON public.provider_usage_logs (client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS provider_usage_logs_idempotency_key_idx
  ON public.provider_usage_logs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- The reconciliation read is "every billable operation for this run", so the
-- composite mirrors that access path exactly.
CREATE INDEX IF NOT EXISTS provider_usage_logs_batch_operation_idx
  ON public.provider_usage_logs (batch_id, operation_key)
  WHERE batch_id IS NOT NULL;

-- =============================================================================
-- ROLLBACK (not executed — kept as documentation)
--
-- Safe while ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS is off, because nothing
-- reads these columns then; the same data remains in `metadata`.
--
--   DROP INDEX IF EXISTS public.provider_usage_logs_batch_operation_idx;
--   DROP INDEX IF EXISTS public.provider_usage_logs_idempotency_key_idx;
--   DROP INDEX IF EXISTS public.provider_usage_logs_client_request_id_idx;
--   DROP INDEX IF EXISTS public.provider_usage_logs_reservation_id_idx;
--
--   ALTER TABLE public.provider_usage_logs
--     DROP COLUMN IF EXISTS confirmed_provider_credits,
--     DROP COLUMN IF EXISTS recorded_usage_credits,
--     DROP COLUMN IF EXISTS estimated_credits,
--     DROP COLUMN IF EXISTS billing_state,
--     DROP COLUMN IF EXISTS retry_after_seconds,
--     DROP COLUMN IF EXISTS rate_limit_24_hour_remaining,
--     DROP COLUMN IF EXISTS rate_limit_24_hour,
--     DROP COLUMN IF EXISTS rate_limit_hourly_remaining,
--     DROP COLUMN IF EXISTS rate_limit_hourly,
--     DROP COLUMN IF EXISTS rate_limit_minute_remaining,
--     DROP COLUMN IF EXISTS rate_limit_minute,
--     DROP COLUMN IF EXISTS pagination_total_entries,
--     DROP COLUMN IF EXISTS pagination_total_pages,
--     DROP COLUMN IF EXISTS pagination_page,
--     DROP COLUMN IF EXISTS per_page,
--     DROP COLUMN IF EXISTS page,
--     DROP COLUMN IF EXISTS latency_ms,
--     DROP COLUMN IF EXISTS http_status,
--     DROP COLUMN IF EXISTS idempotency_key,
--     DROP COLUMN IF EXISTS request_fingerprint,
--     DROP COLUMN IF EXISTS wizard_run_id,
--     DROP COLUMN IF EXISTS client_request_id,
--     DROP COLUMN IF EXISTS reservation_id;
-- =============================================================================
