/**
 * apollo-two-round-live-net-new-pagination.test.ts
 *
 * AGENT1-APOLLO-NET-NEW-PAGINATION-LIVE-WIRING.
 *
 * Prueba, con las funciones REALES de producción (no reimplementaciones), que
 * la pieza que faltaba —conectar `netNewTarget`/`evaluateCandidateAcceptance`
 * desde `production-runner.server.ts` hacia el provider real
 * (`runApolloOrganizationsSearch`) y desde ahí al motor de paginación
 * (`runApolloOrganizationsPaginatedSearch`)— efectivamente permite que UNA
 * ronda pida VARIAS páginas de Apollo dentro de una sola invocación, en vez de
 * quedarse en la página 1 como antes de este corte.
 *
 * Diferencia deliberada con `agent1-apollo-net-new-pagination-scenarios.test.ts`
 * (que ejercita el motor de paginación EN AISLAMIENTO, llamándolo
 * directamente): aquí se atraviesa la ruta REAL completa —
 *
 *   runApolloTwoRoundWizardDiscovery
 *     → runApolloTwoRoundDiscovery (orquestador, sin cambios)
 *       → production-runner.server.ts `searchRound`/`buildRoundSearchRequest`
 *         → runApolloOrganizationsSearch (provider real)
 *           → runApolloOrganizationsPaginatedSearch (motor real)
 *
 * Lo único simulado es el transporte HTTP de Apollo (`fetchPage`) y el índice
 * histórico pre-pago (`loadPrepaidHistoricalIndex`, que por contrato consulta
 * una base de datos). Cero llamadas reales, cero créditos reales, cero
 * escrituras. `ENABLE_APOLLO_COMPANY_SEARCH` se fuerza a 'true' porque
 * `runApolloOrganizationsSearch` no ejecuta nada real (ni siquiera contra el
 * transporte inyectado) cuando el flag está apagado — con el flag apagado
 * cortocircuita a `skipped: true` antes de construir un solo request.
 *
 * `buildCandidate` / `enrichCascade` / `persistCandidates` se simulan como ya
 * hace `apollo-two-round-production-wiring.test.ts` (que SÍ es la ruta REAL, el
 * mismo patrón que este archivo copia): lo que este hito cambia vive en la capa
 * de búsqueda, no en el pipeline de candidatos —cuya corrección multi-gate ya
 * cubren otras suites—, así que fijar el pipeline de candidatos a un doble
 * simple no reduce la fidelidad de lo que aquí se prueba (páginas, créditos,
 * cap de enrichment) y evita reconstruir cien organizaciones que superen los
 * gates reales de sector/ownership/calidad candidato a candidato.
 *
 * `assessCandidate` (país, dominio, TLD, ownership, plataforma externa,
 * cooldown, historial, sector) SÍ es real y NUNCA se sobreescribe: no es
 * override-able (vive dentro de `createApolloTwoRoundProductionOrchestratorDeps`),
 * así que las organizaciones sintéticas de este archivo replican la receta ya
 * probada de `confirmedSupermarket()` (dominio `.com.co` que contiene la marca
 * del nombre, industria y snippet que confirman el sector sin enrichment) o de
 * `ambiguousOrganization()` (sin industria/snippet, para las escenas que
 * necesitan competir por un enrichment) de esa misma suite.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundWizardDiscovery,
  type ApolloTwoRoundProductionDeps,
  type ApolloTwoRoundWizardRunInput,
} from '../production-runner.server';
import type { ApolloTwoRoundCheckpointV1 } from '../checkpoint';
import { APOLLO_TWO_ROUND_OBSERVABILITY_KEY } from '../observability';
import {
  estimateApolloTwoRoundBudget,
  type ApolloTwoRoundBudgetBreakdown,
} from '../budget';
import type { ApolloTwoRoundDiscoveryConfig } from '../config';
import { WIZARD_APOLLO_MAX_PAGES_HARD_CAP } from '../../apollo-organizations-pagination-budget';
import {
  runApolloOrganizationsSearch,
  type ApolloOrgsSearchOptions,
} from '../../web-search-providers/apollo-organizations-search-provider';
import type { ApolloPageFetchResult } from '../../apollo-organizations-paginated-search';
import type { NoveltyIndex } from '../../novelty-checker';
import type { HistoricalCandidateRow } from '../../apollo-prepaid-historical-parity';
import type { ProspectingPipelineCandidate, WebSearchResult } from '../../types';

// ─── Entorno ────────────────────────────────────────────────────────────────
//
// `runApolloOrganizationsSearch` (la ruta REAL que este archivo atraviesa)
// corta en seco a `skipped: true` si el flag está apagado, ANTES de tocar el
// transporte inyectado. Se enciende sólo durante esta suite y se restaura.

let previousFlag: string | undefined;
beforeEach(() => {
  previousFlag = process.env.ENABLE_APOLLO_COMPANY_SEARCH;
  process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
});
afterEach(() => {
  if (previousFlag === undefined) delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
  else process.env.ENABLE_APOLLO_COMPANY_SEARCH = previousFlag;
});

// ─── Fixtures de organizaciones Apollo CRUDAS ────────────────────────────────
//
// Van al `fetchPage` FALSO, así que tienen la forma JSON cruda que Apollo
// devolvería — no `WebSearchResult` (ésa la construye `runApolloOrganizationsSearch`
// de verdad, vía `mapApolloOrganizationToSearchResult`, ejercitando esa
// conversión real).

/**
 * Una organización cuyo nombre y snippet ya confirman el sector sin
 * enrichment — la receta de `confirmedSupermarket()` en
 * `apollo-two-round-production-wiring.test.ts`, adaptada a JSON crudo de
 * Apollo. El dominio contiene la marca normalizada del nombre (gate de
 * ownership real) y el `short_description` trae el texto que el gate
 * sectorial real ya reconoce como evidencia libre de "Supermercados e
 * Hipermercados".
 */
