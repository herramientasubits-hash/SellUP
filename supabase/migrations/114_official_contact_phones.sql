-- Migration 114: OFFICIAL canonical MULTIPLE-PHONE model for `contacts`
-- (Agente 2A · AGENT2A-PHONE-REVEAL-4O-H1)
--
-- ═══════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS
-- ═══════════════════════════════════════════════════════════════════
--
-- Migration 109 gave the CANDIDATE a phone collection. The official contact never got one.
-- The 4O-H0 audit asked whether the candidate tables could simply BE the durable store and
-- concluded they cannot, for five reasons that are properties of the identity, not of the
-- code:
--
--   * `candidate_id` is the wrong official identity — the official record is the contact;
--   * two candidates that resolve to the SAME person orphan a paid phone collection under
--     whichever candidate row lost;
--   * a phone typed by a human on the contact form has NO candidate at all, so it could
--     never be represented;
--   * the candidate tables are service-role-only by construction (109), while the official
--     phone surfaces are client-reachable;
--   * cross-provider provenance needs ONE canonical row and N sources — which 109 models
--     correctly, and which is the one part worth carrying over verbatim.
--
-- So this migration creates the official pair, shaped after 109 where 109 was right and
-- deliberately different where the official identity demands it:
--
--   contact_phones          — ONE row per distinct number per CONTACT
--   contact_phone_sources   — N rows per number, one per observation
--
-- ═══════════════════════════════════════════════════════════════════
-- WHAT THIS BLOCK DOES **NOT** DO
-- ═══════════════════════════════════════════════════════════════════
--
-- H1 creates SHAPE ONLY. After it lands, both tables are EMPTY in every environment and the
-- visible behaviour of the product is byte-for-byte what it was before:
--
--   runtime writers            0        approval propagation      0
--   runtime readers            0        backfill                  0
--   UI                         0        provider calls            0
--   RPCs / functions           0        credits                   0
--   triggers (business logic)  0        Production apply           NO (see header below)
--
-- `contacts.phone` remains the visible source of truth for the primary phone, exactly as it
-- is today. `contacts.mobile_phone` is untouched and stays a transitional legacy scalar
-- (4O-H0 decision; convergence belongs to H5). There is deliberately NO trigger syncing the
-- collection into either scalar: that reconciliation is a transactional invariant and
-- belongs to the H3 writer, not to a trigger that would make it a live runtime behaviour
-- this block is not authorized to add.
--
-- ═══════════════════════════════════════════════════════════════════
-- THE ONE PLACE THIS DIVERGES FROM 109, AND WHY
-- ═══════════════════════════════════════════════════════════════════
--
-- 109's source table is APPEND-AND-READ-ONLY: the service role holds SELECT and INSERT and
-- nothing else, and migration 112 states plainly that a suppression does not touch a single
-- provenance row. That is coherent for the candidate, because candidate suppression is
-- per-NUMBER: the whole number is tombstoned regardless of how many providers observed it.
--
-- The official record cannot stop there. `SUPPRESSIBLE_CONTACT_PHONE_SOURCES`
-- (`phone-cache-suppression-core.ts`, 4O-E4) already makes official erasure
-- PROVIDER-SPECIFIC: whether `contacts.phone` may be cleared at all depends on which
-- provider's reveal wrote it, and `manual` / `apollo_search` / `provider_payload` /
-- `unknown` are explicitly out of reach because erasing them would destroy curated data the
-- subsystem never wrote. Carry that forward to a collection with N sources per number and
-- the required operation is: withdraw the Apollo observation, leave the Lusha one standing,
-- and tombstone the number ONLY when the last source justifying it is gone.
--
-- Under 109's exact privileges that operation is unrepresentable — it would need either a
-- DELETE grant on provenance (which 4O-H0 rules out, and which would destroy the evidence
-- the privacy operation has to be able to show afterwards) or new columns added in H2 (which
-- § 29 of this block's contract forbids). So the ADAPTATION is:
--
--   a source row gets the SAME suppression triad the canonical row already has, and
--   withdrawal is an UPDATE that tombstones the observation instead of deleting it.
--
-- The row survives as evidence that the observation happened and which operation paid for
-- it; what it stops doing is JUSTIFYING a live number. No new vocabulary is invented — the
-- triad reuses 109's `data_subject_request / operator_request / provider_retraction`
-- verbatim, and `provider_retraction` is precisely the per-provider case that had nowhere to
-- live before.
--
-- Provenance is still not rewritable, and that is enforced by a PRIVILEGE rather than by an
-- intention: the service role receives COLUMN-LEVEL `UPDATE (suppressed_at,
-- suppression_reason, suppressed_by)` and nothing more. `provider`, `acquisition_mode`, the
-- raw provider labels, the audit pointers, `source_event_key` and `observed_at` are
-- immutable to every role in the database. An observation that turns out to be wrong is
-- still corrected by recording the later observation, never by editing the earlier one.
--
-- DELETE remains granted to NOBODY on both tables.
--
-- ═══════════════════════════════════════════════════════════════════
-- WHAT DOES **NOT** LIVE HERE: MONEY
-- ═══════════════════════════════════════════════════════════════════
--
-- Same rule as 109, restated because it is the one a future block is most likely to break.
-- There is NO cost, credit, price or spend column on either table. Splitting a reveal's
-- credits across the numbers it returned would invent a per-number price nobody charged and
-- produce a second, competing set of books. The accounting stays where it already is and
-- remains the only truth:
--
--   phone_reveal_waterfall_runs · phone_reveal_credit_reservations · provider_usage_logs
--
-- The source table carries NULLABLE pointers to those rows so a number can be traced back to
-- the operation that paid for it — which is the opposite of restating the amount.
--
-- ═══════════════════════════════════════════════════════════════════
-- NO `account_id`
-- ═══════════════════════════════════════════════════════════════════
--
-- `contacts.account_id` already defines ownership, and `contact_phones` reaches it through
-- `contact_id`. A second copy would be a column that can DISAGREE with the contact it hangs
-- off — a divergence that would then have to be reconciled by something, and whose only
-- possible resolution is "believe the contact". Storing it is therefore strictly worse than
-- deriving it.
--
-- ═══════════════════════════════════════════════════════════════════
-- PRIVACY — WHY `dedupe_key` IS A HASH, AND WHAT THAT DOES NOT BUY
-- ═══════════════════════════════════════════════════════════════════
--
-- Identical to 109, and load-bearing for the same reason. `dedupe_key` is a SHA-256 prefixed
-- with the KIND of key (`e164:` / `digits:` / `opaque:`) and never contains the number. That
-- matters precisely because of the tombstone: a suppressed row must KEEP its key (the key is
-- the UNIQUE that stops the number being re-inserted) while NOT keeping the number. With a
-- plaintext key, `normalized_phone = NULL` would be theatre.
--
-- Stated rather than glossed: the phone number space is small, so an unsalted SHA-256 is
-- brute-forceable by anyone who already holds the row. The hash is NOT a cryptographic
-- control against an attacker holding the table; it is what stops a suppressed number from
-- remaining stored IN CLEAR. RLS and the table-level privileges are what keep the rows out
-- of reach in the first place.
--
-- The key is produced by ONE algorithm, `normalizeCandidatePhone()` in
-- `phone-collection-core.ts`, and this migration adds no second one. A second normalizer
-- would mean the same number hashing to two different keys depending on which writer saw it,
-- which is the deduplication failing silently and the tombstone failing with it. H1 declares
-- the column and its constraints; it does not compute a key, because it has no writer.
--
-- ═══════════════════════════════════════════════════════════════════
-- `source_event_key` — OFFICIAL SEMANTICS
-- ═══════════════════════════════════════════════════════════════════
--
-- 4O-H0 concluded that the staging key must not simply be copied: the candidate key is the
-- idempotency identity of a STAGING observation, and reusing it verbatim would make the
-- official row's identity depend on which candidate happened to carry the observation —
-- exactly the coupling this table exists to break.
--
-- The official contract, for the H3 writer to implement:
--
--   * deterministic and PII-FREE by construction, like the candidate key: closed
--     vocabularies (`provider`, `acquisition_mode`), the operation phase, and SellUp's OWN
--     opaque row ids (waterfall run / reservation / usage log). Never the number, the email,
--     the name, the LinkedIn, or any provider-side person id;
--   * `observed_at` is deliberately EXCLUDED, so reprocessing the same webhook with a fresh
--     clock recognises the same observation instead of appending a second row;
--   * scoped by `contact_phone_id` through the UNIQUE below, so the same operation observed
--     against two different numbers is two rows, as it should be;
--   * where a candidate observation is being promoted, the key must be derived from the
--     OPERATION that produced it, not from the candidate row id — a candidate id in the key
--     would make the same paid observation promote twice under two candidates.
--
-- H1 declares the column, the UNIQUE and this contract. It does NOT add the generator: that
-- is runtime, and runtime belongs to H3.
--
-- ═══════════════════════════════════════════════════════════════════
-- HISTORY IS NOT BACKFILLED
-- ═══════════════════════════════════════════════════════════════════
--
-- Zero backfill, and not for convenience. `contacts.phone_source` is NULL on historical rows
-- and 4O-H0.5 fixed that only going FORWARD: a NULL means "unknown provenance" and must
-- never be read as `manual`. Promoting historical scalars into canonical rows would
-- therefore mean asserting a provenance nobody recorded, in the exact table whose purpose is
-- to make provenance demonstrable. `contacts.mobile_phone` is worse still: it has no
-- provenance column of its own at all (4O-E4.1). So both scalars stay where they are, and
-- the collection starts empty and fills only from the moment an authorized writer exists.
--
-- ⚠️ NOT APPLIED. This migration has NOT been applied to any remote Supabase project. It is
-- a repo-only draft, exactly as 109 was at its own hito.
--   APPLIED IN PRODUCTION: NO
--
-- Idempotent: CREATE TABLE / INDEX use IF NOT EXISTS, the policies are guarded, and the
-- REVOKE/GRANT block is declarative (it sets an end state, so re-applying converges).

-- ═══════════════════════════════════════════════════════════════════
-- 1. Canonical phones — ONE row per distinct number per CONTACT
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.contact_phones (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The OFFICIAL identity: the contact, never the candidate. CASCADE because a deleted
  -- contact has no phone collection worth keeping, and leaving orphan rows would be leaving
  -- orphan PII. Note this is contact LIFECYCLE deletion, which is a different operation from
  -- phone PRIVACY suppression: the latter is a tombstone and never deletes a row.
  contact_id         uuid        NOT NULL
    REFERENCES public.contacts(id) ON DELETE CASCADE,

  -- Conservative canonical form. E.164 (`+…`) ONLY when the input carried a verifiable
  -- international prefix; otherwise the national digits AS GIVEN, with no fabricated country
  -- code. NULL only for a tombstone or an entry with no usable digits.
  normalized_phone   text        NULL,
  -- The number as it was formatted for display. NULL in a tombstone.
  display_phone      text        NULL,

  -- SHA-256 of the canonical form, prefixed with the key kind. NEVER the number itself.
  -- Survives suppression: it is what keeps a suppressed number from being re-inserted.
  dedupe_key         text        NOT NULL,

  -- The SAME canonical vocabulary as `PhoneType` in phone-classification.ts, 109 and the
  -- `contacts_phone_type_check` of 094. No new member, and deliberately NOT the colloquial
  -- `home` / `office` / `business` / `personal` set: a fourth spelling of the same idea is
  -- how two columns with the same name end up holding different values.
  -- NULL in a tombstone: suppression erases the type along with the number.
  phone_type         text        NULL
    CONSTRAINT contact_phones_phone_type_check
    CHECK (phone_type IS NULL OR phone_type IN (
      'personal_mobile', 'mobile', 'direct_dial', 'work', 'hq', 'other', 'unknown'
    )),

  -- Closed, minimal vocabulary. `unknown` is the ABSENCE of evidence and must stay
  -- distinguishable from a provider ASSERTING the number is invalid.
  phone_status       text        NOT NULL DEFAULT 'unknown'
    CONSTRAINT contact_phones_phone_status_check
    CHECK (phone_status IN ('valid', 'invalid', 'unknown')),

  -- Exactly one live primary per contact; enforced by the partial unique index below, not by
  -- this default.
  is_primary         boolean     NOT NULL DEFAULT false,

  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),

  -- ── Suppression (tombstone) ─────────────────────────────────────
  -- The row SURVIVES suppression without the number. Deleting it instead would un-block the
  -- number: the next observation would re-insert it as if nothing had been erased.
  suppressed_at      timestamptz NULL,
  -- 109's vocabulary verbatim — WHO exercised the erasure. Deliberately NOT the
  -- cache/audit vocabulary of 099 (`dsar_erasure_request` / `do_not_contact_request` /
  -- `legal_privacy_request` / `admin_privacy_correction` / `test_synthetic`), which records
  -- WHY it was requested. The two sets share zero values; 112 already owns the exhaustive
  -- translation between them and a pass-through is unrepresentable there.
  suppression_reason text        NULL
    CONSTRAINT contact_phones_suppression_reason_check
    CHECK (suppression_reason IS NULL OR suppression_reason IN (
      'data_subject_request', 'operator_request', 'provider_retraction'
    )),
  -- internal_users.id of the operator. NOT a FK: an erasure record must survive user-row
  -- churn. Opaque id, no PII.
  suppressed_by      uuid        NULL,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- One canonical row per number per contact. This is what makes "same number from Apollo
  -- and Lusha" collapse into one row with two provenances instead of two rows. It is ALSO
  -- the durable identity that survives a tombstone and blocks re-insertion.
  CONSTRAINT contact_phones_contact_dedupe_key_unique
    UNIQUE (contact_id, dedupe_key),

  -- A primary must be live, have a number, and not be asserted invalid. Same predicate as
  -- 109 and as `isCandidatePhoneEligibleForPrimary()`, so a pure chooser can never elect a
  -- row the database would then reject.
  CONSTRAINT contact_phones_primary_requires_live_number
    CHECK (
      is_primary = false
      OR (
        suppressed_at IS NULL
        AND normalized_phone IS NOT NULL
        AND phone_status <> 'invalid'
      )
    ),

  -- A tombstone keeps the key and loses everything that identifies the person. Without this
  -- CHECK, "suppressed" would be a flag someone could set while leaving the number in place.
  CONSTRAINT contact_phones_tombstone_is_empty
    CHECK (
      suppressed_at IS NULL
      OR (
        normalized_phone IS NULL
        AND display_phone IS NULL
        AND phone_type IS NULL
        AND is_primary = false
      )
    ),

  -- The triad is coherent in both directions: no reason or actor without a suppression, and
  -- no suppression without a reason. Prevents a half-written erasure from looking like a
  -- live row that merely names an actor.
  CONSTRAINT contact_phones_suppression_triad_coherent
    CHECK (
      (suppressed_at IS NULL AND suppression_reason IS NULL AND suppressed_by IS NULL)
      OR (suppressed_at IS NOT NULL AND suppression_reason IS NOT NULL)
    )
);

