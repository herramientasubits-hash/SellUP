/**
 * apollo-query-quality.test.ts — Calidad de la consulta enviada a Apollo.
 *
 * A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2 · § 1, § 2, § 5, § 6, § 7, § 9, § 11.
 *
 * Cada bloque empieza demostrando el DEFECTO observado en la corrida QA
 * `edb6f40c` y termina demostrando que el arreglo lo cierra. Todo offline:
 *
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildApolloOrganizationsSearchParams,
  buildPrioritizedApolloKeywords,
  apolloKeywordDedupeKey,
  isGenericSectorKeyword,
  MAX_GENERIC_KEYWORD_SLOTS,
} from '../apollo-organizations-query-mapping';
import {
  evaluateApolloFreeSectorContradiction,
  listApolloSubindustrySearchMappings,
  resolveApolloSubindustrySearchMapping,
  resolveFirstApolloSubindustrySearchMapping,
} from '../apollo-subindustry-search-mapping';
import { resolveApolloResultLimit } from '../web-search-providers/apollo-organizations-search-provider';
import { normalizeApolloOrganizationsResponse } from '../apollo-organizations-response-normalizer';
import { evaluateApolloEnrichmentEligibility } from '../apollo-enrichment-eligibility-gate';
import {
  buildCorrelationColumns,
  buildProviderUsageLogRow,
  resolveProviderUsageBillingState,
} from '../apollo-organizations-usage-logging';
import { APOLLO_SPEND_OBSERVABILITY_KEY } from '../apollo-spend-observability';
import { RUN_CORRELATION_METADATA_KEY } from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-correlation';
import type { WebSearchInput } from '../types';
import {
  QA_OBSERVED_KEYWORD_TAGS,
  QA_OBSERVED_ORGANIZATIONS,
  QA_WIZARD_SELECTION,
  toQaSearchResult,
} from './fixtures/apollo-qa-batch-edb6f40c';

// ─── Ayudas ───────────────────────────────────────────────────────────────────

/** La selección REAL del wizard en la corrida QA. */
function qaWizardInput(overrides: Partial<WebSearchInput> = {}): WebSearchInput {
  return {
    query: 'supermercados e hipermercados en Colombia',
    country: QA_WIZARD_SELECTION.country,
    countryCode: QA_WIZARD_SELECTION.countryCode,
    industry: QA_WIZARD_SELECTION.industry,
    intent: 'company_discovery',
    maxResults: 5,
    provider: 'apollo_organizations',
    subindustries: [...QA_WIZARD_SELECTION.subindustries],
    additionalCriteriaTokens: [],
    ...overrides,
  };
}

const SUPERMARKET_SIGNALS = ['supermercado', 'hipermercado', 'grocery', 'food retail'];
const GENERIC_RETAIL_SIGNALS = ['retail', 'commerce', 'ecommerce', 'comercio'];

function lower(values: readonly string[]): string[] {
  return values.map((value) => value.toLowerCase());
}

// ─── § 11: el defecto observado ───────────────────────────────────────────────

describe('§ 11 · la corrida QA edb6f40c, como defecto', () => {
  test('los términos que se enviaron eran genéricos: ninguno distingue un supermercado', () => {
    const sent = lower(QA_OBSERVED_KEYWORD_TAGS);

    for (const specific of SUPERMARKET_SIGNALS) {
      assert.ok(
        !sent.includes(specific),
        `la corrida QA NO envió "${specific}" — es el defecto que este hito cierra`,
      );
    }
    assert.ok(sent.includes('retail'), 'la corrida QA sí envió el genérico "retail"');
  });

  test('con esos términos, Citigroup es un resultado coherente para el proveedor', () => {
    const citigroup = QA_OBSERVED_ORGANIZATIONS.find((org) => org.name === 'Citigroup');
    assert.ok(citigroup);
    assert.ok(
      citigroup.industry.includes('retail'),
      '"retail banking" contiene "retail": por eso entró en una búsqueda de supermercados',
    );
  });
});

// ─── § 1 y § 2: prioridad de términos y mapping de subindustria ───────────────

