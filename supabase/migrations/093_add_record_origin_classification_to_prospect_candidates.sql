-- Migration 093: Add record origin classification columns to prospect_candidates
-- Q3F-5AY.3 — Additive migration draft for Agent 1 candidate classification.
--
-- Purpose: additive schema expand step for the normalized classification of
-- prospect candidates. These columns let the Agent 1 effectiveness read model
-- separate real production prospects from qa / smoke / cleanup / import /
-- synthetic noise, and record why a candidate was rejected, using the stable
-- vocabulary produced by the pure classifier in
-- src/modules/agent1-effectiveness/classification.ts (Q3F-5AY.2,
-- deriveRecordOriginClassification).
--
-- These columns are not populated by a backfill in this migration. Existing
-- rows stay null until a later, separate, explicitly authorized phase decides
-- on backfill + constraint revalidation + indexing.
--
-- Safety guarantees (this hito):
--   * additive only — no data mutation, no cleanup, no backfill
--   * columns stay nullable (no not-null, no uniqueness, no index)
--   * check constraints are marked not valid (not checked against legacy rows)
--   * accounts, prospect_batches and provider_usage_logs are untouched
--   * follows the same safety pattern as migration 092

ALTER TABLE public.prospect_candidates
  ADD COLUMN IF NOT EXISTS record_origin text;

ALTER TABLE public.prospect_candidates
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.prospect_candidates
  ADD COLUMN IF NOT EXISTS classification_source text;

ALTER TABLE public.prospect_candidates
  ADD COLUMN IF NOT EXISTS classification_confidence smallint;

ALTER TABLE public.prospect_candidates
  ADD CONSTRAINT prospect_candidates_record_origin_check
  CHECK (
    record_origin IS NULL
    OR record_origin IN (
      'production',
      'smoke_test',
      'qa',
      'historical_cleanup',
      'import',
      'unknown',
      'synthetic'
    )
  ) NOT VALID;

ALTER TABLE public.prospect_candidates
  ADD CONSTRAINT prospect_candidates_rejection_reason_check
  CHECK (
    rejection_reason IS NULL
    OR rejection_reason IN (
      'test_record',
      'cleanup_record',
      'duplicate',
      'unknown',
      'outside_icp',
      'existing_account',
      'insufficient_data',
      'invalid_company',
      'provider_noise',
      'marketplace_or_directory',
      'geographic_mismatch',
      'industry_mismatch',
      'do_not_use',
      'no_longer_relevant',
      'other'
    )
  ) NOT VALID;

ALTER TABLE public.prospect_candidates
  ADD CONSTRAINT prospect_candidates_classification_source_check
  CHECK (
    classification_source IS NULL
    OR classification_source IN (
      'writer',
      'derived_metadata',
      'derived_source_primary',
      'derived_review_notes',
      'derived_batch',
      'manual',
      'derived_status',
      'unknown'
    )
  ) NOT VALID;

ALTER TABLE public.prospect_candidates
  ADD CONSTRAINT prospect_candidates_classification_confidence_check
  CHECK (
    classification_confidence IS NULL
    OR (classification_confidence >= 0 AND classification_confidence <= 100)
  ) NOT VALID;

COMMENT ON COLUMN public.prospect_candidates.record_origin IS
  'Q3F-5AY.3 — normalized provenance of the candidate (production vs smoke_test / qa / historical_cleanup / import / synthetic / unknown). Nullable; populated by a later authorized phase. See src/modules/agent1-effectiveness/classification.ts.';

COMMENT ON COLUMN public.prospect_candidates.rejection_reason IS
  'Q3F-5AY.3 — normalized rejection-reason vocabulary for rejected candidates. Nullable; populated by a later authorized phase.';

COMMENT ON COLUMN public.prospect_candidates.classification_source IS
  'Q3F-5AY.3 — which signal produced the classification (writer / derived_* / manual / unknown). Nullable; populated by a later authorized phase.';

COMMENT ON COLUMN public.prospect_candidates.classification_confidence IS
  'Q3F-5AY.3 — optional 0-100 confidence for the derived classification. Nullable.';
