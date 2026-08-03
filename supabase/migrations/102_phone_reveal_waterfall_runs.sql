-- Migration 102: Apollo → Lusha phone reveal waterfall runs
-- (Agente 2A · AGENT2A-PHONE-WATERFALL-1)
--
-- Creates `phone_reveal_waterfall_runs`: ONE row per authorized "Revelar
-- teléfono" click, so a single human authorization can span two provider legs
-- (Apollo first, Lusha only if Apollo returned `no_phone_found`) while keeping
-- per-provider traceability of what was attempted and what it cost.
--
-- Why a table and not candidate columns: the candidate row can only describe the
-- FINAL state (which provider revealed, what the phone is). It cannot answer
-- "was Lusha attempted or skipped, and why?", "how much did each leg cost?" or
-- "was this second call covered by the operator's authorization?" — and it
-- cannot serve as the atomic claim that guarantees Lusha runs AT MOST ONCE when
-- the webhook, the recovery cron and the manual L3 review all observe the same
-- Apollo `no_phone_found` outcome. Those are properties of the RUN, not of the
-- candidate, so they get their own row.
--
-- This migration is a LOCAL DRAFT ONLY. It has NOT been applied to any remote
-- Supabase project (local, preview or Production) as of
-- AGENT2A-PHONE-WATERFALL-1.
--
-- This migration does NOT:
--   * insert, update or delete any row (no backfill, no data migration)
--   * touch `contact_enrichment_candidates` (its phone_reveal_* vocabulary was
--     already widened by migrations 095 / 097 / 101 and is left untouched here)
--   * touch `phone_reveal_cache`, `phone_reveal_suppression_audit`,
--     `provider_usage_logs` or any other pre-existing table
--   * change RLS, policies or triggers of any pre-existing table
--   * drop a table, drop a column or add a trigger
--   * activate ENABLE_PHONE_REVEAL_WATERFALL (unset in every environment)
--   * reveal a phone, call Apollo/Lusha/HubSpot or spend credits
--   * contain any phone, email, name, linkedin or provider contact id
--
-- Safety: strictly additive. Every CHECK is created VALIDATED (no `NOT VALID`
-- anywhere), so no follow-up migration is needed to validate them. `NOT VALID` is
-- the convention of migrations 095/097/100/101 because those widen vocabularies on
-- tables that already hold historical rows, where scanning them is the expensive
-- part. This table is BRAND NEW and starts empty: validating on creation costs
-- nothing and, unlike a NOT VALID constraint, it is enforced for every future row
-- with no gap and no pending maintenance. A LATER vocabulary widening on this table
-- may still use NOT VALID — that trade-off returns once there are rows to scan.
-- Idempotent: CREATE TABLE / INDEX use IF NOT EXISTS and the policy is guarded
-- via pg_policies, so the migration can be re-run without error.
--
-- Privacy: the table is PII-free by construction. It holds SellUp's own row ids,
-- machine-code vocabularies, timestamps and credit counts. There is deliberately
-- NO column that could hold a phone number, an email, a name, a LinkedIn URL or
-- a provider-side contact id (Apollo person id / Lusha `v1.` contact id).

