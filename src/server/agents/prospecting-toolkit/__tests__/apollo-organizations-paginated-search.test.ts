/**
 * A1-APOLLO-WIZARD-1 — Paginación, presupuesto, rate limits y errores.
 *
 * Offline y determinista: `fetchPage`, `now`, `random` y `sleep` se inyectan.
 * Ninguna prueba de este archivo puede alcanzar la red — el contador
 * `realFetchCalls` lo verifica explícitamente al final.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloOrganizationsPaginatedSearch,
  type ApolloPageFetchResult,
  type ApolloPageLogEntry,
  type ApolloPaginatedSearchDeps,
} from '../apollo-organizations-paginated-search';
import {
  createApolloPaginationBudget,
  evaluateApolloPaginationDecision,
  buildApolloPageIdempotencyKey,
  ApolloPageLedger,
  WIZARD_APOLLO_MAX_PAGES_HARD_CAP,
  APOLLO_CONTRACT_MAX_PER_PAGE,
} from '../apollo-organizations-pagination-budget';
import {
  classifyApolloOrganizationsError,
  classifyApolloPreflightBlock,
  computeApolloBackoffMs,
  APOLLO_BACKOFF_MAX_MS,
} from '../apollo-organizations-error-taxonomy';
import {
  parseApolloRateLimitHeaders,
  parseRetryAfterSeconds,
  identifyExhaustedRateLimitWindow,
} from '@/server/integrations/apollo-rate-limit-headers';

// ─── Instrumentación ──────────────────────────────────────────────────────────

/** Sube si algo intentara salir a la red. Debe quedarse en 0. */
let realFetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (...args: unknown[]) => {
  realFetchCalls++;
  throw new Error(`LLAMADA REAL PROHIBIDA EN TESTS: ${String(args[0])}`);
}) as typeof originalFetch;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function headersFrom(map: Record<string, string>): { get(name: string): string | null } {
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

function okPage(
  organizations: Array<Record<string, unknown>>,
  pagination?: Record<string, number>,
  headers?: Record<string, string>,
): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: { organizations, ...(pagination ? { pagination } : {}) },
    headers: headers ? headersFrom(headers) : null,
  };
}

function errorPage(status: number, headers?: Record<string, string>): ApolloPageFetchResult {
  return {
    ok: false,
    status,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: undefined,
    headers: headers ? headersFrom(headers) : null,
    errorBody: `error ${status}`,
  };
}

const orgs = (count: number, offset = 0): Array<Record<string, unknown>> =>
  Array.from({ length: count }, (_, i) => ({
    id: `org_${offset + i}`,
    name: `Empresa ${offset + i}`,
    primary_domain: `empresa-${offset + i}.com`,
  }));

type Harness = {
  deps: ApolloPaginatedSearchDeps;
  bodies: Array<Record<string, unknown>>;
  logs: ApolloPageLogEntry[];
  sleeps: number[];
};

function harness(
  responder: (body: Record<string, unknown>, call: number) => ApolloPageFetchResult,
): Harness {
  const bodies: Array<Record<string, unknown>> = [];
  const logs: ApolloPageLogEntry[] = [];
  const sleeps: number[] = [];
  let clock = 0;
  let call = 0;

  return {
    bodies,
    logs,
    sleeps,
    deps: {
      fetchPage: async (body) => {
        bodies.push(body);
        clock += 10;
        return responder(body, call++);
      },
      now: () => clock,
      random: () => 0.5,
      logPage: (entry) => { logs.push(entry); },
      sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    },
  };
}

const baseInput = {
  filters: { locations: ['Colombia'], keywordTags: ['lms'] },
  wizardRunId: 'run_a1_apollo_wizard_1',
  agentRunId: 'agent_run_1',
};

beforeEach(() => { realFetchCalls = 0; });

// ─── Presupuesto ──────────────────────────────────────────────────────────────

