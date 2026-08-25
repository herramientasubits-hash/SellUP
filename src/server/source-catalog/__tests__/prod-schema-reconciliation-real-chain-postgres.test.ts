/**
 * BR-SOURCE CUT A.1 — production schema reconciliation before CUT B, verified against a REAL,
 * ephemeral PostgreSQL (behavioral half).
 *
 * ═══════════════════════════════════════════════════════════════════
 * WHY A STATIC SUITE IS NOT ENOUGH
 * ═══════════════════════════════════════════════════════════════════
 *
 * Migration 125's whole job is a runtime DECISION — "does this schema already look like
 * Production, or does it still look like the repository's own history" — expressed as `DO $$ ...
 * $$` blocks that branch on `pg_constraint`. No static read of the SQL text can tell you which
 * branch actually ran, whether the fail-closed checks actually raise on bad data, or whether a
 * row was mutated. Those are properties PostgreSQL has to evaluate.
 *
 * This suite proves, against two independently-built starting schemas:
 *
 *   FIXTURE A — built by REPLAYING the repository's own real migration chain (065 → 087 → 125 →
 *               127). Nothing here is invented: every file is read verbatim from
 *               `supabase/migrations`.
 *   FIXTURE B — a SYNTHETIC reproduction of Production's actual shape (canonical
 *               `record_identity_key` UNIQUE and table-wide NOT NULL CHECK already present, the
 *               old `normalized_tax_id` UNIQUE already absent), built directly by this file
 *               because that cutover's own migration history does not exist in this repository —
 *               that is precisely the drift 125 exists to reconcile. Then 125 and 127 are applied
 *               on top, exactly as they would run in Production.
 *
 * Both fixtures end in the SAME invariant, and neither ever deletes, updates or backfills a row.
 *
 * ARNÉS OBLIGATORIO EN CI (misma política que `wizard-budget-overage-postgres.test.ts`):
 * `SELLUP_REQUIRE_POSTGRES_HARNESS` convierte el skip en FALLO. En local, sin la variable, el
 * archivo se SALTA con un motivo explícito.
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:br-source:prod-schema-reconciliation:postgres
 *
 * NO PROD WRITES. NO APPLY_MIGRATION. Todo dato es sintético; nada viene de Producción.
 */

import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  applyRealChain,
  bootstrapFullOrderPlatform,
  bootstrapPlatform,
  buildProdShapeFixture,
  countSnapshotRows,
  FULL_REPO_ORDER_CHAIN,
  MIGRATION_125,
  MIGRATION_126_AGENT1,
  MIGRATION_127,
  readMigration as readChainMigration,
  REPO_DERIVED_REAL_CHAIN,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from './support/source-snapshot-identity-real-migration-chain';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → source-catalog → server → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } =
  resolveEmbeddedPostgres(import.meta.url);

let client: PgLikeClient;
let postgres: EmbeddedPostgresLike;
let dataDir = '';

const readMigration = (file: string) => readChainMigration(repoRoot, file);

/**
 * The column set every fixture's `source_company_snapshots` row carries BEFORE 125/127 run.
 * Comparing on this fixed list — rather than `SELECT *` — means a legitimate additive column
 * (`source_period`, `snapshot_run_id`) is never mistaken for a mutated existing row.
 */
const PRE_EXISTING_COLUMNS_SELECT = `
  SELECT id, source_key, country_code, source_year, tax_id, legal_name, normalized_tax_id,
         normalized_legal_name, sector, city, department, region, priority_score, signals,
         financials, raw_data, imported_at, record_identity_key
    FROM public.source_company_snapshots
   ORDER BY id
`;

const rowsOf = async (sql: string, values?: unknown[]) => (await client.query(sql, values)).rows;

const errorCodeOf = async (sql: string, values?: unknown[]): Promise<string | null> => {
  try {
    await client.query(sql, values);
    return null;
  } catch (err) {
    // A failed statement inside a migration's own BEGIN;...COMMIT; leaves the session in an
    // aborted-transaction state (25P02) that would otherwise poison every later query on this
    // same connection, including the next test's setup. Roll it back explicitly so one expected
    // failure never cascades into unrelated tests.
    await client.query('ROLLBACK').catch(() => {});
    return (err as { code?: string }).code ?? 'unknown';
  }
};

