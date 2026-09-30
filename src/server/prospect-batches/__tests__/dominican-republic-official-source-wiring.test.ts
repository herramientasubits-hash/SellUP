/**
 * SOURCES-DO-INRUN-RNC-1 — DGII snapshot read + shared resolver wiring.
 *
 * 1. The injected read is a single bounded, read-only SELECT on
 *    `source_company_snapshots` scoped to rd_dgii_bulk / DO, and fails soft.
 * 2. The provider-neutral factory now serves CO and DO, without touching the
 *    runner or any provider-specific module.
 * 3. Static guards: no writes, no env, no network in the new files.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildDominicanSnapshotQuery,
  DOMINICAN_SNAPSHOT_MAX_NAMES,
  DOMINICAN_SNAPSHOT_QUERY_LIMIT,
} from '../dominican-republic-snapshot-query';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const RESOLVER = stripComments(
  read('src/server/agents/prospect-intake/resolvers/dominican-republic-official-source-resolver.ts'),
);
const QUERY = stripComments(read('src/server/prospect-batches/dominican-republic-snapshot-query.ts'));
const WIRING = stripComments(read('src/server/prospect-batches/official-source-resolvers.ts'));

type Call = { method: string; args: unknown[] };

/** Chainable fake of the Supabase query builder that records every call. */
function fakeClient(result: { data?: unknown; error?: unknown; throws?: boolean }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'select', 'eq', 'in']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.limit = (...args: unknown[]) => {
    calls.push({ method: 'limit', args });
    if (result.throws) return Promise.reject(new Error('network down'));
    return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  };
  for (const method of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
    builder[method] = () => {
      throw new Error(`write method ${method} must never be called`);
    };
  }
  return { client: builder as unknown as SupabaseClient, calls };
}

describe('buildDominicanSnapshotQuery', () => {
  it('runs one bounded SELECT scoped to rd_dgii_bulk / DO by exact names', async () => {
    const { client, calls } = fakeClient({
      data: [
        {
          normalized_tax_id: '131735444',
          legal_name: 'GRUPO RAMOS ARIAS SRL',
          normalized_legal_name: 'GRUPO RAMOS ARIAS SRL',
          taxpayer_status: 'ACTIVO',
          is_active_taxpayer: 'true',
        },
      ],
    });
    const rows = await buildDominicanSnapshotQuery(client)(['GRUPO RAMOS ARIAS SRL', 'GRUPO RAMOS ARIAS']);

    assert.deepEqual(rows, [
      {
        rnc: '131735444',
        legalName: 'GRUPO RAMOS ARIAS SRL',
        normalizedLegalName: 'GRUPO RAMOS ARIAS SRL',
        taxpayerStatus: 'ACTIVO',
        isActiveTaxpayer: true,
      },
    ]);
    assert.deepEqual(calls[0], { method: 'from', args: ['source_company_snapshots'] });
    assert.ok(calls.some((c) => c.method === 'eq' && c.args[0] === 'source_key' && c.args[1] === 'rd_dgii_bulk'));
    assert.ok(calls.some((c) => c.method === 'eq' && c.args[0] === 'country_code' && c.args[1] === 'DO'));
    const inCall = calls.find((c) => c.method === 'in');
    assert.equal(inCall?.args[0], 'normalized_legal_name');
    assert.deepEqual(calls.at(-1), { method: 'limit', args: [DOMINICAN_SNAPSHOT_QUERY_LIMIT] });
  });

  it('caps and de-duplicates the name list, and skips the read when empty', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `NAME ${i}`);
    const first = fakeClient({ data: [] });
    await buildDominicanSnapshotQuery(first.client)([...many, 'NAME 0']);
    const names = first.calls.find((c) => c.method === 'in')?.args[1] as string[];
    assert.equal(names.length, DOMINICAN_SNAPSHOT_MAX_NAMES);

    const empty = fakeClient({ data: [] });
    assert.deepEqual(await buildDominicanSnapshotQuery(empty.client)(['', '  ']), []);
    assert.equal(empty.calls.length, 0);
  });

  it('fails soft on a query error or a thrown exception', async () => {
    assert.deepEqual(await buildDominicanSnapshotQuery(fakeClient({ error: { message: 'boom' } }).client)(['X Y']), []);
    assert.deepEqual(await buildDominicanSnapshotQuery(fakeClient({ throws: true }).client)(['X Y']), []);
  });

  it('treats only an explicit true as an active taxpayer', async () => {
    const { client } = fakeClient({
      data: [
        { normalized_tax_id: '133170949', normalized_legal_name: 'A SRL', is_active_taxpayer: 'false' },
        { normalized_tax_id: '133406292', normalized_legal_name: 'B SRL', is_active_taxpayer: null },
      ],
    });
    const rows = await buildDominicanSnapshotQuery(client)(['A SRL', 'B SRL']);
    assert.deepEqual(rows.map((r) => r.isActiveTaxpayer), [false, false]);
  });
});

describe('shared resolver wiring (CO + DO)', () => {
  it('the factory builds the DO resolver next to CO from the same read client', () => {
    assert.match(WIRING, /createColombiaOfficialSourceResolver\(/);
    assert.match(WIRING, /createDominicanOfficialSourceResolver\(\{\s*querySnapshots:\s*buildDominicanSnapshotQuery\(snapshotClient\)/);
    assert.match(WIRING, /export function buildColombiaOfficialSourceResolvers\(\)/);
  });

  it('the resolver stays pure: no client, env, network or table access', () => {
    assert.doesNotMatch(RESOLVER, /createClient|createSupabaseAdminClient|@supabase\/supabase-js/);
    assert.doesNotMatch(RESOLVER, /process\.env/);
    assert.doesNotMatch(RESOLVER, /\bfetch\s*\(/);
    assert.doesNotMatch(RESOLVER, /\.from\(\s*['"]/);
  });

  it('the query never writes and never builds its own client', () => {
    assert.doesNotMatch(QUERY, /\.(insert|update|delete|upsert|rpc)\s*\(/);
    assert.doesNotMatch(QUERY, /createClient\s*\(|createSupabaseAdminClient\s*\(/);
    assert.doesNotMatch(QUERY, /process\.env/);
  });
});