-- Exactly ONE primary per contact. A partial UNIQUE index rather than a constraint because
-- the uniqueness applies only to the `true` rows: a contact may have many non-primary
-- numbers, and a contact with no live number legitimately has no primary at all.
CREATE UNIQUE INDEX IF NOT EXISTS contact_phones_one_primary_idx
  ON public.contact_phones (contact_id)
  WHERE is_primary;

-- The live collection of one contact — the read H4 ("Ver más números", official) performs
-- and the read H2 re-elects a primary from. Partial rather than plain because every one of
-- those queries filters tombstones out, and because `contact_phones_contact_dedupe_key_unique`
-- already covers unfiltered `contact_id` lookups as its leading column.
CREATE INDEX IF NOT EXISTS contact_phones_contact_live_idx
  ON public.contact_phones (contact_id)
  WHERE suppressed_at IS NULL;

-- Reuses set_updated_at() from migration 038, exactly as 099 and 109 do. This is the repo's
-- timestamp convention and NOT a business invariant: nothing about primary election, scalar
-- synchronisation or tombstone propagation happens in a trigger in this migration.
DROP TRIGGER IF EXISTS contact_phones_set_updated_at ON public.contact_phones;
CREATE TRIGGER contact_phones_set_updated_at
  BEFORE UPDATE ON public.contact_phones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════
