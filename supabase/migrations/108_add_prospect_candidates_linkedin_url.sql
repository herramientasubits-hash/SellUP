-- A1-APOLLO-LINKEDIN-EMPLOYEES-1 — Additive: corporate LinkedIn URL on prospect candidates.
--
-- Apollo returns `linkedin_url` for essentially every organization it hands back
-- (20/20 in the 2026-08-05T22:19Z live run), but `prospect_candidates` had no
-- column for it: the only canonical company-LinkedIn column in the schema lives
-- on `public.accounts` (migration 096), which is only reachable AFTER a candidate
-- is approved and converted. This adds the same column, with the same name and
-- type, at the candidate stage — so the value is stored where it is captured and
-- the transfer to the account is a copy, not a re-derivation.
--
-- The employee count needs no DDL: `prospect_candidates.employee_count` already
-- exists (migration 045) and the writer now populates it. Its sibling column
-- `employee_count_status` is deliberately NOT reused for the completeness
-- contract: its CHECK only accepts the structured-source size classes
-- (confirmed_100_plus / unknown_requires_manual_validation / …), a different
-- semantic from confirmed/not_returned/invalid/mapping_failed. Those statuses
-- live in `metadata.company_employee_count`.
--
-- Additive and non-destructive by design:
--   * nullable (no NOT NULL) — existing rows keep NULL.
--   * IF NOT EXISTS — idempotent, safe to re-run.
--   * no backfill (no UPDATE / INSERT), no index, no constraint, no RLS change.
--   * only touches public.prospect_candidates.
--
-- NOTE (migration discipline): this file is repo-only. It is NOT applied via
-- `supabase db push` and NOT applied to production by the task that created it.
-- Apply the exact SQL below manually under a separate authorization. The writer
-- is backward-compatible if this column does not exist yet: the insert is retried
-- without `linkedin_url` (see `isMissingLinkedInUrlColumnError`) and the URL stays
-- available in `metadata.company_linkedin`, with the batch metadata recording
-- `linkedin_persistence_mode = 'metadata_only'` so the degradation is visible.

BEGIN;

ALTER TABLE public.prospect_candidates
  ADD COLUMN IF NOT EXISTS linkedin_url text;

COMMENT ON COLUMN public.prospect_candidates.linkedin_url IS
  'Corporate LinkedIn company URL for the candidate, canonicalized to https://www.linkedin.com/company/<slug>. Sourced from the discovery provider (Apollo organizations_search / organization_enrichment) or from the writer LinkedIn enrichment. Provenance and mapping status live in metadata.company_linkedin.';

COMMIT;
