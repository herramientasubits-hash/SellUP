-- Migration 099: Apollo phone reveal cache (APOLLO-PHONE-CACHE-1b)
-- Agente 2A. Creates the `phone_reveal_cache` table that lets an already-paid
-- Apollo phone reveal be reused, and widens the `contacts.phone_source`
-- vocabulary with `apollo_cache` so a reused phone is ALWAYS distinguishable
-- from a freshly revealed one.
--
-- Approved privacy policy (product + legal GO) enforced by this schema:
--   * TTL 90 days — `expires_at` is written by the application as
--     original_revealed_at + 90d. An expired row is a MISS (never served, never
--     extended on read).
--   * SAME ACCOUNT ONLY — the unique key and the lookup index are scoped by
--     `account_id`. There is no cross-account reuse path.
--   * NO CROSS-COUNTRY — `country_code` is NOT NULL and part of the lookup.
--     A candidate whose country cannot be resolved never matches (unknown
--     country = no reuse), because a NULL never satisfies the equality filter.
--   * TOMBSTONE / SUPPRESSION — suppression is a HARD DELETE of the phone
--     (`normalized_phone` / `phone_type` set to NULL) plus a PII-free tombstone
--     (`suppressed_at` / `suppression_reason` / `suppressed_by`). A CHECK makes
--     "suppressed but still holding a phone" unrepresentable. The tombstone row
--     stays so a future reveal for that person/account stays blocked, and it is
--     INSERTED when no cache row exists (a DSAR on an empty cache must still
--     block future hits and future automatic reveals).
--   * SUPPRESSION REASON IS A CLOSED VOCABULARY — `suppression_reason` is
--     CHECK-constrained to a small set of machine codes, never free text, so a
--     privacy record cannot become a place where PII is typed in by hand.
--   * DURABLE, PII-FREE SUPPRESSION AUDIT — `phone_reveal_suppression_audit`
--     records each erasure with the person id only as a SHA-256 hash, plus the
--     reason code and the counts of rows actually updated. No column of that
--     table can hold a phone, email, name or linkedin.
--   * ONLY REVEALED PHONES ARE CACHED — `phone_source` is constrained to
--     'apollo_reveal'; a cache hit can never be re-cached.
--   * APOLLO ONLY — `provider` is constrained to 'apollo'. No Lusha, ever.
--
-- This migration does NOT:
--   * insert any row — the cache starts EMPTY, there is no backfill
--   * contain any real phone, person, name, email or linkedin
--   * reveal a phone, call Apollo/Lusha or spend credits
--   * activate ENABLE_APOLLO_PHONE_CACHE or any other flag
--   * write HubSpot, create contacts or approve candidates
--   * change RLS/policies/triggers of any pre-existing table
--   * add a bulk path of any kind
--
-- Safety: additive. The only pre-existing object touched is the NOT VALID
-- `contacts_phone_source_check`, which is replaced by a strictly WIDER version
-- (same values + 'apollo_cache'), so no existing row can become invalid.

