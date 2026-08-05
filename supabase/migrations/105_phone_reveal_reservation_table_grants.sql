-- Migration 105: table-level privilege hardening of the phone reveal reservations table
-- (Agente 2A · AGENT2A-PHONE-WATERFALL-4H)
--
-- THE HOLE THIS CLOSES
--
-- Migration 104 enabled RLS on `phone_reveal_credit_reservations` and gave it exactly ONE
-- policy, for `service_role`. That is the control everybody reads when auditing the table,
-- and it is genuinely load-bearing. What it is NOT is the only layer: RLS decides which
-- ROWS a role may touch, and the table-level GRANT decides whether the role may touch the
-- table AT ALL. Those are two different gates, and 104 only closed one of them.
--
-- Supabase ships `ALTER DEFAULT PRIVILEGES ... IN SCHEMA public GRANT ALL ON TABLES TO
-- anon, authenticated, service_role`, so every table created in `public` is born with the
-- full privilege set for the two browser-reachable roles. Verified in Production before
-- this migration was written — the relacl of the table read:
--
--   {postgres=arwdDxtm/postgres, anon=arwdDxtm/postgres,
--    authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres}
--
-- That is SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN
-- granted to `anon` and to `authenticated` on a table whose contents are pure
-- authorization accounting. Today the only thing standing between the anon key and that
-- privilege set is the absence of a permissive policy. That means:
--
--   * a future `CREATE POLICY ... TO authenticated` on this table — however narrow, and
--     however well intentioned — instantly becomes a write path, because the underlying
--     grant was never the constraint;
--   * `TRUNCATE` is not filtered by RLS AT ALL. It is a table-level operation, so a role
--     holding the TRUNCATE grant can empty the table regardless of policies. On this table
--     that is not data loss in the ordinary sense: every `reserved` row is exposure
--     occupying provider availability, so deleting them all silently returns the entire
--     in-flight budget and re-opens the double-spend hole 104 exists to close;
--   * `TRIGGER` lets the grantee attach code that runs with the table owner's reach.
--
-- Defence in depth is the whole point: after this migration, reaching this table from the
-- browser requires BOTH a new policy AND a new grant. Neither mistake is sufficient alone.
--
-- WHAT IS GRANTED, AND WHY EXACTLY THAT
--
-- `service_role` gets SELECT, INSERT, UPDATE, DELETE and nothing else. Verified against
-- the call sites in `phone-reveal-credit-reservation-deps.ts`:
--
--   * SELECT — `findActivePhoneRevealCreditReservations()` reads the table DIRECTLY
--     through PostgREST with the admin client, so this grant is load-bearing and its
--     absence would break reconciliation.
--   * INSERT / UPDATE / DELETE — the three write paths in production all go through the
--     SECURITY DEFINER functions of 104, which execute as their owner (`postgres`) and
--     therefore do not consult this grant at all. They are granted anyway so that the role
--     the server actually authenticates as can operate the table it owns operationally,
--     rather than leaving a write surface that only works by virtue of a definer function
--     — a shape where removing a function silently turns into a permission mystery.
--
-- NOT granted, deliberately:
--
--   * TRUNCATE   — nothing truncates this table. It is an audit trail of authorizations,
--                  and the one operation that could erase in-flight exposure wholesale is
--                  the one no application role should hold.
--   * REFERENCES — creating a foreign key that points AT this table is a migration-time
--                  act performed by the owner (`postgres`), never by `service_role`. The
--                  two existing FKs (from `contact_enrichment_candidates` and
--                  `phone_reveal_waterfall_runs`) were created exactly that way.
--   * TRIGGER    — this table has no triggers, and the ability to attach one is the
--                  ability to run code with the owner's reach.
--   * MAINTAIN   — VACUUM/ANALYZE/REINDEX are the platform's business, not the app's.
--
-- `postgres` keeps everything: it is the table owner and the owner of the three SECURITY
-- DEFINER functions, so its privileges are part of 104's security contract and are
-- untouched here on purpose.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
--   * does NOT change RLS: it stays ENABLED, with the same ONE `service_role` policy, and
--     `FORCE ROW LEVEL SECURITY` is deliberately NOT enabled (that would additionally
--     subject the OWNER to policies, which would change how the definer functions of 104
--     behave — a separate decision with its own blast radius, not a grant cleanup);
--   * does NOT create, drop or alter any policy;
--   * does NOT touch `phone_reveal_waterfall_runs`, `phone_reveal_cache` or
--     `phone_reveal_suppression_audit`. All three carry the SAME dead anon/authenticated
--     grants (audited read-only in the same block, same relacl shape, each with exactly
--     one `service_role`-only policy) and all three deserve the same treatment — in their
--     own migration, so that a privilege change to a table with live production rows is
--     never a side effect of hardening a different one;
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
-- same relacl. Guarded with `to_regclass` so the file is safe on a database where 104 has
-- not been applied: it reports and exits instead of failing the migration chain.
--
-- ⚠️ ORDER. Must be applied AFTER 104, which creates the table this file hardens.

