/**
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 6, 27, 28 · SOURCES-CO-CLOSE-1 —
 * la consulta del buscador gratuito de Colombia: qué filtra, cómo lo ordena, qué
 * marca como ya visto y qué NO puede hacer.
 *
 * El cliente es un doble que REGISTRA la cadena de llamadas por tabla. No hay red
 * ni Supabase: lo que se prueba es la petición que se emite, que es justo lo que
 * un error de sintaxis dejaría inerte en silencio (la consulta falla-soft a `[]`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildCoSiisDiscoverySnapshotQuery,
  CO_DISCOVERY_READ_CAP,
  CO_DISCOVERY_READ_OVERSAMPLE,
} from '../co-siis-snapshot-query';
import { buildCoSiisDiscoveryAdapter, CO_PUBLIC_ENTITY_DISCOVERY_MIN_WORKERS } from '../co-siis-discovery-adapter';
import { getCiiuSectorDescriptionExact } from '@/server/source-catalog/connectors/socrata-colombia/normalizers';

type Call = { table: string; method: string; args: unknown[] };
type Response = { data: unknown[] | null; error: unknown };

/**
 * Doble de Supabase: cada `from(tabla)` devuelve un constructor encadenable y
 * «awaitable» que responde con la respuesta de esa tabla. `failOrderOn` simula
 * que PostgREST rechaza un orden concreto (para probar la caída al orden estable).
 */
function fakeClient(responses: Record<string, Response>, options: { failOrderOn?: string } = {}) {
  const calls: Call[] = [];
  const client = {
    from: (table: string) => {
      calls.push({ table, method: 'from', args: [table] });
      let failed = false;
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'order', 'gte', 'limit']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          if (method === 'order' && options.failOrderOn !== undefined && args[0] === options.failOrderOn) failed = true;
          return builder;
        };
      }
      builder.then = (resolve: (value: Response) => unknown) =>
        resolve(failed ? { data: null, error: { message: 'order not supported' } } : responses[table] ?? { data: [], error: null });
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function siisRow(key: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    record_identity_key: key,
    legal_name: 'LABORATORIO X S.A.S.',
    normalized_legal_name: 'laboratorio x',
    tax_id: '900000001',
    sector: 'MANUFACTURA',
    city: 'BOGOTA',
    department: 'BOGOTA D.C.',
    raw_data: { CIIU: 2100, 'INGRESOS OPERACIONALES 2024': 123 },
    ...overrides,
  };
}

const siisCalls = (calls: Call[]) => calls.filter((c) => c.table === 'source_company_snapshots');

test('§ 6 — filtra a la porción co_siis / CO y por los códigos CIIU recibidos', async () => {
  const { client, calls } = fakeClient({});
  await buildCoSiisDiscoverySnapshotQuery(client)({ macroIndustryKey: 'health_pharma', ciiuCodes: ['2100', '8610'], limit: 25 });

  const snapshot = siisCalls(calls);
  assert.deepEqual(snapshot[0]?.args, ['source_company_snapshots']);
  const eqCalls = snapshot.filter((c) => c.method === 'eq').map((c) => c.args);
  assert.deepEqual(eqCalls, [
    ['source_key', 'co_siis'],
    ['country_code', 'CO'],
  ]);
  // 🔴 La expresión de columna es la que PostgREST entiende para una clave JSON.
  assert.equal(snapshot.find((c) => c.method === 'in')?.args[0], 'raw_data->>CIIU');
});

test('SOURCES-CO-CLOSE-1 — lee de más (×3, techo 600) para saltar lo ya visto', async () => {
  const { client, calls } = fakeClient({});
  const query = buildCoSiisDiscoverySnapshotQuery(client);
  await query({ macroIndustryKey: 'health_pharma', ciiuCodes: ['2100'], limit: 25 });
  await query({ macroIndustryKey: 'health_pharma', ciiuCodes: ['2100'], limit: 400 });

  const limits = siisCalls(calls).filter((c) => c.method === 'limit').map((c) => c.args[0]);
  assert.deepEqual(limits, [25 * CO_DISCOVERY_READ_OVERSAMPLE, CO_DISCOVERY_READ_CAP]);
});

