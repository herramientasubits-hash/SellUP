/**
 * apollo-two-round-effective-fingerprint-hardening.test.ts — La huella efectiva es
 * página-inclusiva, y sin ella NO hay segunda llamada pagada.
 *
 * A1-APOLLO-EFFECTIVE-FINGERPRINT-HARDENING-3 · § 2, § 3, § 4, § 5, § 6, § 7.
 *
 * Dos defectos que estas pruebas fijan:
 *
 *   § 2  `effective_request_fingerprint_matches_sent` comparaba una huella SIN
 *        página (`filtersFingerprint`) contra el ancla de la paginación, aunque su
 *        nombre promete validar el request efectivo completo. Construir la página 1
 *        y enviar la página 2 seguía declarando `true`.
 *
 *   § 3  cuando el constructor del request efectivo faltaba, lanzaba o el checkpoint
 *        era antiguo, la huella quedaba en `null` y la decisión de la ronda 2 caía en
 *        SILENCIO a la huella de HIPÓTESIS — exactamente la comparación que dejó
 *        pasar la segunda búsqueda pagada del QA `edb6f40c`.
 *
 * Todo offline y sin dobles del mapper: la huella la produce la MISMA función que
 * gobierna la llamada real.
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildApolloOrganizationsEffectiveRequest,
  toApolloContractFilters,
  verifyApolloEffectiveRequestMatchesSent,
} from '../../apollo-organizations-effective-request';
import { buildApolloEffectiveRequestFingerprint } from '../../apollo-organizations-request-contract';
import {
  runApolloOrganizationsPaginatedSearch,
  type ApolloPageFetchResult,
} from '../../apollo-organizations-paginated-search';
import { createApolloPaginationBudget } from '../../apollo-organizations-pagination-budget';
import type { WebSearchInput } from '../../types';
import {
  APOLLO_TWO_ROUND_PRODUCTION_BUILDER_REQUIRED,
  createApolloTwoRoundProductionOrchestratorDeps,
  runApolloTwoRoundDiscovery,
  sanitizeEffectiveRequestBuildErrorCode,
  type ApolloTwoRoundDeps,
  type ApolloTwoRoundProductionOrchestratorDeps,
  type ApolloTwoRoundResumeState,
  type CheapAssessment,
  type RawDiscoveredOrganization,
} from '../orchestrator';
import { buildEmptyRoundMetrics, toRoundMetricsMetadata, toRunMetricsMetadata } from '../observability';
import {
  testConfig,
  testCorrelation,
  testQueryContext,
  org,
  passingAssessment,
  rejectedAssessment,
  simulatedEffectiveRequestBuilder,
} from './fixtures';

// ─── Instrumentación: ninguna prueba puede alcanzar la red ────────────────────

let realFetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (...args: unknown[]) => {
  realFetchCalls++;
  throw new Error(`LLAMADA REAL PROHIBIDA EN TESTS: ${String(args[0])}`);
}) as typeof originalFetch;

// ─── Ayudas de transporte ─────────────────────────────────────────────────────

const WIZARD_SELECTION = {
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Retail y Consumo',
  subindustries: ['Supermercados e Hipermercados'],
} as const;

/** Request efectivo tal como lo construye el adaptador de producción. */
function effectiveRequestFor(options: {
  hypothesisKeywordTags: readonly string[];
  page?: number;
  twoRoundMaxResultsPerRound?: number;
  legacyMaxResultsPerQuery?: number;
  subindustries?: readonly string[];
}) {
  const input: WebSearchInput = {
    query: 'hipótesis legible que nunca viaja al proveedor',
    country: WIZARD_SELECTION.country,
    countryCode: WIZARD_SELECTION.countryCode,
    industry: WIZARD_SELECTION.industry,
    intent: 'company_discovery',
    maxResults: 5,
    provider: 'apollo_organizations',
    subindustries: [...(options.subindustries ?? WIZARD_SELECTION.subindustries)],
    additionalCriteriaTokens: [...options.hypothesisKeywordTags],
  };

  return buildApolloOrganizationsEffectiveRequest({
    input,
    requestedMaxResults: 5,
    resultLimitMode: 'two_round',
    twoRoundMaxResultsPerRound: options.twoRoundMaxResultsPerRound ?? 5,
    startPage: options.page ?? 1,
    // El recorte legacy a 3 sigue sin poder tocar la modalidad de dos rondas.
    legacyMaxResultsPerQuery: options.legacyMaxResultsPerQuery ?? 3,
  });
}

