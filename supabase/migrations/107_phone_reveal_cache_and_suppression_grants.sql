-- Migration 107: table-level privilege hardening of the phone reveal CACHE tables
-- (Agente 2A · AGENT2A-PHONE-WATERFALL-4J)
--
-- SCOPE: the two tables of the Apollo phone cache thread, both created by migration 099 —
--   * public.phone_reveal_cache
--   * public.phone_reveal_suppression_audit
--
-- This is the second and last half of the hole that migration 106 (4H) closed on the
-- waterfall authorization tables. 106 named these two explicitly as out of scope and said
-- they deserved the same treatment in their own migration; this is that migration.
--
-- THE HOLE THIS CLOSES
--
-- Migration 099 enabled RLS on both tables and gave each exactly ONE policy, for
-- `service_role`. That is the control an auditor reads, and it is load-bearing — but it is
-- not the only gate. RLS decides which ROWS a role may touch; the table-level GRANT decides
-- whether the role may touch the table AT ALL. 099 closed only the first.
--
-- Supabase ships `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public GRANT ALL ON TABLES TO
-- anon, authenticated, service_role`, so every table born in `public` starts with the full
-- privilege set for the two browser-reachable roles. The relacl of BOTH tables reads,
-- identically —
--
--   {postgres=arwdDxtm/postgres, anon=arwdDxtm/postgres,
--    authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres}
--
-- PROVENANCE OF THAT SHAPE, stated precisely because the rest of this file leans on it: it
-- comes from the read-only Production audit performed for hito 4H, which checked all FOUR
-- `phone_reveal_*` tables and recorded in the header of migration 106 that these two carry
-- the same dead `anon`/`authenticated` grants with an identical relacl shape. It was NOT
-- re-queried against Production while writing THIS file, and it does not need to be: the
-- migration is declarative. `REVOKE ALL` + an enumerated `GRANT` set an END STATE, so it
-- converges on the same ACL from ANY starting point — which is exactly what the ephemeral
-- PostgreSQL suite proves by re-applying it over four different starting states, including
-- one already hardened and one only partially revoked. If Production has drifted from the
-- shape above, this migration still lands on the intended end state.
--
-- That is SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN for
-- `anon` and `authenticated`. What makes it worse here than on the waterfall tables is WHAT
-- these two hold:
--
--   * `phone_reveal_cache` is the only table in this subsystem that stores a REVEALED PHONE
--     NUMBER in clear (`normalized_phone`). It is the single highest-value PII target of the
--     Agente 2A phone path, and it is the only one of the four with production rows.
--   * `phone_reveal_cache` is ALSO the tombstone store. A suppressed row is what blocks a
--     future cache hit AND a future automatic reveal for that person/account. `TRUNCATE` is
--     not filtered by RLS at all — it is a table-level operation — so a role holding the
--     TRUNCATE grant can empty this table regardless of policies, and emptying it does not
--     merely lose a cache: it ERASES EVERY DSAR TOMBSTONE. The people who asked to be
--     forgotten silently become revealable again, and the next reveal for them is a paid
--     provider call. That is a privacy failure that presents as a cost line.
--   * `phone_reveal_suppression_audit` is the durable proof that an erasure happened. It is
--     the record produced for a data subject request; `TRUNCATE`, `DELETE` or `UPDATE` on it
--     is the ability to rewrite compliance history.
--   * `TRIGGER` on `phone_reveal_cache` is the ability to attach code that runs with the
--     owner's reach on the table holding the phone numbers — i.e. an exfiltration hook.
--   * and a future `CREATE POLICY ... TO authenticated` on either table, however narrow,
--     becomes a live path the moment it exists, because the grant was never the constraint.
--
-- After this migration, reaching either table from the browser requires BOTH a new policy
-- AND a new grant. Neither mistake is sufficient alone.
--
-- WHAT IS GRANTED, AND WHY EXACTLY THAT
--
-- Unlike 106, this migration does NOT give `service_role` a uniform four-privilege envelope.
-- It grants strictly what the call sites demonstrate, table by table. The privilege audit
-- behind each list:
--
-- `phone_reveal_cache` → SELECT, INSERT, UPDATE. No DELETE.
--   * SELECT   — `readPhoneCacheEntry()` and `readPhoneCacheSuppression()`
--                (`phone-cache-store.ts`) read the row directly through PostgREST with the
--                admin client, and `touchPhoneCacheEntry()` reads `hit_count` before
--                incrementing it. The suppression read is the load-bearing one: it runs on
--                EVERY reveal, including with `ENABLE_APOLLO_PHONE_CACHE` off, because a
--                reuse flag must not be able to switch off enforcement of an erasure.
--   * INSERT   — the `.upsert()` in `writePhoneCacheEntry()` and the tombstone-creating
--                `.upsert()` in `suppressPhoneCacheEntryAction()` (the DSAR-on-empty-cache
--                path, which must still block future hits and future automatic reveals).
--   * UPDATE   — the conflict arm of those same upserts, `touchPhoneCacheEntry()`'s
--                `last_used_at`/`hit_count` write, and the suppression tombstone patch that
--                NULLs `normalized_phone`/`phone_type`. Suppression is a hard delete of the
--                VALUE via UPDATE, never a row DELETE: the row has to survive, because the
--                row IS the block.
--   * DELETE   — deliberately NOT granted. There is no `.delete()` against this table
--                anywhere in `src/`, and there cannot sensibly be one: deleting a cache row
--                deletes a tombstone, which un-blocks a suppressed person. The one FK that
--                could remove rows here is `account_id ... ON DELETE CASCADE`, and a
--                cascade is executed by PostgreSQL's referential-integrity machinery with
--                the constraint owner's rights — it does NOT consult this grant. Verified
--                behaviourally against a real PostgreSQL rather than asserted (see
--                `phone-reveal-cache-grants-postgres.test.ts`), because "the cascade still
--                works without DELETE" is exactly the kind of claim that deserves an
--                experiment instead of a comment.
--
-- `phone_reveal_suppression_audit` → SELECT, INSERT. No UPDATE, no DELETE.
--   * INSERT   — `suppressPhoneCacheEntryAction()` writes one row per erasure
--                (`.from(PHONE_CACHE_SUPPRESSION_AUDIT_TABLE).insert(auditRow)`), always
--                attempted, including after a partial failure, so a partial suppression
--                still leaves a trace.
--   * SELECT   — no call site reads this table TODAY, and it is granted anyway. Stated
--                plainly because the rule for this hito is "only what the audit
--                demonstrates" and this is the one deviation: reading a PII-free compliance
--                record is the table's entire purpose. The row set exists to be produced
--                when a data subject or a regulator asks what was erased, and a server that
--                cannot read its own erasure log would fail that request with a permission
--                error. The privilege carries no incremental exposure — the table is
--                PII-free by construction (person id only as SHA-256, closed reason
--                vocabulary, no column able to hold a phone/email/name/linkedin).
--   * UPDATE / DELETE — deliberately NOT granted, and this is the security-meaningful half
--                of the list. An append-only audit trail that the application can rewrite or
--                erase is not an audit trail. No call site needs either, and the absence is
--                the guarantee.
--
-- NOT granted to anybody, on either table:
--
--   * TRUNCATE   — nothing truncates either table, and on `phone_reveal_cache` truncation
--                  is DSAR tombstone erasure that RLS cannot see. `service_role` is revoked
--                  too: it is the role the server authenticates as and the key with the
--                  widest blast radius if it leaks, so it is precisely the role that must
--                  not be able to empty the tombstone store.
--   * REFERENCES — pointing a foreign key AT these tables is a migration-time act by the
--                  owner (`postgres`), never by `service_role`.
--   * TRIGGER    — `phone_reveal_cache` has exactly one trigger, `set_updated_at` from 099,
--                  created by the owner; the audit table has none. The ability to attach one
--                  is the ability to run code with the owner's reach next to the phone
--                  numbers.
--   * MAINTAIN   — VACUUM/ANALYZE/REINDEX are the platform's business, not the app's.
--
-- `postgres` keeps everything: it owns both tables and the `set_updated_at()` trigger
-- function, so its privileges are part of that contract and are untouched here on purpose.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
--   * does NOT change RLS on either table: it stays ENABLED, with the same ONE
--     `service_role` policy each, and `FORCE ROW LEVEL SECURITY` is deliberately NOT
--     enabled (that would additionally subject the OWNER to policies, a separate decision
--     with its own blast radius, not a grant cleanup);
--   * does NOT create, drop or alter any policy — in particular none for `anon` or
--     `authenticated`;
--   * does NOT touch a single row. `phone_reveal_cache` holds production rows (including at
--     least one tombstone-bearing history) and this file neither reads, writes, moves nor
--     expires any of them: zero backfill, zero data migration, zero purge of expired
--     entries;
--   * does NOT alter a table shape, a column, a constraint, an index or a function. The
--     `set_updated_at` trigger of 099 is left exactly as it is;
--   * does NOT touch `phone_reveal_waterfall_runs` or `phone_reveal_credit_reservations`.
--     Those were hardened by 106 and re-applying that work here would make two migrations
--     the owner of one end state;
--   * does NOT change the default privileges of schema `public`, so tables created AFTER
--     this migration are STILL born with the Supabase defaults. That root cause is
--     platform-level debt with repo-wide blast radius and belongs to its own block. What
--     this hito adds instead is a REGRESSION TEST over every `public.phone_reveal_%` table,
--     so a future table in this subsystem cannot inherit the hole unnoticed;
--   * does NOT create or activate a feature flag. `ENABLE_PHONE_REVEAL_WATERFALL` and
--     `ENABLE_APOLLO_PHONE_CACHE` are neither read nor changed here;
--   * does NOT reveal a phone, call Apollo / Lusha / HubSpot, or spend a credit.
--
-- Privacy: PII-free by construction. This file contains no phone, email, name, LinkedIn
-- URL, provider person id, user id or secret — only role names and privilege keywords. In
-- particular it never names a PII-bearing COLUMN: the hardening is table-level, so it has no
-- reason to.
--
-- Safety: REVOKE and GRANT are idempotent and declarative — they set an end state rather
-- than apply a delta — so re-applying converges on the same relacl. Verified against an
-- ephemeral PostgreSQL over the vulnerable Production relacl, a partially revoked state, an
-- already hardened state, and with each table absent. Each table is guarded with
-- `to_regclass` INDEPENDENTLY, so a database that has one but not the other still gets the
-- hardening it can take instead of failing the chain.
--
-- ⚠️ ORDER. Must be applied AFTER 099, which creates both tables it hardens.

