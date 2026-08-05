-- Migration 105: table-level privilege hardening of the phone reveal waterfall tables
-- (Agente 2A · AGENT2A-PHONE-WATERFALL-4H)
--
-- SCOPE: the two tables of the waterfall authorization path —
--   * public.phone_reveal_credit_reservations  (migration 104)
--   * public.phone_reveal_waterfall_runs       (migration 102)
--
-- THE HOLE THIS CLOSES
--
-- Migrations 102 and 104 each enabled RLS on their table and gave it exactly ONE policy,
-- for `service_role`. That is the control everybody reads when auditing these tables, and
-- it is genuinely load-bearing. What it is NOT is the only layer: RLS decides which ROWS a
-- role may touch, and the table-level GRANT decides whether the role may touch the table AT
-- ALL. Those are two different gates, and 102/104 only closed one of them.
--
-- Supabase ships `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public GRANT ALL ON TABLES TO
-- anon, authenticated, service_role`, so every table created in `public` is born with the
-- full privilege set for the two browser-reachable roles. Verified in Production before
-- this migration was written — the relacl of BOTH tables read, identically:
--
--   {postgres=arwdDxtm/postgres, anon=arwdDxtm/postgres,
--    authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres}
--
-- That is SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN
-- granted to `anon` and to `authenticated` on two tables whose contents are pure
-- authorization accounting. Today the only thing standing between the anon key and that
-- privilege set is the absence of a permissive policy. That means:
--
--   * a future `CREATE POLICY ... TO authenticated` on either table — however narrow, and
--     however well intentioned — instantly becomes a write path, because the underlying
--     grant was never the constraint;
--   * `TRUNCATE` is not filtered by RLS AT ALL. It is a table-level operation, so a role
--     holding the TRUNCATE grant can empty the table regardless of policies. On these two
--     tables that is not data loss in the ordinary sense:
--       – on `phone_reveal_credit_reservations`, every `reserved` row is exposure occupying
--         provider availability, so deleting them all silently returns the entire in-flight
--         budget and re-opens the double-spend hole 104 exists to close;
--       – on `phone_reveal_waterfall_runs`, the `lusha_attempted_at` claim is what makes
--         the Lusha leg run AT MOST ONCE across webhook / recovery cron / manual review.
--         Erasing the runs erases the claims, so every one of those three paths would read
--         an unclaimed authorization and could pay for the same Lusha leg again.
--   * `TRIGGER` lets the grantee attach code that runs with the table owner's reach.
--
-- Defence in depth is the whole point: after this migration, reaching either table from the
-- browser requires BOTH a new policy AND a new grant. Neither mistake is sufficient alone.
--
-- WHAT IS GRANTED, AND WHY EXACTLY THAT
--
-- `service_role` gets SELECT, INSERT, UPDATE, DELETE on both tables and nothing else.
-- Verified against the call sites:
--
--   * `phone_reveal_credit_reservations` (`phone-reveal-credit-reservation-deps.ts`)
--     – SELECT is load-bearing: `findActivePhoneRevealCreditReservations()` reads the table
--       DIRECTLY through PostgREST with the admin client, so its absence would break
--       reconciliation.
--     – INSERT / UPDATE / DELETE: the three write paths in production all go through the
--       SECURITY DEFINER functions of 104, which execute as their owner (`postgres`) and
--       therefore do not consult this grant at all.
--   * `phone_reveal_waterfall_runs` (`phone-reveal-waterfall-deps.ts`)
--     – SELECT, INSERT and UPDATE are all load-bearing and all go DIRECTLY through
--       PostgREST with the admin client: the run is read, created and patched by
--       `.from(PHONE_REVEAL_WATERFALL_RUNS_TABLE)` calls, not by a definer function.
--     – DELETE is not exercised by any call site today.
--
-- The three privileges that are granted without a current call site (INSERT/UPDATE/DELETE on
-- the reservations table, DELETE on the runs table) are inside the approved `service_role`
-- envelope on purpose, and the reason is uniformity: leaving a write surface that only works
-- by virtue of a definer function is a shape where removing or renaming a function turns
-- into a permission mystery rather than a clear failure. What matters for this hardening is
-- the four privileges that are NOT in that envelope, below.
--
-- NOT granted to anybody, deliberately:
--
--   * TRUNCATE   — nothing truncates either table. They are audit trails of authorizations,
--                  and the one operation that could erase in-flight exposure (or the
--                  at-most-once Lusha claims) wholesale is the one no application role
--                  should hold.
--   * REFERENCES — creating a foreign key that points AT these tables is a migration-time
--                  act performed by the owner (`postgres`), never by `service_role`. The
--                  existing FKs (from `contact_enrichment_candidates` and between the two
--                  tables themselves) were created exactly that way.
--   * TRIGGER    — neither table has triggers, and the ability to attach one is the ability
--                  to run code with the owner's reach.
--   * MAINTAIN   — VACUUM/ANALYZE/REINDEX are the platform's business, not the app's.
--
-- `postgres` keeps everything: it owns both tables and the three SECURITY DEFINER functions
-- of 104, so its privileges are part of that security contract and are untouched here on
-- purpose.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
--   * does NOT change RLS on either table: it stays ENABLED, with the same ONE
--     `service_role` policy each, and `FORCE ROW LEVEL SECURITY` is deliberately NOT
--     enabled (that would additionally subject the OWNER to policies, which would change
--     how the definer functions of 104 behave — a separate decision with its own blast
--     radius, not a grant cleanup);
--   * does NOT create, drop or alter any policy;
--   * does NOT touch the three SECURITY DEFINER functions of 104
--     (`reserve_and_create_phone_reveal_run`, `confirm_phone_reveal_credits`,
--     `release_phone_reveal_credits`). Their EXECUTE ACL was already closed correctly by
--     104 — verified in Production: `{postgres=X/postgres,service_role=X/postgres}`, so
--     PUBLIC, `anon` and `authenticated` already hold no EXECUTE — and their bodies,
--     ownership and `search_path` are re-verified by this hito's PostgreSQL suite rather
--     than re-created here;
--   * does NOT touch `phone_reveal_cache` or `phone_reveal_suppression_audit`. Both carry
--     the SAME dead anon/authenticated grants (audited read-only, identical relacl shape,
--     each with exactly one `service_role`-only policy) and both deserve the same
--     treatment — in their own migration. They belong to the Apollo phone CACHE thread
--     (migration 099), not to the waterfall authorization path, and `phone_reveal_cache`
--     is the only one of the four that holds production rows, so a privilege change to it
--     is never going to be a side effect of hardening a different table;
--   * does NOT change the default privileges of schema `public`, so tables created AFTER
--     this migration are still born with the Supabase defaults. That is a platform-level
--     decision with repo-wide blast radius and belongs to its own block;
--   * does NOT alter a table shape, a constraint, an index or a function;
--   * inserts, updates and deletes NO row: zero backfill, zero data migration;
--   * does NOT create or activate a feature flag. `ENABLE_PHONE_REVEAL_WATERFALL` stays
--     resolved to false and this migration neither reads nor changes it;
--   * does NOT reveal a phone, call Apollo / Lusha / HubSpot, or spend a credit.
--
-- Privacy: PII-free by construction. This file contains no phone, email, name, LinkedIn
-- URL, provider contact id, user id or secret — only role names and privilege keywords.
--
-- Safety: REVOKE and GRANT are idempotent and declarative — they set an end state rather
-- than applying a delta — so re-applying this migration is a no-op that converges on the
-- same relacl. Verified against an ephemeral PostgreSQL over the three states that matter:
-- the exact Production relacl after 104, a partially revoked one, and an already fully
-- hardened one. Each table is guarded with `to_regclass` so the file is safe on a database
-- where its migration has not been applied: it reports and exits instead of failing the
-- chain, and the two tables are guarded INDEPENDENTLY so a database with 102 but not 104
-- still gets the hardening it can take.
--
-- ⚠️ ORDER. Must be applied AFTER 102 and AFTER 104, which create the tables it hardens.