function okPage(count: number): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: {
      organizations: Array.from({ length: count }, (_unused, index) => ({
        id: `org_${index}`,
        name: `Supermercado ${index}`,
        primary_domain: `supermercado-${index}.com`,
      })),
      pagination: { page: 1, per_page: 5, total_entries: 40, total_pages: 8 },
    },
    headers: null,
  };
}

/**
 * Ejecuta la paginación REAL con transporte inyectado, alimentada exactamente como
 * lo hace el provider de producción: `toApolloContractFilters(effective.params)`.
 *
 * Devuelve, además del resultado, los bodies que el transporte recibió DE VERDAD —
 * que es lo único que puede probar qué salió.
 */
async function runPaginated(input: {
  /** Request cuyos filtros gobiernan la llamada. */
  from: ReturnType<typeof effectiveRequestFor>;
  /** Página que la paginación pedirá; puede diferir de la construida a propósito. */
  startPage: number;
  /** Cuando es false, ninguna petición llega a salir. */
  respond?: boolean;
}) {
  const bodies: Array<Record<string, unknown>> = [];
  let clock = 0;

  const result = await runApolloOrganizationsPaginatedSearch(
    {
      filters: toApolloContractFilters(input.from.params),
      budget: createApolloPaginationBudget({ perPage: input.from.perPage, maxPages: 1 }),
      wizardRunId: 'wizard-run-hardening-3',
      startPage: input.startPage,
    },
    {
      fetchPage: async (body) => {
        bodies.push(body);
        clock += 10;
        return okPage(3);
      },
      now: () => clock,
      random: () => 0.5,
      // Cancelado antes de la primera página ⇒ nada sale al transporte.
      ...(input.respond === false ? { isCancelled: () => true } : {}),
    },
  );

  return { result, bodies };
}

// ─── Arnés del orquestador ────────────────────────────────────────────────────

type HardenedRun = {
  searchCalls: Array<{ roundNumber: number; page: number }>;
  usageRows: Array<{ roundNumber: number; credits: number }>;
};

async function runHardened(input: {
  buildRoundProviderRequest?: ApolloTwoRoundDeps['buildRoundProviderRequest'];
  organizationsByRound?: Record<number, RawDiscoveredOrganization[]>;
  providerTotalPages?: number | null;
  assess?: () => CheapAssessment;
  resume?: ApolloTwoRoundResumeState | null;
  config?: Parameters<typeof testConfig>[0];
  queryContext?: Parameters<typeof testQueryContext>[0];
}) {
  const recorder: HardenedRun = { searchCalls: [], usageRows: [] };

  const deps: ApolloTwoRoundDeps = {
    ...(input.buildRoundProviderRequest !== undefined
      ? { buildRoundProviderRequest: input.buildRoundProviderRequest }
      : {}),
    searchRound: async ({ roundNumber, hypothesis }) => {
      recorder.searchCalls.push({ roundNumber, page: hypothesis.queryParameters.page });
      const organizations = input.organizationsByRound?.[roundNumber] ?? [];
      // Fila económica tal como la escribiría el adaptador: 1 crédito por resultado.
      recorder.usageRows.push({ roundNumber, credits: organizations.length });
      return {
        organizations,
        providerRequestCount: 1,
        internalRecordedCredits: organizations.length,
        providerTotalPages: input.providerTotalPages ?? null,
      };
    },
    assessCandidate: () => input.assess?.() ?? rejectedAssessment('sector_not_mapped'),
    enrichCandidate: async () => ({
      executed: false,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
      internalRecordedCredits: 0,
    }),
  };

  const result = await runApolloTwoRoundDiscovery(
    {
      config: testConfig(input.config),
      queryContext: testQueryContext(input.queryContext),
      correlation: testCorrelation(),
      resume: input.resume ?? null,
    },
    deps,
  );

  return { result, recorder };
}

/** Preview con huella fija: la costura para fijar igualdad y diferencia. */
function previewWith(fingerprint: string, page = 1) {
  return {
    effectiveRequestFingerprint: fingerprint,
    page,
    perPage: 5,
    effectiveKeywordTags: ['supermercado'],
  };
}

// ─── § 2: el indicador incluye la página ──────────────────────────────────────

