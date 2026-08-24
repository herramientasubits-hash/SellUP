-- Migration 126: BR Receita monthly snapshot identity foundation
-- Milestone: BR-SOURCE-FUNCTIONAL-CUT-A — monthly Receita snapshot identity foundation.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- THIS MIGRATION IS AN ARTIFACT. IT IS NOT APPLIED BY CUT A.
-- No Supabase MCP apply, no SQL editor, no remote SQL, no migration ledger write.
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- 🔴 RENUMBERED from 125 to 126 by BR-SOURCE CUT A.1 (production schema reconciliation before
-- CUT B). This file's SQL body is otherwise the ORIGINAL CUT-A content — no Brazil-facing
-- constraint, index, column or CHECK below changed meaning. What moved out is the generic,
-- non-Brazil part of the ORIGINAL migration 125: dropping migration 065's old
-- `(source_key, country_code, source_year, normalized_tax_id)` UNIQUE and replacing non-Brazil
-- uniqueness now belongs to migration 125 (`125_reconcile_source_snapshot_record_identity.sql`),
-- because Production had ALREADY moved non-Brazil uniqueness onto `record_identity_key` outside
-- this repository's migration ledger, and the original migration 125 assumed a schema Production
-- did not have. This migration now assumes migration 125 has already run: by the time this file's
-- statements execute, non-Brazil uniqueness already lives on
-- `source_company_snapshots_cn1_record_identity_key`, and this file adds nothing to that model. It
-- only ever touches Brazil.
--
-- WHAT THIS FIXES
-- ---------------
-- `source_company_snapshots` is YEAR-grained (`source_year int NOT NULL`) and, before migration
-- 125 ran, its only physical uniqueness for Brazil was migration 065's `UNIQUE (source_key,
-- country_code, source_year, normalized_tax_id)`. Receita publishes MONTHLY, which breaks that
-- constraint two ways (recorded as YH-1 / YH-2 in br-receita-cnpj-gate4-recorded-identity-grain.ts):
--
--   YH-1  with normalized_tax_id populated, 2026-08 collides with 2026-07 for the same
--         establishment, because the constraint cannot tell the two months apart. Monthly history
--         is destroyed by a constraint that believes it is preventing duplicates.
--   YH-2  with normalized_tax_id NULL, Postgres treats NULLs as DISTINCT, so that unique
--         constraint stops constraining ANYTHING: every month inserts a full duplicate set with no
--         idempotency and no dedup. This is the state Brazil is actually in.
--
-- Both are closed below: the period becomes physical, Brazil's identity becomes NOT NULL by CHECK,
-- and Brazil's uniqueness becomes period-aware.
--
--   YH-3  (the atomic-publication defect, closed by this revision) even with period-aware
--         uniqueness, a REBUILD of a period writes into the SAME rows readers are reading. A period
--         had exactly one physical row set, so staging a second copy of 2026-07 was impossible: the
--         retry's upserts mutated the live month in place, and a failure halfway left it damaged and
--         still published. "Publish is atomic" was true only of the RUN-STATE flip, never of the
--         rows underneath it.
--
--         Closed by `snapshot_run_id`: rows belong to a publication RUN, so run A (published) and
--         run B (preparing) coexist physically for the same period. B cannot touch A's rows because
--         the physical unique key includes the run. The cutover demotes A and promotes B in ONE
--         transaction, and readers see A right up to that COMMIT.
--
-- 🔴 `snapshot_run_id` IS NOT AN IDENTITY REPRESENTATION. It is a publication/version identifier,
-- it is minted by `gen_random_uuid()`, and it is NEVER derived from a CNPJ. It does not widen the
-- 4A exception below: the count of persisted exact CNPJ representations stays exactly ONE.
--
-- IDENTITY DECISION IMPLEMENTED (exactly ONE representation)
-- ---------------------------------------------------------
-- GATE-4 sub-decision 4A (LEGAL_PRIVACY_OWNER, OWNER_REF_GATE4A_LEGAL_PRIVACY_OWNER_RELAY_2026_08_24)
-- granted a narrow enumerated exception to GATE-1 R4: exactly ONE persisted, never-printed,
-- never-logged, never-reported representation of the establishment CNPJ, solely as that row's
-- internal exact-lookup key. FUNCTIONAL CUT A exercises it in `normalized_tax_id`, the column the
-- existing read primitives already take — which is what 4A's own `ifYes` branch anticipated.
--
-- The other two candidate columns stay EMPTY for Brazil, enforced below, so "exactly one" is a
-- schema fact and not a convention:
--   · `tax_id`              — the raw CNPJ. A second representation. Refused.
--   · `record_identity_key` — literally `tax:<normalized_14>`. A namespace prefix is not a
--                             transformation, and it is a second representation. Refused. This is
--                             also the OTHER half of why Brazil is exempt from migration 125's
--                             generic `record_identity_key IS NOT NULL` rule: Brazil's identity
--                             column is `normalized_tax_id`, never `record_identity_key`.
--
-- And the column this revision ADDS is not a third candidate:
--   · `snapshot_run_id`     — a `gen_random_uuid()` publication version. It carries no tax
--                             material, is not derived from any, and identifies WHICH PUBLICATION a
--                             row belongs to rather than WHICH COMPANY it is. Counting it as a CNPJ
--                             representation would be a category error; the persisted exact
--                             representation count remains 1.
--
-- 🔴 CHARACTER SET: the identity is 14 CHARACTERS, not 14 DECIMAL DIGITS. Alphanumeric CNPJs are
-- official from July 2026 — positions 1-12 may be [A-Z0-9], positions 13-14 (the DV) stay [0-9] —
-- and the first target period is 2026-07. A decimal-only constraint would reject valid
-- establishments in the very first month. This mirrors the canonical `normalizeBrazilCnpj`
-- validator exactly (`br-cnpj.ts`).
--
-- PRE-EXISTING ROW STRATEGY (§ 8) — fail closed, never invent a period
-- --------------------------------------------------------------------
--   · ZERO Brazil rows (the expected state — no Brazil writer has ever existed and no Brazil
--     snapshot has ever been written): every statement below applies cleanly. The new CHECK
--     constraints are VALIDATED immediately rather than NOT VALID, because a freshly added
--     `source_period` column is NULL on every existing row and the Brazil branch is unreachable
--     for every non-Brazil `source_key`.
--   · LEGACY Brazil rows present: `ADD CONSTRAINT ... source_company_snapshots_br_receita_identity_chk`
--     ABORTS the migration. That is deliberate and is the safe outcome. Such rows would have no
--     `source_period`, and there is no correct value to give them: the month they came from is not
--     recorded anywhere, and assigning today's month would silently mislabel a snapshot and let it
--     be published as a period it is not. Resolving that requires an explicit owner decision about
--     those rows (delete, or backfill from external provenance) — not a default in a migration.
--   · Whether legacy Brazil rows exist CANNOT be known from the repository alone, and CUT A does
--     not read Production. The migration is therefore written to be correct in BOTH states: clean
--     apply when there are none, hard abort when there are.
--
-- NON-BRAZIL SOURCES ARE UNTOUCHED BY THIS FILE
-- -----------------------------------------------
-- Every non-Brazil constraint, index and column this migration might have touched now belongs to
-- migration 125, which runs first and establishes the generic model this file assumes. Nothing
-- below references `record_identity_key`, the old normalized-tax-id UNIQUE, or a generic non-Brazil
-- unique index. A non-Brazil row is affected by this file only insofar as every Brazil-specific
-- statement below is guarded by `source_key = 'br_receita_cnpj_dados_abertos'` (or its negation),
-- which makes the guard a real boolean rather than decoration.
--
-- For the existing sources this costs nothing: every live writer was cut over to
-- `RECORD_IDENTITY_ON_CONFLICT` ('source_key,country_code,source_year,record_identity_key') and
-- NO writer references `OLD_TAX_GRAIN_ON_CONFLICT` any more. The CUT-A suite pins that fact, so a
-- future writer cannot quietly start depending on an arbiter migration 125 already retired.
--
-- For BRAZIL the predicate below is load-bearing and is therefore recorded as data, not left to be
-- rediscovered: `BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE` in
-- br-receita-cnpj-monthly-snapshot-write-plan.ts carries the exact `WHERE` clause CUT B has to emit
-- alongside the five conflict columns, and the CUT-A suite asserts it equals this file's predicate
-- below.

BEGIN;

-- ─── 1. The physical monthly period ─────────────────────────────────────────
-- Nullable at the TABLE level because other sources are legitimately year-grained; REQUIRED for
-- Brazil by the CHECK in step 3. Never derived from `created_at`/`imported_at`.

ALTER TABLE public.source_company_snapshots
  ADD COLUMN source_period text NULL;

ALTER TABLE public.source_snapshot_runs
  ADD COLUMN source_period text NULL;

COMMENT ON COLUMN public.source_company_snapshots.source_period IS
  'Canonical publication period of the source snapshot, YYYY-MM. Authoritative over source_year. Required for br_receita_cnpj_dados_abertos. Never inferred at read time.';

-- ─── 1b. The publication RUN a row belongs to ───────────────────────────────
-- The dimension that lets one period hold a published row set and a staging row set at the same
-- time. Nullable at the TABLE level because year-grained sources have no publication run; REQUIRED
-- for Brazil by the CHECK in step 3.
--
-- 🔴 ON DELETE RESTRICT, deliberately, not CASCADE. CASCADE would make `DELETE FROM
-- source_snapshot_runs WHERE id = …` silently delete that run's snapshots — including a PUBLISHED
-- run's, which is the live month. Cleanup must name the rows it destroys, so deleting a run while
-- its snapshots exist is refused and the row deletion has to be the explicit, run-scoped statement.

ALTER TABLE public.source_company_snapshots
  ADD COLUMN snapshot_run_id uuid NULL
  REFERENCES public.source_snapshot_runs (id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.source_company_snapshots.snapshot_run_id IS
  'Publication run this snapshot row belongs to (source_snapshot_runs.id). Required for br_receita_cnpj_dados_abertos. A version/publication identifier ONLY: never derived from a tax identifier and not an identity representation. Brazil rows are readable only through the single published run of their period.';

-- The FK referential check and every run-scoped cleanup look rows up by this column, and it is
-- NULL for every non-Brazil row, so the index is partial.
CREATE INDEX source_company_snapshots_snapshot_run_id_idx
  ON public.source_company_snapshots (snapshot_run_id)
  WHERE snapshot_run_id IS NOT NULL;

-- ─── 2. Period syntax, enforced table-wide ──────────────────────────────────
-- The regex body is identical to SOURCE_PERIOD_SQL_PATTERN in
-- src/server/source-catalog/source-period/source-period.ts, so the database and the application
-- cannot disagree about what a period is. The CUT-A suite asserts that equality.

ALTER TABLE public.source_company_snapshots
  ADD CONSTRAINT source_company_snapshots_source_period_format_chk
  CHECK (source_period IS NULL OR source_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

ALTER TABLE public.source_snapshot_runs
  ADD CONSTRAINT source_snapshot_runs_source_period_format_chk
  CHECK (source_period IS NULL OR source_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- ─── 3. Brazil identity: required, and exactly ONE representation ───────────
-- Every conjunct is written so a NULL can never make the CHECK pass by accident: `source_key` is
-- NOT NULL so the guard branch is a real boolean, and the `IS NOT NULL` tests come before the
-- comparisons that depend on them.

ALTER TABLE public.source_company_snapshots
  ADD CONSTRAINT source_company_snapshots_br_receita_identity_chk
  CHECK (
    source_key <> 'br_receita_cnpj_dados_abertos'
    OR (
      -- the period is mandatory, and it is the identity dimension
      source_period IS NOT NULL
      -- the publication run is mandatory: a Brazil row that belonged to no run could not be
      -- reached by the published-run read path, and would be invisible debris that the
      -- run-scoped cleanup could never name either
      AND snapshot_run_id IS NOT NULL
      -- the ONE persisted identity representation: exactly 14 chars, alphanumeric-CNPJ shaped
      AND normalized_tax_id IS NOT NULL
      AND normalized_tax_id ~ '^[A-Z0-9]{12}[0-9]{2}$'
      -- and no second representation, ever — including migration 125's generic column, which
      -- Brazil never populates
      AND tax_id IS NULL
      AND record_identity_key IS NULL
      -- source_year is retained only because the generic column is NOT NULL; it may never disagree
      -- with the period that is actually authoritative
      AND source_year::text = substring(source_period from 1 for 4)
      -- the raw_data provenance copy of the period may never drift from the physical column
      AND (raw_data ->> 'source_period') IS NOT NULL
      AND (raw_data ->> 'source_period') = source_period
    )
  );

-- ─── 4. Brazil uniqueness: period-aware AND run-aware ───────────────────────
-- Migration 125 already retired migration 065's table-wide `(source_key, country_code,
-- source_year, normalized_tax_id)` UNIQUE and established the generic non-Brazil model on
-- `record_identity_key`. This is the ONLY uniqueness statement this file adds, and it is
-- Brazil-only by predicate.
--
-- Combined with the CHECK in step 3 — which makes `source_period`, `snapshot_run_id` and
-- `normalized_tax_id` all NOT NULL for Brazil rows — this index can never be vacuous, so YH-2
-- (NULLS DISTINCT) is closed rather than relocated.
--
--     Same CNPJ + same period + same run  → the same physical row; a replay of that run is
--                                           idempotent.
--     Same CNPJ + same period + other run → a DISTINCT row. This is what lets run B stage a rebuild
--                                           of the month run A is currently publishing, without B's
--                                           upserts ever landing on A's rows (YH-3).
--     Same CNPJ + next period             → a distinct monthly snapshot; cross-period overwrite is
--                                           impossible (YH-1).
--
-- 🔴 The run column is INSIDE the unique key, not merely alongside it. A period-only key would make
-- every one of B's upserts a conflict against A's row and silently mutate the published month —
-- which is the defect, not the fix.
--
-- 🔴 `CONCURRENTLY` is deliberately NOT used: this statement does not replace an existing
-- constraint (migration 125 already retired the one it would have raced against), so there is no
-- window in which the table would otherwise have no uniqueness, and `CREATE INDEX CONCURRENTLY`
-- cannot run inside a transaction block regardless.
CREATE UNIQUE INDEX source_company_snapshots_br_period_identity_uidx
  ON public.source_company_snapshots
     (source_key, country_code, source_period, snapshot_run_id, normalized_tax_id)
  WHERE source_key = 'br_receita_cnpj_dados_abertos';

-- No additional read index is created. This index's leading columns
-- (source_key, country_code, source_period) already serve per-period pruning, its first four serve
-- the run-scoped whole-run read and the run-scoped cleanup, and the exact-lookup path uses all
-- five. An extra index would be dead weight.

-- ─── 5. Atomic publish: "complete period" becomes an explicit concept ───────
-- Reuses the EXISTING run table rather than inventing a second publication system. `publish_state`
-- is a SEPARATE column from the pre-existing `status`, so no other source's run lifecycle changes
-- meaning, and it is NULLABLE so historical runs are not retro-labelled with a state they never
-- had: NULL means "period publication does not apply to this run".

ALTER TABLE public.source_snapshot_runs
  ADD COLUMN publish_state text NULL;

-- `superseded` is the terminal state a previously published run enters when the next run for the
-- same period is promoted. It exists so the demotion is a real state and not a deletion: the rows of
-- a superseded run stay addressable by `snapshot_run_id`, so the previous month can be inspected,
-- audited or discarded explicitly rather than vanishing at cutover.
ALTER TABLE public.source_snapshot_runs
  ADD CONSTRAINT source_snapshot_runs_publish_state_chk
  CHECK (
    publish_state IS NULL
    OR publish_state IN ('preparing', 'published', 'superseded', 'failed', 'rolled_back')
  );

ALTER TABLE public.source_snapshot_runs
  ADD CONSTRAINT source_snapshot_runs_br_receita_publication_chk
  CHECK (
    source_key <> 'br_receita_cnpj_dados_abertos'
    OR (source_period IS NOT NULL AND publish_state IS NOT NULL)
  );

-- At most ONE published run per (source, country, period). This is what makes the publish
-- transition atomic and what makes "the published period" a single, unambiguous row: a partial
-- month is `preparing` and therefore invisible to any reader that filters on `published`, and a
-- failed build can never become published without displacing nothing.
--
-- 🔴 It is also what fixes the ORDER of the cutover. This is an ordinary (immediate) unique index,
-- not a DEFERRABLE constraint, so it is checked at the end of every statement rather than at COMMIT.
-- A cutover transaction must therefore be:
--
--     1. UPDATE … SET publish_state = 'superseded' WHERE id = <run A>;   -- demote first
--     2. UPDATE … SET publish_state = 'published'  WHERE id = <run B>;   -- then promote
--
-- The reverse order would hold two published runs for the period at the end of statement 1 and be
-- rejected. Concurrent readers are unaffected either way: they see run A until this transaction
-- COMMITs and run B afterwards, never a mixture and never neither.
--
-- Immediate checking is the deliberate choice: a DEFERRABLE constraint would let the transaction sit
-- in an invalid state for its whole duration, and would move the failure from the statement that
-- caused it to the COMMIT, where it is far harder to attribute.
CREATE UNIQUE INDEX source_snapshot_runs_published_period_uidx
  ON public.source_snapshot_runs (source_key, country_code, source_period)
  WHERE publish_state = 'published' AND source_period IS NOT NULL;

COMMENT ON COLUMN public.source_snapshot_runs.publish_state IS
  'Period publication state: preparing | published | superseded | failed | rolled_back. NULL for runs where period publication does not apply. A period is readable only through its single published run; preparing/failed/superseded runs and their rows are never reader-visible.';

COMMIT;
