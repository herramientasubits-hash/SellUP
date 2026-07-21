// Tests — supabase/migrations/093_add_record_origin_classification_to_prospect_candidates.sql
// (Q3F-5AY.3)
//
// Static offline contract audit for migration 093: reads the migration SQL as
// local text and asserts its additive, safe shape. No Supabase, no network, no
// DB connection, no RPC invocation — same pattern as
// routing-telemetry-foundation-migration-17b4x7c4b.test.ts (migration 091) and
// request-attempt-persistence-migration.test.ts (migration 086), for the same
// reason: this repo has no local live-Postgres test harness.

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations');
const MIGRATION_FILENAME = '093_add_record_origin_classification_to_prospect_candidates.sql';
const MIGRATION_PATH = join(MIGRATIONS_DIR, MIGRATION_FILENAME);

const rawSql = readFileSync(MIGRATION_PATH, 'utf-8');

function stripSqlComments(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      const commentIndex = line.indexOf('--');
      return line.slice(0, commentIndex === -1 ? line.length : commentIndex);
    })
    .join('\n');
}

// Comment-stripped SQL. All shape and safety assertions run against this so
// that natural-language wording in the header comment cannot influence results.
const sql = stripSqlComments(rawSql);

describe('Migration 093 — record origin classification columns on prospect_candidates', () => {
  describe('additive column additions', () => {
    it('adds record_origin', () => {
      assert.match(sql, /ADD COLUMN IF NOT EXISTS record_origin text/);
    });

    it('adds rejection_reason', () => {
      assert.match(sql, /ADD COLUMN IF NOT EXISTS rejection_reason text/);
    });

    it('adds classification_source', () => {
      assert.match(sql, /ADD COLUMN IF NOT EXISTS classification_source text/);
    });

    it('adds classification_confidence as smallint', () => {
      assert.match(sql, /ADD COLUMN IF NOT EXISTS classification_confidence smallint/);
    });

    it('uses ADD COLUMN IF NOT EXISTS for every column (idempotent expand)', () => {
      const matches = sql.match(/ADD COLUMN IF NOT EXISTS/g) ?? [];
      assert.equal(matches.length, 4);
    });

    it('only ever targets public.prospect_candidates', () => {
      const alteredTables = [...sql.matchAll(/ALTER TABLE\s+([^\s]+)/g)].map((m) => m[1]);
      assert.ok(alteredTables.length > 0, 'expected at least one ALTER TABLE');
      for (const table of alteredTables) {
        assert.equal(table, 'public.prospect_candidates');
      }
    });
  });

  describe('CHECK constraints (NOT VALID, NULL-tolerant)', () => {
    it('declares all four named check constraints', () => {
      assert.match(sql, /ADD CONSTRAINT prospect_candidates_record_origin_check/);
      assert.match(sql, /ADD CONSTRAINT prospect_candidates_rejection_reason_check/);
      assert.match(sql, /ADD CONSTRAINT prospect_candidates_classification_source_check/);
      assert.match(sql, /ADD CONSTRAINT prospect_candidates_classification_confidence_check/);
    });

    it('every ADD CONSTRAINT is a CHECK marked NOT VALID', () => {
      const constraintCount = (sql.match(/ADD CONSTRAINT/g) ?? []).length;
      const checkCount = (sql.match(/CHECK \(/g) ?? []).length;
      const notValidCount = (sql.match(/\)\s+NOT VALID;/g) ?? []).length;
      assert.equal(constraintCount, 4);
      assert.equal(checkCount, 4);
      assert.equal(notValidCount, 4);
    });

    it('each enum-style check tolerates NULL', () => {
      assert.match(sql, /record_origin IS NULL\s+OR record_origin IN/);
      assert.match(sql, /rejection_reason IS NULL\s+OR rejection_reason IN/);
      assert.match(sql, /classification_source IS NULL\s+OR classification_source IN/);
    });

    it('classification_confidence validates the 0-100 range and tolerates NULL', () => {
      assert.match(
        sql,
        /classification_confidence IS NULL\s+OR \(classification_confidence >= 0 AND classification_confidence <= 100\)/,
      );
    });
  });

  describe('allowed values are present', () => {
    it('record_origin includes the seven allowed origins', () => {
      for (const value of [
        'production',
        'smoke_test',
        'qa',
        'historical_cleanup',
        'import',
        'unknown',
        'synthetic',
      ]) {
        assert.ok(sql.includes(`'${value}'`), `missing record_origin value ${value}`);
      }
    });

    it('rejection_reason includes the principal allowed reasons', () => {
      for (const value of [
        'test_record',
        'cleanup_record',
        'duplicate',
        'outside_icp',
        'existing_account',
        'insufficient_data',
        'invalid_company',
        'provider_noise',
        'marketplace_or_directory',
        'geographic_mismatch',
        'industry_mismatch',
        'do_not_use',
        'no_longer_relevant',
        'other',
      ]) {
        assert.ok(sql.includes(`'${value}'`), `missing rejection_reason value ${value}`);
      }
    });

    it('classification_source includes the eight allowed sources', () => {
      for (const value of [
        'writer',
        'derived_metadata',
        'derived_source_primary',
        'derived_review_notes',
        'derived_batch',
        'manual',
        'derived_status',
        'unknown',
      ]) {
        assert.ok(sql.includes(`'${value}'`), `missing classification_source value ${value}`);
      }
    });
  });

  describe('safety — forbidden operations absent', () => {
    it('does not VALIDATE CONSTRAINT (only NOT VALID)', () => {
      assert.ok(!/VALIDATE CONSTRAINT/i.test(sql));
    });

    it('does not introduce NOT NULL', () => {
      assert.ok(!/NOT\s+NULL/i.test(sql));
    });

    it('does not introduce UNIQUE constraints', () => {
      assert.ok(!/UNIQUE/i.test(sql));
    });

    it('does not create any index', () => {
      assert.ok(!/CREATE\s+INDEX/i.test(sql));
    });

    it('does not mutate data (no UPDATE / INSERT / DELETE)', () => {
      assert.ok(!/\bUPDATE\b/i.test(sql));
      assert.ok(!/\bINSERT\b/i.test(sql));
      assert.ok(!/\bDELETE\b/i.test(sql));
    });

    it('does not DROP anything', () => {
      assert.ok(!/\bDROP\b/i.test(sql));
    });

    it('does not create triggers or functions', () => {
      assert.ok(!/CREATE\s+TRIGGER/i.test(sql));
      assert.ok(!/CREATE\s+FUNCTION/i.test(sql));
      assert.ok(!/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(sql));
    });

    it('does not touch accounts, prospect_batches or provider_usage_logs', () => {
      assert.ok(!/ALTER TABLE\s+public\.accounts/i.test(sql));
      assert.ok(!/ALTER TABLE\s+public\.prospect_batches/i.test(sql));
      assert.ok(!/ALTER TABLE\s+public\.provider_usage_logs/i.test(sql));
    });
  });
});