describe('§ 2 · matches_sent compara la huella EFECTIVA, página incluida', () => {
  test('1. página 1 construida y página 1 enviada ⇒ matches_sent = true', async () => {
    const built = effectiveRequestFor({ hypothesisKeywordTags: ['grocery store'], page: 1 });
    const { result, bodies } = await runPaginated({ from: built, startPage: 1 });

    assert.equal(bodies.length, 1);
    assert.equal((bodies[0] as { page: number }).page, 1, 'el transporte recibió la página 1');
    assert.equal(
      result.effectiveRequestFingerprintSent,
      buildApolloEffectiveRequestFingerprint(bodies[0] as never),
      'la huella declarada es la del body que salió, recalculada desde él',
    );

    const verdict = verifyApolloEffectiveRequestMatchesSent({
      builtFingerprint: built.effectiveRequestFingerprint,
      sentFingerprint: result.effectiveRequestFingerprintSent,
    });
    assert.equal(verdict.matchesSent, true);
  });

  test('2. página 1 construida y el transporte recibe la página 2 ⇒ matches_sent = false', async () => {
    const builtOnPage1 = effectiveRequestFor({
      hypothesisKeywordTags: ['grocery store'],
      page: 1,
    });
    // Lo que salió fue la página 2 de los MISMOS filtros.
    const { result, bodies } = await runPaginated({ from: builtOnPage1, startPage: 2 });

    assert.equal((bodies[0] as { page: number }).page, 2, 'el transporte recibió la página 2');

    const verdict = verifyApolloEffectiveRequestMatchesSent({
      builtFingerprint: builtOnPage1.effectiveRequestFingerprint,
      sentFingerprint: result.effectiveRequestFingerprintSent,
    });
    assert.equal(verdict.matchesSent, false, 'otra página ES otra petición');

    // Y la razón por la que el criterio anterior no lo veía: el ancla idempotente
    // excluye la página a propósito, así que con ella las dos eran «iguales».
    assert.equal(
      builtOnPage1.filtersFingerprint,
      result.requestFingerprint,
      'la huella SIN página no distingue las dos peticiones: por eso no puede gobernar el indicador',
    );
  });

  test('3. términos construidos y enviados distintos ⇒ matches_sent = false', async () => {
    const built = effectiveRequestFor({ hypothesisKeywordTags: ['grocery store'] });
    // Lo que sale son OTROS términos: otra subindustria, otro body efectivo.
    const { result } = await runPaginated({
      from: effectiveRequestFor({
        hypothesisKeywordTags: ['tienda de descuento'],
        subindustries: [],
      }),
      startPage: 1,
    });

    const verdict = verifyApolloEffectiveRequestMatchesSent({
      builtFingerprint: built.effectiveRequestFingerprint,
      sentFingerprint: result.effectiveRequestFingerprintSent,
    });
    assert.equal(verdict.matchesSent, false);
  });

  test('la huella efectiva cubre los filtros semánticos y ningún campo de transporte', async () => {
    const { result, bodies } = await runPaginated({
      from: effectiveRequestFor({ hypothesisKeywordTags: ['grocery store'] }),
      startPage: 1,
    });
    const sent = result.effectiveRequestFingerprintSent;
    assert.ok(sent);

    // Todo lo que el body efectivamente llevaba está en la huella.
    for (const key of Object.keys(bodies[0] as Record<string, unknown>)) {
      assert.ok(sent.includes(`${key}=`), `la huella debe incluir ${key}: ${sent}`);
    }
    for (const expected of ['q_organization_keyword_tags=', 'organization_locations=', 'page=', 'per_page=']) {
      assert.ok(sent.includes(expected), `la huella debe incluir ${expected}: ${sent}`);
    }

    // Y los filtros semánticos que este caso no usa participan igual cuando existen:
    // dos bodies que sólo difieren en los rangos de empleados son dos peticiones.
    const base = { page: 1, per_page: 5, q_organization_keyword_tags: ['supermercado'] };
    assert.notEqual(
      buildApolloEffectiveRequestFingerprint({
        ...base,
        organization_num_employees_ranges: ['201,500'],
      }),
      buildApolloEffectiveRequestFingerprint({
        ...base,
        organization_num_employees_ranges: ['501,1000'],
      }),
    );

    // Nada no semántico: ni reloj, ni ids de request o correlación, ni cabeceras.
    for (const term of ['timestamp', 'request_id', 'correlation', 'header']) {
      assert.equal(sent.includes(term), false, `la huella no puede incluir ${term}`);
    }
    // El body que salió tampoco lleva ninguno de esos campos.
    for (const key of Object.keys(bodies[0] as Record<string, unknown>)) {
      for (const term of ['timestamp', 'request_id', 'correlation', 'header']) {
        assert.equal(key.includes(term), false, `el body no puede llevar ${key}`);
      }
    }
  });

  test('ninguna petición salió ⇒ matches_sent = null, nunca false', async () => {
    const built = effectiveRequestFor({ hypothesisKeywordTags: ['grocery store'] });
    const { result, bodies } = await runPaginated({ from: built, startPage: 1, respond: false });

    assert.equal(bodies.length, 0);
    assert.equal(result.effectiveRequestFingerprintSent, null);
    assert.equal(
      verifyApolloEffectiveRequestMatchesSent({
        builtFingerprint: built.effectiveRequestFingerprint,
        sentFingerprint: result.effectiveRequestFingerprintSent,
      }).matchesSent,
      null,
      'ausencia no es discrepancia',
    );
  });
});

