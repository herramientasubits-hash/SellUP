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
import { buildCoSiisDiscoveryAdapter } from '../co-siis-discovery-adapter';
import { getCiiuSectorDescriptionExact } from '@/server/source-catalog/connectors/socrata-colombia/normalizers';

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

/* ─────────────────────────────────────────────────────────────────────────────
 * AGENT1-CO-SIIS-CIIU-NUMERIC-FIX-1 — el CIIU llega como NÚMERO JSON.
 *
 * 🔴 Por qué el defecto sobrevivió a la suite anterior: el único fixture que
 * ejercía la proyección usaba `CIIU: '2100'`, una CADENA. En Producción
 * `jsonb_typeof(raw_data->'CIIU')` es `number` en 10.000/10.000 filas, así que la
 * prueba verde describía una forma del dato que la tabla no tiene. La lección no
 * es «faltaba un caso» sino que el fixture no reproducía la fuente.
 * ────────────────────────────────────────────────────────────────────────────*/

/** Construye una fila del snapshot variando SÓLO el CIIU crudo. */
function rowWithRawCiiu(key: string, rawCiiu: unknown): Record<string, unknown> {
  return {
    record_identity_key: key,
    legal_name: 'LABORATORIO X',
    normalized_legal_name: 'laboratorio x',
    tax_id: '900000001',
    sector: 'MANUFACTURA',
    city: 'BOGOTA',
    department: 'BOGOTA D.C.',
    raw_data: { CIIU: rawCiiu, 'INGRESOS OPERACIONALES 2024': 123 },
  };
}

test('🔴 el CIIU numérico de Producción se recupera como texto, no se descarta', async () => {
  // La forma REAL: `raw_data.CIIU` es `number`. Antes del fix esto era `null` y
  // con él se caía toda la evidencia declarada de la fuente gratuita.
  const { client } = fakeClient({ data: [rowWithRawCiiu('r1', 2100)], error: null });
  const rows = await buildCoSiisDiscoverySnapshotQuery(client)({
    ciiuCodes: ['2100'],
    limit: 10,
  });

  assert.equal(rows[0]?.ciiu, '2100');
});

test('el cero a la izquierda perdido sigue viajando sin canonizar en esta capa', async () => {
  // 575 de 10.000 filas guardan '0111' como 111. La consulta NO rellena el cero:
  // `getCiiuSectorDescriptionExact` es el único autorizado a hacerlo, y lo hace.
  const { client } = fakeClient({ data: [rowWithRawCiiu('r1', 111)], error: null });
  const rows = await buildCoSiisDiscoverySnapshotQuery(client)({
    ciiuCodes: ['0111'],
    limit: 10,
  });

  assert.equal(rows[0]?.ciiu, '111');
  assert.equal(getCiiuSectorDescriptionExact(rows[0]?.ciiu ?? null), 'Cultivo de cereales');
});

test('la normalización del CIIU es fail-closed para todo lo que no es un código', async () => {
  const cases: ReadonlyArray<{ label: string; raw: unknown; expected: string | null }> = [
    // Lo que Producción entrega hoy.
    { label: 'number entero', raw: 2100, expected: '2100' },
    { label: 'number sin cero inicial', raw: 111, expected: '111' },
    // La forma histórica, que sigue siendo válida.
    { label: 'string', raw: '2100', expected: '2100' },
    { label: 'string con relleno', raw: '0111', expected: '0111' },
    { label: 'string con espacios', raw: ' 2100 ', expected: '2100' },
    { label: 'string vacía', raw: '   ', expected: null },
    // Ausencia.
    { label: 'null', raw: null, expected: null },
    { label: 'undefined', raw: undefined, expected: null },
    // 🔴 Datos corruptos: NO se les adivina una intención. Redondear un decimal o
    // tomar el valor absoluto de un negativo FABRICARÍA un código que la fuente
    // nunca declaró, y ese código confirmaría una macro industria.
    { label: 'decimal', raw: 21.5, expected: null },
    { label: 'negativo', raw: -2100, expected: null },
    { label: 'cero', raw: 0, expected: null },
    { label: 'NaN', raw: Number.NaN, expected: null },
    { label: 'Infinity', raw: Number.POSITIVE_INFINITY, expected: null },
    // Tipos que no son escalares de texto ni número.
    { label: 'boolean true', raw: true, expected: null },
    { label: 'boolean false', raw: false, expected: null },
    { label: 'object', raw: { code: '2100' }, expected: null },
    { label: 'array', raw: ['2100'], expected: null },
  ];

  const { client } = fakeClient({
    data: cases.map((c, i) => rowWithRawCiiu(`r${i}`, c.raw)),
    error: null,
  });
  const rows = await buildCoSiisDiscoverySnapshotQuery(client)({
    ciiuCodes: ['2100'],
    limit: cases.length,
  });

  assert.equal(rows.length, cases.length);
  for (const [i, expectation] of cases.entries()) {
    assert.equal(
      rows[i]?.ciiu,
      expectation.expected,
      `${expectation.label}: se esperaba ${JSON.stringify(expectation.expected)}`,
    );
  }
});

test('raw_data ausente o nulo no rompe la proyección', async () => {
  const { client } = fakeClient({
    data: [
      { ...rowWithRawCiiu('r1', 2100), raw_data: null },
      { ...rowWithRawCiiu('r2', 2100), raw_data: {} },
    ],
    error: null,
  });
  const rows = await buildCoSiisDiscoverySnapshotQuery(client)({
    ciiuCodes: ['2100'],
    limit: 10,
  });

  assert.equal(rows[0]?.ciiu, null);
  assert.equal(rows[1]?.ciiu, null);
});

/**
 * 🔴 La prueba que cierra el hito: la forma REAL del dato atravesando LAS DOS
 * capas hasta la industria declarada. Es el eslabón que faltaba — la consulta y
 * el adapter se probaban por separado, y el defecto vivía justo en la costura.
 */
test('extremo a extremo: CIIU numérico ⇒ industria declarada de health_pharma', async () => {
  const { client } = fakeClient({ data: [rowWithRawCiiu('r1', 2100)], error: null });
  const adapter = buildCoSiisDiscoveryAdapter(buildCoSiisDiscoverySnapshotQuery(client));

  const result = await adapter({
    macroIndustryKey: 'health_pharma',
    countryCode: 'CO',
    limit: 5,
  });

  assert.equal(result.recordsRead, 1);
  assert.equal(result.companies.length, 1);
  assert.equal(result.companies[0]?.industryCode, '2100');
  assert.equal(
    result.companies[0]?.declaredIndustry,
    'Fabricación de productos farmacéuticos',
  );
});
