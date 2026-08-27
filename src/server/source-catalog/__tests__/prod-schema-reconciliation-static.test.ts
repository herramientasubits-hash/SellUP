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
 * 🔴 The Brazil migration was renumbered a SECOND time, 126→127, after an unrelated, independently
 * merged migration — `126_agent1_batch_identity_atomicity.sql` (AGENT1-CUT3B4) — claimed 126 while
 * this reconciliation was still in review. That migration is NOT part of this milestone, is NOT
 * modified by it, and is structurally independent of Brazil: see the independence assertions
 * below and in the companion PostgreSQL suite.
 *
 * This file asserts everything that does NOT require a live database: file identity, migration
 * chain shape, and that migration 087 stays historical. The behavioral half — that 125 actually
 * detects both starting schemas, fails closed on bad data, and that 127 still accepts Brazil's
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
const MIGRATION_126_AGENT1 = '126_agent1_batch_identity_atomicity.sql';
const MIGRATION_127 = '127_br_receita_monthly_snapshot_identity.sql';
/**
 * AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1, which claimed 128 independently: the
 * projection of an already-approved candidate's phone collection onto its own official contact.
 * Declared here only so the numbering ceiling stays exact; it owns nothing this milestone owns.
 */
const MIGRATION_128_AGENT2A = '128_project_approved_candidate_phones_onto_contact.sql';
/** AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 — Agent 2's HubSpot sync chain, canonicalized
 * from four deliberately unnumbered `LOCAL_` files once the 125/126/127 dispute had settled.
 * Foreign to this milestone; policed by name and by content below. */
