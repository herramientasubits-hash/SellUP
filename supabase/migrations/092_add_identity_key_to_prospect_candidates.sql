-- Migration 092: Add identity_key shadow column to prospect_candidates
-- Q3F-5AW.2 — Agent 1 Identity & Concurrency Hardening Phase 1.
--
-- Purpose: additive schema expand step for the prospect-candidate identity line.
-- This column is NOT populated by a backfill, NOT enforced as UNIQUE, and NOT
-- required (nullable). New candidates written by the Agent 1 writer will start
-- populating it with a deterministic, normalized identity key; existing rows stay
-- NULL until a later, separate phase decides on backfill + uniqueness.
--
-- Safety guarantees (Phase 1):
--   * additive only — no data change, no cleanup, no backfill
--   * no UNIQUE index
--   * no NOT NULL
--   * CHECK is NOT VALID so it is not validated against existing rows
--   * accounts table is untouched

ALTER TABLE public.prospect_candidates
  ADD COLUMN IF NOT EXISTS identity_key text;

ALTER TABLE public.prospect_candidates
  ADD CONSTRAINT prospect_candidates_identity_key_non_empty
  CHECK (
    identity_key IS NULL
    OR length(btrim(identity_key)) > 0
  ) NOT VALID;
