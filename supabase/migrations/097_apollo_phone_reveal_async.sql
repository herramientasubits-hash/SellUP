-- Migration 097: Async Apollo phone reveal correlation fields
-- Agente 2A — APOLLO-PHONE-ASYNC-1. Prepare contact_enrichment_candidates to
-- track a FUTURE, explicitly authorized Apollo phone reveal that runs
-- ASYNCHRONOUSLY via webhook.
--
-- Context / why async (confirmed Apollo contract):
--   * people/match with the phone-reveal flag enabled REQUIRES a webhook_url;
--     without it Apollo returns HTTP 422.
--   * the immediate (synchronous) response does NOT carry the phone numbers;
--     it only carries a correlation id (request_id / async task id).
--   * the phone numbers arrive LATER on the webhook callback.
-- The previous synchronous model (read phone_numbers off the first response)
-- cannot work. This migration adds the columns needed to correlate the initial
-- request with the eventual webhook result and to reflect an in-flight state.
--
-- This migration does NOT reveal any phone, does NOT call Apollo/Lusha, does
-- NOT create a server action, does NOT touch UI, does NOT activate the flag
-- ENABLE_APOLLO_PHONE_REVEAL, does NOT spend credits and does NOT populate any
-- existing row (no backfill). Reveal execution stays gated behind the flag,
-- which is OFF in every environment.
--
-- Legal/product contract for the FUTURE reveal path (enforced by the server
-- action + webhook handler, NOT by this migration):
--   * reveal is individual per candidate — no bulk, no automatic reveal
--   * human cost confirmation mandatory (up to 8 Apollo credits per candidate)
--   * phone_processing_basis mandatory on the reveal path
--   * authorized roles: Administrador and Manager comercial
--   * no Lusha fallback, no auto-write to HubSpot, no phones in usage logs
--
-- Safety guarantees (this hito):
--   * additive only — no data mutation, no cleanup, no backfill
--   * new columns stay nullable (attempt_count defaults 0, harmless for legacy)
--   * the extended status check stays NOT VALID (legacy rows are not re-checked)
--   * the request_id uniqueness is a PARTIAL unique index (only non-null values)
--   * RLS / policies / triggers are untouched
--   * only contact_enrichment_candidates is touched
--   * follows the same safety pattern as migrations 092–096
--   * idempotent: columns use IF NOT EXISTS; the constraint swap and the index
--     are guarded so the migration can be re-run without error

-- ── 1. Async correlation columns (nullable, additive) ─────────────

ALTER TABLE public.contact_enrichment_candidates
  ADD COLUMN IF NOT EXISTS phone_reveal_request_id text;

ALTER TABLE public.contact_enrichment_candidates
  ADD COLUMN IF NOT EXISTS phone_reveal_requested_at timestamptz;

ALTER TABLE public.contact_enrichment_candidates
  ADD COLUMN IF NOT EXISTS phone_reveal_completed_at timestamptz;

ALTER TABLE public.contact_enrichment_candidates
  ADD COLUMN IF NOT EXISTS phone_reveal_webhook_received_at timestamptz;

ALTER TABLE public.contact_enrichment_candidates
  ADD COLUMN IF NOT EXISTS phone_reveal_attempt_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.contact_enrichment_candidates
  ADD COLUMN IF NOT EXISTS phone_reveal_last_checked_at timestamptz;

-- ── 2. Extend phone_reveal_status vocabulary (requested / pending) ─
-- Migration 095 created contact_enrichment_candidates_phone_reveal_status_check
-- with (not_requested / revealed / no_phone_found / error). The async flow adds
-- two in-flight states:
--   * requested — the reveal request was accepted by Apollo (we have a
--     request_id) and we are waiting for the webhook callback.
--   * pending   — reserved for a poll-in-progress marker (webhook not yet
--     received, a manual/scheduled poll is checking the result).
-- We drop the old constraint (if present) and re-add it with the extended
-- vocabulary, still NOT VALID so legacy rows are not re-checked.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_enrichment_candidates_phone_reveal_status_check'
  ) THEN
    ALTER TABLE public.contact_enrichment_candidates
      DROP CONSTRAINT contact_enrichment_candidates_phone_reveal_status_check;
  END IF;

  ALTER TABLE public.contact_enrichment_candidates
    ADD CONSTRAINT contact_enrichment_candidates_phone_reveal_status_check
    CHECK (
      phone_reveal_status IS NULL
      OR phone_reveal_status IN (
        'not_requested',
        'requested',
        'pending',
        'revealed',
        'no_phone_found',
        'error'
      )
    ) NOT VALID;
END $$;

-- ── 3. Partial unique index on request_id (correlation key) ────────
-- The webhook correlates its payload back to a single candidate by request_id
-- (Apollo does not document custom metadata pass-through). A partial unique
-- index guarantees a request_id maps to at most one candidate while leaving the
-- (overwhelmingly NULL) legacy rows unconstrained.

CREATE UNIQUE INDEX IF NOT EXISTS
  contact_enrichment_candidates_phone_reveal_request_id_key
  ON public.contact_enrichment_candidates (phone_reveal_request_id)
  WHERE phone_reveal_request_id IS NOT NULL;

-- ── 4. Column comments ─────────────────────────────────────────────

COMMENT ON COLUMN public.contact_enrichment_candidates.phone_reveal_request_id IS
  'APOLLO-PHONE-ASYNC-1 — Apollo async correlation id (request_id) returned by people/match reveal. Used by the webhook handler to find the candidate. Opaque id, not PII. NULL until a reveal is requested. Partial-unique.';

COMMENT ON COLUMN public.contact_enrichment_candidates.phone_reveal_requested_at IS
  'APOLLO-PHONE-ASYNC-1 — timestamp when the async reveal request was accepted by Apollo. NULL until requested.';

COMMENT ON COLUMN public.contact_enrichment_candidates.phone_reveal_completed_at IS
  'APOLLO-PHONE-ASYNC-1 — timestamp when the reveal reached a terminal state (revealed / no_phone_found / error). NULL while requested/pending.';

COMMENT ON COLUMN public.contact_enrichment_candidates.phone_reveal_webhook_received_at IS
  'APOLLO-PHONE-ASYNC-1 — timestamp when the Apollo webhook callback for this reveal was received. NULL if the result came from polling or has not arrived.';

COMMENT ON COLUMN public.contact_enrichment_candidates.phone_reveal_attempt_count IS
  'APOLLO-PHONE-ASYNC-1 — number of reveal requests started for this candidate. Defaults 0. There is no automatic retry; this counts explicit human requests.';

COMMENT ON COLUMN public.contact_enrichment_candidates.phone_reveal_last_checked_at IS
  'APOLLO-PHONE-ASYNC-1 — timestamp of the last poll for the reveal result (webhook fallback). NULL until a poll runs. No automatic polling job is enabled in this hito.';