describe('§ 1 · prioridad de términos', () => {
  test('1. la subindustria seleccionada manda sobre el catálogo del sector', () => {
    const { params, meta } = buildApolloOrganizationsSearchParams(qaWizardInput(), 5);
    const tags = lower(params.q_organization_keyword_tags ?? []);

    for (const specific of SUPERMARKET_SIGNALS) {
      assert.ok(tags.includes(specific), `falta la señal específica "${specific}": ${tags.join(', ')}`);
    }
    assert.equal(meta.matched_subindustry_mapping, 'Supermercados e Hipermercados');
  });

  test('3. la consulta NO depende de los genéricos de retail', () => {
    const { params } = buildApolloOrganizationsSearchParams(qaWizardInput(), 5);
    const tags = lower(params.q_organization_keyword_tags ?? []);

    for (const generic of GENERIC_RETAIL_SIGNALS) {
      assert.ok(!tags.includes(generic), `"${generic}" no debe consumir una posición`);
    }
  });

  test('4. con cinco términos específicos válidos, los genéricos se omiten del todo', () => {
    const { meta } = buildApolloOrganizationsSearchParams(qaWizardInput(), 5);

    assert.deepEqual(meta.sector_tokens_used, []);
    assert.equal(meta.keyword_priority_strategy, 'specific_only');
  });

  test('4b. cuando hay específicos pero no llenan el cupo, los genéricos ocupan como mucho dos', () => {
    const result = buildPrioritizedApolloKeywords({
      industry: 'Retail y Consumo',
      subindustries: [],
      additionalCriteriaTokens: ['tiendas de barrio'],
    });

    assert.ok(result.specificTokensUsed.length > 0);
    assert.ok(
      result.sectorTokensUsed.length <= MAX_GENERIC_KEYWORD_SLOTS,
      `genéricos usados: ${result.sectorTokensUsed.length}`,
    );
  });

  test('la intención escrita por el usuario nunca queda sepultada por la subindustria', () => {
    const result = buildPrioritizedApolloKeywords({
      industry: 'Retail y Consumo',
      subindustries: ['Supermercados e Hipermercados'],
      additionalCriteriaTokens: ['tiendas de descuento'],
    });

    assert.ok(
      result.specificTokensUsed.includes('tiendas de descuento'),
      `la intención del usuario debe viajar: ${result.specificTokensUsed.join(', ')}`,
    );
  });

  test('sin ninguna señal específica el sector general sigue siendo el respaldo', () => {
    // «salud» es un catálogo de palabras sueltas: no hay frase que pueda actuar
    // como señal específica, así que el respaldo genérico es lo único que queda.
    const result = buildPrioritizedApolloKeywords({
      industry: 'salud',
      subindustries: [],
      additionalCriteriaTokens: [],
    });

    assert.equal(result.keywordPriorityStrategy, 'sector_general_fallback');
    assert.ok(result.keywords.length > 0, 'una consulta vacía sería peor que una genérica');
    assert.deepEqual(result.specificTokensUsed, []);
  });

  test('sin subindustria, una frase del catálogo sectorial cuenta como específica', () => {
    const result = buildPrioritizedApolloKeywords({
      industry: 'Retail y Consumo',
      subindustries: [],
      additionalCriteriaTokens: [],
    });

    assert.ok(
      result.specificTokensUsed.includes('retail chain'),
      `una frase describe un tipo de empresa, no el sector entero: ${result.specificTokensUsed.join(', ')}`,
    );
    assert.ok(result.sectorTokensUsed.length <= MAX_GENERIC_KEYWORD_SLOTS);
  });

  test('la deduplicación colapsa singular y plural, pero nunca una frase con su token', () => {
    assert.equal(
      apolloKeywordDedupeKey('supermercados'),
      apolloKeywordDedupeKey('supermercado'),
    );
    assert.notEqual(
      apolloKeywordDedupeKey('cadena de supermercados'),
      apolloKeywordDedupeKey('supermercado'),
    );
  });

  test('un término de una sola palabra es genérico; una frase es específica', () => {
    assert.equal(isGenericSectorKeyword('retail'), true);
    assert.equal(isGenericSectorKeyword('retail chain'), false);
  });

  test('la observabilidad declara qué se usó y qué se ignoró', () => {
    const { meta } = buildApolloOrganizationsSearchParams(qaWizardInput(), 5);

    assert.ok(Array.isArray(meta.specific_tokens_available));
    assert.ok(meta.specific_tokens_available.length > meta.specific_tokens_used.length);
    assert.ok(Array.isArray(meta.ignored_specific_tokens));
    assert.ok(Array.isArray(meta.ignored_generic_tokens));
    assert.ok(typeof meta.keyword_priority_strategy === 'string');
  });
});