-- 2. Provenance — N observations per canonical phone
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.contact_phone_sources (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  contact_phone_id      uuid        NOT NULL
    REFERENCES public.contact_phones(id) ON DELETE CASCADE,

  -- PROVIDER IDENTITY, and only that. 109's vocabulary verbatim.
  --
  -- Deliberately NOT the legacy scalar vocabulary of `contacts.phone_source`
  -- (`apollo_search` / `apollo_reveal` / `lusha_reveal` / `provider_payload` / `manual` /
  -- `unknown`), which fuses provider and acquisition into one string. That fusion is what
  -- makes "which provider observed this" unanswerable without parsing, and it is already
  -- DERIVABLE from the pair below — migration 112 contains the exhaustive mapping
  -- (apollo+reveal|waterfall → apollo_reveal, apollo+search → apollo_search, lusha →
  -- lusha_reveal, apollo_cache → apollo_cache, manual → manual, else unknown). Deriving the
  -- legacy value from the pair is lossless; recovering the pair from the legacy value is not.
  provider              text        NOT NULL
    CONSTRAINT contact_phone_sources_provider_check
    CHECK (provider IN ('apollo', 'lusha', 'apollo_cache', 'manual', 'unknown')),

  -- HOW it was acquired — the second, orthogonal dimension. 109's vocabulary verbatim.
  -- `manual` is admitted here from day one so H5 can record a human-entered number without a
  -- migration; H1 inserts no such row.
  acquisition_mode      text        NOT NULL
    CONSTRAINT contact_phone_sources_acquisition_mode_check
    CHECK (acquisition_mode IN ('search', 'reveal', 'waterfall', 'cache', 'manual')),

  -- The provider's OWN words, kept verbatim and never normalised away. This is what makes a
  -- disagreement between two providers about the same number reconstructable later, and it
  -- is where `contacts.phone_raw_type` (094) gets its value from on promotion.
  raw_provider_type     text        NULL,
  raw_provider_status   text        NULL,

  -- Pointers to the accounting rows. SET NULL rather than CASCADE: losing the operation
  -- record must not silently delete the evidence that the number was observed.
  waterfall_run_id      uuid        NULL
    REFERENCES public.phone_reveal_waterfall_runs(id) ON DELETE SET NULL,
  reservation_id        uuid        NULL
    REFERENCES public.phone_reveal_credit_reservations(id) ON DELETE SET NULL,
  provider_usage_log_id uuid        NULL
    REFERENCES public.provider_usage_logs(id) ON DELETE SET NULL,

  -- Audit pointer to the staging row this observation was promoted FROM, when there was one
  -- (a manually entered number has none). SET NULL and never CASCADE, and this is the whole
  -- point: the official row must survive staging being purged. Ownership of an official
  -- phone is `contact_id` on the parent and NOTHING here — if this column were load-bearing,
  -- deleting a candidate would silently orphan a number the operator paid for, which is one
  -- of the five defects 4O-H0 rejected the staging-as-store design over.
  candidate_phone_id    uuid        NULL
    REFERENCES public.contact_enrichment_candidate_phones(id) ON DELETE SET NULL,

  -- Deterministic, idempotent, PII-FREE identity of the observation. See the header for the
  -- official semantics H3 must implement.
  source_event_key      text        NOT NULL,

  -- When the observation happened, which is NOT when the row was written: a webhook
  -- processed late, or a candidate observation promoted days after the reveal, has an
  -- `observed_at` in the past and a `created_at` of now. Both are kept because ranking
  -- provenance by the wrong one would prefer the most recently PROMOTED over the most
  -- recently OBSERVED.
  observed_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),

  -- ── Withdrawal (source-level tombstone) ─────────────────────────
  -- The ADAPTATION over 109 argued in the header. A withdrawn source keeps every provenance
  -- fact and stops justifying a live number; it is never deleted, because the row is the
  -- evidence the observation happened and which operation paid for it. Vocabulary is 109's,
  -- unchanged — `provider_retraction` is exactly the per-provider case that had nowhere to
  -- live while suppression could only be per-number.
  --
  -- What H2 will read: a canonical row whose sources are ALL withdrawn has nothing left
  -- justifying it and becomes a tombstone. That is a cross-row invariant, so it is NOT a
  -- CHECK here — it belongs to H2's transactional RPC, not to a constraint that would have
  -- to be violated for one statement in the middle of every legitimate erasure.
  suppressed_at         timestamptz NULL,
  suppression_reason    text        NULL
    CONSTRAINT contact_phone_sources_suppression_reason_check
    CHECK (suppression_reason IS NULL OR suppression_reason IN (
      'data_subject_request', 'operator_request', 'provider_retraction'
    )),
  suppressed_by         uuid        NULL,

  -- Same coherence rule as the canonical row, for the same reason.
  CONSTRAINT contact_phone_sources_suppression_triad_coherent
    CHECK (
      (suppressed_at IS NULL AND suppression_reason IS NULL AND suppressed_by IS NULL)
      OR (suppressed_at IS NOT NULL AND suppression_reason IS NOT NULL)
    ),

  -- Same observation recorded twice ⇒ one row. This is the idempotency guarantee, and its
  -- leading column also serves every `contact_phone_id` lookup — which is why NO separate
  -- plain index on `contact_phone_id` is created here. 109 has one; it is redundant with its
  -- own UNIQUE, and copying a redundant index is not the same as reproducing a design.
  CONSTRAINT contact_phone_sources_event_key_unique
    UNIQUE (contact_phone_id, source_event_key)
);