-- ── 1. Cache table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.phone_reveal_cache (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Apollo only in v1. Lusha (or any other provider) must never land here.
  provider                      text        NOT NULL DEFAULT 'apollo'
    CONSTRAINT phone_reveal_cache_provider_check
    CHECK (provider IN ('apollo')),

  -- Apollo person id (MongoDB ObjectId, 24 hex). Opaque correlation id, NOT PII.
  -- The application validates the shape (never a Lusha `v1.<token>` id).
  provider_person_id            text        NOT NULL,

  -- Reuse scope: same account only. NOT NULL by design — a cache entry without
  -- an account could not be scoped, so it is simply never written.
  account_id                    uuid        NOT NULL
    REFERENCES public.accounts(id) ON DELETE CASCADE,

  -- Reuse scope: same country only. NOT NULL by design — unknown country means
  -- the reveal is simply not cached (and never reused).
  country_code                  text        NOT NULL
    CONSTRAINT phone_reveal_cache_country_code_check
    CHECK (country_code ~ '^[A-Z]{2}$'),

  -- The cached phone. NULL after suppression (hard delete of the value).
  normalized_phone              text        NULL,
  phone_type                    text        NULL
    CONSTRAINT phone_reveal_cache_phone_type_check
    CHECK (
      phone_type IS NULL
      OR phone_type IN (
        'personal_mobile',
        'mobile',
        'direct_dial',
        'work',
        'hq',
        'other',
        'unknown'
      )
    ),

  -- Provenance of the CACHED value: only a real, paid Apollo reveal may be
  -- cached. A cache hit ('apollo_cache') can never be written back here.
  phone_source                  text        NOT NULL DEFAULT 'apollo_reveal'
    CONSTRAINT phone_reveal_cache_phone_source_check
    CHECK (phone_source IN ('apollo_reveal')),

  -- TTL. `expires_at` = original_revealed_at + 90 days (written by the app).
  -- Never extended on read: a cache hit does NOT refresh the TTL.
  original_revealed_at          timestamptz NOT NULL,
  expires_at                    timestamptz NOT NULL,

  -- Reuse telemetry (no PII).
  last_used_at                  timestamptz NULL,
  hit_count                     integer     NOT NULL DEFAULT 0
    CONSTRAINT phone_reveal_cache_hit_count_check CHECK (hit_count >= 0),

  -- Traceability back to what produced the entry. All nullable and all
  -- ON DELETE SET NULL: losing the origin must never delete the tombstone.
  source_candidate_id           uuid        NULL
    REFERENCES public.contact_enrichment_candidates(id) ON DELETE SET NULL,
  source_contact_id             uuid        NULL
    REFERENCES public.contacts(id) ON DELETE SET NULL,
  source_provider_usage_log_id  uuid        NULL
    REFERENCES public.provider_usage_logs(id) ON DELETE SET NULL,

  -- Tombstone. Never contains a phone (enforced by the CHECK below).
  suppressed_at                 timestamptz NULL,
  -- Closed vocabulary, NOT free text: a privacy record must not become a place
  -- where the data subject's name / phone / email gets typed in by hand.
  suppression_reason            text        NULL
    CONSTRAINT phone_reveal_cache_suppression_reason_check
    CHECK (
      suppression_reason IS NULL
      OR suppression_reason IN (
        'dsar_erasure_request',
        'do_not_contact_request',
        'legal_privacy_request',
        'admin_privacy_correction',
        'test_synthetic'
      )
    ),
  suppressed_by                 uuid        NULL
    REFERENCES public.internal_users(id) ON DELETE SET NULL,

  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),

  -- Suppression is a HARD DELETE of the phone: a suppressed row holding a phone
  -- (or a phone type) is unrepresentable.
  CONSTRAINT phone_reveal_cache_suppressed_is_phone_free
    CHECK (
      suppressed_at IS NULL
      OR (normalized_phone IS NULL AND phone_type IS NULL)
    ),

  -- A tombstone always carries a reason (auditable, PII-free).
  CONSTRAINT phone_reveal_cache_suppression_reason_required
    CHECK (suppressed_at IS NULL OR suppression_reason IS NOT NULL)
);

-- ── 2. Uniqueness: one entry per (provider, person, account) ────────
-- Scoped by account so the same Apollo person cached for account A can never be
-- served to account B. This is the structural guarantee behind "same account
-- only": there is no row that spans accounts.

CREATE UNIQUE INDEX IF NOT EXISTS phone_reveal_cache_provider_person_account_key
  ON public.phone_reveal_cache (provider, provider_person_id, account_id);

-- ── 3. Active-lookup index ─────────────────────────────────────────
-- Mirrors exactly the fast-path query: provider + person + account + country,
-- restricted to rows that are servable at all (not suppressed, still holding a
-- phone). The `expires_at > now()` part stays in the query (now() is not
-- immutable, so it cannot live in the index predicate).

CREATE INDEX IF NOT EXISTS phone_reveal_cache_active_lookup_idx
  ON public.phone_reveal_cache
    (provider, provider_person_id, account_id, country_code, expires_at)
  WHERE suppressed_at IS NULL AND normalized_phone IS NOT NULL;