function confirmedRawOrg(id: string): Record<string, unknown> {
  const domain = `netnewco${id}.com.co`;
  return {
    id: `org-${id}`,
    name: `NetNewCo ${id}`,
    primary_domain: domain,
    website_url: `https://${domain}`,
    linkedin_url: `https://www.linkedin.com/company/org-${id}`,
    industry: 'retail',
    estimated_num_employees: 500,
    city: 'Bogotá',
    country: 'Colombia',
    short_description: 'cadena de supermercados y autoservicio con tiendas de abarrotes',
  };
}

/**
 * Una organización SIN evidencia sectorial libre — la receta de
 * `ambiguousOrganization()` de esa misma suite. Sin `industry` ni snippet, el
 * gate sectorial real la deja en `sector_evidence_missing_needs_enrichment`:
 * compite por un enrichment en vez de contar directo.
 */
function ambiguousRawOrg(id: string): Record<string, unknown> {
  const domain = `netnewambigua${id}.com.co`;
  return {
    id: `org-amb-${id}`,
    name: `NetNew Ambigua ${id}`,
    primary_domain: domain,
    website_url: `https://${domain}`,
    estimated_num_employees: 400,
    city: 'Bogotá',
    country: 'Colombia',
  };
}

/** N organizaciones históricas — sólo necesitan un dominio único y válido. */
function historicalRawOrgs(prefix: string, count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_unused, i) => confirmedRawOrg(`${prefix}h${i}`));
}

function domainOfRawOrg(raw: Record<string, unknown>): string {
  return raw['primary_domain'] as string;
}

function pagePayload(
  page: number,
  orgs: Record<string, unknown>[],
  totalPages: number | null = 10,
): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: {
      organizations: orgs,
      pagination: { page, per_page: 100, total_entries: 5_000, total_pages: totalPages },
    },
    headers: null,
  };
}

/**
 * `totalPages` por defecto = `page`: declara esta página como la ÚLTIMA, así
 * que la paginación se detiene por agotamiento del proveedor
 * (`last_page_reached`) — igual que el Escenario M/N de
 * `agent1-apollo-net-new-pagination-scenarios.test.ts`. Una página corta o
 * vacía NUNCA detiene la paginación por sí sola (§ docstring del motor); sólo
 * `total_pages` o los topes lo hacen, así que cada fixture de esta suite debe
 * declarar `total_pages` explícitamente para que la paginación se detenga
 * donde el escenario lo espera.
 */
function accountsOnlyPagePayload(page: number, totalPages: number = page): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: {
      organizations: [],
      accounts: [{ id: 'acc-1', organization_id: 'org-not-in-organizations', name: 'Cuenta Sola' }],
      pagination: { page, per_page: 100, total_entries: 5_000, total_pages: totalPages },
    },
    headers: null,
  };
}