// ─── § 3 y § 4: sin huella efectiva no hay ronda 2 ───────────────────────────

describe('§ 3 · la ronda 2 exige DOS huellas efectivas y distintas', () => {
  test('4. constructor efectivo ausente ⇒ ronda 2 omitida, 1 sola llamada, créditos de la ronda 1', async () => {
    const { result, recorder } = await runHardened({
      organizationsByRound: { 1: [org('uno'), org('dos')] },
    });

    assert.equal(recorder.searchCalls.length, 1, 'providerCalls = 1');
    assert.deepEqual(recorder.usageRows, [{ roundNumber: 1, credits: 2 }], 'una sola fila de uso');
    assert.equal(result.runMetrics.totalSearchCredits, 2, 'sólo el gasto de la ronda 1');
    assert.equal(
      result.secondRoundSkippedReason,
      'effective_request_fingerprint_unavailable',
    );
    assert.equal(result.effectiveFingerprintsAreDistinct, null);

    const round1 = result.rounds.find((round) => round.roundNumber === 1);
    assert.ok(round1);
    assert.equal(round1.effectiveRequestBuildStatus, 'unavailable_dependency');
    assert.equal(round1.effectiveRequestBuildErrorCode, null);
    assert.equal(round1.effectiveProviderFingerprint, null);
  });

  test('5. el constructor lanza ⇒ el wizard no colapsa, ronda 2 omitida, build_status = build_error', async () => {
    const { result, recorder } = await runHardened({
      buildRoundProviderRequest: () => {
        throw new TypeError('mapper roto');
      },
      organizationsByRound: { 1: [org('uno')] },
    });

    // La ronda 1 ya ejecutada se devuelve entera: un fallo de construcción no puede
    // tumbar una corrida que ya gastó.
    assert.equal(recorder.searchCalls.length, 1);
    assert.equal(result.roundsExecuted, 1);
    assert.equal(result.runMetrics.totalSearchCredits, 1);
    assert.equal(result.resultStatus, 'partial_target_not_reached');
    assert.equal(
      result.secondRoundSkippedReason,
      'effective_request_fingerprint_unavailable',
    );

    const round1 = result.rounds[0];
    assert.equal(round1.effectiveRequestBuildStatus, 'build_error');
    assert.equal(round1.effectiveRequestBuildErrorCode, 'effective_request_build_threw:TypeError');
  });

  test('el código de error es sanitizado: ni mensaje, ni traza, ni secretos', () => {
    const withSecretMessage = new Error('apollo api key sk-live-0123456789 falló en /v1/search');
    const code = sanitizeEffectiveRequestBuildErrorCode(withSecretMessage);

    assert.equal(code, 'effective_request_build_threw:Error');
    for (const leak of ['sk-live', 'api key', '/v1/search', 'falló']) {
      assert.equal(code.includes(leak), false, `el código no puede filtrar «${leak}»`);
    }
    // Un nombre de error arbitrario no se propaga crudo.
    const weird = new Error('x');
    weird.name = 'Nombre Con Espacios Y $ímbolos';
    assert.equal(sanitizeEffectiveRequestBuildErrorCode(weird), 'effective_request_build_threw:unknown');
  });

  test('el constructor devuelve null ⇒ build_error, no «dependencia ausente»', async () => {
    const { result } = await runHardened({
      buildRoundProviderRequest: () => null,
      organizationsByRound: { 1: [org('uno')] },
    });

    assert.equal(result.rounds[0].effectiveRequestBuildStatus, 'build_error');
    assert.equal(
      result.rounds[0].effectiveRequestBuildErrorCode,
      'effective_request_builder_returned_no_fingerprint',
    );
    assert.equal(
      result.secondRoundSkippedReason,
      'effective_request_fingerprint_unavailable',
    );
  });

  test('7. hipótesis distintas pero huella efectiva no disponible ⇒ NO autoriza la ronda 2', async () => {
    /**
     * El fallback que este hito elimina. La ronda 2 propone términos que difieren de
     * verdad —`differsFromRound1 === true` y otra huella de hipótesis—, y el criterio
     * anterior habría emitido la segunda búsqueda pagada con eso como única prueba.
     */
    const { result, recorder } = await runHardened({
      // Sólo la ronda 1 obtiene huella efectiva; la 2 no se puede construir.
      buildRoundProviderRequest: ({ roundNumber }) =>
        roundNumber === 1 ? previewWith('huella-ronda-1') : null,
      organizationsByRound: { 1: [org('uno')], 2: [org('dos')] },
      providerTotalPages: 8,
    });

    const round1 = result.rounds.find((round) => round.roundNumber === 1);
    assert.ok(round1);
    assert.ok(
      typeof round1.providerRequestFingerprint === 'string' &&
        round1.providerRequestFingerprint.length > 0,
      'la huella de HIPÓTESIS sigue registrada: es diagnóstico válido',
    );

    assert.equal(recorder.searchCalls.length, 1, 'ni una llamada de la ronda 2');
    assert.equal(recorder.usageRows.length, 1, 'ni una fila de uso de la ronda 2');
    assert.equal(result.runMetrics.totalSearchCredits, 1, 'ni un crédito de la ronda 2');
    assert.equal(
      result.secondRoundSkippedReason,
      'effective_request_fingerprint_unavailable',
      'la causa NO puede ser «las hipótesis difieren»',
    );
    assert.equal(result.effectiveFingerprintsAreDistinct, null);
  });

  test('8. huellas efectivas iguales ⇒ identical_provider_request, cero llamada/uso/crédito extra', async () => {
    const identical = previewWith('misma-huella-efectiva');
    const { result, recorder } = await runHardened({
      buildRoundProviderRequest: () => identical,
      organizationsByRound: { 1: [org('uno'), org('dos'), org('tres')] },
    });

    assert.equal(result.secondRoundSkippedReason, 'identical_provider_request');
    assert.equal(result.effectiveFingerprintsAreDistinct, false);
    assert.equal(recorder.searchCalls.length, 1);
    assert.equal(recorder.usageRows.length, 1);
    assert.equal(result.runMetrics.totalSearchCredits, 3);
    assert.equal(result.rounds.some((round) => round.roundNumber === 2), false);
  });

  test('9. huellas efectivas distintas ⇒ la ronda 2 se ejecuta con normalidad', async () => {
    const { result, recorder } = await runHardened({
      buildRoundProviderRequest: ({ roundNumber }) => previewWith(`huella-ronda-${roundNumber}`),
      organizationsByRound: { 1: [org('uno')], 2: [org('dos')] },
    });

    assert.deepEqual(
      recorder.searchCalls.map((call) => call.roundNumber),
      [1, 2],
    );
    assert.equal(result.secondRoundSkippedReason, null);
    assert.equal(result.effectiveFingerprintsAreDistinct, true);
    assert.equal(result.roundsExecuted, 2);
  });
});