describe('§ 2 · mapping explícito de subindustrias', () => {
  test('2. «Supermercados e Hipermercados» tiene mapping y variantes controladas', () => {
    const mapping = resolveApolloSubindustrySearchMapping('Supermercados e Hipermercados');
    assert.ok(mapping);
    assert.equal(mapping.canonicalSubindustry, 'Supermercados e Hipermercados');

    const terms = lower(mapping.positiveTerms);
    for (const expected of ['supermercado', 'hipermercado', 'grocery', 'supermarket', 'food retail']) {
      assert.ok(terms.includes(expected), `falta el término controlado "${expected}"`);
    }
  });

  test('las variantes en español e inglés resuelven al mismo mapping', () => {
    for (const alias of ['supermercados', 'Supermarkets', 'grocery retail', 'HIPERMERCADOS']) {
      const mapping = resolveApolloSubindustrySearchMapping(alias);
      assert.ok(mapping, `"${alias}" debería resolver`);
      assert.equal(mapping.canonicalSubindustry, 'Supermercados e Hipermercados');
    }
  });

  test('las contradicciones locales incluyen las señales financieras y de servicios', () => {
    const mapping = resolveApolloSubindustrySearchMapping('Supermercados e Hipermercados');
    assert.ok(mapping);
    const contradictory = lower(mapping.contradictoryTerms);

    for (const expected of [
      'retail banking',
      'investment banking',
      'financial services',
      'software',
      'consulting',
      'marketplace',
    ]) {
      assert.ok(contradictory.includes(expected), `falta la contradicción "${expected}"`);
    }
  });

  test('«retail» a secas NUNCA es una contradicción: descartaría minoristas reales', () => {
    for (const mapping of listApolloSubindustrySearchMappings()) {
      assert.ok(
        !lower(mapping.contradictoryTerms).includes('retail'),
        `${mapping.canonicalSubindustry} no puede contradecir por "retail" suelto`,
      );
    }
  });

  test('los términos negativos NO viajan como parámetros: se aplican localmente', () => {
    const { params } = buildApolloOrganizationsSearchParams(qaWizardInput(), 5);
    const tags = lower(params.q_organization_keyword_tags ?? []);
    const mapping = resolveApolloSubindustrySearchMapping('Supermercados e Hipermercados');
    assert.ok(mapping);

    for (const contradictory of mapping.contradictoryTerms) {
      assert.ok(
        !tags.includes(contradictory.toLowerCase()),
        `"${contradictory}" no puede enviarse a Apollo`,
      );
    }
    assert.equal('organization_not_keyword_tags' in params, false);
  });

  test('una subindustria fuera del catálogo no inventa un mapping', () => {
    assert.equal(resolveApolloSubindustrySearchMapping('Subindustria Inexistente'), null);
    assert.equal(resolveApolloSubindustrySearchMapping(''), null);
    assert.equal(resolveApolloSubindustrySearchMapping(null), null);
    assert.equal(resolveFirstApolloSubindustrySearchMapping([]), null);
  });
});

// ─── § 5: límite efectivo de resultados ───────────────────────────────────────

describe('§ 5 · límite efectivo por ronda', () => {
  test('9. la ruta legacy sigue en 3 cuando así está configurada', () => {
    const resolution = resolveApolloResultLimit({
      requested: 5,
      mode: 'legacy',
      legacyMaxResultsPerQuery: 3,
    });

    assert.equal(resolution.cap, 3);
    assert.equal(resolution.wasCapped, true);
    assert.equal(resolution.maxResultsCapSource, 'agent1_apollo_cost_guardrail');
  });

  test('8. el modo de dos rondas pide 5 aunque la variable legacy diga 3', () => {
    const resolution = resolveApolloResultLimit({
      requested: 5,
      mode: 'two_round',
      twoRoundMaxResultsPerRound: 5,
      legacyMaxResultsPerQuery: 3,
    });

    assert.equal(resolution.cap, 5, 'una variable legacy no puede recortar el modo nuevo');
    assert.equal(resolution.wasCapped, false);
  });

  test('el diagnóstico expone AMBOS límites resueltos', () => {
    const resolution = resolveApolloResultLimit({
      requested: 5,
      mode: 'two_round',
      twoRoundMaxResultsPerRound: 5,
      legacyMaxResultsPerQuery: 3,
    });

    assert.equal(resolution.legacyMaxResultsPerQuery, 3);
    assert.equal(resolution.twoRoundMaxResultsPerRound, 5);
    assert.equal(resolution.limitMode, 'two_round');
  });

  test('una variable propia de dos rondas SÍ puede bajar el límite', () => {
    const resolution = resolveApolloResultLimit({
      requested: 5,
      mode: 'two_round',
      twoRoundMaxResultsPerRound: 2,
      legacyMaxResultsPerQuery: 3,
    });

    assert.equal(resolution.cap, 2);
    assert.equal(resolution.maxResultsCapSource, 'agent1_apollo_two_round_max_results_per_round');
  });

  test('el tope duro del proveedor manda sobre cualquier modo', () => {
    const resolution = resolveApolloResultLimit({
      requested: 50,
      mode: 'two_round',
      twoRoundMaxResultsPerRound: 50,
      legacyMaxResultsPerQuery: 3,
    });

    assert.equal(resolution.cap, 10);
  });

  test('el body que se construye lleva el per_page del modo, no el legacy', () => {
    const { params } = buildApolloOrganizationsSearchParams(qaWizardInput(), 5);
    assert.equal(params.per_page, 5);
    assert.equal(params.page, 1);
  });
});