function emptyPagePayload(page: number, totalPages: number = page): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: {
      organizations: [],
      accounts: [],
      pagination: { page, per_page: 100, total_entries: 5_000, total_pages: totalPages },
    },
    headers: null,
  };
}

// ─── Transporte HTTP falso, con la ruta REAL del provider por debajo ─────────
//
// `production-runner.server.ts` invoca `deps.searchApollo(...)` con el 4º
// parámetro (`deps` del provider) fijo en `undefined` — no hay forma de
// inyectar un transporte falso desde ahí. Este wrapper reemplaza
// `ApolloTwoRoundProductionDeps.searchApollo` (que SÍ es inyectable) por una
// función que llama al `runApolloOrganizationsSearch` REAL, pero con el
// transporte (`fetchPage`) y el logging de uso sustituidos. Es la única forma
// de ejercitar el motor de paginación real de punta a punta sin red: el motor
// de paginación no admite mockearse "por dentro" sin tocar
// `apollo-organizations-search-provider.ts`, que el hito prohíbe modificar.
function buildFakeSearchApollo(pagesByRound: ApolloPageFetchResult[][]): {
  searchApollo: ApolloTwoRoundProductionDeps['searchApollo'];
  /** (roundIndex 0-based, page) por cada fetch realmente emitido. */
  pageFetchLog: Array<{ round: number; page: number }>;
} {
  let roundIndex = -1;
  const pageFetchLog: Array<{ round: number; page: number }> = [];

  const searchApollo = (async (
    searchInput: unknown,
    maxResults: number,
    usageContext: unknown,
    _ignoredProviderDeps: unknown,
    searchOptions: ApolloOrgsSearchOptions | undefined,
  ) => {
    const thisRound = ++roundIndex;
    const pages = pagesByRound[thisRound] ?? [];
    let callIndex = 0;
    const fetchPage = async (body: Record<string, unknown>): Promise<ApolloPageFetchResult> => {
      const page = Number(body['page'] ?? 0);
      pageFetchLog.push({ round: thisRound, page });
      const result = pages[Math.min(callIndex, pages.length - 1)] ?? emptyPagePayload(page);
      callIndex++;
      return result;
    };
    return runApolloOrganizationsSearch(
      searchInput as never,
      maxResults,
      usageContext as never,
      {
        fetchPage,
        now: () => 0,
        random: () => 0,
        sleep: async () => {},
        logUsage: async () => ({ kind: 'ok' }) as never,
        recordProviderSeen: (async () => undefined) as never,
      },
      searchOptions,
    );
  }) as unknown as ApolloTwoRoundProductionDeps['searchApollo'];

  return { searchApollo, pageFetchLog };
}

// ─── Índice histórico pre-pago falso ──────────────────────────────────────────
//
// `loadPrepaidHistoricalIndex` es, por contrato (`buildNoveltyIndex`), una
// consulta ESCOPEADA a un conjunto de dominios — no existe una forma de "traer
// todo" sin dominios, así que no se puede precargar antes de que Apollo
// devuelva las páginas. Este doble responde, para cada dominio pedido, si está
// en el conjunto "histórico" que cada escenario declara.
function buildFakeHistoricalLoader(historicalDomains: ReadonlySet<string>): {
  loadPrepaidHistoricalIndex: ApolloTwoRoundProductionDeps['loadPrepaidHistoricalIndex'];
  callCount: () => number;
} {
  let calls = 0;
  const loadPrepaidHistoricalIndex = async ({
    domains,
  }: {
    domains: readonly string[];
  }): Promise<{ index: NoveltyIndex; degraded: boolean }> => {
    calls++;
    const index = new Map<string, HistoricalCandidateRow[]>();
    for (const domain of domains) {
      if (historicalDomains.has(domain)) {
        index.set(domain, [
          {
            id: `hist-${domain}`,
            name: domain,
            domain,
            status: 'approved',
            source_primary: 'production',
          },
        ]);
      }
    }
    return { index: index as unknown as NoveltyIndex, degraded: false };
  };
  return { loadPrepaidHistoricalIndex, callCount: () => calls };
}

// ─── Config y correlación ─────────────────────────────────────────────────────