// ─── § 5: compatibilidad con checkpoints anteriores ──────────────────────────

/**
 * Ronda 1 tal como la escribió un checkpoint ANTERIOR a este hito: sin
 * `effectiveProviderFingerprint` y sin `effectiveRequestBuildStatus`.
 *
 * El `delete` modela JSON de un escritor viejo, que es la situación real: el tipo de
 * hoy exige los campos, el documento persistido de ayer no los tiene.
 */
function legacyRound1Metrics() {
  const metrics = buildEmptyRoundMetrics(1, 'supermercados en Colombia', null, {
    requestFingerprint: 'hipotesis-ronda-1',
    page: 1,
  });
  metrics.rawResultsReturned = 3;
  metrics.normalizedResults = 3;
  metrics.newUniqueResults = 3;
  const asLegacy = metrics as unknown as Record<string, unknown>;
  delete asLegacy['effectiveProviderFingerprint'];
  delete asLegacy['effectiveRequestBuildStatus'];
  delete asLegacy['effectiveRequestBuildErrorCode'];
  return metrics;
}

describe('§ 5 · checkpoint legacy: se conserva lo pagado, no se autoriza una ronda 2', () => {
  test('6. checkpoint sin huella efectiva ⇒ ronda 1 no se repite y ronda 2 no se ejecuta', async () => {
    const resume: ApolloTwoRoundResumeState = {
      seenIdentities: [],
      candidates: [],
      rounds: [legacyRound1Metrics()],
      totalRawResults: 3,
      totalSearchCredits: 3,
      totalEnrichmentCredits: 1,
      enrichmentsExecuted: 1,
      observedRejectionReasons: ['sector_not_mapped'],
    };

    const { result, recorder } = await runHardened({
      buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
      organizationsByRound: { 1: [org('uno')], 2: [org('dos')] },
      providerTotalPages: 8,
      resume,
    });

    assert.equal(recorder.searchCalls.length, 0, 'la ronda 1 NO se vuelve a buscar');
    assert.equal(recorder.usageRows.length, 0, 'ninguna llamada nueva al proveedor');
    assert.equal(
      result.secondRoundSkippedReason,
      'legacy_checkpoint_missing_effective_fingerprint',
    );
    assert.equal(result.effectiveFingerprintsAreDistinct, null);

    // Resultados, uso y créditos ya registrados se conservan intactos.
    assert.equal(result.roundsExecuted, 1);
    assert.equal(result.runMetrics.totalRawResults, 3);
    assert.equal(result.runMetrics.totalSearchCredits, 3);
    assert.equal(result.runMetrics.totalEnrichmentCredits, 1);
  });

  test('la huella de hipótesis NO se usa para rellenar la efectiva', async () => {
    const { result } = await runHardened({
      buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
      resume: {
        seenIdentities: [],
        candidates: [],
        rounds: [legacyRound1Metrics()],
        totalRawResults: 3,
        totalSearchCredits: 3,
        totalEnrichmentCredits: 0,
        enrichmentsExecuted: 0,
        observedRejectionReasons: [],
      },
    });

    const round1 = result.rounds[0];
    assert.equal(round1.providerRequestFingerprint, 'hipotesis-ronda-1');
    assert.notEqual(
      round1.effectiveProviderFingerprint,
      'hipotesis-ronda-1',
      'rellenar la efectiva con la de hipótesis reabriría el defecto',
    );
    assert.equal(round1.effectiveProviderFingerprint ?? null, null);
    assert.equal(round1.effectiveRequestBuildStatus, 'legacy_checkpoint_missing');
  });

  test('11. un checkpoint NUEVO conserva sus huellas efectivas y su estado', async () => {
    const built = buildEmptyRoundMetrics(1, 'supermercados en Colombia', null, {
      requestFingerprint: 'hipotesis-ronda-1',
      effectiveRequestFingerprint: 'huella-efectiva-ronda-1',
      effectiveRequestBuildStatus: 'success',
      page: 1,
      perPage: 5,
    });

    const { result, recorder } = await runHardened({
      // La ronda 2 propone algo genuinamente distinto: con la huella de la ronda 1
      // rehidratada correctamente, debe poder ejecutarse.
      buildRoundProviderRequest: () => previewWith('huella-efectiva-ronda-2'),
      organizationsByRound: { 2: [org('dos')] },
      providerTotalPages: 8,
      resume: {
        seenIdentities: [],
        candidates: [],
        rounds: [built],
        totalRawResults: 3,
        totalSearchCredits: 3,
        totalEnrichmentCredits: 0,
        enrichmentsExecuted: 0,
        observedRejectionReasons: [],
      },
    });

    const round1 = result.rounds.find((round) => round.roundNumber === 1);
    assert.ok(round1);
    assert.equal(round1.effectiveProviderFingerprint, 'huella-efectiva-ronda-1');
    assert.equal(round1.effectiveRequestBuildStatus, 'success');

    assert.deepEqual(recorder.searchCalls.map((call) => call.roundNumber), [2]);
    assert.equal(result.secondRoundSkippedReason, null);
    assert.equal(result.effectiveFingerprintsAreDistinct, true);
  });
});

