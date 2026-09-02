/**
 * AGENT1-APOLLO-BILLING-MODE-V2 — invariantes del modelo de facturación de
 * Apollo Organization Search.
 *
 * ── Qué fija ─────────────────────────────────────────────────────────────────
 *
 * Apollo Support confirmó el modelo real: 1 crédito por PÁGINA NO VACÍA de
 * Organization Search, sin importar cuántos resultados traiga esa página (100
 * cuestan lo mismo que 3), y 0 por página vacía. La representación interna
 * decía otra cosa —«1 crédito por organización devuelta»— y sobre-anotaba 4,8×
 * en Prod (565 créditos anotados por 100 páginas reales).
 *
 * Cinco invariantes, cada una con su propio bloque:
 *
 *   A. El crédito lo produce la PÁGINA, no el resultado: una página de 1 y una
 *      de 100 cuestan lo mismo, y `per_page` no es una palanca de gasto.
 *   B. La página vacía cuesta 0 y NO se declara cobrada; un request que no
 *      salió cuesta 0; un request que salió sin respuesta queda `unknown` y
 *      jamás se promueve a cobrado ni se degrada a no cobrado.
 *   C. La RESERVA cuenta páginas: `maxResultsPerQuery` / `maxResultsPerRound`
 *      no participan en ningún crédito.
 *   D. `maxCandidates` NO sigue a `maxCredits`. Bajo v1 ambos valían
 *      `maxPages × perPage`; con créditos por página, confundirlos dejaría la
 *      corrida recogiendo 5 organizaciones en vez de 500.
 *   E. Compatibilidad histórica: una fila SIN estampar se lee como v1 (por
 *      organización) y no es comparable con una de v2. La ausencia nunca se
 *      resuelve como v2.
 *
 * Cierra con trinquetes estáticos: ninguna superficie puede volver a derivar
 * créditos de Organization Search de un conteo de resultados.
 *
 * Sin llamadas reales, sin DB, sin créditos: el transporte se inyecta.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  APOLLO_PRICING_METADATA_KEY,
  APOLLO_PRICING_VERSION,
  APOLLO_PRICING_VERSION_V1_PER_RESULT,
  apolloPricingModelsAreComparable,
  estimateApolloRunCreditBreakdown,
  resolveApolloPricingModelFromMetadata,
} from '../apollo-operation-pricing';
import {
  APOLLO_CONTRACT_MAX_PER_PAGE,
  APOLLO_LEGACY_MAX_PAGES_PER_INVOCATION,
  WIZARD_APOLLO_MAX_PAGES_HARD_CAP,
  createApolloPaginationBudget,
} from '../apollo-organizations-pagination-budget';
import { estimateApolloTwoRoundBudget } from '../apollo-two-round/budget';
import type { ApolloTwoRoundDiscoveryConfig } from '../apollo-two-round/config';
import {
  runApolloOrganizationsSearch,
  type ApolloOrgsSearchDeps,
} from '../web-search-providers/apollo-organizations-search-provider';
import type { WebSearchInput } from '../types';
import type { ApolloPageFetchResult } from '../apollo-organizations-paginated-search';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';

// ─── Arnés ────────────────────────────────────────────────────────────────────

const BASE_INPUT: WebSearchInput = {
  query: 'empresa educacion colombia',
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Educación',
  maxResults: 5,
  provider: 'apollo_organizations',
};

function organizationsPage(count: number, page = 1): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: {
      organizations: Array.from({ length: count }, (_unused, index) => ({
        id: `org-p${page}-${index}`,
        name: `Colegio ${page}-${index}`,
        primary_domain: `colegio-${page}-${index}.edu.co`,
        industry: 'education',
        keywords: ['educación', 'colegio'],
        short_description: 'Institución educativa',
        estimated_num_employees: 300,
        country: 'Colombia',
      })),
      pagination: { page, per_page: count, total_entries: 5_000, total_pages: 100 },
    },
    headers: null,
  };
}

const EMPTY_PAGE: ApolloPageFetchResult = {
  ok: true,
  status: 200,
  requestSent: true,
  malformedBody: false,
  timedOut: false,
  payload: {
    organizations: [],
    pagination: { page: 1, per_page: 100, total_entries: 0, total_pages: 0 },
  },
  headers: null,
};

/** Request que NUNCA salió del proceso: no hay cobro posible. */
const REQUEST_NOT_SENT: ApolloPageFetchResult = {
  ok: false,
  status: null,
  requestSent: false,
  malformedBody: false,
  timedOut: false,
  payload: undefined,
  headers: null,
  errorBody: 'socket error before send',
};