const constraintExists = async (name: string): Promise<boolean> => {
  const rows = await rowsOf(
    `SELECT 1 FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public' AND con.conname = $1`,
    [name],
  );
  return rows.length === 1;
};

const CANONICAL_UNIQUE = 'source_company_snapshots_cn1_record_identity_key';
const OLD_TAX_UNIQUE_COLUMNS = ['country_code', 'normalized_tax_id', 'source_key', 'source_year'];

const oldTaxUniqueExists = async (): Promise<boolean> => {
  const rows = await rowsOf(
    `SELECT 1 FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public' AND rel.relname = 'source_company_snapshots' AND con.contype = 'u'
        AND (
          SELECT array_agg(att.attname::text ORDER BY att.attname)
            FROM unnest(con.conkey) AS k(attnum)
            JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
        ) = $1::text[]`,
    [OLD_TAX_UNIQUE_COLUMNS],
  );
  return rows.length === 1;
};

describe('BR-SOURCE CUT A.1 — real chain against PostgreSQL', () => {
  if (harnessSkipReason) {
    it.skip(`embedded-postgres harness unavailable: ${harnessSkipReason}`, () => {});
    return;
  }

  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-br-source-cut-a1-pg-'));
    postgres = new EmbeddedPostgresCtor!({
      database_dir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 55447,
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    client = postgres.getPgClient();
    await client.connect();
  });

  after(async () => {
    await client.end();
    await postgres.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  // Belt-and-braces: any test that throws an uncaught PostgreSQL error (rather than routing it
  // through `errorCodeOf`) would otherwise leave the shared connection in an aborted-transaction
  // state (25P02) that poisons every later test on this same connection.
  afterEach(async () => {
    await client.query('ROLLBACK').catch(() => {});
  });

  // Every migration in these chains hardcodes `public.*` (matching what actually deploys), so
  // isolation between tests means resetting `public` itself, not layering a search_path.
  const resetPublicSchema = async () => {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await bootstrapPlatform(client);
  };

  // ── FIXTURE A: the repository's own real migration chain ──────────────────

  describe('FIXTURE A — repo-derived chain (065 → 087 → 125 → 127)', () => {
    beforeEach(resetPublicSchema);

    it('3. the canonical unique constraint is created against the repo-derived chain', async () => {
      await applyRealChain(client, repoRoot, REPO_DERIVED_REAL_CHAIN);
      assert.equal(await constraintExists(CANONICAL_UNIQUE), true);
    });

    it('4. the old normalized-tax-id unique constraint is removed', async () => {
      await applyRealChain(client, repoRoot, REPO_DERIVED_REAL_CHAIN);
      assert.equal(await oldTaxUniqueExists(), false);
    });

    it('5. missing record_identity_key values fail closed (no backfill, no silent pass)', async () => {
      await applyRealChain(client, repoRoot, ['065_create_source_snapshot_tables.sql', '087_add_record_identity_key_to_source_company_snapshots.sql']);
      await client.query(
        `INSERT INTO public.source_company_snapshots (source_key, country_code, source_year, normalized_tax_id)
         VALUES ('co_siis', 'CO', 2026, '900111222')`,
      );
      const code = await errorCodeOf(readMigration(MIGRATION_125));
      assert.notEqual(code, null, '125 must reject a non-BR row with record_identity_key IS NULL');
      // And it must not have partially applied: the canonical constraint must not exist.
      assert.equal(await constraintExists(CANONICAL_UNIQUE), false);
    });

    it('6. duplicate canonical record_identity_key tuples fail closed', async () => {
      await applyRealChain(client, repoRoot, ['065_create_source_snapshot_tables.sql', '087_add_record_identity_key_to_source_company_snapshots.sql']);
      await client.query(
        `INSERT INTO public.source_company_snapshots
           (source_key, country_code, source_year, normalized_tax_id, record_identity_key)
         VALUES
           ('co_siis', 'CO', 2026, '900111222', 'co_siis:900111222:a'),
           ('co_siis', 'CO', 2026, '900333444', 'co_siis:900111222:a')`,
      );
      const code = await errorCodeOf(readMigration(MIGRATION_125));
      assert.notEqual(code, null, '125 must reject a duplicate canonical tuple');
      assert.equal(await constraintExists(CANONICAL_UNIQUE), false);
    });

    it('7 & 8. no backfill occurs and no existing row is deleted or updated on the happy path', async () => {
      await applyRealChain(client, repoRoot, ['065_create_source_snapshot_tables.sql', '087_add_record_identity_key_to_source_company_snapshots.sql']);
      await client.query(
        `INSERT INTO public.source_company_snapshots
           (source_key, country_code, source_year, normalized_tax_id, record_identity_key)
         VALUES ('co_siis', 'CO', 2026, '900111222', 'co_siis:900111222:a')`,
      );
      // 125/127 ADD COLUMN source_period/snapshot_run_id — comparing on the PRE-EXISTING columns
      // only, so a legitimate additive schema change is not mistaken for a mutated row.
      const before = await rowsOf(PRE_EXISTING_COLUMNS_SELECT);
      await client.query(readMigration(MIGRATION_125));
      await client.query(readMigration(MIGRATION_127));
      const after = await rowsOf(PRE_EXISTING_COLUMNS_SELECT);
      assert.deepEqual(after, before, 'no column of any existing row may change');
    });

    it('9. record_identity_key is required for non-BR after the full chain', async () => {
      await applyRealChain(client, repoRoot, REPO_DERIVED_REAL_CHAIN);
      const code = await errorCodeOf(
        `INSERT INTO public.source_company_snapshots (source_key, country_code, source_year, normalized_tax_id)
         VALUES ('co_siis', 'CO', 2026, '900999888')`,
      );
      assert.equal(code, CHECK_VIOLATION);
    });

    it('10. a duplicate canonical tuple is rejected after the full chain', async () => {
      await applyRealChain(client, repoRoot, REPO_DERIVED_REAL_CHAIN);
      await client.query(
        `INSERT INTO public.source_company_snapshots
           (source_key, country_code, source_year, normalized_tax_id, record_identity_key)
         VALUES ('co_siis', 'CO', 2026, '900555666', 'co_siis:900555666:a')`,
      );
      const code = await errorCodeOf(
        `INSERT INTO public.source_company_snapshots
           (source_key, country_code, source_year, normalized_tax_id, record_identity_key)
         VALUES ('co_siis', 'CO', 2026, '900777888', 'co_siis:900555666:a')`,
      );
      assert.equal(code, UNIQUE_VIOLATION);
    });

    it('11 & 13. the same normalized_tax_id under distinct canonical identities is allowed — the old grain is not unique any more', async () => {
      await applyRealChain(client, repoRoot, REPO_DERIVED_REAL_CHAIN);
      const code = await errorCodeOf(
        `INSERT INTO public.source_company_snapshots
           (source_key, country_code, source_year, normalized_tax_id, record_identity_key)
         VALUES
           ('co_siis', 'CO', 2026, '900123123', 'co_siis:900123123:est-a'),
           ('co_siis', 'CO', 2026, '900123123', 'co_siis:900123123:est-b')`,
      );
      assert.equal(code, null, 'two distinct canonical identities sharing normalized_tax_id must be allowed');
    });

    it('12. normalized_tax_id NULL is allowed for a non-BR row', async () => {
      await applyRealChain(client, repoRoot, REPO_DERIVED_REAL_CHAIN);
      const code = await errorCodeOf(
        `INSERT INTO public.source_company_snapshots
           (source_key, country_code, source_year, normalized_tax_id, record_identity_key)
         VALUES ('ec_scvs', 'EC', 2026, NULL, 'ec_scvs:root:0002')`,
      );
      assert.equal(code, null);
    });

    it('14. record_identity_key NULL is allowed for a well-formed Brazil row', async () => {
      await applyRealChain(client, repoRoot, REPO_DERIVED_REAL_CHAIN);
      const runId = await insertBrRun(client, '2026-07', 'published');
      const code = await errorCodeOf(
        `INSERT INTO public.source_company_snapshots
           (source_key, country_code, source_year, normalized_tax_id, source_period, snapshot_run_id, raw_data)
         VALUES ('br_receita_cnpj_dados_abertos', 'BR', 2026, '11222333000181', '2026-07', $1,
                 jsonb_build_object('source_period', '2026-07'))`,
        [runId],
      );
      assert.equal(code, null);
    });

    it('15. record_identity_key non-NULL is refused for Brazil', async () => {
      await applyRealChain(client, repoRoot, REPO_DERIVED_REAL_CHAIN);
      const runId = await insertBrRun(client, '2026-07', 'published');
      const code = await errorCodeOf(
        `INSERT INTO public.source_company_snapshots
           (source_key, country_code, source_year, normalized_tax_id, source_period, snapshot_run_id, record_identity_key, raw_data)
         VALUES ('br_receita_cnpj_dados_abertos', 'BR', 2026, '11222333000181', '2026-07', $1, 'tax:11222333000181',
                 jsonb_build_object('source_period', '2026-07'))`,
        [runId],
      );
      assert.equal(code, CHECK_VIOLATION);
    });

    it('17. tax_id non-NULL is refused for Brazil', async () => {
      await applyRealChain(client, repoRoot, REPO_DERIVED_REAL_CHAIN);
      const runId = await insertBrRun(client, '2026-07', 'published');
      const code = await errorCodeOf(
        `INSERT INTO public.source_company_snapshots
           (source_key, country_code, source_year, normalized_tax_id, source_period, snapshot_run_id, tax_id, raw_data)
         VALUES ('br_receita_cnpj_dados_abertos', 'BR', 2026, '11222333000181', '2026-07', $1, '11.222.333/0001-81',
                 jsonb_build_object('source_period', '2026-07'))`,
        [runId],
      );
      assert.equal(code, CHECK_VIOLATION);
    });

    it('18. snapshot_run_id is required for Brazil', async () => {
      await applyRealChain(client, repoRoot, REPO_DERIVED_REAL_CHAIN);
      const code = await errorCodeOf(
        `INSERT INTO public.source_company_snapshots
           (source_key, country_code, source_year, normalized_tax_id, source_period, raw_data)
         VALUES ('br_receita_cnpj_dados_abertos', 'BR', 2026, '11222333000181', '2026-07',
                 jsonb_build_object('source_period', '2026-07'))`,
      );
      assert.equal(code, CHECK_VIOLATION);
    });

    it('19. source_period is required for Brazil', async () => {
      await applyRealChain(client, repoRoot, REPO_DERIVED_REAL_CHAIN);
      const runId = await insertBrRun(client, '2026-07', 'published');
      const code = await errorCodeOf(
        `INSERT INTO public.source_company_snapshots
           (source_key, country_code, source_year, normalized_tax_id, snapshot_run_id, raw_data)
         VALUES ('br_receita_cnpj_dados_abertos', 'BR', 2026, '11222333000181', $1, '{}'::jsonb)`,
        [runId],
      );
      assert.equal(code, CHECK_VIOLATION);
    });

    it('20. run A (published) and run B (preparing) coexist for the same period, same CNPJ', async () => {
      await applyRealChain(client, repoRoot, REPO_DERIVED_REAL_CHAIN);
      const runA = await insertBrRun(client, '2026-07', 'published');
      const runB = await insertBrRun(client, '2026-07', 'preparing');
      const insertRow = (runId: string) =>
        errorCodeOf(
          `INSERT INTO public.source_company_snapshots
             (source_key, country_code, source_year, normalized_tax_id, source_period, snapshot_run_id, raw_data)
           VALUES ('br_receita_cnpj_dados_abertos', 'BR', 2026, '11222333000181', '2026-07', $1,
                   jsonb_build_object('source_period', '2026-07'))`,
          [runId],
        );
      assert.equal(await insertRow(runA), null);
      assert.equal(await insertRow(runB), null, 'a preparing run must be able to stage the same CNPJ+period');
    });

    it('21. a same-run duplicate CNPJ is rejected', async () => {
      await applyRealChain(client, repoRoot, REPO_DERIVED_REAL_CHAIN);
      const runId = await insertBrRun(client, '2026-07', 'preparing');
      const insertRow = () =>
        errorCodeOf(
          `INSERT INTO public.source_company_snapshots
             (source_key, country_code, source_year, normalized_tax_id, source_period, snapshot_run_id, raw_data)
           VALUES ('br_receita_cnpj_dados_abertos', 'BR', 2026, '11222333000181', '2026-07', $1,
                   jsonb_build_object('source_period', '2026-07'))`,
          [runId],
        );
      assert.equal(await insertRow(), null);
      assert.equal(await insertRow(), UNIQUE_VIOLATION);
    });

    it('16. normalized_tax_id is the one persisted CNPJ representation Brazil actually stores', async () => {
      await applyRealChain(client, repoRoot, REPO_DERIVED_REAL_CHAIN);
      const runId = await insertBrRun(client, '2026-07', 'published');
      await client.query(
        `INSERT INTO public.source_company_snapshots
           (source_key, country_code, source_year, normalized_tax_id, source_period, snapshot_run_id, raw_data)
         VALUES ('br_receita_cnpj_dados_abertos', 'BR', 2026, '11222333000181', '2026-07', $1,
                 jsonb_build_object('source_period', '2026-07'))`,
        [runId],
      );
      const [row] = await rowsOf(
        `SELECT normalized_tax_id, tax_id, record_identity_key FROM public.source_company_snapshots
          WHERE source_key = 'br_receita_cnpj_dados_abertos'`,
      );
      assert.equal(row.normalized_tax_id, '11222333000181');
      assert.equal(row.tax_id, null);
      assert.equal(row.record_identity_key, null);
    });
  });

  // ── FIXTURE B: synthetic Production-shaped baseline ────────────────────────

  describe('FIXTURE B — Production-shaped synthetic baseline', () => {
    beforeEach(async () => {
      await resetPublicSchema();
      await buildProdShapeFixture(client);
    });

    it('1. the canonical unique constraint Production already has is detected', async () => {
      assert.equal(await constraintExists(CANONICAL_UNIQUE), true, 'fixture setup must already carry it');
    });

    it('1 & 2. migration 125 detects the existing canonical constraint and does not recreate or touch it', async () => {
      const rowCountBefore = await countSnapshotRows(client);
      const code = await errorCodeOf(readMigration(MIGRATION_125));
      assert.equal(code, null, '125 must be a no-op success against the Production shape');
      assert.equal(await constraintExists(CANONICAL_UNIQUE), true);
      assert.equal(await countSnapshotRows(client), rowCountBefore);
    });

    it('127 applies cleanly on top of the Production-shaped baseline once 125 has run', async () => {
      await client.query(readMigration(MIGRATION_125));
      const code = await errorCodeOf(readMigration(MIGRATION_127));
      assert.equal(code, null);
    });

    it('7 & 8. no backfill, no row deleted or updated, against the Production shape', async () => {
      const before = await rowsOf(PRE_EXISTING_COLUMNS_SELECT);
      await client.query(readMigration(MIGRATION_125));
      await client.query(readMigration(MIGRATION_127));
      const after = await rowsOf(PRE_EXISTING_COLUMNS_SELECT);
      assert.deepEqual(after, before);
    });

    it('the pre-existing duplicate-under-the-old-grain rows survive untouched', async () => {
      const [dupCount] = await rowsOf(
        `SELECT count(*)::int AS n FROM public.source_company_snapshots
          WHERE source_key = 'co_siis' AND country_code = 'CO' AND source_year = 2026 AND normalized_tax_id = '900123456'`,
      );
      assert.equal(dupCount.n, 2, 'fixture must carry the synthetic duplicate the owner decision protects');
      await client.query(readMigration(MIGRATION_125));
      await client.query(readMigration(MIGRATION_127));
      const [after] = await rowsOf(
        `SELECT count(*)::int AS n FROM public.source_company_snapshots
          WHERE source_key = 'co_siis' AND country_code = 'CO' AND source_year = 2026 AND normalized_tax_id = '900123456'`,
      );
      assert.equal(after.n, 2, 'the duplicate rows must not be deleted, merged or backfilled');
    });

    it('the NULL normalized_tax_id row survives untouched', async () => {
      await client.query(readMigration(MIGRATION_125));
      await client.query(readMigration(MIGRATION_127));
      const [row] = await rowsOf(
        `SELECT normalized_tax_id FROM public.source_company_snapshots WHERE source_key = 'ec_scvs'`,
      );
      assert.equal(row.normalized_tax_id, null);
    });
  });

  // ── PATH A vs PATH B: Brazil (127) is structurally independent of AGENT1-CUT3B4 (126) ──────
  //
  // 126 claimed its number independently of this reconciliation, while this reconciliation was
  // still in review. PATH A proves the full repository order — including 126 — applies end to
  // end without conflict. PATH B proves the SAME final state (125 + 127) is reachable with 126
  // intentionally ABSENT, which is the property that actually matters: a future owner decision
  // about whether AGENT1-CUT3B4 is activated in Production must not be able to change whether
  // Brazil's migration applies correctly.

  describe('PATH A — full repository order, 126 present (040 … 125 → 126 → 127)', () => {
    beforeEach(async () => {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      await bootstrapFullOrderPlatform(client);
    });

    it('the full order chain applies end to end, and both 126 and 127 leave the expected marks', async () => {
      assert.ok(
        FULL_REPO_ORDER_CHAIN.includes(MIGRATION_126_AGENT1),
        'the full order chain must include the real AGENT1-CUT3B4 migration file, not a stand-in',
      );
      await applyRealChain(client, repoRoot, FULL_REPO_ORDER_CHAIN);
      assert.equal(await constraintExists(CANONICAL_UNIQUE), true);
      // 126's own mark: the batch-identity fencing columns/functions exist.
      const [batchColumn] = await rowsOf(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'prospect_batches' AND column_name = 'identity_epoch'`,
      );
      assert.ok(batchColumn, 'AGENT1-CUT3B4 must have added identity_epoch');
      const [fencedFn] = await rowsOf(
        `SELECT 1 FROM pg_proc WHERE proname = 'insert_fenced_prospect_candidates'`,
      );
      assert.ok(fencedFn, 'AGENT1-CUT3B4 must have created its fencing function');
      // 127's own mark: a well-formed Brazil row still persists correctly on top of 126.
      const runId = await insertBrRun(client, '2026-07', 'published');
      const code = await errorCodeOf(
        `INSERT INTO public.source_company_snapshots
           (source_key, country_code, source_year, normalized_tax_id, source_period, snapshot_run_id, raw_data)
         VALUES ('br_receita_cnpj_dados_abertos', 'BR', 2026, '11222333000181', '2026-07', $1,
                 jsonb_build_object('source_period', '2026-07'))`,
        [runId],
      );
      assert.equal(code, null);
    });
  });

  describe('PATH B — Brazil independence, 126 intentionally ABSENT (065 → 087 → 125 → 127)', () => {
    beforeEach(async () => {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      await bootstrapPlatform(client);
    });

    it('125 and 127 apply cleanly with no 126 in the chain at all', async () => {
      await applyRealChain(client, repoRoot, REPO_DERIVED_REAL_CHAIN);
      assert.equal(await constraintExists(CANONICAL_UNIQUE), true);
      const [agent1Fn] = await rowsOf(
        `SELECT 1 FROM pg_proc WHERE proname = 'insert_fenced_prospect_candidates'`,
      );
      assert.equal(agent1Fn, undefined, '126 was never applied in this path, on purpose');
      const runId = await insertBrRun(client, '2026-07', 'published');
      const code = await errorCodeOf(
        `INSERT INTO public.source_company_snapshots
           (source_key, country_code, source_year, normalized_tax_id, source_period, snapshot_run_id, raw_data)
         VALUES ('br_receita_cnpj_dados_abertos', 'BR', 2026, '11222333000181', '2026-07', $1,
                 jsonb_build_object('source_period', '2026-07'))`,
        [runId],
      );
      assert.equal(code, null, 'Brazil must persist correctly whether or not AGENT1-CUT3B4 (126) ever applies');
    });
  });
});

async function insertBrRun(
  client: PgLikeClient,
  sourcePeriod: string,
  publishState: 'preparing' | 'published' | 'superseded' | 'failed' | 'rolled_back',
): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO public.source_snapshot_runs
       (source_key, country_code, source_year, source_period, publish_state)
     VALUES ('br_receita_cnpj_dados_abertos', 'BR', $1::int, $2, $3)
     RETURNING id`,
    [Number(sourcePeriod.slice(0, 4)), sourcePeriod, publishState],
  );
  return String(rows[0].id);
}
