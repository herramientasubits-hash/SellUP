/**
 * agent1-multi-subindustry-query-drafting-anyof-1.test.ts
 *
 * AGENT1-MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 · §§ 1–12.
 *
 * Reproduce la corrida live `ce957e2f-13f9-430c-9595-9c0b1ad32353`
 * (`wizard_run_id = aec8c217cb35c28b84b25a178d7cee5a`): Colombia · Retail y
 * Consumo · dos subindustrias pedidas, en este orden exacto
 *
 *   1. Tiendas por Departamento, Moda y Calzado
 *   2. Supermercados e Hipermercados
 *
 * La solicitud llegó íntegra al runner (PR #245 lo dejó demostrado: UI 2,
 * request 2, batch 2, runner 2). Lo que salió hacia Apollo, leído del lote real,
 * fue:
 *
 *   round_1_effective_keywords_sent = [supermercado, hipermercado, grocery,
 *                                      retailer, retail chain]
 *   round_2_effective_keywords_sent = [supermercado, hipermercado, grocery,
 *                                      cadena de tiendas, grocery retail]
 *
 * Las tres primeras posiciones son el catálogo de «Supermercados e
 * Hipermercados»; las otras dos, el respaldo GENÉRICO del sector. «Tiendas por
 * Departamento, Moda y Calzado» —la PRIMERA selección del usuario— no aportó ni
 * una posición en ninguna de las dos rondas: 21 créditos, 20 organizaciones
 * únicas, 1 enrichment, 0 candidatos.
 *
 * Todo offline y por inyección de dependencias:
 *   LIVE_APOLLO_CALLS = 0 · LIVE_TAVILY_CALLS = 0 · APOLLO_CREDITS_USED = 0
 *   PRODUCTION_WRITES = 0 · HUBSPOT_WRITES = 0
 */

import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildApolloOrganizationsSearchParams,
  buildPrioritizedApolloKeywords,
  resolveApolloSubindustryQueryTerms,
} from '../apollo-organizations-query-mapping';
import {
  buildApolloOrganizationsEffectiveRequest,
  toApolloEffectiveRequestMetadata,
} from '../apollo-organizations-effective-request';
import { APOLLO_ORGANIZATIONS_ALLOWED_PARAMS } from '../apollo-organizations-request-contract';
import {
  APOLLO_SUBINDUSTRY_COVERAGE_BLOCK_COPY,
  APOLLO_SUBINDUSTRY_COVERAGE_BLOCK_REASON,
  apolloSubindustryCoverageFloor,
  computeApolloSubindustryQueryCoverage,
  evaluateApolloSubindustryCoverageSpendGate,
  interleaveApolloSubindustryTerms,
  resolveApolloSubindustryTermLists,
} from '../apollo-subindustry-query-terms';
import {
  evaluateApolloFreeSectorContradiction,
  evaluateApolloFreeSectorContradictionAnyOf,
  resolveAllApolloSubindustrySearchMappings,
  resolveApolloSubindustrySearchMapping,
} from '../apollo-subindustry-search-mapping';
import {
  buildRound1Hypothesis,
  buildRound2Hypothesis,
  resolveSectorSignalSets,
} from '../apollo-two-round/query-hypothesis';
import { estimateApolloTwoRoundBudget } from '../apollo-two-round/budget';
import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
  type RawDiscoveredOrganization,
  type RoundSearchOutcome,
} from '../apollo-two-round/orchestrator';
import { runApolloOrganizationsSearch } from '../web-search-providers/apollo-organizations-search-provider';
import { assessApolloSubindustryPrecisionForRequest } from '../apollo-subindustry-precision';
import {
  rejectedAssessment,
  testConfig,
  testCorrelation,
} from '../apollo-two-round/__tests__/fixtures';
import type { WebSearchInput, WebSearchResult } from '../types';

// ─── Contexto de la corrida live ──────────────────────────────────────────────

const LIVE_COUNTRY = 'Colombia';
const LIVE_INDUSTRY = 'Retail y Consumo';
const DEPARTMENT_STORE = 'Tiendas por Departamento, Moda y Calzado';
const SUPERMARKETS = 'Supermercados e Hipermercados';
/** Orden EXACTO de la solicitud live `ce957e2f`. */
const LIVE_SUBINDUSTRIES = [DEPARTMENT_STORE, SUPERMARKETS] as const;

/** Cinco subindustrias: el tope que el wizard permite (§ 4). */
const FIVE_SUBINDUSTRIES = [
  DEPARTMENT_STORE,
  SUPERMARKETS,
  'Educación Corporativa',
  'Ciberseguridad',
  'Packaging',
] as const;

const MAX_KEYWORDS = 5;

function buildEffective(input: {
  subindustries: readonly string[];
  industry?: string | null;
  additionalCriteriaTokens?: readonly string[];
  page?: number;
  query?: string;
  requestedResultLimit?: number;
}) {
  const requestedResultLimit = input.requestedResultLimit ?? 5;
  const searchInput: WebSearchInput = {
    query: input.query ?? 'consulta de descubrimiento',
    country: LIVE_COUNTRY,
    countryCode: 'CO',
    industry: input.industry === undefined ? LIVE_INDUSTRY : input.industry,
    intent: 'company_discovery',
    maxResults: requestedResultLimit,
    provider: 'apollo_organizations',
    subindustries: [...input.subindustries],
    additionalCriteriaTokens: [...(input.additionalCriteriaTokens ?? [])],
  };
  return buildApolloOrganizationsEffectiveRequest({
    input: searchInput,
    requestedMaxResults: requestedResultLimit,
    resultLimitMode: 'two_round',
    twoRoundMaxResultsPerRound: requestedResultLimit,
    startPage: input.page ?? 1,
    legacyMaxResultsPerQuery: 5,
  });
}

