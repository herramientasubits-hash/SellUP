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
  'AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4 Phase 1 — durable evidence for provider-native phone suppression. Has NO account_id and NO FK to accounts, so the evidence survives deletion of every account involved; the legacy audit table could not, because its own account_id cascades from accounts (see this migration''s header for the exact table). The subject appears only as a SHA-256 hash; no phone, email, name or LinkedIn URL is ever stored. Append-and-read (no UPDATE, no DELETE granted). Service-role only.';

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
-- two-argument signature — so the call sites inside 110 and 111 do not move.
-- `CREATE OR REPLACE FUNCTION` keeps the
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
-- SCOPE LIMIT OF THIS HELPER, stated because it is real: it takes an Apollo person id
-- and only ever answers about Apollo. It is NOT the whole transactional guard, and on
-- its own it never was: the callers in 110/111 used to resolve their key with APOLLO
-- rules, so a Lusha-sourced candidate with no Apollo id reached no check at all inside
-- the transaction that persists its phone. Section 8 below closes exactly that, by
-- restating 110 and 111 so both call the provider-native, candidate-scoped helper
-- defined there. This function survives because the LEGACY half lives in it and
-- because #289 depends on its name and signature.

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

-- ═══════════════════════════════════════════════════════════════════
-- 8. THE TRANSACTIONAL RE-CHECK BECOMES PROVIDER-NATIVE FOR BOTH PROVIDERS
--    (AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4-R1)
-- ═══════════════════════════════════════════════════════════════════
--
-- ── THE DEFECT THIS SECTION CLOSES ─────────────────────────────────
--
-- Sections 1–7 moved privacy to `provider_suppressions` in three of the four layers:
-- the application gate, the pre-persistence re-check, and — through the body of
-- `phone_reveal_person_suppression_exists` — the in-transaction re-check reached with an
-- APOLLO identity.
--
-- The fourth layer was still keyed the old way, and §6 said so. Inside 110 and 111 the
-- key was derived INLINE with Apollo rules and the guard was skipped unless BOTH a
-- person id and an account existed. For a Lusha-sourced candidate with no
-- `apollo_person_id`:
--
--     v_person_id IS NULL  ⇒  the IF is skipped  ⇒  NO suppression re-check runs
--                                                   inside the transaction that
--                                                   persists the phone.
--
-- So for Lusha the last word belonged to a read taken BEFORE the provider call and
-- OUTSIDE the candidate lock. The window between that read and the COMMIT contains the
-- entire provider round-trip, and a suppression committed anywhere in it was invisible:
-- the phone of an erased person was persisted anyway. A Lusha suppression was not
-- merely unmatched at that point — it was unreachable.
--
-- ── WHY 110/111 ARE RESTATED, AND WHY THAT WAS UNAVOIDABLE ─────────
--
-- §6 fixed what it COULD fix without restating them: it replaced the helper's body, so
-- every call site inherited the new model for free. That trick cannot reach this defect,
-- because the defect is not in the helper — it is in the CALL SITE. The condition
--
--     IF v_person_id IS NOT NULL AND v_account_id IS NOT NULL AND helper(...) THEN
--
-- short-circuits before the helper is ever entered, and the derivation of `v_person_id`
-- is Apollo-only. Neither lives in a function that could be redefined on its own: both
-- are statements inside the bodies of 110 and 111, and PostgreSQL has no way to amend
-- part of a function body. `CREATE OR REPLACE FUNCTION` with the full body is the only
-- instrument available, so the two functions are restated below.
--
-- The restatement is MECHANICAL and was generated from migration 113's definitions, not
-- retyped. Exactly two edits per function:
--
--   1. the Apollo-only derivation of `v_person_id` / `v_account_id` and the three-part
--      IF condition are replaced by ONE call to
--      `phone_reveal_candidate_suppression_exists`;
--   2. the two DECLARE lines for the variables that derivation used are removed, because
--      nothing else in either body referenced them.
--
-- Everything else is byte-identical to 113: same signatures, so no caller changes and
-- PostgREST gains no ambiguous overload; the SAME response envelopes, key for key,
-- including the `status = 'suppressed'` verdict both functions already returned; the
-- same locking, the same staleness checks, the same number-level tombstone re-check in
-- Step 3, the same primary election, the same scalar write, the same terminalization
-- rules. NO candidate-phone merge or persistence semantics change here.
--
-- What does NOT move, deliberately: the terminal policy (`error` + `blocked_suppressed`),
-- the run abort and the reservation settlement stay in the TypeScript layer where 4O-E1
-- put them. This section still withholds the NUMBER and never the COST — no usage log,
-- reservation or waterfall row is written from inside these functions, so a charge the
-- provider already incurred survives the privacy verdict exactly as recorded.
--
-- ── WHAT IS STILL NOT TRUE AFTER THIS SECTION ──────────────────────
--
-- This is NOT cross-provider suppression. An Apollo suppression blocks Apollo; a Lusha
-- suppression blocks Lusha. Nothing here infers that Apollo person X and Lusha contact Y
-- are the same human — not from a LinkedIn URL, an email, a name, a company or a domain.
-- That inference is Phase 2 and remains absent.

-- ── 8.1 The canonical candidate-scoped, provider-native read ───────
--
-- ONE function owns the whole derivation, so 110 and 111 do not each carry their own copy
-- of the trust decision — which is how they came to disagree with the application gate in
-- the first place.
--
-- TRUST BOUNDARY, audited explicitly because it is the sharp edge here:
--
--   * `p_candidate_id` is the candidate the caller has ALREADY locked `FOR UPDATE`. Every
--     authoritative identity is read from THAT ROW and from its run, inside this
--     transaction. A caller cannot substitute an identity, omit one, or point the check at
--     a different person: it does not supply them.
--   * `p_payload_provider_person_id` is the ONLY caller-supplied input, and it exists
--     because the Apollo webhook/recovery payload can carry a person id the row does not
--     have yet — information the database genuinely cannot derive. It is therefore
--     ADDITIVE ONLY: it can add one more identity to check, and it is validated by the
--     same 24-hex Apollo validator as every other Apollo id. A wrong or forged value can
--     only cause an EXTRA lookup against the suppression table — never suppress one. Pass
--     it as NULL and every row-derived check still runs unchanged. That asymmetry is the
--     point: caller input can tighten this predicate and cannot loosen it.
--
-- IDENTITY RULES — the SAME precedence, term for term, as
-- `resolvePhoneRevealProviderIdentity` / `resolveAllPhoneRevealProviderIdentities` in
-- `provider-suppression-core.ts`, so the SQL guard and the application gate cannot drift:
--
--   1. the payload id, normalized as Apollo         ⇒ apollo
--   2. `candidates.apollo_person_id`, normalized    ⇒ apollo
--   3. `source = 'apollo'` + `source_contact_id` normalized ⇒ apollo
--   4. `source = 'lusha'`  + non-blank `source_contact_id`  ⇒ lusha
--
-- Both identities a single candidate row carries are checked, not just the one Apollo
-- precedence would elect. That mirrors the WRITE path, which already suppresses every
-- identity a candidate declares: reading only the winner could miss a suppression the
-- writer created. It is not inference — the two ids are columns of the SAME row, which
-- represents ONE person, and no other row is consulted.
--
-- The Lusha id is used verbatim apart from trimming whitespace. It is deliberately NOT
-- validated against a shape: the provider owns the form of its own identifier, and a
-- regex invented here could only REJECT legitimate identities and hand the case back to
-- the fail-closed hole this hito exists to close.
--
-- A read that CANNOT be performed must never read as "clear": there is no EXCEPTION
-- handler anywhere below, so a missing table, a revoked privilege or any other failure
-- propagates and aborts the transaction — which persists nothing. A candidate row that
-- does not exist raises for the same reason, rather than returning false; the callers
-- have already loaded and locked it, so its absence would mean the world changed
-- underneath in a way this function must not paper over.

