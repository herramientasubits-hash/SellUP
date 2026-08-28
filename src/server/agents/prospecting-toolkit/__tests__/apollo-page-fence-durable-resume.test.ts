/**
 * AGENT1-APOLLO-RESIDUAL-AND-PAGE-FENCING PARTE B — valla durable de página.
 *
 * Cubre, sobre `runApolloOrganizationsPaginatedSearch` directamente (el motor
 * real, con transporte inyectado): que un reintento tras un "crash" simulado
 * nunca vuelve a pedir una página ya exitosa, que una página indeterminada
 * bloquea CUALQUIER página nueva hasta que se reconcilie, y que la huella de
 * plan de búsqueda impide que el resumen de una ronda/plan distinto se adopte
 * por error.
 *
 * "Crash simulado" = invocar la función una SEGUNDA vez con un `durableResume`
 * construido a mano, exactamente lo que produciría leer el documento durable
 * que un proceso anterior alcanzó a escribir antes de morir. No hay Supabase,
 * no hay red — el propio `runApolloOrganizationsPaginatedSearch` es agnóstico
 * a dónde vive la valla; `page-fence.server.ts` (I/O real) se prueba aparte.
 *
 * Offline por construcción. LIVE_APOLLO_CALLS = 0.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloOrganizationsPaginatedSearch,
  type ApolloPageFetchResult,
  type ApolloPaginatedSearchDeps,
  type ApolloDurableResumeState,
} from '../apollo-organizations-paginated-search';
import { createApolloPaginationBudget } from '../apollo-organizations-pagination-budget';
import type { NormalizedApolloOrganization } from '../apollo-organizations-response-normalizer';

// ─── Instrumentación: ninguna prueba puede alcanzar la red ────────────────────

let realFetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (...args: unknown[]) => {
  realFetchCalls++;
  throw new Error(`LLAMADA REAL PROHIBIDA EN TESTS: ${String(args[0])}`);
}) as typeof originalFetch;
beforeEach(() => { realFetchCalls = 0; });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function headersFrom(map: Record<string, string> = {}): { get(name: string): string | null } {
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

function okPage(
  organizations: Array<Record<string, unknown>>,
  pagination?: Record<string, number>,
): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: { organizations, ...(pagination ? { pagination } : {}) },
    headers: headersFrom(),
  };
}

const orgs = (count: number, offset = 0): Array<Record<string, unknown>> =>
  Array.from({ length: count }, (_, i) => ({
    id: `org_${offset + i}`,
    name: `Empresa ${offset + i}`,
    primary_domain: `empresa-${offset + i}.com`,
  }));

/** Organización normalizada slim, suficiente para sembrar `durableResume`. */
function normalizedOrg(id: string): NormalizedApolloOrganization {
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

type FenceCall =
  | { kind: 'beforeRequest'; page: number }
  | { kind: 'onSucceeded'; page: number; organizations: number }
  | { kind: 'onIndeterminate'; page: number };

/** Registro de llamadas a la valla, para afirmar orden y contenido — no I/O real. */
function fenceRecorder(overrides?: {
  beforeRequestThrows?: boolean;
}): { deps: ApolloPaginatedSearchDeps['durableFence']; calls: FenceCall[] } {
  const calls: FenceCall[] = [];
  return {
    calls,
    deps: {
      beforeRequest: async ({ page }) => {
        calls.push({ kind: 'beforeRequest', page });
        if (overrides?.beforeRequestThrows) throw new Error('durable_fence_write_failed');
      },
      onSucceeded: async ({ page, organizations }) => {
        calls.push({ kind: 'onSucceeded', page, organizations: organizations.length });
      },
      onIndeterminate: async ({ page }) => {
        calls.push({ kind: 'onIndeterminate', page });
      },
    },
  };
}

function harness(
  responder: (body: Record<string, unknown>, call: number) => ApolloPageFetchResult,
): { deps: Omit<ApolloPaginatedSearchDeps, 'durableFence'>; bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = [];
  let clock = 0;
  let call = 0;
  return {
    bodies,
    deps: {
      fetchPage: async (body) => {
        bodies.push(body);
        clock += 10;
        return responder(body, call++);
      },
      now: () => clock,
      random: () => 0.5,
      sleep: async (ms) => { clock += ms; },
    },
  };
}

const baseInput = {
  filters: { locations: ['Colombia'], keywordTags: ['lms'] },
  wizardRunId: 'run_page_fence_1',
  agentRunId: 'agent_run_1',
};

// ─── C6 · resumen exitoso: nunca se repite una página ya durable ──────────────

describe('C6 · resumen tras dos páginas exitosas', () => {
  it('el reintento no pide page1 ni page2: adopta lo durable y sigue en page3', async () => {
    // "Intento original": dos páginas exitosas, registradas por la valla.
    const original = harness((body) => {
      const page = body.page as number;
      return okPage(orgs(2, (page - 1) * 2), { page, per_page: 2, total_pages: 3, total_entries: 6 });
    });
    const fence1 = fenceRecorder();
    const firstAttempt = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 1, perPage: 2, maxCandidates: 999, maxCredits: 99 }) },
      { ...original.deps, durableFence: fence1.deps },
    );
    // Con maxPages=1 este "intento" sólo llega a la página 1 antes de que el
    // presupuesto lo pare — es un sustituto legítimo de "el proceso murió tras
    // la página 1": lo que la valla registró es lo único que sobrevive.
    assert.equal(firstAttempt.pagesProcessed, 1);
    assert.deepEqual(fence1.calls.map((c) => c.kind), ['beforeRequest', 'onSucceeded']);

    // La página 2 se registra en un segundo tramo del "mismo" intento, para
    // tener DOS páginas durables antes de simular el reinicio del proceso.
    const requestFingerprint = firstAttempt.requestFingerprint;
    const durableResume: ApolloDurableResumeState = {
      succeededPages: [
        {
          page: 1,
          requestFingerprint,
          organizations: firstAttempt.organizations.map((o) => o),
          credits: 1,
          resultsReturned: 2,
          totalPages: 3,
          acceptedCount: null,
        },
        {
          page: 2,
          requestFingerprint,
          organizations: [normalizedOrg('org_2'), normalizedOrg('org_3')],
          credits: 1,
          resultsReturned: 2,
          totalPages: 3,
          acceptedCount: null,
        },
      ],
      indeterminatePage: null,
    };

    // "Reinicio del proceso": transporte NUEVO que sólo sabe responder page3.
    // Si el motor pidiera page1 o page2 de nuevo, este responder lanzaría.
    const resumed = harness((body) => {
      const page = body.page as number;
      if (page !== 3) throw new Error(`page ${page} NO debía pedirse de nuevo`);
      return okPage(orgs(2, 4), { page, per_page: 2, total_pages: 3, total_entries: 6 });
    });
    const fence2 = fenceRecorder();
    const result = await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        budget: createApolloPaginationBudget({ maxPages: 5, perPage: 2, maxCandidates: 999, maxCredits: 99 }),
        durableResume,
      },
      { ...resumed.deps, durableFence: fence2.deps },
    );

    assert.deepEqual(resumed.bodies.map((b) => b.page), [3], 'page1 y page2 = 0 llamadas nuevas');
    assert.equal(result.pagesProcessed, 3, '2 adoptadas + 1 nueva');
    assert.equal(result.organizations.length, 6);
    assert.equal(result.stopReason, 'last_page_reached');
    assert.equal(realFetchCalls, 0);
  });
});

