/**
 * agent1-multi-subindustry-catalog-coverage-addendum-1.test.ts
 *
 * AGENT1-MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 · CATALOG SEARCH TERMS COVERAGE
 * ADDENDUM.
 *
 * Prueba que conectar `subindustry_search_terms` (73/73) al discovery de Apollo:
 *
 *   1. no sustituye el catálogo especializado (2/73) que gobierna precisión;
 *   2. no aplica fallback al sector padre;
 *   3. mantiene fail-closed pre-gasto para lo que de verdad no tiene cobertura;
 *   4. no mueve los topes de 2 llamadas / 5 enrichments / 25 créditos;
 *   5. es invariante al orden de la solicitud.
 *
 * Todo offline y por inyección de dependencias:
 *   LIVE_APOLLO_CALLS = 0 · LIVE_TAVILY_CALLS = 0 · APOLLO_CREDITS_USED = 0
 *   PRODUCTION_WRITES = 0 · HUBSPOT_WRITES = 0
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  resolveApolloSubindustrySearchCoverage,
  auditApolloSubindustryCatalogSearchCoverage,
  toApolloSubindustrySearchCoverageMetadata,
  evaluateApolloSubindustrySearchCoverageSpendGate,
} from '../apollo-subindustry-search-coverage';
import {
  listApolloSubindustryCatalogSearchTerms,
  resolveApolloSubindustryCatalogSearchTerms,
} from '../apollo-subindustry-catalog-search-terms';
import {
  buildApolloOrganizationsSearchParams,
  resolveApolloSubindustryQueryTerms,
} from '../apollo-organizations-query-mapping';
import { buildApolloOrganizationsEffectiveRequest } from '../apollo-organizations-effective-request';
import {
  resolveApolloSubindustryTermLists,
  apolloSubindustryCoverageFloor,
} from '../apollo-subindustry-query-terms';
import {
  resolveApolloSubindustrySearchMapping,
} from '../apollo-subindustry-search-mapping';
import { assessApolloSubindustryPrecisionForRequest } from '../apollo-subindustry-precision';
import { runApolloOrganizationsSearch } from '../web-search-providers/apollo-organizations-search-provider';
import { estimateApolloTwoRoundBudget } from '../apollo-two-round/budget';
import {
  MAX_SEARCH_ROUNDS_ABSOLUTE_MAX,
  MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX,
} from '../apollo-two-round/config';
import { SELLUP_ACTIVE_SUBINDUSTRY_NAMES } from './fixtures/sellup-subindustry-catalog-names';
import type { WebSearchInput, WebSearchResult } from '../types';

const MAX_KEYWORDS = 5;

function searchResult(overrides: Partial<WebSearchResult> & { title: string }): WebSearchResult {
  return {
    url: 'https://ejemplo.com',
    snippet: `Empresa: ${overrides.title}`,
    rank: 1,
    provider: 'apollo_organizations',
    ...overrides,
  };
}

function buildEffective(input: {
  subindustries: readonly string[];
  industry?: string | null;
}) {
  const { params, meta, subindustryTermLists } = buildApolloOrganizationsSearchParams(
    {
      query: 'x',
      country: 'Colombia',
      countryCode: 'CO',
      industry: input.industry ?? 'Tecnología',
      subindustries: [...input.subindustries],
    },
    5,
  );
  const effective = buildApolloOrganizationsEffectiveRequest({
    input: {
      query: 'x',
      country: 'Colombia',
      countryCode: 'CO',
      industry: input.industry ?? 'Tecnología',
      subindustries: [...input.subindustries],
    },
    requestedMaxResults: 5,
    resultLimitMode: 'two_round',
    twoRoundMaxResultsPerRound: 5,
    legacyMaxResultsPerQuery: 5,
  });
  return { params, meta, subindustryTermLists, effective };
}

// ─── § 1: auditoría del catálogo ──────────────────────────────────────────────

describe('§ 1 · auditoría del catálogo subindustry_search_terms', () => {
  test('el snapshot tiene exactamente 73 subindustrias, las mismas del fixture congelado', () => {
    const catalogNames = listApolloSubindustryCatalogSearchTerms().map(
      (entry) => entry.canonicalSubindustry,
    );
    assert.equal(catalogNames.length, 73);
    assert.deepEqual([...catalogNames].sort(), [...SELLUP_ACTIVE_SUBINDUSTRY_NAMES].sort());
  });

  test('las 73 tienen al menos un término keyword — cero sin cobertura', () => {
    const entries = listApolloSubindustryCatalogSearchTerms();
    const withoutTerms = entries.filter((entry) => entry.terms.length === 0);
    assert.deepEqual(withoutTerms, [], `subindustrias sin término: ${JSON.stringify(withoutTerms)}`);

    const counts = entries.map((entry) => entry.terms.length);
    assert.equal(Math.min(...counts), 1);
    assert.equal(Math.max(...counts), 4);
  });

  test('auditApolloSubindustryCatalogSearchCoverage declara 73/73 cubiertas por discovery', () => {
    const audit = auditApolloSubindustryCatalogSearchCoverage();
    assert.equal(audit.subindustriesTotal, 73);
    assert.equal(audit.queryCoveredSubindustries, 73);
    assert.equal(audit.queryUncoveredSubindustries, 0);
    assert.deepEqual(audit.uncoveredLabels, []);
  });

  test('cada UUID del snapshot es único', () => {
    const ids = listApolloSubindustryCatalogSearchTerms().map((entry) => entry.canonicalSubindustryId);
    assert.equal(new Set(ids).size, ids.length);
  });
});

// ─── § 2: contrato canónico resolveApolloSubindustrySearchCoverage ────────────

describe('§ 2 · resolveApolloSubindustrySearchCoverage', () => {
  test('subindustria sólo con catálogo especializado (2/73)', () => {
    const result = resolveApolloSubindustrySearchCoverage({
      requestedSubindustries: ['Supermercados e Hipermercados'],
    });
    assert.equal(result.entries.length, 1);
    const [entry] = result.entries;
    assert.equal(entry.covered, true);
    assert.equal(entry.coverageReason, 'specialized_and_catalog');
    assert.ok(entry.specializedTerms.length > 0);
    assert.ok(entry.catalogTerms.length > 0);
    assert.equal(entry.canonicalLabel, 'Supermercados e Hipermercados');
  });

  test('subindustria sólo con catálogo de la tabla (71/73)', () => {
    const result = resolveApolloSubindustrySearchCoverage({
      requestedSubindustries: ['Ciberseguridad'],
    });
    const [entry] = result.entries;
    assert.equal(entry.covered, true);
    assert.equal(entry.coverageReason, 'catalog_search_terms');
    assert.deepEqual(entry.specializedTerms, []);
    assert.ok(entry.catalogTerms.length > 0);
    assert.equal(entry.canonicalSubindustryId, '40a655f2-0c1a-545d-973a-fb357d6b8da9');
  });

  test('subindustria sin ninguna fuente ⇒ uncovered, sin fallback', () => {
    const result = resolveApolloSubindustrySearchCoverage({
      requestedSubindustries: ['Astilleros y Reparación Naval'],
    });
    const [entry] = result.entries;
    assert.equal(entry.covered, false);
    assert.equal(entry.coverageReason, 'uncovered_no_terms_available');
    assert.deepEqual(entry.effectiveTerms, []);
    assert.equal(entry.canonicalLabel, null);
  });

  test('merge con provenance: especializado primero, catálogo detrás, deduplicado', () => {
    const result = resolveApolloSubindustrySearchCoverage({
      requestedSubindustries: ['Supermercados e Hipermercados'],
      // Inyecta un término de catálogo que colisiona por singular/plural con uno
      // especializado — debe sobrevivir una sola vez y con procedencia especializada.
      catalogSearchTerms: () => ({
        canonicalSubindustryId: 'fixture-id',
        canonicalSubindustry: 'Supermercados e Hipermercados',
        terms: ['supermercados', 'termino solo de catalogo'],
      }),
    });
    const [entry] = result.entries;
    // "supermercado" (especializado) y "supermercados" (catálogo) colapsan.
    const supermercadoSources = entry.termSources.filter((t) =>
      t.normalizedTerm.startsWith('supermercado'),
    );
    assert.equal(supermercadoSources.length, 1);
    assert.equal(supermercadoSources[0].source, 'specialized_mapping');
    // El término exclusivo de catálogo sobrevive con su propia procedencia.
    assert.ok(
      entry.termSources.some(
        (t) => t.term === 'termino solo de catalogo' && t.source === 'catalog_search_term',
      ),
    );
  });

  test('etiquetas vacías se descartan y las repetidas colapsan en la primera aparición', () => {
    const result = resolveApolloSubindustrySearchCoverage({
      requestedSubindustries: ['Ciberseguridad', '', '  ', 'ciberseguridad', 'Ciberseguridad'],
    });
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].requestedSubindustry, 'Ciberseguridad');
  });

  test('sin subindustrias pedidas, coverageRatio es 1 y no hay entradas', () => {
    const result = resolveApolloSubindustrySearchCoverage({ requestedSubindustries: [] });
    assert.deepEqual(result.entries, []);
    assert.equal(result.coverageRatio, 1);
    assert.equal(result.requestedCount, 0);
  });

  test('una, dos y cinco subindustrias catalog-only quedan todas cubiertas', () => {
    const one = resolveApolloSubindustrySearchCoverage({ requestedSubindustries: ['Ciberseguridad'] });
    assert.equal(one.coveredCount, 1);

    const two = resolveApolloSubindustrySearchCoverage({
      requestedSubindustries: ['Ciberseguridad', 'Legaltech'],
    });
    assert.equal(two.coveredCount, 2);

    const five = resolveApolloSubindustrySearchCoverage({
      requestedSubindustries: ['Ciberseguridad', 'Legaltech', 'Insurtech', 'Agritech', 'HRtech y Gestión del Talento'],
    });
    assert.equal(five.coveredCount, 5);
    assert.deepEqual(five.uncoveredSubindustries, []);
  });

  test('permutation invariance: [A,B] y [B,A] cubren el mismo conjunto', () => {
    const forward = resolveApolloSubindustrySearchCoverage({
      requestedSubindustries: ['Ciberseguridad', 'Legaltech'],
    });
    const reverse = resolveApolloSubindustrySearchCoverage({
      requestedSubindustries: ['Legaltech', 'Ciberseguridad'],
    });
    assert.deepEqual(
      [...forward.coveredSubindustries].sort(),
      [...reverse.coveredSubindustries].sort(),
    );
    assert.deepEqual(forward.uncoveredSubindustries, reverse.uncoveredSubindustries);
  });

  test('permutation invariance con cinco subindustrias', () => {
    const five = ['Ciberseguridad', 'Legaltech', 'Insurtech', 'Agritech', 'HRtech y Gestión del Talento'];
    const forward = resolveApolloSubindustrySearchCoverage({ requestedSubindustries: five });
    const reversed = resolveApolloSubindustrySearchCoverage({
      requestedSubindustries: [...five].reverse(),
    });
    assert.deepEqual(
      [...forward.coveredSubindustries].sort(),
      [...reversed.coveredSubindustries].sort(),
    );
    assert.equal(forward.coveredCount, reversed.coveredCount);
  });
});

// ─── § 4: discovery ⟂ precision ────────────────────────────────────────────────

describe('§ 4 · la cobertura de catálogo NO implica mapping de precisión', () => {
  test('«Ciberseguridad» tiene términos de catálogo pero sigue sin anclas de precisión', () => {
    const coverage = resolveApolloSubindustrySearchCoverage({
      requestedSubindustries: ['Ciberseguridad'],
    });
    assert.equal(coverage.entries[0].covered, true);

    const precision = assessApolloSubindustryPrecisionForRequest(
      searchResult({ title: 'Empresa Cualquiera S.A.S.' }),
      ['Ciberseguridad'],
    );
    assert.equal(precision.subindustryMapped, false);
    assert.notEqual(precision.subindustryMatch, 'confirmed');
  });

  test('el catálogo especializado (2/73) sigue siendo la única fuente de precisión', () => {
    assert.equal(resolveApolloSubindustrySearchMapping('Ciberseguridad'), null);
    assert.notEqual(resolveApolloSubindustrySearchMapping('Supermercados e Hipermercados'), null);
  });

  test('resolveApolloSubindustryQueryTerms para «Ciberseguridad» resuelve por catalog_search_terms, no explicit_catalog', () => {
    const resolution = resolveApolloSubindustryQueryTerms('Ciberseguridad');
    assert.equal(resolution.termSource, 'catalog_search_terms');
    assert.ok(resolution.terms.length > 0);
  });
});

// ─── § 5 y § 7: fail-closed pre-gasto ──────────────────────────────────────────

describe('§ 5 y § 7 · fail-closed pre-gasto sobre lo que de verdad no tiene cobertura', () => {
  test('evaluateApolloSubindustrySearchCoverageSpendGate bloquea cuando falta una subindustria', () => {
    const coverage = resolveApolloSubindustrySearchCoverage({
      requestedSubindustries: ['Ciberseguridad', 'Astilleros y Reparación Naval'],
    });
    const verdict = evaluateApolloSubindustrySearchCoverageSpendGate(coverage);
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.blockReason, 'apollo_subindustry_search_coverage_incomplete');
  });

  test('con las 73 canónicas ninguna bloquea por falta de fuente de discovery', () => {
    for (const name of SELLUP_ACTIVE_SUBINDUSTRY_NAMES) {
      const coverage = resolveApolloSubindustrySearchCoverage({ requestedSubindustries: [name] });
      const verdict = evaluateApolloSubindustrySearchCoverageSpendGate(coverage);
      assert.equal(verdict.allowed, true, `"${name}" no debería bloquear`);
    }
  });

  test('el gate real de la ruta (evaluateApolloSubindustryCoverageSpendGate) permite 71/73 que antes bloqueaba', () => {
    // Antes del addendum, cualquiera de las 71 subindustrias sin mapping
    // especializado resolvía termSource='none' y el gate bloqueaba (PR #246 § 7).
    // Ahora resuelve por catálogo y el gate permite.
    const effective = buildEffective({ subindustries: ['Ciberseguridad'] });
    assert.equal(effective.effective.subindustryCoverageSpendGate.allowed, true);
    assert.deepEqual(effective.effective.subindustryCoverage.uncoveredSubindustries, []);
  });

  test('una etiqueta que NO es ninguna de las 73 sigue bloqueando — 0 llamadas, 0 filas económicas', async () => {
    let transportCalls = 0;
    let usageLogCalls = 0;

    const providerInput: WebSearchInput = {
      query: 'descubrimiento de empresas',
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      intent: 'company_discovery',
      provider: 'apollo_organizations',
      subindustries: ['Ciberseguridad', 'Astilleros y Reparación Naval'],
    };

    const previousFlag = process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    try {
      const output = await runApolloOrganizationsSearch(providerInput, 5, undefined, {
        fetchPage: async () => {
          transportCalls += 1;
          throw new Error('el transporte no debería alcanzarse');
        },
        logUsage: async () => {
          usageLogCalls += 1;
          return { kind: 'logged' as const };
        },
      });
      assert.equal(transportCalls, 0);
      assert.equal(usageLogCalls, 0);
      assert.equal(output.skipped, true);
      assert.equal(output.estimatedCostUsd, 0);
    } finally {
      if (previousFlag === undefined) delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
      else process.env.ENABLE_APOLLO_COMPANY_SEARCH = previousFlag;
    }
  });
});

// ─── § 7: query drafting con 1–5 subindustrias catalog-only ───────────────────

describe('§ 7 · 1 a 5 subindustrias catalog-only quedan representadas en la consulta efectiva', () => {
  test('una subindustria catalog-only gobierna sin fallback sectorial', () => {
    const { effective } = buildEffective({ subindustries: ['Legaltech'] });
    assert.deepEqual(effective.subindustryCoverage.uncoveredSubindustries, []);
    assert.ok(effective.effectiveKeywordTags.length > 0);
  });

  test('cinco subindustrias catalog-only caben en las cinco posiciones, sin subir el tope', () => {
    const five = ['Ciberseguridad', 'Legaltech', 'Insurtech', 'Agritech', 'HRtech y Gestión del Talento'];
    const { effective } = buildEffective({ subindustries: five });
    assert.deepEqual(effective.subindustryCoverage.uncoveredSubindustries, []);
    assert.equal(effective.subindustryCoverage.coverageCount, 5);
    assert.equal(effective.effectiveKeywordTags.length, MAX_KEYWORDS);
  });

  test('el suelo de cobertura reserva una posición por subindustria catalog-only', () => {
    const five = ['Ciberseguridad', 'Legaltech', 'Insurtech', 'Agritech', 'HRtech y Gestión del Talento'];
    const lists = resolveApolloSubindustryTermLists(five, resolveApolloSubindustryQueryTerms);
    assert.equal(apolloSubindustryCoverageFloor(lists, MAX_KEYWORDS), 5);
    for (const list of lists) {
      assert.equal(list.termSource, 'catalog_search_terms', `"${list.requestedSubindustry}" debería resolver por catálogo`);
    }
  });

  test('permutar cinco catalog-only no cambia el conjunto representado', () => {
    const five = ['Ciberseguridad', 'Legaltech', 'Insurtech', 'Agritech', 'HRtech y Gestión del Talento'];
    const forward = buildEffective({ subindustries: five }).effective.subindustryCoverage;
    const reversed = buildEffective({ subindustries: [...five].reverse() }).effective.subindustryCoverage;
    assert.deepEqual(
      [...forward.coveredSubindustries].sort(),
      [...reversed.coveredSubindustries].sort(),
    );
    assert.equal(forward.coverageCount, reversed.coverageCount);
  });
});

// ─── § 9: fixture ce957e2f — sigue resuelta, y ahora también sin catálogo especializado ──

describe('§ 9 · fixture ce957e2f y su equivalente puramente catalog-only', () => {
  test('ce957e2f (2 subindustrias con catálogo especializado) sigue sin uncovered', () => {
    const { effective } = buildEffective({
      subindustries: ['Tiendas por Departamento, Moda y Calzado', 'Supermercados e Hipermercados'],
      industry: 'Retail y Consumo',
    });
    assert.deepEqual(effective.subindustryCoverage.uncoveredSubindustries, []);
  });

  test('el mismo patrón con dos subindustrias que SÓLO tienen catálogo de tabla (antes bloqueaban las dos)', () => {
    const { effective } = buildEffective({
      subindustries: ['Legaltech', 'Insurtech'],
      industry: 'Tecnología',
    });
    assert.deepEqual(effective.subindustryCoverage.uncoveredSubindustries, []);
    assert.equal(effective.subindustryCoverage.coverageCount, 2);
    assert.equal(effective.subindustryCoverageSpendGate.allowed, true);
  });
});

// ─── § 8: topes de gasto invariantes ───────────────────────────────────────────

describe('§ 8 · los topes de gasto no se mueven', () => {
  test('2 llamadas de búsqueda, 5 enrichments, 25 créditos — tope absoluto', () => {
    assert.equal(MAX_SEARCH_ROUNDS_ABSOLUTE_MAX, 2);
    assert.equal(MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX, 5);

    const budget = estimateApolloTwoRoundBudget({
      targetEligibleCompanies: 5,
      maxRounds: 2,
      maxResultsPerRound: 10,
      maxRawResultsPerRun: 20,
      maxEnrichmentsPerRun: 5,
    });
    assert.equal(budget.maximumInternalRecordedCredits, 25);
  });

  test('el presupuesto no cambia con 1 o con 5 subindustrias catalog-only', () => {
    const configuredBudget = estimateApolloTwoRoundBudget({
      targetEligibleCompanies: 5,
      maxRounds: 2,
      maxResultsPerRound: 10,
      maxRawResultsPerRun: 20,
      maxEnrichmentsPerRun: 5,
    });
    // El presupuesto se deriva de la config del run, no del número de
    // subindustrias pedidas: construir la consulta con 1 o con 5 no lo altera.
    buildEffective({ subindustries: ['Legaltech'] });
    buildEffective({
      subindustries: ['Ciberseguridad', 'Legaltech', 'Insurtech', 'Agritech', 'HRtech y Gestión del Talento'],
    });
    assert.equal(
      estimateApolloTwoRoundBudget(configuredBudget.config).maximumInternalRecordedCredits,
      25,
    );
  });
});

// ─── § 11: contratos preservados de #246, #245, #241 y #238 ───────────────────

describe('§ 11 · contratos de hitos previos preservados', () => {
  test('PR #246 — ANY-OF: dos subindustrias catalog-only reparten posiciones, ninguna gobierna sola', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      { query: 'x', country: 'Colombia', industry: 'Tecnología', subindustries: ['Legaltech', 'Insurtech'] },
      5,
    );
    assert.deepEqual(meta.query_uncovered_subindustries, []);
    assert.equal(meta.query_coverage_count, 2);
  });

  test('PR #245 — la solicitud viaja íntegra y en orden con subindustrias catalog-only', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      { query: 'x', country: 'Colombia', industry: 'Tecnología', subindustries: ['Legaltech', 'Insurtech'] },
      5,
    );
    assert.deepEqual(meta.requested_subindustries, ['Legaltech', 'Insurtech']);
  });

  test('PR #241 — precisión sigue fail-closed (ambiguous, no confirmed) para catalog-only sin anclas', () => {
    const precision = assessApolloSubindustryPrecisionForRequest(
      searchResult({ title: 'Empresa X' }),
      ['Legaltech'],
    );
    assert.notEqual(precision.subindustryMatch, 'confirmed');
  });

  test('PR #238 — el vocabulario de `classification_source` (migración 093) no se tocó', () => {
    const migrationPath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      'supabase',
      'migrations',
      '093_add_record_origin_classification_to_prospect_candidates.sql',
    );
    const sql = readFileSync(migrationPath, 'utf8');
    assert.ok(sql.includes('prospect_candidates_classification_source_check'));
    for (const value of [
      'writer',
      'derived_metadata',
      'derived_source_primary',
      'derived_review_notes',
      'derived_batch',
      'manual',
      'derived_status',
      'unknown',
    ]) {
      assert.ok(sql.includes(`'${value}'`), `falta "${value}" en la migración 093`);
    }
  });
});

// ─── § 12: metadata ────────────────────────────────────────────────────────────

describe('§ 12 · metadata de diagnóstico', () => {
  test('toApolloSubindustrySearchCoverageMetadata no lleva secretos ni datos crudos del candidato', () => {
    const coverage = resolveApolloSubindustrySearchCoverage({
      requestedSubindustries: ['Ciberseguridad', 'Astilleros y Reparación Naval'],
    });
    const metadata = toApolloSubindustrySearchCoverageMetadata(coverage);
    assert.equal(metadata.requested_count, 2);
    assert.equal(metadata.covered_count, 1);
    assert.equal(metadata.uncovered_count, 1);
    assert.deepEqual(metadata.uncovered_subindustries, ['Astilleros y Reparación Naval']);
    const serialized = JSON.stringify(metadata);
    assert.ok(!serialized.includes('api_key'));
    assert.ok(!serialized.includes('token'));
  });
});

// ─── Directo: resolveApolloSubindustryCatalogSearchTerms ──────────────────────

describe('resolveApolloSubindustryCatalogSearchTerms — igualdad exacta, no substring', () => {
  test('nombre canónico exacto resuelve', () => {
    const resolved = resolveApolloSubindustryCatalogSearchTerms('Ciberseguridad');
    assert.notEqual(resolved, null);
    assert.equal(resolved?.canonicalSubindustry, 'Ciberseguridad');
  });

  test('etiquetas informales del mapa histórico NO resuelven por catálogo (siguen cayendo en legacy)', () => {
    // "Educación Corporativa" NO es uno de los 73 nombres canónicos — el canónico
    // es "Formación Corporativa y Corporate Training". Debe seguir resolviendo por
    // el mapa histórico exactamente como antes de este addendum.
    assert.equal(resolveApolloSubindustryCatalogSearchTerms('Educación Corporativa'), null);
    assert.equal(resolveApolloSubindustryCatalogSearchTerms('LMS'), null);
    const resolution = resolveApolloSubindustryQueryTerms('Educación Corporativa');
    assert.equal(resolution.termSource, 'legacy_keyword_map');
  });

  test('nombre inexistente no resuelve', () => {
    assert.equal(resolveApolloSubindustryCatalogSearchTerms('No Existe Esta Subindustria'), null);
  });

  test('vacío o null no resuelve', () => {
    assert.equal(resolveApolloSubindustryCatalogSearchTerms(''), null);
    assert.equal(resolveApolloSubindustryCatalogSearchTerms(null), null);
    assert.equal(resolveApolloSubindustryCatalogSearchTerms(undefined), null);
  });
});