const MIGRATIONS_129_TO_132_AGENT2 = [
  '129_agent2_contact_hubspot_stale_completeness.sql',
  '130_agent2_contact_hubspot_stale_source.sql',
  '131_agent2_post_approval_reveal_stale_producer.sql',
  '132_agent2_hubspot_legacy_sync_state_backfill.sql',
] as const;

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

  it('28. the migration numbering ceiling is 132, and 125/126/127/128 each exist exactly once', () => {
    const files = readdirSync(MIGRATIONS_DIR);
    const numbered = files
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .map((f) => Number.parseInt(f.slice(0, 3), 10));
    const highest = numbered.reduce((max, value) => Math.max(max, value), 0);
    // AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 moved the ceiling to 128: the
    // projection of an already-APPROVED candidate's phone collection onto the contact its own
    // approval created.
    //
    // AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 then moved it to 132 by canonicalizing Agent
    // 2's HubSpot sync chain — 129 the completeness of the durable `stale` state, 130 its
    // provenance, 131 the re-issued 128 that produces the pending state with provenance
    // `reveal`, 132 the baseline for contacts already linked before that state existed. None is
    // a source-catalog migration and none touches anything this milestone owns; the sweep below
    // proves that over their SQL instead of trusting this comment. The ceiling stays EXACT so
    // that an undeclared migration above the last known milestone still breaks this guard.
    assert.equal(highest, 132);
    assert.ok(files.includes(MIGRATION_125));
    assert.ok(files.includes(MIGRATION_126_AGENT1));
    assert.ok(files.includes(MIGRATION_127));
    assert.equal(files.filter((f) => f.startsWith('125')).length, 1);
    assert.equal(files.filter((f) => f.startsWith('126')).length, 1);
    assert.equal(files.filter((f) => f.startsWith('127')).length, 1);
    // Neither the old, un-renamed `125_br_receita_monthly_snapshot_identity.sql` nor the
    // once-renamed `126_br_receita_monthly_snapshot_identity.sql` exist. Each rename was total,
    // not additive.
    assert.equal(files.includes('125_br_receita_monthly_snapshot_identity.sql'), false);
    assert.equal(files.includes('126_br_receita_monthly_snapshot_identity.sql'), false);
    assert.deepEqual(files.filter((f) => f.startsWith('128')), [MIGRATION_128_AGENT2A]);
    for (const agent2 of MIGRATIONS_129_TO_132_AGENT2) {
      assert.deepEqual(files.filter((f) => f.startsWith(agent2.slice(0, 3))), [agent2]);
    }
    assert.equal(files.some((f) => f.startsWith('133')), false);
    // And the 128 plus the whole 129–132 chain are provably foreign to this milestone: none of
    // them names a single source-catalog object CUT A.1 reconciles.
    for (const foreign of [MIGRATION_128_AGENT2A, ...MIGRATIONS_129_TO_132_AGENT2]) {
      const sql = readMigration(foreign);
      for (const owned of [
        'source_company_snapshots',
        'source_snapshot_runs',
        'record_identity_key',
        'source_period',
      ]) {
        assert.equal(sql.includes(owned), false, `${foreign} must not name ${owned}`);
      }
    }
  });

  it('24. migration 087 remains byte-for-byte historical', () => {
    const sql = readMigration(MIGRATION_087);
    // The exact shape 125/127 assume: nullable, unenforced, NOT VALID.
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

  it('CUT A.2 — migration 125 relaxes the physical NOT NULL only after the scoped CHECK is added NOT VALID, validated, and verified', () => {
    const sql = readMigration(MIGRATION_125);
    assert.match(sql, /CHECK\s*\([\s\S]*?\)\s*NOT VALID/, '125 must add the scoped CHECK as NOT VALID');
    assert.match(sql, /VALIDATE CONSTRAINT source_company_snapshots_non_br_record_identity_chk/);
    assert.match(sql, /convalidated/i, '125 must verify the CHECK actually validated');
    assert.match(sql, /ALTER COLUMN record_identity_key DROP NOT NULL/);

    const stripped = stripComments(sql);
    const dropNotNullIndex = stripped.indexOf('DROP NOT NULL');
    const validateIndex = stripped.indexOf('VALIDATE CONSTRAINT');
    assert.ok(dropNotNullIndex > 0 && validateIndex > 0);
    assert.ok(dropNotNullIndex > validateIndex, 'the physical NOT NULL must be relaxed only after the scoped CHECK is validated');
  });

  it('CUT A.2 — the fail-closed validation runs unconditionally, not nested inside the old-UNIQUE-detection branch', () => {
    const sql = stripComments(readMigration(MIGRATION_125));
    const oldUniqueBranch = sql.indexOf("IF v_conname IS NULL THEN");
    const missingIdentityCheck = sql.indexOf('v_missing_identity');
    assert.ok(missingIdentityCheck >= 0);
    assert.ok(
      oldUniqueBranch < 0 || missingIdentityCheck < oldUniqueBranch,
      'the missing-identity validation must run before (i.e. outside) the old-UNIQUE-detection branch, not inside it',
    );
  });

  it('CUT A.2 — the stale "Brazil is migration 126" reference is corrected to 127', () => {
    const sql = readMigration(MIGRATION_125);
    assert.match(sql, /owned by migration 127/);
    assert.equal(/Brazil[^.]*is owned by migration 126/.test(sql), false);
  });

  it('26. migration 127 owns the Brazil monthly identity, and does not recreate the generic model', () => {
    const sql = stripComments(readMigration(MIGRATION_127));
    assert.match(sql, /source_company_snapshots_br_receita_identity_chk/);
    assert.match(sql, /source_company_snapshots_br_period_identity_uidx/);
    assert.equal(sql.includes('source_company_snapshots_cn1_record_identity_key'), false);
    assert.equal(sql.includes('source_company_snapshots_year_identity_uidx'), false);
    assert.equal(/DROP\s+CONSTRAINT/i.test(sql), false, '127 assumes 125 already reconciled the generic model');
  });

  it('MIGRATION_125_APPLIED = NO, MIGRATION_127_APPLIED = NO — this milestone\'s own files say so', () => {
    for (const file of [MIGRATION_125, MIGRATION_127]) {
      const sql = readMigration(file);
      assert.match(sql, /NOT APPLIED/);
    }
  });

  it('MIGRATION_126_APPLIED = NO — AGENT1-CUT3B4 declares it in its own idiom', () => {
    // 126 is not this milestone's file and does not use the "NOT APPLIED" banner convention
    // 125/127 use; it declares the same fact in its own prose instead.
    const sql = readMigration(MIGRATION_126_AGENT1);
    assert.match(sql, /Mientras esta migraci[oó]n NO est[eé] aplicada/);
  });

  it('125 and 127 are structurally independent of 126 (AGENT1-CUT3B4)', () => {
    // Neither migration this milestone authored references AGENT1-CUT3B4's tables, and 126
    // references neither `source_company_snapshots` nor `source_snapshot_runs`. A future owner
    // decision about whether AGENT1-CUT3B4 is activated must not be able to affect Brazil, and
    // vice versa.
    const m125 = stripComments(readMigration(MIGRATION_125));
    const m127 = stripComments(readMigration(MIGRATION_127));
    for (const foreignTable of ['prospect_batches', 'prospect_candidates', 'identity_epoch']) {
      assert.equal(m125.includes(foreignTable), false, `125 must not reference ${foreignTable}`);
      assert.equal(m127.includes(foreignTable), false, `127 must not reference ${foreignTable}`);
    }
    const m126 = stripComments(readMigration(MIGRATION_126_AGENT1));
    for (const brazilTable of ['source_company_snapshots', 'source_snapshot_runs']) {
      assert.equal(m126.includes(brazilTable), false, `126 must not reference ${brazilTable}`);
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