// ─── C7 · crash tras `request_started` sin desenlace ──────────────────────────

describe('C7 · página indeterminada por valla previa (crash tras el envío)', () => {
  it('0 llamadas nuevas, estado explícito, sin reintento automático', async () => {
    const durableResume: ApolloDurableResumeState = {
      succeededPages: [],
      indeterminatePage: { page: 1, requestFingerprint: 'will-be-replaced' },
    };

    // Primero se calcula la huella REAL con un intento "limpio" para no adivinarla.
    const probe = harness(() => okPage([], { page: 1, per_page: 2, total_pages: 1 }));
    const probeResult = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 0, perPage: 2 }) },
      probe.deps,
    );
    durableResume.indeterminatePage = { page: 2, requestFingerprint: probeResult.requestFingerprint };

    const resumed = harness(() => {
      throw new Error('ninguna página debía pedirse: hay una indeterminada pendiente');
    });
    const fence = fenceRecorder();
    const result = await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        budget: createApolloPaginationBudget({ maxPages: 5, perPage: 2, maxCandidates: 999, maxCredits: 99 }),
        durableResume,
      },
      { ...resumed.deps, durableFence: fence.deps },
    );

    assert.equal(resumed.bodies.length, 0, 'cero peticiones HTTP nuevas');
    assert.equal(realFetchCalls, 0);
    assert.equal(result.stopReason, 'indeterminate_prior_page_pending_reconciliation');
    assert.deepEqual(result.indeterminatePages, [2]);
    assert.equal(fence.calls.length, 0, 'la valla tampoco se vuelve a tocar: no hubo intento nuevo');
  });

  it('las páginas succeeded ANTERIORES a la indeterminada se conservan aunque la corrida pare', async () => {
    const probe = harness(() => okPage([], { page: 1, per_page: 2, total_pages: 1 }));
    const probeResult = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 0, perPage: 2 }) },
      probe.deps,
    );
    const requestFingerprint = probeResult.requestFingerprint;

    const durableResume: ApolloDurableResumeState = {
      succeededPages: [
        {
          page: 1,
          requestFingerprint,
          organizations: [normalizedOrg('org_0')],
          credits: 1,
          resultsReturned: 1,
          totalPages: 3,
          acceptedCount: null,
        },
      ],
      indeterminatePage: { page: 2, requestFingerprint },
    };

    const resumed = harness(() => {
      throw new Error('no debía pedirse ninguna página');
    });
    const result = await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        budget: createApolloPaginationBudget({ maxPages: 5, perPage: 2, maxCandidates: 999, maxCredits: 99 }),
        durableResume,
      },
      resumed.deps,
    );

    assert.equal(result.organizations.length, 1, 'la página 1 durable no se pierde');
    assert.equal(result.pagesProcessed, 1);
  });
});