/** Resultado de búsqueda mínimo, con los campos que el contrato exige. */
function searchResult(overrides: Partial<WebSearchResult> & { title: string }): WebSearchResult {
  return {
    url: 'https://ejemplo.com',
    snippet: `Empresa: ${overrides.title}`,
    rank: 1,
    provider: 'apollo_organizations',
    ...overrides,
  };
}

/** ¿Alguno de los términos efectivos lleva esta señal? Normalizado. */
function hasSignal(keywords: readonly string[], signal: string): boolean {
  const normalized = keywords.map((keyword) => keyword.toLowerCase());
  return normalized.some((keyword) => keyword.includes(signal.toLowerCase()));
}

// ─── § 1: la causa raíz, nombrada ─────────────────────────────────────────────

describe('§ 1 · el resolvedor FIRST-ONLY ya no existe', () => {
  test('`resolveFirstApolloSubindustrySearchMapping` no se exporta', async () => {
    const mappingModule = await import('../apollo-subindustry-search-mapping');
    assert.equal(
      'resolveFirstApolloSubindustrySearchMapping' in mappingModule,
      false,
      'un resolvedor de un solo valor sin consumidores es una política FIRST-ONLY latente',
    );
  });

  test('`primarySubindustryForQueryDrafting` no se exporta', async () => {
    const runnerModule = await import('../apollo-two-round/production-runner.server');
    assert.equal('primarySubindustryForQueryDrafting' in runnerModule, false);
  });

  test('el resolvedor multi-valor devuelve TODAS las pedidas con mapping', () => {
    const resolved = resolveAllApolloSubindustrySearchMappings(LIVE_SUBINDUSTRIES);
    assert.equal(resolved.length, 2, 'las dos subindustrias de `ce957e2f` tienen mapping');
    assert.deepEqual(
      resolved.map((entry) => entry.mapping.canonicalSubindustry),
      [DEPARTMENT_STORE, SUPERMARKETS],
    );
    // La procedencia es la etiqueta EXACTA de la solicitud, no la canónica (§ 10 H).
    assert.deepEqual(resolved.map((entry) => entry.matchedInput), [...LIVE_SUBINDUSTRIES]);
  });

  test('sin mapping devuelve lista vacía, no una entrada inventada', () => {
    assert.deepEqual(resolveAllApolloSubindustrySearchMappings(['Subindustria Inexistente']), []);
    assert.deepEqual(resolveAllApolloSubindustrySearchMappings([]), []);
    assert.deepEqual(resolveAllApolloSubindustrySearchMappings(null), []);
  });
});

// ─── § 2: contrato ANY-OF de la consulta ──────────────────────────────────────

describe('§ 2 · las dos subindustrias viajan, con semántica ANY-OF', () => {
  test('A. una subindustria: la consulta es la de siempre', () => {
    const single = buildPrioritizedApolloKeywords({
      industry: LIVE_INDUSTRY,
      subindustries: [SUPERMARKETS],
      additionalCriteriaTokens: [],
    });
    // Los cinco primeros términos del catálogo de supermercados, sin intención
    // escrita que reclame posiciones: exactamente lo de antes del hito.
    assert.deepEqual(single.keywords, [
      'supermercado',
      'hipermercado',
      'grocery',
      'food retail',
      'cadena de supermercados',
    ]);
    assert.equal(single.subindustryCoverageFloor, 1);

    // Y con la intención de la hipótesis, la forma EXACTA que la ruta de dos
    // rondas produjo en la corrida live: tres señales propias + dos del sector.
    const withIntent = buildPrioritizedApolloKeywords({
      industry: LIVE_INDUSTRY,
      subindustries: [SUPERMARKETS],
      additionalCriteriaTokens: [
        'retailer',
        'retail chain',
        'retail store',
        'comercio minorista',
        'consumo masivo',
      ],
    });
    assert.deepEqual(withIntent.keywords, [
      'supermercado',
      'hipermercado',
      'grocery',
      'retailer',
      'retail chain',
    ]);
  });

  test('B. dos subindustrias: las DOS aportan términos efectivos', () => {
    const effective = buildEffective({ subindustries: LIVE_SUBINDUSTRIES });
    const coverage = effective.subindustryCoverage;

    assert.equal(coverage.requestedSubindustries.length, 2);
    assert.equal(coverage.coverageCount, 2);
    assert.deepEqual(coverage.uncoveredSubindustries, []);
    assert.equal(coverage.coverageRatio, 1);
    assert.equal(coverage.complete, true);

    // ANY-OF: un único array de keyword tags que puede casar con A o con B. NO se
    // concatenan en una frase que Apollo leería como AND.
    assert.ok(
      effective.effectiveKeywordTags.every((tag) => !tag.includes(' y ') || tag === 'ropa y calzado'),
    );
    assert.ok(coverage.effectiveKeywordsBySubindustry[DEPARTMENT_STORE].length > 0);
    assert.ok(coverage.effectiveKeywordsBySubindustry[SUPERMARKETS].length > 0);
  });

  test('el reparto es round-robin: la primera señal de cada subindustria va delante', () => {
    const effective = buildEffective({ subindustries: LIVE_SUBINDUSTRIES });
    assert.deepEqual(effective.effectiveKeywordTags.slice(0, 2), [
      'department store',
      'supermercado',
    ]);
  });

  test('la consulta NO se apoya en la palabra `retail` a secas', () => {
    const effective = buildEffective({ subindustries: LIVE_SUBINDUSTRIES });
    assert.equal(
      effective.effectiveKeywordTags.includes('retail'),
      false,
      '`retail` es substring de `retail banking`: es el modo de fallo de v1.16K-AC',
    );
  });
});