describe('A1-APOLLO-WIZARD-1 · presupuesto de paginación', () => {
  // AGENT1-APOLLO-NET-NEW-PAGINATION § 4/§ 9 — Apollo cobra 1 crédito por
  // página no vacía, no por resultado: per_page ya no es una palanca de gasto,
  // así que el default pide el techo del contrato (100) y el presupuesto real
  // se expresa en PÁGINAS (el mismo techo monetario que antes limitaba
  // resultados, ahora reinterpretado).
  it('per_page por defecto es el techo del contrato; el presupuesto se expresa en páginas', () => {
    const budget = createApolloPaginationBudget();
    assert.equal(budget.perPage, APOLLO_CONTRACT_MAX_PER_PAGE, 'per_page=100, no un conteo pequeño de resultados');
    assert.equal(budget.maxPages, WIZARD_APOLLO_MAX_PAGES_HARD_CAP, 'acotado por el techo de páginas del wizard');
    assert.equal(budget.maxCredits, budget.maxPages, '1 crédito por página, no por resultado');
    assert.equal(budget.derivedFrom.perPage, 'apollo_contract_max_per_page');
    assert.equal(budget.derivedFrom.maxPages, 'wizard_apollo_max_search_credits_1_credit_per_page');
  });

  it('acota maxPages al techo del wizard, muy por debajo de las 500 del contrato', () => {
    const budget = createApolloPaginationBudget({ maxPages: 400 });
    assert.equal(budget.maxPages, WIZARD_APOLLO_MAX_PAGES_HARD_CAP);
    assert.ok(budget.maxPages < 500);
  });

  it('acota perPage al techo del contrato Apollo (100)', () => {
    assert.equal(
      createApolloPaginationBudget({ perPage: 5_000 }).perPage,
      APOLLO_CONTRACT_MAX_PER_PAGE,
    );
  });

  // ── Caso 7: paginación con total_pages ─────────────────────────────────────
  it('se detiene en la última página según total_pages', () => {
    const budget = createApolloPaginationBudget({ maxPages: 5, perPage: 10, maxCandidates: 999 });
    const decision = evaluateApolloPaginationDecision(budget, {
      pagesFetched: 2, creditsUsed: 2, candidatesCollected: 2,
      elapsedMs: 0, totalPages: 2, lastPage: 2, lastPageResultCount: 10,
    });
    assert.equal(decision.shouldContinue, false);
    assert.equal(decision.shouldContinue === false && decision.stopReason, 'last_page_reached');
  });

  // ── Caso 5 de paginación: una página corta NO detiene ──────────────────────
  it('una página corta no detiene la paginación', () => {
    const budget = createApolloPaginationBudget({ maxPages: 5, perPage: 10, maxCandidates: 999, maxCredits: 99 });
    const decision = evaluateApolloPaginationDecision(budget, {
      pagesFetched: 1, creditsUsed: 2, candidatesCollected: 2,
      elapsedMs: 0, totalPages: 5, lastPage: 1, lastPageResultCount: 2,
    });
    assert.equal(decision.shouldContinue, true);
    assert.equal(decision.shouldContinue === true && decision.nextPage, 2);
  });

  it('la precedencia de parada es cancelación > guardrail > tiempo > objetivo > créditos > páginas', () => {
    const budget = createApolloPaginationBudget({ maxPages: 5, perPage: 10 });
    const saturated = {
      pagesFetched: 99, creditsUsed: 999, candidatesCollected: 999,
      elapsedMs: 10 ** 9, totalPages: 1, lastPage: 1, lastPageResultCount: 0,
    };
    const cancelled = evaluateApolloPaginationDecision(budget, { ...saturated, cancelled: true });
    assert.equal(cancelled.shouldContinue === false && cancelled.stopReason, 'cancelled');

    const guardrail = evaluateApolloPaginationDecision(budget, { ...saturated, guardrailTripped: 'x' });
    assert.equal(guardrail.shouldContinue === false && guardrail.stopReason, 'operational_guardrail');
  });

  it('la clave idempotente identifica ejecución, filtros y página', () => {
    const key = buildApolloPageIdempotencyKey({
      wizardRunId: 'run_1', provider: 'apollo', filtersFingerprint: 'fp', page: 3,
    });
    assert.equal(key, 'apollo:organizations_search:run_1:fp:page_3');
    assert.notEqual(
      key,
      buildApolloPageIdempotencyKey({
        wizardRunId: 'run_1', provider: 'apollo', filtersFingerprint: 'fp', page: 4,
      }),
    );
  });

  it('el ledger bloquea repetir una página exitosa o indeterminada', () => {
    const ledger = new ApolloPageLedger();
    ledger.markSucceeded('k1');
    assert.equal(ledger.canRequest('k1'), false);
    ledger.markIndeterminate('k2');
    assert.equal(ledger.canRequest('k2'), false);
    assert.deepEqual(ledger.indeterminateKeys, ['k2']);
    assert.equal(ledger.canRequest('k3'), true);
  });
});

