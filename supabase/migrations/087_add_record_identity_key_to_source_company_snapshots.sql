-- Migration 087: Add record_identity_key shadow column to source_company_snapshots
-- Purpose: additive schema expand step (DB-A) for the generic record identity line.
-- This column is NOT populated, NOT enforced as unique, and NOT required yet.
-- No writer is required to send it. No reader depends on it. Purely additive.

ALTER TABLE public.source_company_snapshots
  ADD COLUMN record_identity_key text NULL;

ALTER TABLE public.source_company_snapshots
  ADD CONSTRAINT source_company_snapshots_record_identity_key_nonempty_chk
  CHECK (
    record_identity_key IS NULL
    OR length(btrim(record_identity_key)) > 0
  ) NOT VALID;