-- ═══════════════════════════════════════════════════════════════════
-- 1. public.phone_reveal_cache  (migration 099)
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regclass('public.phone_reveal_cache') IS NULL THEN
    RAISE NOTICE
      'migration 107: public.phone_reveal_cache does not exist; apply migration 099 first. Nothing to harden, exiting cleanly.';
    RETURN;
  END IF;

  -- ── Remove the inherited blanket privileges ──────────────────────
  -- `PUBLIC` is included even though the audited relacl showed no PUBLIC entry: a grant to
  -- PUBLIC reaches every role that exists now or later, so revoking it is the one statement
  -- here whose entire value is in what it PREVENTS.
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_cache FROM PUBLIC';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_cache FROM anon';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_cache FROM authenticated';

  -- `service_role` is revoked TOO, then granted back a shorter list below. This is the
  -- finding 4H paid for in an ephemeral PostgreSQL run: the Supabase default had already
  -- given service_role the full `arwdDxtm` set and `GRANT` only ADDS, so an additive grant
  -- leaves TRUNCATE, REFERENCES and TRIGGER exactly where they were. Revoke-then-grant runs
  -- inside this one block, so there is no window in which the server lacks what it needs.
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_cache FROM service_role';

  -- ── Grant back exactly what the call sites use ───────────────────
  -- Enumerated one privilege at a time rather than `ALL`: this list IS the contract, and
  -- `ALL` would silently re-grant the four privileges the block above exists to remove.
  -- DELETE is absent on purpose — see the audit in the header.
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.phone_reveal_cache TO service_role';

  -- ── Documented end state ─────────────────────────────────────────
  -- Inside the guard, not after it: a bare `COMMENT ON TABLE` would raise 42P01 on a
  -- database where 099 has not been applied, defeating the guard clause above and breaking
  -- the chain on exactly the database the guard exists to protect.
  EXECUTE format(
    'COMMENT ON TABLE public.phone_reveal_cache IS %L',
    $comment$APOLLO-PHONE-CACHE-1b — cache of Apollo phone reveals already paid for, keyed by Apollo person id and scoped to ONE account. Reuse policy: TTL 90 days, same account only, same country only, unknown country = no reuse. Suppression is a hard delete of the phone plus a PII-free tombstone that blocks both future cache hits and future automatic reveals. Service-role only; starts empty (no backfill). HARDENED IN 4J (migration 107): table-level privileges are service_role-only — SELECT/INSERT/UPDATE for service_role, no DELETE (a row deletion here would delete a tombstone and un-block a suppressed person; the account_id cascade is executed by referential integrity, not by this grant), nothing at all for PUBLIC/anon/authenticated, and TRUNCATE/REFERENCES/TRIGGER/MAINTAIN granted to nobody. RLS was never the only gate: TRUNCATE ignores policies entirely, and truncating this table would erase every DSAR tombstone at once. Reaching this table from the browser now requires BOTH a new policy AND a new grant.$comment$
  );
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 2. public.phone_reveal_suppression_audit  (migration 099)
-- ═══════════════════════════════════════════════════════════════════
-- Its own guarded block, not a shared one: the two tables are hardened independently so a
-- database holding only one of them still gets that half, and one shared guard would have
-- skipped both. (099 creates them together, but a guard that only works because of what a
-- sibling migration happens to do is not a guard.)