const CORRELATION = {
  wizardRunId: 'live-net-new-run-1',
  clientRequestId: 'live-net-new-client-1',
  batchId: 'live-net-new-batch-1',
  reservationId: 'live-net-new-reservation-1',
  requestFingerprint: 'live-net-new-fingerprint-1',
  idempotencyKey: 'live-net-new-idempotency-1',
};

function liveConfig(
  overrides: Partial<ApolloTwoRoundDiscoveryConfig> = {},
): ApolloTwoRoundDiscoveryConfig {
  return {
    targetEligibleCompanies: 6,
    maxRounds: 1,
    maxResultsPerRound: 6,
    maxRawResultsPerRun: 1000,
    maxEnrichmentsPerRun: 0,
    ...overrides,
  };
}

function runInput(overrides: Partial<ApolloTwoRoundWizardRunInput> = {}): ApolloTwoRoundWizardRunInput {
  return {
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Supermercados e Hipermercados',
    subindustries: [],
    additionalCriteria: null,
    reservedBatchId: CORRELATION.batchId,
    triggeredByUserId: 'user-1',
    ownerId: 'user-1',
    correlation: CORRELATION,
    runCorrelationMetadata: null,
    extraBatchMetadata: null,
    reservedCredits: 1000,
    ...overrides,
  };
}

// ─── Doble de candidato / enrichment / persistencia ──────────────────────────
//
// Misma receta que `apollo-two-round-production-wiring.test.ts` (la suite de
// la ruta REAL de referencia): estos tres SÍ se simulan porque lo que este
// hito cambia es la capa de búsqueda, no el pipeline de candidatos.

function pipelineCandidate(result: WebSearchResult): ProspectingPipelineCandidate {
  const meta = (result.metadata ?? {}) as Record<string, unknown>;
  const domain = (meta['domain'] as string) ?? '';
  return {
    name: result.title,
    website: result.url,
    domain,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Supermercados e Hipermercados',
    sourceUrl: result.url,
    sourceTitle: result.title,
    sourceSnippet: result.snippet ?? null,
    websiteVerification: null,
    duplicateCheck: {
      status: 'new_candidate',
      confidence: 0,
      input: { name: result.title },
      matches: [],
      summary: 'live-net-new-pagination-fixture',
      checkedSources: ['sellup', 'hubspot'],
    } as ProspectingPipelineCandidate['duplicateCheck'],
    scoring: { qualityLabel: 'high_quality_new' } as ProspectingPipelineCandidate['scoring'],
  } as ProspectingPipelineCandidate;
}

type Recorder = {
  enrichCascadeCalls: string[];
  persistedCandidateNames: string[];
  savedCheckpoints: ApolloTwoRoundCheckpointV1[];
};