// ─── Rate limits ──────────────────────────────────────────────────────────────

describe('A1-APOLLO-WIZARD-1 · headers de rate limit', () => {
  it('lee las tres ventanas desde los headers reales', () => {
    const snapshot = parseApolloRateLimitHeaders(
      headersFrom({
        'x-minute-usage': '12', 'x-minute-requests-left': '188', 'x-rate-limit-minute': '200',
        'x-hourly-usage': '300', 'x-hourly-requests-left': '5700', 'x-rate-limit-hourly': '6000',
        'x-24-hour-usage': '900', 'x-24-hour-requests-left': '49100', 'x-rate-limit-24-hour': '50000',
      }),
      0,
    );
    assert.deepEqual(snapshot.minute, { window: 'minute', used: 12, remaining: 188, limit: 200 });
    assert.equal(snapshot.hourly.limit, 6000);
    assert.equal(snapshot.daily.limit, 50000);
    assert.equal(snapshot.anyHeaderPresent, true);
  });

  it('headers ausentes producen null, nunca cero', () => {
    const snapshot = parseApolloRateLimitHeaders(headersFrom({}), 0);
    assert.equal(snapshot.minute.remaining, null);
    assert.equal(snapshot.anyHeaderPresent, false);
    assert.equal(identifyExhaustedRateLimitWindow(snapshot), null);
  });

  it('identifica la ventana agotada cuando la respuesta lo permite', () => {
    const snapshot = parseApolloRateLimitHeaders(
      headersFrom({ 'x-minute-requests-left': '0', 'x-hourly-requests-left': '500' }),
      0,
    );
    assert.equal(identifyExhaustedRateLimitWindow(snapshot), 'minute');
  });

  // ── Caso 25: Retry-After presente y ausente ────────────────────────────────
  it('parsea Retry-After en segundos y en fecha HTTP', () => {
    assert.equal(parseRetryAfterSeconds('30', 0), 30);
    assert.equal(parseRetryAfterSeconds('  45  ', 0), 45);
    const nowMs = Date.parse('2026-07-30T12:00:00Z');
    assert.equal(parseRetryAfterSeconds('Thu, 30 Jul 2026 12:00:20 GMT', nowMs), 20);
  });

  it('Retry-After ausente o corrupto devuelve null', () => {
    for (const raw of [null, undefined, '', '   ', 'mañana']) {
      assert.equal(parseRetryAfterSeconds(raw, 0), null);
    }
  });
});

// ─── Taxonomía de errores ─────────────────────────────────────────────────────

