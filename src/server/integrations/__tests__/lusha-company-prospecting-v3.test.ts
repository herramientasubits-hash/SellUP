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

    // locations valor no confirmado en live — Q3F-5I lo validará
    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: { locations: ['Colombia'] }, pagination: { page: 1, size: 10 } },
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
      request: { filters: { locations: ['Colombia'] } },
    });

    assert.ok(!fetchCalls[0].url.includes('/prospecting/search/companies'),
      'No debe usar endpoint legacy /prospecting/search/companies');
  });

  it('envía pagination con page y size en el body', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: { locations: ['Colombia'] }, pagination: { page: 2, size: 25 } },
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
    // size >= 10 requerido por smoke test Q3F-5E; filters no vacío requerido por Q3F-5H
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: { locations: ['Colombia'] }, pagination: { page: 1, size: 10 } },
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
      request: { filters: { locations: ['Colombia'] } },
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
      request: { filters: { locations: ['Colombia'] } },
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
      request: { filters: { locations: ['Colombia'] } },
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
      request: { filters: { locations: ['Colombia'] } },
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
      request: { filters: { locations: ['Colombia'] } },
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
      request: { filters: { locations: ['Colombia'] } },
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_auth_error');
  });

  it('HTTP 429 → status=rate_limited', async () => {
    resetMock({ ok: false, status: 429, body: 'Too Many Requests' });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: { locations: ['Colombia'] } },
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
// Q3F-5G — Corrección de shape de filters
// ============================================================

describe('Q3F-5G — filters shape correction', () => {
  it('Q3F-5H: filters:{} es bloqueado localmente sin fetch (HTTP 400 observado en smoke test)', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { pagination: { page: 1, size: 10 } }, // sin filters → {} implícito
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_error');
    assert.equal(fetchCalls.length, 0, 'No debe hacer llamada HTTP cuando filters está vacío');
    assert.ok(result.errorMessage?.includes('at least one filter'), 'errorMessage debe mencionar filtro requerido');
  });

  it('acepta filters como objeto { sizes: ["51-200"] }', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {
        filters: { sizes: ['51-200'] },
        pagination: { page: 1, size: 10 },
      },
    });

    const body = fetchCalls[0].body as Record<string, unknown>;
    const filters = body['filters'] as Record<string, unknown>;
    assert.ok(typeof filters === 'object' && !Array.isArray(filters), 'filters debe ser objeto');
    assert.deepEqual(filters['sizes'], ['51-200']);
  });

  it('NO envía filters como array', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: { sizes: ['51-200'] }, pagination: { page: 1, size: 10 } },
    });

    const body = fetchCalls[0].body as Record<string, unknown>;
    assert.ok(!Array.isArray(body['filters']), 'filters NO debe ser array — array produce HTTP 400 en Lusha V3');
  });

  it('filters con múltiples claves se envían correctamente como objeto', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {
        filters: { sizes: ['51-200'], locations: ['Colombia'] },
        pagination: { page: 1, size: 10 },
      },
    });

    const body = fetchCalls[0].body as Record<string, unknown>;
    const filters = body['filters'] as Record<string, unknown>;
    assert.ok(!Array.isArray(filters));
    assert.deepEqual(filters['sizes'], ['51-200']);
    assert.deepEqual(filters['locations'], ['Colombia']);
  });

  it('getLushaCompanyProspectingFilters parsea array directo con filterType/requiresQuery (shape Q3F-5F)', async () => {
    const filterData = [
      { filterType: 'names', requiresQuery: true },
      { filterType: 'sizes', requiresQuery: false },
      { filterType: 'revenues', requiresQuery: false },
      { filterType: 'locations', requiresQuery: true },
      { filterType: 'sics', requiresQuery: false },
    ];
    resetMock({ ok: true, status: 200, body: filterData });

    const result = await getLushaCompanyProspectingFilters({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
    });

    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.availableFilters), 'availableFilters debe ser array para shape Q3F-5F');
    assert.equal(result.availableFilters?.length, 5);
    const first = result.availableFilters?.[0] as Record<string, unknown>;
    assert.equal(first['filterType'], 'names');
    assert.equal(first['requiresQuery'], true);
    const second = result.availableFilters?.[1] as Record<string, unknown>;
    assert.equal(second['filterType'], 'sizes');
    assert.equal(second['requiresQuery'], false);
  });

  it('getLushaCompanyProspectingFilters sigue soportando { availableFilters: [...] } (compatibilidad)', async () => {
    const filterData = { availableFilters: ['country', 'industry'] };
    resetMock({ ok: true, status: 200, body: filterData });

    const result = await getLushaCompanyProspectingFilters({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.availableFilters, filterData.availableFilters);
  });
});

