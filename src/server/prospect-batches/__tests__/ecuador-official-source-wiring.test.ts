/**
 * SOURCES-EC-RUC-BY-NAME-1 — lectura del snapshot SCVS + cableado del resolvedor
 * de Ecuador. Cero E/S real.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { buildEcuadorSnapshotQuery, ECUADOR_SNAPSHOT_QUERY_LIMIT } from '../ecuador-snapshot-query';

const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (rel: string) => strip(readFileSync(join(process.cwd(), rel), 'utf8'));

type Call = { method: string; args: unknown[] };

function fakeClient(result: { data?: unknown; error?: unknown; throws?: boolean }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'select', 'eq']) {
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
  for (const write of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
    builder[write] = () => {
      throw new Error(`escritura prohibida: ${write}`);
    };
  }
  return { client: builder as unknown as SupabaseClient, calls };
}

describe('buildEcuadorSnapshotQuery', () => {
  it('un único SELECT acotado a ec_scvs / EC por núcleo exacto', async () => {
    const { client, calls } = fakeClient({
      data: [
        {
          normalized_tax_id: '0992402008001',
          legal_name: 'SISTEMAS AUDIOVISUALES LUMENS S.A.',
          normalized_legal_name: 'SISTEMAS AUDIOVISUALES LUMENS',
        },
      ],
    });
    const rows = await buildEcuadorSnapshotQuery(client)('SISTEMAS AUDIOVISUALES LUMENS');
    assert.deepEqual(rows, [
      { ruc: '0992402008001', legalName: 'SISTEMAS AUDIOVISUALES LUMENS S.A.', normalizedLegalName: 'SISTEMAS AUDIOVISUALES LUMENS' },
    ]);
    assert.deepEqual(calls[0], { method: 'from', args: ['source_company_snapshots'] });
    assert.deepEqual(calls.filter((c) => c.method === 'eq').map((c) => c.args), [
      ['source_key', 'ec_scvs'],
      ['country_code', 'EC'],
      ['normalized_legal_name', 'SISTEMAS AUDIOVISUALES LUMENS'],
    ]);
    assert.deepEqual(calls.at(-1), { method: 'limit', args: [ECUADOR_SNAPSHOT_QUERY_LIMIT] });
  });

  it('sin núcleo no consulta; un error o excepción devuelve vacío', async () => {
    const idle = fakeClient({ data: [] });
    assert.deepEqual(await buildEcuadorSnapshotQuery(idle.client)('  '), []);
    assert.equal(idle.calls.length, 0);
    assert.deepEqual(await buildEcuadorSnapshotQuery(fakeClient({ error: { message: 'x' } }).client)('A B'), []);
    assert.deepEqual(await buildEcuadorSnapshotQuery(fakeClient({ throws: true }).client)('A B'), []);
  });
});

describe('cableado y guardas estáticas', () => {
  it('el factory compartido construye el resolvedor de Ecuador junto a CO y DO', () => {
    const wiring = read('src/server/prospect-batches/official-source-resolvers.ts');
    assert.match(wiring, /createColombiaOfficialSourceResolver\(/);
    assert.match(wiring, /createDominicanOfficialSourceResolver\(/);
    assert.match(wiring, /createEcuadorOfficialSourceResolver\(\{\s*querySnapshots:\s*buildEcuadorSnapshotQuery\(snapshotClient\)/);
  });

  it('el resolvedor es puro y la lectura no escribe ni construye cliente', () => {
    const resolver = read('src/server/agents/prospect-intake/resolvers/ecuador-official-source-resolver.ts');
    assert.doesNotMatch(resolver, /createClient|createSupabaseAdminClient|@supabase\/supabase-js|process\.env|\bfetch\s*\(|\.from\(\s*['"]/);
    const query = read('src/server/prospect-batches/ecuador-snapshot-query.ts');
    assert.doesNotMatch(query, /\.(insert|update|delete|upsert|rpc)\s*\(/);
    assert.doesNotMatch(query, /createClient\s*\(|createSupabaseAdminClient\s*\(|process\.env/);
  });
});