-- The LIVE sources of one number. This is the query H2 runs on every erasure to decide
-- whether anything still justifies the number, so it is the one access path that earns its
-- own partial index. No index on `provider`: nothing filters by provider alone — H2 reaches
-- the sources through the phone and then inspects the provider on the handful of rows it
-- found.
CREATE INDEX IF NOT EXISTS contact_phone_sources_phone_live_idx
  ON public.contact_phone_sources (contact_phone_id)
  WHERE suppressed_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 3. RLS + table-level privilege hardening
-- ═══════════════════════════════════════════════════════════════════
-- Applied HERE, in the same migration that creates the tables, rather than in a later
-- cleanup — the mistake 106 and 107 had to come back and fix on four existing tables.
--
-- The reason it cannot wait: Supabase ships
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated,
--   service_role
-- so EVERY table born in `public` starts with the full eight-privilege set for both
-- browser-reachable roles. "RLS on + one policy" is NOT sufficient: RLS decides which ROWS a
-- role may touch, the table-level GRANT decides whether it may touch the table AT ALL, and
-- TRUNCATE is not filtered by RLS in any way. These two tables hold phone numbers and their
-- tombstones, so they are hardened at birth.
--
-- WHERE THIS DIVERGES FROM 109: the candidate tables are service-role-only because nothing
-- client-side ever reaches them. The official collection is different — H4 renders it in the
-- contact UI — so `authenticated` gets SELECT and NOTHING else. It cannot INSERT, UPDATE or
-- DELETE: a browser must never be able to declare provenance, and "this number came from
-- Lusha" asserted by a client is not provenance, it is an unverified claim about money that
-- was spent.
--
-- `GRANT` only ADDS, so every role is REVOKED first and then granted a shorter list.
-- Revoke-then-grant runs inside one block: there is no window in which the server lacks what
-- it needs.
--
-- `FORCE ROW LEVEL SECURITY` is deliberately NOT set, matching the explicit choice recorded
-- in 106 and 107: it would apply RLS to the table OWNER as well, which is the role that runs
-- migrations, and the repo's convention is to keep owner-side maintenance unblocked.

