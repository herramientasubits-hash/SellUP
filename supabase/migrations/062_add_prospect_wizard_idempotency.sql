-- 062_add_prospect_wizard_idempotency.sql
-- Adds durable idempotency primitive for chat wizard executions.
-- A unique index on (created_by, client_request_id) prevents concurrent
-- requests from creating duplicate batches for the same wizard execution.
-- The reservation must happen BEFORE any provider call (Tavily, Apollo, etc.).
-- NO backfill, NO default, NO NOT NULL, NO RLS changes, NO data changes.

ALTER TABLE public.prospect_batches
  ADD COLUMN client_request_id UUID NULL;

-- Partial unique index: enforces idempotency only when client_request_id is set.
-- Not using CONCURRENTLY: standard runner executes migrations in a transaction.
CREATE UNIQUE INDEX idx_prospect_batches_created_by_client_request
  ON public.prospect_batches (created_by, client_request_id)
  WHERE client_request_id IS NOT NULL;
