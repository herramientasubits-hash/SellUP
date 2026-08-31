/**
 * AGENT1-LUSHA-CUT-L1-CLIENT-SIDE-EXCLUSION §§ 1, 2, 10 (L1-A) — la petición REAL
 * a Lusha, y el bloque de exclusión que NO puede volver a aparecer en ella.
 *
 * ── 🔴 RATCHET INVERTIDO ─────────────────────────────────────────────────────
 *
 * Este archivo fijaba lo contrario. Se llamaba «los dominios conocidos viajan en
 * `filters.companies.exclude.domains`» y afirmaba que ése era el contrato
 * verificado de Lusha V3. El soporte HUMANO de Lusha confirmó que NO existe
 * exclusión del lado del servidor en `POST /v3/companies/prospecting`: ni
 * `excludeDomains` ni `excludeCompanyIds`.
 *
 * Un trinquete que fija el valor defectuoso bloquea su corrección, así que la
 * cobertura no se borra: se invierte. Lo que se defiende ahora, dicho como
 * defecto: emitir una exclusión que el contrato no soporta hace fallar la petición
 * ENTERA con HTTP 400 —el repo ya lo verificó con `sics` y con `naics`— y ya se
 * sabe que `exclude` está en esa familia.
 *
 * 🔴 Lo que este corte NO puede hacer, y no se afirma en ninguna prueba: ahorrar
 * el crédito de Prospecting de una empresa histórica. Sin exclusión previa al
 * cobro, la respuesta llega —y puede cobrarse— antes de que se la reconozca.
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

/**
 * La forma cruda de la petición. Se inspecciona por `Record` y no por el tipo,
 * porque el tipo YA no declara `exclude`: si se leyera tipado, la prueba se
 * limitaría a repetir lo que el compilador acaba de decir, y no vería una
 * propiedad colada por un `as any` o por un objeto construido a mano.
 */
function rawCompanies(request: unknown): Record<string, unknown> {
  const filters = (request as Record<string, Record<string, unknown>>).filters;
  return filters.companies as Record<string, unknown>;
}

test('🔴 L1-A · la petición NUNCA emite filters.companies.exclude', () => {
  const request = buildLushaPreviewRequest({ ...BASE });
  const companies = rawCompanies(request);

  assert.equal(companies.exclude, undefined, '🔴 no hay bloque de exclusión');
  assert.deepEqual(
    Object.keys(companies),
    ['include'],
    '🔴 SÓLO inclusión: cualquier otra clave sería un contrato inventado',
  );
});

test('🔴 L1-A · ni con dominios conocidos en la mano aparece una exclusión', () => {
  // La entrada del constructor ya NO tiene dónde poner una exclusión —el campo se
  // retiró del tipo— así que el intento se hace por la puerta de atrás, como lo
  // haría un llamador que reintrodujera el defecto con un cast.
  const sneaked = {
    ...BASE,
    excludeDomains: ['conocida.example', 'otra.example'],
    excludeCompanyIds: ['v1.ZpAq'],
  } as unknown as Parameters<typeof buildLushaPreviewRequest>[0];

  const companies = rawCompanies(buildLushaPreviewRequest(sneaked));

  assert.equal(companies.exclude, undefined, '🔴 el constructor lo ignora entero');
  assert.deepEqual(Object.keys(companies), ['include']);
  // Y no se ha sustituido por otro campo adivinado en la raíz de la petición.
  const serialized = JSON.stringify(buildLushaPreviewRequest(sneaked));
  for (const forbidden of ['exclude', 'excludeDomains', 'excludeCompanyIds']) {
    assert.ok(!serialized.includes(forbidden), `🔴 ${forbidden} no viaja en el cuerpo`);
  }
});

test('🔴 § 18 — no hay exclusión por nombre, LinkedIn, identidad fiscal ni id', () => {
  const include = rawCompanies(buildLushaPreviewRequest({ ...BASE })).include as Record<
    string,
    unknown
  >;

  // El include sigue siendo exactamente el de siempre: país, industria y tamaño.
  assert.deepEqual(include.mainIndustriesIds, [11]);
  assert.deepEqual(include.locations, [{ country: 'Colombia' }]);
  assert.deepEqual(include.sizes, [{ min: 201, max: 5000 }]);
  for (const forbidden of ['names', 'domains', 'linkedinUrls', 'taxIds', 'ids']) {
    assert.equal(include[forbidden], undefined, `🔴 ${forbidden} no se emite`);
  }
});

test('🔴 L1-F · retirar la exclusión no toca paginación, tamaño ni opciones', () => {
  const request = buildLushaPreviewRequest({ ...BASE });

  // Los invariantes económicos del preview son los de siempre: página server
  // authoritative y tamaño fijo. Este corte es de CONTRATO, no monetario.
  assert.deepEqual(request.pagination, { page: 0, size: 10 });
  assert.deepEqual(request.options, { includePartialProfiles: false });
  // `signals` sigue ausente: nunca se emite en preview (puede generar cargos).
  assert.equal(request.signals, undefined);
});