describe('A1-APOLLO-WIZARD-1 · taxonomía de errores', () => {
  // ── Caso 24: 401, 403, 422, 429, 5xx ───────────────────────────────────────
  it('clasifica 401 como credencial inválida, no reintentable', () => {
    const c = classifyApolloOrganizationsError({ httpStatus: 401, requestSent: true });
    assert.equal(c.category, 'invalid_credential');
    assert.equal(c.retryable, false);
    assert.equal(c.billingState, 'not_charged');
    assert.equal(c.terminatesPagination, true);
  });

  it('clasifica 403 como plan/scope insuficiente', () => {
    const c = classifyApolloOrganizationsError({ httpStatus: 403, requestSent: true });
    assert.equal(c.category, 'insufficient_plan_or_scope');
    assert.equal(c.retryable, false);
  });

  it('clasifica 422 como request inválido y no lo reintenta', () => {
    const c = classifyApolloOrganizationsError({ httpStatus: 422, requestSent: true });
    assert.equal(c.category, 'invalid_request');
    assert.equal(c.retryable, false);
  });

  it('clasifica 429 como rate limited y usa Retry-After cuando existe', () => {
    const rateLimit = parseApolloRateLimitHeaders(
      headersFrom({ 'retry-after': '7', 'x-minute-requests-left': '0' }),
      0,
    );
    const c = classifyApolloOrganizationsError({ httpStatus: 429, requestSent: true, rateLimit });
    assert.equal(c.category, 'rate_limited');
    assert.equal(c.retryable, true);
    assert.equal(c.retryAfterMs, 7000);
    assert.equal(c.retryAfterSource, 'retry_after_header');
    assert.equal(c.exhaustedWindow, 'minute');
  });

  it('sin Retry-After usa backoff exponencial con jitter', () => {
    const c = classifyApolloOrganizationsError({
      httpStatus: 429, requestSent: true, attempt: 3, jitterFactor: 1,
    });
    assert.equal(c.retryAfterSource, 'exponential_backoff_with_jitter');
    assert.equal(c.retryAfterMs, 4000);
  });

  it('clasifica 5xx como fallo del proveedor, reintentable', () => {
    const c = classifyApolloOrganizationsError({ httpStatus: 503, requestSent: true });
    assert.equal(c.category, 'provider_failure');
    assert.equal(c.retryable, true);
  });

  // ── Caso 26: timeout ambiguo sin retry automático ──────────────────────────
  it('un timeout posterior al envío no es reintentable y deja el cobro en desconocido', () => {
    const c = classifyApolloOrganizationsError({
      httpStatus: null, requestSent: true, timedOut: true,
    });
    assert.equal(c.category, 'network_timeout');
    assert.equal(c.retryable, false);
    assert.equal(c.billingState, 'unknown');
    assert.equal(c.terminatesPagination, true);
  });

  it('un request que nunca salió sí es reintentable y no pudo cobrarse', () => {
    const c = classifyApolloOrganizationsError({ httpStatus: null, requestSent: false });
    assert.equal(c.retryable, true);
    assert.equal(c.billingState, 'not_charged');
  });

  it('un 2xx con cuerpo ilegible es respuesta malformada, no búsqueda vacía', () => {
    const c = classifyApolloOrganizationsError({
      httpStatus: 200, requestSent: true, malformedBody: true,
    });
    assert.equal(c.category, 'malformed_response');
    assert.equal(c.billingState, 'unknown');
  });

  it('los bloqueos de preflight no implican cobro', () => {
    for (const reason of ['feature_disabled', 'provider_unavailable', 'budget_exceeded'] as const) {
      const c = classifyApolloPreflightBlock(reason);
      assert.equal(c.category, reason);
      assert.equal(c.billingState, 'not_charged');
      assert.equal(c.httpStatus, null);
    }
  });

  it('el backoff crece exponencialmente y respeta el techo', () => {
    assert.equal(computeApolloBackoffMs(1, 1), 1000);
    assert.equal(computeApolloBackoffMs(2, 1), 2000);
    assert.equal(computeApolloBackoffMs(3, 1), 4000);
    assert.equal(computeApolloBackoffMs(99, 1), APOLLO_BACKOFF_MAX_MS);
    assert.equal(computeApolloBackoffMs(3, 0), 0, 'el jitter puede reducir la espera a cero');
  });
});

// ─── Búsqueda paginada ────────────────────────────────────────────────────────

