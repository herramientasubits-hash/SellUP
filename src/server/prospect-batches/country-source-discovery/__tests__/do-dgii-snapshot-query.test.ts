/**
 * SOURCES-DO-FREE-DISCOVERY-1 — lecturas del descubrimiento de República
 * Dominicana. Cliente doble que registra cada llamada; cualquier escritura
 * revienta la prueba.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildDoDgiiDiscoveryReads,
  DO_DGCP_RNC_CHUNK,
  DO_DGII_PAGE_SIZE,
} from '../do-dgii-snapshot-query';

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

function dgiiRows(count: number, start = 0) {
  return Array.from({ length: count }, (_, i) => ({
    record_identity_key: `k${start + i}`,
    normalized_tax_id: String(100000000 + start + i),
    legal_name: `EMPRESA ${start + i}`,
    normalized_legal_name: `EMPRESA ${start + i}`,
    sector: 'ACTIVIDADES DE INFORMÁTICA N.C',
  }));
}

describe('readActiveCompaniesByActivity', () => {
  it('lee sólo activos de rd_dgii_bulk / DO con esas actividades, en orden estable', async () => {
    const { client, calls } = fakeClient(() => ({ data: dgiiRows(3) }));
    const rows = await buildDoDgiiDiscoveryReads(client).readActiveCompaniesByActivity({
      activityTexts: ['ACTIVIDADES DE INFORMÁTICA N.C', 'ACTIVIDADES DE INFORMÁTICA N.C'],
      limit: 2000,
    });

    assert.equal(rows.length, 3);
    assert.equal(rows[0].rnc, '100000000');
    assert.equal(calls.length, 1, 'página corta ⇒ no pide otra');
    const [call] = calls;
    assert.equal(call.table, 'source_company_snapshots');
    const eqs = op(call, 'eq');
    assert.deepEqual(eqs, [
      ['source_key', 'rd_dgii_bulk'],
      ['country_code', 'DO'],
      ['raw_data->>is_active_taxpayer', 'true'],
    ]);
    assert.deepEqual(op(call, 'in'), [['sector', ['ACTIVIDADES DE INFORMÁTICA N.C']]]);
    assert.deepEqual(op(call, 'order'), [['normalized_tax_id', { ascending: true }]]);
    assert.deepEqual(op(call, 'range'), [[0, DO_DGII_PAGE_SIZE - 1]]);
  });

  it('pagina en bloques de 1.000 hasta el tope', async () => {
    let page = 0;
    const { client, calls } = fakeClient(() => ({ data: dgiiRows(DO_DGII_PAGE_SIZE, DO_DGII_PAGE_SIZE * page++) }));
    const rows = await buildDoDgiiDiscoveryReads(client).readActiveCompaniesByActivity({
      activityTexts: ['X'],
      limit: 1500,
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(op(calls[1], 'range'), [[1000, 1499]]);
    assert.equal(rows.length, 2000); // el doble devuelve páginas llenas; el tope lo pone el rango real
  });

  it('sin textos o sin tope no consulta; un error devuelve vacío', async () => {
    const empty = fakeClient(() => ({ data: [] }));
    const reads = buildDoDgiiDiscoveryReads(empty.client);
    assert.deepEqual(await reads.readActiveCompaniesByActivity({ activityTexts: [], limit: 10 }), []);
    assert.deepEqual(await reads.readActiveCompaniesByActivity({ activityTexts: ['X'], limit: 0 }), []);
    assert.equal(empty.calls.length, 0);

    const failing = fakeClient(() => ({ error: { message: 'boom' } }));
    assert.deepEqual(
      await buildDoDgiiDiscoveryReads(failing.client).readActiveCompaniesByActivity({ activityTexts: ['X'], limit: 10 }),
      [],
    );
  });
});

describe('readProcurementTotals', () => {
  it('suma el importe de todos los años por RNC, leyendo do_dgcp en bloques', async () => {
    const rncs = Array.from({ length: DO_DGCP_RNC_CHUNK + 1 }, (_, i) => String(100000000 + i));
    const { client, calls } = fakeClient((call) => {
      const part = op(call, 'in')[0][1] as string[];
      return {
        data: part.includes('100000000')
          ? [
              { normalized_tax_id: '100000000', awarded: 100 },
              { normalized_tax_id: '100000000', awarded: '50' },
              { normalized_tax_id: '100000001', awarded: null },
            ]
          : [{ normalized_tax_id: rncs[DO_DGCP_RNC_CHUNK], awarded: 7 }],
      };
    });
    const totals = await buildDoDgiiDiscoveryReads(client).readProcurementTotals([...rncs, rncs[0]]);

    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.deepEqual(op(call, 'eq'), [['source_key', 'do_dgcp'], ['country_code', 'DO']]);
      assert.ok((op(call, 'in')[0][1] as string[]).length <= DO_DGCP_RNC_CHUNK);
    }
    assert.equal(totals.get('100000000'), 150);
    assert.equal(totals.get('100000001'), 0, 'proveedora con importe nulo sigue contando como proveedora');
    assert.equal(totals.get(rncs[DO_DGCP_RNC_CHUNK]), 7);
    assert.equal(totals.has('100000002'), false);
  });

  it('si falla cualquier bloque devuelve vacío (nadie se ofrece a medias)', async () => {
    let n = 0;
    const { client } = fakeClient(() => (n++ === 0 ? { data: [] } : { error: { message: 'boom' } }));
    const rncs = Array.from({ length: DO_DGCP_RNC_CHUNK + 1 }, (_, i) => String(100000000 + i));
    const totals = await buildDoDgiiDiscoveryReads(client).readProcurementTotals(rncs);
    assert.equal(totals.size, 0);
  });

  it('sin RNC no consulta', async () => {
    const { client, calls } = fakeClient(() => ({ data: [] }));
    assert.equal((await buildDoDgiiDiscoveryReads(client).readProcurementTotals([])).size, 0);
    assert.equal(calls.length, 0);
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
