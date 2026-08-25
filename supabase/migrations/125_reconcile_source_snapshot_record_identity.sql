-- Migration 125: Reconcile source_company_snapshots' generic record-identity model
-- Milestone: BR-SOURCE CUT A.1 — production schema reconciliation before CUT B.
-- Corrected under CUT A.2 — physical nullability reconciliation (see below).
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- THIS MIGRATION IS AUTHORED AND IS NOT APPLIED BY CUT A.1 OR CUT A.2.
-- No Supabase MCP apply, no SQL editor, no remote SQL, no migration ledger write.
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- WHY THIS EXISTS
-- ---------------
-- Migration 087 added `record_identity_key` as a nullable, unenforced shadow column (DB-A of the
-- generic record-identity line). No migration in this repository ever finished that cutover: no
-- migration here makes the column required, and no migration here moves table uniqueness onto it.
-- Yet every live non-Brazil writer (ec-scvs, siis-colombia, chilecompra, dgii-rd, gt-rgae,
-- hn-contrataciones, panamacompra-pa, sicop-cr, fedesoft, dgcp-rd — see
-- `record-identity-conflict-targets.ts`'s `RECORD_IDENTITY_ON_CONFLICT`) has been upserting against
-- `(source_key, country_code, source_year, record_identity_key)` as if that constraint already
-- existed.
--
-- It does, in Production — just not in this repository. Production received a cutover applied
-- outside the migration ledger: `record_identity_key` was NOT NULL table-wide (both a physical
-- column attribute and a named CHECK), and table uniqueness already lives on
-- `(source_key, country_code, source_year, record_identity_key)`. This migration is the repair. It
-- makes the repository converge on the SAME generic model Production already has, written so it is
-- a no-op against Production's actual shape and a real cutover against a database built from the
-- repository's own history.
--
-- OWNER DECISIONS THIS MIGRATION IMPLEMENTS (verbatim, not reinterpreted)
-- ------------------------------------------------------------------------
--   · NON-BRAZIL canonical identity is `record_identity_key`. `normalized_tax_id` is NOT reinstated
--     as generic uniqueness; it remains a lookup/provenance column only (065's non-unique lookup
--     index on it is untouched).
--   · BRAZIL is completely exempt from this migration's requirements. Brazil's identity decision
--     (`normalized_tax_id` is Brazil's one persisted CNPJ representation; `record_identity_key`
--     stays NULL for Brazil) is owned by migration 127 and is not re-litigated here. This migration
--     only carves the exemption — first as a validated CHECK, then by relaxing the physical column
--     attribute that would otherwise make the exemption unwritable — and asserts nothing about what
--     Brazil rows must contain. (Migration 126 is Agent 1's batch-identity atomicity migration, an
--     unrelated milestone that claimed that number independently; it neither touches nor is touched
--     by this file — see the independence assertions in the companion test suites.)
--   · The 306 rows in 152 duplicate groups (and the 18 non-BR rows with `normalized_tax_id IS
--     NULL`) found under the OLD `(source_key, country_code, source_year, normalized_tax_id)` grain
--     are NOT touched. No row is deleted, no row is modified, no backfill, no dedup. They stop being
--     a blocker the moment `normalized_tax_id` stops being generic uniqueness, which is what this
--     migration does.
--
-- CUT A.2 — THE PHYSICAL NULLABILITY DEFECT THIS VERSION FIXES
-- ---------------------------------------------------------------
-- The CUT A.1 version of this file only ever retired Production's named CHECK
-- (`..._record_identity_key_not_null_chk`) in favor of the scoped one below. It never touched the
-- column's own physical `NOT NULL` attribute (`pg_attribute.attnotnull`), which Production carries
-- independently of that named CHECK. Migration 127 needs to persist Brazil rows with
-- `record_identity_key = NULL` — against Production's actual shape, that column attribute alone
-- would reject every Brazil row regardless of what CHECK exists. This version adds the missing step
-- (§5 below) and fixes a second defect: the fail-closed data validation below used to run only
-- inside the branch that detects the OLD `normalized_tax_id` UNIQUE, so a database that already
-- looks Production-shaped (no old UNIQUE to find) skipped it entirely. It now runs unconditionally,
-- first, regardless of which starting shape this executes against.
--
-- TWO STARTING SCHEMAS, ONE MIGRATION
-- ------------------------------------
-- Schema A (Production's actual shape): already has
--   `source_company_snapshots_cn1_record_identity_key`
--     UNIQUE (source_key, country_code, source_year, record_identity_key)
--   `source_company_snapshots_record_identity_key_not_null_chk`
--     CHECK (record_identity_key IS NOT NULL)                              -- table-wide, pre-Brazil
--   `record_identity_key` physically NOT NULL (`attnotnull = true`)
-- and does NOT have migration 065's original
--   UNIQUE (source_key, country_code, source_year, normalized_tax_id).
-- Every step below is written to detect that this state already holds and do nothing further to
-- the constraints it recognizes, and to touch zero rows either way.
--
-- Schema B (built from this repository's own migration history): still has 065's original
-- normalized-tax-id UNIQUE, still has 087's nullable `record_identity_key` with its NOT VALID
-- nonempty check, and has neither of Production's two named constraints above, nor a physical
-- NOT NULL on the column.
--
-- Whichever schema this runs against, the invariant afterward is the same: canonical uniqueness on
-- `record_identity_key` exists for non-Brazil, exactly once, by the name above; the old
-- normalized-tax-id UNIQUE is gone; the NOT NULL requirement on `record_identity_key` is enforced
-- ONLY by a validated, scoped CHECK so Brazil can legally leave it NULL; and the column itself is
-- physically nullable.
--
-- FAIL CLOSED, NEVER BACKFILLED
-- ------------------------------
-- Before this migration will relax the physical NOT NULL, or add/validate the constraint that
-- replaces it, it verifies — unconditionally, on the LIVE data, not by trusting a prior migration's
-- say-so, and regardless of which starting schema this runs against — that every non-Brazil row
-- already has a non-NULL `record_identity_key` and that no two non-Brazil rows already collide on
-- the canonical tuple. Either violation aborts the migration with `RAISE EXCEPTION`. This migration
-- never invents, derives or backfills a `record_identity_key` value: a missing or duplicate one is
-- an owner decision, not a migration default.

BEGIN;

-- ─── 0. Fail-closed data validation, unconditional — runs against BOTH starting schemas ─────
-- This used to live only inside step 1's "old UNIQUE found" branch, which meant a
-- Production-shaped database (no old UNIQUE to find) skipped it entirely. It now always runs,
-- before anything below touches a constraint that protects existing rows.
DO $$
DECLARE
  v_missing_identity bigint;
  v_duplicate_tuples bigint;
BEGIN
  SELECT count(*) INTO v_missing_identity
    FROM public.source_company_snapshots
   WHERE source_key <> 'br_receita_cnpj_dados_abertos'
     AND record_identity_key IS NULL;

  IF v_missing_identity > 0 THEN
    RAISE EXCEPTION
      'migration 125: % non-Brazil row(s) have record_identity_key IS NULL; refusing to relax record_identity_key nullability without an explicit backfill decision',
      v_missing_identity;
  END IF;

  SELECT count(*) INTO v_duplicate_tuples
    FROM (
      SELECT 1
        FROM public.source_company_snapshots
       WHERE source_key <> 'br_receita_cnpj_dados_abertos'
       GROUP BY source_key, country_code, source_year, record_identity_key
      HAVING count(*) > 1
    ) dupes;

  IF v_duplicate_tuples > 0 THEN
    RAISE EXCEPTION
      'migration 125: % duplicate (source_key, country_code, source_year, record_identity_key) tuple(s) exist among non-Brazil rows; refusing to establish canonical uniqueness',
      v_duplicate_tuples;
  END IF;
END
$$;

-- ─── 1. Retire the old normalized-tax-id UNIQUE, if this schema still has it ────────────────
-- Located by column set, exactly like migration 127 (born as 125) already does for the same
-- reason: the auto-generated name is truncated and cannot be guessed. Absence is NOT an error here
-- — it means this schema is already Production-shaped (Schema A) and there is nothing to retire.
-- The fail-closed validation this branch used to gate is now step 0 above, run unconditionally.
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT con.conname
    INTO v_conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
   WHERE nsp.nspname = 'public'
     AND rel.relname = 'source_company_snapshots'
     AND con.contype = 'u'
     AND (
           SELECT array_agg(att.attname::text ORDER BY att.attname)
             FROM unnest(con.conkey) AS k(attnum)
             JOIN pg_attribute att
               ON att.attrelid = con.conrelid
              AND att.attnum = k.attnum
         ) = ARRAY['country_code', 'normalized_tax_id', 'source_key', 'source_year']::text[];

  IF v_conname IS NULL THEN
    -- Schema A: already retired (or never had it under this name). Nothing to do.
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE public.source_company_snapshots DROP CONSTRAINT %I', v_conname);
END
$$;

-- ─── 2. Canonical non-Brazil uniqueness, established if not already present ─────────────────
-- Same exact name Production already uses, so this step is a genuine no-op against Schema A.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'source_company_snapshots'
       AND con.conname = 'source_company_snapshots_cn1_record_identity_key'
  ) THEN
    ALTER TABLE public.source_company_snapshots
      ADD CONSTRAINT source_company_snapshots_cn1_record_identity_key
      UNIQUE (source_key, country_code, source_year, record_identity_key);
  END IF;
END
$$;

-- ─── 3. The scoped rule, added NOT VALID then explicitly validated ──────────────────────────
-- Required for every source EXCEPT Brazil, which migration 127 governs. Added NOT VALID so this
-- step never blocks on an unrelated table lock any longer than the DDL itself needs, then
-- validated as its own explicit step below — step 0 already proved every non-Brazil row qualifies,
-- so this validation is expected to pass; it is not the last line of defense, it is defense in
-- depth against relying on incidental side effects of unrelated DDL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'source_company_snapshots'
       AND con.conname = 'source_company_snapshots_non_br_record_identity_chk'
  ) THEN
    ALTER TABLE public.source_company_snapshots
      ADD CONSTRAINT source_company_snapshots_non_br_record_identity_chk
      CHECK (
        source_key = 'br_receita_cnpj_dados_abertos'
        OR record_identity_key IS NOT NULL
      ) NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.source_company_snapshots
  VALIDATE CONSTRAINT source_company_snapshots_non_br_record_identity_chk;

-- ─── 3b. Verify the validation actually landed ───────────────────────────────────────────────
DO $$
DECLARE
  v_convalidated boolean;
BEGIN
  SELECT con.convalidated
    INTO v_convalidated
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
   WHERE nsp.nspname = 'public'
     AND rel.relname = 'source_company_snapshots'
     AND con.conname = 'source_company_snapshots_non_br_record_identity_chk';

  IF v_convalidated IS NOT TRUE THEN
    RAISE EXCEPTION
      'migration 125: source_company_snapshots_non_br_record_identity_chk did not validate';
  END IF;
END
$$;

-- ─── 4. Drop Production's old table-wide NOT NULL CHECK, now superseded by the scoped one ───
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'source_company_snapshots'
       AND con.conname = 'source_company_snapshots_record_identity_key_not_null_chk'
  ) THEN
    ALTER TABLE public.source_company_snapshots
      DROP CONSTRAINT source_company_snapshots_record_identity_key_not_null_chk;
  END IF;