-- ═══════════════════════════════════════════════════════════════════
-- 1. public.phone_reveal_credit_reservations  (migration 104)
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regclass('public.phone_reveal_credit_reservations') IS NULL THEN
    RAISE NOTICE
      'migration 105: public.phone_reveal_credit_reservations does not exist; apply migration 104 first. Nothing to harden, exiting cleanly.';
    RETURN;
  END IF;

  -- ── Remove the inherited blanket privileges ──────────────────────
  -- `PUBLIC` is included even though the observed relacl showed no PUBLIC entry: a grant
  -- to PUBLIC reaches every role that exists now or later, so revoking it is the one
  -- statement here whose value is entirely in what it PREVENTS.
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_credit_reservations FROM PUBLIC';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_credit_reservations FROM anon';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_credit_reservations FROM authenticated';

  -- `service_role` is revoked TOO, and then granted back a shorter list below.
  -- Not revoking it here was the first version of this migration, and an ephemeral
  -- PostgreSQL run caught the mistake: the Supabase default had already given
  -- service_role the full `arwdDxtm` set, GRANT only ADDS, so the additive grant left
  -- TRUNCATE, REFERENCES and TRIGGER exactly where they were. `service_role` is the role
  -- the server authenticates as and the key with the widest blast radius if it ever
  -- leaks, so it is precisely the role that must not hold TRUNCATE on a table where
  -- erasing the `reserved` rows silently hands back every credit currently in flight.
  -- Revoke-then-grant runs inside this one block, so there is no window in which the
  -- server lacks the privileges it needs.
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_credit_reservations FROM service_role';

  -- ── Grant back exactly what the server uses ──────────────────────
  -- Enumerated one privilege at a time rather than `ALL`: this list IS the contract, and
  -- `ALL` would silently re-grant TRUNCATE, REFERENCES and TRIGGER — the three the block
  -- above exists to take away.
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phone_reveal_credit_reservations TO service_role';

  -- ── Documented end state ─────────────────────────────────────────
  -- Inside the guard, not after it: a bare `COMMENT ON TABLE` would raise 42P01 on a
  -- database where 104 has not been applied, which would defeat the guard clause above
  -- and break the migration chain on exactly the database the guard exists to protect.
  -- (Caught by the ephemeral-PostgreSQL run, not by inspection.)
  EXECUTE format(
    'COMMENT ON TABLE public.phone_reveal_credit_reservations IS %L',
    $comment$AGENT2A-PHONE-WATERFALL-4E — one row per PROVIDER LEG of one phone reveal authorization, taken atomically BEFORE the run exists and BEFORE any provider call. Closes the concurrency hole of the per-provider budget model (budget_rules + provider_usage_logs have no reserved counter, so two authorizations read the same availability). A full waterfall reserves 8 against Apollo and 5 against Lusha as two rows in one reservation_group_id, all-or-nothing; there is no single pool that holds 13. A provider with no credit rule cannot be reserved against (limit_credits NOT NULL), so the waterfall refuses to start instead of running on an imaginary ceiling. PII-free by construction. HARDENED IN 4H (migration 105): table-level privileges are service_role-only — SELECT/INSERT/UPDATE/DELETE for service_role, nothing for PUBLIC/anon/authenticated, and TRUNCATE/REFERENCES/TRIGGER granted to nobody. RLS was never the only gate: TRUNCATE ignores policies entirely, and on this table erasing reserved rows would return all in-flight provider exposure at once. Reaching this table from the browser now requires BOTH a new policy AND a new grant.$comment$
  );
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 2. public.phone_reveal_waterfall_runs  (migration 102)
-- ═══════════════════════════════════════════════════════════════════
-- Its own guarded block, not a shared one: a database that has 102 but not 104 must still
-- get this half of the hardening, and one shared guard would have skipped both.