ALTER TABLE public.contact_phones        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_phone_sources ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- ── service_role: the server, under the grant ceiling below ─────
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'contact_phones'
      AND policyname = 'contact_phones_service_role'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY contact_phones_service_role
        ON public.contact_phones
        FOR ALL TO service_role USING (true) WITH CHECK (true)
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'contact_phone_sources'
      AND policyname = 'contact_phone_sources_service_role'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY contact_phone_sources_service_role
        ON public.contact_phone_sources
        FOR ALL TO service_role USING (true) WITH CHECK (true)
    $policy$;
  END IF;

  -- ── authenticated: SELECT, and never wider than `contacts` ──────
  --
  -- The predicate is DERIVED from the parent rather than copied from it. `contacts` today
  -- admits any active internal user (`has_active_access(auth.uid())`, migration 039), so a
  -- literal copy would be equivalent — right now. It would also be a second, independent
  -- statement of who may read a contact, and the two would silently disagree the day
  -- `contacts` gains per-account scoping: the phone would stay readable after the contact
  -- it belongs to stopped being. The EXISTS makes that impossible by construction.
  --
  -- Belt and braces on purpose: PostgreSQL applies the referenced table's own RLS inside a
  -- policy subquery, so the EXISTS already inherits whatever `contacts` enforces; the
  -- explicit `has_active_access` means the policy is still correct if RLS on `contacts` were
  -- ever disabled.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'contact_phones'
      AND policyname = 'active_users_can_read_contact_phones'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY active_users_can_read_contact_phones
        ON public.contact_phones
        FOR SELECT TO authenticated
        USING (
          has_active_access(auth.uid())
          AND EXISTS (
            SELECT 1 FROM public.contacts c
            WHERE c.id = public.contact_phones.contact_id
              AND has_active_access(auth.uid())
          )
        )
    $policy$;
  END IF;

  -- Provenance of a number the reader cannot see must not be visible either, so the chain
  -- is walked in full: source → phone → contact. Nothing is exposed at one hop that would
  -- be denied at the next.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'contact_phone_sources'
      AND policyname = 'active_users_can_read_contact_phone_sources'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY active_users_can_read_contact_phone_sources
        ON public.contact_phone_sources
        FOR SELECT TO authenticated
        USING (
          has_active_access(auth.uid())
          AND EXISTS (
            SELECT 1
            FROM public.contact_phones p
            JOIN public.contacts c ON c.id = p.contact_id
            WHERE p.id = public.contact_phone_sources.contact_phone_id
              AND has_active_access(auth.uid())
          )
        )
    $policy$;
  END IF;
