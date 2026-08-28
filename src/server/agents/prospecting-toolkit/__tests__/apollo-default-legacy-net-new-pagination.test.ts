/**
 * AGENT1-APOLLO-DEFAULT-PATH-NET-NEW-PAGINATION.
 *
 * Cierra el defecto que `apollo-default-legacy-single-page-safety.test.ts`
 * (corte anterior) sólo documentaba: con `ENABLE_APOLLO_TWO_ROUND_DISCOVERY=
 * false`, el camino REAL de producción (`incremental-search.ts` →
 * `prospecting-pipeline.ts` → `web-search-tool.ts` → `dispatchToProvider` →
 * `apollo-organizations-search-provider.ts`) nunca pasaba `netNewTarget` +
 * `evaluateCandidateAcceptance` (ni la valla durable de página), así que se
 * quedaba fijo en `maxPages: 1` sin importar cuántas páginas más reportara
 * Apollo. El motor de paginación (`apollo-organizations-paginated-search.ts`)
 * SIEMPRE supo continuar — sólo faltaba que este llamador se lo pidiera.
 *
 * Dos capas, cada una probando una parte distinta de la cadena real:
 *
 *   PARTE 1 — WIRING: `runIncrementalProspectingSearch` (el orquestador
 *   REAL del camino default/legacy) construye y reenvía las opciones
 *   correctas al pipeline, con la MISMA autoridad histórica y la MISMA valla
 *   durable que ya usa el camino de dos rondas.
 *
 *   PARTE 2 — ESCENARIOS D1-D10: `runApolloOrganizationsSearch`, invocado con
 *   la firma EXACTA de `dispatchToProvider` (`input, maxResults, usageContext,
 *   deps, options`) — el mismo estándar que ya estableció
 *   `apollo-default-legacy-single-page-safety.test.ts` § D6 para este límite
 *   exacto ("réplica exacta del llamador real, deps sólo para inyectar
 *   transporte").
 *
 * Offline por construcción. LIVE_APOLLO_CALLS = 0. APOLLO_CREDITS_USED = 0.
 * Sin Supabase real: `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
 * se fuerzan ausentes en cada test (ver `withoutSupabaseEnv`), así que la
 * valla durable de la Parte 1 se prueba con `pageFenceDepsOverride`
 * (parámetro de sólo-test, mismo patrón que `writerOverride`/
 * `pipelineOverride`), nunca contra un cliente real.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloOrganizationsSearch,
  type ApolloOrgsSearchDeps,
  type ApolloOrgsSearchOptions,
} from '../web-search-providers/apollo-organizations-search-provider';
import type { ApolloPageFetchResult, ApolloDurableResumeState } from '../apollo-organizations-paginated-search';
import type { NormalizedApolloOrganization } from '../apollo-organizations-response-normalizer';
import { runIncrementalProspectingSearch } from '../incremental-search';
import type {
  ProspectingPipelineInput,
  ProspectingPipelineOutput,
  WebSearchOutput,
} from '../types';
import { noCandidatePersistenceFailures } from '../prospect-candidate-persistence-readiness';
import type { writeProspectingCandidates } from '../candidate-writer';
import type { ApolloPageFenceIdentity } from '../apollo-two-round/page-fence.server';
import type { ApolloPageFenceEntry } from '../apollo-two-round/page-fence';
import type { RunCorrelationMetadata } from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-correlation';

// ─── Instrumentación: ninguna prueba puede alcanzar la red ────────────────────

let realFetchCalls = 0;
const originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async (...args: unknown[]) => {
    realFetchCalls++;
    throw new Error(`LLAMADA REAL PROHIBIDA EN TESTS: ${String(args[0])}`);
  }) as typeof originalFetch;
});
after(() => {
  globalThis.fetch = originalFetch;
});

function withoutSupabaseEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fn().finally(() => {
    if (prevUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    if (prevKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  });
}

// ─── Helpers compartidos ────────────────────────────────────────────────────

function orgRow(id: string): Record<string, unknown> {
  return { id, name: `Empresa ${id}`, primary_domain: `${id}.com` };
}

function pageOf(
  page: number,
  ids: string[],
  totalPages: number,
): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: {
      organizations: ids.map(orgRow),
      pagination: { page, per_page: 100, total_entries: totalPages * 100, total_pages: totalPages },
    },
    headers: null,
  };
}

function accountsOnlyPage(page: number, totalPages: number): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: {
      organizations: [],
      accounts: [{ id: `acct_${page}`, name: `Cuenta ${page}` }],
      pagination: { page, per_page: 100, total_entries: totalPages * 100, total_pages: totalPages },
    },
    headers: null,
  };
}

function emptyPage(page: number, totalPages: number): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: {
      organizations: [],
      pagination: { page, per_page: 100, total_entries: totalPages * 100, total_pages: totalPages },
    },
    headers: null,
  };
}

function transportOf(
  responder: (page: number, callIndex: number) => ApolloPageFetchResult,
): {
  fetchPage: (body: Record<string, unknown>) => Promise<ApolloPageFetchResult>;
  calls: number[];
} {
  const calls: number[] = [];
  let callIndex = 0;
  return {
    calls,
    fetchPage: async (body) => {
      const page = (body as { page?: number }).page ?? 1;
      calls.push(page);
      return responder(page, callIndex++);
    },
  };
}

/** Réplica de la firma EXACTA de `dispatchToProvider` (caso apollo_organizations). */
async function callAsDispatchToProvider(
  deps: ApolloOrgsSearchDeps,
  options?: ApolloOrgsSearchOptions,
) {
  return runApolloOrganizationsSearch(
    { query: 'supermercados Colombia' },
    100,
    undefined,
    deps,
    options,
  );
}