DO $$
BEGIN
  IF to_regclass('public.phone_reveal_waterfall_runs') IS NULL THEN
    RAISE NOTICE
      'migration 105: public.phone_reveal_waterfall_runs does not exist; apply migration 102 first. Nothing to harden, exiting cleanly.';
    RETURN;
  END IF;

  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_waterfall_runs FROM PUBLIC';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_waterfall_runs FROM anon';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_waterfall_runs FROM authenticated';

  -- Same revoke-then-grant reason as the reservations table above, with an extra edge of
  -- its own: on this table TRUNCATE would erase the `lusha_attempted_at` claims, and the
  -- at-most-once guarantee of the Lusha leg is enforced by nothing else.
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_waterfall_runs FROM service_role';

  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phone_reveal_waterfall_runs TO service_role';

  EXECUTE format(
    'COMMENT ON TABLE public.phone_reveal_waterfall_runs IS %L',
    $comment$AGENT2A-PHONE-WATERFALL-1 — one row per authorized phone reveal that may span Apollo then Lusha. Groups both legs under a single human authorization, records per-provider attempt/outcome/cost separately (never a mixed total), and its lusha_attempted_at claim is what makes the Lusha leg run at most once across webhook / recovery cron / manual review. PII-free by construction: no phone, email, name, linkedin or provider contact id. Gated behind ENABLE_PHONE_REVEAL_WATERFALL (unset everywhere as of this migration). HARDENED IN 4H (migration 105): table-level privileges are service_role-only — SELECT/INSERT/UPDATE/DELETE for service_role, nothing for PUBLIC/anon/authenticated, and TRUNCATE/REFERENCES/TRIGGER granted to nobody. RLS was never the only gate: TRUNCATE ignores policies entirely, and erasing these rows would erase the at-most-once Lusha claims, so webhook, recovery cron and manual review could each pay for the same leg again. Reaching this table from the browser now requires BOTH a new policy AND a new grant.$comment$
  );
END $$;