test('cada código viaja en sus DOS formas: con y sin el cero a la izquierda', async () => {
  const { client, calls } = fakeClient({});
  await buildCoSiisDiscoverySnapshotQuery(client)({ macroIndustryKey: 'agroindustry', ciiuCodes: ['0161', '2100'], limit: 10 });

  const forms = (siisCalls(calls).find((c) => c.method === 'in')?.args[1] ?? []) as string[];
  assert.ok(forms.includes('0161'));
  assert.ok(forms.includes('161'));
  assert.ok(forms.includes('2100'));
});

test('SOURCES-CO-CLOSE-1 — de la que más factura a la que menos; el NIT desempata', async () => {
  const { client, calls } = fakeClient({});
  await buildCoSiisDiscoverySnapshotQuery(client)({ macroIndustryKey: 'health_pharma', ciiuCodes: ['2100'], limit: 10 });

  const orders = siisCalls(calls).filter((c) => c.method === 'order').map((c) => c.args);
  assert.deepEqual(orders, [
    ['financials->operatingRevenueCurrent', { ascending: false, nullsFirst: false }],
    ['record_identity_key', { ascending: true }],
  ]);
});

test('si PostgREST rechaza el orden por ingresos, se cae al orden estable de siempre', async () => {
  const { client, calls } = fakeClient(
    { source_company_snapshots: { data: [siisRow('tax:900000001')], error: null } },
    { failOrderOn: 'financials->operatingRevenueCurrent' },
  );
  const rows = await buildCoSiisDiscoverySnapshotQuery(client)({ macroIndustryKey: 'health_pharma', ciiuCodes: ['2100'], limit: 10 });

  assert.equal(rows.length, 1);
  const fromCalls = siisCalls(calls).filter((c) => c.method === 'from');
  assert.equal(fromCalls.length, 2);
});

test('sin códigos o con límite 0 NO se consulta nada', async () => {
  const { client, calls } = fakeClient({});
  const query = buildCoSiisDiscoverySnapshotQuery(client);

  assert.deepEqual([...(await query({ macroIndustryKey: 'retail', ciiuCodes: [], limit: 10 }))], []);
  assert.deepEqual([...(await query({ macroIndustryKey: 'health_pharma', ciiuCodes: ['2100'], limit: 0 }))], []);
  assert.equal(calls.length, 0);
});

test('fail-soft: un error de la base resuelve a lista vacía, nunca lanza', async () => {
  const { client } = fakeClient({ source_company_snapshots: { data: null, error: { message: 'boom' } } });
  const rows = await buildCoSiisDiscoverySnapshotQuery(client)({ macroIndustryKey: 'health_pharma', ciiuCodes: ['2100'], limit: 10 });
  assert.deepEqual([...rows], []);
});

test('§ 28 — la consulta NO puede escribir: su cliente sólo recibe verbos de lectura', async () => {
  const { client, calls } = fakeClient({ source_company_snapshots: { data: [siisRow('tax:900000001')], error: null } });
  await buildCoSiisDiscoverySnapshotQuery(client)({ macroIndustryKey: 'health_pharma', ciiuCodes: ['2100'], limit: 10 });

  const methods = new Set(calls.map((c) => c.method));
  for (const write of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
    assert.ok(!methods.has(write), `no debe invocar ${write}`);
  }
});

test('la web cargada viaja; el resto de raw_data (financieros) no', async () => {
  const { client } = fakeClient({
    source_company_snapshots: {
      data: [siisRow('tax:900000001', { raw_data: { CIIU: 2100, website_domain: 'labx.com.co', 'TOTAL ACTIVOS 2024': 9 } })],
      error: null,
    },
  });
  const rows = await buildCoSiisDiscoverySnapshotQuery(client)({ macroIndustryKey: 'health_pharma', ciiuCodes: ['2100'], limit: 10 });

  assert.equal(rows[0]?.website_domain, 'labx.com.co');
  assert.ok(!Object.keys(rows[0] ?? {}).some((key) => key.includes('ACTIVOS')));
});