// ============================================================
// Q3F-5J — query param support en getLushaCompanyProspectingFilterValues
// ============================================================

describe('Q3F-5J — filter values con query param', () => {
  it('locations sin query es bloqueado sin fetch', async () => {
    resetMock({ ok: true, status: 200, body: { values: [] } });

    const result = await getLushaCompanyProspectingFilterValues({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      filterType: 'locations',
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_error');
    assert.equal(fetchCalls.length, 0, 'No debe hacer fetch para locations sin query');
    assert.ok(result.errorMessage?.includes('locations'), `errorMessage debe mencionar filterType. Got: ${result.errorMessage}`);
    assert.ok(result.errorMessage?.includes('require query'), `errorMessage debe mencionar require query. Got: ${result.errorMessage}`);
  });

  it('names sin query es bloqueado sin fetch', async () => {
    resetMock({ ok: true, status: 200, body: { values: [] } });

    const result = await getLushaCompanyProspectingFilterValues({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      filterType: 'names',
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_error');
    assert.equal(fetchCalls.length, 0, 'No debe hacer fetch para names sin query');
    assert.ok(result.errorMessage?.includes('names'), `errorMessage debe mencionar filterType. Got: ${result.errorMessage}`);
  });

  it('locations con query="" (vacío) es bloqueado sin fetch', async () => {
    resetMock({ ok: true, status: 200, body: {} });

    const result = await getLushaCompanyProspectingFilterValues({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      filterType: 'locations',
      query: '',
    });

    assert.equal(result.ok, false);
    assert.equal(fetchCalls.length, 0, 'query vacío debe bloquear igual que undefined');
  });

  it('locations con query="Colombia" construye URL con ?query=Colombia', async () => {
    resetMock({ ok: true, status: 200, body: { values: [{ id: 'co', label: 'Colombia' }] } });

    await getLushaCompanyProspectingFilterValues({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      filterType: 'locations',
      query: 'Colombia',
    });

    assert.equal(fetchCalls.length, 1, 'Debe hacer fetch con query proveída');
    assert.ok(fetchCalls[0].url.includes('?query=Colombia'), `URL debe contener ?query=Colombia. Got: ${fetchCalls[0].url}`);
    assert.ok(fetchCalls[0].url.includes('/filters/locations'), `URL debe contener /filters/locations. Got: ${fetchCalls[0].url}`);
  });

  it('query se encodea correctamente para caracteres especiales', async () => {
    resetMock({ ok: true, status: 200, body: {} });

    await getLushaCompanyProspectingFilterValues({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      filterType: 'locations',
      query: 'São Paulo',
    });

    assert.equal(fetchCalls.length, 1);
    const url = fetchCalls[0].url;
    assert.ok(!url.includes('São Paulo'), 'La query sin encodear no debe aparecer en la URL');
    assert.ok(url.includes('query='), 'La URL debe contener el parámetro query');
    // URLSearchParams encodea espacio como + o %20; São → S%C3%A3o
    assert.ok(url.includes('S%C3%A3o') || url.includes('S%c3%a3o'), `"ã" debe estar URL-encoded. Got: ${url}`);
  });

  it('sizes sin query NO es bloqueado — hace fetch normalmente', async () => {
    resetMock({ ok: true, status: 200, body: { values: ['1-10', '11-50', '51-200'] } });

    const result = await getLushaCompanyProspectingFilterValues({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      filterType: 'sizes',
    });

    assert.equal(fetchCalls.length, 1, 'sizes sin query debe pasar al fetch');
    assert.equal(result.ok, true);
    assert.equal(result.status, 'success');
  });

  it('revenues sin query NO es bloqueado — hace fetch normalmente', async () => {
    resetMock({ ok: true, status: 200, body: { values: ['0-1M', '1M-10M'] } });

    await getLushaCompanyProspectingFilterValues({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      filterType: 'revenues',
    });

    assert.equal(fetchCalls.length, 1, 'revenues sin query debe pasar al fetch');
  });

  it('sics sin query NO es bloqueado — hace fetch normalmente', async () => {
    resetMock({ ok: true, status: 200, body: { values: [] } });

    await getLushaCompanyProspectingFilterValues({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      filterType: 'sics',
    });

    assert.equal(fetchCalls.length, 1, 'sics sin query debe pasar al fetch');
  });

  it('sizes con URL no incluye query string vacío', async () => {
    resetMock({ ok: true, status: 200, body: {} });

    await getLushaCompanyProspectingFilterValues({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      filterType: 'sizes',
    });

    const url = fetchCalls[0].url;
    assert.ok(!url.includes('?'), `URL para sizes sin query no debe tener query string. Got: ${url}`);
  });

  it('parser acepta respuesta mockeada de filter values con array de objetos {id, label}', async () => {
    const mockValues = [
      { id: 'co', label: 'Colombia' },
      { id: 'mx', label: 'Mexico' },
    ];
    resetMock({ ok: true, status: 200, body: { values: mockValues } });

    const result = await getLushaCompanyProspectingFilterValues({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      filterType: 'locations',
      query: 'Colombia',
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'success');
    const raw = result.rawFilters as Record<string, unknown>;
    assert.ok(Array.isArray(raw['values']), 'rawFilters debe preservar el array de values');
    assert.equal((raw['values'] as unknown[]).length, 2);
  });

  it('guardrail no hace fetch real — solo llamadas a api.lusha.com', async () => {
    resetMock({ ok: true, status: 200, body: {} });

    // Llamada bloqueada — sin fetch
    await getLushaCompanyProspectingFilterValues({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS, filterType: 'locations' });
    assert.equal(fetchCalls.length, 0);

    // Llamada permitida — fetch a Lusha
    await getLushaCompanyProspectingFilterValues({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS, filterType: 'locations', query: 'Colombia' });
    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.startsWith('https://api.lusha.com'));

    for (const call of fetchCalls) {
      assert.ok(!call.url.includes('apollo'), 'No debe llamar a Apollo');
    }
  });
});

// ============================================================
// Garantías de aislamiento (Q3F-5D)
// ============================================================

describe('isolation guarantees — Q3F-5D', () => {
  it('no hay llamadas a Apollo en ninguna función V3 de company', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS, request: { filters: { locations: ['Colombia'] } } });
    await getLushaCompanyProspectingFilters({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS });
    await getLushaCompanyProspectingFilterValues({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS, filterType: 'country' });

    for (const call of fetchCalls) {
      assert.ok(!call.url.includes('apollo'), `No debe llamar a Apollo. URL detectada: ${call.url}`);
    }
  });

  it('todas las URLs son api.lusha.com', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS, request: { filters: { locations: ['Colombia'] } } });
    await getLushaCompanyProspectingFilters({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS });
    await getLushaCompanyProspectingFilterValues({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS, filterType: 'industry' });

    for (const call of fetchCalls) {
      assert.ok(call.url.startsWith('https://api.lusha.com'), `URL debe ser api.lusha.com. Got: ${call.url}`);
    }
  });

  it('resultsReturned es siempre 0 en respuesta de error', async () => {
    for (const status of [401, 402, 403, 429, 500]) {
      resetMock({ ok: false, status, body: 'error' });
      const result = await searchLushaCompaniesV3({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS, request: { filters: { locations: ['Colombia'] } } });
      assert.equal(result.resultsReturned, 0, `resultsReturned debe ser 0 para HTTP ${status}`);
    }
  });
});