DO $$
BEGIN
  IF to_regclass('public.phone_reveal_credit_reservations') IS NULL THEN
    RAISE NOTICE
      'migration 105: public.phone_reveal_credit_reservations does not exist; apply migration 104 first. Nothing to harden, exiting cleanly.';
    RETURN;
  END IF;

  -- ── 1. Remove the inherited blanket privileges ───────────────────
  -- `PUBLIC` is included even though the observed relacl showed no PUBLIC entry: a grant
  -- to PUBLIC reaches every role that exists now or later, so revoking it is the one
  -- statement here whose value is entirely in what it PREVENTS.
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_credit_reservations FROM PUBLIC';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_credit_reservations FROM anon';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.phone_reveal_credit_reservations FROM authenticated';

  -- `service_role` is revoked TOO, and then granted back a shorter list in section 2.
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

  -- ── 2. Grant back exactly what the server uses ───────────────────
  -- Enumerated one privilege at a time rather than `ALL`: this list IS the contract, and
  -- `ALL` would silently re-grant TRUNCATE, REFERENCES and TRIGGER — the three the section
  -- above exists to take away.
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phone_reveal_credit_reservations TO service_role';

  -- ── 3. Documented end state ──────────────────────────────────────
  -- Inside the guard, not after it: a bare `COMMENT ON TABLE` would raise 42P01 on a
  -- database where 104 has not been applied, which would defeat the guard clause above
  -- and break the migration chain on exactly the database the guard exists to protect.
  -- (Caught by the ephemeral-PostgreSQL run, not by inspection.)
  EXECUTE format(
    'COMMENT ON TABLE public.phone_reveal_credit_reservations IS %L',
    $comment$AGENT2A-PHONE-WATERFALL-4E — one row per PROVIDER LEG of one phone reveal authorization, taken atomically BEFORE the run exists and BEFORE any provider call. Closes the concurrency hole of the per-provider budget model (budget_rules + provider_usage_logs have no reserved counter, so two authorizations read the same availability). A full waterfall reserves 8 against Apollo and 5 against Lusha as two rows in one reservation_group_id, all-or-nothing; there is no single pool that holds 13. A provider with no credit rule cannot be reserved against (limit_credits NOT NULL), so the waterfall refuses to start instead of running on an imaginary ceiling. PII-free by construction. HARDENED IN 4H (migration 105): table-level privileges are service_role-only — SELECT/INSERT/UPDATE/DELETE for service_role, nothing for PUBLIC/anon/authenticated, and TRUNCATE/REFERENCES/TRIGGER granted to nobody. RLS was never the only gate: TRUNCATE ignores policies entirely, and on this table erasing reserved rows would return all in-flight provider exposure at once. Reaching this table from the browser now requires BOTH a new policy AND a new grant.$comment$
  );
END $$;