/** Request que salió y cuya respuesta nunca llegó: cobro DESCONOCIDO. */
const SENT_NO_RESPONSE: ApolloPageFetchResult = {
  ok: false,
  status: null,
  requestSent: true,
  malformedBody: false,
  timedOut: true,
  payload: undefined,
  headers: null,
  errorBody: 'timeout after request sent',
};

type RunResult = {
  metadata: Record<string, unknown>;
  usageRows: LogProviderUsageInput[];
  requestedBodies: Record<string, unknown>[];
};

async function runProvider(
  response: ApolloPageFetchResult | ((body: Record<string, unknown>) => ApolloPageFetchResult),
  maxResults = 5,
): Promise<RunResult> {
  process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
  const usageRows: LogProviderUsageInput[] = [];
  const requestedBodies: Record<string, unknown>[] = [];

  const deps: ApolloOrgsSearchDeps = {
    fetchPage: async (body) => {
      requestedBodies.push(body);
      return typeof response === 'function' ? response(body) : response;
    },
    logUsage: async (input: LogProviderUsageInput) => {
      usageRows.push(input);
      return { kind: 'logged' };
    },
    now: () => 0,
    random: () => 0,
    sleep: async () => undefined,
    // Sin escritor de memoria real: provider-seen no participa de la facturación.
    recordProviderSeen: async () => ({
      written: false,
      skippedReason: 'test_no_store',
      newIdsRecorded: 0,
      newDomainsRecorded: 0,
      refreshedCount: 0,
    }),
  };

  const out = await runApolloOrganizationsSearch(BASE_INPUT, maxResults, undefined, deps);
  return {
    metadata: out.metadata as Record<string, unknown>,
    usageRows,
    requestedBodies,
  };
}

function searchRow(rows: LogProviderUsageInput[]): LogProviderUsageInput {
  const row = rows.find((r) => r.operation_key === 'organizations_search');
  assert.ok(row, 'la corrida debe escribir una fila de organizations_search');
  return row;
}

function pagination(metadata: Record<string, unknown>): Record<string, unknown> {
  return metadata.apollo_pagination as Record<string, unknown>;
}

const TOUCHED_ENV = [
  'ENABLE_APOLLO_COMPANY_SEARCH',
  'AGENT1_APOLLO_MAX_QUERIES_PER_RUN',
  'AGENT1_APOLLO_MAX_RESULTS_PER_QUERY',
] as const;

afterEach(() => {
  for (const key of TOUCHED_ENV) delete process.env[key];
});

// ─── A. El crédito lo produce la página, no el resultado ──────────────────────

describe('A. 1 crédito por página no vacía, sin importar cuántos resultados traiga', () => {
  it('una página de 1 resultado y una de 100 cuestan exactamente lo mismo', async () => {
    const one = await runProvider(organizationsPage(1), 1);
    const hundred = await runProvider(organizationsPage(100), 100);

    assert.equal(searchRow(one.usageRows).credits_used, 1);
    assert.equal(
      searchRow(hundred.usageRows).credits_used,
      1,
      'facturar por resultado devolvería 100 aquí — es el defecto que cierra este hito',
    );
    assert.equal(
      searchRow(one.usageRows).credits_used,
      searchRow(hundred.usageRows).credits_used,
    );
  });

  it('la fila declara los resultados y los créditos como magnitudes distintas', async () => {
    const { usageRows } = await runProvider(organizationsPage(100), 100);
    const row = searchRow(usageRows);

    assert.equal(row.results_returned, 100, 'el volumen devuelto sigue siendo visible');
    assert.equal(row.credits_used, 1, 'el cobro no es el volumen');
  });

  it('el costo USD se deriva de los créditos, no del conteo de resultados', async () => {
    const { usageRows } = await runProvider(organizationsPage(100), 100);
    const row = searchRow(usageRows);
    // 1 crédito × la tarifa del contrato Apollo (0.00875 USD/crédito).
    assert.equal(row.estimated_cost_usd, 0.00875);
  });
});

// ─── B. Estados de cobro ──────────────────────────────────────────────────────