// ─── § 3: distribución entre rondas ───────────────────────────────────────────

describe('§ 3 · las DOS rondas conservan la cobertura', () => {
  const context = {
    country: LIVE_COUNTRY,
    countryCode: 'CO',
    sector: LIVE_INDUSTRY,
    subindustries: [...LIVE_SUBINDUSTRIES],
    targetLocations: [],
    employeeRanges: [],
  };

  test('la hipótesis de la ronda 1 lleva señales de las dos', () => {
    const round1 = buildRound1Hypothesis(context, 5);
    assert.ok(hasSignal(round1.queryParameters.keywordTags, 'department store'));
    assert.ok(hasSignal(round1.queryParameters.keywordTags, 'supermercado'));
    assert.equal(round1.sectorSignalsMissing, false);
  });

  test('la hipótesis de la ronda 2 también, con sus sinónimos', () => {
    const round2 = buildRound2Hypothesis(
      context,
      { remainingTarget: 5, excludedSeenOrganizationCount: 0, observedRejectionReasons: [] },
      5,
    );
    assert.ok(hasSignal(round2.queryParameters.keywordTags, 'department store'));
    assert.ok(hasSignal(round2.queryParameters.keywordTags, 'supermercado'));
    assert.notEqual(
      round2.providerRequestFingerprint,
      buildRound1Hypothesis(context, 5).providerRequestFingerprint,
      'la ronda 2 tiene que pedir algo distinto',
    );
  });

  test('ninguna ronda representa sólo a la primera selección', () => {
    for (const page of [1, 2]) {
      const effective = buildEffective({ subindustries: LIVE_SUBINDUSTRIES, page });
      assert.deepEqual(
        effective.subindustryCoverage.uncoveredSubindustries,
        [],
        `la ronda de la página ${page} deja una subindustria fuera`,
      );
    }
  });

  test('las exclusiones locales reúnen las contradicciones de las dos', () => {
    const round1 = buildRound1Hypothesis(context, 5);
    assert.ok(round1.locallyExcludedTerms.includes('retail banking'));
    // Nunca viajan al proveedor: `mixed_companies/search` no admite exclusiones.
    assert.equal(
      round1.queryParameters.keywordTags.some((tag) =>
        round1.locallyExcludedTerms.includes(tag),
      ),
      false,
    );
  });
});

// ─── § 4: hasta cinco subindustrias, sin subir el gasto ───────────────────────

describe('§ 4 · cinco subindustrias caben en el mismo presupuesto', () => {
  test('D. las cinco quedan cubiertas dentro de las cinco posiciones', () => {
    const effective = buildEffective({ subindustries: FIVE_SUBINDUSTRIES });
    const coverage = effective.subindustryCoverage;

    assert.equal(coverage.requestedSubindustries.length, 5);
    assert.deepEqual(coverage.uncoveredSubindustries, []);
    assert.equal(coverage.coverageCount, 5);
    assert.equal(coverage.coverageRatio, 1);
    assert.equal(
      effective.effectiveKeywordTags.length,
      MAX_KEYWORDS,
      'ni una posición más: el tope de la ruta no se toca',
    );
  });

  test('el suelo de cobertura no puede pasar del tope de posiciones', () => {
    const lists = resolveApolloSubindustryTermLists(
      FIVE_SUBINDUSTRIES,
      resolveApolloSubindustryQueryTerms,
    );
    assert.equal(apolloSubindustryCoverageFloor(lists, MAX_KEYWORDS), 5);
    assert.equal(apolloSubindustryCoverageFloor(lists, 3), 3);
  });

  test('el body sigue llevando UN solo array de keywords, sin parámetro inventado', () => {
    const effective = buildEffective({ subindustries: FIVE_SUBINDUSTRIES });
    for (const key of Object.keys(effective.body)) {
      assert.ok(
        (APOLLO_ORGANIZATIONS_ALLOWED_PARAMS as readonly string[]).includes(key),
        `el body no puede llevar \`${key}\`: no está en el allowlist del contrato`,
      );
    }
    assert.equal(Array.isArray(effective.body.q_organization_keyword_tags), true);
  });

  test('el techo de créditos y de enrichments es invariante al número de subindustrias', () => {
    // Config equivalente a la de Producción (5/2/10/20/5): 2 rondas × 10
    // resultados + 5 enrichments, a un crédito la unidad ⇒ 25.
    const budget = estimateApolloTwoRoundBudget({
      targetEligibleCompanies: 5,
      maxRounds: 2,
      maxResultsPerRound: 10,
      maxRawResultsPerRun: 20,
      maxEnrichmentsPerRun: 5,
    });
    assert.equal(budget.maximumInternalRecordedCredits, 25);
    assert.equal(budget.config.maxEnrichmentsPerRun, 5);
    assert.equal(budget.config.maxRounds, 2);
    assert.equal(budget.searchCreditsPerRound.length, 2);
    // El presupuesto se deriva de la config, no de la solicitud: cinco
    // subindustrias no pueden multiplicarlo.
    assert.equal(
      budget.maximumInternalRecordedCredits,
      estimateApolloTwoRoundBudget(budget.config).maximumInternalRecordedCredits,
    );
  });
});

// ─── § 5: equidad y orden ─────────────────────────────────────────────────────

