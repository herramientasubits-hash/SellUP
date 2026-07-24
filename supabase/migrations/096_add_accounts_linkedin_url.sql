-- Q3F-5BB.7E — Additive: corporate LinkedIn URL on accounts.
--
-- Adds a nullable `accounts.linkedin_url` so the corporate LinkedIn company URL
-- captured on a prospect candidate (Lusha / enrichment, surfaced by Q3F-5BB.7D)
-- can be transferred to the SellUp account when the candidate is approved and
-- converted. LinkedIn corporativo is company-level data that belongs on the
-- account, not only in generation metadata.
--
-- Additive and non-destructive by design:
--   * nullable (no NOT NULL) — existing rows keep NULL.
--   * IF NOT EXISTS — idempotent, safe to re-run.
--   * no backfill (no UPDATE / INSERT), no index, no constraint, no RLS change.
--   * only touches public.accounts.
--
-- NOTE (migration discipline): this file is repo-only. It is NOT applied via
-- `supabase db push` and NOT applied to production by the task that created it.
-- Apply the exact SQL below manually under a separate authorization. The
-- application code (candidate -> account conversion, account detail UI) is
-- backward-compatible if this column does not exist yet.

BEGIN;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS linkedin_url text;

COMMENT ON COLUMN public.accounts.linkedin_url IS
  'Corporate LinkedIn company URL associated with the account, usually sourced from prospect candidates or enrichment providers.';

COMMIT;