// ─── § 6: accounts frente a organizations ─────────────────────────────────────

describe('§ 6 · accounts frente a organizations', () => {
  test('el id de organización sale de accounts[*].organization_id, nunca de accounts[*].id', () => {
    const normalized = normalizeApolloOrganizationsResponse({
      organizations: [],
      accounts: [
        {
          id: 'workspace-account-1',
          organization_id: '5f2a1b3c4d5e6f7a8b9c0d11',
          name: 'Cadena de Supermercados Andina',
          primary_domain: 'supermercadosandina.com.co',
        },
      ],
    });

    assert.equal(normalized.organizations.length, 1);
    const reference = normalized.organizations[0].providerReference;
    assert.equal(reference.providerOrganizationId, '5f2a1b3c4d5e6f7a8b9c0d11');
    assert.equal(reference.providerAccountId, 'workspace-account-1');
  });

  test('una entrada de accounts sin organization_id se descarta, no se inventa una identidad', () => {
    const normalized = normalizeApolloOrganizationsResponse({
      organizations: [],
      accounts: [{ id: 'workspace-account-2', name: 'Sin organización' }],
    });

    assert.equal(normalized.organizations.length, 0);
    assert.equal(normalized.meta.dropped_without_id_count, 1);
  });

  test('accounts COMPLETA campos ausentes y nunca sobrescribe los de organizations', () => {
    const normalized = normalizeApolloOrganizationsResponse({
      organizations: [
        {
          id: 'org-1',
          name: 'Hipermercados del Caribe',
          primary_domain: null,
          industry: 'hypermarkets',
        },
      ],
      accounts: [
        {
          id: 'account-1',
          organization_id: 'org-1',
          primary_domain: 'hipercaribe.com.co',
          industry: 'financial services',
        },
      ],
    });

    assert.equal(normalized.organizations.length, 1);
    const organization = normalized.organizations[0];
    assert.equal(organization.industry, 'hypermarkets', 'accounts no puede pisar la industria');
    assert.equal(organization.primaryDomain, 'hipercaribe.com.co');
    assert.ok(organization.filledFromAccountFields.includes('primaryDomain'));
  });

  test('los campos que se leen son SÓLO los que la respuesta trae', () => {
    const normalized = normalizeApolloOrganizationsResponse({
      organizations: [{ id: 'org-2', name: 'Autoservicios del Valle' }],
    });

    const organization = normalized.organizations[0];
    assert.equal(organization.primaryDomain, null);
    assert.equal(organization.industry, null);
    assert.deepEqual(organization.industries, []);
    assert.equal(organization.estimatedNumEmployees, null);
  });
});

// ─── § 7: ranking de enrichment ───────────────────────────────────────────────