describe('§ 5 · el orden de la solicitud no decide quién se busca', () => {
  test('C. [A,B] y [B,A] cubren el mismo conjunto', () => {
    const forward = buildEffective({ subindustries: [DEPARTMENT_STORE, SUPERMARKETS] });
    const reverse = buildEffective({ subindustries: [SUPERMARKETS, DEPARTMENT_STORE] });

    assert.deepEqual(
      [...forward.subindustryCoverage.coveredSubindustries].sort(),
      [...reverse.subindustryCoverage.coveredSubindustries].sort(),
    );
    assert.deepEqual(forward.subindustryCoverage.uncoveredSubindustries, []);
    assert.deepEqual(reverse.subindustryCoverage.uncoveredSubindustries, []);
    assert.equal(forward.subindustryCoverage.coverageRatio, 1);
    assert.equal(reverse.subindustryCoverage.coverageRatio, 1);
  });

  test('las cinco permutadas siguen siendo cinco cubiertas', () => {
    const reversed = [...FIVE_SUBINDUSTRIES].reverse();
    const coverage = buildEffective({ subindustries: reversed }).subindustryCoverage;
    assert.equal(coverage.coverageCount, 5);
    assert.deepEqual(coverage.uncoveredSubindustries, []);
  });

  test('permutar cambia el turno de reparto, nunca la representación', () => {
    const forward = buildEffective({ subindustries: [DEPARTMENT_STORE, SUPERMARKETS] });
    const reverse = buildEffective({ subindustries: [SUPERMARKETS, DEPARTMENT_STORE] });

    // § 5 — no se exigen strings byte-idénticos: el turno del round-robin decide
    // qué profundidad alcanza cada subindustria bajo el tope de cinco, así que el
    // último término puede diferir. Lo que NO puede cambiar es a quién representa
    // la consulta, ni cuántas posiciones se gastan.
    assert.notDeepEqual(forward.effectiveKeywordTags, reverse.effectiveKeywordTags);
    assert.equal(forward.effectiveKeywordTags.length, reverse.effectiveKeywordTags.length);

    for (const effective of [forward, reverse]) {
      const bySubindustry = effective.subindustryCoverage.effectiveKeywordsBySubindustry;
      assert.ok(bySubindustry[DEPARTMENT_STORE].length > 0);
      assert.ok(bySubindustry[SUPERMARKETS].length > 0);
    }
  });
});

// ─── § 6: metadata de cobertura y procedencia ─────────────────────────────────

describe('§ 6 · la cobertura se declara, no se deduce', () => {
  test('la metadata del request efectivo trae los cinco campos del contrato', () => {
    const metadata = toApolloEffectiveRequestMetadata(
      buildEffective({ subindustries: LIVE_SUBINDUSTRIES }),
    );
    assert.deepEqual(metadata.requested_subindustries, [...LIVE_SUBINDUSTRIES]);
    assert.deepEqual(metadata.query_covered_subindustries, [...LIVE_SUBINDUSTRIES]);
    assert.deepEqual(metadata.query_uncovered_subindustries, []);
    assert.equal(metadata.query_coverage_count, 2);
    assert.equal(metadata.query_coverage_ratio, 1);
    assert.ok(metadata.effective_keywords_by_subindustry);
    assert.equal(metadata.apollo_subindustry_coverage_block_reason, null);
  });

  test('G. un término compartido viaja una vez y conserva las dos procedencias', () => {
    const lists = resolveApolloSubindustryTermLists(
      ['Alfa', 'Beta'],
      (subindustry) => ({
        canonicalSubindustry: subindustry,
        termSource: 'explicit_catalog',
        terms: subindustry === 'Alfa' ? ['compartido', 'propio alfa'] : ['compartido', 'propio beta'],
      }),
    );
    const interleaved = interleaveApolloSubindustryTerms(lists);

    assert.equal(
      interleaved.terms.filter((term) => term === 'compartido').length,
      1,
      'el término duplicado no puede gastar dos posiciones',
    );
    assert.deepEqual(interleaved.provenanceByTerm['compartido'], ['Alfa', 'Beta']);

    const coverage = computeApolloSubindustryQueryCoverage({
      lists,
      effectiveKeywords: ['compartido'],
    });
    assert.deepEqual(coverage.coveredSubindustries, ['Alfa', 'Beta']);
  });

  test('H. dos etiquetas con alias comunes conservan procedencia por SELECCIÓN', () => {
    // Las dos resuelven a la misma entrada canónica del catálogo.
    assert.equal(
      resolveApolloSubindustrySearchMapping('Supermercados')?.canonicalSubindustry,
      SUPERMARKETS,
    );
    const coverage = buildEffective({
      subindustries: ['Supermercados', SUPERMARKETS],
    }).subindustryCoverage;

    assert.deepEqual(coverage.coveredSubindustries, ['Supermercados', SUPERMARKETS]);
    assert.ok(coverage.effectiveKeywordsBySubindustry['Supermercados'].length > 0);
    assert.ok(coverage.effectiveKeywordsBySubindustry[SUPERMARKETS].length > 0);
  });

  test('una etiqueta repetida idéntica colapsa en la primera aparición', () => {
    const lists = resolveApolloSubindustryTermLists(
      [SUPERMARKETS, ' supermercados e hipermercados ', ''],
      resolveApolloSubindustryQueryTerms,
    );
    assert.equal(lists.length, 1);
    assert.equal(lists[0].requestedSubindustry, SUPERMARKETS);
  });

  test('los términos del sector se declaran como NO atribuibles', () => {
    // Con la intención de la hipótesis ocupando sus dos posiciones, los términos
    // genéricos del sector entran en la consulta — y no pueden contarse como
    // cobertura de ninguna subindustria.
    const coverage = buildEffective({
      subindustries: [SUPERMARKETS],
      additionalCriteriaTokens: ['retailer', 'retail chain', 'consumo masivo'],
    }).subindustryCoverage;

    assert.deepEqual(coverage.unattributedEffectiveKeywords, ['retailer', 'retail chain']);
    assert.deepEqual(coverage.coveredSubindustries, [SUPERMARKETS]);
  });

  test('la procedencia por subindustria viaja en la metadata del mapper', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      {
        query: 'x',
        country: LIVE_COUNTRY,
        industry: LIVE_INDUSTRY,
        subindustries: [...LIVE_SUBINDUSTRIES],
      },
      5,
    );
    assert.deepEqual(meta.matched_subindustry_mappings, [DEPARTMENT_STORE, SUPERMARKETS]);
    assert.equal(meta.subindustry_term_provenance.length, 2);
    assert.deepEqual(
      meta.subindustry_term_provenance.map((entry) => entry.requested_subindustry),
      [...LIVE_SUBINDUSTRIES],
    );
    assert.deepEqual(
      meta.subindustry_term_provenance.map((entry) => entry.term_source),
      ['explicit_catalog', 'explicit_catalog'],
    );
  });
});

