/**
 * A1-APOLLO-EMPLOYEE-FILTER-200-1 — el filtro de 200+ en el BODY que sale.
 *
 * Mide el body y su huella, no la intención. Es la disciplina que ya gobierna
 * `effectiveRequestFingerprint` en esta cadena: un test que afirme «el mapper
 * sabe traducir» no dice nada sobre lo que Apollo recibe, y eso es exactamente
 * cómo el filtro pudo estar ausente en las 87 búsquedas de Producción con toda
 * la suite del mapper en verde.
 *
 * Offline: construye el request SIN emitirlo. Cero HTTP, cero créditos, cero
 * Supabase. `buildApolloOrganizationsEffectiveRequest` es puro por contrato — es
 * la misma función que la ruta real usa para decidir gasto sin gastar.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildApolloOrganizationsEffectiveRequest,
} from '../apollo-organizations-effective-request';
import { mapEmployeeThresholdToApolloRanges } from '../apollo-organizations-query-mapping';
import { APOLLO_ORGANIZATIONS_ALLOWED_PARAMS } from '../apollo-organizations-request-contract';
import type { WebSearchInput } from '../types';
import {
  buildRound1Hypothesis,
  toQueryHypothesisMetadata,
} from '../apollo-two-round/query-hypothesis';

// ── Contrato de rangos del hito ──────────────────────────────────────────────
//
// «200+ empleados» = `>= 200`, así que el primer rango INCLUYE 200. El techo
// `"50000,1000000"` se conserva porque Apollo no documenta extremo abierto: no
// existe forma de pedir «50.000 o más» sin nombrar un máximo.

const EXPECTED_RANGES_200 = [
  '200,500',
  '500,1000',
  '1000,5000',
  '5000,10000',
  '10000,20000',
  '20000,50000',
  '50000,1000000',
];

const THRESHOLD = 200;

function makeInput(overrides?: Partial<WebSearchInput>): WebSearchInput {
  return {
    query: 'Gobierno en Colombia — entidades nacionales y descentralizadas',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Gobierno',
    intent: 'company_discovery',
    provider: 'apollo_organizations',
    maxResults: 5,
    subindustries: [],
    additionalCriteriaTokens: ['entidad publica', 'ministerio'],
    targetEmployeeThreshold: THRESHOLD,
    ...overrides,
  };
}

function buildEffective(input: WebSearchInput) {
  return buildApolloOrganizationsEffectiveRequest({
    input,
    requestedMaxResults: input.maxResults ?? 5,
    resultLimitMode: 'two_round',
    twoRoundMaxResultsPerRound: 10,
    startPage: 1,
    legacyMaxResultsPerQuery: 3,
  });
}

// ── Test 2 — el request final lleva los rangos ───────────────────────────────

describe('Test 2 — organization_num_employees_ranges existe en el body y no está vacío', () => {
  it('el body del contrato lleva los siete rangos esperados', () => {
    const effective = buildEffective(makeInput());
    const ranges = effective.body.organization_num_employees_ranges;

    assert.ok(ranges !== undefined, 'la clave debe EXISTIR en el body');
    assert.ok(Array.isArray(ranges), 'debe ser un array');
    assert.notDeepEqual(ranges, [], 'NO puede ser []');
    assert.deepEqual(ranges, EXPECTED_RANGES_200);
  });

  it('el primer rango incluye 200 — el requisito es >= 200, no > 200', () => {
    const effective = buildEffective(makeInput());
    const [first] = effective.body.organization_num_employees_ranges ?? [];
    assert.equal(first, '200,500');
    assert.notEqual(first, '201,500');
  });

  it('effectiveEmployeeRanges refleja exactamente el body — no una intención previa', () => {
    const effective = buildEffective(makeInput());
    assert.deepEqual(
      effective.effectiveEmployeeRanges,
      effective.body.organization_num_employees_ranges,
    );
  });

  it('sin umbral el body OMITE la clave — comportamiento previo al hito intacto', () => {
    const effective = buildEffective(makeInput({ targetEmployeeThreshold: null }));
    assert.equal(effective.body.organization_num_employees_ranges, undefined);
    assert.deepEqual(effective.effectiveEmployeeRanges, []);
  });

  it('el parámetro está en el allowlist del contrato — no viaja por una costura', () => {
    assert.ok(
      (APOLLO_ORGANIZATIONS_ALLOWED_PARAMS as readonly string[]).includes(
        'organization_num_employees_ranges',
      ),
    );
  });
});

// ── Test 3 — huella del request efectivo ─────────────────────────────────────

describe('Test 3 — la huella del request efectivo incluye los rangos', () => {
  it('effectiveRequestFingerprint contiene organization_num_employees_ranges=', () => {
    const effective = buildEffective(makeInput());
    assert.ok(
      effective.effectiveRequestFingerprint.includes('organization_num_employees_ranges='),
      `la huella debe declarar el filtro de tamaño; era: ${effective.effectiveRequestFingerprint}`,
    );
  });

  it('filtersFingerprint —el ancla idempotente paginada— también lo declara', () => {
    const effective = buildEffective(makeInput());
    assert.ok(
      effective.filtersFingerprint.includes('organization_num_employees_ranges='),
      `la huella de filtros debe declarar el filtro de tamaño; era: ${effective.filtersFingerprint}`,
    );
  });

  it('la huella CAMBIA al añadir el filtro — dedupe e idempotencia lo notan', () => {
    // Es la consecuencia operativa del hito y se declara a propósito: ninguna
    // huella histórica —todas sin rangos— coincide con las nuevas. Una corrida
    // con filtro no puede reutilizar la decisión económica de una sin filtro.
    const withFilter = buildEffective(makeInput());
    const withoutFilter = buildEffective(makeInput({ targetEmployeeThreshold: null }));

    assert.notEqual(
      withFilter.effectiveRequestFingerprint,
      withoutFilter.effectiveRequestFingerprint,
    );
  });
});

// ── Test 4 — queryContext de la modalidad de dos rondas ──────────────────────

describe('Test 4 — la metadata de la hipótesis coincide con los rangos del body', () => {
  it('organization_num_employees_ranges de la metadata == los del body', () => {
    const effective = buildEffective(makeInput());

    // El `queryContext` de producción deriva `employeeRanges` del MISMO traductor
    // (ver la valla estática en `apollo-employee-filter-200-static-guard.test.ts`).
    const hypothesis = buildRound1Hypothesis(
      {
        country: 'Colombia',
        countryCode: 'CO',
        sector: 'Gobierno',
        subindustries: [],
        employeeRanges: mapEmployeeThresholdToApolloRanges(THRESHOLD),
      },
      5,
    );
    const meta = toQueryHypothesisMetadata(hypothesis);
    const sanitized = meta['query_parameters_sanitized'] as Record<string, unknown>;

    assert.deepEqual(sanitized['organization_num_employees_ranges'], EXPECTED_RANGES_200);
    // La afirmación que importa: la metadata NO puede decir [] mientras el body
    // lleva rangos. Éste era el defecto observable en `provider_usage_logs`.
    assert.deepEqual(
      sanitized['organization_num_employees_ranges'],
      effective.body.organization_num_employees_ranges,
    );
  });

  it('la huella del proveedor de la ronda declara los rangos', () => {
    const hypothesis = buildRound1Hypothesis(
      {
        country: 'Colombia',
        countryCode: 'CO',
        sector: 'Gobierno',
        subindustries: [],
        employeeRanges: mapEmployeeThresholdToApolloRanges(THRESHOLD),
      },
      5,
    );
    assert.ok(
      hypothesis.providerRequestFingerprint.includes('organization_num_employees_ranges='),
    );
    assert.ok(
      hypothesis.providerRequestFingerprint.includes('200,500'),
      `la huella de la ronda debe nombrar el primer rango; era: ${hypothesis.providerRequestFingerprint}`,
    );
  });
});

// ── Test 5 — formato exigido por la documentación de Apollo ──────────────────

describe('Test 5 — formato de cada rango: ^\\d+,\\d+$', () => {
  const FORMAT = /^\d+,\d+$/;

  it('todo rango del body cumple min,max sin espacios ni signos', () => {
    const effective = buildEffective(makeInput());
    for (const range of effective.body.organization_num_employees_ranges ?? []) {
      assert.match(range, FORMAT, `rango con formato inválido: "${range}"`);
    }
  });

  it('el traductor no emite "200+", "200," ni "200, 500" en ningún umbral', () => {
    for (const threshold of [200, 500, 1000, 5000, 10000, 20000, 50000, 123]) {
      const ranges = mapEmployeeThresholdToApolloRanges(threshold);
      for (const range of ranges) {
        assert.match(range, FORMAT, `umbral ${threshold} produjo "${range}"`);
        assert.ok(!range.includes('+'), `"${range}" no puede llevar '+'`);
        assert.ok(!range.includes(' '), `"${range}" no puede llevar espacios`);
        assert.ok(!range.endsWith(','), `"${range}" no puede tener extremo abierto`);
      }
    }
  });

  it('cada rango es un intervalo ascendente y no degenerado', () => {
    for (const range of mapEmployeeThresholdToApolloRanges(THRESHOLD)) {
      const [min, max] = range.split(',').map((n) => Number.parseInt(n, 10));
      assert.ok(Number.isInteger(min) && Number.isInteger(max));
      assert.ok(min < max, `"${range}" debe ser ascendente`);
    }
  });

  it('los rangos cubren desde el umbral sin dejar hueco entre buckets', () => {
    // Un hueco significaría empresas del tamaño pedido que Apollo nunca
    // devolvería. El solapamiento en los bordes es deliberado: Apollo evalúa
    // los rangos en OR, así que un borde compartido no duplica resultados.
    const ranges = mapEmployeeThresholdToApolloRanges(THRESHOLD);
    const bounds = ranges.map((r) => r.split(',').map((n) => Number.parseInt(n, 10)));

    assert.equal(bounds[0][0], THRESHOLD, 'el primer bucket arranca en el umbral');
    for (let i = 1; i < bounds.length; i += 1) {
      assert.ok(
        bounds[i][0] <= bounds[i - 1][1],
        `hueco entre "${ranges[i - 1]}" y "${ranges[i]}"`,
      );
    }
  });
});