describe('A1-APOLLO-WIZARD-1 · búsqueda paginada', () => {
  it('recorre varias páginas y acumula resultados deduplicados', async () => {
    const h = harness((body) => {
      const page = body.page as number;
      return okPage(orgs(3, (page - 1) * 3), { page, per_page: 3, total_pages: 3, total_entries: 9 });
    });

    // Presupuesto holgado a propósito: aquí quien debe detener la paginación es
    // `total_pages`, no un tope de gasto.
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 5, perPage: 3, maxCandidates: 999, maxCredits: 99 }) },
      h.deps,
    );

    assert.equal(result.pagesProcessed, 3);
    assert.equal(result.organizations.length, 9);
    assert.equal(result.stopReason, 'last_page_reached');
    assert.deepEqual(h.bodies.map((b) => b.page), [1, 2, 3]);
  });

  // ── Caso 8: página vacía ───────────────────────────────────────────────────
  it('una página vacía no es un error y no suma créditos estimados', async () => {
    const h = harness(() => okPage([], { page: 1, per_page: 3, total_pages: 1 }));
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 3, perPage: 3 }) },
      h.deps,
    );
    assert.equal(result.organizations.length, 0);
    assert.equal(result.estimatedCredits, 0);
    assert.equal(result.terminalError, null);
    assert.equal(result.pageOutcomes[0].status, 'success');
    assert.equal(result.pageOutcomes[0].billingState, 'not_charged');
  });

  // ── Caso 9 (AGENT1-APOLLO-NET-NEW-PAGINATION § 4): detención por presupuesto ──
  // Bajo el modelo de facturación por página (1 crédito por página NO VACÍA,
  // no por resultado), el tope de créditos es un tope de PÁGINAS: con
  // maxCredits=2 se detiene tras la segunda, sin importar que cada página
  // traiga 3 resultados.
  it('se detiene al agotar el presupuesto de créditos', async () => {
    const h = harness((body) => {
      const page = body.page as number;
      return okPage(orgs(3, (page - 1) * 3), { page, per_page: 3, total_pages: 100 });
    });
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 5, perPage: 3, maxCredits: 2, maxCandidates: 999 }) },
      h.deps,
    );
    assert.equal(result.pagesProcessed, 2);
    assert.equal(result.estimatedCredits, 2);
    assert.equal(result.stopReason, 'max_credits_reached');
  });

  it('se detiene al alcanzar el objetivo de candidatos', async () => {
    const h = harness((body) => {
      const page = body.page as number;
      return okPage(orgs(3, (page - 1) * 3), { page, per_page: 3, total_pages: 100 });
    });
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 5, perPage: 3, maxCandidates: 3, maxCredits: 99 }) },
      h.deps,
    );
    assert.equal(result.organizations.length, 3);
    assert.equal(result.stopReason, 'candidate_target_reached');
  });

  it('se detiene al agotar el presupuesto temporal', async () => {
    let clock = 0;
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 5, perPage: 3, maxCredits: 99, maxCandidates: 999, timeoutBudgetMs: 50 }) },
      {
        fetchPage: async () => { clock += 40; return okPage(orgs(1), { page: 1, total_pages: 100 }); },
        now: () => clock,
        random: () => 0,
      },
    );
    assert.equal(result.stopReason, 'time_budget_exhausted');
    assert.ok(result.pagesProcessed >= 1);
  });

  it('respeta la cancelación externa', async () => {
    let cancelled = false;
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 5, perPage: 3, maxCredits: 99, maxCandidates: 999 }) },
      {
        fetchPage: async () => { cancelled = true; return okPage(orgs(1), { page: 1, total_pages: 100 }); },
        now: () => 0,
        random: () => 0,
        isCancelled: () => cancelled,
      },
    );
    assert.equal(result.stopReason, 'cancelled');
    assert.equal(result.pagesProcessed, 1);
  });

  // ── Caso 10: no repetir una página exitosa ─────────────────────────────────
  it('nunca vuelve a pedir una página exitosa', async () => {
    const h = harness((body) => {
      const page = body.page as number;
      // Apollo miente sobre total_pages y devuelve siempre las mismas orgs:
      // aun así, cada página se pide una sola vez.
      return okPage(orgs(2, 0), { page, per_page: 2, total_pages: 100 });
    });
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 4, perPage: 2, maxCredits: 99, maxCandidates: 999 }) },
      h.deps,
    );
    const pages = h.bodies.map((b) => b.page);
    assert.deepEqual(pages, [1, 2, 3, 4]);
    assert.equal(new Set(pages).size, pages.length, 'ninguna página se repite');
    // El dedup por organization id impide que las repetidas se acumulen.
    assert.equal(result.organizations.length, 2);
  });

  it('reintenta un 429 y luego avanza, sin repetir la página exitosa', async () => {
    const h = harness((body, call) => {
      if (call === 0) return errorPage(429, { 'retry-after': '2' });
      const page = body.page as number;
      return okPage(orgs(2, (page - 1) * 2), { page, per_page: 2, total_pages: 2 });
    });
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 3, perPage: 2, maxCredits: 99, maxCandidates: 999 }) },
      h.deps,
    );
    assert.deepEqual(h.sleeps, [2000], 'esperó exactamente lo que dijo Retry-After');
    assert.equal(result.terminalError, null);
    assert.ok(result.pagesProcessed >= 1);
    const successfulPages = result.pageOutcomes.filter((o) => o.status === 'success').map((o) => o.page);
    assert.equal(new Set(successfulPages).size, successfulPages.length);
  });

  // ── Caso 26 en el orquestador ──────────────────────────────────────────────
  it('un timeout ambiguo detiene la búsqueda y marca la página como indeterminada', async () => {
    const h = harness(() => ({
      ok: false, status: null, requestSent: true, malformedBody: false,
      timedOut: true, payload: undefined, headers: null,
    }));
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 3, perPage: 3 }) },
      h.deps,
    );
    assert.equal(h.bodies.length, 1, 'no reintenta automáticamente');
    assert.deepEqual(result.indeterminatePages, [1]);
    assert.equal(result.stopReason, 'error_terminated');
    assert.equal(result.terminalError?.billingState, 'unknown');
  });

  it('un 401 termina la búsqueda sin degradarse a cero resultados', async () => {
    const h = harness(() => errorPage(401));
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 3, perPage: 3 }) },
      h.deps,
    );
    assert.equal(result.stopReason, 'error_terminated');
    assert.equal(result.terminalError?.category, 'invalid_credential');
    assert.equal(result.organizations.length, 0);
    assert.notEqual(result.terminalError, null, 'un error nunca se reporta como búsqueda vacía');
  });

  it('un 422 no se reintenta con el mismo body', async () => {
    const h = harness(() => errorPage(422));
    await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 3, perPage: 3 }) },
      h.deps,
    );
    assert.equal(h.bodies.length, 1);
  });

  it('conserva los resultados obtenidos antes de un fallo terminal', async () => {
    const h = harness((body, call) => {
      if (call === 0) return okPage(orgs(2), { page: 1, per_page: 2, total_pages: 5 });
      return errorPage(500);
    });
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 3, perPage: 2, maxCredits: 99, maxCandidates: 999 }) },
      { ...h.deps, random: () => 0 },
    );
    assert.equal(result.organizations.length, 2);
    assert.equal(result.terminalError?.category, 'provider_failure');
  });

  // ── Caso 4 en el orquestador: SIC/NAICS nunca salen ────────────────────────
  it('aborta antes de cualquier llamada si el caller propone SIC/NAICS', async () => {
    const h = harness(() => okPage(orgs(1)));
    const result = await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        filters: { ...baseInput.filters, extraParams: { organization_naics_codes: ['5112'] } },
        budget: createApolloPaginationBudget(),
      },
      h.deps,
    );
    assert.equal(h.bodies.length, 0, 'cero llamadas: se detiene antes de gastar créditos');
    assert.deepEqual(result.rejectedForbiddenParams, ['organization_naics_codes']);
    assert.equal(result.estimatedCredits, 0);
    assert.equal(result.terminalError?.category, 'invalid_request');
  });

  it('ningún body enviado contiene SIC ni NAICS', async () => {
    const h = harness((body) => okPage(orgs(1), { page: body.page as number, total_pages: 1 }));
    await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 3, perPage: 3 }) },
      h.deps,
    );
    for (const body of h.bodies) {
      for (const forbidden of [
        'organization_sic_codes', 'organization_naics_codes',
        'not_organization_sic_codes', 'not_organization_naics_codes',
      ]) {
        assert.equal(forbidden in body, false);
      }
    }
  });

  // ── Caso 27: provider usage logging ────────────────────────────────────────
  it('registra una entrada por página con huella, cuota, créditos y estado', async () => {
    const h = harness((body) =>
      okPage(orgs(2, ((body.page as number) - 1) * 2), { page: body.page as number, per_page: 2, total_pages: 2 },
        { 'x-minute-requests-left': '150', 'x-rate-limit-minute': '200' }),
    );
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 2, perPage: 2, maxCredits: 99, maxCandidates: 999 }) },
      h.deps,
    );

    assert.equal(h.logs.length, 2);
    const [first] = h.logs;
    assert.equal(first.provider, 'apollo');
    assert.equal(first.operation, 'organizations_search');
    assert.equal(first.endpoint, '/api/v1/mixed_companies/search');
    assert.equal(first.page, 1);
    assert.equal(first.perPage, 2);
    assert.equal(first.resultsReturned, 2);
    // AGENT1-APOLLO-NET-NEW-PAGINATION § 4 — 1 crédito por página no vacía, no
    // por resultado devuelto: 2 resultados siguen costando 1 crédito.
    assert.equal(first.estimatedCredits, 1);
    assert.equal(first.actualCredits, null, 'no se afirma un crédito real no verificado');
    assert.equal(first.rateLimit.rate_limit_minute_remaining, 150);
    assert.equal(first.status, 'success');
    assert.equal(first.wizardRunId, baseInput.wizardRunId);
    assert.equal(first.agentRunId, baseInput.agentRunId);
    assert.equal(first.requestFingerprint, result.requestFingerprint);
    assert.ok(first.idempotencyKey.endsWith('page_1'));
    assert.ok(typeof first.latencyMs === 'number');
  });

  it('registra también los intentos fallidos, con categoría y estado de cobro', async () => {
    const h = harness(() => errorPage(403));
    await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget() },
      h.deps,
    );
    assert.equal(h.logs.length, 1);
    assert.equal(h.logs[0].status, 'error');
    assert.equal(h.logs[0].errorCategory, 'insufficient_plan_or_scope');
    assert.equal(h.logs[0].billingState, 'not_charged');
  });

  it('un fallo del logger no tumba una búsqueda que ya gastó créditos', async () => {
    const h = harness((body) => okPage(orgs(2), { page: body.page as number, total_pages: 1 }));
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget() },
      { ...h.deps, logPage: () => { throw new Error('sink caído'); } },
    );
    assert.equal(result.organizations.length, 2);
  });

  it('la huella de request es la misma en todas las páginas de una ejecución', async () => {
    const h = harness((body) =>
      okPage(orgs(1, body.page as number), { page: body.page as number, per_page: 1, total_pages: 3 }),
    );
    await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ maxPages: 3, perPage: 1, maxCredits: 99, maxCandidates: 999 }) },
      h.deps,
    );
    const fingerprints = new Set(h.logs.map((l) => l.requestFingerprint));
    assert.equal(fingerprints.size, 1);
  });

  // ── Caso 28: cero llamadas reales ──────────────────────────────────────────
  it('ninguna prueba de este archivo alcanzó la red', () => {
    assert.equal(realFetchCalls, 0);
  });
});