-- Tombstone lookup (blocks a future reveal for that person/account).
CREATE INDEX IF NOT EXISTS phone_reveal_cache_suppressed_idx
  ON public.phone_reveal_cache (provider, provider_person_id, account_id)
  WHERE suppressed_at IS NOT NULL;

-- ── 4. updated_at trigger (reuses set_updated_at() from migration 038) ──

DROP TRIGGER IF EXISTS phone_reveal_cache_set_updated_at ON public.phone_reveal_cache;
CREATE TRIGGER phone_reveal_cache_set_updated_at
  BEFORE UPDATE ON public.phone_reveal_cache
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 5. RLS — service_role only ─────────────────────────────────────
-- The table holds revealed phone numbers, so it is NOT readable by
-- `authenticated`: RLS is enabled and only `service_role` gets a policy.
-- Everything else is fail-closed (no policy = no access).

ALTER TABLE public.phone_reveal_cache ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'phone_reveal_cache'
      AND policyname = 'service_role_all_phone_reveal_cache'
  ) THEN
    CREATE POLICY "service_role_all_phone_reveal_cache"
      ON public.phone_reveal_cache FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 6. Durable suppression audit ───────────────────────────────────
-- A DSAR erasure has to leave a trace that survives a process restart, so the
-- suppression audit is a TABLE and not a log line. It is deliberately PII-free:
-- the Apollo person id is stored only as a SHA-256 hash, the reason is a closed
-- vocabulary, and there is no column that could hold a phone, email, name or
-- linkedin. It records what was actually cleared (counts of rows the database
-- reported as updated), never the values that were cleared.

CREATE TABLE IF NOT EXISTS public.phone_reveal_suppression_audit (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  provider                 text        NOT NULL DEFAULT 'apollo'
    CONSTRAINT phone_reveal_suppression_audit_provider_check
    CHECK (provider IN ('apollo')),

  -- SHA-256 (hex) of the Apollo person id. Lets two events about the same person
  -- be correlated WITHOUT publishing the provider identifier.
  provider_person_id_hash  text        NOT NULL
    CONSTRAINT phone_reveal_suppression_audit_hash_check
    CHECK (provider_person_id_hash ~ '^[0-9a-f]{64}$'),

  account_id               uuid        NOT NULL
    REFERENCES public.accounts(id) ON DELETE CASCADE,
  country_code             text        NULL
    CONSTRAINT phone_reveal_suppression_audit_country_code_check
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),

  actor_user_id            uuid        NULL
    REFERENCES public.internal_users(id) ON DELETE SET NULL,

  -- Same closed vocabulary as phone_reveal_cache.suppression_reason.
  reason_code              text        NOT NULL
    CONSTRAINT phone_reveal_suppression_audit_reason_code_check
    CHECK (
      reason_code IN (
        'dsar_erasure_request',
        'do_not_contact_request',
        'legal_privacy_request',
        'admin_privacy_correction',
        'test_synthetic'
      )
    ),

  -- Counts of rows the database actually reported as updated (never the plan).
  candidates_cleared       integer     NOT NULL DEFAULT 0
    CONSTRAINT phone_reveal_suppression_audit_candidates_check
    CHECK (candidates_cleared >= 0),
  contacts_cleared         integer     NOT NULL DEFAULT 0
    CONSTRAINT phone_reveal_suppression_audit_contacts_check
    CHECK (contacts_cleared >= 0),
  cache_rows_suppressed    integer     NOT NULL DEFAULT 0
    CONSTRAINT phone_reveal_suppression_audit_cache_rows_check
    CHECK (cache_rows_suppressed >= 0),
  tombstone_created        boolean     NOT NULL DEFAULT false,

  created_at               timestamptz NOT NULL DEFAULT now(),
  metadata                 jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS phone_reveal_suppression_audit_person_account_idx
  ON public.phone_reveal_suppression_audit
    (provider, provider_person_id_hash, account_id, created_at DESC);

-- Service-role only, same reasoning as the cache table: this is privacy
-- machinery, not application data. No policy for authenticated = no access.