describe('B. La página vacía no se declara cobrada, y lo desconocido sigue desconocido', () => {
  it('página vacía (200 sin resultados) ⇒ 0 créditos y not_charged', async () => {
    const { usageRows, metadata } = await runProvider(EMPTY_PAGE);
    const row = searchRow(usageRows);
    const outcomes = pagination(metadata).page_outcomes as Array<Record<string, unknown>>;

    assert.equal(row.credits_used, 0, 'Apollo Support: la página vacía no se cobra');
    assert.equal(outcomes[0]?.billingState, 'not_charged');
    assert.equal(outcomes[0]?.estimatedCredits, 0);
  });

  it('request que NO salió ⇒ 0 créditos y not_charged', async () => {
    const { usageRows, metadata } = await runProvider(REQUEST_NOT_SENT);
    const row = searchRow(usageRows);
    const outcomes = pagination(metadata).page_outcomes as Array<Record<string, unknown>>;

    assert.equal(row.credits_used, 0);
    for (const outcome of outcomes) {
      assert.equal(
        outcome.billingState,
        'not_charged',
        'sin request no hay cobro posible',
      );
    }
  });

  it('request enviado sin respuesta ⇒ billing unknown, nunca charged ni not_charged', async () => {
    const { metadata } = await runProvider(SENT_NO_RESPONSE);
    const outcomes = pagination(metadata).page_outcomes as Array<Record<string, unknown>>;

    assert.ok(outcomes.length > 0);
    for (const outcome of outcomes) {
      assert.equal(
        outcome.billingState,
        'unknown',
        'Apollo pudo procesar y cobrar: la incertidumbre se preserva',
      );
    }
    // Y la página queda marcada como indeterminada, no como una búsqueda vacía.
    assert.deepEqual(pagination(metadata).indeterminate_pages, [1]);
  });

  it('la página no vacía se declara charged', async () => {
    const { metadata } = await runProvider(organizationsPage(3), 3);
    const outcomes = pagination(metadata).page_outcomes as Array<Record<string, unknown>>;
    assert.equal(outcomes[0]?.billingState, 'charged');
    assert.equal(outcomes[0]?.estimatedCredits, 1);
  });
});

// ─── C. La reserva cuenta páginas ─────────────────────────────────────────────

describe('C. La reserva cuenta PÁGINAS: per_page no participa', () => {
  it('subir maxResultsPerQuery de 3 a 100 no mueve la reserva', () => {
    const small = estimateApolloRunCreditBreakdown({
      maxQueriesPerRun: 1,
      maxPagesPerQuery: 1,
      maxResultsPerQuery: 3,
      maxEnrichmentsPerRun: 0,
      enrichmentEnabled: false,
    });
    const large = estimateApolloRunCreditBreakdown({
      maxQueriesPerRun: 1,
      maxPagesPerQuery: 1,
      maxResultsPerQuery: 100,
      maxEnrichmentsPerRun: 0,
      enrichmentEnabled: false,
    });

    assert.equal(small.searchReservedCredits, 1);
    assert.equal(
      large.searchReservedCredits,
      small.searchReservedCredits,
      'con cobro por página, pedir 100 resultados no cuesta más que pedir 3',
    );
  });

  it('subir las PÁGINAS sí mueve la reserva, proporcionalmente', () => {
    const onePage = estimateApolloRunCreditBreakdown({
      maxQueriesPerRun: 2,
      maxPagesPerQuery: 1,
      maxResultsPerQuery: 100,
      maxEnrichmentsPerRun: 0,
      enrichmentEnabled: false,
    });
    const fivePages = estimateApolloRunCreditBreakdown({
      maxQueriesPerRun: 2,
      maxPagesPerQuery: 5,
      maxResultsPerQuery: 100,
      maxEnrichmentsPerRun: 0,
      enrichmentEnabled: false,
    });

    assert.equal(onePage.searchReservedCredits, 2);
    assert.equal(fivePages.searchReservedCredits, 10);
  });

  it('la modalidad de dos rondas reserva páginas por ronda, no resultados por ronda', () => {
    const config = (maxResultsPerRound: number): ApolloTwoRoundDiscoveryConfig => ({
      targetEligibleCompanies: 10,
      maxRounds: 2,
      maxResultsPerRound,
      maxRawResultsPerRun: 200,
      maxEnrichmentsPerRun: 2,
    });

    const lean = estimateApolloTwoRoundBudget(config(5));
    const fat = estimateApolloTwoRoundBudget(config(100));

    assert.equal(
      lean.maximumInternalRecordedCredits,
      fat.maximumInternalRecordedCredits,
      'el tamaño de página no cambia el peor caso de gasto',
    );
    assert.equal(lean.searchRound1Maximum, WIZARD_APOLLO_MAX_PAGES_HARD_CAP);
    assert.equal(lean.searchRound2Maximum, WIZARD_APOLLO_MAX_PAGES_HARD_CAP);
    assert.equal(
      lean.maximumInternalRecordedCredits,
      WIZARD_APOLLO_MAX_PAGES_HARD_CAP * 2 + 2,
    );
  });

  it('la reserva legacy y el runtime legacy usan la MISMA constante de páginas', async () => {
    const { metadata } = await runProvider(organizationsPage(3), 3);

    assert.equal(
      pagination(metadata).max_pages,
      APOLLO_LEGACY_MAX_PAGES_PER_INVOCATION,
      'si el provider empezara a pedir más páginas que las reservadas, la corrida gastaría por encima de la reserva',
    );
    assert.equal(pagination(metadata).max_credits, APOLLO_LEGACY_MAX_PAGES_PER_INVOCATION);
  });
});