// ─── § 6: producción no puede configurarse sin el constructor ─────────────────

describe('§ 6 · el adaptador de producción EXIGE el constructor efectivo', () => {
  const stubDeps = {
    searchRound: async () => ({
      organizations: [],
      providerRequestCount: 0,
      internalRecordedCredits: 0,
    }),
    assessCandidate: () => passingAssessment(),
    enrichCandidate: async () => ({
      executed: false,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment' as const,
      internalRecordedCredits: 0,
    }),
  };

  test('10. sin builder efectivo la factory de producción falla ruidoso', () => {
    assert.throws(
      () =>
        createApolloTwoRoundProductionOrchestratorDeps(
          // El `as` modela un objeto armado dinámicamente: el tipo ya lo prohíbe en
          // compilación, y esto prueba que en runtime tampoco pasa.
          stubDeps as unknown as ApolloTwoRoundProductionOrchestratorDeps,
        ),
      (err: unknown) =>
        err instanceof Error && err.message === APOLLO_TWO_ROUND_PRODUCTION_BUILDER_REQUIRED,
      'producción no puede ejecutar dos rondas sin el constructor efectivo',
    );
  });

  test('con builder efectivo la factory devuelve las dependencias tal cual', () => {
    const builder = simulatedEffectiveRequestBuilder();
    const deps = createApolloTwoRoundProductionOrchestratorDeps({
      ...stubDeps,
      buildRoundProviderRequest: builder,
    });
    assert.equal(deps.buildRoundProviderRequest, builder);
  });

  test('el runner de producción pasa por la factory, no arma las deps a mano', () => {
    // Comprobación estática: el único camino de producción hacia el orquestador debe
    // atravesar la puerta que exige el constructor efectivo.
    const source = readFileSync(
      path.join(process.cwd(), 'src/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts'),
      'utf8',
    );
    assert.ok(
      source.includes('createApolloTwoRoundProductionOrchestratorDeps('),
      'production-runner.server.ts debe construir sus deps con la factory',
    );
    assert.ok(
      source.includes('ApolloTwoRoundProductionOrchestratorDeps'),
      'y tiparlas con el tipo que exige el builder',
    );
  });
});

