/**
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 11, 18 — la exclusión de
 * dominios en la petición REAL a Lusha.
 *
 * Lo que estas pruebas defienden, dicho como defecto: emitir una exclusión que el
 * contrato del proveedor no soporta hace fallar la petición ENTERA con HTTP 400 —
 * el repo ya lo verificó con `sics` y con `naics`— y emitir un `exclude` vacío
 * ensucia la petición sin excluir nada.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLushaPreviewRequest } from '@/server/prospect-batches/lusha-preview';

const BASE = {
  countryName: 'Colombia',
  mainIndustriesIds: [11],
  subIndustryId: null,
  sizeBand: { min: 201, max: 5000 },
  searchText: null,
  page: 0,
};

test('§ 11 — los dominios conocidos viajan en filters.companies.exclude.domains', () => {
  const request = buildLushaPreviewRequest({
    ...BASE,
    excludeDomains: ['conocida.example', 'otra.example'],
  });

  assert.deepEqual(request.filters?.companies?.exclude?.domains, [
    'conocida.example',
    'otra.example',
  ]);
  // Y el include sigue intacto: la exclusión es aditiva.
  assert.deepEqual(request.filters?.companies?.include?.mainIndustriesIds, [11]);
});

test('sin dominios conocidos, la petición es la de siempre: NO se emite `exclude`', () => {
  for (const excludeDomains of [undefined, null, [], ['', '   ']]) {
    const request = buildLushaPreviewRequest({ ...BASE, excludeDomains });
    assert.equal(
      request.filters?.companies?.exclude,
      undefined,
      `un exclude vacío no debe emitirse (${JSON.stringify(excludeDomains)})`,
    );
  }
});

test('🔴 § 18 — NO se emite ninguna exclusión que el contrato no pruebe', () => {
  const request = buildLushaPreviewRequest({
    ...BASE,
    excludeDomains: ['conocida.example'],
  });
  const exclude = request.filters?.companies?.exclude as Record<string, unknown> | undefined;
  assert.ok(exclude);
  // El contrato verificado de Lusha V3 sólo tiene `domains`. Nombres, LinkedIn,
  // identificadores fiscales e ids de empresa NO están probados y una propiedad
  // desconocida hace fallar la petición entera.
  assert.deepEqual(Object.keys(exclude), ['domains']);
});

test('la exclusión no altera paginación, tamaño ni opciones', () => {
  const withExclusion = buildLushaPreviewRequest({ ...BASE, excludeDomains: ['x.example'] });
  const without = buildLushaPreviewRequest({ ...BASE });

  assert.deepEqual(withExclusion.pagination, without.pagination);
  assert.deepEqual(withExclusion.options, without.options);
  // `signals` sigue ausente: nunca se emite en preview (puede generar cargos).
  assert.equal(withExclusion.signals, undefined);
});