CREATE OR REPLACE FUNCTION public.phone_reveal_candidate_suppression_exists(
  p_candidate_id               uuid,
  -- Apollo-shaped person id the provider payload just asserted, or NULL. Additive only.
  p_payload_provider_person_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_found             boolean;
  v_source            text;
  v_source_contact_id text;
  v_apollo_column     text;
  v_account_id        uuid;
  v_apollo_id         text;
  v_lusha_id          text;
BEGIN
  SELECT true, c.source, c.source_contact_id, c.apollo_person_id, r.account_id
    INTO v_found, v_source, v_source_contact_id, v_apollo_column, v_account_id
  FROM public.contact_enrichment_candidates c
  -- LEFT JOIN and not an inner one: a run with NO account is the pre-approval case this
  -- whole hito exists to reach. A missing account must leave `v_account_id` NULL — which
  -- only skips the LEGACY half — and must never remove the candidate from the result.
  LEFT JOIN public.contact_enrichment_runs r ON r.id = c.enrichment_run_id
  WHERE c.id = p_candidate_id;

  IF v_found IS NOT TRUE THEN
    RAISE EXCEPTION
      'phone_reveal_candidate_suppression_exists: candidate % not found; refusing to report a suppression verdict for a row that cannot be read',
      p_candidate_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ── Identidad de APOLLO, con la precedencia histórica intacta ────
  v_apollo_id := COALESCE(
    public.phone_reveal_normalized_apollo_person_id(p_payload_provider_person_id),
    public.phone_reveal_normalized_apollo_person_id(v_apollo_column),
    CASE WHEN lower(btrim(COALESCE(v_source, ''))) = 'apollo'
      THEN public.phone_reveal_normalized_apollo_person_id(v_source_contact_id)
    END
  );

  -- ── Identidad de LUSHA, en SU espacio de nombres ─────────────────
  IF lower(btrim(COALESCE(v_source, ''))) = 'lusha'
     AND btrim(COALESCE(v_source_contact_id, '')) <> '' THEN
    v_lusha_id := btrim(v_source_contact_id);
  END IF;

  -- Apollo: modelo nuevo (sin cuenta) O tombstone legado (con su cuenta). Delegado al
  -- helper de §6 para que la compatibilidad legada siga viviendo en UN solo sitio.
  IF v_apollo_id IS NOT NULL
     AND public.phone_reveal_person_suppression_exists(v_apollo_id, v_account_id) THEN
    RETURN true;
  END IF;

  -- Lusha: sólo modelo nuevo. No existe tombstone legado de Lusha que consultar — la
  -- caché lo prohíbe por CHECK — y NO se inventa uno traduciendo el id a Apollo.
  IF v_lusha_id IS NOT NULL
     AND public.provider_suppression_exists('lusha', v_lusha_id) THEN
    RETURN true;
  END IF;

  RETURN false;
END
$fn$;

COMMENT ON FUNCTION public.phone_reveal_candidate_suppression_exists(uuid, text) IS
  'AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4-R1 — canonical in-transaction phone-suppression verdict for a candidate, evaluated PROVIDER-NATIVELY for both Apollo and Lusha. Derives every authoritative identity from the candidate row and its run inside the calling transaction (the caller has it locked FOR UPDATE), so no caller can substitute or omit an identity; the only caller-supplied argument is an Apollo-shaped payload id that is ADDITIVE and cannot loosen the result. Same identity precedence as resolvePhoneRevealProviderIdentity in provider-suppression-core.ts. Requires NO account: a run without one simply skips the legacy account-scoped half. NOT cross-provider — an Apollo id is never evaluated in Lusha''s namespace or the reverse, and no phone, email, name, LinkedIn URL or domain is matched. Raises rather than returning false when the candidate cannot be read, so a failed read is never mistaken for "not suppressed". Read-only. Service-role only.';

REVOKE ALL ON FUNCTION public.phone_reveal_candidate_suppression_exists(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phone_reveal_candidate_suppression_exists(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.phone_reveal_candidate_suppression_exists(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.phone_reveal_candidate_suppression_exists(uuid, text) TO postgres, service_role;

-- ── 8.2 Restatement of migrations 110 and 111 ──────────────────────
--
-- Generated from 113's definitions. The ONLY semantic change is Step 2b, marked in each
-- body. Signatures, response envelopes and every other statement are unchanged.
CREATE OR REPLACE FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  -- ── Identity of the operation ────────────────────────────────────
  p_candidate_id                     uuid,
  -- Apollo async id this callback claims to be for. Compared, under the lock, against
  -- `contact_enrichment_candidates.phone_reveal_request_id` — the very column the webhook
  -- looked the candidate up by — so a callback for a SUPERSEDED reveal cannot land on a
  -- candidate that has since started a new one. NULL from the recovery poll, whose id
  -- lives in `provider_usage_logs.metadata.apollo_trace`, not on the candidate row: there
  -- the in-flight status check below is the whole guard, which is the same condition the
  -- poll already required before spending the call.
  p_expected_request_id              text,
  p_reveal_phase                     text,          -- 'webhook' | 'recovery_poll'
  p_observed_at                      timestamptz,

  -- ── The collection (validated recordsets, never arbitrary columns) ──
  p_phones                           jsonb,
  p_sources                          jsonb,
  -- Primary candidates IN ORDER OF PREFERENCE, each carrying the terminal triple the pure
  -- layer computed FOR THAT KEY (`resolvePrimaryPhoneForCandidate`). Pairing the key with
  -- its own scalar is what makes divergence between the collection's primary and the
  -- candidate's scalar structurally impossible: whichever key this function elects, it
  -- writes THAT key's number, never another's.
  p_primary_candidates               jsonb,

  -- ── Legacy fallback: what the pre-4O-C path would have written ───
  p_legacy_phone                     text,
  p_legacy_phone_type                text,
  p_legacy_raw_type                  text,
  -- The dedupe key OF that fallback number. Needed because the fallback is only safe
  -- to write if the number behind it is not itself a tombstone: without this key the
  -- function cannot tell, and the one path that reaches the fallback — no eligible
  -- primary — is exactly the path where a suppressed number would slip back into the
  -- visible field. See step 3.
  p_legacy_dedupe_key                text,

  -- ── Terminal `revealed` state (one typed parameter per column) ───
  p_phone_reveal_status              text,
  p_phone_reveal_provider            text,
  p_phone_revealed_at                timestamptz,
  p_phone_reveal_completed_at        timestamptz,
  -- Written by the webhook only; NULL leaves the column untouched (the recovery poll never
  -- received a callback, and claiming it did would be a lie about how the phone arrived).
  p_phone_reveal_webhook_received_at timestamptz,
  -- Written by the recovery poll only; NULL leaves the column untouched.
  p_phone_reveal_last_checked_at     timestamptz,
  -- ALWAYS written, and NULL is a VALUE here, not an absence: Apollo frequently reports no
  -- credit figure, and `phone_reveal_cost_source` is what distinguishes "not reported" from
  -- "nobody has looked".
  p_phone_reveal_cost_credits        integer,
  p_phone_reveal_cost_source         text,          -- 'reported' | 'unknown'
  -- ALWAYS written. On this path it is NULL by definition; the function refuses anything
  -- else rather than letting an error code ride along with a success.
  p_phone_reveal_error_code          text,
  -- Recovery preserves the existing basis; NULL leaves the column untouched.
  p_phone_processing_basis           text,
  -- Only ever SET, never cleared: NULL leaves the column untouched, exactly as the
  -- `if (patch.apollo_person_id)` guard in both callers does today.
  p_apollo_person_id                 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  -- Type priority, IDENTICAL to CANDIDATE_PHONE_TYPE_RANKING in phone-collection-core.ts.
  -- If these two lists diverged, a refreshed row would end up with a different aggregated
  -- type than the pure layer computed for the same observations.
  c_type_ranking      text[] := ARRAY[
    'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
  ];
  -- Same closed set as TERMINAL_STATUSES in phone-reveal-webhook-core.ts.
  c_terminal_statuses text[] := ARRAY['revealed', 'no_phone_found', 'error'];

  v_candidate         record;
  v_row               record;
  v_src               record;
  v_pref              record;

  v_incoming_count    integer := 0;
  v_distinct_count    integer := 0;
  v_suppressed_count  integer := 0;
  v_viable_preference integer := 0;
  v_legacy_suppressed boolean := false;
  -- R1: la identidad y la cuenta ya NO se derivan aquí. Las resuelve, desde la fila
  -- del candidato y dentro de esta misma transacción,
  -- `phone_reveal_candidate_suppression_exists` (Step 2b).
  v_existing_live     integer := 0;
  v_inserted_count    integer := 0;
  v_updated_count     integer := 0;
  v_source_count      integer := 0;
  v_affected          integer := 0;

  v_phone_id          uuid;
  v_primary_key       text := NULL;
  v_primary_id        uuid := NULL;
  v_scalar            text := NULL;
  v_meta_type         text := NULL;
  v_meta_raw_type     text := NULL;
  v_phone_meta        jsonb;
BEGIN
  -- ═══════════════════════════════════════════════════════════════
  -- Step 0 — shape validation. Fail-closed, and BEFORE any write.
  -- ═══════════════════════════════════════════════════════════════
  -- Every rejection below returns with zero rows touched. Validating after the first insert
  -- would mean relying on the rollback for something a check can prevent outright.

  IF p_candidate_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'candidate_id_missing');
  END IF;

  IF p_reveal_phase IS NULL OR p_reveal_phase NOT IN ('webhook', 'recovery_poll') THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'reveal_phase_unknown');
  END IF;

  IF p_observed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'observed_at_missing');
  END IF;

  -- This function is the `revealed` path and nothing else (see SCOPE above).
  IF p_phone_reveal_status IS DISTINCT FROM 'revealed' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'status_not_revealed');
  END IF;

  IF p_phone_reveal_error_code IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'error_code_not_null');
  END IF;

  IF p_phone_reveal_provider IS DISTINCT FROM 'apollo' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'provider_not_apollo');
  END IF;

  IF p_phone_reveal_cost_source IS NULL
     OR p_phone_reveal_cost_source NOT IN ('reported', 'unknown') THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'cost_source_unknown');
  END IF;

  IF p_phone_revealed_at IS NULL OR p_phone_reveal_completed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'terminal_timestamps_missing');
  END IF;

  -- Exactly one of the two phase-specific timestamps, matching the two callers: the webhook
  -- stamps `webhook_received_at`, the poll stamps `last_checked_at`. Both, or neither, would
  -- describe an operation that did not happen.
  IF (p_phone_reveal_webhook_received_at IS NOT NULL)
     = (p_phone_reveal_last_checked_at IS NOT NULL) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phase_timestamps_inconsistent');
  END IF;

  IF p_legacy_phone IS NULL OR LENGTH(BTRIM(p_legacy_phone)) = 0 THEN
    -- The legacy scalar is the floor: this path exists because Apollo delivered a phone.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'legacy_phone_missing');
  END IF;

  IF p_legacy_dedupe_key IS NULL OR LENGTH(BTRIM(p_legacy_dedupe_key)) = 0 THEN
    -- Without it the tombstone check on the fallback (step 3) cannot run, and a missing
    -- privacy check must never be silently skipped.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'legacy_dedupe_key_missing');
  END IF;

  IF p_phones IS NULL
     OR jsonb_typeof(p_phones) <> 'array'
     OR jsonb_array_length(p_phones) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phones_empty');
  END IF;

  IF p_sources IS NULL OR jsonb_typeof(p_sources) <> 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'sources_invalid');
  END IF;

  IF p_primary_candidates IS NULL OR jsonb_typeof(p_primary_candidates) <> 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'primary_candidates_invalid');
  END IF;

  -- Every element of the three arrays must be an OBJECT. `jsonb_to_recordset` raises on a
  -- scalar element, and a raise here would report as an infrastructure failure rather than
  -- as the malformed input it is.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_phones) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_sources) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_primary_candidates) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'collection_element_not_object');
  END IF;

  -- ── Per-row validation of the canonical collection ──────────────
  -- The vocabularies are re-checked here even though migration 109 has CHECK constraints
  -- for both: hitting the constraint would raise and roll back, which is correct but
  -- reports as an infrastructure failure. A caller sending a bad status deserves
  -- `invalid_input`, not a rollback that looks like the database broke.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_phones) AS x(
      dedupe_key       text,
      normalized_phone text,
      display_phone    text,
      phone_type       text,
      phone_status     text,
      first_seen_at    timestamptz,
      last_seen_at     timestamptz
    )
    WHERE x.dedupe_key IS NULL
       OR LENGTH(BTRIM(x.dedupe_key)) = 0
       OR x.phone_status IS NULL
       OR x.phone_status NOT IN ('valid', 'invalid', 'unknown')
       OR (x.phone_type IS NOT NULL AND NOT (x.phone_type = ANY (c_type_ranking)))
       OR x.first_seen_at IS NULL
       OR x.last_seen_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phone_row_invalid');
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT x.dedupe_key)
    INTO v_incoming_count, v_distinct_count
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text);

  IF v_incoming_count <> v_distinct_count THEN
    -- `mergeCandidatePhoneInputs` already collapses one key into one row. Two rows sharing a
    -- key would mean the pure layer and this function disagree about what a phone IS.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phone_key_duplicated');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_sources) AS s(
      dedupe_key       text,
      provider         text,
      acquisition_mode text,
      source_event_key text,
      observed_at      timestamptz
    )
    WHERE s.dedupe_key IS NULL
       OR LENGTH(BTRIM(s.dedupe_key)) = 0
       OR s.provider IS NULL
       OR s.provider NOT IN ('apollo', 'lusha', 'apollo_cache', 'manual', 'unknown')
       OR s.acquisition_mode IS NULL
       OR s.acquisition_mode NOT IN ('search', 'reveal', 'waterfall', 'cache', 'manual')
       OR s.source_event_key IS NULL
       OR LENGTH(BTRIM(s.source_event_key)) = 0
       OR s.observed_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'source_row_invalid');
  END IF;

  -- Every provenance row must belong to a phone in THIS payload. A source pointing at a key
  -- that is not being written is provenance for nothing.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_sources) AS s(dedupe_key text)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
      WHERE x.dedupe_key = s.dedupe_key
    )
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'source_key_orphan');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_primary_candidates) AS e(item)
    CROSS JOIN LATERAL jsonb_to_record(e.item) AS r(
      dedupe_key text, phone text, phone_type text, raw_type text
    )
    WHERE r.dedupe_key IS NULL
       OR LENGTH(BTRIM(r.dedupe_key)) = 0
       OR r.phone IS NULL
       OR LENGTH(BTRIM(r.phone)) = 0
       OR r.phone_type IS NULL
       OR NOT (r.phone_type = ANY (c_type_ranking))
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'primary_candidate_invalid');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 1 — LOCK the candidate.
  -- ═══════════════════════════════════════════════════════════════
  -- This is the serialization point for the whole subsystem. The webhook and the recovery
  -- poll can genuinely race — a callback arriving while the cron is polling the same
  -- candidate — and without this lock both would read "in flight", both would elect a
  -- primary, and the loser would either duplicate provenance or fight the single-primary
  -- index. Every check that follows is deliberately AFTER it, so nothing is decided on a
  -- snapshot that a concurrent transaction can invalidate.

  SELECT c.id,
         c.enrichment_metadata,
         c.phone_reveal_status,
         c.phone_reveal_request_id,
         -- AGENT2A-PHONE-REVEAL-4O-E3 — columnas con las que se resuelve la clave de la
         -- supresión POR PERSONA sin salir de la transacción ni del lock.
         c.enrichment_run_id,
         c.apollo_person_id,
         c.source,
         c.source_contact_id
    INTO v_candidate
  FROM public.contact_enrichment_candidates c
  WHERE c.id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'candidate_not_eligible', 'detail', 'candidate_not_found');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 2 — is this event still the one that owns the candidate?
  -- ═══════════════════════════════════════════════════════════════

  IF v_candidate.phone_reveal_status = ANY (c_terminal_statuses) THEN
    IF p_expected_request_id IS NOT NULL
       AND v_candidate.phone_reveal_status = 'revealed'
       AND v_candidate.phone_reveal_request_id IS NOT DISTINCT FROM p_expected_request_id THEN
      -- The SAME event already committed — a concurrent caller won the lock and did exactly
      -- this work. Rewriting it would be pointless; reporting failure would be false. The
      -- honest answer is that the desired state is already in place.
      RETURN jsonb_build_object(
        'status',                   'idempotent',
        'inserted_phone_count',     0,
        'updated_phone_count',      0,
        'inserted_source_count',    0,
        'suppressed_skipped_count', 0,
        'primary_dedupe_key',       NULL,
        'primary_set',              EXISTS (
          SELECT 1 FROM public.contact_enrichment_candidate_phones p
          WHERE p.candidate_id = p_candidate_id AND p.is_primary
        ),
        'candidate_terminalized',   true
      );
    END IF;
    -- A DIFFERENT terminal state, or a terminal state this event cannot claim. Writing over
    -- it would overwrite a conclusion somebody else reached.
    RETURN jsonb_build_object('status', 'stale_event', 'detail', 'candidate_already_terminal');
  END IF;

  IF p_expected_request_id IS NOT NULL
     AND v_candidate.phone_reveal_request_id IS DISTINCT FROM p_expected_request_id THEN
    -- The candidate has moved on to another reveal request. This callback is late mail for
    -- an address that no longer exists.
    RETURN jsonb_build_object('status', 'stale_event', 'detail', 'request_id_superseded');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 2b — PROVIDER-NATIVE suppression, re-checked UNDER the lock.
  -- (4O-E3, re-keyed by AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4-R1)
  -- ═══════════════════════════════════════════════════════════════
  -- Step 3 re-checks the tombstones of the NUMBERS this event carries, and on its own
  -- that is not enough. A DSAR erases a PERSON: what it tombstoned are the numbers the
  -- collection ALREADY held. A number this provider had never returned before has no
  -- tombstone to match, so the number-level check waves it through — and the person
  -- whose data was erased ends up with a live phone again, minutes after the erasure.
  --
  -- The application-layer gate reads exactly this state, but it reads it BEFORE the
  -- provider call and OUTSIDE this lock, so a suppression that commits in between is
  -- invisible to it. Reading it HERE puts the check inside the very transaction that
  -- would otherwise persist the result:
  --
  --   * erasure commits first  ⇒ this read sees the suppression ⇒ nothing is written;
  --   * this transaction first ⇒ the erasure that follows takes this same candidate
  --     lock and tombstones what was written (migration 112).
  --
  -- Both orderings end suppressed, which is the property the pre-call gate alone could
  -- not provide.
  --
  -- WHAT R1 CHANGED, and why this block is the whole reason 110/111 are restated here:
  -- until R1 the key was resolved INLINE with APOLLO rules —
  -- `phone_reveal_normalized_apollo_person_id` over the payload, the candidate column
  -- and (only for an Apollo-sourced candidate) `source_contact_id` — and the check was
  -- skipped outright unless BOTH a person id and an account existed. For a Lusha-sourced
  -- candidate with no Apollo id that resolved to NULL, so the guard was skipped and this
  -- transaction performed NO suppression re-check at all: for Lusha the last word
  -- belonged to a read taken before the provider call and outside this lock. A Lusha
  -- suppression was not merely unmatched here, it was unreachable.
  --
  -- The derivation now lives in ONE place —
  -- `phone_reveal_candidate_suppression_exists` — so the two functions do not each
  -- carry their own copy of the trust decision, and so the identity comes from the
  -- CANDIDATE ROW inside this transaction rather than from anything a caller says.
  -- Apollo behavior is preserved exactly (native record OR legacy account-scoped
  -- tombstone); the account is no longer REQUIRED, so a candidate with no account is
  -- evaluated instead of waved through.
  --
  -- Still NO inference: no phone, email, name, LinkedIn URL or domain is matched, and
  -- an Apollo id is never evaluated in Lusha's namespace or the reverse.
  --
  -- The provider was already called and already charged by the time this runs. This step
  -- withholds the NUMBER, never the cost: no usage log, reservation or waterfall row is
  -- written from inside this function, so the spend survives exactly as it was recorded.

  IF public.phone_reveal_candidate_suppression_exists(p_candidate_id, p_apollo_person_id) THEN
    -- Fail closed with NOTHING written and WITHOUT terminalizing the candidate, exactly
    -- like the number-level verdict below. The terminal trace (`error` +
    -- `blocked_suppressed`), the run abort and the reservation settlement belong to the
    -- 4O-E1 policy in the TypeScript layer and are NOT duplicated in SQL.
    RETURN jsonb_build_object(
      'status',                   'suppressed',
      'inserted_phone_count',     0,
      'updated_phone_count',      0,
      'inserted_source_count',    0,
      'suppressed_skipped_count', 0,
      'primary_dedupe_key',       NULL,
      'primary_set',              false,
      'candidate_terminalized',   false
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 3 — tombstones, re-checked UNDER the lock.
  -- ═══════════════════════════════════════════════════════════════
  -- The TypeScript layer cannot own this check: it reads before the lock, and a suppression
  -- committed in that window would be invisible to it. Here the read is inside the
  -- serialized region, and the ON CONFLICT clauses below carry the same condition again so
  -- the guarantee survives even if this count were somehow wrong.

  SELECT COUNT(*) INTO v_suppressed_count
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
  JOIN public.contact_enrichment_candidate_phones e
    ON e.candidate_id = p_candidate_id
   AND e.dedupe_key = x.dedupe_key
  WHERE e.suppressed_at IS NOT NULL;

  -- ── Would the LEGACY FALLBACK resurrect a suppressed number? ────
  --
  -- The fallback is only reached when no preference key turns out to be electable. On that
  -- path the scalar becomes `p_legacy_phone` — and if the row behind THAT number is a
  -- tombstone, the suppressed number lands straight back in the visible field. Which is the
  -- precise failure the tombstone exists to prevent, arriving through the one door that
  -- does not consult it.
  --
  -- So both halves are computed BEFORE any write: whether the fallback number is suppressed,
  -- and whether any preference key survives to keep the fallback from being needed.
  SELECT EXISTS (
    SELECT 1 FROM public.contact_enrichment_candidate_phones e
    WHERE e.candidate_id = p_candidate_id
      AND e.dedupe_key = p_legacy_dedupe_key
      AND e.suppressed_at IS NOT NULL
  ) INTO v_legacy_suppressed;

  SELECT COUNT(*) INTO v_viable_preference
  FROM jsonb_array_elements(p_primary_candidates) AS e(item)
  CROSS JOIN LATERAL jsonb_to_record(e.item) AS r(
    dedupe_key text, phone text, phone_type text, raw_type text
  )
  WHERE NOT EXISTS (
    SELECT 1 FROM public.contact_enrichment_candidate_phones ex
    WHERE ex.candidate_id = p_candidate_id
      AND ex.dedupe_key = r.dedupe_key
      AND ex.suppressed_at IS NOT NULL
  );

  IF v_legacy_suppressed AND v_viable_preference = 0 THEN
    -- Nothing electable survives AND the fallback is a tombstone. Fail closed with nothing
    -- written and — the part that matters — WITHOUT terminalizing the candidate: a
    -- `revealed` row here would have to carry some number, and the only one left is one
    -- that was erased.
    --
    -- This subsumes the simpler "every number in the payload is a tombstone" case, since the
    -- legacy number is always one of the payload's numbers.
    --
    -- DECLARED LIMIT: a permanent tombstone makes this poll repeat and count as `failed` on
    -- every sweep, always at 0 credits, until an operator intervenes. That is chosen over
    -- putting an erased number back in front of a user.
    RETURN jsonb_build_object(
      'status',                   'suppressed',
      'inserted_phone_count',     0,
      'updated_phone_count',      0,
      'inserted_source_count',    0,
      'suppressed_skipped_count', v_suppressed_count,
      'primary_dedupe_key',       NULL,
      'primary_set',              false,
      'candidate_terminalized',   false
    );
  END IF;

  -- How many of the survivors already exist. Counted BEFORE the writes so that
  -- inserted/updated are facts rather than an interpretation of `xmax`.
  SELECT COUNT(*) INTO v_existing_live
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
  JOIN public.contact_enrichment_candidate_phones e
    ON e.candidate_id = p_candidate_id
   AND e.dedupe_key = x.dedupe_key
  WHERE e.suppressed_at IS NULL;

  v_updated_count := v_existing_live;
  v_inserted_count := v_incoming_count - v_suppressed_count - v_existing_live;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 4 — canonical phones: insert new, refresh known.
  -- ═══════════════════════════════════════════════════════════════
  -- `is_primary` is false for every write here and elected in step 6. Promoting during the
  -- insert would collide with the single-primary partial index while the previous primary
  -- is still standing.

  FOR v_row IN
    SELECT x.dedupe_key,
           x.normalized_phone,
           x.display_phone,
           x.phone_type,
           x.phone_status,
           x.first_seen_at,
           x.last_seen_at
    FROM jsonb_to_recordset(p_phones) AS x(
      dedupe_key       text,
      normalized_phone text,
      display_phone    text,
      phone_type       text,
      phone_status     text,
      first_seen_at    timestamptz,
      last_seen_at     timestamptz
    )
  LOOP
    -- Reset per iteration: `RETURNING … INTO` on a row the tombstone guard skipped must
    -- leave NULL here, not the id of the previous phone.
    v_phone_id := NULL;

    INSERT INTO public.contact_enrichment_candidate_phones AS t (
      candidate_id, normalized_phone, display_phone, dedupe_key,
      phone_type, phone_status, is_primary, first_seen_at, last_seen_at
    ) VALUES (
      p_candidate_id, v_row.normalized_phone, v_row.display_phone, v_row.dedupe_key,
      v_row.phone_type, v_row.phone_status, false, v_row.first_seen_at, v_row.last_seen_at
    )
    ON CONFLICT (candidate_id, dedupe_key) DO UPDATE
      SET
        -- `aggregateCandidatePhoneStatus`, mirrored: a provider that fails to verify a
        -- number is reporting its own coverage, so `invalid` never demotes a `valid`.
        phone_status = CASE
          WHEN 'valid' IN (t.phone_status, excluded.phone_status) THEN 'valid'
          WHEN t.phone_status = 'invalid'
               AND excluded.phone_status IN ('invalid', 'unknown') THEN 'invalid'
          WHEN excluded.phone_status = 'invalid'
               AND t.phone_status IN ('invalid', 'unknown') THEN 'invalid'
          ELSE 'unknown'
        END,
        -- `aggregateCandidatePhoneType`, mirrored: the better-ranked of the two wins, and
        -- every raw type stays intact in the provenance rows regardless.
        phone_type = CASE
          WHEN t.phone_type IS NULL THEN COALESCE(excluded.phone_type, 'unknown')
          WHEN COALESCE(array_position(c_type_ranking, t.phone_type),
                        array_length(c_type_ranking, 1) + 1)
               <= COALESCE(array_position(c_type_ranking,
                                          COALESCE(excluded.phone_type, 'unknown')),
                           array_length(c_type_ranking, 1) + 1)
            THEN t.phone_type
          ELSE COALESCE(excluded.phone_type, 'unknown')
        END,
        -- `first_seen_at` is deliberately untouched: it is the first time the number was
        -- seen, and seeing it again does not change that.
        last_seen_at = p_observed_at
      -- The tombstone guard, restated where it is enforced rather than merely intended.
      -- Without it a tombstoned row would be handed back its number and its type by this
      -- very UPDATE, and migration 109's `..._tombstone_is_empty` CHECK would then reject
      -- the statement — turning a privacy rule into a rollback. Skipping the row keeps the
      -- rule as a rule.
      WHERE t.suppressed_at IS NULL
    RETURNING t.id INTO v_phone_id;

    -- A tombstoned row returns nothing: no provenance, no primary, no trace of the
    -- observation. Recording that a suppressed person was seen again is still recording it.
    IF v_phone_id IS NULL THEN
      CONTINUE;
    END IF;

    -- ═════════════════════════════════════════════════════════════
    -- Step 5 — provenance: append-only and idempotent.
    -- ═════════════════════════════════════════════════════════════
    -- ON CONFLICT DO NOTHING on (candidate_phone_id, source_event_key). Reprocessing the
    -- same callback recognises the same observation instead of appending a second row, and
    -- no UPDATE is needed — which matters, because migration 109 does not grant one.

    FOR v_src IN
      SELECT s.provider,
             s.acquisition_mode,
             s.raw_provider_type,
             s.raw_provider_status,
             s.waterfall_run_id,
             s.reservation_id,
             s.provider_usage_log_id,
             s.source_event_key,
             s.observed_at
      FROM jsonb_to_recordset(p_sources) AS s(
        dedupe_key            text,
        provider              text,
        acquisition_mode      text,
        raw_provider_type     text,
        raw_provider_status   text,
        waterfall_run_id      uuid,
        reservation_id        uuid,
        provider_usage_log_id uuid,
        source_event_key      text,
        observed_at           timestamptz
      )
      WHERE s.dedupe_key = v_row.dedupe_key
    LOOP
      INSERT INTO public.contact_enrichment_candidate_phone_sources (
        candidate_phone_id, provider, acquisition_mode, raw_provider_type,
        raw_provider_status, waterfall_run_id, reservation_id, provider_usage_log_id,
        source_event_key, observed_at
      ) VALUES (
        v_phone_id, v_src.provider, v_src.acquisition_mode, v_src.raw_provider_type,
        v_src.raw_provider_status, v_src.waterfall_run_id, v_src.reservation_id,
        v_src.provider_usage_log_id, v_src.source_event_key, v_src.observed_at
      )
      ON CONFLICT (candidate_phone_id, source_event_key) DO NOTHING;

      GET DIAGNOSTICS v_affected = ROW_COUNT;
      v_source_count := v_source_count + v_affected;
    END LOOP;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 6 — elect exactly one primary.
  -- ═══════════════════════════════════════════════════════════════
  -- The ORDER is the pure layer's decision (`buildPrimaryPreference`, whose first entry is
  -- the number the pre-4O-C path would have written, so the visible phone does not change
  -- for reasons nobody asked for). What this function decides is only ELIGIBILITY, and it
  -- decides it from the rows as they now stand: alive, numbered, not asserted invalid —
  -- the three conditions of migration 109's `..._primary_requires_live_number` CHECK, so a
  -- key this loop accepts can never be one the database would then reject.

  FOR v_pref IN
    SELECT r.dedupe_key, r.phone, r.phone_type, r.raw_type
    FROM jsonb_array_elements(p_primary_candidates) WITH ORDINALITY AS e(item, ord)
    CROSS JOIN LATERAL jsonb_to_record(e.item) AS r(
      dedupe_key text, phone text, phone_type text, raw_type text
    )
    ORDER BY e.ord
  LOOP
    SELECT p.id INTO v_primary_id
    FROM public.contact_enrichment_candidate_phones p
    WHERE p.candidate_id = p_candidate_id
      AND p.dedupe_key = v_pref.dedupe_key
      AND p.suppressed_at IS NULL
      AND p.normalized_phone IS NOT NULL
      AND p.phone_status <> 'invalid';

    IF v_primary_id IS NOT NULL THEN
      v_primary_key   := v_pref.dedupe_key;
      -- The scalar and its metadata come from the SAME entry as the elected key. This is
      -- the whole reason the triple travels with the key.
      v_scalar        := v_pref.phone;
      v_meta_type     := v_pref.phone_type;
      v_meta_raw_type := v_pref.raw_type;
      EXIT;
    END IF;
  END LOOP;

  IF v_primary_id IS NOT NULL THEN
    -- Demote first, promote second. The partial unique index does not tolerate two
    -- primaries even for an instant, and doing it in this order needs no window.
    UPDATE public.contact_enrichment_candidate_phones
       SET is_primary = false
     WHERE candidate_id = p_candidate_id
       AND is_primary
       AND id <> v_primary_id;

    UPDATE public.contact_enrichment_candidate_phones
       SET is_primary = true
     WHERE id = v_primary_id
       AND NOT is_primary;
  ELSE
    -- No preference from THIS event qualifies. The primary that was already there is left
    -- alone: nothing better turned up, and clearing it would leave the candidate with no
    -- primary without anyone having asked for that. The scalar then keeps the legacy
    -- behaviour, byte-for-byte what the caller wrote before 4O-C.
    SELECT p.dedupe_key INTO v_primary_key
    FROM public.contact_enrichment_candidate_phones p
    WHERE p.candidate_id = p_candidate_id AND p.is_primary;

    v_scalar        := p_legacy_phone;
    v_meta_type     := p_legacy_phone_type;
    v_meta_raw_type := p_legacy_raw_type;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 7 — the candidate: scalar phone plus terminal state.
  -- ═══════════════════════════════════════════════════════════════
  -- Same transaction as everything above, so the forbidden state — a visible phone with an
  -- incomplete collection — cannot be observed even for the duration of a query.

  v_phone_meta := jsonb_build_object(
    'number',   v_scalar,
    'type',     v_meta_type,
    'source',   'apollo_reveal',
    'raw_type', v_meta_raw_type
  );

  UPDATE public.contact_enrichment_candidates
     SET phone = v_scalar,
         -- Shallow merge of the single `phone` key, exactly as the callers'
         -- `{...candidate.enrichmentMetadata, phone: phoneMetadata}` does — except read
         -- from the LOCKED row, so a concurrent metadata write cannot be clobbered by a
         -- stale copy.
         enrichment_metadata = jsonb_set(
           COALESCE(enrichment_metadata, '{}'::jsonb), '{phone}', v_phone_meta, true
         ),
         phone_reveal_status              = p_phone_reveal_status,
         phone_reveal_provider            = p_phone_reveal_provider,
         phone_revealed_at                = p_phone_revealed_at,
         phone_reveal_completed_at        = p_phone_reveal_completed_at,
         -- COALESCE, not assignment: a NULL here means "this phase does not write this
         -- column", and overwriting it would erase the other phase's evidence.
         phone_reveal_webhook_received_at =
           COALESCE(p_phone_reveal_webhook_received_at, phone_reveal_webhook_received_at),
         phone_reveal_last_checked_at     =
           COALESCE(p_phone_reveal_last_checked_at, phone_reveal_last_checked_at),
         phone_reveal_cost_credits        = p_phone_reveal_cost_credits,
         phone_reveal_cost_source         = p_phone_reveal_cost_source,
         phone_reveal_error_code          = p_phone_reveal_error_code,
         phone_processing_basis           =
           COALESCE(p_phone_processing_basis, phone_processing_basis),
         apollo_person_id                 =
           COALESCE(p_apollo_person_id, apollo_person_id)
   WHERE id = p_candidate_id;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    -- Unreachable while the row is locked; raised rather than reported because it would
    -- mean the lock did not hold, and continuing would leave a collection with no terminal
    -- state. The message names the operation, never a value.
    RAISE EXCEPTION 'persist_candidate_apollo_phone_reveal_result: candidate terminal update did not affect exactly one row';
  END IF;

  RETURN jsonb_build_object(
    'status',                   'persisted',
    'inserted_phone_count',     v_inserted_count,
    'updated_phone_count',      v_updated_count,
    'inserted_source_count',    v_source_count,
    'suppressed_skipped_count', v_suppressed_count,
    'primary_dedupe_key',       v_primary_key,
    'primary_set',              v_primary_id IS NOT NULL,
    'candidate_terminalized',   true
  );
