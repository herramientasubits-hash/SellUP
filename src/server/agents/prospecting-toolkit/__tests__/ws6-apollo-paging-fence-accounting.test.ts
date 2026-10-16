/**
 * WS6 — paginación, valla de página y contabilidad de gasto de Apollo.
 *
 * Cubre, sobre el motor real con transporte inyectado (sin red, sin Supabase):
 *   F1 — la reserva del camino por defecto cuenta las páginas net-new reales.
 *   F2 — un rechazo SIN cobro cierra la valla (`onNotCharged`) y la reserva
 *        durable de esa página puede volver a pedirse sólo con saldo.
 *   F3 — las páginas adoptadas de la valla entran al volumen pagado, y la
 *        compactación escalonada conserva la identidad de páginas grandes.
 *   F4 — `Retry-After` nunca duerme más allá del presupuesto temporal, y una
 *        cuota horaria/diaria agotada no se reintenta.
 *   F7 — un fallo terminal después de una página cobrada registra ese crédito.
 *   F8 — el evaluador de aceptación corre en lote, una vez por organización.
 *   F9 — 502/504 son cobro desconocido sin reintento.
 *
 * Offline por construcción. LIVE_APOLLO_CALLS = 0.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloOrganizationsPaginatedSearch,
  APOLLO_ACCEPTANCE_EVALUATION_CONCURRENCY,
  type ApolloPageFetchResult,
  type ApolloPaginatedSearchDeps,
  type ApolloPaginatedSearchInput,
} from '../apollo-organizations-paginated-search';
import {
  createApolloPaginationBudget,
  APOLLO_NET_NEW_MAX_PAGES_PER_INVOCATION,
  WIZARD_APOLLO_MAX_PAGES_HARD_CAP,
} from '../apollo-organizations-pagination-budget';
import { classifyApolloOrganizationsError } from '../apollo-organizations-error-taxonomy';
import { resolveApolloPaidResultsVolume } from '../apollo-organizations-paid-volume';
import { parseApolloRateLimitHeaders } from '@/server/integrations/apollo-rate-limit-headers';
import {
  APOLLO_PAGE_FENCE_CONTRACT_VERSION,
  APOLLO_PAGE_FENCE_MAX_SERIALIZED_BYTES,
  compactApolloPageFenceForSize,
  fromApolloPageFenceOrganization,
  releaseApolloPageFenceNotChargedEntry,
  toApolloDurableResumeState,
  toApolloPageFenceOrganization,
  type ApolloPageFenceEntry,
} from '../apollo-two-round/page-fence';
import {
  createRunBudgetLedger,
  reserveOperation,
  settleOperation,
  committedCredits,
} from '../apollo-two-round/run-budget-ledger';
import {
  runApolloOrganizationsSearch,
  type ApolloOrgsSearchDeps,
} from '../web-search-providers/apollo-organizations-search-provider';
import type { NormalizedApolloOrganization } from '../apollo-organizations-response-normalizer';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';

// ─── Instrumentación: ninguna prueba puede alcanzar la red ────────────────────

let realFetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (...args: unknown[]) => {
  realFetchCalls++;
  throw new Error(`LLAMADA REAL PROHIBIDA EN TESTS: ${String(args[0])}`);
}) as typeof originalFetch;
beforeEach(() => {
  realFetchCalls = 0;
});
afterEach(() => {
  assert.equal(realFetchCalls, 0, 'ninguna prueba puede llamar a la red');
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function headersFrom(map: Record<string, string> = {}): { get(name: string): string | null } {
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

const orgs = (count: number, offset = 0): Array<Record<string, unknown>> =>
  Array.from({ length: count }, (_, i) => ({
    id: `org_${offset + i}`,
    name: `Empresa ${offset + i}`,
    primary_domain: `empresa-${offset + i}.com`,
  }));

function okPage(count: number, offset = 0): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: {
      organizations: orgs(count, offset),
      pagination: { page: 1, per_page: 100, total_entries: 5_000, total_pages: 50 },
    },
    headers: headersFrom(),
  };
}

function httpError(status: number, headers: Record<string, string> = {}): ApolloPageFetchResult {
  return {
    ok: false,
    status,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: undefined,
    headers: headersFrom(headers),
  };
}

type FenceCall = { kind: string; page: number };

function recordingFence(): {
  fence: NonNullable<ApolloPaginatedSearchDeps['durableFence']>;
  calls: FenceCall[];
} {
  const calls: FenceCall[] = [];
  return {
    calls,
    fence: {
      beforeRequest: async ({ page }) => {
        calls.push({ kind: 'beforeRequest', page });
      },
      onSucceeded: async ({ page }) => {
        calls.push({ kind: 'onSucceeded', page });
      },
      onIndeterminate: async ({ page }) => {
        calls.push({ kind: 'onIndeterminate', page });
      },
      onNotCharged: async ({ page }) => {
        calls.push({ kind: 'onNotCharged', page });
      },
    },
  };
}

function baseDeps(
  responses: ApolloPageFetchResult[],
  extra: Partial<ApolloPaginatedSearchDeps> = {},
): { deps: ApolloPaginatedSearchDeps; sent: number[]; sleeps: number[] } {
  const sent: number[] = [];
  const sleeps: number[] = [];
  let index = 0;
  return {
    sent,
    sleeps,
    deps: {
      fetchPage: async (body) => {
        sent.push(Number(body.page));
        const response = responses[Math.min(index, responses.length - 1)]!;
        index++;
        return response;
      },
      now: () => 0,
      random: () => 0.5,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      ...extra,
    },
  };
}

const INPUT: ApolloPaginatedSearchInput = {
  filters: { keywordTags: ['software'], locations: ['Colombia'] },
  budget: createApolloPaginationBudget({ maxPages: 3 }),
  wizardRunId: 'ws6-run',
};

function normalizedOrg(id: string): NormalizedApolloOrganization {
  return fromApolloPageFenceOrganization({ provider_organization_id: id, name: `E ${id}`, primary_domain: `${id}.com` });
}

// ─── F1 ───────────────────────────────────────────────────────────────────────

describe('WS6 · F1 — techo de páginas net-new compartido con la reserva', () => {
  it('la constante net-new es el techo real del presupuesto por defecto', () => {
    assert.equal(APOLLO_NET_NEW_MAX_PAGES_PER_INVOCATION, WIZARD_APOLLO_MAX_PAGES_HARD_CAP);
    assert.equal(createApolloPaginationBudget().maxPages, APOLLO_NET_NEW_MAX_PAGES_PER_INVOCATION);
  });

  it('el provider con evaluador pagina como máximo lo que la reserva cuenta', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    try {
      let calls = 0;
      const deps: ApolloOrgsSearchDeps = {
        fetchPage: async () => {
          calls++;
          return okPage(100, calls * 100);
        },
        logUsage: async () => ({ kind: 'logged' }),
        now: () => 0,
        random: () => 0,
        sleep: async () => undefined,
        recordProviderSeen: async () => ({
          written: false,
          skippedReason: 'test_no_store',
          newIdsRecorded: 0,
          newDomainsRecorded: 0,
          refreshedCount: 0,
        }),
      };
      await runApolloOrganizationsSearch(
        { query: 'software colombia', country: 'Colombia', countryCode: 'CO', industry: 'Tecnología', maxResults: 5, provider: 'apollo_organizations' },
        5,
        undefined,
        deps,
        { netNewTarget: 5, evaluateCandidateAcceptance: () => false },
      );
      assert.equal(calls, APOLLO_NET_NEW_MAX_PAGES_PER_INVOCATION);
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    }
  });
});

// ─── F2 ───────────────────────────────────────────────────────────────────────

describe('WS6 · F2 — rechazo sin cobro cierra la valla', () => {
  for (const status of [401, 403, 422]) {
    it(`HTTP ${status} tras beforeRequest ⇒ onNotCharged (nunca indeterminado)`, async () => {
      const { fence, calls } = recordingFence();
      const { deps } = baseDeps([httpError(status)], { durableFence: fence });
      const result = await runApolloOrganizationsPaginatedSearch(INPUT, deps);
      assert.deepEqual(calls, [
        { kind: 'beforeRequest', page: 1 },
        { kind: 'onNotCharged', page: 1 },
      ]);
      assert.equal(result.pageOutcomes[0]!.billingState, 'not_charged');
    });
  }

  it('429 agotado tras 3 intentos ⇒ un solo onNotCharged al final', async () => {
    const { fence, calls } = recordingFence();
    const { deps, sent } = baseDeps([httpError(429)], { durableFence: fence });
    await runApolloOrganizationsPaginatedSearch(INPUT, deps);
    assert.equal(sent.length, 3);
    assert.deepEqual(
      calls.filter((call) => call.kind === 'onNotCharged'),
      [{ kind: 'onNotCharged', page: 1 }],
    );
  });

  it('timeout después del envío ⇒ onIndeterminate, NUNCA onNotCharged', async () => {
    const { fence, calls } = recordingFence();
    const { deps } = baseDeps(
      [{ ok: false, status: null, requestSent: true, malformedBody: false, timedOut: true, payload: undefined, headers: null }],
      { durableFence: fence },
    );
    await runApolloOrganizationsPaginatedSearch(INPUT, deps);
    assert.ok(calls.some((call) => call.kind === 'onIndeterminate'));
    assert.ok(!calls.some((call) => call.kind === 'onNotCharged'));
  });

  it('beforeRequest que lanza ⇒ no hay valla que cerrar', async () => {
    const { fence, calls } = recordingFence();
    const throwing = {
      ...fence,
      beforeRequest: async () => {
        throw new Error('durable_fence_write_failed');
      },
    };
    const { deps, sent } = baseDeps([httpError(401)], { durableFence: throwing });
    await runApolloOrganizationsPaginatedSearch(INPUT, deps);
    assert.equal(sent.length, 0);
    assert.ok(!calls.some((call) => call.kind === 'onNotCharged'));
  });

  it('onNotCharged que lanza no tumba la búsqueda', async () => {
    const { fence } = recordingFence();
    const { deps } = baseDeps([httpError(401)], {
      durableFence: { ...fence, onNotCharged: async () => { throw new Error('boom'); } },
    });
    const result = await runApolloOrganizationsPaginatedSearch(INPUT, deps);
    assert.equal(result.stopReason, 'error_terminated');
  });

  const entry = (overrides: Partial<ApolloPageFenceEntry>): ApolloPageFenceEntry => ({
    round_number: 1,
    search_plan_fingerprint: 'fp',
    page: 1,
    status: 'request_started',
    organizations: [],
    credits: 1,
    results_returned: 0,
    total_pages: null,
    accepted_count: null,
    ...overrides,
  });

  it('liberar quita SÓLO el request_started de esa página; el resumen deja de bloquear', () => {
    const entries = [
      entry({ page: 1, status: 'succeeded', credits: 1 }),
      entry({ page: 2, status: 'request_started' }),
    ];
    assert.notEqual(toApolloDurableResumeState(entries).indeterminatePage, null);
    const released = releaseApolloPageFenceNotChargedEntry(entries, {
      round_number: 1,
      search_plan_fingerprint: 'fp',
      page: 2,
    });
    assert.equal(released.length, 1);
    assert.equal(toApolloDurableResumeState(released).indeterminatePage, null);
  });

  it('liberar NUNCA quita un succeeded ni un indeterminate', () => {
    for (const status of ['succeeded', 'indeterminate'] as const) {
      const entries = [entry({ page: 1, status })];
      const released = releaseApolloPageFenceNotChargedEntry(entries, {
        round_number: 1,
        search_plan_fingerprint: 'fp',
        page: 1,
      });
      assert.deepEqual(released, entries);
    }
  });

  it('una operación liquidada en 0 vuelve a reservarse con comprobación de saldo', () => {
    let ledger = createRunBudgetLedger(1);
    const first = reserveOperation(ledger, { operationId: 'p1', operationKey: 'organizations_search', estimatedCredits: 1 });
    assert.ok(first.ok);
    ledger = settleOperation(first.ledger, { operationId: 'p1', credits: 0 });
    assert.equal(committedCredits(ledger), 0);

    // Otra página consume el único crédito…
    const other = reserveOperation(ledger, { operationId: 'p2', operationKey: 'organizations_search', estimatedCredits: 1 });
    assert.ok(other.ok);
    ledger = other.ledger;

    // …y el reintento de p1 YA NO pasa como «ya reservada».
    const retry = reserveOperation(ledger, { operationId: 'p1', operationKey: 'organizations_search', estimatedCredits: 1 });
    assert.equal(retry.ok, false);
  });

  it('re-reservar sustituye la entrada liquidada en 0, no la duplica', () => {
    let ledger = createRunBudgetLedger(5);
    const first = reserveOperation(ledger, { operationId: 'p1', operationKey: 'organizations_search', estimatedCredits: 1 });
    assert.ok(first.ok);
    ledger = settleOperation(first.ledger, { operationId: 'p1', credits: 0 });
    const retry = reserveOperation(ledger, { operationId: 'p1', operationKey: 'organizations_search', estimatedCredits: 1 });
    assert.ok(retry.ok);
    assert.equal(retry.alreadyReserved, false);
    assert.equal(retry.ledger.entries.length, 1);
    assert.equal(retry.ledger.entries[0]!.state, 'reserved');
  });

  it('una operación liquidada con coste > 0 sigue siendo idempotente', () => {
    let ledger = createRunBudgetLedger(5);
    const first = reserveOperation(ledger, { operationId: 'p1', operationKey: 'organizations_search', estimatedCredits: 1 });
    assert.ok(first.ok);
    ledger = settleOperation(first.ledger, { operationId: 'p1', credits: 1 });
    const again = reserveOperation(ledger, { operationId: 'p1', operationKey: 'organizations_search', estimatedCredits: 1 });
    assert.ok(again.ok);
    assert.equal(again.alreadyReserved, true);
  });
});

// ─── F3 ───────────────────────────────────────────────────────────────────────

describe('WS6 · F3 — páginas adoptadas y compactación escalonada', () => {
  it('las páginas adoptadas entran a pageOutcomes y al volumen pagado', async () => {
    const { deps, sent } = baseDeps([okPage(10, 500)]);
    const result = await runApolloOrganizationsPaginatedSearch(INPUT, deps);
    const fingerprint = result.requestFingerprint;

    const resumed = await runApolloOrganizationsPaginatedSearch(
      {
        ...INPUT,
        durableResume: {
          succeededPages: [
            { page: 1, requestFingerprint: fingerprint, organizations: [normalizedOrg('a')], credits: 1, resultsReturned: 100, totalPages: 50, acceptedCount: null },
            { page: 2, requestFingerprint: fingerprint, organizations: [normalizedOrg('b')], credits: 1, resultsReturned: 100, totalPages: 50, acceptedCount: null },
          ],
          indeterminatePage: null,
        },
      },
      baseDeps([okPage(10, 900)]).deps,
    );
    void sent;
    const adopted = resumed.pageOutcomes.filter((outcome) => outcome.adoptedFromDurableResume === true);
    assert.deepEqual(adopted.map((outcome) => outcome.page), [1, 2]);
    const volume = resolveApolloPaidResultsVolume(resumed.pageOutcomes);
    // 2 adoptadas + 1 pedida ahora = 3 créditos.
    assert.equal(volume.creditsCharged, 3);
  });

  it('con una página indeterminada previa, lo adoptado también cuenta', async () => {
    const { deps } = baseDeps([okPage(1)]);
    const first = await runApolloOrganizationsPaginatedSearch(INPUT, deps);
    const fingerprint = first.requestFingerprint;
    const resumed = await runApolloOrganizationsPaginatedSearch(
      {
        ...INPUT,
        durableResume: {
          succeededPages: [
            { page: 1, requestFingerprint: fingerprint, organizations: [], credits: 1, resultsReturned: 100, totalPages: 50, acceptedCount: null },
          ],
          indeterminatePage: { page: 2, requestFingerprint: fingerprint },
        },
      },
      baseDeps([okPage(1)]).deps,
    );
    assert.equal(resumed.stopReason, 'indeterminate_prior_page_pending_reconciliation');
    assert.equal(resolveApolloPaidResultsVolume(resumed.pageOutcomes).creditsCharged, 1);
  });

  it('5 páginas de 100 organizaciones caben compactadas sin perder la identidad', () => {
    const fullOrg = (id: string) =>
      toApolloPageFenceOrganization({
        ...normalizedOrg(id),
        name: `Empresa Ejemplo SAS ${id.slice(-4)}`,
        primaryDomain: `empresa-${id}.com.co`,
        industry: 'information technology & services',
        industries: ['information technology & services', 'computer software'],
        keywords: Array.from({ length: 10 }, (_, k) => `keyword numero ${k} bastante largo`),
        description: 'x'.repeat(300),
        shortDescription: 'y'.repeat(300),
        seoDescription: 'z'.repeat(300),
      });
    const entries: ApolloPageFenceEntry[] = Array.from({ length: 5 }, (_, page) => ({
      round_number: 1,
      search_plan_fingerprint: 'fp',
      page: page + 1,
      status: 'succeeded',
      organizations: Array.from({ length: 100 }, (_, i) => fullOrg(`5f2a0000000000000000${page}${String(i).padStart(3, '0')}`)),
      credits: 1,
      results_returned: 100,
      total_pages: 50,
      accepted_count: null,
    }));
    const result = compactApolloPageFenceForSize(
      {
        version: APOLLO_PAGE_FENCE_CONTRACT_VERSION,
        fence_version: 1,
        idempotency_key: 'k',
        request_fingerprint: 'f',
        entries,
        compacted: false,
      },
      APOLLO_PAGE_FENCE_MAX_SERIALIZED_BYTES,
    );
    assert.equal(result.withinLimit, true);
    assert.equal(result.document.compacted, true);
    for (const page of result.document.entries) {
      assert.equal(page.organizations.length, 100, 'ninguna página pagada queda vacía');
      for (const org of page.organizations) {
        assert.ok(org.provider_organization_id);
        assert.ok(org.primary_domain, 'el dominio sobrevive a la compactación');
      }
    }
    // Y la forma compactada se rehidrata sin romper.
    const rehydrated = fromApolloPageFenceOrganization(result.document.entries[0]!.organizations[0]!);
    assert.deepEqual(rehydrated.keywords, []);
    assert.equal(rehydrated.description, null);
  });
});

// ─── F4 ───────────────────────────────────────────────────────────────────────

describe('WS6 · F4 — Retry-After acotado', () => {
  it('Retry-After 3600 ⇒ no duerme y termina por presupuesto temporal', async () => {
    const { fence, calls } = recordingFence();
    const { deps, sleeps, sent } = baseDeps([httpError(429, { 'retry-after': '3600' })], { durableFence: fence });
    const result = await runApolloOrganizationsPaginatedSearch(INPUT, deps);
    assert.deepEqual(sleeps, []);
    assert.equal(sent.length, 1);
    assert.equal(result.stopReason, 'time_budget_exhausted');
    assert.ok(calls.some((call) => call.kind === 'onNotCharged'), 'la valla se cierra: no hubo cobro');
  });

  it('Retry-After corto sí se espera y se reintenta', async () => {
    const { deps, sleeps, sent } = baseDeps([httpError(429, { 'retry-after': '2' }), okPage(3)]);
    await runApolloOrganizationsPaginatedSearch(INPUT, deps);
    assert.deepEqual(sleeps.slice(0, 1), [2000]);
    assert.ok(sent.length >= 2);
  });

  it('cuota horaria o diaria agotada ⇒ 429 no reintentable', () => {
    for (const header of ['x-hourly-requests-left', 'x-24-hour-requests-left']) {
      const rateLimit = parseApolloRateLimitHeaders(headersFrom({ [header]: '0', 'retry-after': '60' }), 0);
      const classification = classifyApolloOrganizationsError({ httpStatus: 429, requestSent: true, rateLimit });
      assert.equal(classification.retryable, false);
      assert.equal(classification.terminatesPagination, true);
      assert.equal(classification.billingState, 'not_charged');
    }
  });

  it('cuota por minuto agotada ⇒ sigue reintentable', () => {
    const rateLimit = parseApolloRateLimitHeaders(headersFrom({ 'x-minute-requests-left': '0', 'retry-after': '5' }), 0);
    const classification = classifyApolloOrganizationsError({ httpStatus: 429, requestSent: true, rateLimit });
    assert.equal(classification.retryable, true);
  });
});

// ─── F7 ───────────────────────────────────────────────────────────────────────

describe('WS6 · F7 — fallo terminal tras página cobrada', () => {
  it('página 1 cobrada + 401 en la 2 sin organizaciones adoptables ⇒ credits_used = 1', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    try {
      const rows: LogProviderUsageInput[] = [];
      let calls = 0;
      const deps: ApolloOrgsSearchDeps = {
        fetchPage: async () => {
          calls++;
          // Página 1: sólo filas accounts-only ⇒ cobrada (no vacía) pero sin
          // organizaciones de descubrimiento. Página 2: 401.
          if (calls === 1) {
            return {
              ok: true,
              status: 200,
              requestSent: true,
              malformedBody: false,
              timedOut: false,
              payload: {
                organizations: [],
                accounts: [{ id: 'acc_1', name: 'Cuenta', domain: 'cuenta.com' }],
                pagination: { page: 1, per_page: 100, total_entries: 500, total_pages: 5 },
              },
              headers: headersFrom(),
            };
          }
          return httpError(401);
        },
        logUsage: async (input) => {
          rows.push(input);
          return { kind: 'logged' };
        },
        now: () => 0,
        random: () => 0,
        sleep: async () => undefined,
        recordProviderSeen: async () => ({
          written: false,
          skippedReason: 'test_no_store',
          newIdsRecorded: 0,
          newDomainsRecorded: 0,
          refreshedCount: 0,
        }),
      };
      await runApolloOrganizationsSearch(
        { query: 'software colombia', country: 'Colombia', countryCode: 'CO', industry: 'Tecnología', maxResults: 5, provider: 'apollo_organizations' },
        5,
        undefined,
        deps,
        { netNewTarget: 5, evaluateCandidateAcceptance: () => false },
      );
      const row = rows.find((r) => r.operation_key === 'organizations_search');
      assert.ok(row);
      assert.equal(row.status, 'error');
      assert.equal(row.credits_used, 1, 'el crédito de la página 1 no puede perderse');
      assert.ok((row.estimated_cost_usd ?? 0) > 0);
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    }
  });
});

// ─── F8 ───────────────────────────────────────────────────────────────────────

describe('WS6 · F8 — evaluador de aceptación en lote', () => {
  it('se evalúa cada organización nueva una vez, con concurrencia acotada', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const evaluated: string[] = [];
    const { deps } = baseDeps([okPage(30)], {
      evaluateAcceptance: async (organization) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        evaluated.push(organization.providerReference.providerOrganizationId);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight--;
        return organization.providerReference.providerOrganizationId.endsWith('0');
      },
    });
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...INPUT, budget: createApolloPaginationBudget({ maxPages: 1 }) },
      deps,
    );
    assert.equal(evaluated.length, 30);
    assert.equal(new Set(evaluated).size, 30);
    assert.ok(maxInFlight <= APOLLO_ACCEPTANCE_EVALUATION_CONCURRENCY);
    assert.ok(maxInFlight > 1, 'ya no corre en serie');
    assert.equal(result.acceptedForTargetCount, 3);
  });

  it('un evaluador que lanza cuenta como no aceptado y no detiene la búsqueda', async () => {
    const { deps } = baseDeps([okPage(5)], {
      evaluateAcceptance: async () => {
        throw new Error('db caída');
      },
    });
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...INPUT, budget: createApolloPaginationBudget({ maxPages: 1 }) },
      deps,
    );
    assert.equal(result.acceptedForTargetCount, 0);
    assert.equal(result.organizations.length, 5);
  });
});

// ─── F9 ───────────────────────────────────────────────────────────────────────

describe('WS6 · F9 — 502/504 son cobro desconocido', () => {
  for (const status of [502, 504]) {
    it(`HTTP ${status} ⇒ unknown, sin reintento, valla indeterminada`, async () => {
      const classification = classifyApolloOrganizationsError({ httpStatus: status, requestSent: true });
      assert.equal(classification.billingState, 'unknown');
      assert.equal(classification.retryable, false);

      const { fence, calls } = recordingFence();
      const { deps, sent } = baseDeps([httpError(status)], { durableFence: fence });
      await runApolloOrganizationsPaginatedSearch(INPUT, deps);
      assert.equal(sent.length, 1);
      assert.ok(calls.some((call) => call.kind === 'onIndeterminate'));
      assert.ok(!calls.some((call) => call.kind === 'onNotCharged'));
    });
  }

  it('HTTP 500/503 siguen siendo no cobrados y reintentables', () => {
    for (const status of [500, 503]) {
      const classification = classifyApolloOrganizationsError({ httpStatus: status, requestSent: true });
      assert.equal(classification.billingState, 'not_charged');
      assert.equal(classification.retryable, true);
    }
  });
});