// ─── § 7: fail-closed antes del gasto ─────────────────────────────────────────

describe('§ 7 · una consulta que no cubre todo lo pedido no se paga', () => {
  const UNMAPPED = 'Astilleros y Reparación Naval';

  test('E. una subindustria sin términos no se elimina en silencio', () => {
    const resolution = resolveApolloSubindustryQueryTerms(UNMAPPED);
    assert.equal(resolution.termSource, 'none');
    assert.deepEqual(resolution.terms, []);

    const coverage = buildEffective({ subindustries: [SUPERMARKETS, UNMAPPED] })
      .subindustryCoverage;
    assert.deepEqual(coverage.uncoveredSubindustries, [UNMAPPED]);
    assert.equal(coverage.coverageCount, 1);
    assert.equal(coverage.coverageRatio, 0.5);
    assert.equal(coverage.complete, false);
  });

  test('el gate bloquea con cobertura incompleta y declara la copy administrativa', () => {
    const effective = buildEffective({ subindustries: [SUPERMARKETS, UNMAPPED] });
    const verdict = effective.subindustryCoverageSpendGate;

    assert.equal(verdict.allowed, false);
    assert.equal(verdict.blockReason, APOLLO_SUBINDUSTRY_COVERAGE_BLOCK_REASON);
    assert.equal(verdict.adminCopy, APOLLO_SUBINDUSTRY_COVERAGE_BLOCK_COPY);
    assert.match(verdict.adminCopy ?? '', /No se consumieron créditos\.$/);
  });

  test('F. con todas cubiertas el gate permite y el ratio es 1', () => {
    const effective = buildEffective({ subindustries: LIVE_SUBINDUSTRIES });
    assert.equal(effective.subindustryCoverageSpendGate.allowed, true);
    assert.equal(effective.subindustryCoverageSpendGate.blockReason, null);
    assert.equal(effective.subindustryCoverage.coverageRatio, 1);
  });

  test('sin subindustrias pedidas el gate no aplica: una búsqueda sectorial no omite nada', () => {
    const effective = buildEffective({ subindustries: [] });
    assert.equal(effective.subindustryCoverageSpendGate.allowed, true);
    assert.equal(effective.subindustryCoverage.coverageRatio, 1);
    assert.ok(effective.effectiveKeywordTags.length > 0);
  });

  test('el veredicto es puro: la misma cobertura produce el mismo bloqueo', () => {
    const coverage = computeApolloSubindustryQueryCoverage({
      lists: resolveApolloSubindustryTermLists([UNMAPPED], resolveApolloSubindustryQueryTerms),
      effectiveKeywords: ['retailer'],
    });
    assert.equal(evaluateApolloSubindustryCoverageSpendGate(coverage).allowed, false);
    assert.equal(
      evaluateApolloSubindustryCoverageSpendGate(coverage).blockReason,
      APOLLO_SUBINDUSTRY_COVERAGE_BLOCK_REASON,
    );
  });

  test('el orquestador NO emite ninguna búsqueda cuando la cobertura falta', async () => {
    const { result, searchCalls } = await runOrchestrator({
      subindustries: [SUPERMARKETS, UNMAPPED],
      organizationsByRound: { 1: [liveOrganization('uno', 1)] },
    });

    assert.equal(searchCalls.length, 0, 'cero llamadas al proveedor');
    assert.equal(result.queryCoverageBlockReason, APOLLO_SUBINDUSTRY_COVERAGE_BLOCK_REASON);
    assert.equal(result.secondRoundSkippedReason, 'subindustry_query_coverage_incomplete');
    assert.equal(result.runMetrics.totalSearchCredits, 0, 'cero créditos de búsqueda');
    assert.equal(result.runMetrics.totalEnrichmentCredits, 0, 'cero créditos de enrichment');
    assert.equal(result.persisted.length, 0);
    // El bloqueo queda legible en la ronda, no invisible.
    assert.equal(result.rounds.length, 1);
    assert.deepEqual(result.rounds[0].subindustryCoverage?.uncoveredSubindustries, [UNMAPPED]);
  });

  test('con cobertura completa el orquestador sí ejecuta sus dos rondas', async () => {
    const { result, searchCalls } = await runOrchestrator({
      subindustries: LIVE_SUBINDUSTRIES,
      organizationsByRound: {
        1: [liveOrganization('uno', 1)],
        2: [liveOrganization('dos', 1)],
      },
    });

    assert.equal(result.queryCoverageBlockReason, null);
    assert.equal(searchCalls.length, 2, 'dos rondas, dos llamadas — el tope de siempre');
    for (const round of result.rounds) {
      assert.equal(round.subindustryCoverage?.complete, true);
      assert.equal(round.subindustryCoverage?.coverageCount, 2);
    }
  });

  test('cinco subindustrias NO añaden llamadas al proveedor', async () => {
    const withOne = await runOrchestrator({
      subindustries: [SUPERMARKETS],
      organizationsByRound: { 1: [liveOrganization('a', 1)], 2: [liveOrganization('b', 1)] },
    });
    const withFive = await runOrchestrator({
      subindustries: FIVE_SUBINDUSTRIES,
      organizationsByRound: { 1: [liveOrganization('c', 1)], 2: [liveOrganization('d', 1)] },
    });

    assert.equal(withFive.searchCalls.length, withOne.searchCalls.length);
    assert.ok(withFive.searchCalls.length <= 2, 'el tope de llamadas por corrida no se mueve');
    assert.equal(
      withFive.result.runMetrics.totalSearchCredits,
      withOne.result.runMetrics.totalSearchCredits,
    );
  });
});

