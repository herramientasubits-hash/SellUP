/**
 * BR-SOURCE CUT A.1 — production schema reconciliation before CUT B (static half).
 *
 * The production preflight for the original migration 125 discovered that Production's
 * `source_company_snapshots` had already been cut over to a `record_identity_key` uniqueness
 * model OUTSIDE this repository's migration ledger — a canonical UNIQUE and a table-wide NOT NULL
 * CHECK the repo never declared. This milestone repairs the migration chain so the repository
 * converges on that SAME model without touching a single row: it renumbers the Brazil monthly
 * migration from 125 to 126 (its SQL body did not change), and inserts a NEW generic migration
 * 125 that reconciles non-Brazil uniqueness onto `record_identity_key`.
 *
 * This file asserts everything that does NOT require a live database: file identity, migration
 * chain shape, and that migration 087 stays historical. The behavioral half — that 125 actually
 * detects both starting schemas, fails closed on bad data, and that 126 still accepts Brazil's
 * NULL under the new generic model — lives in the companion PostgreSQL suite
 * (`prod-schema-reconciliation-real-chain-postgres.test.ts`), because those are properties of
 * PostgreSQL evaluating the DDL, not properties a text diff can show.
 *
 * NOTHING here applies a migration, reads Production, or touches a real database.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyBrReceitaSnapshotRead,
  BR_RECEITA_FUTURE_READER_CONTRACT,
  BR_RECEITA_PUBLISHED_RUN_LOOKUP_COLUMNS,
} from '../connectors/br-receita-cnpj/br-receita-cnpj-monthly-snapshot-read-contract';
import {
  BR_RECEITA_CNPJ_SOURCE_KEY,
  BR_RECEITA_CNPJ_COUNTRY_CODE,
} from '../connectors/br-receita-cnpj/br-receita-cnpj-types';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → source-catalog → server → src → repo root
const REPO_ROOT = join(here, '..', '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');

const MIGRATION_087 = '087_add_record_identity_key_to_source_company_snapshots.sql';
const MIGRATION_125 = '125_reconcile_source_snapshot_record_identity.sql';
const MIGRATION_126 = '126_br_receita_monthly_snapshot_identity.sql';

const readMigration = (file: string) => readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
const stripComments = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

describe('BR-SOURCE CUT A.1 — migration chain shape', () => {
  it('27. the migration chain has no duplicate number', () => {
    const numbered = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .map((f) => f.slice(0, 3));
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const n of numbered) {
      if (seen.has(n)) duplicates.push(n);
      seen.add(n);
    }
    assert.deepEqual(duplicates, [], `números de migración duplicados: ${duplicates.join(', ')}`);
  });

  it('28. the migration numbering ceiling is 126, and both 125 and 126 exist', () => {
    const numbered = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .map((f) => Number.parseInt(f.slice(0, 3), 10));
    const highest = numbered.reduce((max, value) => Math.max(max, value), 0);
    assert.equal(highest, 126);
    assert.ok(readdirSync(MIGRATIONS_DIR).includes(MIGRATION_125));
    assert.ok(readdirSync(MIGRATIONS_DIR).includes(MIGRATION_126));
    // Neither the old, un-renamed `125_br_receita_monthly_snapshot_identity.sql` nor a `127_*`
    // migration exist. The rename is total, not additive.
    assert.equal(readdirSync(MIGRATIONS_DIR).includes('125_br_receita_monthly_snapshot_identity.sql'), false);
    assert.equal(
      readdirSync(MIGRATIONS_DIR).some((f) => f.startsWith('127')),
      false,
    );
  });

  it('24. migration 087 remains byte-for-byte historical', () => {
    const sql = readMigration(MIGRATION_087);
    // The exact shape 125/126 assume: nullable, unenforced, NOT VALID.
    assert.match(sql, /ADD COLUMN record_identity_key text NULL/);
    assert.match(sql, /NOT VALID/);
    assert.equal(/ADD CONSTRAINT[^;]*UNIQUE/i.test(sql), false, '087 never made record_identity_key unique');
    assert.equal(/record_identity_key[^,;]*NOT NULL/i.test(sql), false, '087 never required record_identity_key');
    // CUT A.1 markers must not appear: this file was not touched by this milestone.
    for (const marker of ['CUT A.1', 'cn1_record_identity_key', 'source_period', 'snapshot_run_id']) {
      assert.equal(sql.includes(marker), false, `087 must not carry ${marker}`);
    }
  });

  it('25. migration 125 is generic — no Brazil-only column, and owns the canonical constraint names', () => {
    const sql = stripComments(readMigration(MIGRATION_125));
    for (const brazilOnlyColumn of ['source_period', 'snapshot_run_id', 'publish_state']) {
      assert.equal(sql.includes(brazilOnlyColumn), false, `125 must not touch ${brazilOnlyColumn}`);
    }
    assert.match(sql, /source_company_snapshots_cn1_record_identity_key/);
    assert.match(sql, /source_company_snapshots_record_identity_key_not_null_chk/);
    assert.match(sql, /source_company_snapshots_non_br_record_identity_chk/);
    // The exemption is Brazil-aware but grants an exemption, never a requirement.
    assert.match(sql, /source_key = 'br_receita_cnpj_dados_abertos'/);
    assert.match(sql, /^BEGIN;$/m);
    assert.match(sql, /^COMMIT;$/m);
    // No row is ever mutated.
    assert.equal(/UPDATE\s|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE/i.test(sql), false);
  });

  it('26. migration 126 owns the Brazil monthly identity, and does not recreate the generic model', () => {
    const sql = stripComments(readMigration(MIGRATION_126));
    assert.match(sql, /source_company_snapshots_br_receita_identity_chk/);
    assert.match(sql, /source_company_snapshots_br_period_identity_uidx/);
    assert.equal(sql.includes('source_company_snapshots_cn1_record_identity_key'), false);
    assert.equal(sql.includes('source_company_snapshots_year_identity_uidx'), false);
    assert.equal(/DROP\s+CONSTRAINT/i.test(sql), false, '126 assumes 125 already reconciled the generic model');
  });

  it('MIGRATION_125_APPLIED = NO, MIGRATION_126_APPLIED = NO — neither file claims to have run', () => {
    for (const file of [MIGRATION_125, MIGRATION_126]) {
      const sql = readMigration(file);
      assert.match(sql, /NOT APPLIED/);
    }
  });
});

describe('BR-SOURCE CUT A.1 — read contract untouched (22, 23)', () => {
  it('22. period-only read remains invalid', () => {
    const result = classifyBrReceitaSnapshotRead({
      source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
      country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
      source_period: '2026-07',
    });
    assert.equal(result.classification, 'invalid_period_only');
    assert.equal(BR_RECEITA_FUTURE_READER_CONTRACT.periodOnlyReadClassification, 'invalid_period_only');
  });

  it('23. the published-run-id read contract is preserved', () => {
    assert.deepEqual(
      [...BR_RECEITA_PUBLISHED_RUN_LOOKUP_COLUMNS],
      [...BR_RECEITA_FUTURE_READER_CONTRACT.step1ResolvePublishedRunBy],
    );
    assert.ok(BR_RECEITA_PUBLISHED_RUN_LOOKUP_COLUMNS.length > 0);
  });
});
