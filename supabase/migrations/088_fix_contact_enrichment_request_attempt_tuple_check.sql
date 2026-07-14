-- Migration 088 — Fix contact_enrichment_runs request/attempt tuple CHECK
-- Hito 17B.4X.7C.1F — Tuple CHECK Forward Migration and Physical Proof Closure
-- Aditivo: no modifica migración 086, no reescribe datos existentes.
--
-- ROOT CAUSE (proven physically in 17B.4X.7C.1E.5, run 29339070116, I1):
-- migration 086's tuple-coherence CHECK constraint
-- (contact_enrichment_runs_request_attempt_tuple_check) uses
-- `attempt_order IN (1, 2)` and `intended_provider IN ('apollo', 'lusha')`
-- inside its request-linked branch without explicit IS NOT NULL guards.
-- In PostgreSQL, `NULL IN (...)` evaluates to UNKNOWN, not FALSE, and a
-- CHECK constraint accepts a row whenever its expression evaluates to
-- TRUE or UNKNOWN. So a row with request_id set but attempt_order NULL
-- and intended_provider NULL evaluates the request-linked branch to
-- UNKNOWN instead of FALSE, and the constraint incorrectly permits it.
--
-- FIX: add explicit `attempt_order IS NOT NULL` and
-- `intended_provider IS NOT NULL` to the request-linked branch so it can
-- only ever evaluate to TRUE or FALSE, never UNKNOWN.
--
-- Applied via add-new / drop-old / rename-back so the table is never left
-- without this CHECK constraint at any point.

-- ── Step 1: add the corrected constraint under a temporary name ────────
ALTER TABLE public.contact_enrichment_runs
  ADD CONSTRAINT contact_enrichment_runs_request_attempt_tuple_check_v2
  CHECK (
    (
      request_id IS NULL
      AND attempt_order IS NULL
      AND intended_provider IS NULL
    )
    OR
    (
      request_id IS NOT NULL
      AND attempt_order IS NOT NULL
      AND attempt_order IN (1, 2)
      AND intended_provider IS NOT NULL
      AND intended_provider IN ('apollo', 'lusha')
      AND bulk_run_id IS NULL
    )
  );

-- ── Step 2: drop the old (UNKNOWN-permissive) constraint ────────────────
ALTER TABLE public.contact_enrichment_runs
  DROP CONSTRAINT contact_enrichment_runs_request_attempt_tuple_check;

-- ── Step 3: rename the corrected constraint back to the original name ──
ALTER TABLE public.contact_enrichment_runs
  RENAME CONSTRAINT contact_enrichment_runs_request_attempt_tuple_check_v2
  TO contact_enrichment_runs_request_attempt_tuple_check;