function buildDeps(options: {
  pagesByRound: ApolloPageFetchResult[][];
  historicalDomains?: ReadonlySet<string>;
  config: ApolloTwoRoundDiscoveryConfig;
  loadCheckpoint?: ApolloTwoRoundProductionDeps['loadCheckpoint'];
  enrichmentSucceeds?: boolean;
}): {
  deps: Partial<ApolloTwoRoundProductionDeps>;
  recorder: Recorder;
  pageFetchLog: Array<{ round: number; page: number }>;
  historicalLoadCallCount: () => number;
} {
  const recorder: Recorder = {
    enrichCascadeCalls: [],
    persistedCandidateNames: [],
    savedCheckpoints: [],
  };
  const { searchApollo, pageFetchLog } = buildFakeSearchApollo(options.pagesByRound);
  const { loadPrepaidHistoricalIndex, callCount } = buildFakeHistoricalLoader(
    options.historicalDomains ?? new Set(),
  );

  const deps: Partial<ApolloTwoRoundProductionDeps> = {
    searchApollo,
    loadPrepaidHistoricalIndex,

    buildCandidate: (async (result: WebSearchResult) => ({
      candidate: pipelineCandidate(result),
      nameQualityFiltered: false,
    })) as unknown as ApolloTwoRoundProductionDeps['buildCandidate'],

    // Confirma el sector para CUALQUIER dominio que se le pida enriquecer —
    // exactamente la misma forma de doble que
    // `apollo-two-round-production-wiring.test.ts` usa para su cascade falso.
    enrichCascade: (async (results: WebSearchResult[]) => {
      const result = results[0];
      const meta = (result?.metadata ?? {}) as Record<string, unknown>;
      const domain = (meta['domain'] as string) ?? '';
      recorder.enrichCascadeCalls.push(domain);
      const succeeded = options.enrichmentSucceeds !== false;
      return {
        results: [result],
        meta: {
          enabled: true,
          cascade_version: 'test',
          entries: [
            succeeded
              ? { domain, enriched: true, fields_added: ['industry'] }
              : { domain, enriched: false, skip_reason: 'enrichment_failed' },
          ],
        },
      };
    }) as unknown as ApolloTwoRoundProductionDeps['enrichCascade'],

    enrichOrganization: (async () => {
      throw new Error('enrichOrganization no debería invocarse: enrichCascade está simulado');
    }) as never,

    persistCandidates: (async (writerInput: {
      pipelineOutput: { candidates: ProspectingPipelineCandidate[] };
    }) => {
      recorder.persistedCandidateNames = writerInput.pipelineOutput.candidates.map((c) => c.name);
      return {
        dryRun: false,
        batchId: CORRELATION.batchId,
        candidatesCreated: writerInput.pipelineOutput.candidates.length,
        candidatesSkipped: 0,
        createdCandidateIds: writerInput.pipelineOutput.candidates.map(
          (_c, index) => `candidate-${index + 1}`,
        ),
        skipped: [],
        status: 'success',
        errors: [],
      };
    }) as unknown as ApolloTwoRoundProductionDeps['persistCandidates'],

    loadNegativeMemory: async (scope) => ({
      scope,
      excludedDomains: new Set<string>(),
      excludedDomainsSample: [],
      excludedIdentityKeys: new Set<string>(),
      excludedIdentityKeysSample: [],
      previousCandidateCount: 0,
      previousBatchCount: 0,
    }),

    loadCheckpoint: options.loadCheckpoint ?? (async () => null),
    saveCheckpoint: async (_batchId, checkpoint) => {
      recorder.savedCheckpoints.push(checkpoint);
      return {
        kind: 'written',
        checkpointVersion: checkpoint.checkpoint_version,
        serializedBytes: 0,
        compacted: false,
      };
    },
    loadEnrichmentUnitCostUsd: async () => 0.00875,
    logEnrichmentUsage: (async () => ({ kind: 'logged' as const })) as never,
    resolveConfig: () => options.config,
  };

  return { deps, recorder, pageFetchLog, historicalLoadCallCount: callCount };
}

function observability(output: {
  metadata?: Record<string, unknown>;
}): Record<string, unknown> {
  return (output.metadata as Record<string, unknown>)[
    APOLLO_TWO_ROUND_OBSERVABILITY_KEY
  ] as Record<string, unknown>;
}

// ══════════════════════════════════════════════════════════════════════════
// LIVE-A / LIVE-B — paginación real dentro de UNA ronda
// ══════════════════════════════════════════════════════════════════════════

