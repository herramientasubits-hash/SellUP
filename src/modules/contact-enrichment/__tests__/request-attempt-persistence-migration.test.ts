// Tests — supabase/migrations/086_contact_enrichment_request_attempt_persistence.sql
// (Hito 17B.4X.7C.1)
//
// Static offline contract audit for migration 086: reads the migration SQL
// as local text and asserts its additive request/attempt persistence shape.
// No Supabase, no network, no DB connection, no RPC invocation.
//
// This repo has no local live-Postgres test harness (no docker/pg available
// in this environment), so the DB-layer TEST 1-15 items from the hito spec
// are proven here as static structural assertions against the migration
// text, not as executed INSERT/constraint-violation assertions. The
// function's transactional shape (row lock → duplicate pre-check → agent_run
// insert → attempt insert → unique_violation cleanup) is asserted the same
// way. This limitation is intentional and stated explicitly, per §30 of the
// hito spec.

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations');
const MIGRATION_FILENAME = '086_contact_enrichment_request_attempt_persistence.sql';
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
const sqlUpper = sql.toUpperCase();

describe('Migration 086 — request/attempt persistence foundation', () => {
  describe('contact_enrichment_requests table (§3-5)', () => {
    it('creates the table with CREATE TABLE IF NOT EXISTS (additive)', () => {
      assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.contact_enrichment_requests/);
    });

    it('declares exactly the closed context columns', () => {
      const required = [
        'account_id',
        'company_name',
        'company_domain',
        'company_country_code',
        'hubspot_company_id',
        'company_resolution_source',
        'triggered_by',
        'created_at',
        'updated_at',
      ];
      for (const col of required) {
        assert.ok(sql.includes(col), `missing column ${col}`);
      }
    });

    it('does NOT declare deferred request fields (status/mode/routing_policy_version/completed_at)', () => {
      const tableBlockMatch = sql.match(
        /CREATE TABLE IF NOT EXISTS public\.contact_enrichment_requests \(([\s\S]*?)\);/
      );
      assert.ok(tableBlockMatch, 'could not isolate contact_enrichment_requests table block');
      const block = tableBlockMatch![1];
      for (const forbidden of ['status', 'mode', 'routing_policy_version', 'completed_at']) {
        assert.ok(!new RegExp(`\\b${forbidden}\\b`).test(block), `unexpected column ${forbidden} present`);
      }
    });

    it('company_name is NOT NULL; company_domain/country_code/hubspot_company_id are nullable', () => {
      assert.match(sql, /company_name\s+text\s+NOT NULL/);
      assert.match(sql, /company_domain\s+text\s+NULL/);
      assert.match(sql, /company_country_code\s+text\s+NULL/);
      assert.match(sql, /hubspot_company_id\s+text\s+NULL/);
    });

    it('company_resolution_source is NOT NULL and CHECK-constrained to sellup|hubspot|manual', () => {
      assert.match(sql, /company_resolution_source\s+text\s+NOT NULL/);
      assert.match(
        sql,
        /CHECK \(company_resolution_source IN \(\s*'sellup',\s*'hubspot',\s*'manual'\s*\)\)/
      );
    });

    it('account_id FK is ON DELETE SET NULL; triggered_by FK is ON DELETE SET NULL', () => {
      assert.match(sql, /account_id\s+uuid\s+NULL REFERENCES public\.accounts\(id\) ON DELETE SET NULL/);
      assert.match(
        sql,
        /triggered_by\s+uuid\s+NULL REFERENCES public\.internal_users\(id\) ON DELETE SET NULL/
      );
    });

    it('has an updated_at trigger reusing set_updated_at()', () => {
      assert.match(sql, /CREATE TRIGGER contact_enrichment_requests_set_updated_at/);
      assert.match(
        sql,
        /BEFORE UPDATE ON public\.contact_enrichment_requests\s+FOR EACH ROW EXECUTE FUNCTION set_updated_at\(\)/
      );
    });

    it('enables RLS with service_role full access and authenticated select-only (068/078 convention)', () => {
      assert.match(sql, /ALTER TABLE public\.contact_enrichment_requests ENABLE ROW LEVEL SECURITY/);
      assert.match(
        sql,
        /CREATE POLICY "service_role_contact_enrichment_requests_all"\s+ON public\.contact_enrichment_requests\s+FOR ALL\s+TO service_role/
      );
      assert.match(
        sql,
        /CREATE POLICY "authenticated_contact_enrichment_requests_select"\s+ON public\.contact_enrichment_requests\s+FOR SELECT\s+TO authenticated/
      );
      assert.ok(
        !/authenticated[\s\S]{0,120}FOR (INSERT|UPDATE|DELETE|ALL)/.test(sql.replace(/service_role/g, '')),
        'authenticated must not get broader than SELECT'
      );
    });
  });

  describe('contact_enrichment_runs attempt linkage (§6-8)', () => {
    it('adds request_id, attempt_order, intended_provider as nullable additive columns', () => {
      assert.match(sql, /ADD COLUMN IF NOT EXISTS request_id uuid NULL\s+REFERENCES public\.contact_enrichment_requests\(id\)/);
      assert.match(sql, /ADD COLUMN IF NOT EXISTS attempt_order smallint NULL/);
      assert.match(sql, /ADD COLUMN IF NOT EXISTS intended_provider text NULL/);
    });

    it('request_id FK carries no ON DELETE SET NULL / CASCADE (defaults to NO ACTION/RESTRICT)', () => {
      const fkLine = sql.match(/ADD COLUMN IF NOT EXISTS request_id uuid NULL\s+REFERENCES public\.contact_enrichment_requests\(id\)\s*;/);
      assert.ok(fkLine, 'request_id FK declaration not found in expected NO ACTION shape');
      assert.ok(!sql.includes('REFERENCES public.contact_enrichment_requests(id) ON DELETE SET NULL'));
      assert.ok(!sql.includes('REFERENCES public.contact_enrichment_requests(id) ON DELETE CASCADE'));
    });

    it('has the tuple coherence CHECK constraint with the exact closed invariant', () => {
      assert.match(sql, /ADD CONSTRAINT contact_enrichment_runs_request_attempt_tuple_check/);
      assert.match(sql, /request_id IS NULL\s+AND attempt_order IS NULL\s+AND intended_provider IS NULL/);
      assert.match(
        sql,
        /request_id IS NOT NULL\s+AND attempt_order IN \(1, 2\)\s+AND intended_provider IN \('apollo', 'lusha'\)\s+AND bulk_run_id IS NULL/
      );
    });

    it('has the mandatory partial unique index on (request_id, attempt_order) WHERE request_id IS NOT NULL', () => {
      assert.match(
        sql,
        /CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_enrichment_runs_request_attempt_order\s+ON public\.contact_enrichment_runs \(request_id, attempt_order\)\s+WHERE request_id IS NOT NULL/
      );
    });
  });

  describe('atomic RPC create_contact_enrichment_attempt (§14-20)', () => {
    it('is SECURITY DEFINER with search_path pinned to pg_temp (try_reserve_wizard_credits convention)', () => {
      const fnBlock = sql.match(
        /CREATE OR REPLACE FUNCTION public\.create_contact_enrichment_attempt\(([\s\S]*?)\$\$;/
      );
      assert.ok(fnBlock, 'function body not found');
      assert.match(fnBlock![0], /SECURITY DEFINER/);
      assert.match(fnBlock![0], /SET search_path = pg_temp/);
    });

    it('accepts the existing-contacts snapshot as an explicit jsonb input', () => {
      assert.match(sql, /p_existing_contacts_snapshot\s+jsonb/);
    });

    it('does NOT accept company context (name/domain/country/hubspot id) as caller input', () => {
      const signatureMatch = sql.match(
        /CREATE OR REPLACE FUNCTION public\.create_contact_enrichment_attempt\(([\s\S]*?)\)\s*\nRETURNS/
      );
      assert.ok(signatureMatch, 'function signature not found');
      const signature = signatureMatch![1];
      for (const forbidden of ['p_company_name', 'p_company_domain', 'p_account_id', 'p_hubspot_company_id']) {
        assert.ok(!signature.includes(forbidden), `RPC must not accept ${forbidden} from caller`);
      }
    });

    it('locks the request row FOR UPDATE before any duplicate check or insert', () => {
      assert.match(sql, /FROM public\.contact_enrichment_requests\s+WHERE id = p_request_id\s+FOR UPDATE/);
    });

    it('validates intended_provider and attempt_order before touching contact_enrichment_runs', () => {
      const fnStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.create_contact_enrichment_attempt');
      const providerCheckIdx = sql.indexOf("p_intended_provider NOT IN ('apollo', 'lusha')", fnStart);
      const orderCheckIdx = sql.indexOf('p_attempt_order NOT IN (1, 2)', fnStart);
      const requestLockIdx = sql.indexOf('FOR UPDATE', fnStart);
      assert.ok(providerCheckIdx > fnStart && providerCheckIdx < requestLockIdx);
      assert.ok(orderCheckIdx > fnStart && orderCheckIdx < requestLockIdx);
    });

    it('inserts exactly one agent_runs row and one contact_enrichment_runs row on success', () => {
      const fnBody = sql.match(
        /CREATE OR REPLACE FUNCTION public\.create_contact_enrichment_attempt[\s\S]*?\$\$;/
      )![0];
      const agentRunInserts = (fnBody.match(/INSERT INTO public\.agent_runs/g) ?? []).length;
      const attemptInserts = (fnBody.match(/INSERT INTO public\.contact_enrichment_runs/g) ?? []).length;
      assert.equal(agentRunInserts, 1);
      assert.equal(attemptInserts, 1);
    });

    it('persists existing_contacts_snapshot inside the same INSERT that creates the attempt row (no follow-up UPDATE)', () => {
      const insertBlock = sql.match(
        /INSERT INTO public\.contact_enrichment_runs \([\s\S]*?RETURNING id INTO v_attempt_id;/
      );
      assert.ok(insertBlock, 'attempt INSERT block not found');
      assert.match(insertBlock![0], /existing_contacts_snapshot/);
      assert.ok(
        !/UPDATE public\.contact_enrichment_runs\s+SET\s+summary\s*=\s*jsonb_build_object\(\s*'existing_contacts_snapshot'/.test(
          sql
        ),
        'must not persist snapshot via a follow-up UPDATE'
      );
    });

    it('preserves the existing_contacts_snapshot summary key name (readDeduplicationSnapshot contract)', () => {
      assert.ok(sql.includes("'existing_contacts_snapshot'"));
    });

    it('preserves company_resolution_source in the initial summary (Lusha runner reads it)', () => {
      const insertBlock = sql.match(
        /INSERT INTO public\.contact_enrichment_runs \([\s\S]*?RETURNING id INTO v_attempt_id;/
      )![0];
      assert.match(insertBlock, /'company_resolution_source', v_request\.company_resolution_source/);
    });

    it('supersedes previous ready_to_enrich runs for the account strictly before inserting the new attempt row', () => {
      const fnBody = sql.match(
        /CREATE OR REPLACE FUNCTION public\.create_contact_enrichment_attempt[\s\S]*?\$\$;/
      )![0];
      const supersedeIdx = fnBody.indexOf("status  = 'superseded'");
      const insertIdx = fnBody.indexOf('INSERT INTO public.contact_enrichment_runs (');
      assert.ok(supersedeIdx > -1 && insertIdx > -1);
      assert.ok(supersedeIdx < insertIdx, 'supersede must run before the new attempt is inserted (no self-supersede)');
    });

    it('has a unique_violation EXCEPTION handler that deletes the orphaned agent_run and returns already_exists', () => {
      assert.match(sql, /EXCEPTION WHEN unique_violation THEN/);
      assert.match(sql, /DELETE FROM public\.agent_runs WHERE id = v_agent_run_id;/);
      const handlerBlock = sql.match(/EXCEPTION WHEN unique_violation THEN([\s\S]*?)END;/)![1];
      assert.match(handlerBlock, /'already_exists'/);
    });

    it('returns a typed jsonb result and never raises a raw unique-violation to the caller', () => {
      assert.match(sql, /RETURNS jsonb/);
      assert.match(sql, /'status', 'invalid_provider'/);
      assert.match(sql, /'status', 'invalid_attempt_order'/);
      assert.match(sql, /'status', 'invalid_request'/);
      assert.match(sql, /'status', 'already_exists'/);
      assert.match(sql, /'status', 'created'/);
    });

    it('revokes PUBLIC/anon/authenticated and grants only postgres/service_role (wizard-credits convention)', () => {
      assert.match(
        sqlUpper,
        /REVOKE ALL ON FUNCTION PUBLIC\.CREATE_CONTACT_ENRICHMENT_ATTEMPT\([\s\S]*?\)\s+FROM PUBLIC, ANON, AUTHENTICATED/
      );
      assert.match(
        sqlUpper,
        /GRANT EXECUTE ON FUNCTION PUBLIC\.CREATE_CONTACT_ENRICHMENT_ATTEMPT\([\s\S]*?\)\s+TO POSTGRES, SERVICE_ROLE/
      );
    });
  });

  describe('migration safety (§36)', () => {
    it('contains no UPDATE against existing contact_enrichment_runs rows outside the RPC body (no historical backfill)', () => {
      const fnBody = sql.match(
        /CREATE OR REPLACE FUNCTION public\.create_contact_enrichment_attempt[\s\S]*?\$\$;/
      )![0];
      const outsideFn = sql.replace(fnBody, '');
      assert.ok(!/UPDATE public\.contact_enrichment_runs/.test(outsideFn));
    });

    it('contains no DROP statements', () => {
      assert.ok(!sqlUpper.includes('DROP TABLE'));
      assert.ok(!sqlUpper.includes('DROP COLUMN'));
    });

    it('uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS everywhere additive DDL is applied', () => {
      assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.contact_enrichment_requests/);
      assert.match(sql, /ADD COLUMN IF NOT EXISTS request_id/);
      assert.match(sql, /ADD COLUMN IF NOT EXISTS attempt_order/);
      assert.match(sql, /ADD COLUMN IF NOT EXISTS intended_provider/);
    });
  });
});