describe('§ 7 · contradicción visible impide el enrichment', () => {
  const mapping = resolveApolloSubindustrySearchMapping('Supermercados e Hipermercados');

  test('11. Citigroup + retail banking ⇒ sector contradictorio, enrichment = 0', () => {
    const verdict = evaluateApolloFreeSectorContradiction(
      {
        declaredIndustry: 'retail banking',
        declaredIndustries: ['retail banking', 'financial services'],
        keywords: ['banking', 'credit cards'],
        organizationName: 'Citigroup',
      },
      mapping,
    );

    assert.equal(verdict.contradictory, true);
    assert.equal(verdict.matchedContradictoryTerm, 'retail banking');
    assert.equal(verdict.matchedField, 'declared_industry');
  });

  test('un supermercado real con evidencia positiva NO se bloquea por mencionar finanzas', () => {
    const verdict = evaluateApolloFreeSectorContradiction(
      {
        declaredIndustry: 'supermarkets, financial services',
        declaredIndustries: ['supermarkets'],
        keywords: ['supermercado', 'grocery'],
        organizationName: 'Cadena de Supermercados Andina',
      },
      mapping,
    );

    assert.equal(verdict.contradictory, false);
    assert.ok(verdict.matchedPositiveTerms.length > 0);
  });

  test('la descripción general NO se usa para contradecir', () => {
    const verdict = evaluateApolloFreeSectorContradiction(
      { declaredIndustry: 'grocery stores', declaredIndustries: ['grocery stores'] },
      mapping,
    );

    assert.equal(verdict.contradictory, false);
  });

  test('«retail» genérico sin contradicción puede competir por enrichment', () => {
    const verdict = evaluateApolloFreeSectorContradiction(
      { declaredIndustry: 'retail', declaredIndustries: ['retail'] },
      mapping,
    );

    assert.equal(verdict.contradictory, false);
    assert.equal(verdict.matchedContradictoryTerm, null);
  });

  test('sin industria declarada no hay contradicción: la ausencia no es evidencia', () => {
    const verdict = evaluateApolloFreeSectorContradiction(
      { declaredIndustry: null, declaredIndustries: [] },
      mapping,
    );

    assert.equal(verdict.contradictory, false);
  });

  test('sin mapping de subindustria no se afirma ninguna contradicción', () => {
    const verdict = evaluateApolloFreeSectorContradiction(
      { declaredIndustry: 'retail banking' },
      null,
    );

    assert.equal(verdict.contradictory, false);
  });

  test('12. google.com queda fuera ANTES del enrichment, por el gate de dominio', () => {
    const google = QA_OBSERVED_ORGANIZATIONS.find((org) => org.domain === 'google.com');
    assert.ok(google);

    const eligibility = evaluateApolloEnrichmentEligibility(toQaSearchResult(google), {
      targetCountryCode: 'CO',
      sector: 'Retail y Consumo',
      subindustry: 'Supermercados e Hipermercados',
    });

    assert.equal(eligibility.eligible, false, 'ningún crédito puede gastarse en google.com');
    assert.ok(
      ['external_platform_domain', 'generic_or_mail_provider_domain', 'country_mismatch'].includes(
        eligibility.skipReason,
      ),
      `motivo inesperado: ${eligibility.skipReason}`,
    );
  });
});

// ─── § 9: billing_state de Search ─────────────────────────────────────────────

describe('§ 9 · billing_state de las filas de Search', () => {
  const searchMetadata = {
    [APOLLO_SPEND_OBSERVABILITY_KEY]: { billing_state: 'recorded' },
    [RUN_CORRELATION_METADATA_KEY]: {
      reservation_id: 'reservation-1',
      client_request_id: 'client-1',
      wizard_run_id: 'wizard-1',
      request_fingerprint: 'fingerprint-1',
      idempotency_key: 'idempotency-1',
      billing_state: null,
    },
  };

  test('14. una búsqueda cobrada resuelve billing_state = recorded, no NULL', () => {
    assert.equal(resolveProviderUsageBillingState(searchMetadata), 'recorded');
  });

  test('lo que la correlación declara gana sobre la observación de la fila', () => {
    assert.equal(
      resolveProviderUsageBillingState({
        ...searchMetadata,
        [RUN_CORRELATION_METADATA_KEY]: {
          ...searchMetadata[RUN_CORRELATION_METADATA_KEY],
          billing_state: 'estimated',
        },
      }),
      'estimated',
    );
  });

  test('sin ninguna de las dos fuentes queda null: no se inventa un estado', () => {
    assert.equal(resolveProviderUsageBillingState({}), null);
    assert.equal(resolveProviderUsageBillingState(null), null);
  });

  test('la representación en metadata queda poblada aunque las columnas estén apagadas', () => {
    const row = buildProviderUsageLogRow({
      provider_key: 'apollo',
      operation_key: 'organizations_search',
      metadata: searchMetadata,
    } as never);

    const metadata = row.metadata as Record<string, unknown>;
    assert.equal(metadata['provider_usage_billing_state'], 'recorded');
    assert.equal('billing_state' in row, false, 'la columna sigue gobernada por su flag');
  });

  test('la columna, cuando el flag la habilita, sale del mismo resolutor', () => {
    const previous = process.env.ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS;
    process.env.ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS = 'true';
    try {
      const columns = buildCorrelationColumns(searchMetadata);
      assert.equal(columns['billing_state'], 'recorded');
      assert.equal(columns['wizard_run_id'], 'wizard-1');
    } finally {
      if (previous === undefined) delete process.env.ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS;
      else process.env.ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS = previous;
    }
  });

  test('sin el flag no se escribe ninguna columna de correlación', () => {
    const previous = process.env.ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS;
    delete process.env.ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS;
    try {
      assert.deepEqual(buildCorrelationColumns(searchMetadata), {});
    } finally {
      if (previous !== undefined) {
        process.env.ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS = previous;
      }
    }
  });
});