END
$$;

-- ─── 5. Only now, with the scoped CHECK validated and the old global CHECK gone: relax the ──
--        column's own physical NOT NULL attribute. This is a metadata-only change (no table
--        rewrite, no row read) and is a no-op if the column is already nullable (Schema B).
ALTER TABLE public.source_company_snapshots
  ALTER COLUMN record_identity_key DROP NOT NULL;

-- ─── 6. What this migration deliberately does NOT do ────────────────────────────────────────
-- · It does not create a generic normalized_tax_id UNIQUE index for non-Brazil sources. That grain
--   is retired, not relocated — see the header.
-- · It does not touch 065's non-unique lookup index on normalized_tax_id
--   (`idx_source_company_snapshots_normalized_tax_id`). That index is a lookup aid, not an identity
--   authority, and stays exactly as it is.
-- · It does not touch 087's NOT VALID nonempty check
--   (`source_company_snapshots_record_identity_key_nonempty_chk`). Preserved as-is.
-- · It does not create, alter or reference anything on `source_snapshot_runs`. That table's Brazil
--   publication columns are migration 127's concern.
-- · It does not modify migration 126 (Agent 1's batch-identity atomicity migration), which is
--   unrelated and structurally independent of this file — see the companion test suites.
-- · It writes, modifies, or removes zero rows. No backfill.

COMMIT;