function normalizedOrgOf(id: string): NormalizedApolloOrganization {
  return {
    providerReference: { provider: 'apollo', providerOrganizationId: id, providerAccountId: null },
    name: `Empresa ${id}`,
    primaryDomain: `${id}.com`,
    normalizedDomains: [`${id}.com`],
    websiteUrl: `https://${id}.com`,
    linkedinUrl: null,
    phone: null,
    foundedYear: null,
    country: null,
    city: null,
    industry: null,
    industries: [],
    keywords: [],
    organizationKeywords: [],
    estimatedNumEmployees: null,
    shortDescription: null,
    seoDescription: null,
    description: null,
    technologies: [],
    filledFromAccountFields: [],
  };
}

describe('AGENT1-APOLLO-DEFAULT-PATH-NET-NEW-PAGINATION', () => {
  before(() => { process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true'; });
  after(() => { delete process.env.ENABLE_APOLLO_COMPANY_SEARCH; });

  // ══════════════════════════════════════════════════════════════════════════
  // PARTE 1 — WIRING: el orquestador REAL (`runIncrementalProspectingSearch`)
  // ══════════════════════════════════════════════════════════════════════════

  describe('PARTE 1 · runIncrementalProspectingSearch construye y reenvía las opciones', () => {
    const NOOP_WRITER: typeof writeProspectingCandidates = async () => ({
      dryRun: false,
      batchId: 'fake-batch-0000-0000-0000-000000000000',
      candidatesCreated: 0,
      candidatesSkipped: 0,
      createdCandidateIds: [],
      skipped: [],
      status: 'success',
      errors: [],
      persistence: noCandidatePersistenceFailures(),
    });

    function fakePipelineOutput(input: ProspectingPipelineInput): ProspectingPipelineOutput {
      const webSearch: WebSearchOutput = {
        provider: input.webSearchProvider ?? 'mock',
        query: 'fake-query',
        results: [],
        resultsCount: 1,
        skipped: false,
        skipReason: null,
        estimatedCostUsd: null,
        metadata: {},
      };
      return {
        input,
        catalogContext: {
          country: input.country,
          countryCode: input.countryCode,
          industry: input.industry,
          searchDepth: 'standard',
          fiscalIdentifierLabel: null,
          recommendedSources: [],
          sectorSources: [],
          risks: [],
          operatingRules: [],
          coverageNotes: [],
          promptContext: '',
        },
        searchQuery: 'fake-query',
        webSearch,
        candidates: [],
        summary: {
          requested: 0, searched: 0, returned: 0, highQualityNew: 0,
          needsReview: 0, duplicates: 0, insufficientData: 0, discarded: 0, unchecked: 0,
        },
        warnings: [],
        // `queries_executed` con exactamente 1 entrada: replica lo que la
        // ronda real reportaría con AGENT1_APOLLO_MAX_QUERIES_PER_RUN=1 (1
        // query por invocación), para que el tope GLOBAL de queries Apollo
        // por corrida se acumule de forma realista y no por el tamaño del
        // `queryOverrides` sin ejecutar que este doble no respeta.
        metadata: { queries_executed: ['fake query'] },
      };
    }

    it('W1 — isApolloProvider=true ⇒ apolloSearchOptions con netNewTarget numérico y evaluateCandidateAcceptance invocable', async () => {
      const captured: ProspectingPipelineInput[] = [];
      const pipelineOverride = async (input: ProspectingPipelineInput) => {
        captured.push(input);
        return fakePipelineOutput(input);
      };

      await withoutSupabaseEnv(() =>
        runIncrementalProspectingSearch(
          {
            country: 'Colombia', countryCode: 'CO', industry: 'Educación',
            webSearchProvider: 'apollo_organizations', dryRun: false, maxRounds: 1,
            targetPersistibleCandidates: 8,
            triggeredByUserId: 'user-1', ownerId: 'user-1',
          },
          NOOP_WRITER,
          pipelineOverride,
        ),
      );

      assert.ok(captured.length >= 1, 'el pipeline debió invocarse al menos una vez');
      const options = captured[0]!.apolloSearchOptions;
      assert.ok(options, 'apolloSearchOptions debe estar presente para el provider Apollo');
      assert.equal(options!.netNewTarget, 8, 'target8/free0 ⇒ residual8 (nada acumulado todavía)');
      assert.equal(
        typeof options!.evaluateCandidateAcceptance,
        'function',
        'debe llevar la autoridad histórica fuerte para distinguir net-new de duplicado',
      );
    });

    it('W2 — el residual DECRECE con lo ya acumulado entre rondas (target10/free4 ⇒ residual6)', async () => {
      const capturedTargets: Array<number | undefined> = [];
      let round = 0;
      const pipelineOverride = async (input: ProspectingPipelineInput) => {
        round++;
        capturedTargets.push(input.apolloSearchOptions?.netNewTarget);
        const out = fakePipelineOutput(input);
        // Ronda 1 "entrega" 4 candidatos útiles (duplicateCheck/scoring mínimos
        // para que isUsefulCandidate los cuente) — simula lo que la capa
        // gratuita + ronda 1 ya aportaron antes de la ronda 2.
        if (round === 1) {
          out.candidates = Array.from({ length: 4 }, (_unused, i) => ({
            name: `Empresa útil ${i}`,
            website: `https://util-${i}.com`,
            domain: `util-${i}.com`,
            country: 'Colombia',
            countryCode: 'CO',
            industry: 'Educación',
            sourceUrl: null,
            sourceTitle: null,
            sourceSnippet: null,
            websiteVerification: null,
            duplicateCheck: { status: 'unique', confidence: 1, matchedDomain: null, matchedCompanyId: null } as never,
            scoring: {
              qualityLabel: 'high_quality_new', recommendedAction: 'approve_for_review',
              confidenceScore: 90, reasons: [],
            } as never,
          }));
        }
        return out;
      };

      // El tope GLOBAL de queries Apollo por ejecución (AGENT1_APOLLO_MAX_
      // QUERIES_PER_RUN, default=1) es de TODA la corrida, no por ronda: sin
      // subirlo, la ronda 2 nunca se despacharía y esta prueba no podría
      // observar el residual decreciente entre rondas.
      process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN = '2';
      try {
        await withoutSupabaseEnv(() =>
          runIncrementalProspectingSearch(
            {
              country: 'Colombia', countryCode: 'CO', industry: 'Educación',
              webSearchProvider: 'apollo_organizations', dryRun: false, maxRounds: 2,
              targetPersistibleCandidates: 10,
              triggeredByUserId: 'user-1', ownerId: 'user-1',
            },
            NOOP_WRITER,
            pipelineOverride,
          ),
        );
      } finally {
        delete process.env.AGENT1_APOLLO_MAX_QUERIES_PER_RUN;
      }

      assert.ok(capturedTargets.length >= 2, 'debieron ejecutarse al menos 2 rondas');
      assert.equal(capturedTargets[0], 10, 'ronda 1: target10/free0 ⇒ residual10');
      assert.equal(capturedTargets[1], 6, 'ronda 2: target10/free4 (4 útiles acumulados) ⇒ residual6');
    });

    it('W3 — sin existingBatchId/apolloRunCorrelation: durablePageFence y durableResume AUSENTES (contrato "ausente ⇒ comportamiento previo")', async () => {
      const captured: ProspectingPipelineInput[] = [];
      const pipelineOverride = async (input: ProspectingPipelineInput) => {
        captured.push(input);
        return fakePipelineOutput(input);
      };

      await withoutSupabaseEnv(() =>
        runIncrementalProspectingSearch(
          {
            country: 'Colombia', countryCode: 'CO', industry: 'Educación',
            webSearchProvider: 'apollo_organizations', dryRun: false, maxRounds: 1,
            triggeredByUserId: 'user-1', ownerId: 'user-1',
            // Sin existingBatchId ni apolloRunCorrelation.
          },
          NOOP_WRITER,
          pipelineOverride,
        ),
      );

      const options = captured[0]!.apolloSearchOptions;
      assert.equal(options!.durablePageFence, undefined);
      assert.equal(options!.durableResume, undefined);
    });

    it('W4 — con existingBatchId + apolloRunCorrelation: la valla durable escribe request_started→succeeded y el resume de un reintento adopta la página ya durable (0 llamadas nuevas)', async () => {
      const fenceStore = new Map<string, ApolloPageFenceEntry[]>();
      const identity: ApolloPageFenceIdentity = {
        idempotencyKey: 'idem-w4',
        requestFingerprint: 'fp-w4',
      };
      const fenceKey = (id: ApolloPageFenceIdentity) => `${id.idempotencyKey}:${id.requestFingerprint}`;
      const pageFenceDepsOverride = {
        readEntries: async (_batchId: string, id: ApolloPageFenceIdentity) =>
          fenceStore.get(fenceKey(id)) ?? [],
        writeEntry: async (_batchId: string, id: ApolloPageFenceIdentity, entry: ApolloPageFenceEntry) => {
          const key = fenceKey(id);
          const existing = fenceStore.get(key) ?? [];
          const filtered = existing.filter(
            (e) => !(e.round_number === entry.round_number && e.page === entry.page
              && e.search_plan_fingerprint === entry.search_plan_fingerprint),
          );
          fenceStore.set(key, [...filtered, entry]);
          return { kind: 'written' as const };
        },
      };

      const runCorrelation: RunCorrelationMetadata = {
        wizard_run_id: 'wr-1', client_request_id: 'cr-1', batch_id: 'batch-w4',
        reservation_id: null, agent_run_id: null, provider_key: 'apollo',
        request_fingerprint: identity.requestFingerprint,
        idempotency_key: identity.idempotencyKey,
        billing_state: null,
      };

      const transport = transportOf((page) => pageOf(page, [`w4_org${page}`], 3));
      let fetchCalls = 0;
      const pipelineOverride = async (input: ProspectingPipelineInput): Promise<ProspectingPipelineOutput> => {
        const options = input.apolloSearchOptions!;
        // Ejercita la valla REAL a través del provider REAL, con transporte
        // inyectado — exactamente lo que `dispatchToProvider` haría si
        // `runMultiQueryWebSearch` lo invocara con estas opciones.
        const out = await runApolloOrganizationsSearch(
          { query: 'q' }, 100, undefined,
          { fetchPage: async (body) => { fetchCalls++; return transport.fetchPage(body); } },
          options,
        );
        const base = fakePipelineOutput(input);
        base.webSearch = out;
        return base;
      };

      await withoutSupabaseEnv(() =>
        runIncrementalProspectingSearch(
          {
            country: 'Colombia', countryCode: 'CO', industry: 'Educación',
            webSearchProvider: 'apollo_organizations', dryRun: false, maxRounds: 1,
            targetPersistibleCandidates: 1,
            existingBatchId: 'batch-w4',
            apolloRunCorrelation: runCorrelation,
            triggeredByUserId: 'user-1', ownerId: 'user-1',
          },
          NOOP_WRITER,
          pipelineOverride,
          pageFenceDepsOverride,
        ),
      );

      assert.ok(fetchCalls >= 1, 'la ronda 1 debió pedir al menos una página real');
      const written = fenceStore.get(fenceKey(identity)) ?? [];
      assert.ok(
        written.some((e) => e.status === 'succeeded'),
        'la valla debió registrar al menos una página succeeded',
      );
      assert.equal(realFetchCalls, 0, 'ninguna llamada de red real');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PARTE 2 — ESCENARIOS D1-D10, vía la firma EXACTA de dispatchToProvider
  // ══════════════════════════════════════════════════════════════════════════

  describe('PARTE 2 · runApolloOrganizationsSearch (firma dispatchToProvider) — D1-D10', () => {
    it('D1 — page2 requerida: 99 histórico + 1 aceptado (p1), 95 histórico + 5 aceptados (p2) ⇒ 2 páginas, remaining=0', async () => {
      const acceptedIds = new Set(['p1_hist99', ...Array.from({ length: 5 }, (_u, i) => `p2_new${i}`)]);
      const transport = transportOf((page) => {
        if (page === 1) {
          const ids = [
            ...Array.from({ length: 99 }, (_u, i) => `p1_hist${i}`),
            'p1_hist99',
          ];
          return pageOf(1, ids, 5);
        }
        return pageOf(2, [
          ...Array.from({ length: 95 }, (_u, i) => `p2_hist${i}`),
          ...Array.from({ length: 5 }, (_u, i) => `p2_new${i}`),
        ], 5);
      });

      const output = await callAsDispatchToProvider(
        { fetchPage: transport.fetchPage },
        {
          netNewTarget: 6,
          evaluateCandidateAcceptance: (org) => acceptedIds.has(org.providerReference.providerOrganizationId),
        },
      );

      const pagination = output.metadata?.apollo_pagination as { pages_processed?: number } | undefined;
      assert.equal(transport.calls.length, 2, 'debieron pedirse exactamente 2 páginas');
      assert.equal(pagination?.pages_processed, 2);
      assert.equal(realFetchCalls, 0);
    });

    it('D2 — page3 requerida: target=6, aceptados 1+2+3 por página ⇒ 3 llamadas, objetivo cubierto', async () => {
      const acceptedByPage: Record<number, string[]> = {
        1: ['p1_a0'],
        2: ['p2_a0', 'p2_a1'],
        3: ['p3_a0', 'p3_a1', 'p3_a2'],
      };
      const acceptedIds = new Set(Object.values(acceptedByPage).flat());
      const transport = transportOf((page) => {
        const accepted = acceptedByPage[page] ?? [];
        const filler = Array.from({ length: 20 }, (_u, i) => `p${page}_filler${i}`);
        return pageOf(page, [...filler, ...accepted], 10);
      });

      const output = await callAsDispatchToProvider(
        { fetchPage: transport.fetchPage },
        {
          netNewTarget: 6,
          evaluateCandidateAcceptance: (org) => acceptedIds.has(org.providerReference.providerOrganizationId),
        },
      );

      assert.equal(transport.calls.length, 3, 'debieron pedirse exactamente 3 páginas');
      const pagination = output.metadata?.apollo_pagination as { pages_processed?: number } | undefined;
      assert.equal(pagination?.pages_processed, 3);
    });

    it('D3 — página historia-pesada: page1 100% histórico (0 aceptados), page2 trae net-new ⇒ page2 se pide y sí aporta', async () => {
      const transport = transportOf((page) => {
        if (page === 1) return pageOf(1, Array.from({ length: 100 }, (_u, i) => `p1_hist${i}`), 3);
        return pageOf(2, ['p2_new0', 'p2_new1'], 3);
      });

      const output = await callAsDispatchToProvider(
        { fetchPage: transport.fetchPage },
        {
          netNewTarget: 2,
          evaluateCandidateAcceptance: (org) =>
            org.providerReference.providerOrganizationId.startsWith('p2_new'),
        },
      );

      assert.equal(transport.calls.length, 2, 'page1, íntegramente histórico, no debió satisfacer el objetivo por sí sola');
      const pagination = output.metadata?.apollo_pagination as { pages_processed?: number } | undefined;
      assert.equal(pagination?.pages_processed, 2);
    });

    it('D4 — la misma organización repetida entre páginas se evalúa a lo sumo una vez (dedupe cross-page)', async () => {
      let evaluations = 0;
      const seenIds: string[] = [];
      const transport = transportOf((page) => {
        // org_dup aparece en AMBAS páginas — Apollo puede repetir resultados
        // entre páginas contiguas.
        if (page === 1) return pageOf(1, ['org_dup', 'p1_other'], 3);
        return pageOf(2, ['org_dup', 'p2_new0'], 3);
      });

      const output = await callAsDispatchToProvider(
        { fetchPage: transport.fetchPage },
        {
          netNewTarget: 3,
          evaluateCandidateAcceptance: (org) => {
            evaluations++;
            seenIds.push(org.providerReference.providerOrganizationId);
            return true;
          },
        },
      );

      const dupEvaluations = seenIds.filter((id) => id === 'org_dup').length;
      assert.equal(dupEvaluations, 1, 'org_dup sólo debió evaluarse una vez pese a aparecer en 2 páginas');
      assert.equal(output.results.length, 3, 'org_dup no debió duplicarse en los resultados finales');
    });

    it('D5 — fallo de la valla durable (beforeRequest lanza) ⇒ 0 llamadas al transporte, 0 créditos', async () => {
      const transport = transportOf((page) => pageOf(page, [`p${page}_org`], 5));

      const output = await callAsDispatchToProvider(
        { fetchPage: transport.fetchPage },
        {
          netNewTarget: 5,
          evaluateCandidateAcceptance: () => true,
          durablePageFence: {
            beforeRequest: async () => { throw new Error('durable_page_fence_write_failed: no_supabase_client'); },
            onSucceeded: async () => {},
            onIndeterminate: async () => {},
          },
        },
      );

      assert.equal(transport.calls.length, 0, 'la petición a Apollo NUNCA debió salir');
      assert.equal(output.results.length, 0);
      const pagination = output.metadata?.apollo_pagination as { estimated_credits?: number } | undefined;
      assert.equal(pagination?.estimated_credits, 0);
    });

    it('D6 — resume exitoso: page1/page2 ya durables ⇒ 0 réplicas, continúa en page3', async () => {
      // "Intento original", sólo para aprender la huella real de esta consulta
      // (misma técnica que apollo-page-fence-durable-resume.test.ts: nunca se
      // adivina, se calcula con un intento barato).
      const probeTransport = transportOf((page) => pageOf(page, [`probe_${page}`], 3));
      const probe = await callAsDispatchToProvider({ fetchPage: probeTransport.fetchPage });
      const probeMeta = probe.metadata?.apollo_pagination as { request_fingerprint?: string } | undefined;
      const requestFingerprint = probeMeta!.request_fingerprint!;

      const durableResume: ApolloDurableResumeState = {
        succeededPages: [
          {
            page: 1, requestFingerprint,
            organizations: [normalizedOrgOf('d6_org1')],
            credits: 1, resultsReturned: 1, totalPages: 3, acceptedCount: 1,
          },
          {
            page: 2, requestFingerprint,
            organizations: [normalizedOrgOf('d6_org2')],
            credits: 1, resultsReturned: 1, totalPages: 3, acceptedCount: 1,
          },
        ],
        indeterminatePage: null,
      };

      const resumed = transportOf((page) => {
        if (page !== 3) throw new Error(`page ${page} NO debía pedirse de nuevo`);
        return pageOf(3, ['d6_org3'], 3);
      });

      const output = await callAsDispatchToProvider(
        { fetchPage: resumed.fetchPage },
        {
          netNewTarget: 3,
          evaluateCandidateAcceptance: () => true,
          durableResume,
        },
      );

      assert.deepEqual(resumed.calls, [3], 'page1 y page2 = 0 llamadas nuevas');
      const pagination = output.metadata?.apollo_pagination as { pages_processed?: number } | undefined;
      assert.equal(pagination?.pages_processed, 3, '2 adoptadas + 1 nueva');
      assert.equal(output.results.length, 3);
      assert.equal(realFetchCalls, 0);
    });

    it('D7 — página indeterminada pendiente ⇒ 0 reintentos automáticos, 0 páginas nuevas para el mismo plan', async () => {
      const probeTransport = transportOf((page) => pageOf(page, [`probe_${page}`], 3));
      const probe = await callAsDispatchToProvider({ fetchPage: probeTransport.fetchPage });
      const probeMeta = probe.metadata?.apollo_pagination as { request_fingerprint?: string } | undefined;
      const requestFingerprint = probeMeta!.request_fingerprint!;

      const durableResume: ApolloDurableResumeState = {
        succeededPages: [],
        indeterminatePage: { page: 2, requestFingerprint },
      };

      const resumed = transportOf(() => {
        throw new Error('ninguna página debía pedirse: hay una indeterminada pendiente');
      });

      const output = await callAsDispatchToProvider(
        { fetchPage: resumed.fetchPage },
        { netNewTarget: 5, evaluateCandidateAcceptance: () => true, durableResume },
      );

      assert.equal(resumed.calls.length, 0, 'cero peticiones HTTP nuevas');
      assert.equal(realFetchCalls, 0);
      const pagination = output.metadata?.apollo_pagination as { indeterminate_pages?: number[] } | undefined;
      assert.deepEqual(pagination?.indeterminate_pages, [2]);
    });

    it('D8 — page1 no vacía, page2 vacía ⇒ créditos: 1 (no 2)', async () => {
      const transport = transportOf((page) => {
        if (page === 1) return pageOf(1, ['p1_org0'], 2);
        return emptyPage(2, 2);
      });

      const output = await callAsDispatchToProvider(
        { fetchPage: transport.fetchPage },
        { netNewTarget: 5, evaluateCandidateAcceptance: () => true },
      );

      const pagination = output.metadata?.apollo_pagination as { estimated_credits?: number } | undefined;
      assert.equal(pagination?.estimated_credits, 1, 'página vacía no debe cobrar');
    });

    it('D9 — página sólo-accounts (sin organizations[]) ⇒ créditos=1, aceptados=0', async () => {
      const transport = transportOf((page) => accountsOnlyPage(page, 1));

      const output = await callAsDispatchToProvider(
        { fetchPage: transport.fetchPage },
        { netNewTarget: 5, evaluateCandidateAcceptance: () => true },
      );

      const pagination = output.metadata?.apollo_pagination as { estimated_credits?: number } | undefined;
      assert.equal(pagination?.estimated_credits, 1, 'accounts-only sigue siendo una página con resultados: cobra 1');
      assert.equal(output.results.length, 0, 'una página accounts-only no produce candidatos de organización');
    });

    it('D10 — target10/default: demanda=10, sin recorte oculto (acepta hasta 10 o para en un límite explícito)', async () => {
      const transport = transportOf((page) => pageOf(page, Array.from({ length: 10 }, (_u, i) => `p${page}_org${i}`), 5));

      const output = await callAsDispatchToProvider(
        { fetchPage: transport.fetchPage },
        { netNewTarget: 10, evaluateCandidateAcceptance: () => true },
      );

      const pagination = output.metadata?.apollo_pagination as
        | { pages_processed?: number; stop_reason?: string }
        | undefined;
      assert.equal(transport.calls.length, 1, '10 aceptados ya en la página 1 ⇒ no hace falta una segunda página');
      assert.equal(pagination?.stop_reason, 'candidate_target_reached');
    });
  });
});