test('SOURCES-CO-CLOSE-1 — marca lo que SellUp ya vio por NIT (candidata > descarte definitivo > descarte)', async () => {
  const { client, calls } = fakeClient({
    source_company_snapshots: {
      data: [
        siisRow('tax:900000001', { tax_id: '900000001' }),
        siisRow('tax:900000002', { tax_id: '900000002' }),
        siisRow('tax:900000003', { tax_id: '900000003' }),
        siisRow('tax:900000004', { tax_id: '900000004' }),
      ],
      error: null,
    },
    prospect_candidates: { data: [{ tax_identifier: '900000001' }], error: null },
    prospect_discarded_dispositions: {
      data: [
        { provider_identifier: 'tax:900000001', decision: null },
        { provider_identifier: 'tax:900000002', decision: 'discard' },
        { provider_identifier: 'tax:900000003', decision: null },
      ],
      error: null,
    },
  });
  const rows = await buildCoSiisDiscoverySnapshotQuery(client)({ macroIndustryKey: 'health_pharma', ciiuCodes: ['2100'], limit: 10 });

  assert.deepEqual(
    rows.map((row) => row.prior_sighting),
    ['candidate', 'definitive_discard', 'discard', null],
  );
  const discardFilter = calls.find((c) => c.table === 'prospect_discarded_dispositions' && c.method === 'eq');
  assert.deepEqual(discardFilter?.args, ['source_primary', 'public_source']);
  const ids = calls.find((c) => c.table === 'prospect_discarded_dispositions' && c.method === 'in')?.args[1] as string[];
  assert.ok(ids.includes('tax:900000004'));
});

