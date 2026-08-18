-- Migration 120: PROVIDER-NATIVE, ACCOUNT-INDEPENDENT phone suppression
-- (Agente 2A · AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4, Phase 1)
--
-- APPLIED IN PRODUCTION: NO
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS
-- ═══════════════════════════════════════════════════════════════════
--
-- Until this migration the ONLY durable record of a phone suppression lived in
-- `phone_reveal_cache` as a tombstone keyed
--
--     (provider = 'apollo', provider_person_id, account_id)
--
-- That key was never designed as a privacy key. It is the CACHE REUSE key: the
-- account is in it because a phone paid for by one account must not be served to
-- another, and the provider is pinned to `apollo` by a CHECK because the cache only
-- ever held Apollo reveals. Privacy inherited that shape by accident of history, and
-- inherited three consequences that are wrong on their own terms:
--
--   1. NO ACCOUNT ⇒ NO PRIVACY EVALUATION. A candidate discovered before anyone
--      created a SellUp account has no `account_id`, so no tombstone key exists, so
--      since PR #289 the reveal is blocked fail-closed and — per PR #291 — the button
--      is honestly disabled. That is safe, but it makes the entire pre-approval
--      product unreachable: 12 of the 30 candidates currently in `pending_review`
--      have no account.
--
--   2. A LUSHA REVEAL REQUIRED AN APOLLO IDENTITY. The `CHECK (provider = 'apollo')`
--      means a Lusha-sourced candidate can never carry a matchable key, so every one
--      of them is permanently non-evaluable. The suppression of a Lusha subject was
--      not merely unsupported: it was unrepresentable.
--
--   3. SUPPRESSION DIED WITH THE ACCOUNT. `phone_reveal_cache.account_id` and
--      `phone_reveal_suppression_audit.account_id` are both
--      `REFERENCES accounts(id) ON DELETE CASCADE`. Deleting an account therefore
--      ERASED the erasure — tombstone and audit trail together — and a later reveal of
--      the same person would have found nothing blocking it. A DSAR that a deletion
--      can undo is not a DSAR.
--
-- This migration separates the two concerns that were fused. `phone_reveal_cache`
-- stays exactly what it is — an account-scoped reuse cache. Privacy moves to
-- `provider_suppressions`, keyed by PROVIDER-NATIVE identity only.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION IS NOT
-- ═══════════════════════════════════════════════════════════════════
--
-- It is NOT a global cross-provider privacy subject. An Apollo suppression blocks
-- Apollo; a Lusha suppression blocks Lusha. Nothing here infers that Apollo person X
-- and Lusha contact Y are the same human from a shared LinkedIn URL, email or name —
-- that inference (`privacy_subjects` + alias table + hashed LinkedIn) is Phase 2 and
-- is deliberately absent. Claiming otherwise would be the worst possible error in a
-- privacy table: a guarantee the schema cannot keep.
--
-- It is ADDITIVE. No legacy column is dropped, no legacy row is deleted, and the
-- legacy tombstone remains readable and remains honored. Two independent checks that
-- both block is the intended end state of Phase 1, not a transitional accident.
--
-- ═══════════════════════════════════════════════════════════════════
-- SAFETY
-- ═══════════════════════════════════════════════════════════════════
--
-- Idempotent: every object uses IF NOT EXISTS / CREATE OR REPLACE, every GRANT block
-- is declarative (REVOKE ALL then enumerate), and the legacy backfill is
-- `ON CONFLICT DO NOTHING` with the audit row derived from the INSERT's own
-- RETURNING, so a second application inserts zero suppressions and zero audit rows.
--
-- Writes no phone number anywhere. Reads no phone number anywhere.

