/**
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 6, 27, 28 — la consulta del
 * snapshot: qué filtra, cómo lo filtra y qué NO puede hacer.
 *
 * El cliente es un doble que REGISTRA la cadena de llamadas. No hay red ni
 * Supabase: lo que se prueba es la petición que se emite, que es justo lo que un
 * error de sintaxis dejaría inerte en silencio (la consulta falla-soft a `[]`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildCoSiisDiscoverySnapshotQuery } from '../co-siis-snapshot-query';

type Call = { method: string; args: unknown[] };

function fakeClient(response: { data: unknown[] | null; error: unknown }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  const chain = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    return builder;
  };
  for (const m of ['select', 'eq', 'in', 'order']) builder[m] = chain(m);
  builder.limit = (...args: unknown[]) => {
    calls.push({ method: 'limit', args });
    return Promise.resolve(response);
  };
  const client = {
    from: (...args: unknown[]) => {
      calls.push({ method: 'from', args });
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

test('§ 6 — filtra a la porción co_siis / CO y por los códigos CIIU recibidos', async () => {
  const { client, calls } = fakeClient({ data: [], error: null });
  const query = buildCoSiisDiscoverySnapshotQuery(client);
  await query({ ciiuCodes: ['2100', '8610'], limit: 25 });

  assert.deepEqual(calls[0], { method: 'from', args: ['source_company_snapshots'] });
  const eqCalls = calls.filter((c) => c.method === 'eq').map((c) => c.args);
  assert.deepEqual(eqCalls, [
    ['source_key', 'co_siis'],
    ['country_code', 'CO'],
  ]);

  const inCall = calls.find((c) => c.method === 'in');
  // 🔴 La expresión de columna es la que PostgREST entiende para una clave JSON.
  // Si alguien la reescribe, la consulta fallaría-soft a `[]` y la fuente quedaría
  // INERTE sin que nada lo dijera. Por eso se fija aquí, literal.
  assert.equal(inCall?.args[0], 'raw_data->>CIIU');

  const limitCall = calls.find((c) => c.method === 'limit');
  assert.deepEqual(limitCall?.args, [25]);
});

test('cada código viaja en sus DOS formas: con y sin el cero a la izquierda', async () => {
  const { client, calls } = fakeClient({ data: [], error: null });
  const query = buildCoSiisDiscoverySnapshotQuery(client);
  await query({ ciiuCodes: ['0161', '2100'], limit: 10 });

  const forms = (calls.find((c) => c.method === 'in')?.args[1] ?? []) as string[];
  // 575 de las 10.000 filas guardan el CIIU sin el cero inicial; filtrar sólo por
  // la forma canónica dejaría fuera, en silencio, agroindustria y minería.
  assert.ok(forms.includes('0161'));
  assert.ok(forms.includes('161'));
  assert.ok(forms.includes('2100'));
});

test('el orden es estable: dos corridas idénticas leen las mismas filas', async () => {
  const { client, calls } = fakeClient({ data: [], error: null });
  const query = buildCoSiisDiscoverySnapshotQuery(client);
  await query({ ciiuCodes: ['2100'], limit: 10 });

  const order = calls.find((c) => c.method === 'order');
  assert.deepEqual(order?.args, ['record_identity_key', { ascending: true }]);
});

test('sin códigos o con límite 0 NO se consulta nada', async () => {
  const { client, calls } = fakeClient({ data: [], error: null });
  const query = buildCoSiisDiscoverySnapshotQuery(client);

  assert.deepEqual([...(await query({ ciiuCodes: [], limit: 10 }))], []);
  assert.deepEqual([...(await query({ ciiuCodes: ['2100'], limit: 0 }))], []);
  assert.equal(calls.length, 0);
});

test('fail-soft: un error de la base resuelve a lista vacía, nunca lanza', async () => {
  const { client } = fakeClient({ data: null, error: { message: 'boom' } });
  const query = buildCoSiisDiscoverySnapshotQuery(client);
  assert.deepEqual([...(await query({ ciiuCodes: ['2100'], limit: 10 }))], []);
});

test('§ 28 — la consulta NO puede escribir: su cliente sólo recibe verbos de lectura', async () => {
  const { client, calls } = fakeClient({ data: [], error: null });
  const query = buildCoSiisDiscoverySnapshotQuery(client);
  await query({ ciiuCodes: ['2100'], limit: 10 });

  const methods = new Set(calls.map((c) => c.method));
  for (const write of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
    assert.ok(!methods.has(write), `no debe invocar ${write}`);
  }
});

test('el CIIU se lee de raw_data y las filas se proyectan sin campos de más', async () => {
  const { client } = fakeClient({
    data: [
      {
        record_identity_key: 'r1',
        legal_name: 'SINTETICA',
        normalized_legal_name: 'sintetica',
        tax_id: '900000001',
        sector: 'SERVICIOS',
        city: 'BOGOTA',
        department: 'BOGOTA D.C.',
        raw_data: { CIIU: '2100', 'INGRESOS OPERACIONALES 2024': 123 },
      },
    ],
    error: null,
  });
  const query = buildCoSiisDiscoverySnapshotQuery(client);
  const rows = await query({ ciiuCodes: ['2100'], limit: 10 });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.ciiu, '2100');
  // El resto de `raw_data` (incluidos los financieros) no viaja aguas abajo.
  assert.deepEqual(Object.keys(rows[0] ?? {}).sort(), [
    'ciiu',
    'city',
    'department',
    'legal_name',
    'normalized_legal_name',
    'record_identity_key',
    'sector',
    'tax_id',
  ]);
});