END $$;

CREATE OR REPLACE FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  -- ── Identity of the operation ────────────────────────────────────
  p_candidate_id                  uuid,
  -- The `phone_reveal_status` the caller observed when it loaded the candidate and
  -- decided this leg was authorized. Compared, under the lock, against the live row.
  -- See "THE OWNERSHIP TOKEN IS THE STATUS" above.
  p_expected_phone_reveal_status  text,
  p_observed_at                   timestamptz,

  -- ── The collection (validated recordsets, never arbitrary columns) ──
  p_phones                        jsonb,
  p_sources                       jsonb,
  -- Primary candidates IN ORDER OF PREFERENCE, each carrying the terminal triple the
  -- pure layer computed FOR THAT KEY. Pairing the key with its own scalar is what makes
  -- divergence between the collection's primary and the candidate's scalar structurally
  -- impossible: whichever key this function elects, it writes THAT key's number.
  p_primary_candidates            jsonb,

  -- ── Legacy fallback: what the pre-4O-D path would have written ───
  p_legacy_phone                  text,
  p_legacy_phone_type             text,
  p_legacy_raw_type               text,
  -- The dedupe key OF that fallback number. Needed because the fallback is only safe to
  -- write if the number behind it is not itself a tombstone.
  p_legacy_dedupe_key             text,

  -- ── Terminal `revealed` state (one typed parameter per column) ───
  p_phone_reveal_status           text,          -- must be 'revealed'
  p_phone_reveal_provider         text,          -- must be 'lusha'
  -- ALWAYS written, and NULL is a VALUE here, not an absence: Lusha issues no tracking
  -- id, and writing the NULL is what CLEARS a previous provider's orphan id instead of
  -- leaving it next to `phone_reveal_provider = 'lusha'`.
  p_phone_reveal_request_id       text,
  p_phone_revealed_at             timestamptz,
  p_phone_reveal_completed_at     timestamptz,
  p_phone_revealed_by             uuid,
  -- ALWAYS written, and NULL is a VALUE: a response may report no figure, and
  -- `phone_reveal_cost_source` is what distinguishes "not reported" from "nobody looked".
  p_phone_reveal_cost_credits     integer,
  p_phone_reveal_cost_source      text,          -- 'reported' | 'assumed_cap' | 'unknown'
  -- ALWAYS written. On this path it is NULL by definition; the function refuses anything
  -- else rather than letting an error code ride along with a success.
  p_phone_reveal_error_code       text,
  p_phone_reveal_attempt_count    integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  -- Type priority, IDENTICAL to CANDIDATE_PHONE_TYPE_RANKING in phone-collection-core.ts
  -- and to migration 110's copy. If these lists diverged, a refreshed row would end up
  -- with a different aggregated type than the pure layer computed for the same
  -- observations, and the incumbent comparison below would rank on a different scale.
  c_type_ranking       text[] := ARRAY[
    'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
  ];

  v_candidate          record;
  v_row                record;
  v_src                record;
  v_pref               record;

  v_incoming_count     integer := 0;
  v_distinct_count     integer := 0;
  v_suppressed_count   integer := 0;
  v_viable_preference  integer := 0;
  v_legacy_suppressed  boolean := false;
  -- R1: la identidad y la cuenta ya NO se derivan aquí. Las resuelve, desde la fila
  -- del candidato y dentro de esta misma transacción,
  -- `phone_reveal_candidate_suppression_exists` (Step 2b).
  v_has_live_primary   boolean := false;
  v_existing_live      integer := 0;
  v_inserted_count     integer := 0;
  v_updated_count      integer := 0;
  v_source_count       integer := 0;
  v_affected           integer := 0;

  v_phone_id           uuid;
  v_chosen_id          uuid    := NULL;
  v_chosen_key         text    := NULL;
  v_chosen_phone       text    := NULL;
  v_chosen_type        text    := NULL;
  v_chosen_raw_type    text    := NULL;
  v_chosen_rank        integer := NULL;
  v_chosen_status_rank integer := NULL;

  -- Scalars and NOT a record on purpose: a `SELECT … INTO record` that matches no row
  -- leaves a record whose field access is legal but whose emptiness is easy to misread.
  -- Four plainly-typed NULLs make "there is no incumbent" a value, not a shape.
  v_inc_id             uuid    := NULL;
  v_inc_key            text    := NULL;
  v_inc_rank           integer := NULL;
  v_inc_status_rank    integer := NULL;

  v_primary_id         uuid    := NULL;
  v_primary_key        text    := NULL;
  v_scalar_updated     boolean := false;
  v_scalar             text    := NULL;
  v_meta_type          text    := NULL;
  v_meta_raw_type      text    := NULL;
  v_phone_meta         jsonb;