-- ═══════════════════════════════════════════════════════════════════
-- 1. provider_suppressions — the durable, account-independent record
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.provider_suppressions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Both providers that can return a phone today. The vocabulary is CLOSED: a third
  -- provider must arrive with its own migration and its own identity validator, not by
  -- someone writing a new string into an open text column.
  provider            text        NOT NULL
    CONSTRAINT provider_suppressions_provider_check
    CHECK (provider IN ('apollo', 'lusha')),

  -- The provider's OWN identifier for the person, stored verbatim as the provider
  -- issued it: a 24-hex Apollo person id, or a Lusha contact id (`v1.*`). It is NOT
  -- normalized across providers and NOT translated between them — the pair
  -- (provider, provider_person_id) is the whole identity, and it only means anything
  -- inside that provider's namespace.
  provider_person_id  text        NOT NULL
    CONSTRAINT provider_suppressions_person_id_check
    CHECK (btrim(provider_person_id) <> ''),

  suppressed_at       timestamptz NOT NULL,

  -- Same CLOSED vocabulary as `phone_reveal_cache.suppression_reason` (migration 099).
  -- Reused rather than re-invented so the legacy backfill below is a straight copy and
  -- so one operator-facing reason list governs both models. Free text is prohibited for
  -- the original reason: it would accumulate the very PII this table exists to remove.
  suppression_reason  text        NOT NULL
    CONSTRAINT provider_suppressions_reason_check
    CHECK (
      suppression_reason IN (
        'dsar_erasure_request',
        'do_not_contact_request',
        'legal_privacy_request',
        'admin_privacy_correction',
        'test_synthetic'
      )
    ),

  -- Who ran the erasure. SET NULL and not CASCADE: an operator leaving the company
  -- must not delete the record of a data-subject right they exercised.
  suppressed_by       uuid        NULL
    REFERENCES public.internal_users(id) ON DELETE SET NULL,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ── THE key decision of this migration ─────────────────────────────
--
-- (provider, provider_person_id). NO account_id. There is deliberately no
-- `account_id` COLUMN at all, so there is no FK to `accounts`, no CASCADE path from
-- `accounts`, and no way for a future edit to quietly reintroduce account scoping into
-- the uniqueness. A suppression is a fact about a PERSON at a PROVIDER; it is not a
-- fact about a tenant, and it must outlive every tenant that ever touched it.
CREATE UNIQUE INDEX IF NOT EXISTS provider_suppressions_provider_person_key
  ON public.provider_suppressions (provider, provider_person_id);

-- Lookup index for the hot path: the four privacy gates ask exactly this question,
-- once per reveal attempt.
CREATE INDEX IF NOT EXISTS provider_suppressions_lookup_idx
  ON public.provider_suppressions (provider, provider_person_id, suppressed_at);

DROP TRIGGER IF EXISTS provider_suppressions_set_updated_at ON public.provider_suppressions;
CREATE TRIGGER provider_suppressions_set_updated_at
  BEFORE UPDATE ON public.provider_suppressions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE public.provider_suppressions IS
  'AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4 Phase 1 — durable, ACCOUNT-INDEPENDENT phone suppression keyed by provider-native identity (provider, provider_person_id). Has no account_id column by design: a suppression survives deletion of every account that ever saw the person. Apollo suppression blocks Apollo, Lusha suppression blocks Lusha; cross-provider identity (same human, two provider ids) is NOT modelled here and is NOT inferred from LinkedIn/email/name — that is Phase 2. Never contains a phone number. Service-role only.';

