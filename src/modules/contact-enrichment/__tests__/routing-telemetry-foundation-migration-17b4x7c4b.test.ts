// Tests — supabase/migrations/091_contact_enrichment_routing_telemetry_foundation.sql
// (Hito 17B.4X.7C.4B)
//
// Static offline contract audit for migration 091: reads the migration SQL
// as local text and asserts its additive routing-telemetry shape. No
// Supabase, no network, no DB connection, no RPC invocation — same pattern
// as request-attempt-persistence-migration.test.ts (migration 086), for the
// same reason: this repo has no local live-Postgres test harness.

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations');
const MIGRATION_FILENAME = '091_contact_enrichment_routing_telemetry_foundation.sql';
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

const sql = stripSqlComments(rawSql);

describe('Migration 091 — contact enrichment routing telemetry foundation', () => {
  describe('contact_enrichment_runs new columns (additive)', () => {
    it('adds routing_mode NOT NULL DEFAULT manual', () => {
      assert.match(sql, /ADD COLUMN IF NOT EXISTS routing_mode text NOT NULL DEFAULT 'manual'/);
    });

    it('adds provider_attempt_role NOT NULL DEFAULT manual', () => {
      assert.match(
        sql,
        /ADD COLUMN IF NOT EXISTS provider_attempt_role text NOT NULL DEFAULT 'manual'/,
      );
    });

    it('adds fallback_reason nullable, DEFAULT not_applicable', () => {
      assert.match(
        sql,
        /ADD COLUMN IF NOT EXISTS fallback_reason text NULL DEFAULT 'not_applicable'/,
      );
    });

    it('adds routing_policy_version nullable, no default (unknown until a policy exists)', () => {
      assert.match(sql, /ADD COLUMN IF NOT EXISTS routing_policy_version text NULL;/);
      assert.ok(
        !/routing_policy_version text NULL DEFAULT/.test(sql),
        'routing_policy_version must not carry a default value',
      );
    });
  });

  describe('CHECK constraints (closed enums)', () => {
    it('routing_mode is constrained to manual|observed|automatic', () => {
      assert.match(
        sql,
        /ADD CONSTRAINT contact_enrichment_runs_routing_mode_check\s+CHECK \(routing_mode IN \('manual', 'observed', 'automatic'\)\)/,
      );
    });

    it('provider_attempt_role is constrained to primary|fallback|manual', () => {
      assert.match(
        sql,
        /ADD CONSTRAINT contact_enrichment_runs_provider_attempt_role_check\s+CHECK \(provider_attempt_role IN \('primary', 'fallback', 'manual'\)\)/,
      );
    });

    it('fallback_reason allows NULL or one of the five closed reasons', () => {
      assert.match(sql, /ADD CONSTRAINT contact_enrichment_runs_fallback_reason_check/);
      for (const reason of [
        'provider_error',
        'zero_reviewable_candidates',
        'only_duplicates',
        'budget_guardrail',
        'not_applicable',
      ]) {
        assert.ok(sql.includes(`'${reason}'`), `missing fallback_reason value ${reason}`);
      }
      assert.match(sql, /fallback_reason IS NULL\s+OR fallback_reason IN/);
    });

    it('does NOT allow automatic execution of any kind (no EXECUTE/CALL of a provider runner)', () => {
      assert.ok(!/CALL\s+\w*(apollo|lusha)/i.test(sql));
      assert.ok(!sql.includes('runApollo'));
      assert.ok(!sql.includes('executeContactEnrichmentLushaRun'));
    });
  });

  describe('create_contact_enrichment_attempt RPC — explicit routing telemetry on insert', () => {
    it('CREATE OR REPLACEs the same function signature as migration 086 (additive, not a new function)', () => {
      assert.match(
        sql,
        /CREATE OR REPLACE FUNCTION public\.create_contact_enrichment_attempt\(\s*p_request_id\s+uuid,/,
      );
    });

    it('the attempt INSERT sets routing_mode/provider_attempt_role/fallback_reason to the manual defaults explicitly', () => {
      const startIdx = sql.indexOf('INSERT INTO public.contact_enrichment_runs (');
      const endIdx = sql.indexOf('RETURNING id INTO v_attempt_id;', startIdx);
      assert.ok(startIdx !== -1 && endIdx !== -1, 'attempt INSERT block not found');
      const block = sql.slice(startIdx, endIdx);

      const columnsBlock = block.slice(0, block.indexOf(') VALUES ('));
      assert.ok(columnsBlock.includes('routing_mode'));
      assert.ok(columnsBlock.includes('provider_attempt_role'));
      assert.ok(columnsBlock.includes('fallback_reason'));

      const valuesBlock = block.slice(block.indexOf(') VALUES ('));
      assert.match(valuesBlock, /'manual',\s*\n\s*'manual',\s*\n\s*'not_applicable'/);
    });

    it('never creates attempt_order = 2 or assigns a primary/fallback role (still 7C.2 scope, unchanged by this hito)', () => {
      assert.ok(!sql.includes("'fallback',\n      'fallback'"));
      assert.ok(!/provider_attempt_role',\s*'primary'/.test(sql));
      assert.ok(!/provider_attempt_role',\s*'fallback'/.test(sql));
    });

    it('preserves the REVOKE/GRANT convention (service_role + postgres only, no anon/authenticated execute)', () => {
      assert.match(
        sql,
        /REVOKE ALL ON FUNCTION public\.create_contact_enrichment_attempt\(uuid, smallint, text, uuid, jsonb, jsonb, jsonb\)\s+FROM PUBLIC, anon, authenticated/,
      );
      assert.match(
        sql,
        /GRANT EXECUTE ON FUNCTION public\.create_contact_enrichment_attempt\(uuid, smallint, text, uuid, jsonb, jsonb, jsonb\)\s+TO postgres, service_role/,
      );
    });
  });
});