BEGIN
  -- ═══════════════════════════════════════════════════════════════
  -- Step 0 — shape validation. Fail-closed, and BEFORE any write.
  -- ═══════════════════════════════════════════════════════════════
  -- Every rejection below returns with zero rows touched. Validating after the first
  -- insert would mean relying on the rollback for something a check can prevent outright.

  IF p_candidate_id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'candidate_id_missing');
  END IF;

  IF p_expected_phone_reveal_status IS NULL
     OR LENGTH(BTRIM(p_expected_phone_reveal_status)) = 0 THEN
    -- Without the token there is no ownership check, and a missing ownership check must
    -- never be silently skipped.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'expected_status_missing');
  END IF;

  IF p_observed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'observed_at_missing');
  END IF;

  -- This function is the `revealed` path of ONE provider and nothing else (see SCOPE).
  IF p_phone_reveal_status IS DISTINCT FROM 'revealed' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'status_not_revealed');
  END IF;

  IF p_phone_reveal_provider IS DISTINCT FROM 'lusha' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'provider_not_lusha');
  END IF;

  IF p_phone_reveal_error_code IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'error_code_not_null');
  END IF;

  IF p_phone_reveal_cost_source IS NULL
     OR p_phone_reveal_cost_source NOT IN ('reported', 'assumed_cap', 'unknown') THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'cost_source_unknown');
  END IF;

  IF p_phone_revealed_at IS NULL OR p_phone_reveal_completed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'terminal_timestamps_missing');
  END IF;

  IF p_phone_revealed_by IS NULL THEN
    -- The actor is audit evidence for a paid operation, not an optional label.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'revealed_by_missing');
  END IF;

  IF p_phone_reveal_attempt_count IS NULL OR p_phone_reveal_attempt_count < 1 THEN
    -- This path only exists because an attempt was made; a count below 1 would deny it.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'attempt_count_invalid');
  END IF;

  IF p_legacy_phone IS NULL OR LENGTH(BTRIM(p_legacy_phone)) = 0 THEN
    -- The legacy scalar is the floor: this path exists because Lusha delivered a phone.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'legacy_phone_missing');
  END IF;

  IF p_legacy_phone_type IS NULL OR NOT (p_legacy_phone_type = ANY (c_type_ranking)) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'legacy_phone_type_invalid');
  END IF;

  IF p_legacy_dedupe_key IS NULL OR LENGTH(BTRIM(p_legacy_dedupe_key)) = 0 THEN
    -- Without it the tombstone check on the fallback (step 3) cannot run, and a missing
    -- privacy check must never be silently skipped.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'legacy_dedupe_key_missing');
  END IF;

  IF p_phones IS NULL
     OR jsonb_typeof(p_phones) <> 'array'
     OR jsonb_array_length(p_phones) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phones_empty');
  END IF;

  IF p_sources IS NULL OR jsonb_typeof(p_sources) <> 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'sources_invalid');
  END IF;

  IF p_primary_candidates IS NULL OR jsonb_typeof(p_primary_candidates) <> 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'primary_candidates_invalid');
  END IF;

  -- Every element of the three arrays must be an OBJECT. `jsonb_to_recordset` raises on a
  -- scalar element, and a raise here would report as an infrastructure failure rather than
  -- as the malformed input it is.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_phones) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_sources) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_primary_candidates) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'collection_element_not_object');
  END IF;

  -- ── Per-row validation of the canonical collection ──────────────
  -- The vocabularies are re-checked here even though migration 109 has CHECK constraints
  -- for both: hitting the constraint would raise and roll back, which is correct but
  -- reports as an infrastructure failure. A caller sending a bad status deserves
  -- `invalid_input`, not a rollback that looks like the database broke.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_phones) AS x(
      dedupe_key       text,
      normalized_phone text,
      display_phone    text,
      phone_type       text,
      phone_status     text,
      first_seen_at    timestamptz,
      last_seen_at     timestamptz
    )
    WHERE x.dedupe_key IS NULL
       OR LENGTH(BTRIM(x.dedupe_key)) = 0
       OR x.phone_status IS NULL
       OR x.phone_status NOT IN ('valid', 'invalid', 'unknown')
       OR (x.phone_type IS NOT NULL AND NOT (x.phone_type = ANY (c_type_ranking)))
       OR x.first_seen_at IS NULL
       OR x.last_seen_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phone_row_invalid');
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT x.dedupe_key)
    INTO v_incoming_count, v_distinct_count
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text);

  IF v_incoming_count <> v_distinct_count THEN
    -- `mergeCandidatePhoneInputs` already collapses one key into one row. Two rows sharing
    -- a key would mean the pure layer and this function disagree about what a phone IS.
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'phone_key_duplicated');
  END IF;

  -- Provenance must be LUSHA provenance, acquired as a paid reveal. This is the Lusha
  -- writer: accepting another provider here would let one path write evidence about a
  -- provider it never called.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_sources) AS s(
      dedupe_key       text,
      provider         text,
      acquisition_mode text,
      source_event_key text,
      observed_at      timestamptz
    )
    WHERE s.dedupe_key IS NULL
       OR LENGTH(BTRIM(s.dedupe_key)) = 0
       OR s.provider IS DISTINCT FROM 'lusha'
       OR s.acquisition_mode IS DISTINCT FROM 'reveal'
       OR s.source_event_key IS NULL
       OR LENGTH(BTRIM(s.source_event_key)) = 0
       OR s.observed_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'source_row_invalid');
  END IF;

  -- Every provenance row must belong to a phone in THIS payload. A source pointing at a
  -- key that is not being written is provenance for nothing.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_sources) AS s(dedupe_key text)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
      WHERE x.dedupe_key = s.dedupe_key
    )
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'source_key_orphan');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_primary_candidates) AS e(item)
    CROSS JOIN LATERAL jsonb_to_record(e.item) AS r(
      dedupe_key text, phone text, phone_type text, raw_type text
    )
    WHERE r.dedupe_key IS NULL
       OR LENGTH(BTRIM(r.dedupe_key)) = 0
       OR r.phone IS NULL
       OR LENGTH(BTRIM(r.phone)) = 0
       OR r.phone_type IS NULL
       OR NOT (r.phone_type = ANY (c_type_ranking))
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'primary_candidate_invalid');
  END IF;

  -- Every preference key must be one of the payload's phones. A preference for a key that
  -- is not being written could promote a row this event never observed.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_primary_candidates) AS r(dedupe_key text)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
      WHERE x.dedupe_key = r.dedupe_key
    )
  ) THEN
    RETURN jsonb_build_object('status', 'invalid_input', 'detail', 'primary_candidate_orphan');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 1 — LOCK the candidate.
  -- ═══════════════════════════════════════════════════════════════
  -- The serialization point. Two triggers can genuinely reach the same candidate — the
  -- waterfall continuation runs best-effort from the webhook, the recovery cron and the
  -- manual L3 review — and although the run-level `claimLushaAttempt` is already atomic,
  -- a lock here is what makes the DATA write serialize too. Every check that follows is
  -- deliberately AFTER it, so nothing is decided on a snapshot a concurrent transaction
  -- can invalidate.

  SELECT c.id,
         c.enrichment_metadata,
         c.phone_reveal_status,
         c.phone_reveal_provider,
         -- AGENT2A-PHONE-REVEAL-4O-E3 — columnas con las que se resuelve la clave de la
         -- supresión POR PERSONA sin salir de la transacción ni del lock.
         c.enrichment_run_id,
         c.apollo_person_id,
         c.source,
         c.source_contact_id
    INTO v_candidate
  FROM public.contact_enrichment_candidates c
  WHERE c.id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'candidate_not_eligible', 'detail', 'candidate_not_found');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 2 — is this event still the one that owns the candidate?
  -- ═══════════════════════════════════════════════════════════════

  IF v_candidate.phone_reveal_status = 'revealed'
     AND v_candidate.phone_reveal_provider = 'lusha' THEN
    -- Already closed as a Lusha reveal: a concurrent caller won the lock and did exactly
    -- this work. Rewriting it would be pointless; reporting failure would be false. The
    -- honest answer is that the desired state is already in place.
    RETURN jsonb_build_object(
      'status',                   'idempotent',
      'inserted_phone_count',     0,
      'updated_phone_count',      0,
      'inserted_source_count',    0,
      'suppressed_skipped_count', 0,
      'primary_dedupe_key',       NULL,
      'primary_set',              EXISTS (
        SELECT 1 FROM public.contact_enrichment_candidate_phones p
        WHERE p.candidate_id = p_candidate_id AND p.is_primary
      ),
      'candidate_scalar_updated', false,
      'candidate_terminalized',   true
    );
  END IF;

  IF v_candidate.phone_reveal_status IS DISTINCT FROM p_expected_phone_reveal_status THEN
    -- The candidate is no longer in the state that authorized this leg. Writing over it
    -- would overwrite a conclusion somebody else reached.
    RETURN jsonb_build_object('status', 'stale_event', 'detail', 'expected_status_superseded');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 2b — PROVIDER-NATIVE suppression, re-checked UNDER the lock.
  -- (4O-E3, re-keyed by AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4-R1)
  -- ═══════════════════════════════════════════════════════════════
  -- Step 3 re-checks the tombstones of the NUMBERS this event carries, and on its own
  -- that is not enough. A DSAR erases a PERSON: what it tombstoned are the numbers the
  -- collection ALREADY held. A number this provider had never returned before has no
  -- tombstone to match, so the number-level check waves it through — and the person
  -- whose data was erased ends up with a live phone again, minutes after the erasure.
  --
  -- The application-layer gate reads exactly this state, but it reads it BEFORE the
  -- provider call and OUTSIDE this lock, so a suppression that commits in between is
  -- invisible to it. Reading it HERE puts the check inside the very transaction that
  -- would otherwise persist the result:
  --
  --   * erasure commits first  ⇒ this read sees the suppression ⇒ nothing is written;
  --   * this transaction first ⇒ the erasure that follows takes this same candidate
  --     lock and tombstones what was written (migration 112).
  --
  -- Both orderings end suppressed, which is the property the pre-call gate alone could
  -- not provide.
  --
  -- WHAT R1 CHANGED, and why this block is the whole reason 110/111 are restated here:
  -- until R1 the key was resolved INLINE with APOLLO rules —
  -- `phone_reveal_normalized_apollo_person_id` over the payload, the candidate column
  -- and (only for an Apollo-sourced candidate) `source_contact_id` — and the check was
  -- skipped outright unless BOTH a person id and an account existed. For a Lusha-sourced
  -- candidate with no Apollo id that resolved to NULL, so the guard was skipped and this
  -- transaction performed NO suppression re-check at all: for Lusha the last word
  -- belonged to a read taken before the provider call and outside this lock. A Lusha
  -- suppression was not merely unmatched here, it was unreachable.
  --
  -- The derivation now lives in ONE place —
  -- `phone_reveal_candidate_suppression_exists` — so the two functions do not each
  -- carry their own copy of the trust decision, and so the identity comes from the
  -- CANDIDATE ROW inside this transaction rather than from anything a caller says.
  -- Apollo behavior is preserved exactly (native record OR legacy account-scoped
  -- tombstone); the account is no longer REQUIRED, so a candidate with no account is
  -- evaluated instead of waved through.
  --
  -- Still NO inference: no phone, email, name, LinkedIn URL or domain is matched, and
  -- an Apollo id is never evaluated in Lusha's namespace or the reverse.
  --
  -- The provider was already called and already charged by the time this runs. This step
  -- withholds the NUMBER, never the cost: no usage log, reservation or waterfall row is
  -- written from inside this function, so the spend survives exactly as it was recorded.

  IF public.phone_reveal_candidate_suppression_exists(p_candidate_id, NULL) THEN
    -- Fail closed with NOTHING written and WITHOUT terminalizing the candidate, exactly
    -- like the number-level verdict below. The terminal trace (`error` +
    -- `blocked_suppressed`), the run abort and the reservation settlement belong to the
    -- 4O-E1 policy in the TypeScript layer and are NOT duplicated in SQL.
    RETURN jsonb_build_object(
      'status',                   'suppressed',
      'inserted_phone_count',     0,
      'updated_phone_count',      0,
      'inserted_source_count',    0,
      'suppressed_skipped_count', 0,
      'primary_dedupe_key',       NULL,
      'primary_set',              false,
      'candidate_scalar_updated', false,
      'candidate_terminalized',   false
    );
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 3 — tombstones, re-checked UNDER the lock.
  -- ═══════════════════════════════════════════════════════════════
  -- The TypeScript layer cannot own this check: it reads before the lock, and a suppression
  -- committed in that window would be invisible to it. Here the read is inside the
  -- serialized region, and the ON CONFLICT clauses below carry the same condition again so
  -- the guarantee survives even if this count were somehow wrong.

  SELECT COUNT(*) INTO v_suppressed_count
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
  JOIN public.contact_enrichment_candidate_phones e
    ON e.candidate_id = p_candidate_id
   AND e.dedupe_key = x.dedupe_key
  WHERE e.suppressed_at IS NOT NULL;

  SELECT EXISTS (
    SELECT 1 FROM public.contact_enrichment_candidate_phones e
    WHERE e.candidate_id = p_candidate_id
      AND e.dedupe_key = p_legacy_dedupe_key
      AND e.suppressed_at IS NOT NULL
  ) INTO v_legacy_suppressed;

  SELECT COUNT(*) INTO v_viable_preference
  FROM jsonb_array_elements(p_primary_candidates) AS e(item)
  CROSS JOIN LATERAL jsonb_to_record(e.item) AS r(
    dedupe_key text, phone text, phone_type text, raw_type text
  )
  WHERE NOT EXISTS (
    SELECT 1 FROM public.contact_enrichment_candidate_phones ex
    WHERE ex.candidate_id = p_candidate_id
      AND ex.dedupe_key = r.dedupe_key
      AND ex.suppressed_at IS NOT NULL
  );

  -- A live primary already standing means the visible scalar does NOT depend on the legacy
  -- fallback, so a tombstoned legacy number cannot reach the visible field through it.
  SELECT EXISTS (
    SELECT 1 FROM public.contact_enrichment_candidate_phones e
    WHERE e.candidate_id = p_candidate_id
      AND e.is_primary
      AND e.suppressed_at IS NULL
  ) INTO v_has_live_primary;

  IF v_legacy_suppressed AND v_viable_preference = 0 AND NOT v_has_live_primary THEN
    -- Nothing electable survives, the fallback is a tombstone, and there is no standing
    -- primary to fall back on. Fail closed with nothing written and — the part that matters
    -- — WITHOUT terminalizing the candidate: a `revealed` row here would have to carry some
    -- number, and the only one left is one that was erased.
    --
    -- This subsumes the simpler "every number in the payload is a tombstone" case, since the
    -- legacy number is always one of the payload's numbers.
    --
    -- DECLARED LIMIT, identical to migration 110's: a permanent tombstone makes the leg
    -- resolve as unterminalized on every retry, always at whatever the provider already
    -- charged, until an operator intervenes. That is chosen over putting an erased number
    -- back in front of a user. The general suppression terminal policy is NOT resolved here.
    RETURN jsonb_build_object(
      'status',                   'suppressed',
      'inserted_phone_count',     0,
      'updated_phone_count',      0,
      'inserted_source_count',    0,
      'suppressed_skipped_count', v_suppressed_count,
      'primary_dedupe_key',       NULL,
      'primary_set',              false,
      'candidate_scalar_updated', false,
      'candidate_terminalized',   false
    );
  END IF;

  -- How many of the survivors already exist. Counted BEFORE the writes so that
  -- inserted/updated are facts rather than an interpretation of `xmax`.
  SELECT COUNT(*) INTO v_existing_live
  FROM jsonb_to_recordset(p_phones) AS x(dedupe_key text)
  JOIN public.contact_enrichment_candidate_phones e
    ON e.candidate_id = p_candidate_id
   AND e.dedupe_key = x.dedupe_key
  WHERE e.suppressed_at IS NULL;

  v_updated_count := v_existing_live;
  v_inserted_count := v_incoming_count - v_suppressed_count - v_existing_live;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 4 — canonical phones: insert new, refresh known.
  -- ═══════════════════════════════════════════════════════════════
  -- `is_primary` is false for every INSERT here and elected in step 6. Promoting during the
  -- insert would collide with the single-primary partial index while the previous primary is
  -- still standing. The ON CONFLICT branch does NOT touch `is_primary`, so a row that was
  -- already primary and shows up again in this payload keeps its designation until step 6
  -- decides otherwise.

  FOR v_row IN
    SELECT x.dedupe_key,
           x.normalized_phone,
           x.display_phone,
           x.phone_type,
           x.phone_status,
           x.first_seen_at,
           x.last_seen_at
    FROM jsonb_to_recordset(p_phones) AS x(
      dedupe_key       text,
      normalized_phone text,
      display_phone    text,
      phone_type       text,
      phone_status     text,
      first_seen_at    timestamptz,
      last_seen_at     timestamptz
    )
  LOOP
    -- Reset per iteration: `RETURNING … INTO` on a row the tombstone guard skipped must
    -- leave NULL here, not the id of the previous phone.
    v_phone_id := NULL;

    INSERT INTO public.contact_enrichment_candidate_phones AS t (
      candidate_id, normalized_phone, display_phone, dedupe_key,
      phone_type, phone_status, is_primary, first_seen_at, last_seen_at
    ) VALUES (
      p_candidate_id, v_row.normalized_phone, v_row.display_phone, v_row.dedupe_key,
      v_row.phone_type, v_row.phone_status, false, v_row.first_seen_at, v_row.last_seen_at
    )
    ON CONFLICT (candidate_id, dedupe_key) DO UPDATE
      SET
        -- `aggregateCandidatePhoneStatus`, mirrored: a provider that fails to verify a
        -- number is reporting its own coverage, so `invalid` never demotes a `valid`. This
        -- is what lets a number the other provider confirmed keep its `valid` when Lusha —
        -- which reports no per-number status at all — observes it again as `unknown`.
        phone_status = CASE
          WHEN 'valid' IN (t.phone_status, excluded.phone_status) THEN 'valid'
          WHEN t.phone_status = 'invalid'
               AND excluded.phone_status IN ('invalid', 'unknown') THEN 'invalid'
          WHEN excluded.phone_status = 'invalid'
               AND t.phone_status IN ('invalid', 'unknown') THEN 'invalid'
          ELSE 'unknown'
        END,
        -- `aggregateCandidatePhoneType`, mirrored: the better-ranked of the two wins, and
        -- every raw type stays intact in the provenance rows regardless.
        phone_type = CASE
          WHEN t.phone_type IS NULL THEN COALESCE(excluded.phone_type, 'unknown')
          WHEN COALESCE(array_position(c_type_ranking, t.phone_type),
                        array_length(c_type_ranking, 1) + 1)
               <= COALESCE(array_position(c_type_ranking,
                                          COALESCE(excluded.phone_type, 'unknown')),
                           array_length(c_type_ranking, 1) + 1)
            THEN t.phone_type
          ELSE COALESCE(excluded.phone_type, 'unknown')
        END,
        -- `first_seen_at` is deliberately untouched: it is the first time the number was
        -- seen, and seeing it again does not change that.
        last_seen_at = p_observed_at
      -- The tombstone guard, restated where it is enforced rather than merely intended.
      -- Without it a tombstoned row would be handed back its number and its type by this
      -- very UPDATE, and migration 109's `..._tombstone_is_empty` CHECK would then reject
      -- the statement — turning a privacy rule into a rollback.
      WHERE t.suppressed_at IS NULL
    RETURNING t.id INTO v_phone_id;

    -- A tombstoned row returns nothing: no provenance, no primary, no trace of the
    -- observation. Recording that a suppressed person was seen again is still recording it.
    IF v_phone_id IS NULL THEN
      CONTINUE;
    END IF;

    -- ═════════════════════════════════════════════════════════════
    -- Step 5 — provenance: append-only and idempotent.
    -- ═════════════════════════════════════════════════════════════
    -- ON CONFLICT DO NOTHING on (candidate_phone_id, source_event_key). Reprocessing the
    -- same response recognises the same observation instead of appending a second row, and
    -- no UPDATE is needed — which matters, because migration 109 does not grant one.
    --
    -- This is also where the cross-provider guarantee materialises: the same number seen by
    -- both providers is ONE canonical row with TWO provenance rows, because the keys differ
    -- by provider and neither overwrites the other.

    FOR v_src IN
      SELECT s.provider,
             s.acquisition_mode,
             s.raw_provider_type,
             s.raw_provider_status,
             s.waterfall_run_id,
             s.reservation_id,
             s.provider_usage_log_id,
             s.source_event_key,
             s.observed_at
      FROM jsonb_to_recordset(p_sources) AS s(
        dedupe_key            text,
        provider              text,
        acquisition_mode      text,
        raw_provider_type     text,
        raw_provider_status   text,
        waterfall_run_id      uuid,
        reservation_id        uuid,
        provider_usage_log_id uuid,
        source_event_key      text,
        observed_at           timestamptz
      )
      WHERE s.dedupe_key = v_row.dedupe_key
    LOOP
      INSERT INTO public.contact_enrichment_candidate_phone_sources (
        candidate_phone_id, provider, acquisition_mode, raw_provider_type,
        raw_provider_status, waterfall_run_id, reservation_id, provider_usage_log_id,
        source_event_key, observed_at
      ) VALUES (
        v_phone_id, v_src.provider, v_src.acquisition_mode, v_src.raw_provider_type,
        v_src.raw_provider_status, v_src.waterfall_run_id, v_src.reservation_id,
        v_src.provider_usage_log_id, v_src.source_event_key, v_src.observed_at
      )
      ON CONFLICT (candidate_phone_id, source_event_key) DO NOTHING;

      GET DIAGNOSTICS v_affected = ROW_COUNT;
      v_source_count := v_source_count + v_affected;
    END LOOP;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 6 — elect exactly one primary, never a worse one.
  -- ═══════════════════════════════════════════════════════════════
  -- The ORDER is the pure layer's decision. What this function decides is ELIGIBILITY —
  -- from the rows as they NOW stand: alive, numbered, not asserted invalid, which are the
  -- three conditions of migration 109's `..._primary_requires_live_number` CHECK, so a key
  -- this loop accepts can never be one the database would then reject — and, unlike
  -- migration 110, whether the winner actually IMPROVES on the incumbent.

  FOR v_pref IN
    SELECT r.dedupe_key, r.phone, r.phone_type, r.raw_type
    FROM jsonb_array_elements(p_primary_candidates) WITH ORDINALITY AS e(item, ord)
    CROSS JOIN LATERAL jsonb_to_record(e.item) AS r(
      dedupe_key text, phone text, phone_type text, raw_type text
    )
    ORDER BY e.ord
  LOOP
    SELECT p.id,
           COALESCE(array_position(c_type_ranking, COALESCE(p.phone_type, 'unknown')),
                    array_length(c_type_ranking, 1) + 1),
           CASE p.phone_status WHEN 'valid' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END
      INTO v_chosen_id, v_chosen_rank, v_chosen_status_rank
    FROM public.contact_enrichment_candidate_phones p
    WHERE p.candidate_id = p_candidate_id
      AND p.dedupe_key = v_pref.dedupe_key
      AND p.suppressed_at IS NULL
      AND p.normalized_phone IS NOT NULL
      AND p.phone_status <> 'invalid';

    IF v_chosen_id IS NOT NULL THEN
      v_chosen_key      := v_pref.dedupe_key;
      -- The scalar and its metadata come from the SAME entry as the elected key. This is
      -- the whole reason the triple travels with the key.
      v_chosen_phone    := v_pref.phone;
      v_chosen_type     := v_pref.phone_type;
      v_chosen_raw_type := v_pref.raw_type;
      EXIT;
    END IF;
  END LOOP;

  -- The live incumbent, read AFTER the upserts so its aggregated type is the current one.
  SELECT p.id,
         p.dedupe_key,
         COALESCE(array_position(c_type_ranking, COALESCE(p.phone_type, 'unknown')),
                  array_length(c_type_ranking, 1) + 1),
         CASE p.phone_status WHEN 'valid' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END
    INTO v_inc_id, v_inc_key, v_inc_rank, v_inc_status_rank
  FROM public.contact_enrichment_candidate_phones p
  WHERE p.candidate_id = p_candidate_id
    AND p.is_primary
    AND p.suppressed_at IS NULL;

  IF v_chosen_id IS NOT NULL THEN
    IF v_inc_id IS NOT NULL
       AND v_inc_id <> v_chosen_id
       AND (v_chosen_rank, v_chosen_status_rank) >= (v_inc_rank, v_inc_status_rank) THEN
      -- The incumbent is as good or better. It KEEPS the designation, and the visible
      -- fields are left exactly as they are: they already describe that number, with its
      -- own provenance. Relabelling it as this provider's reveal, or replacing it with a
      -- worse number, are both changes nobody asked for.
      v_primary_id     := v_inc_id;
      v_primary_key    := v_inc_key;
      v_scalar_updated := false;
    ELSE
      -- A strict improvement (or there was no incumbent, or the incumbent IS this key).
      v_primary_id      := v_chosen_id;
      v_primary_key     := v_chosen_key;
      v_scalar_updated  := true;
      v_scalar          := v_chosen_phone;
      v_meta_type       := v_chosen_type;
      v_meta_raw_type   := v_chosen_raw_type;
    END IF;
  ELSIF v_inc_id IS NOT NULL THEN
    -- Nothing from this response qualifies, but a primary is already standing. It is kept
    -- and the visible fields are left alone — the coherent reading, and the one that cannot
    -- put a worse number in front of a user.
    v_primary_id     := v_inc_id;
    v_primary_key    := v_inc_key;
    v_scalar_updated := false;
  ELSE
    -- No primary at all: neither this response nor the table has an electable number. The
    -- scalar keeps the LEGACY behaviour, byte-for-byte what the caller wrote before 4O-D.
    -- The collection is left without a primary, which is the honest reading of a number
    -- that migration 109's CHECK will not let be one.
    v_primary_id     := NULL;
    v_primary_key    := NULL;
    v_scalar_updated := true;
    v_scalar         := p_legacy_phone;
    v_meta_type      := p_legacy_phone_type;
    v_meta_raw_type  := p_legacy_raw_type;
  END IF;

  IF v_primary_id IS NOT NULL THEN
    -- Demote first, promote second. The partial unique index does not tolerate two
    -- primaries even for an instant, and doing it in this order needs no window. Both
    -- statements are no-ops when the incumbent already IS the elected row.
    UPDATE public.contact_enrichment_candidate_phones
       SET is_primary = false
     WHERE candidate_id = p_candidate_id
       AND is_primary
       AND id <> v_primary_id;

    UPDATE public.contact_enrichment_candidate_phones
       SET is_primary = true
     WHERE id = v_primary_id
       AND NOT is_primary;
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Step 7 — the candidate: scalar phone plus terminal state.
  -- ═══════════════════════════════════════════════════════════════
  -- Same transaction as everything above, so the forbidden state — a visible phone with an
  -- incomplete collection — cannot be observed even for the duration of a query.
  --
  -- `phone` and `enrichment_metadata` are written ONLY when this response's number won.
  -- When the incumbent was retained they are conditionally skipped by the CASE below
  -- rather than by a second statement, so there is still exactly one UPDATE and one
  -- ROW_COUNT to verify.

  v_phone_meta := jsonb_build_object(
    'number',   v_scalar,
    'type',     v_meta_type,
    'source',   'lusha_reveal',
    'raw_type', v_meta_raw_type
  );

  UPDATE public.contact_enrichment_candidates
     SET phone = CASE WHEN v_scalar_updated THEN v_scalar ELSE phone END,
         -- Shallow merge of the single `phone` key, exactly as the caller's
         -- `{...candidate.enrichmentMetadata, phone: phoneMetadata}` does — except read
         -- from the LOCKED row, so a concurrent metadata write cannot be clobbered by a
         -- stale copy.
         enrichment_metadata = CASE
           WHEN v_scalar_updated THEN jsonb_set(
             COALESCE(enrichment_metadata, '{}'::jsonb), '{phone}', v_phone_meta, true
           )
           ELSE enrichment_metadata
         END,
         phone_reveal_status        = p_phone_reveal_status,
         phone_reveal_provider      = p_phone_reveal_provider,
         -- Written unconditionally, NULL included: that NULL is what clears a previous
         -- provider's orphan correlation id off a row whose provider is now `lusha`.
         phone_reveal_request_id    = p_phone_reveal_request_id,
         phone_revealed_at          = p_phone_revealed_at,
         phone_reveal_completed_at  = p_phone_reveal_completed_at,
         phone_revealed_by          = p_phone_revealed_by,
         phone_reveal_cost_credits  = p_phone_reveal_cost_credits,
         phone_reveal_cost_source   = p_phone_reveal_cost_source,
         phone_reveal_error_code    = p_phone_reveal_error_code,
         phone_reveal_attempt_count = p_phone_reveal_attempt_count
   WHERE id = p_candidate_id;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    -- Unreachable while the row is locked; raised rather than reported because it would
    -- mean the lock did not hold, and continuing would leave a collection with no terminal
    -- state. The message names the operation, never a value.
    RAISE EXCEPTION 'persist_candidate_lusha_phone_reveal_result: candidate terminal update did not affect exactly one row';
  END IF;

  RETURN jsonb_build_object(
    'status',                   'persisted',
    'inserted_phone_count',     v_inserted_count,
    'updated_phone_count',      v_updated_count,
    'inserted_source_count',    v_source_count,
    'suppressed_skipped_count', v_suppressed_count,
    'primary_dedupe_key',       v_primary_key,
    'primary_set',              v_primary_id IS NOT NULL,
    'candidate_scalar_updated', v_scalar_updated,
    'candidate_terminalized',   true
  );
END $$;

-- ── 8.3 Privileges, re-declared so this migration's end state is explicit ──
--
-- `CREATE OR REPLACE FUNCTION` preserves the existing grants, so this block changes
-- nothing on a database that already ran 113. It is restated verbatim from 113 anyway,
-- because a reader of THIS file should not have to open another one to learn who may
-- execute the two functions it defines.

REVOKE ALL ON FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text
) FROM anon;

REVOKE ALL ON FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.persist_candidate_apollo_phone_reveal_result(
  uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text
) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text, text,
  timestamptz, timestamptz, uuid, integer, text, text, integer
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text, text,
  timestamptz, timestamptz, uuid, integer, text, text, integer
) FROM anon;

REVOKE ALL ON FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text, text,
  timestamptz, timestamptz, uuid, integer, text, text, integer
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.persist_candidate_lusha_phone_reveal_result(
  uuid, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text, text,
  timestamptz, timestamptz, uuid, integer, text, text, integer
) TO postgres, service_role;