// ─── § 7 en el LÍMITE DEL DINERO: el provider ─────────────────────────────────

describe('§ 7 · el provider no emite la llamada cuando falta cobertura', () => {
  const previousFlag = process.env.ENABLE_APOLLO_COMPANY_SEARCH;

  before(() => {
    // El gate se prueba con la búsqueda HABILITADA: con el flag apagado el
    // provider ya salía antes y la prueba no diría nada.
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
  });

  after(() => {
    if (previousFlag === undefined) delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    else process.env.ENABLE_APOLLO_COMPANY_SEARCH = previousFlag;
  });

  function providerInput(subindustries: readonly string[]): WebSearchInput {
    return {
      query: 'descubrimiento de empresas',
      country: LIVE_COUNTRY,
      countryCode: 'CO',
      industry: LIVE_INDUSTRY,
      intent: 'company_discovery',
      provider: 'apollo_organizations',
      subindustries: [...subindustries],
    };
  }

  test('cobertura incompleta ⇒ skipped, cero créditos y CERO llamadas al transporte', async () => {
    let transportCalls = 0;
    let usageLogCalls = 0;

    const output = await runApolloOrganizationsSearch(
      providerInput([SUPERMARKETS, 'Astilleros y Reparación Naval']),
      5,
      undefined,
      {
        fetchPage: async () => {
          transportCalls += 1;
          throw new Error('el transporte no debería alcanzarse');
        },
        logUsage: async () => {
          usageLogCalls += 1;
          return { kind: 'logged' as const };
        },
      },
    );

    assert.equal(transportCalls, 0, 'ninguna llamada a Apollo');
    assert.equal(usageLogCalls, 0, 'ninguna fila económica');
    assert.equal(output.skipped, true);
    assert.equal(output.skipReason, APOLLO_SUBINDUSTRY_COVERAGE_BLOCK_REASON);
    assert.equal(output.results.length, 0);
    assert.equal(output.estimatedCostUsd, 0);

    const metadata = output.metadata as Record<string, unknown>;
    assert.equal(metadata.note, APOLLO_SUBINDUSTRY_COVERAGE_BLOCK_COPY);
    const usage = metadata.usage as Record<string, unknown>;
    assert.equal(usage.credits_used, 0);
    assert.equal(usage.status, 'skipped');
    // La causa queda auditable: qué se pidió y qué quedó sin cubrir.
    assert.deepEqual(metadata.query_uncovered_subindustries, ['Astilleros y Reparación Naval']);
    assert.equal(metadata.query_coverage_count, 1);
  });

  test('con cobertura completa el provider sí llega al transporte', async () => {
    let transportCalls = 0;

    await runApolloOrganizationsSearch(providerInput(LIVE_SUBINDUSTRIES), 5, undefined, {
      fetchPage: async () => {
        transportCalls += 1;
        return {
          kind: 'error' as const,
          status: 500,
          body: null,
          error: 'transporte doblado',
        } as never;
      },
      logUsage: async () => ({ kind: 'logged' as const }),
      sleep: async () => {},
    });

    assert.ok(transportCalls > 0, 'el gate de cobertura no puede bloquear una consulta completa');
  });
});

// ─── § 9: el fixture exacto de la corrida live ────────────────────────────────