-- ── 1. Waterfall runs table ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.phone_reveal_waterfall_runs (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The candidate whose phone the operator authorized revealing. CASCADE: a
  -- deleted candidate has no run worth keeping (unlike a suppression tombstone,
  -- this row grants no privacy guarantee on its own).
  candidate_id             uuid        NOT NULL
    REFERENCES public.contact_enrichment_candidates(id) ON DELETE CASCADE,

  -- Lifecycle of the whole waterfall. See CHECK below for the vocabulary.
  status                   text        NOT NULL,

  -- The human authorization this run spends. `authorized_at` is the TTL anchor:
  -- the second (Lusha) leg is only allowed inside a 24h window, so an authorization
  -- can never be silently reused days later by a late webhook.
  authorized_at            timestamptz NOT NULL DEFAULT now(),
  -- internal_users.id of the operator. NOT a FK on purpose: the run is an audit
  -- record of an authorization and must survive user-row churn. Opaque id, no PII.
  authorized_by            uuid        NOT NULL,
  authorized_by_role       text        NULL,

  -- Ceiling the operator explicitly accepted: 13 when Lusha is a possible second
  -- leg (Apollo up to 8 + Lusha 5), 8 when it is not. Never a computed total of
  -- what was actually charged — that is derived from the two cost columns below.
  max_credits_authorized   integer     NOT NULL
    CONSTRAINT phone_reveal_waterfall_runs_max_credits_check
    CHECK (max_credits_authorized > 0),

  -- ── Apollo leg ──────────────────────────────────────────────────
  apollo_attempted_at      timestamptz NULL,
  apollo_outcome           text        NULL,
  -- Credits Apollo actually reported. NULL means "not reported", NEVER zero:
  -- an unreported cost must not be readable as a free call.
  apollo_cost_credits      numeric     NULL,
  apollo_cost_source       text        NULL,

  -- ── Lusha leg ───────────────────────────────────────────────────
  -- Whether the candidate could ever reach Lusha (own reusable Lusha contact id).
  lusha_eligible           boolean     NULL,
  -- Why Lusha was NOT attempted. Mutually exclusive with lusha_attempted_at in
  -- practice; not enforced by a CHECK so a diagnostic reason can still be
  -- recorded if a claim is taken and the leg is then abandoned.
  lusha_skipped_reason     text        NULL,
  -- Set by the ATOMIC CLAIM. Its transition from NULL to a timestamp is what
  -- makes the Lusha leg run at most once across webhook / cron / manual review.
  lusha_attempted_at       timestamptz NULL,
  lusha_outcome            text        NULL,
  lusha_cost_credits       numeric     NULL,
  lusha_cost_source        text        NULL,

  -- ── Resolution ──────────────────────────────────────────────────
  -- Which provider actually produced the phone: 'apollo', 'lusha', or 'none'
  -- when nobody did. Never set to a provider that only attempted.
  final_provider           text        NULL,
  completed_at             timestamptz NULL,
  -- Machine code only (closed set is enforced by the application, not here, so a
  -- new provider error code does not require a migration). Never free text from a
  -- provider body, never a driver message.
  error_code               text        NULL,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Closed vocabularies (all VALIDATED on creation) ─────────────
-- The seven CHECKs below are added WITHOUT `NOT VALID`, so `convalidated` is true
-- the moment this migration finishes and nothing else has to be run later.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_waterfall_runs_status_check'
  ) THEN
    ALTER TABLE public.phone_reveal_waterfall_runs
      ADD CONSTRAINT phone_reveal_waterfall_runs_status_check
      CHECK (
        status IN (
          -- Authorization recorded, Apollo not started yet.
          'authorized',
          -- Apollo async reveal in flight, waiting for webhook/recovery.
          'apollo_in_flight',
          -- Apollo produced the phone (fresh reveal or paid-cache reuse).
          'completed_apollo',
          -- Apollo returned no_phone_found; Lusha leg is allowed but not claimed.
          'lusha_pending',
          -- Lusha leg claimed and running (the claim itself sets this).
          'lusha_running',
          -- Lusha produced the phone.
          'completed_lusha',
          -- Both legs finished without a phone (or Lusha was never eligible).
          'exhausted',
          -- A technical failure closed the run (provider error, unverifiable
          -- suppression check, …). Never means "no phone exists".
          'error',
          -- The run was closed WITHOUT spending the second leg: expired
          -- authorization, suppression/DNC block, or an ineligible candidate.
          'aborted'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_waterfall_runs_apollo_outcome_check'
  ) THEN
    ALTER TABLE public.phone_reveal_waterfall_runs
      ADD CONSTRAINT phone_reveal_waterfall_runs_apollo_outcome_check
      CHECK (
        apollo_outcome IS NULL
        OR apollo_outcome IN (
          'revealed',
          'revealed_from_cache',
          'no_phone_found',
          'error',
          'blocked_suppressed',
          'do_not_contact',
          'suppression_check_unavailable',
          'cache_unavailable'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_waterfall_runs_lusha_outcome_check'
  ) THEN
    ALTER TABLE public.phone_reveal_waterfall_runs
      ADD CONSTRAINT phone_reveal_waterfall_runs_lusha_outcome_check
      CHECK (
        lusha_outcome IS NULL
        OR lusha_outcome IN (
          'revealed',
          'no_phone_found',
          'error'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_waterfall_runs_final_provider_check'
  ) THEN
    ALTER TABLE public.phone_reveal_waterfall_runs
      ADD CONSTRAINT phone_reveal_waterfall_runs_final_provider_check
      CHECK (
        final_provider IS NULL
        OR final_provider IN (
          'apollo',
          'lusha',
          'none'
        )
      );
  END IF;

  -- Same closed vocabulary as
  -- contact_enrichment_candidates.phone_reveal_cost_source (migration 101), and
  -- for the same reason: an unreported cost must be representable as `unknown`
  -- instead of being rounded down to 0.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_waterfall_runs_apollo_cost_source_check'
  ) THEN
    ALTER TABLE public.phone_reveal_waterfall_runs
      ADD CONSTRAINT phone_reveal_waterfall_runs_apollo_cost_source_check
      CHECK (
        apollo_cost_source IS NULL
        OR apollo_cost_source IN (
          'reported',
          'assumed_cap',
          'unknown'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_waterfall_runs_lusha_cost_source_check'
  ) THEN
    ALTER TABLE public.phone_reveal_waterfall_runs
      ADD CONSTRAINT phone_reveal_waterfall_runs_lusha_cost_source_check
      CHECK (
        lusha_cost_source IS NULL
        OR lusha_cost_source IN (
          'reported',
          'assumed_cap',
          'unknown'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_reveal_waterfall_runs_lusha_skipped_reason_check'
  ) THEN
    ALTER TABLE public.phone_reveal_waterfall_runs
      ADD CONSTRAINT phone_reveal_waterfall_runs_lusha_skipped_reason_check
      CHECK (
        lusha_skipped_reason IS NULL
        OR lusha_skipped_reason IN (
          -- The candidate has no reusable Lusha contact id of its own.
          'missing_lusha_contact_id',
          -- Apollo already produced the phone, so no second leg was needed.
          'apollo_revealed',
          -- A suppression tombstone blocked it. The check RAN and confirmed it.
          'suppressed',
          -- The check could NOT be completed, so whether the candidate is
          -- suppressed is UNKNOWN. Lusha was not called (fail-closed), but this is
          -- deliberately NOT recorded as 'suppressed': the platform must not assert
          -- a privacy verdict it never obtained.
          'suppression_check_unavailable',
          'dnc',
          'authorization_expired',
          'role_not_allowed',
          'feature_disabled',
          -- The claim found the leg already taken (webhook vs cron vs manual).
          'already_attempted',
          'not_needed',
          'provider_error'
        )
      );
  END IF;
END $$;

-- ── 3. Indexes ─────────────────────────────────────────────────────

-- AT MOST ONE ACTIVE RUN PER CANDIDATE. This is the structural guarantee that a
-- second "Revelar teléfono" click cannot open a parallel authorization while one
-- is still resolving. Terminal rows (completed_*/exhausted/error/aborted) are
-- excluded, so a candidate can accumulate a history of runs over time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_reveal_waterfall_runs_active_candidate
  ON public.phone_reveal_waterfall_runs (candidate_id)
  WHERE status IN ('authorized', 'apollo_in_flight', 'lusha_pending', 'lusha_running');

-- Newest-run-first lookup for the drawer's audit block and for resolving the run
-- that a terminal Apollo outcome belongs to.
CREATE INDEX IF NOT EXISTS idx_phone_reveal_waterfall_runs_candidate_authorized_at
  ON public.phone_reveal_waterfall_runs (candidate_id, authorized_at DESC);

-- ── 4. RLS: service_role only ──────────────────────────────────────
-- Same pattern as phone_reveal_cache / phone_reveal_suppression_audit
-- (migration 099): RLS on, ONE policy for service_role, and NO policy for
-- `authenticated` or `anon`. Every read and write goes through server-side code
-- holding the service-role key; the browser can never reach this table directly.

ALTER TABLE public.phone_reveal_waterfall_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'phone_reveal_waterfall_runs'
      AND policyname = 'service_role_all_phone_reveal_waterfall_runs'
  ) THEN
    CREATE POLICY "service_role_all_phone_reveal_waterfall_runs"
      ON public.phone_reveal_waterfall_runs FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 5. Comments ────────────────────────────────────────────────────

COMMENT ON TABLE public.phone_reveal_waterfall_runs IS
  'AGENT2A-PHONE-WATERFALL-1 — one row per authorized phone reveal that may span Apollo then Lusha. Groups both legs under a single human authorization, records per-provider attempt/outcome/cost separately (never a mixed total), and its lusha_attempted_at claim is what makes the Lusha leg run at most once across webhook / recovery cron / manual review. PII-free by construction: no phone, email, name, linkedin or provider contact id. Gated behind ENABLE_PHONE_REVEAL_WATERFALL (unset everywhere as of this migration).';

COMMENT ON COLUMN public.phone_reveal_waterfall_runs.max_credits_authorized IS
  'Ceiling the operator explicitly accepted: 13 when Lusha is a possible second leg (Apollo up to 8 + Lusha 5), 8 when the candidate has no reusable Lusha contact id. NOT a total of what was charged.';

COMMENT ON COLUMN public.phone_reveal_waterfall_runs.apollo_cost_credits IS
  'Credits Apollo reported for its leg. NULL = not reported, never 0 — an unreported cost must not read as a free call. The Lusha leg is recorded separately and the two are NEVER summed into one column.';

COMMENT ON COLUMN public.phone_reveal_waterfall_runs.lusha_skipped_reason IS
  'Why the Lusha leg was NOT attempted, directly queryable (never hidden inside error_code or metadata). ''suppressed'' means the suppression/DNC check RAN and confirmed a block; ''suppression_check_unavailable'' means the check could not be completed, so the suppression state is UNKNOWN — Lusha was not called (fail-closed) but no privacy verdict was obtained. The two are never collapsed.';

COMMENT ON COLUMN public.phone_reveal_waterfall_runs.lusha_attempted_at IS
  'Set by the atomic claim (UPDATE ... WHERE lusha_attempted_at IS NULL). A claim that updates 0 rows means another trigger already took the Lusha leg, so the caller must NOT call Lusha.';

COMMENT ON COLUMN public.phone_reveal_waterfall_runs.final_provider IS
  'Provider that actually produced the phone: apollo | lusha | none. A provider that only attempted is never recorded here.';