test('si la lectura de lo ya visto falla, la fila se ofrece igual (fail-open)', async () => {
  const { client } = fakeClient({
    source_company_snapshots: { data: [siisRow('tax:900000001')], error: null },
    prospect_candidates: { data: null, error: { message: 'boom' } },
    prospect_discarded_dispositions: { data: null, error: { message: 'boom' } },
  });
  const rows = await buildCoSiisDiscoverySnapshotQuery(client)({ macroIndustryKey: 'health_pharma', ciiuCodes: ['2100'], limit: 10 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.prior_sighting, null);
});

test('Gobierno se lee del directorio de entidades públicas, por servidores y con su mínimo', async () => {
  const { client, calls } = fakeClient({
    source_company_snapshots: {
      data: [
        {
          record_identity_key: 'tax:800099095',
          legal_name: 'Ipiales',
          normalized_legal_name: 'IPIALES',
          tax_id: '800099095',
          sector: 'Alcaldía',
          city: 'IPIALES',
          department: 'NARIÑO',
          raw_data: { website_domain: 'ipiales-narino.gov.co', macro_industry_key: 'government', workers: 412 },
        },
      ],
      error: null,
    },
  });
  const rows = await buildCoSiisDiscoverySnapshotQuery(client)({ macroIndustryKey: 'government', ciiuCodes: [], limit: 10 });

  const snapshot = siisCalls(calls);
  assert.deepEqual(
    snapshot.filter((c) => c.method === 'eq').map((c) => c.args),
    [
      ['source_key', 'co_public_entities'],
      ['country_code', 'CO'],
      ['raw_data->>macro_industry_key', 'government'],
    ],
  );
  assert.deepEqual(snapshot.find((c) => c.method === 'gte')?.args, ['priority_score', CO_PUBLIC_ENTITY_DISCOVERY_MIN_WORKERS]);
  assert.deepEqual(snapshot.find((c) => c.method === 'order')?.args, ['priority_score', { ascending: false }]);
  assert.equal(rows[0]?.workers, 412);
  assert.equal(rows[0]?.macro_industry_key, 'government');
  assert.equal(rows[0]?.website_domain, 'ipiales-narino.gov.co');
  assert.equal(rows[0]?.origin, 'public_entity');
});

/* ─────────────────────────────────────────────────────────────────────────────
 * AGENT1-CO-SIIS-CIIU-NUMERIC-FIX-1 — el CIIU llega como NÚMERO JSON.
 * En Producción `jsonb_typeof(raw_data->'CIIU')` es `number` en 10.000/10.000
 * filas: el fixture tiene que reproducir la fuente, no una forma idealizada.
 * ────────────────────────────────────────────────────────────────────────────*/

test('🔴 el CIIU numérico de Producción se recupera como texto, no se descarta', async () => {
  const { client } = fakeClient({ source_company_snapshots: { data: [siisRow('r1')], error: null } });
  const rows = await buildCoSiisDiscoverySnapshotQuery(client)({ macroIndustryKey: 'health_pharma', ciiuCodes: ['2100'], limit: 10 });
  assert.equal(rows[0]?.ciiu, '2100');
});

test('el cero a la izquierda perdido sigue viajando sin canonizar en esta capa', async () => {
  const { client } = fakeClient({ source_company_snapshots: { data: [siisRow('r1', { raw_data: { CIIU: 111 } })], error: null } });
  const rows = await buildCoSiisDiscoverySnapshotQuery(client)({ macroIndustryKey: 'agroindustry', ciiuCodes: ['0111'], limit: 10 });

  assert.equal(rows[0]?.ciiu, '111');
  assert.equal(getCiiuSectorDescriptionExact(rows[0]?.ciiu ?? null), 'Cultivo de cereales');
});

test('la normalización del CIIU es fail-closed para todo lo que no es un código', async () => {
  const cases: ReadonlyArray<{ label: string; raw: unknown; expected: string | null }> = [
    { label: 'number entero', raw: 2100, expected: '2100' },
    { label: 'number sin cero inicial', raw: 111, expected: '111' },
    { label: 'string', raw: '2100', expected: '2100' },
    { label: 'string con relleno', raw: '0111', expected: '0111' },
    { label: 'string con espacios', raw: ' 2100 ', expected: '2100' },
    { label: 'string vacía', raw: '   ', expected: null },
    { label: 'null', raw: null, expected: null },
    { label: 'undefined', raw: undefined, expected: null },
    { label: 'decimal', raw: 21.5, expected: null },
    { label: 'negativo', raw: -2100, expected: null },
    { label: 'cero', raw: 0, expected: null },
    { label: 'NaN', raw: Number.NaN, expected: null },
    { label: 'Infinity', raw: Number.POSITIVE_INFINITY, expected: null },
    { label: 'boolean', raw: true, expected: null },
    { label: 'object', raw: { code: '2100' }, expected: null },
    { label: 'array', raw: ['2100'], expected: null },
  ];
  const { client } = fakeClient({
    source_company_snapshots: {
      data: cases.map((c, i) => siisRow(`r${i}`, { raw_data: { CIIU: c.raw } })),
      error: null,
    },
  });
  const rows = await buildCoSiisDiscoverySnapshotQuery(client)({ macroIndustryKey: 'health_pharma', ciiuCodes: ['2100'], limit: cases.length });

  assert.equal(rows.length, cases.length);
  for (const [i, expectation] of cases.entries()) {
    assert.equal(rows[i]?.ciiu, expectation.expected, `${expectation.label}`);
  }
});

test('raw_data ausente o nulo no rompe la proyección', async () => {
  const { client } = fakeClient({
    source_company_snapshots: { data: [siisRow('r1', { raw_data: null }), siisRow('r2', { raw_data: {} })], error: null },
  });
  const rows = await buildCoSiisDiscoverySnapshotQuery(client)({ macroIndustryKey: 'health_pharma', ciiuCodes: ['2100'], limit: 10 });
  assert.equal(rows[0]?.ciiu, null);
  assert.equal(rows[1]?.ciiu, null);
  assert.equal(rows[0]?.website_domain, null);
});

test('extremo a extremo: CIIU numérico ⇒ Salud, con su web y su industria declarada', async () => {
  const { client } = fakeClient({
    source_company_snapshots: {
      data: [siisRow('tax:900000001', { raw_data: { CIIU: 2100, website_domain: 'labx.com.co' } })],
      error: null,
    },
  });
  const adapter = buildCoSiisDiscoveryAdapter(buildCoSiisDiscoverySnapshotQuery(client));
  const result = await adapter({ macroIndustryKey: 'health_pharma', countryCode: 'CO', limit: 5 });

  assert.equal(result.companies.length, 1);
  assert.equal(result.companies[0]?.industryCode, '2100');
  assert.equal(result.companies[0]?.declaredIndustry, 'Fabricación de productos farmacéuticos');
  assert.equal(result.companies[0]?.domain, 'labx.com.co');
});