describe('§ 9 · fixture `ce957e2f` — Colombia · Retail y Consumo · dos subindustrias', () => {
  test('las dos rondas representan a las dos selecciones', () => {
    const context = {
      country: LIVE_COUNTRY,
      countryCode: 'CO',
      sector: LIVE_INDUSTRY,
      subindustries: [...LIVE_SUBINDUSTRIES],
      targetLocations: [],
      employeeRanges: [],
    };

    const round1 = buildRound1Hypothesis(context, 5);
    const round2 = buildRound2Hypothesis(
      context,
      { remainingTarget: 5, excludedSeenOrganizationCount: 0, observedRejectionReasons: [] },
      5,
    );

    const effective1 = buildEffective({
      subindustries: LIVE_SUBINDUSTRIES,
      additionalCriteriaTokens: round1.queryParameters.keywordTags,
      page: round1.queryParameters.page,
    });
    const effective2 = buildEffective({
      subindustries: LIVE_SUBINDUSTRIES,
      additionalCriteriaTokens: round2.queryParameters.keywordTags,
      page: round2.queryParameters.page,
    });

    for (const [label, effective] of [
      ['ronda 1', effective1],
      ['ronda 2', effective2],
    ] as const) {
      const coverage = effective.subindustryCoverage;
      assert.equal(coverage.requestedSubindustries.length, 2, label);
      assert.equal(coverage.coverageCount, 2, label);
      assert.deepEqual(coverage.uncoveredSubindustries, [], label);
      assert.equal(coverage.coverageRatio, 1, label);

      // Señales de la PRIMERA selección — las que en la corrida live no viajaron.
      const departmentStoreTerms = coverage.effectiveKeywordsBySubindustry[DEPARTMENT_STORE];
      assert.ok(
        departmentStoreTerms.some((term) =>
          ['department store', 'apparel', 'footwear', 'fashion', 'ropa', 'moda', 'calzado'].some(
            (signal) => term.toLowerCase().includes(signal),
          ),
        ),
        `${label}: falta la señal de tienda por departamento (${JSON.stringify(departmentStoreTerms)})`,
      );

      // Y de la segunda, que en la corrida live era la única representada.
      const supermarketTerms = coverage.effectiveKeywordsBySubindustry[SUPERMARKETS];
      assert.ok(
        supermarketTerms.some((term) =>
          ['supermercado', 'hipermercado', 'supermarket', 'hypermarket', 'grocery'].some(
            (signal) => term.toLowerCase().includes(signal),
          ),
        ),
        `${label}: falta la señal de supermercados (${JSON.stringify(supermarketTerms)})`,
      );
    }
  });

  test('la regresión exacta de la corrida live queda cerrada', () => {
    // Lo que `round_1_effective_keywords_sent` traía en el lote real.
    const liveRound1 = ['supermercado', 'hipermercado', 'grocery', 'retailer', 'retail chain'];
    const coverage = computeApolloSubindustryQueryCoverage({
      lists: resolveApolloSubindustryTermLists(
        LIVE_SUBINDUSTRIES,
        resolveApolloSubindustryQueryTerms,
      ),
      effectiveKeywords: liveRound1,
    });
    assert.deepEqual(
      coverage.uncoveredSubindustries,
      [DEPARTMENT_STORE],
      'la consulta live dejaba fuera la primera selección: eso es lo que ahora se mide',
    );

    // Y lo que la consulta produce hoy con la MISMA solicitud.
    const today = buildEffective({ subindustries: LIVE_SUBINDUSTRIES });
    assert.deepEqual(today.subindustryCoverage.uncoveredSubindustries, []);
    assert.notDeepEqual(today.effectiveKeywordTags, liveRound1);
  });

  test('las señales por subindustria no se mezclan entre dominios', () => {
    const coverage = buildEffective({ subindustries: LIVE_SUBINDUSTRIES }).subindustryCoverage;
    assert.equal(
      coverage.effectiveKeywordsBySubindustry[DEPARTMENT_STORE].some((term) =>
        term.includes('supermercado'),
      ),
      false,
    );
    assert.equal(
      coverage.effectiveKeywordsBySubindustry[SUPERMARKETS].some((term) =>
        term.includes('department'),
      ),
      false,
    );
  });
});

// ─── § 10 I: cobertura de consulta ⟂ precisión de subindustria ────────────────

describe('§ 10 I · la cobertura de consulta es independiente del mapping de precisión', () => {
  test('una subindustria con términos contribuye al discovery aunque la precisión falle cerrada', () => {
    const coverage = buildEffective({ subindustries: [DEPARTMENT_STORE] }).subindustryCoverage;
    assert.deepEqual(coverage.coveredSubindustries, [DEPARTMENT_STORE]);

    // El evaluador de precisión es el de PR #241 y decide otra cosa: si la
    // evidencia del candidato demuestra la subindustria. Sin evidencia, falla
    // cerrado — y eso no retira a la subindustria de la consulta.
    const precision = assessApolloSubindustryPrecisionForRequest(
      searchResult({ title: 'Empresa Sin Señales S.A.' }),
      [DEPARTMENT_STORE],
    );
    assert.notEqual(precision.subindustryMatch, 'confirmed');
    assert.deepEqual(coverage.uncoveredSubindustries, []);
  });
});

// ─── § 11: los contratos de #245, #241 y #238 siguen en pie ───────────────────

describe('§ 11 · contratos preservados', () => {
  test('PR #245 — la solicitud viaja íntegra y EN ORDEN', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      {
        query: 'x',
        country: LIVE_COUNTRY,
        industry: LIVE_INDUSTRY,
        subindustries: [...LIVE_SUBINDUSTRIES],
      },
      5,
    );
    assert.deepEqual(meta.requested_subindustries, [...LIVE_SUBINDUSTRIES]);
    assert.equal(meta.requested_subindustries.length, 2);
  });

  test('PR #241 — la precisión sigue siendo ANY-OF sobre todas las pedidas', () => {
    const evidence = searchResult({
      title: 'Almacenes Éxito',
      url: 'https://exito.com',
      snippet: 'Empresa: Almacenes Éxito. Industria: supermarket. Cadena de supermercados.',
    });
    const forward = assessApolloSubindustryPrecisionForRequest(evidence, [
      DEPARTMENT_STORE,
      SUPERMARKETS,
    ]);
    const reverse = assessApolloSubindustryPrecisionForRequest(evidence, [
      SUPERMARKETS,
      DEPARTMENT_STORE,
    ]);
    assert.equal(forward.subindustryMatch, reverse.subindustryMatch);
  });

  test('PR #241 — el gate de contradicción pasa a ANY-OF sin mover el cap', () => {
    const evidence = {
      declaredIndustry: 'apparel & fashion',
      declaredIndustries: ['apparel & fashion'],
      keywords: ['department store'],
      organizationName: 'Tiendas Falabella',
    };
    const mappings = resolveAllApolloSubindustrySearchMappings(LIVE_SUBINDUSTRIES).map(
      (entry) => entry.mapping,
    );

    // FIRST-ONLY con la solicitud permutada: el veredicto dependía del orden.
    const firstOnlySupermarkets = evaluateApolloFreeSectorContradiction(evidence, mappings[1]);
    const anyOfForward = evaluateApolloFreeSectorContradictionAnyOf(evidence, mappings);
    const anyOfReverse = evaluateApolloFreeSectorContradictionAnyOf(evidence, [...mappings].reverse());

    assert.equal(anyOfForward.contradictory, anyOfReverse.contradictory);
    assert.equal(anyOfForward.contradictory, false, 'la tienda por departamento se demuestra');
    assert.ok(anyOfForward.matchedPositiveTerms.includes('department store'));
    // Y el veredicto de una sola mapping sigue disponible para quien lo necesite.
    assert.equal(typeof firstOnlySupermarkets.contradictory, 'boolean');
  });

  test('PR #241 — sin mappings el ANY-OF es la identidad del caso «sin catálogo»', () => {
    const evidence = { declaredIndustry: 'banking' };
    assert.deepEqual(
      evaluateApolloFreeSectorContradictionAnyOf(evidence, []),
      evaluateApolloFreeSectorContradiction(evidence, null),
    );
  });

  test('PR #238 — ningún módulo de este hito escribe `classification_source`', () => {
    const root = path.join(process.cwd(), 'src/server/agents/prospecting-toolkit');
    const touched = [
      'apollo-subindustry-query-terms.ts',
      'apollo-subindustry-search-mapping.ts',
      'apollo-organizations-query-mapping.ts',
      'apollo-organizations-effective-request.ts',
      'apollo-two-round/query-hypothesis.ts',
    ];
    for (const relative of touched) {
      const source = readFileSync(path.join(root, relative), 'utf8');
      assert.equal(
        source.includes('classification_source'),
        false,
        `${relative} no puede tocar el vocabulario de la CHECK 093`,
      );
    }
  });
});