// ─── C9 · timeout ambiguo ⇒ indeterminado, y así lo ve la valla ──────────────

describe('C9 · timeout ambiguo posterior al envío', () => {
  it('la valla recibe onIndeterminate, no onSucceeded, y no hay reintento automático en el mismo intento', async () => {
    const h = harness(() => ({
      ok: false,
      status: null,
      requestSent: true,
      malformedBody: false,
      timedOut: true,
      payload: undefined,
      headers: null,
    }));
    const fence = fenceRecorder();
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 3, perPage: 2 }) },
      { ...h.deps, durableFence: fence.deps },
    );

    assert.equal(h.bodies.length, 1, 'no reintenta automáticamente');
    assert.equal(result.stopReason, 'error_terminated');
    assert.equal(result.terminalError?.billingState, 'unknown');
    assert.deepEqual(result.indeterminatePages, [1]);
    assert.deepEqual(
      fence.calls.map((c) => c.kind),
      ['beforeRequest', 'onIndeterminate'],
    );
  });
});

// ─── C10 · fallo PREVIO al envío (en la valla misma) ──────────────────────────
//
// AGENT1-APOLLO-FINAL-SAFETY-CLOSURE · PARTE A — este caso era, hasta este
// corte, "best-effort": un fallo de `beforeRequest` se tragaba y la petición
// salía igual. Eso es exactamente el fail-open que el corte cierra: mejor no
// pedir que pedir sin haber podido registrar el intento. Ahora es fail-closed.

describe('C10 · la valla falla ANTES del envío ⇒ fail-closed, cero peticiones', () => {
  it('si `beforeRequest` lanza, la página NUNCA se pide: 0 llamadas, 0 créditos, motivo explícito', async () => {
    const h = harness(() => okPage(orgs(1), { page: 1, per_page: 2, total_pages: 1 }));
    const fence = fenceRecorder({ beforeRequestThrows: true });
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 3, perPage: 2 }) },
      { ...h.deps, durableFence: fence.deps },
    );

    assert.equal(h.bodies.length, 0, 'la petición NUNCA sale: la valla no pudo confirmar el intento');
    assert.equal(realFetchCalls, 0);
    assert.equal(result.organizations.length, 0);
    assert.equal(result.estimatedCredits, 0, 'PRE_PROVIDER_INFRA_FAILURE: cero créditos, Apollo nunca se tocó');
    assert.equal(result.stopReason, 'durable_fence_write_failed');
    assert.equal(
      result.terminalError,
      null,
      'no es un error de Apollo — el proveedor nunca fue contactado',
    );
    const pageOutcome = result.pageOutcomes.find((o) => o.page === 1);
    assert.equal(pageOutcome?.status, 'error');
    assert.equal(pageOutcome?.errorCode, 'durable_fence_write_failed');
    assert.equal(pageOutcome?.billingState, 'not_charged');
  });

  it('una página anterior YA exitosa en esta misma invocación no se pierde cuando una página posterior falla en la valla', async () => {
    let call = 0;
    const h = harness((body) => {
      const page = body.page as number;
      return okPage(orgs(1, page - 1), { page, per_page: 2, total_pages: 5 });
    });
    let fenceCalls = 0;
    const fence: ApolloPaginatedSearchDeps['durableFence'] = {
      beforeRequest: async () => {
        fenceCalls++;
        // La página 1 se registra bien; la 2 falla — simula degradación
        // durable a mitad de una secuencia multi-página.
        if (fenceCalls >= 2) throw new Error('durable_fence_write_failed');
      },
      onSucceeded: async () => {},
      onIndeterminate: async () => {},
    };
    void call;

    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 5, perPage: 2, maxCandidates: 999, maxCredits: 99 }) },
      { ...h.deps, durableFence: fence },
    );

    assert.equal(h.bodies.length, 1, 'sólo la página 1 llegó a pedirse; la 2 se cortó antes del transporte');
    assert.equal(result.organizations.length, 1, 'lo que la página 1 YA cobró y devolvió se conserva');
    assert.equal(result.estimatedCredits, 1, '1 crédito real de la página 1, 0 de la página 2 que nunca se pidió');
    assert.equal(result.stopReason, 'durable_fence_write_failed');
  });
});