-- ═══════════════════════════════════════════════════════════════════
-- 2. provider_suppression_audit — durable evidence, also account-free
-- ═══════════════════════════════════════════════════════════════════
--
-- Separate from `phone_reveal_suppression_audit` rather than an extension of it,
-- because that table's `account_id` is `NOT NULL REFERENCES accounts ON DELETE
-- CASCADE`. Making it account-optional would not repair the existing rows and would
-- leave the cascade in place; a new table is the only way to state "this evidence has
-- no tenant and no cascade".
--
-- PII discipline, unchanged from the legacy audit: the person is recorded ONLY as a
-- SHA-256 hex hash of the provider id, so two events about the same subject can be
-- correlated without publishing the identifier, and never as a phone, email, name or
-- LinkedIn URL.

CREATE TABLE IF NOT EXISTS public.provider_suppression_audit (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  provider                 text        NOT NULL
    CONSTRAINT provider_suppression_audit_provider_check
    CHECK (provider IN ('apollo', 'lusha')),

  -- Opaque by construction. The raw provider id is NOT stored here even though it is
  -- stored in `provider_suppressions`: the suppression row is operational state the
  -- gates must match on, while the audit row is a permanent log, and a permanent log
  -- is where an identifier is hardest to ever remove again.
  provider_person_id_hash  text        NOT NULL
    CONSTRAINT provider_suppression_audit_hash_check
    CHECK (provider_person_id_hash ~ '^[0-9a-f]{64}$'),

  operation                text        NOT NULL
    CONSTRAINT provider_suppression_audit_operation_check
    CHECK (operation IN ('suppression_created', 'suppression_reaffirmed')),

  result                   text        NOT NULL
    CONSTRAINT provider_suppression_audit_result_check
    CHECK (result IN ('applied', 'already_present', 'failed')),

  reason_code              text        NOT NULL
    CONSTRAINT provider_suppression_audit_reason_check
    CHECK (
      reason_code IN (
        'dsar_erasure_request',
        'do_not_contact_request',
        'legal_privacy_request',
        'admin_privacy_correction',
        'test_synthetic'
      )
    ),

  -- Where the row came from. `legacy_backfill` marks the rows this migration itself
  -- derived from `phone_reveal_cache`, so a later reader can tell a copied historical
  -- tombstone apart from an erasure a human actually ran.
  origin                   text        NOT NULL
    CONSTRAINT provider_suppression_audit_origin_check
    CHECK (origin IN ('dsar_action', 'legacy_backfill')),

  actor_user_id            uuid        NULL
    REFERENCES public.internal_users(id) ON DELETE SET NULL,

  created_at               timestamptz NOT NULL DEFAULT now(),
  metadata                 jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS provider_suppression_audit_subject_idx
  ON public.provider_suppression_audit (provider, provider_person_id_hash, created_at DESC);

COMMENT ON TABLE public.provider_suppression_audit IS
  'AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4 Phase 1 — durable evidence for provider-native phone suppression. Has NO account_id and NO FK to accounts, so the evidence survives deletion of every account involved; the legacy audit table could not, because its own account_id cascades from accounts (see this migration's header for the exact table). The subject appears only as a SHA-256 hash; no phone, email, name or LinkedIn URL is ever stored. Append-and-read (no UPDATE, no DELETE granted). Service-role only.';

-- ═══════════════════════════════════════════════════════════════════
-- 3. RLS — service_role only, mirroring migration 099
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.provider_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_suppression_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'provider_suppressions'
      AND policyname = 'service_role_all_provider_suppressions'
  ) THEN
    CREATE POLICY "service_role_all_provider_suppressions"
      ON public.provider_suppressions FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'provider_suppression_audit'
      AND policyname = 'service_role_all_provider_suppression_audit'
  ) THEN
    CREATE POLICY "service_role_all_provider_suppression_audit"
      ON public.provider_suppression_audit FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 4. Table GRANTS — declarative end state, mirroring migration 107
-- ═══════════════════════════════════════════════════════════════════
--
-- RLS is not the layer that protects these tables from `service_role`: on Supabase
-- that role is BYPASSRLS. The table-level GRANT is. And because Supabase ships
-- `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated,
-- service_role`, both tables were BORN with all eight privileges for all three roles.
-- `GRANT` only ever adds, so the only way to reach a known end state is REVOKE ALL
-- first and then enumerate.
--
-- Asymmetry between the two tables is the content of this block, not an oversight:
--
--   * `provider_suppressions` needs INSERT (create the suppression) and UPDATE (an
--     upsert that re-affirms an existing suppression touches `suppressed_at` /
--     `suppression_reason`). It does NOT get DELETE: deleting the row would delete the
--     block, which is the one operation this subsystem must never be able to perform.
--   * `provider_suppression_audit` gets SELECT and INSERT only. A log its own writer
--     can rewrite or erase is not evidence.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'provider_suppressions' AND c.relkind = 'r'
  ) THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.provider_suppressions FROM PUBLIC';
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.provider_suppressions FROM anon';
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.provider_suppressions FROM authenticated';
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.provider_suppressions FROM service_role';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.provider_suppressions TO service_role';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'provider_suppression_audit' AND c.relkind = 'r'
  ) THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.provider_suppression_audit FROM PUBLIC';
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.provider_suppression_audit FROM anon';
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.provider_suppression_audit FROM authenticated';
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.provider_suppression_audit FROM service_role';
    EXECUTE 'GRANT SELECT, INSERT ON TABLE public.provider_suppression_audit TO service_role';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 5. provider_suppression_exists — the canonical SQL-side read
-- ═══════════════════════════════════════════════════════════════════
--
-- Takes NO account. That absence is the contract, and the ratchet suite asserts the
-- signature stays two-argument for exactly that reason: the moment an account
-- parameter appears, "no account" becomes "no privacy" again.

CREATE OR REPLACE FUNCTION public.provider_suppression_exists(
  p_provider           text,
  p_provider_person_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.provider_suppressions s
    WHERE s.provider           = p_provider
      AND s.provider_person_id = p_provider_person_id
  );
$fn$;

COMMENT ON FUNCTION public.provider_suppression_exists(text, text) IS
  'AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4 Phase 1 — true when a provider-native suppression exists for (provider, provider_person_id). Deliberately takes NO account_id: account scope was a cache-reuse concern that privacy inherited by accident, and requiring it is what made pre-approval candidates non-evaluable. Read-only. Service-role only.';

REVOKE ALL ON FUNCTION public.provider_suppression_exists(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_suppression_exists(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.provider_suppression_exists(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.provider_suppression_exists(text, text) TO postgres, service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 6. The TRANSACTIONAL re-check learns the new model
-- ═══════════════════════════════════════════════════════════════════
--
-- Migration 113 put a person-level suppression re-check INSIDE the persistence
-- transactions of 110/111 (`phone_reveal_person_suppression_exists`), which is the
-- guard the pre-call TypeScript check cannot provide: a suppression that commits
-- between the gate and the write is invisible to the gate but visible here, under the
-- candidate lock.
--
-- That helper is account-scoped and Apollo-only, so on its own it would ignore every
-- suppression this migration introduces. It is replaced by body only — SAME name, SAME
-- two-argument signature — so the call sites inside 110 and 111 do not move and those
-- ~1,800 lines of SQL are NOT restated. `CREATE OR REPLACE FUNCTION` keeps the
-- existing COMMENT and privileges; both are re-declared below so this migration's end
-- state is explicit rather than inherited.
--
-- The new body is a strict OR of two independent checks:
--
--   * the NEW provider-native record, evaluated WITHOUT the account. This is what makes
--     the transactional re-check work for a candidate that has no account at all —
--     including the pre-approval case this whole hito exists for;
--   * the LEGACY account-scoped tombstone, evaluated exactly as before and ONLY when an
--     account is supplied. Legacy `clear` can no longer override new `suppressed`, and
--     new `clear` can no longer override legacy `suppressed`.
--
-- `p_account_id` becomes OPTIONAL rather than required. Passing NULL used to make the
-- whole check unreachable (the callers in 110/111 skip the call when either input is
-- NULL); now a NULL account simply skips the legacy half.
--
-- SCOPE LIMIT, stated because it is real: the callers in 110/111 resolve
-- `v_person_id` with APOLLO rules, so this helper is only ever reached with an Apollo
-- identity. A Lusha-sourced candidate with no Apollo id still does not reach it, and
-- its Lusha-native transactional re-check is NOT provided by this migration — for that
-- path the authoritative re-check is the application-layer privacy gate, which does run
-- provider-natively immediately before the Lusha call and before persistence. Closing
-- that last gap requires restating 111, which is deliberately out of Phase 1 scope.

CREATE OR REPLACE FUNCTION public.phone_reveal_person_suppression_exists(
  p_provider_person_id text,
  p_account_id         uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT
    -- NEW model: provider-native, account-independent. Evaluated first and on its own
    -- merits; it does not consult `p_account_id` at all.
    public.provider_suppression_exists('apollo', p_provider_person_id)
    OR
    -- LEGACY model: preserved verbatim, and still authoritative where its key is
    -- evaluable. Skipped — never treated as a block — when no account is supplied.
    (
      p_account_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.phone_reveal_cache c
        WHERE c.provider           = 'apollo'
          AND c.provider_person_id = p_provider_person_id
          AND c.account_id         = p_account_id
          AND c.suppressed_at IS NOT NULL
      )
    );
$fn$;

COMMENT ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) IS
  'AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4 Phase 1 (was AGENT2A-PHONE-REVEAL-4O-E3) — true when a phone suppression exists for this person, checked as the OR of two independent models: the provider-native account-independent record in provider_suppressions (evaluated WITHOUT p_account_id), and the legacy account-scoped tombstone in phone_reveal_cache (evaluated only when p_account_id IS NOT NULL). p_account_id is now OPTIONAL: a NULL account skips the legacy half instead of disabling the whole check. Same name and signature as 113 so the call sites inside migrations 110/111 are untouched. Read-only; creates no suppression state. Service-role only.';

REVOKE ALL ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.phone_reveal_person_suppression_exists(text, uuid) TO postgres, service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 7. LEGACY TOMBSTONE BACKFILL — idempotent, additive, non-destructive
-- ═══════════════════════════════════════════════════════════════════
--
-- Production reports ZERO legacy tombstones today, and that fact is deliberately NOT
-- encoded as an assumption here: this block is written to be correct for any number of
-- them, because a migration whose safety depends on a count someone read once is a
-- migration that breaks the first time the count changes.
--
-- Semantics of the copy:
--
--   * the legacy provider is Apollo by CHECK, so every copied row is `provider =
--     'apollo'`;
--   * the legacy key carries an account and the new key does not, so N account-scoped
--     tombstones for the same person collapse into ONE provider-native suppression.
--     The EARLIEST `suppressed_at` wins — the right to erasure starts when it was first
--     exercised, not when it was last re-exercised — and `min` over the reason and
--     actor picks a deterministic representative of the same collapsed group rather
--     than an arbitrary one;
--   * a legacy row whose `suppression_reason` is somehow NULL cannot be represented
--     (the new column is NOT NULL against a closed vocabulary) so it is SKIPPED rather
--     than guessed at. Migration 099 already enforces
--     `suppressed_at IS NULL OR suppression_reason IS NOT NULL`, so this filter should
--     match nothing; it exists so that if it ever does match, the row is left visible
--     in the legacy table for a human instead of being silently invented here;
--   * NOTHING is deleted and no legacy column is dropped. The legacy tombstone stays
--     in place and stays honored (§6 above).
--
-- Idempotence has two halves and both matter. `ON CONFLICT DO NOTHING` makes the
-- suppression insert repeatable, and the audit insert reads from that statement's own
-- RETURNING — so a second application inserts 0 suppressions and therefore 0 audit
-- rows. An audit insert driven by a plain SELECT over the legacy table would duplicate
-- its rows on every re-run.

WITH legacy AS (
  SELECT
    c.provider_person_id,
    min(c.suppressed_at)      AS suppressed_at,
    min(c.suppression_reason) AS suppression_reason,
    min(c.suppressed_by::text)::uuid AS suppressed_by
  FROM public.phone_reveal_cache c
  WHERE c.provider = 'apollo'
    AND c.suppressed_at IS NOT NULL
    AND c.suppression_reason IS NOT NULL
    AND btrim(c.provider_person_id) <> ''
  GROUP BY c.provider_person_id
),
inserted AS (
  INSERT INTO public.provider_suppressions (
    provider, provider_person_id, suppressed_at, suppression_reason, suppressed_by
  )
  SELECT 'apollo', l.provider_person_id, l.suppressed_at, l.suppression_reason, l.suppressed_by
  FROM legacy l
  ON CONFLICT (provider, provider_person_id) DO NOTHING
  RETURNING provider, provider_person_id, suppression_reason, suppressed_by
)
INSERT INTO public.provider_suppression_audit (
  provider, provider_person_id_hash, operation, result, reason_code, origin, actor_user_id, metadata
)
SELECT
  i.provider,
  -- Built-in `sha256(bytea)` (PostgreSQL 11+), NOT pgcrypto's `digest()`: on Supabase
  -- pgcrypto is installed in the `extensions` schema, so an unqualified `digest()` here
  -- would resolve only by luck of `search_path`. The built-in is in `pg_catalog` and
  -- always resolves, and it produces the same hex digest the TypeScript writer uses.
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(i.provider_person_id, 'UTF8')), 'hex'),
  'suppression_created',
  'applied',
  i.suppression_reason,
  'legacy_backfill',
  i.suppressed_by,
  jsonb_build_object(
    'migration', '120_provider_native_phone_suppression',
    'copied_from', 'phone_reveal_cache',
    'account_scope_collapsed', true
  )
FROM inserted i;