// ============================================================
// Hallazgos reales Q3F-5E smoke test
// ============================================================

describe('Q3F-5E.1 — smoke test findings', () => {
  it('pagination.size < 10 es bloqueado localmente sin llamada HTTP', async () => {
    resetMock({ ok: true, status: 200, body: {} });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { pagination: { page: 1, size: 1 } },
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_error');
    assert.equal(fetchCalls.length, 0, 'No debe hacer llamada HTTP para size < 10');
    assert.ok(result.errorMessage?.includes('10'), 'errorMessage debe mencionar el mínimo 10');
  });

  it('pagination.size = 9 es bloqueado localmente', async () => {
    resetMock({ ok: true, status: 200, body: {} });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { pagination: { page: 1, size: 9 } },
    });

    assert.equal(result.ok, false);
    assert.equal(fetchCalls.length, 0, 'No debe hacer llamada HTTP para size = 9');
  });

  it('pagination.size = 10 con filters no vacío es válido y pasa al API', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: { locations: ['Colombia'] }, pagination: { page: 1, size: 10 } },
    });

    assert.equal(fetchCalls.length, 1, 'Debe hacer llamada HTTP para size = 10 y filters no vacío');
  });

  it('filters con shape { availableFilters: [...] } se parsea en availableFilters', async () => {
    const filterData = { availableFilters: ['country', 'industry', 'employeeCount'] };
    resetMock({ ok: true, status: 200, body: filterData });

    const result = await getLushaCompanyProspectingFilters({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.availableFilters, filterData.availableFilters);
    assert.deepEqual(result.rawFilters, filterData);
  });

  it('filters con shape sin availableFilters deja availableFilters=undefined (defensivo)', async () => {
    resetMock({ ok: true, status: 200, body: { filters: ['country'] } });

    const result = await getLushaCompanyProspectingFilters({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
    });

    assert.equal(result.ok, true);
    assert.equal(result.availableFilters, undefined);
  });

  it('requestId null no rompe la respuesta de searchLushaCompaniesV3', async () => {
    fetchCalls = [];
    const savedFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetchCalls.push({ url, method: init?.method ?? 'GET' });
      return {
        ok: true,
        status: 200,
        headers: { get: (_name: string) => null },
        json: async () => ({ results: [], total: 0 }),
        text: async () => '',
      } as unknown as Response;
    };

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: { locations: ['Colombia'] }, pagination: { page: 1, size: 10 } },
    });

    global.fetch = savedFetch;
    assert.equal(result.ok, true);
    assert.equal(result.requestId, null);
  });

  it('rate limit headers null no rompen la respuesta de searchLushaCompaniesV3 (con filters válido)', async () => {
    fetchCalls = [];
    const savedFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetchCalls.push({ url, method: init?.method ?? 'GET' });
      return {
        ok: true,
        status: 200,
        headers: { get: (_name: string) => null },
        json: async () => ({ results: [], total: 0 }),
        text: async () => '',
      } as unknown as Response;
    };

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: { locations: ['Colombia'] } },
    });

    global.fetch = savedFetch;
    assert.equal(result.ok, true);
    assert.equal(result.rateLimit?.limit, null);
    assert.equal(result.rateLimit?.remaining, null);
    assert.equal(result.rateLimit?.reset, null);
  });
});

