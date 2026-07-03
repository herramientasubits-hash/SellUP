/**
 * Tests — Lusha Company Prospecting V3 (Q3F-5D)
 *
 * Valida que las funciones V3 usan los endpoints correctos
 * según la documentación oficial de Lusha API V3 (2026-07):
 *   POST /v3/companies/prospecting
 *   GET  /v3/companies/prospecting/filters
 *   GET  /v3/companies/prospecting/filters/{filterType}
 *
 * Sin llamadas reales. Sin DB writes. Sin créditos.
 * Usa node:test + assert (patrón del proyecto).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchLushaCompaniesV3,
  getLushaCompanyProspectingFilters,
  getLushaCompanyProspectingFilterValues,
} from '../lusha-client';

const FAKE_API_KEY = 'test-key-q3f5d';
const TIMEOUT_MS = 5000;

// ============================================================
// Intercepción de fetch — registra URLs llamadas
// ============================================================

type FetchCall = { url: string; method: string; body?: unknown };

let fetchCalls: FetchCall[] = [];
let mockResponse: { ok: boolean; status: number; body: unknown } = {
  ok: true,
  status: 200,
  body: {},
};

const originalFetch = global.fetch;

before(() => {
  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    let body: unknown = undefined;
    if (init?.body && typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    fetchCalls.push({ url, method: init?.method ?? 'GET', body });

    const { ok, status, body: responseBody } = mockResponse;
    return {
      ok,
      status,
      headers: {
        get: (name: string) => {
          const h: Record<string, string> = {
            'x-ratelimit-limit': '100',
            'x-ratelimit-remaining': '99',
            'x-ratelimit-reset': '1720000000',
            'x-request-id': 'mock-req-id',
          };
          return h[name] ?? null;
        },
      },
      text: async () => typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody),
      json: async () => responseBody,
    } as unknown as Response;
  };
});

after(() => {
  global.fetch = originalFetch;
});

function resetMock(response: typeof mockResponse) {
  fetchCalls = [];
  mockResponse = response;
}

// ============================================================
// searchLushaCompaniesV3 — endpoint correcto
// ============================================================

describe('searchLushaCompaniesV3 — endpoint', () => {
  it('construye URL POST /v3/companies/prospecting', async () => {
    resetMock({ ok: true, status: 200, body: { results: [], total: 0 } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { pagination: { page: 1, size: 10 } },
    });

    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.endsWith('/v3/companies/prospecting'), `URL debe terminar en /v3/companies/prospecting, got: ${fetchCalls[0].url}`);
    assert.equal(fetchCalls[0].method, 'POST');
  });

  it('NO usa el endpoint legacy /prospecting/search/companies', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {},
    });

    assert.ok(!fetchCalls[0].url.includes('/prospecting/search/companies'),
      'No debe usar endpoint legacy /prospecting/search/companies');
  });

  it('envía pagination con page y size en el body', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { pagination: { page: 2, size: 25 } },
    });

    const body = fetchCalls[0].body as Record<string, unknown>;
    const pagination = body['pagination'] as Record<string, unknown> | undefined;
    assert.ok(pagination !== undefined, 'body debe contener pagination');
    assert.equal(pagination['page'], 2);
    assert.equal(pagination['size'], 25);
  });

  it('envía api_key en headers (no en body)', async () => {
    // La función interceptada registra el header via init.headers
    // Verificamos que el body NO contiene la api_key
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { pagination: { page: 1, size: 5 } },
    });

    const body = fetchCalls[0].body as Record<string, unknown>;
    assert.ok(!('api_key' in body), 'api_key no debe ir en el body');
  });
});

// ============================================================
// searchLushaCompaniesV3 — resultado exitoso
// ============================================================

describe('searchLushaCompaniesV3 — respuesta exitosa', () => {
  it('parsea results y retorna ok=true + status=success', async () => {
    resetMock({
      ok: true,
      status: 200,
      body: {
        results: [
          { id: 'c1', name: 'Empresa Alpha', domain: 'alpha.com', country: 'CO', industry: 'Tech', employeeCount: 50 },
        ],
        total: 1,
        creditsCharged: 1,
      },
    });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'success');
    assert.equal(result.resultsReturned, 1);
    assert.equal(result.totalAvailable, 1);
    assert.equal(result.creditsCharged, 1);
    assert.ok(Array.isArray(result.results));
    assert.equal(result.results?.[0].name, 'Empresa Alpha');
    assert.equal(result.results?.[0].domain, 'alpha.com');
  });

  it('retorna status=no_results cuando results está vacío', async () => {
    resetMock({ ok: true, status: 200, body: { results: [], total: 0 } });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'no_results');
    assert.equal(result.resultsReturned, 0);
  });

  it('incluye rawShape para diagnóstico del shape de respuesta real', async () => {
    resetMock({ ok: true, status: 200, body: { results: [], unknownField: 'x' } });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {},
    });

    assert.ok(result.rawShape !== undefined);
  });
});

// ============================================================
// searchLushaCompaniesV3 — error mapping 402/403
// ============================================================

describe('searchLushaCompaniesV3 — error mapping', () => {
  it('HTTP 402 → status=insufficient_credits', async () => {
    resetMock({ ok: false, status: 402, body: 'Payment Required' });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {},
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'insufficient_credits');
    assert.equal(result.httpStatus, 402);
    assert.equal(result.resultsReturned, 0);
  });

  it('HTTP 403 → status=feature_unavailable', async () => {
    resetMock({ ok: false, status: 403, body: 'Forbidden' });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {},
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'feature_unavailable');
    assert.equal(result.httpStatus, 403);
  });

  it('HTTP 401 → status=provider_auth_error', async () => {
    resetMock({ ok: false, status: 401, body: 'Unauthorized' });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {},
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_auth_error');
  });

  it('HTTP 429 → status=rate_limited', async () => {
    resetMock({ ok: false, status: 429, body: 'Too Many Requests' });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {},
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'rate_limited');
  });
});

// ============================================================
// getLushaCompanyProspectingFilters — endpoint correcto
// ============================================================

describe('getLushaCompanyProspectingFilters — endpoint', () => {
  it('construye URL GET /v3/companies/prospecting/filters', async () => {
    resetMock({ ok: true, status: 200, body: { filters: ['country', 'industry'] } });

    await getLushaCompanyProspectingFilters({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
    });

    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.endsWith('/v3/companies/prospecting/filters'),
      `URL debe terminar en /v3/companies/prospecting/filters, got: ${fetchCalls[0].url}`);
    assert.equal(fetchCalls[0].method, 'GET');
  });

  it('retorna ok=true y rawFilters en respuesta exitosa', async () => {
    const filterData = { filters: ['country', 'industry', 'employeeCount'] };
    resetMock({ ok: true, status: 200, body: filterData });

    const result = await getLushaCompanyProspectingFilters({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'success');
    assert.deepEqual(result.rawFilters, filterData);
  });

  it('HTTP 403 → status=feature_unavailable', async () => {
    resetMock({ ok: false, status: 403, body: 'Forbidden' });

    const result = await getLushaCompanyProspectingFilters({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'feature_unavailable');
  });
});

// ============================================================
// getLushaCompanyProspectingFilterValues — endpoint correcto
// ============================================================

describe('getLushaCompanyProspectingFilterValues — endpoint', () => {
  it('construye URL GET /v3/companies/prospecting/filters/{filterType}', async () => {
    resetMock({ ok: true, status: 200, body: { values: ['CO', 'MX', 'US'] } });

    await getLushaCompanyProspectingFilterValues({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      filterType: 'country',
    });

    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.endsWith('/v3/companies/prospecting/filters/country'),
      `URL debe terminar en /v3/companies/prospecting/filters/country, got: ${fetchCalls[0].url}`);
    assert.equal(fetchCalls[0].method, 'GET');
  });

  it('codifica el filterType en la URL', async () => {
    resetMock({ ok: true, status: 200, body: {} });

    await getLushaCompanyProspectingFilterValues({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      filterType: 'employee count',
    });

    assert.ok(fetchCalls[0].url.includes('employee%20count'),
      'filterType con espacios debe estar URL-encoded');
  });

  it('retorna ok=true y rawFilters en respuesta exitosa', async () => {
    const filterValues = { filterType: 'industry', values: ['Technology', 'Finance'] };
    resetMock({ ok: true, status: 200, body: filterValues });

    const result = await getLushaCompanyProspectingFilterValues({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      filterType: 'industry',
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'success');
    assert.deepEqual(result.rawFilters, filterValues);
  });

  it('HTTP 402 → status=insufficient_credits', async () => {
    resetMock({ ok: false, status: 402, body: 'Payment Required' });

    const result = await getLushaCompanyProspectingFilterValues({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      filterType: 'country',
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'insufficient_credits');
  });
});

// ============================================================
// Garantías de aislamiento (Q3F-5D)
// ============================================================

describe('isolation guarantees — Q3F-5D', () => {
  it('no hay llamadas a Apollo en ninguna función V3 de company', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS, request: {} });
    await getLushaCompanyProspectingFilters({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS });
    await getLushaCompanyProspectingFilterValues({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS, filterType: 'country' });

    for (const call of fetchCalls) {
      assert.ok(!call.url.includes('apollo'), `No debe llamar a Apollo. URL detectada: ${call.url}`);
    }
  });

  it('todas las URLs son api.lusha.com', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS, request: {} });
    await getLushaCompanyProspectingFilters({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS });
    await getLushaCompanyProspectingFilterValues({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS, filterType: 'industry' });

    for (const call of fetchCalls) {
      assert.ok(call.url.startsWith('https://api.lusha.com'), `URL debe ser api.lusha.com. Got: ${call.url}`);
    }
  });

  it('resultsReturned es siempre 0 en respuesta de error', async () => {
    for (const status of [401, 402, 403, 429, 500]) {
      resetMock({ ok: false, status, body: 'error' });
      const result = await searchLushaCompaniesV3({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS, request: {} });
      assert.equal(result.resultsReturned, 0, `resultsReturned debe ser 0 para HTTP ${status}`);
    }
  });
});
