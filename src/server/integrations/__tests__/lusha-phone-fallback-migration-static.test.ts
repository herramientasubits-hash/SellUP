/**
 * Static checks on supabase/migrations/101_lusha_phone_reveal_scaffold.sql
 * (Agente 2A · LUSHA-PHONE-FALLBACK-1S). This migration is a LOCAL DRAFT
 * ONLY — it has not been applied to any remote Supabase project. These tests
 * only read the SQL file from disk; they never connect to a database.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → integrations → server → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');

const migrationSql = readFileSync(
  join(repoRoot, 'supabase/migrations/101_lusha_phone_reveal_scaffold.sql'),
  'utf8',
);

describe('101_lusha_phone_reveal_scaffold.sql — vocabulary', () => {
  it('widens phone_reveal_provider to accept lusha alongside apollo', () => {
    assert.ok(migrationSql.includes("'apollo'"));
    assert.ok(migrationSql.includes("'lusha'"));
    assert.ok(migrationSql.includes('contact_enrichment_candidates_phone_reveal_provider_check'));
  });

  it('adds the phone_reveal_cost_source column with its check constraint', () => {
    assert.ok(migrationSql.includes('phone_reveal_cost_source'));
    assert.ok(migrationSql.includes("'reported'"));
    assert.ok(migrationSql.includes("'assumed_cap'"));
    assert.ok(migrationSql.includes("'unknown'"));
  });
});

describe('101_lusha_phone_reveal_scaffold.sql — safety pattern', () => {
  it('uses NOT VALID on every check constraint (legacy rows not re-checked)', () => {
    const checkBlocks = migrationSql.match(/CHECK \([\s\S]*?\)\s*NOT VALID/g) ?? [];
    assert.ok(checkBlocks.length >= 2, 'expected at least 2 NOT VALID check constraints');
  });

  it('uses idempotent guards (IF NOT EXISTS / pg_constraint) for the new column and constraints', () => {
    assert.ok(migrationSql.includes('ADD COLUMN IF NOT EXISTS phone_reveal_cost_source'));
    assert.ok(migrationSql.includes('SELECT 1 FROM pg_constraint'));
  });

  it('performs no backfill (no UPDATE statement touching existing rows)', () => {
    assert.equal(/\bUPDATE\s+public\./i.test(migrationSql), false);
  });

  it('touches only contact_enrichment_candidates', () => {
    const tableRefs = migrationSql.match(/ALTER TABLE public\.(\w+)/g) ?? [];
    const distinctTables = new Set(
      tableRefs.map((ref) => ref.replace('ALTER TABLE public.', '')),
    );
    assert.deepEqual([...distinctTables], ['contact_enrichment_candidates']);
  });

  it('does not touch RLS, policies, or triggers', () => {
    assert.equal(/CREATE POLICY|ALTER POLICY|ENABLE ROW LEVEL SECURITY|CREATE TRIGGER/i.test(migrationSql), false);
  });

  it('documents that it is a local draft, not applied remotely', () => {
    assert.ok(/LOCAL DRAFT ONLY/.test(migrationSql));
    assert.ok(/has NOT been applied to any remote[\s\S]{0,20}Supabase project/.test(migrationSql));
  });
});