// ============================================================
// Q3F-5H — filters vacío rechazado por la API
// Observado en smoke test real: POST con filters:{} → HTTP 400
// "filters.Company filters cannot be empty"
// ============================================================

describe('Q3F-5H — empty filters rejected', () => {
  it('filters undefined es bloqueado localmente sin fetch', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {},
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_error');
    assert.equal(fetchCalls.length, 0, 'No debe hacer llamada HTTP con filters undefined');
    assert.ok(result.errorMessage?.includes('at least one filter'));
  });

  it('filters: {} es bloqueado localmente sin fetch', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: {} },
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_error');
    assert.equal(fetchCalls.length, 0, 'No debe hacer llamada HTTP con filters: {}');
    assert.ok(result.errorMessage?.includes('at least one filter'));
  });

  it('errorMessage menciona "filters.Company filters cannot be empty"', async () => {
    resetMock({ ok: true, status: 200, body: {} });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: {} },
    });

    assert.ok(result.errorMessage !== undefined);
    assert.ok(
      result.errorMessage.includes('at least one filter') || result.errorMessage.includes('cannot be empty'),
      `errorMessage debe describir el error de filtro vacío. Got: ${result.errorMessage}`
    );
  });

  it('filters con locations permite request (valor no confirmado — pendiente Q3F-5I)', async () => {
    // NOTA: "Colombia" es un valor de locations no confirmado en live test.
    // Q3F-5I deberá confirmar los valores válidos antes del próximo POST real.
    resetMock({ ok: true, status: 200, body: { results: [] } });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: { locations: ['Colombia'] }, pagination: { page: 1, size: 10 } },
    });

    assert.equal(fetchCalls.length, 1, 'Debe hacer llamada HTTP con filters no vacío');
    assert.equal(result.ok, true);
    assert.equal(result.status, 'no_results');
  });

  it('size < 10 sigue bloqueado incluso con filters válido', async () => {
    resetMock({ ok: true, status: 200, body: {} });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: { locations: ['Colombia'] }, pagination: { page: 1, size: 5 } },
    });

    assert.equal(result.ok, false);
    assert.equal(fetchCalls.length, 0, 'No debe hacer llamada HTTP para size < 10');
    assert.ok(result.errorMessage?.includes('10'));
  });
});