// ─── D. maxCandidates no sigue a maxCredits ───────────────────────────────────

describe('D. maxCandidates NO se deriva de maxCredits', () => {
  it('por defecto los créditos cuentan páginas y los candidatos cuentan filas', () => {
    const budget = createApolloPaginationBudget();

    assert.equal(budget.maxCredits, budget.maxPages, 'créditos = páginas');
    assert.equal(
      budget.maxCandidates,
      budget.maxPages * budget.perPage,
      'candidatos = páginas × tamaño de página',
    );
    assert.notEqual(
      budget.maxCandidates,
      budget.maxCredits,
      'compartir la cifra es exactamente el colapso que esta prueba impide',
    );
    assert.ok(
      budget.maxCandidates >= budget.perPage,
      'el tope de candidatos debe poder alojar una página completa',
    );
  });

  it('bajar maxCredits a 1 no toca maxCandidates', () => {
    const base = createApolloPaginationBudget();
    const squeezed = createApolloPaginationBudget({ maxCredits: 1 });

    assert.equal(squeezed.maxCredits, 1);
    assert.equal(
      squeezed.maxCandidates,
      base.maxCandidates,
      'el presupuesto de dinero no es el presupuesto de filas',
    );
  });

  it('el tope de candidatos escala con per_page, no con los créditos', () => {
    const narrow = createApolloPaginationBudget({ perPage: 10 });
    const wide = createApolloPaginationBudget({ perPage: APOLLO_CONTRACT_MAX_PER_PAGE });

    assert.equal(narrow.maxCredits, wide.maxCredits, 'mismos créditos: mismas páginas');
    assert.ok(
      wide.maxCandidates > narrow.maxCandidates,
      'más filas por página ⇒ más candidatos alojables',
    );
    assert.equal(narrow.maxCandidates, narrow.maxPages * 10);
  });

  it('con una sola página el tope de candidatos sigue siendo una página entera', () => {
    const budget = createApolloPaginationBudget({
      maxPages: APOLLO_LEGACY_MAX_PAGES_PER_INVOCATION,
      perPage: APOLLO_CONTRACT_MAX_PER_PAGE,
    });

    assert.equal(budget.maxCredits, 1);
    assert.equal(
      budget.maxCandidates,
      APOLLO_CONTRACT_MAX_PER_PAGE,
      'un crédito compra hasta 100 filas: recortarlas a 1 tiraría 99 organizaciones ya pagadas',
    );
  });
});

// ─── E. Compatibilidad histórica ──────────────────────────────────────────────

describe('E. Una fila sin estampar se lee como v1 y no es comparable con v2', () => {
  it('la AUSENCIA de bloque de pricing se resuelve como v1, nunca como v2', () => {
    for (const metadata of [undefined, null, {}, { results_returned: 5 }]) {
      assert.equal(
        resolveApolloPricingModelFromMetadata(metadata),
        'per_organization_returned_v1',
        'asumir v2 por defecto declararía correctas las filas sobre-anotadas de Prod',
      );
    }
  });

  it('una fila estampada con v1 se sigue leyendo como v1', () => {
    const julyRow = {
      results_returned: 5,
      [APOLLO_PRICING_METADATA_KEY]: {
        pricing_version: APOLLO_PRICING_VERSION_V1_PER_RESULT,
        pricing_source: 'apollo_operation_pricing_table',
        billing_unit: 'non_empty_page',
      },
    };
    assert.equal(resolveApolloPricingModelFromMetadata(julyRow), 'per_organization_returned_v1');
  });

  it('una fila v1 y una fila v2 NO son comparables', () => {
    const legacyRow = { results_returned: 5 };
    const currentRow = {
      [APOLLO_PRICING_METADATA_KEY]: {
        pricing_version: APOLLO_PRICING_VERSION,
        pricing_source: 'apollo_operation_pricing_table',
        billing_unit: 'non_empty_page',
      },
    };

    assert.equal(resolveApolloPricingModelFromMetadata(currentRow), 'non_empty_page');
    assert.equal(
      apolloPricingModelsAreComparable(legacyRow, currentRow),
      false,
      'sumarlas produce un total sin unidad',
    );
    assert.equal(apolloPricingModelsAreComparable(currentRow, currentRow), true);
    assert.equal(apolloPricingModelsAreComparable(legacyRow, {}), true);
  });

  it('toda fila NUEVA de organizations_search lleva el estampado v2 — ruta exitosa', async () => {
    const { usageRows } = await runProvider(organizationsPage(3), 3);
    const row = searchRow(usageRows);
    const block = (row.metadata as Record<string, unknown>)[APOLLO_PRICING_METADATA_KEY];

    assert.deepEqual(block, {
      pricing_version: APOLLO_PRICING_VERSION,
      pricing_source: 'apollo_operation_pricing_table',
      billing_unit: 'non_empty_page',
    });
    assert.equal(resolveApolloPricingModelFromMetadata(row.metadata), 'non_empty_page');
  });

  it('toda fila NUEVA de organizations_search lleva el estampado v2 — ruta de error terminal', async () => {
    const { usageRows } = await runProvider({
      ok: false,
      status: 401,
      requestSent: true,
      malformedBody: false,
      timedOut: false,
      payload: undefined,
      headers: null,
      errorBody: 'unauthorized',
    });
    const row = searchRow(usageRows);

    assert.equal(row.credits_used, 0, '401 no cobra');
    assert.equal(
      resolveApolloPricingModelFromMetadata(row.metadata),
      'non_empty_page',
      'el modelo es un hecho de la fila, no de su desenlace',
    );
  });
});