DO $$
BEGIN
  IF to_regclass('public.phone_reveal_suppression_audit') IS NULL THEN
    RAISE NOTICE
      'migration 107: public.phone_reveal_suppression_audit does not exist; apply migration 099 first. Nothing to harden, exiting cleanly.';
    RETURN;
  END IF;

  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_suppression_audit FROM PUBLIC';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_suppression_audit FROM anon';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_suppression_audit FROM authenticated';

  -- Same revoke-then-grant reason as above. Here the stakes are the shape of the record
  -- itself: an audit trail whose writer can also UPDATE or DELETE rows is not evidence.
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_suppression_audit FROM service_role';

  -- Append-and-read only. UPDATE and DELETE are absent on purpose, and their absence is the
  -- guarantee this table exists to make.
  EXECUTE 'GRANT SELECT, INSERT ON TABLE public.phone_reveal_suppression_audit TO service_role';

  EXECUTE format(
    'COMMENT ON TABLE public.phone_reveal_suppression_audit IS %L',
    $comment$APOLLO-PHONE-CACHE-1b — durable, PII-free audit of phone suppression (DSAR erasure). The Apollo person id is stored only as a SHA-256 hash; the reason is a closed vocabulary; the counts are the rows the database actually reported as updated. No column can hold a phone, email, name or linkedin. Service-role only. HARDENED IN 4J (migration 107): table-level privileges are APPEND-AND-READ ONLY for service_role — SELECT and INSERT, never UPDATE or DELETE, so the application that writes an erasure record cannot rewrite or remove it. Nothing at all for PUBLIC/anon/authenticated, and TRUNCATE/REFERENCES/TRIGGER/MAINTAIN granted to nobody: TRUNCATE ignores RLS and would erase the proof that an erasure happened. Reaching this table from the browser now requires BOTH a new policy AND a new grant.$comment$
  );
END $$;