// ─── C11 · 429 dentro del mismo intento: la valla no interfiere el reintento ──

describe('C11 · reintento 429 en el mismo proceso', () => {
  it('un mismo page se vuelve a intentar; la valla ve un `beforeRequest` por intento', async () => {
    let attempts = 0;
    const h = harness(() => {
      attempts++;
      if (attempts === 1) {
        return {
          ok: false,
          status: 429,
          requestSent: true,
          malformedBody: false,
          timedOut: false,
          payload: undefined,
          headers: headersFrom({ 'x-ratelimit-minute-remaining': '0' }),
        };
      }
      return okPage(orgs(1), { page: 1, per_page: 2, total_pages: 1 });
    });
    const fence = fenceRecorder();
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 3, perPage: 2 }) },
      { ...h.deps, durableFence: fence.deps },
    );

    assert.equal(result.organizations.length, 1, 'el reintento sí avanzó');
    assert.equal(
      fence.calls.filter((c) => c.kind === 'beforeRequest').length,
      2,
      'dos intentos de la MISMA página = dos escrituras de "request_started"',
    );
    assert.equal(
      fence.calls.filter((c) => c.kind === 'onSucceeded').length,
      1,
      'un solo desenlace terminal: el éxito',
    );
  });
});

// ─── C13 · huella distinta ⇒ el resumen se ignora (round1 no contamina round2) ─

describe('C13 · el resumen sólo se adopta si la huella coincide', () => {
  it('un registro con la huella de OTRO plan de búsqueda se ignora: la página se pide de verdad', async () => {
    const h = harness((body) => {
      const page = body.page as number;
      return okPage(orgs(1, page - 1), { page, per_page: 2, total_pages: 1 });
    });
    const durableResume: ApolloDurableResumeState = {
      succeededPages: [
        {
          page: 1,
          requestFingerprint: 'huella-de-otra-ronda-completamente-distinta',
          organizations: [normalizedOrg('org_de_otra_ronda')],
          credits: 1,
          resultsReturned: 1,
          totalPages: 1,
          acceptedCount: null,
        },
      ],
      indeterminatePage: null,
    };

    const result = await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        budget: createApolloPaginationBudget({ maxPages: 3, perPage: 2 }),
        durableResume,
      },
      h.deps,
    );

    assert.equal(h.bodies.length, 1, 'la página SÍ se pidió: el registro ajeno no cuenta como durable');
    assert.equal(result.organizations.length, 1);
    assert.ok(
      !result.organizations.some(
        (o) => o.providerReference.providerOrganizationId === 'org_de_otra_ronda',
      ),
      'la organización de la huella ajena nunca se adoptó',
    );
  });

  it('una indeterminada de OTRA huella no bloquea esta búsqueda', async () => {
    const h = harness(() => okPage(orgs(1), { page: 1, per_page: 2, total_pages: 1 }));
    const durableResume: ApolloDurableResumeState = {
      succeededPages: [],
      indeterminatePage: { page: 1, requestFingerprint: 'huella-de-otra-ronda' },
    };

    const result = await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        budget: createApolloPaginationBudget({ maxPages: 3, perPage: 2 }),
        durableResume,
      },
      h.deps,
    );

    assert.equal(h.bodies.length, 1, 'la petición SÍ se emitió: la indeterminada era de otro plan');
    assert.notEqual(result.stopReason, 'indeterminate_prior_page_pending_reconciliation');
  });
});

describe('AGENT1-APOLLO-RESIDUAL-AND-PAGE-FENCING PARTE B — ninguna prueba alcanzó la red', () => {
  it('realFetchCalls === 0', () => {
    assert.equal(realFetchCalls, 0);
  });
});