ALTER TABLE public.phone_reveal_suppression_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'phone_reveal_suppression_audit'
      AND policyname = 'service_role_all_phone_reveal_suppression_audit'
  ) THEN
    CREATE POLICY "service_role_all_phone_reveal_suppression_audit"
      ON public.phone_reveal_suppression_audit FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 7. Widen contacts.phone_source with 'apollo_cache' ─────────────
-- A phone reused from the cache must stay distinguishable from a fresh reveal
-- all the way to the official contact. The constraint is replaced by a strictly
-- WIDER version (same values + 'apollo_cache') and stays NOT VALID, so no
-- existing row is re-checked and none can become invalid.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_phone_source_check'
  ) THEN
    ALTER TABLE public.contacts DROP CONSTRAINT contacts_phone_source_check;
  END IF;

  ALTER TABLE public.contacts
    ADD CONSTRAINT contacts_phone_source_check
    CHECK (
      phone_source IS NULL
      OR phone_source IN (
        'apollo_search',
        'apollo_reveal',
        'apollo_cache',
        'lusha_reveal',
        'provider_payload',
        'manual',
        'unknown'
      )
    ) NOT VALID;
END $$;

-- ── 8. Comments ────────────────────────────────────────────────────

COMMENT ON TABLE public.phone_reveal_suppression_audit IS
  'APOLLO-PHONE-CACHE-1b — durable, PII-free audit of phone suppression (DSAR erasure). The Apollo person id is stored only as a SHA-256 hash; the reason is a closed vocabulary; the counts are the rows the database actually reported as updated. No column can hold a phone, email, name or linkedin. Service-role only.';

COMMENT ON COLUMN public.phone_reveal_suppression_audit.provider_person_id_hash IS
  'SHA-256 (hex) of the Apollo person id. Correlates events about the same person without publishing the provider identifier.';

COMMENT ON COLUMN public.phone_reveal_suppression_audit.reason_code IS
  'Closed vocabulary, mirrors phone_reveal_cache.suppression_reason. Free text is deliberately not allowed: a privacy record must not become a copy of the data it erased.';

COMMENT ON COLUMN public.phone_reveal_suppression_audit.tombstone_created IS
  'true when no cache row existed and a phone-free tombstone was inserted, so the DSAR still blocks future cache hits and future automatic reveals.';

COMMENT ON TABLE public.phone_reveal_cache IS
  'APOLLO-PHONE-CACHE-1b — cache of Apollo phone reveals already paid for, keyed by Apollo person id and scoped to ONE account. Reuse policy: TTL 90 days, same account only, same country only, unknown country = no reuse. Suppression is a hard delete of the phone plus a PII-free tombstone that blocks both future cache hits and future automatic reveals. Service-role only; starts empty (no backfill).';

COMMENT ON COLUMN public.phone_reveal_cache.provider_person_id IS
  'Apollo person id (MongoDB ObjectId, 24 hex). Opaque correlation id, NOT PII. Never a Lusha v1.<token> id.';

COMMENT ON COLUMN public.phone_reveal_cache.account_id IS
  'Reuse scope. Same-account only: the unique key includes this column, so an entry can never be served to another account.';

COMMENT ON COLUMN public.phone_reveal_cache.country_code IS
  'ISO-3166-1 alpha-2, uppercase. Reuse scope. NOT NULL by design: a candidate with an unresolvable country is never cached and never matches.';

COMMENT ON COLUMN public.phone_reveal_cache.normalized_phone IS
  'The cached phone number. NULL after suppression (hard delete of the value). Never exposed in logs or audit metadata.';

COMMENT ON COLUMN public.phone_reveal_cache.phone_source IS
  'Provenance of the CACHED value. Constrained to apollo_reveal: only a real, paid reveal is cacheable — a cache hit (apollo_cache) is never written back.';

COMMENT ON COLUMN public.phone_reveal_cache.expires_at IS
  'original_revealed_at + 90 days. An expired entry is a MISS. A cache hit NEVER extends the TTL.';

COMMENT ON COLUMN public.phone_reveal_cache.suppressed_at IS
  'Tombstone timestamp. When set, the phone columns are NULL (CHECK-enforced), the entry can never be served, and automatic reveal for that person/account stays blocked.';