// ─── § 7: observabilidad completa ─────────────────────────────────────────────

describe('§ 7 · un run futuro reporta las dos huellas, su estado y la causa del skip', () => {
  test('la metadata por ronda nombra huella de hipótesis, huella efectiva y build_status', async () => {
    const { result } = await runHardened({
      buildRoundProviderRequest: ({ roundNumber }) => previewWith(`huella-ronda-${roundNumber}`),
      organizationsByRound: { 1: [org('uno')], 2: [org('dos')] },
    });

    for (const round of result.rounds) {
      const metadata = toRoundMetricsMetadata(round);
      assert.equal(metadata['hypothesis_fingerprint'], round.providerRequestFingerprint);
      assert.equal(metadata['effective_provider_fingerprint'], round.effectiveProviderFingerprint);
      assert.equal(metadata['effective_request_build_status'], 'success');
      assert.equal(metadata['effective_request_build_error_code'], null);
    }

    const runMetadata = toRunMetricsMetadata(result.runMetrics);
    assert.equal(runMetadata['effective_fingerprints_are_distinct'], true);
  });

  test('requests iguales: distinct = false, ronda 2 no ejecutada, skip = identical_provider_request', async () => {
    const identical = previewWith('misma-huella');
    const { result } = await runHardened({
      buildRoundProviderRequest: () => identical,
      organizationsByRound: { 1: [org('uno')] },
    });

    assert.equal(result.runMetrics.effectiveFingerprintsAreDistinct, false);
    assert.equal(result.roundsExecuted, 1);
    assert.equal(result.secondRoundSkippedReason, 'identical_provider_request');
  });

  test('huella no disponible: distinct = null (NO false) y skip = ..._unavailable', async () => {
    const { result } = await runHardened({ organizationsByRound: { 1: [org('uno')] } });

    assert.equal(
      result.runMetrics.effectiveFingerprintsAreDistinct,
      null,
      'un valor desconocido no puede presentarse como false',
    );
    assert.equal(
      toRunMetricsMetadata(result.runMetrics)['effective_fingerprints_are_distinct'],
      null,
    );
    assert.equal(result.secondRoundSkippedReason, 'effective_request_fingerprint_unavailable');
  });

  test('objetivo alcanzado en la ronda 1: no hubo comparación ⇒ distinct = null', async () => {
    const { result } = await runHardened({
      buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
      organizationsByRound: {
        1: Array.from({ length: 5 }, (_unused, index) =>
          org(`r1-${index + 1}`, { providerRank: index + 1 }),
        ),
      },
      assess: () => passingAssessment(),
    });

    assert.equal(result.targetReached, true);
    assert.equal(result.secondRoundSkippedReason, 'target_reached');
    assert.equal(result.effectiveFingerprintsAreDistinct, null);
  });
});

// ─── § 8: no hay regresión de lo que #209 cerró ──────────────────────────────

