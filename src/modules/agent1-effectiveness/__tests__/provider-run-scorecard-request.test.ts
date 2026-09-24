/**
 * AGENT1-PROVIDER-RUN-SCORECARD-1 — la entrada de la ficha (URL) y su lectura.
 *
 *   § 1 · los parámetros de la URL son dato no confiable: se validan;
 *   § 2 · la lectura pagina hasta agotar: Supabase corta cada respuesta en
 *         1.000 filas aunque se pida más, y sin paginar se truncaría en silencio;
 *   § 3 · la lectura es de SÓLO lectura, y la ruta exige administrador.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  parseProviderRunScorecardRequest,
  SCORECARD_MAX_WINDOW_DAYS,
} from '../provider-run-scorecard-request';
import { fetchAllPages } from '../provider-run-scorecard-queries';

const parse = (query: string) => parseProviderRunScorecardRequest(new URLSearchParams(query));

describe('§ 1 — parámetros', () => {
  test('una fecha sola es un día, con fin exclusivo', () => {
    const r = parse('from=2026-09-24');
    assert.ok(r.ok);
    assert.equal(r.request.dateFrom, '2026-09-24T00:00:00.000Z');
    assert.equal(r.request.dateTo, '2026-09-25T00:00:00.000Z');
    assert.deepEqual(r.request.usdPerCreditOverride, { apollo: null, lusha: null });
  });

  test('filtros y precio simulado válidos', () => {
    const r = parse(
      'from=2026-09-01&to=2026-10-01&country=CO&industry=Retail&lusha_usd_per_credit=0.00735',
    );
    assert.ok(r.ok);
    assert.equal(r.request.countryCode, 'CO');
    assert.equal(r.request.industry, 'Retail');
    assert.equal(r.request.usdPerCreditOverride.lusha, 0.00735);
  });

  test('la industria acepta acentos y «&», como en el catálogo', () => {
    assert.ok(parse('from=2026-09-24&industry=Salud %26 Farmacéuticos').ok);
    assert.ok(parse('from=2026-09-24&industry=Tecnología').ok);
  });

  const invalid: [string, string][] = [
    ['sin from', ''],
    ['from con formato inválido', 'from=24-09-2026'],
    ['from inexistente', 'from=2026-02-30'],
    ['to anterior a from', 'from=2026-09-24&to=2026-09-20'],
    ['to igual a from', 'from=2026-09-24&to=2026-09-24'],
    ['ventana demasiado larga', 'from=2026-01-01&to=2026-12-31'],
    ['país en minúsculas', 'from=2026-09-24&country=co'],
    ['país de 3 letras', 'from=2026-09-24&country=COL'],
    ['industria con inyección', "from=2026-09-24&industry=Retail');drop"],
    ['precio negativo', 'from=2026-09-24&lusha_usd_per_credit=-1'],
    ['precio cero', 'from=2026-09-24&lusha_usd_per_credit=0'],
    ['precio absurdo', 'from=2026-09-24&apollo_usd_per_credit=500'],
    ['precio no numérico', 'from=2026-09-24&lusha_usd_per_credit=barato'],
  ];
  for (const [label, query] of invalid) {
    test(`${label} ⇒ rechazado con un mensaje`, () => {
      const r = parse(query);
      assert.equal(r.ok, false);
      assert.ok(!r.ok && r.error.length > 0);
    });
  }

  test(`la ventana máxima es de ${SCORECARD_MAX_WINDOW_DAYS} días`, () => {
    assert.ok(parse('from=2026-07-01&to=2026-10-02').ok);
  });
});

describe('§ 2 — la lectura pagina hasta agotar', () => {
  function fakePager(total: number) {
    const calls: [number, number][] = [];
    const page = (from: number, to: number) => {
      calls.push([from, to]);
      const rows = Array.from(
        { length: Math.max(0, Math.min(to, total - 1) - from + 1) },
        (_, i) => from + i,
      );
      return Promise.resolve({ data: rows, error: null });
    };
    return { calls, page };
  }

  test('🔴 2.350 filas ⇒ tres páginas y ninguna fila perdida', async () => {
    const { calls, page } = fakePager(2350);
    const rows = await fetchAllPages('prueba', page);
    assert.equal(rows.length, 2350);
    assert.deepEqual(calls, [
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  test('exactamente 1.000 filas pide una página más para confirmar el final', async () => {
    const { calls, page } = fakePager(1000);
    assert.equal((await fetchAllPages('prueba', page)).length, 1000);
    assert.equal(calls.length, 2);
  });

  test('un error de la base falla en voz alta, con la tabla', async () => {
    await assert.rejects(
      fetchAllPages('prospect_candidates', () =>
        Promise.resolve({ data: null, error: { message: 'boom' } }),
      ),
      /prospect_candidates: boom/,
    );
  });
});

describe('§ 3 — sólo lectura y sólo administradores', () => {
  const root = path.resolve(__dirname, '../../../..');
  const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

  test('la capa de lectura no escribe, no llama RPC y no toca proveedores', () => {
    const source = read('src/modules/agent1-effectiveness/provider-run-scorecard-queries.ts');
    for (const forbidden of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(', 'fetch(']) {
      assert.equal(source.includes(forbidden), false, `aparece ${forbidden}`);
    }
  });

  test('la ruta exige sesión y `is_admin` antes de leer nada', () => {
    const route = read('src/app/api/debug/agent1-provider-scorecard/route.ts');
    const auth = route.indexOf('auth.getUser()');
    const admin = route.indexOf("rpc('is_admin'");
    const load = route.indexOf('loadProviderRunScorecardInput(parsed.request)');
    assert.ok(auth > 0 && admin > auth && load > admin, 'orden: sesión → admin → lectura');
    assert.match(route, /status: 401/);
    assert.match(route, /status: 403/);
  });
});