describe('LIVE-A — página 1 historia-pesada, página 2 completa el objetivo', () => {
  it('99 históricas + 1 aceptada (pág.1), 95 históricas + 5 aceptadas (pág.2) ⇒ 2 páginas, 6 aceptados', async () => {
    const accepted1 = confirmedRawOrg('a1');
    const historical1 = historicalRawOrgs('r1', 99);
    const accepted2 = Array.from({ length: 5 }, (_unused, i) => confirmedRawOrg(`a2-${i}`));
    const historical2 = historicalRawOrgs('r2', 95);

    const historicalDomains = new Set([
      ...historical1.map(domainOfRawOrg),
      ...historical2.map(domainOfRawOrg),
    ]);

    const { deps, pageFetchLog } = buildDeps({
      pagesByRound: [
        [
          pagePayload(1, [accepted1, ...historical1]),
          pagePayload(2, [...accepted2, ...historical2]),
        ],
      ],
      historicalDomains,
      config: liveConfig(),
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.deepEqual(
      pageFetchLog,
      [
        { round: 0, page: 1 },
        { round: 0, page: 2 },
      ],
      'exactamente 2 páginas emitidas para la ronda 1',
    );
    assert.equal(output.candidatesCreated, 6);
    assert.equal(output.targetReached, true);
  });
});

describe('LIVE-B — tres páginas, 1+2+3 aceptados, hasta llenar el objetivo de 6', () => {
  it('1 aceptado (pág.1) + 2 (pág.2) + 3 (pág.3) ⇒ exactamente 3 páginas, 6 aceptados', async () => {
    const page1 = [confirmedRawOrg('b1-0')];
    const page2 = [confirmedRawOrg('b2-0'), confirmedRawOrg('b2-1')];
    const page3 = [confirmedRawOrg('b3-0'), confirmedRawOrg('b3-1'), confirmedRawOrg('b3-2')];

    const { deps, pageFetchLog } = buildDeps({
      pagesByRound: [[pagePayload(1, page1), pagePayload(2, page2), pagePayload(3, page3)]],
      config: liveConfig(),
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.deepEqual(
      pageFetchLog,
      [
        { round: 0, page: 1 },
        { round: 0, page: 2 },
        { round: 0, page: 3 },
      ],
      'la ruta LIVE llega hasta la página 3 dentro de la MISMA ronda — la prueba central del hito',
    );
    assert.equal(output.candidatesCreated, 6);
    assert.equal(output.targetReached, true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// LIVE-F / LIVE-G / LIVE-H — facturación por página
// ══════════════════════════════════════════════════════════════════════════

describe('LIVE-F — dos páginas no vacías cuestan exactamente 2 créditos de Search', () => {
  it('100 + 100 resultados, mayormente históricos ⇒ 2 créditos, no más', async () => {
    // netNewTarget = maxResultsPerRound = 6: con casi todo histórico, la
    // paginación sigue pidiendo hasta agotar `total_pages` (2) o el objetivo.
    const page1 = historicalRawOrgs('f1', 100);
    const page2 = historicalRawOrgs('f2', 100);
    const historicalDomains = new Set([...page1, ...page2].map(domainOfRawOrg));

    const { deps } = buildDeps({
      pagesByRound: [[pagePayload(1, page1, 2), pagePayload(2, page2, 2)]],
      historicalDomains,
      config: liveConfig(),
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    const obs = observability(output);
    const rounds = obs['rounds'] as Array<Record<string, unknown>>;
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0]!['internal_recorded_credits'], 2, 'search: 1 crédito por página no vacía × 2');
  });
});

describe('LIVE-G — una página vacía después de una llena cuesta 0, no otro crédito', () => {
  it('página 1 con resultados + página 2 vacía ⇒ 1 crédito, no 2', async () => {
    const page1 = historicalRawOrgs('g1', 100);
    const historicalDomains = new Set(page1.map(domainOfRawOrg));

    const { deps, pageFetchLog } = buildDeps({
      pagesByRound: [[pagePayload(1, page1), emptyPagePayload(2)]],
      historicalDomains,
      config: liveConfig(),
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    const obs = observability(output);
    const rounds = obs['rounds'] as Array<Record<string, unknown>>;
    assert.equal(pageFetchLog.length, 2, 'se pidieron 2 páginas');
    assert.equal(rounds[0]!['internal_recorded_credits'], 1, 'la página vacía no cobra');
  });
});

describe('LIVE-H — una página accounts-only cuesta 1 crédito y produce 0 candidatos', () => {
  it('organizations=[] + accounts=[1] ⇒ 1 crédito, 0 candidatos', async () => {
    const { deps } = buildDeps({
      pagesByRound: [[accountsOnlyPagePayload(1)]],
      config: liveConfig({ maxResultsPerRound: 1, targetEligibleCompanies: 1 }),
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    const obs = observability(output);
    const rounds = obs['rounds'] as Array<Record<string, unknown>>;
    assert.equal(rounds[0]!['internal_recorded_credits'], 1, 'accounts-only sigue cobrando 1 crédito');
    assert.equal(output.candidatesCreated, 0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// LIVE-C — paginación cruzando la frontera de rondas
// ══════════════════════════════════════════════════════════════════════════

describe('LIVE-C — la ronda 1 no alcanza el objetivo, la ronda 2 lo completa', () => {
  it('ronda1: 1 aceptado (2 págs., se agota) · ronda2: 2+3 aceptados (2 págs.) ⇒ 6 totales, sin doble conteo', async () => {
    const round1Page1 = [confirmedRawOrg('c1-0'), ...historicalRawOrgs('c1r1', 5)];
    const round1Page2 = historicalRawOrgs('c1r2', 5);
    const round1HistoricalDomains = new Set([
      ...historicalRawOrgs('c1r1', 5).map(domainOfRawOrg),
      ...round1Page2.map(domainOfRawOrg),
    ]);

    // `repeatOrg` reaparece en la ronda 2: si el registro de identidad no lo
    // reconociera entre rondas, el total final sería 7, no 6.
    const repeatOrg = confirmedRawOrg('c1-0');
    const round2Page1 = [repeatOrg, confirmedRawOrg('c2-0'), confirmedRawOrg('c2-1')];
    const round2Page2 = [
      confirmedRawOrg('c2-2'),
      confirmedRawOrg('c2-3'),
      confirmedRawOrg('c2-4'),
    ];

    const config = liveConfig({ maxRounds: 2, maxResultsPerRound: 6 });

    const { deps, pageFetchLog } = buildDeps({
      pagesByRound: [
        [pagePayload(1, round1Page1, 2), pagePayload(2, round1Page2, 2)],
        [pagePayload(1, round2Page1, 2), pagePayload(2, round2Page2, 2)],
      ],
      historicalDomains: round1HistoricalDomains,
      config,
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.deepEqual(
      pageFetchLog,
      [
        { round: 0, page: 1 },
        { round: 0, page: 2 },
        { round: 1, page: 1 },
        { round: 1, page: 2 },
      ],
      'ambas rondas paginaron de verdad, 2 páginas cada una',
    );
    assert.equal(
      output.candidatesCreated,
      6,
      'org-c1-0 repetida en la ronda 2 no duplica el conteo: 1 (ronda1) + 5 nuevos únicos (ronda2) = 6',
    );
    assert.equal(output.targetReached, true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// LIVE-D / LIVE-E — el cap de enrichment, ahora que target=6 es alcanzable
// ══════════════════════════════════════════════════════════════════════════

describe('LIVE-D — objetivo 6 con presupuesto de enrichment de 6: los 6 se enriquecen', () => {
  it('6 candidatos ambiguos, maxEnrichmentsPerRun=6 ⇒ 6 enrichments, 6 candidatos creados', async () => {
    const page1 = Array.from({ length: 6 }, (_unused, i) => ambiguousRawOrg(`d${i}`));
    const { deps, recorder } = buildDeps({
      pagesByRound: [[pagePayload(1, page1)]],
      config: liveConfig({ targetEligibleCompanies: 6, maxResultsPerRound: 6, maxEnrichmentsPerRun: 6 }),
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.equal(recorder.enrichCascadeCalls.length, 6, 'los 6 candidatos ambiguos compiten y se enriquecen');
    assert.equal(output.candidatesCreated, 6);
    assert.equal(output.targetReached, true);
  });
});

describe('LIVE-E — sólo 4 créditos de enrichment disponibles: nunca se sobrepasan', () => {
  it('6 candidatos ambiguos, maxEnrichmentsPerRun=4 ⇒ como mucho 4 enrichments, objetivo sin completar', async () => {
    const page1 = Array.from({ length: 6 }, (_unused, i) => ambiguousRawOrg(`e${i}`));
    const { deps, recorder } = buildDeps({
      pagesByRound: [[pagePayload(1, page1)]],
      config: liveConfig({ targetEligibleCompanies: 6, maxResultsPerRound: 6, maxEnrichmentsPerRun: 4 }),
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);

    assert.ok(
      recorder.enrichCascadeCalls.length <= 4,
      `nunca más de 4 enrichments: se registraron ${recorder.enrichCascadeCalls.length}`,
    );
    assert.ok(
      (output.candidatesCreated ?? 0) < 6,
      'sin presupuesto para los 6, el objetivo queda incompleto',
    );
    assert.equal(output.targetReached, false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Reserva y liquidación
// ══════════════════════════════════════════════════════════════════════════

describe('Reserva — Search se reserva por PÁGINA, no por `maxResultsPerRound`', () => {
  it('perPage=100, maxRounds=2 ⇒ exactamente 2 × WIZARD_APOLLO_MAX_PAGES_HARD_CAP créditos de Search', () => {
    const smallRequest = estimateApolloTwoRoundBudget(
      liveConfig({ maxRounds: 2, maxResultsPerRound: 1 }),
    );
    const bigRequest = estimateApolloTwoRoundBudget(
      liveConfig({ maxRounds: 2, maxResultsPerRound: 10 }),
    );

    const expectedSearch = 2 * WIZARD_APOLLO_MAX_PAGES_HARD_CAP;
    for (const breakdown of [smallRequest, bigRequest] as ApolloTwoRoundBudgetBreakdown[]) {
      const searchTotal = breakdown.searchRound1Maximum + breakdown.searchRound2Maximum;
      assert.equal(searchTotal, expectedSearch, 'NO 500, NO 50: el techo es el de páginas');
      assert.notEqual(searchTotal, 500);
      assert.notEqual(searchTotal, 50);
    }
  });
});

describe('Liquidación — 2 páginas no vacías + 1 vacía + 6 enrichments exitosos', () => {
  it('Search liquida 2 (no 200), Enrichment liquida 6', async () => {
    const acceptedAmbiguous = Array.from({ length: 6 }, (_unused, i) => ambiguousRawOrg(`s${i}`));
    const page1 = [...acceptedAmbiguous, ...historicalRawOrgs('s1', 94)];
    const page2 = historicalRawOrgs('s2', 100);
    const historicalDomains = new Set([
      ...historicalRawOrgs('s1', 94).map(domainOfRawOrg),
      ...page2.map(domainOfRawOrg),
    ]);

    const { deps, recorder, pageFetchLog } = buildDeps({
      pagesByRound: [[pagePayload(1, page1), pagePayload(2, page2), emptyPagePayload(3)]],
      historicalDomains,
      // netNewTarget = maxResultsPerRound = 10: con sólo 6 aceptados tras las
      // páginas 1 y 2, la paginación sigue pidiendo — hasta que la página 3
      // vuelve vacía y cierra la búsqueda sin más costo.
      config: liveConfig({ targetEligibleCompanies: 6, maxResultsPerRound: 10, maxEnrichmentsPerRun: 6 }),
    });

    const output = await runApolloTwoRoundWizardDiscovery(runInput(), deps);
    const obs = observability(output);
    const rounds = obs['rounds'] as Array<Record<string, unknown>>;

    assert.equal(pageFetchLog.length, 3, 'se pidieron 3 páginas: 2 llenas + 1 vacía');
    const totalRoundCredits = rounds[0]!['internal_recorded_credits'] as number;
    const enrichmentsExecuted = rounds[0]!['enrichments_executed'] as number;
    assert.equal(enrichmentsExecuted, 6, 'liquidación de enrichment: 6');
    assert.equal(totalRoundCredits - enrichmentsExecuted, 2, 'liquidación de Search: 2, no 200');
    assert.equal(recorder.enrichCascadeCalls.length, 6);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// LIVE-I — reanudación: ni la página ni el enrichment ya pagados se repiten
// ══════════════════════════════════════════════════════════════════════════

describe('LIVE-I — un reintento tras completar la ronda no repite páginas ni enrichments', () => {
  it('primer intento agota 2 páginas y persiste; el reintento no vuelve a buscar', async () => {
    const page1 = [confirmedRawOrg('i1-0')];
    const page2 = [confirmedRawOrg('i2-0')];
    const config = liveConfig({ targetEligibleCompanies: 2, maxResultsPerRound: 2 });

    const first = buildDeps({
      pagesByRound: [[pagePayload(1, page1), pagePayload(2, page2)]],
      config,
    });
    const firstOutput = await runApolloTwoRoundWizardDiscovery(runInput(), first.deps);
    assert.equal(firstOutput.candidatesCreated, 2);
    assert.equal(first.pageFetchLog.length, 2);

    const finalCheckpoint = first.recorder.savedCheckpoints.at(-1);
    assert.ok(finalCheckpoint, 'el primer intento deja al menos un checkpoint');

    // Reintento: MISMA correlación/lote, pero con el checkpoint final ya
    // cargado y un transporte que fallaría si se le pidiera CUALQUIER página.
    const retry = buildDeps({
      pagesByRound: [[]],
      config,
      loadCheckpoint: async () => finalCheckpoint!,
    });
    const retryOutput = await runApolloTwoRoundWizardDiscovery(runInput(), retry.deps);

    assert.equal(retry.pageFetchLog.length, 0, 'el reintento no pide NINGUNA página: ya estaban pagadas');
    assert.equal(
      retryOutput.candidatesCreated,
      2,
      'el resultado ya persistido se devuelve sin reconstruirlo',
    );
  });
});
