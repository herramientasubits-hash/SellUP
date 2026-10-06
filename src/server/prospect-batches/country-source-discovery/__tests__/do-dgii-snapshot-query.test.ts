/**
 * SOURCES-DO-FREE-DISCOVERY-1 · SOURCES-DO-SIZE-SIGNAL-1 — lectura del
 * descubrimiento de República Dominicana. Cliente doble que registra cada llamada; cualquier escritura
 * revienta la prueba.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { buildDoDgiiDiscoveryReads } from '../do-dgii-snapshot-query';

type Call = { table: string; ops: Array<[string, unknown[]]> };
type Responder = (call: Call) => { data?: unknown; error?: unknown };

function fakeClient(respond: Responder) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'in', 'order']) {
        builder[op] = (...args: unknown[]) => {
          call.ops.push([op, args]);
          return builder;
        };
      }
      for (const terminal of ['range', 'limit']) {
        builder[terminal] = (...args: unknown[]) => {
          call.ops.push([terminal, args]);
          return Promise.resolve({ data: null, error: null, ...respond(call) });
        };
      }
      // Las consultas que terminan en `.in(...)` (marcar lo ya visto) se esperan
      // directamente: el builder es «thenable», como el de supabase-js.
      builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        try {
          return Promise.resolve({ data: null, error: null, ...respond(call) }).then(resolve, reject);
        } catch (err) {
          return Promise.reject(err).then(resolve, reject);
        }
      };
      for (const write of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
        builder[write] = () => {
          throw new Error(`escritura prohibida: ${write}`);
        };
      }
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const op = (call: Call, name: string) => call.ops.filter(([n]) => n === name).map(([, a]) => a);

function sizedRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    record_identity_key: `k${i}`,
    normalized_tax_id: String(100000000 + i),
    legal_name: `EMPRESA ${i} SRL`,
    normalized_legal_name: `EMPRESA ${i}`,
    sector: 'ACTIVIDADES DE INFORMÁTICA N.C',
    size_tier: i % 2 === 0 ? 1 : '3',
    website_domain: i === 0 ? 'empresa0.com.do' : null,
  }));
}

describe('readSizedCompaniesByMacro', () => {
  it('una sola consulta a do_dgii_size_registry / DO / macro, ordenada por tamaño y RNC', async () => {
    const { client, calls } = fakeClient((c) => (c.table === 'source_company_snapshots' ? { data: sizedRows(3) } : { data: [] }));
    const rows = await buildDoDgiiDiscoveryReads(client).readSizedCompaniesByMacro({
      macroIndustryKey: 'technology',
      limit: 40,
    });

    assert.deepEqual(
      calls.map((c) => c.table),
      ['source_company_snapshots', 'prospect_candidates', 'prospect_discarded_dispositions'],
      'una lectura de la fuente y, después, lo ya visto',
    );
    const [call] = calls;
    assert.equal(call.table, 'source_company_snapshots');
    assert.deepEqual(op(call, 'eq'), [
      ['source_key', 'do_dgii_size_registry'],
      ['country_code', 'DO'],
      ['raw_data->>macro_industry_key', 'technology'],
    ]);
    assert.deepEqual(op(call, 'in'), [], 'nunca la lista de textos (no cabe en la URL)');
    assert.deepEqual(op(call, 'order'), [
      ['priority_score', { ascending: false }],
      ['normalized_tax_id', { ascending: true }],
    ]);
    assert.deepEqual(op(call, 'limit'), [[40]]);
    assert.match(String(op(call, 'select')[0][0]), /size_tier:raw_data->size_tier/);
    assert.match(String(op(call, 'select')[0][0]), /website_domain:raw_data->>website_domain/);

    assert.equal(rows.length, 3);
    assert.equal(rows[0].rnc, '100000000');
    assert.equal(rows[0].size_tier, 1);
    assert.equal(rows[1].size_tier, 3, 'el nivel llega como texto o número; se normaliza');
    assert.equal(rows[0].website_domain, 'empresa0.com.do');
    assert.equal(rows[1].website_domain, null);
  });

  it('SOURCES-DO-NO-RECYCLE-1: marca por RNC lo que SellUp ya vio (candidata > descarte cerrado > descarte)', async () => {
    const { client, calls } = fakeClient((c) => {
      if (c.table === 'source_company_snapshots') return { data: sizedRows(4) };
      if (c.table === 'prospect_candidates') return { data: [{ tax_identifier: '100000000' }] };
      return {
        data: [
          { provider_identifier: 'tax:100000000', decision: 'discard' },
          { provider_identifier: 'tax:100000001', decision: 'duplicate' },
          { provider_identifier: 'tax:100000002', decision: 'website_not_found' },
          { provider_identifier: 'tax:100000002', decision: null },
          { provider_identifier: 'nombre-sin-rnc', decision: 'discard' },
        ],
      };
    });
    const rows = await buildDoDgiiDiscoveryReads(client).readSizedCompaniesByMacro({ macroIndustryKey: 'technology', limit: 10 });
    assert.deepEqual(
      rows.map((r) => [r.rnc, r.prior_sighting]),
      [
        ['100000000', 'candidate'],
        ['100000001', 'definitive_discard'],
        ['100000002', 'discard'],
        ['100000003', null],
      ],
    );
    const candidatesCall = calls.find((c) => c.table === 'prospect_candidates');
    assert.deepEqual(op(candidatesCall as Call, 'in'), [['tax_identifier', ['100000000', '100000001', '100000002', '100000003']]]);
    const discardsCall = calls.find((c) => c.table === 'prospect_discarded_dispositions');
    assert.deepEqual(op(discardsCall as Call, 'eq'), [['source_primary', 'public_source']]);
    assert.deepEqual(op(discardsCall as Call, 'in'), [
      ['provider_identifier', ['tax:100000000', 'tax:100000001', 'tax:100000002', 'tax:100000003']],
    ]);
  });

  it('si fallan las consultas de lo ya visto, ofrece todo como antes (fail-open)', async () => {
    const { client } = fakeClient((c) => {
      if (c.table === 'source_company_snapshots') return { data: sizedRows(2) };
      throw new Error('red caída');
    });
    const rows = await buildDoDgiiDiscoveryReads(client).readSizedCompaniesByMacro({ macroIndustryKey: 'technology', limit: 10 });
    assert.deepEqual(rows.map((r) => r.prior_sighting), [null, null]);
  });

  it('un nivel ilegible queda nulo (el adapter lo descarta)', async () => {
    const { client } = fakeClient(() => ({ data: [{ ...sizedRows(1)[0], size_tier: 'x' }] }));
    const [row] = await buildDoDgiiDiscoveryReads(client).readSizedCompaniesByMacro({ macroIndustryKey: 'technology', limit: 5 });
    assert.equal(row.size_tier, null);
  });

  it('sin tope no consulta; un error o una excepción devuelven vacío', async () => {
    const empty = fakeClient(() => ({ data: [] }));
    assert.deepEqual(await buildDoDgiiDiscoveryReads(empty.client).readSizedCompaniesByMacro({ macroIndustryKey: 'technology', limit: 0 }), []);
    assert.equal(empty.calls.length, 0);

    const failing = fakeClient(() => ({ error: { message: 'boom' } }));
    assert.deepEqual(
      await buildDoDgiiDiscoveryReads(failing.client).readSizedCompaniesByMacro({ macroIndustryKey: 'technology', limit: 10 }),
      [],
    );

    const throwing = fakeClient(() => {
      throw new Error('red caída');
    });
    assert.deepEqual(
      await buildDoDgiiDiscoveryReads(throwing.client).readSizedCompaniesByMacro({ macroIndustryKey: 'technology', limit: 10 }),
      [],
    );
  });
});

describe('guardas estáticas', () => {
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const read = (rel: string) => strip(readFileSync(join(process.cwd(), rel), 'utf8'));
  const DIR = 'src/server/prospect-batches/country-source-discovery';

  it('las lecturas no escriben, no construyen cliente y no leen env', () => {
    const code = read(`${DIR}/do-dgii-snapshot-query.ts`);
    assert.doesNotMatch(code, /\.(insert|update|upsert|delete|rpc)\s*\(/);
    assert.doesNotMatch(code, /createClient\s*\(|createSupabaseAdminClient\s*\(/);
    assert.doesNotMatch(code, /process\.env|\bfetch\s*\(/);
  });

  it('el adapter y la tabla son puros', () => {
    for (const file of ['do-dgii-discovery-adapter.ts', 'do-dgii-macro-table.ts']) {
      const code = read(`${DIR}/${file}`);
      assert.doesNotMatch(code, /supabase|process\.env|\bfetch\s*\(|\.from\(\s*['"]/i, file);
    }
  });

  it('el cableado de producción inyecta las lecturas de DGII', () => {
    const code = read(`${DIR}/prepaid-novelty-gate.server.ts`);
    assert.match(code, /doDgiiDiscoveryReads:\s*buildDoDgiiDiscoveryReads\(adminClient\)/);
  });
});