// ─── § 8: sin soporte inventado del proveedor ─────────────────────────────────

describe('§ 8 · el contrato del proveedor no se amplía', () => {
  test('el allowlist del contrato no cambia', () => {
    assert.deepEqual([...APOLLO_ORGANIZATIONS_ALLOWED_PARAMS], [
      'organization_locations',
      'organization_not_locations',
      'organization_num_employees_ranges',
      'q_organization_keyword_tags',
      'q_organization_name',
      'q_organization_domains_list',
      'revenue_range',
      'currently_using_any_of_technology_uids',
      'page',
      'per_page',
    ]);
  });

  test('el resolvedor de señales por subindustria no inventa conjuntos', () => {
    const sets = resolveSectorSignalSets(LIVE_INDUSTRY, [DEPARTMENT_STORE, 'Inexistente']);
    assert.equal(sets.perSubindustry.length, 2);
    assert.ok(sets.perSubindustry[0].resolved !== null);
    assert.equal(sets.perSubindustry[1].resolved, null, 'no se le presta el conjunto del vecino');
    assert.ok(sets.sectorFallback !== null);
    assert.equal(sets.allSignalsMissing, false);
  });
});

// ─── Arnés del orquestador ────────────────────────────────────────────────────

function liveOrganization(id: string, rank: number): RawDiscoveredOrganization {
  return {
    providerOrganizationId: id,
    name: `Almacenes ${id.toUpperCase()} S.A.`,
    domain: `${id}.com.co`,
    linkedinUrl: `https://www.linkedin.com/company/${id}`,
    providerRank: rank,
    declaredIndustry: 'retail',
  };
}

/**
 * Corrida por el orquestador real con el constructor de request efectivo REAL
 * —el mismo que gobierna la llamada de producción— y el proveedor doblado.
 *
 * Es lo que hace que el gate del § 7 se ejerza de verdad: un preview simulado
 * podría declarar cualquier cobertura.
 */
async function runOrchestrator(input: {
  subindustries: readonly string[];
  organizationsByRound: Record<number, readonly RawDiscoveredOrganization[]>;
}) {
  const searchCalls: { roundNumber: number; keywordTags: string[] }[] = [];

  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: ({ hypothesis, requestedResultLimit }) => {
      const effective = buildEffective({
        subindustries: input.subindustries,
        additionalCriteriaTokens: hypothesis.queryParameters.keywordTags,
        page: hypothesis.queryParameters.page,
        query: hypothesis.queryHypothesis,
        requestedResultLimit,
      });
      const coverage = effective.subindustryCoverage;
      return {
        effectiveRequestFingerprint: effective.effectiveRequestFingerprint,
        page: effective.page,
        perPage: effective.perPage,
        effectiveKeywordTags: effective.effectiveKeywordTags,
        subindustryCoverage: {
          requestedSubindustries: coverage.requestedSubindustries,
          coveredSubindustries: coverage.coveredSubindustries,
          uncoveredSubindustries: coverage.uncoveredSubindustries,
          coverageCount: coverage.coverageCount,
          coverageRatio: coverage.coverageRatio,
          effectiveKeywordsBySubindustry: coverage.effectiveKeywordsBySubindustry,
          complete: coverage.complete,
        },
        subindustryCoverageBlockReason: effective.subindustryCoverageSpendGate.blockReason,
      };
    },
    searchRound: async ({ roundNumber, hypothesis }): Promise<RoundSearchOutcome> => {
      searchCalls.push({
        roundNumber,
        keywordTags: [...hypothesis.queryParameters.keywordTags],
      });
      const organizations = input.organizationsByRound[roundNumber] ?? [];
      return {
        organizations,
        providerRequestCount: 1,
        internalRecordedCredits: organizations.length,
        providerTotalPages: 3,
      };
    },
    assessCandidate: () => rejectedAssessment('sector_not_mapped'),
    enrichCandidate: async () => ({
      executed: false,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      internalRecordedCredits: 0,
    }),
  };

  const result = await runApolloTwoRoundDiscovery(
    {
      config: testConfig(),
      queryContext: {
        country: LIVE_COUNTRY,
        countryCode: 'CO',
        sector: LIVE_INDUSTRY,
        subindustries: [...input.subindustries],
        targetLocations: [],
        employeeRanges: [],
      },
      correlation: testCorrelation({
        batchId: 'ce957e2f-13f9-430c-9595-9c0b1ad32353',
      }),
    },
    deps,
  );

  return { result, searchCalls };
}