describe('sin regresión de QUERY-QUALITY-2 (#209)', () => {
  /** Constructor REAL: la huella sale de la misma función que gobierna la llamada. */
  const realBuilder: NonNullable<ApolloTwoRoundDeps['buildRoundProviderRequest']> = ({
    hypothesis,
    requestedResultLimit,
  }) => {
    const effective = effectiveRequestFor({
      hypothesisKeywordTags: hypothesis.queryParameters.keywordTags,
      page: hypothesis.queryParameters.page,
      twoRoundMaxResultsPerRound: requestedResultLimit,
    });
    return {
      effectiveRequestFingerprint: effective.effectiveRequestFingerprint,
      page: effective.page,
      perPage: effective.perPage,
      effectiveKeywordTags: effective.effectiveKeywordTags,
    };
  };

  test('12. el caso target = 5 sigue alcanzándose con la ronda 2', async () => {
    const { result, recorder } = await runHardened({
      buildRoundProviderRequest: ({ roundNumber, hypothesis, requestedResultLimit }) =>
        // Las dos rondas piden algo distinto de verdad; la real lo consigue por
        // términos o por página, y aquí eso ya está probado aparte.
        roundNumber === 1
          ? realBuilder({ roundNumber, hypothesis, requestedResultLimit })
          : previewWith('huella-ronda-2-distinta'),
      organizationsByRound: {
        1: Array.from({ length: 3 }, (_unused, index) =>
          org(`r1-${index + 1}`, { providerRank: index + 1 }),
        ),
        2: Array.from({ length: 2 }, (_unused, index) =>
          org(`r2-${index + 1}`, { providerRank: index + 1 }),
        ),
      },
      assess: () => passingAssessment(),
      providerTotalPages: 8,
    });

    assert.deepEqual(recorder.searchCalls.map((call) => call.roundNumber), [1, 2]);
    assert.equal(result.eligibleCompaniesFound, 5);
    assert.equal(result.persistedCandidates, 5);
    assert.equal(result.targetReached, true);
    assert.equal(result.resultStatus, 'target_reached');
  });

  test('13. `per_page` = 5 en two-round: la variable legacy no lo recorta a 3', () => {
    const effective = effectiveRequestFor({
      hypothesisKeywordTags: ['grocery store'],
      twoRoundMaxResultsPerRound: 5,
      legacyMaxResultsPerQuery: 3,
    });

    assert.equal(effective.perPage, 5);
    assert.equal(effective.body.per_page, 5);
    assert.equal(effective.limit.limitMode, 'two_round');
    assert.equal(effective.limit.legacyMaxResultsPerQuery, 3, 'el legacy queda como diagnóstico');
    assert.ok(effective.effectiveRequestFingerprint.includes('per_page=5'));
  });

  test('la prioridad de la subindustria sobre los términos genéricos se mantiene', () => {
    const effective = effectiveRequestFor({ hypothesisKeywordTags: ['grocery store'] });
    assert.equal(effective.effectiveKeywordTags[0], 'supermercado');
    assert.ok(effective.effectiveKeywordTags.includes('hipermercado'));
  });

  test('14. la ruta legacy sigue sin regresión: su límite y su huella no cambian', () => {
    const legacy = buildApolloOrganizationsEffectiveRequest({
      input: {
        query: 'supermercados en Colombia',
        country: WIZARD_SELECTION.country,
        countryCode: WIZARD_SELECTION.countryCode,
        industry: WIZARD_SELECTION.industry,
        intent: 'company_discovery',
        maxResults: 5,
        provider: 'apollo_organizations',
        subindustries: [...WIZARD_SELECTION.subindustries],
      },
      requestedMaxResults: 5,
      // Sin `resultLimitMode` ⇒ legacy, como todos los llamadores previos.
      legacyMaxResultsPerQuery: 3,
    });

    assert.equal(legacy.limit.limitMode, 'legacy');
    assert.equal(legacy.perPage, 3, 'la ruta legacy sigue gobernada por su variable');
    assert.equal(legacy.limit.twoRoundMaxResultsPerRound, null);
    assert.equal(legacy.page, 1, 'y sigue arrancando en la página 1');
  });
});

// ─── Cierre: cero red ─────────────────────────────────────────────────────────

describe('la suite es offline por construcción', () => {
  test('ninguna prueba intentó salir a la red', () => {
    assert.equal(realFetchCalls, 0, 'LIVE_APOLLO_CALLS debe ser 0');
    globalThis.fetch = originalFetch;
  });
});