END $$;

DO $$
BEGIN
  -- ── contact_phones ─────────────────────────────────────────────
  -- `PUBLIC` is revoked too: a grant to PUBLIC reaches every role that exists now or later,
  -- so revoking it is the statement whose whole value is in what it PREVENTS.
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.contact_phones FROM PUBLIC';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.contact_phones FROM anon';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.contact_phones FROM authenticated';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.contact_phones FROM service_role';

  -- Read-only for the browser, filtered by the policy above.
  EXECUTE 'GRANT SELECT ON TABLE public.contact_phones TO authenticated';

  -- SELECT / INSERT / UPDATE, and NO DELETE.
  --
  -- Honest framing, because the 106/107 rule is "grant only what the call sites demonstrate"
  -- and H1 has ZERO call sites by design: this is the envelope the MODEL requires, not a set
  -- of observed usages. SELECT to read the collection; INSERT to add a newly observed
  -- number; UPDATE for `last_seen_at`, for `is_primary` re-election, and for the suppression
  -- patch that NULLs the number.
  --
  -- DELETE is withheld for the same reason 107 withholds it on `phone_reveal_cache` and 109
  -- on the candidate collection: suppression is a hard delete of the VALUE via UPDATE, never
  -- a row DELETE, because the row IS the block. Deleting a tombstone would let a suppressed
  -- number be re-inserted by the next observation as though the erasure had never happened.
  -- The one path that can still remove rows is the `contact_id` CASCADE, which referential
  -- integrity executes with the constraint owner's rights and does NOT consult this grant.
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.contact_phones TO service_role';

  -- ── contact_phone_sources ──────────────────────────────────────
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.contact_phone_sources FROM PUBLIC';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.contact_phone_sources FROM anon';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.contact_phone_sources FROM authenticated';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.contact_phone_sources FROM service_role';

  EXECUTE 'GRANT SELECT ON TABLE public.contact_phone_sources TO authenticated';

  -- APPEND, READ, and WITHDRAW — nothing else.
  --
  -- The UPDATE is COLUMN-LEVEL and that is the entire mechanism protecting provenance. Only
  -- the suppression triad is writable; `provider`, `acquisition_mode`, `raw_provider_type`,
  -- `raw_provider_status`, the three accounting pointers, `candidate_phone_id`,
  -- `source_event_key`, `observed_at` and `created_at` are immutable to EVERY role in the
  -- database, so "provenance cannot be rewritten" is a privilege the server does not hold
  -- rather than a rule a writer is trusted to follow. An observation that turns out to be
  -- wrong is corrected by recording the later observation.
  --
  -- DELETE is granted to nobody: withdrawal is a tombstone, and a deleted source row is
  -- evidence destroyed in the one operation that most needs to be auditable afterwards.
  EXECUTE 'GRANT SELECT, INSERT ON TABLE public.contact_phone_sources TO service_role';
  EXECUTE 'GRANT UPDATE (suppressed_at, suppression_reason, suppressed_by) '
       || 'ON TABLE public.contact_phone_sources TO service_role';

  -- NOT granted to anybody on either table: TRUNCATE (ignores RLS entirely and would erase
  -- every tombstone at once, silently making suppressed numbers storable again — a privacy
  -- failure that would then present as a cost line), REFERENCES (pointing an FK at these is
  -- a migration-time act by the owner), TRIGGER (the ability to attach code running with the
  -- owner's reach next to the phone numbers, i.e. an exfiltration hook), and MAINTAIN.
END $$;

COMMENT ON TABLE public.contact_phones IS
  'AGENT2A-PHONE-REVEAL-4O-H1 — OFFICIAL canonical collection of MULTIPLE phone numbers per contact: one row per distinct number, deduplicated by a SHA-256 dedupe_key that never contains the number. Keyed on contacts.id and NOT on a candidate, because a candidate is staging: two candidates resolving to the same person would orphan a paid collection, and a manually typed number has no candidate at all. No account_id: contacts.account_id already defines ownership and a second copy could only ever disagree. Suppression is a tombstone — the row survives without the number, which is what blocks re-insertion — enforced by CHECK. Holds NO cost or credit column on purpose: the accounting stays in phone_reveal_waterfall_runs / phone_reveal_credit_reservations / provider_usage_logs. Starts EMPTY with zero backfill: contacts.phone_source is NULL on historical rows (unknown provenance, never manual) and contacts.mobile_phone has no provenance column at all, so promoting either would assert a provenance nobody recorded. Not yet consumed by any runtime path; contacts.phone remains the visible primary until H3. authenticated: SELECT only, and never wider than the parent contact. service_role: SELECT/INSERT/UPDATE, no DELETE (deleting a row deletes a tombstone). Nothing for PUBLIC/anon; TRUNCATE/REFERENCES/TRIGGER/MAINTAIN granted to nobody.';

COMMENT ON TABLE public.contact_phone_sources IS
  'AGENT2A-PHONE-REVEAL-4O-H1 — provenance of each official contact phone, many per number, so the SAME number observed by BOTH Apollo and Lusha is one canonical row with TWO provenances instead of a duplicated number or a discarded provider. provider and acquisition_mode are kept as SEPARATE dimensions (109 vocabularies) rather than fused into the legacy contacts.phone_source string: the legacy value is derivable from the pair by the exhaustive mapping in migration 112, and the reverse is not. Keeps each provider raw type/status verbatim and points at the run / reservation / usage log that paid for the observation WITHOUT restating any amount, plus a nullable SET NULL pointer to the staging row it was promoted from — audit only, never ownership. source_event_key is deterministic, idempotent and PII-free, excludes observed_at so a reprocessed webhook does not append a duplicate, and must NOT be the staging key verbatim (that key identifies a staging observation, and reusing it would couple the official row to whichever candidate carried it). Withdrawal is a source-level TOMBSTONE, never a DELETE: a withdrawn source keeps every provenance fact and stops justifying a live number, which is what makes provider-specific erasure representable without destroying the evidence the erasure has to be able to show. Provenance is immutable by PRIVILEGE, not by intention: service_role holds SELECT/INSERT plus COLUMN-LEVEL UPDATE on the suppression triad only. authenticated: SELECT only, gated on the parent phone AND the parent contact. Nothing for PUBLIC/anon; DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN granted to nobody.';