// ─── Trinquetes estáticos ─────────────────────────────────────────────────────

const REPO_SRC = join(process.cwd(), 'src');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readCode(relativePath: string): string {
  return stripComments(readFileSync(join(REPO_SRC, relativePath), 'utf8'));
}

describe('F. Trinquetes: ninguna superficie vuelve a facturar Search por resultado', () => {
  it('la reserva multiplica páginas, no resultados', () => {
    const code = readCode('server/agents/prospecting-toolkit/apollo-operation-pricing.ts');

    assert.match(
      code,
      /searchReservedCredits\s*=\s*\n?\s*queries \* pagesPerQuery/,
      'la fórmula de reserva de búsqueda debe multiplicar páginas',
    );
    assert.doesNotMatch(
      code,
      /queries \* results/,
      'reservar por resultado es el defecto que este hito cierra',
    );
  });

  it('el provider deriva créditos del ledger por página', () => {
    const code = readCode(
      'server/agents/prospecting-toolkit/web-search-providers/apollo-organizations-search-provider.ts',
    );

    assert.match(
      code,
      /creditsForApolloNonEmptyPages\(paidVolume\.creditsCharged\)/,
      'los créditos salen de las páginas no vacías observadas',
    );
    assert.doesNotMatch(
      code,
      /creditsFor\w*\([^)]*paidVolume\.resultsVolume/,
      'resultsVolume es un conteo de FILAS: no puede alimentar créditos',
    );
    assert.doesNotMatch(
      code,
      /creditsFor\w*\([^)]*rawOrgs\.length/,
      'rawOrgs.length es un conteo de organizaciones: no puede alimentar créditos',
    );
  });

  it('la ruta legacy mixed_companies_search ya no anota por resultado', () => {
    const code = readCode('server/agents/prospect-generation.ts');

    assert.doesNotMatch(
      code,
      /estimated_per_result_as_credit/,
      'la base por resultado produjo 25 de las 100 filas sobre-anotadas de Prod',
    );
    assert.match(code, /estimated_per_non_empty_page_as_credit/);
    assert.match(
      code,
      /apolloNonEmptyPagesCharged\s*=\s*apolloCompanies\.length > 0 \? 1 : 0/,
      'una sola página pedida: 1 crédito si trajo algo, 0 si vino vacía',
    );
  });

  it('el techo de páginas de la ruta legacy es una constante compartida, no un literal', () => {
    const provider = readCode(
      'server/agents/prospecting-toolkit/web-search-providers/apollo-organizations-search-provider.ts',
    );
    const reservation = readCode(
      'modules/prospect-batches/chat-wizard-execution/wizard-budget-estimate.ts',
    );

    assert.match(provider, /maxPages: APOLLO_LEGACY_MAX_PAGES_PER_INVOCATION/);
    assert.match(reservation, /maxPagesPerQuery: APOLLO_LEGACY_MAX_PAGES_PER_INVOCATION/);
    assert.doesNotMatch(
      provider,
      /maxPages: 1\b/,
      'el literal desacoplaría el runtime de la reserva',
    );
  });
});
