/**
 * Tests — Lusha Company Prospecting V3 (Q3F-5D / Q3F-5O)
 *
 * Q3F-5N investigó el OpenAPI oficial de Lusha V3 y confirmó el schema
 * anidado correcto para POST /v3/companies/prospecting.
 * Q3F-5O alinea el client con ese schema.
 *
 * Schema anidado confirmado:
 *   filters.companies.include.locations  — objeto { country, state?, city? }
 *   filters.companies.include.sizes      — objeto { min, max }
 *   pagination.page                      — base 0 (OpenAPI oficial)
 *   options.includePartialProfiles       — false por defecto
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

// Helper: filtros válidos con schema anidado oficial (Q3F-5N)
const VALID_FILTERS_COLOMBIA = {
  companies: {
    include: {
      locations: [{ country: 'Colombia' }],
    },
  },
};

const VALID_FILTERS_SIZES = {
  companies: {
    include: {
      sizes: [{ min: 51, max: 200 }],
    },
  },
};

const VALID_FILTERS_COMBINED = {
  companies: {
    include: {
      locations: [{ country: 'Colombia' }],
      sizes: [{ min: 51, max: 200 }],
    },
  },
};

// ============================================================
// searchLushaCompaniesV3 — endpoint correcto
// ============================================================

describe('searchLushaCompaniesV3 — endpoint', () => {
  it('construye URL POST /v3/companies/prospecting', async () => {
    resetMock({ ok: true, status: 200, body: { results: [], total: 0 } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: VALID_FILTERS_COLOMBIA, pagination: { page: 0, size: 10 } },
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
      request: { filters: VALID_FILTERS_COLOMBIA },
    });

    assert.ok(!fetchCalls[0].url.includes('/prospecting/search/companies'),
      'No debe usar endpoint legacy /prospecting/search/companies');
  });

  it('envía pagination con page y size en el body', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: VALID_FILTERS_COLOMBIA, pagination: { page: 2, size: 25 } },
    });

    const body = fetchCalls[0].body as Record<string, unknown>;
    const pagination = body['pagination'] as Record<string, unknown> | undefined;
    assert.ok(pagination !== undefined, 'body debe contener pagination');
    assert.equal(pagination['page'], 2);
    assert.equal(pagination['size'], 25);
  });

  it('envía api_key en headers (no en body)', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: VALID_FILTERS_COLOMBIA, pagination: { page: 0, size: 10 } },
    });

    const body = fetchCalls[0].body as Record<string, unknown>;
    assert.ok(!('api_key' in body), 'api_key no debe ir en el body');
  });
});

// ============================================================
// searchLushaCompaniesV3 — respuesta exitosa
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
      request: { filters: VALID_FILTERS_COLOMBIA },
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
      request: { filters: VALID_FILTERS_COLOMBIA },
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
      request: { filters: VALID_FILTERS_COLOMBIA },
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
      request: { filters: VALID_FILTERS_COLOMBIA },
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
      request: { filters: VALID_FILTERS_COLOMBIA },
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
      request: { filters: VALID_FILTERS_COLOMBIA },
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_auth_error');
  });

  it('HTTP 429 → status=rate_limited', async () => {
    resetMock({ ok: false, status: 429, body: 'Too Many Requests' });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: VALID_FILTERS_COLOMBIA },
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
// Q3F-5O — Schema anidado oficial (OpenAPI confirmado Q3F-5N)
// ============================================================

describe('Q3F-5O — nested filters schema (OpenAPI oficial)', () => {
  it('POST body usa filters.companies.include.sizes (no filters.sizes plano)', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: VALID_FILTERS_SIZES, pagination: { page: 0, size: 10 } },
    });

    const body = fetchCalls[0].body as Record<string, unknown>;
    const filters = body['filters'] as Record<string, unknown>;

    // debe estar anidado
    const companies = filters['companies'] as Record<string, unknown> | undefined;
    assert.ok(companies !== undefined, 'filters.companies debe existir');
    const include = companies['include'] as Record<string, unknown> | undefined;
    assert.ok(include !== undefined, 'filters.companies.include debe existir');
    assert.ok(Array.isArray(include['sizes']), 'filters.companies.include.sizes debe ser array');

    // NO debe estar en nivel raíz
    assert.ok(!('sizes' in filters), 'filters.sizes plano NO debe existir');
  });

  it('POST body usa filters.companies.include.locations (no filters.locations plano)', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: VALID_FILTERS_COLOMBIA, pagination: { page: 0, size: 10 } },
    });

    const body = fetchCalls[0].body as Record<string, unknown>;
    const filters = body['filters'] as Record<string, unknown>;

    const companies = filters['companies'] as Record<string, unknown> | undefined;
    assert.ok(companies !== undefined, 'filters.companies debe existir');
    const include = companies['include'] as Record<string, unknown> | undefined;
    assert.ok(include !== undefined, 'filters.companies.include debe existir');
    assert.ok(Array.isArray(include['locations']), 'filters.companies.include.locations debe ser array');

    // NO debe estar en nivel raíz
    assert.ok(!('locations' in filters), 'filters.locations plano NO debe existir');
  });

  it('locations con { country: "Colombia" } construye body correcto', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {
        filters: { companies: { include: { locations: [{ country: 'Colombia' }] } } },
        pagination: { page: 0, size: 10 },
      },
    });

    const body = fetchCalls[0].body as Record<string, unknown>;
    const filters = body['filters'] as Record<string, unknown>;
    const companies = filters['companies'] as Record<string, unknown>;
    const include = companies['include'] as Record<string, unknown>;
    const locations = include['locations'] as Array<Record<string, unknown>>;
    assert.equal(locations.length, 1);
    assert.equal(locations[0]['country'], 'Colombia');
  });

  it('sizes con { min: 51, max: 200 } construye body correcto', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {
        filters: { companies: { include: { sizes: [{ min: 51, max: 200 }] } } },
        pagination: { page: 0, size: 10 },
      },
    });

    const body = fetchCalls[0].body as Record<string, unknown>;
    const filters = body['filters'] as Record<string, unknown>;
    const companies = filters['companies'] as Record<string, unknown>;
    const include = companies['include'] as Record<string, unknown>;
    const sizes = include['sizes'] as Array<Record<string, unknown>>;
    assert.equal(sizes.length, 1);
    assert.equal(sizes[0]['min'], 51);
    assert.equal(sizes[0]['max'], 200);
  });

  it('locations y sizes combinados construyen body anidado correcto', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: VALID_FILTERS_COMBINED, pagination: { page: 0, size: 10 } },
    });

    const body = fetchCalls[0].body as Record<string, unknown>;
    const filters = body['filters'] as Record<string, unknown>;
    const companies = filters['companies'] as Record<string, unknown>;
    const include = companies['include'] as Record<string, unknown>;
    assert.ok(Array.isArray(include['locations']), 'include.locations debe ser array');
    assert.ok(Array.isArray(include['sizes']), 'include.sizes debe ser array');

    // nivel raíz no contiene localizaciones ni tamaños planos
    assert.ok(!('locations' in filters), 'no debe haber filters.locations plano');
    assert.ok(!('sizes' in filters), 'no debe haber filters.sizes plano');
  });

  it('default pagination.page = 0 cuando pagination no se pasa', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: VALID_FILTERS_COLOMBIA },
    });

    const body = fetchCalls[0].body as Record<string, unknown>;
    const pagination = body['pagination'] as Record<string, unknown>;
    assert.equal(pagination['page'], 0, 'default page debe ser 0 (base 0, OpenAPI oficial)');
  });

  it('default pagination.page = 0 cuando pagination se pasa sin page implícito', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: VALID_FILTERS_COLOMBIA, pagination: { page: 0, size: 10 } },
    });

    const body = fetchCalls[0].body as Record<string, unknown>;
    const pagination = body['pagination'] as Record<string, unknown>;
    assert.equal(pagination['page'], 0);
  });

  it('options.includePartialProfiles = false por defecto en body', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: VALID_FILTERS_COLOMBIA },
    });

    const body = fetchCalls[0].body as Record<string, unknown>;
    const options = body['options'] as Record<string, unknown> | undefined;
    assert.ok(options !== undefined, 'body debe contener options');
    assert.equal(options['includePartialProfiles'], false, 'includePartialProfiles debe ser false por defecto');
  });

  it('options.includePartialProfiles se respeta cuando se pasa explícitamente', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {
        filters: VALID_FILTERS_COLOMBIA,
        options: { includePartialProfiles: true },
      },
    });

    const body = fetchCalls[0].body as Record<string, unknown>;
    const options = body['options'] as Record<string, unknown>;
    assert.equal(options['includePartialProfiles'], true);
  });

  it('pagination.size = 10 válido pasa al API', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: VALID_FILTERS_COLOMBIA, pagination: { page: 0, size: 10 } },
    });

    assert.equal(fetchCalls.length, 1, 'pagination.size=10 debe pasar al API');
  });

  it('pagination.size < 10 bloquea sin fetch', async () => {
    resetMock({ ok: true, status: 200, body: {} });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: VALID_FILTERS_COLOMBIA, pagination: { page: 0, size: 9 } },
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_error');
    assert.equal(fetchCalls.length, 0, 'No debe hacer fetch para size < 10');
    assert.ok(result.errorMessage?.includes('10'));
  });

  it('filters undefined bloquea sin fetch (no filters.companies)', async () => {
    resetMock({ ok: true, status: 200, body: {} });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {},
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_error');
    assert.equal(fetchCalls.length, 0);
    assert.ok(result.errorMessage?.includes('at least one filter'));
  });

  it('filters: {} bloquea sin fetch', async () => {
    resetMock({ ok: true, status: 200, body: {} });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: {} },
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_error');
    assert.equal(fetchCalls.length, 0);
    assert.ok(result.errorMessage?.includes('at least one filter'));
  });

  it('filters.companies sin include ni exclude bloquea sin fetch', async () => {
    resetMock({ ok: true, status: 200, body: {} });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: { companies: {} } },
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_error');
    assert.equal(fetchCalls.length, 0);
  });

  it('filters.companies.include con arrays vacíos bloquea sin fetch', async () => {
    resetMock({ ok: true, status: 200, body: {} });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: { companies: { include: { locations: [], sizes: [] } } } },
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_error');
    assert.equal(fetchCalls.length, 0);
  });

  it('no hay fetch externo real en ningún test de este suite', async () => {
    // Verificar que ninguna llamada sale a dominios no-lusha
    resetMock({ ok: true, status: 200, body: { results: [] } });
    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: VALID_FILTERS_COLOMBIA },
    });
    for (const call of fetchCalls) {
      assert.ok(call.url.startsWith('https://api.lusha.com'), `URL debe ser api.lusha.com. Got: ${call.url}`);
      assert.ok(!call.url.includes('apollo'), 'No debe llamar a Apollo');
    }
  });
});

// ============================================================
// Q3F-5G — Corrección de shape de filters (regresión)
// ============================================================

describe('Q3F-5G — filters shape correction (regresión)', () => {
  it('Q3F-5H: filters:{} es bloqueado localmente sin fetch', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { pagination: { page: 0, size: 10 } },
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_error');
    assert.equal(fetchCalls.length, 0, 'No debe hacer llamada HTTP cuando filters está vacío');
    assert.ok(result.errorMessage?.includes('at least one filter'));
  });

  it('acepta filters con schema anidado sizes', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {
        filters: VALID_FILTERS_SIZES,
        pagination: { page: 0, size: 10 },
      },
    });

    const body = fetchCalls[0].body as Record<string, unknown>;
    const filters = body['filters'] as Record<string, unknown>;
    assert.ok(typeof filters === 'object' && !Array.isArray(filters), 'filters debe ser objeto');
    assert.ok('companies' in filters, 'filters debe tener companies');
  });

  it('NO envía filters como array', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: VALID_FILTERS_SIZES, pagination: { page: 0, size: 10 } },
    });

    const body = fetchCalls[0].body as Record<string, unknown>;
    assert.ok(!Array.isArray(body['filters']), 'filters NO debe ser array — array produce HTTP 400 en Lusha V3');
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
    assert.ok(result.errorMessage?.includes('locations'));
    assert.ok(result.errorMessage?.includes('require query'));
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
    assert.ok(result.errorMessage?.includes('names'));
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
    assert.ok(fetchCalls[0].url.includes('?query=Colombia'));
    assert.ok(fetchCalls[0].url.includes('/filters/locations'));
  });

  it('sizes sin query NO es bloqueado — hace fetch normalmente', async () => {
    resetMock({ ok: true, status: 200, body: { values: ['1-10', '11-50', '51-200'] } });

    const result = await getLushaCompanyProspectingFilterValues({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      filterType: 'sizes',
    });

    assert.equal(fetchCalls.length, 1);
    assert.equal(result.ok, true);
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
      request: { pagination: { page: 0, size: 1 } },
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_error');
    assert.equal(fetchCalls.length, 0, 'No debe hacer llamada HTTP para size < 10');
    assert.ok(result.errorMessage?.includes('10'));
  });

  it('pagination.size = 9 es bloqueado localmente', async () => {
    resetMock({ ok: true, status: 200, body: {} });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { pagination: { page: 0, size: 9 } },
    });

    assert.equal(result.ok, false);
    assert.equal(fetchCalls.length, 0);
  });

  it('pagination.size = 10 con filters válido pasa al API', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: VALID_FILTERS_COLOMBIA, pagination: { page: 0, size: 10 } },
    });

    assert.equal(fetchCalls.length, 1);
  });

  it('requestId null no rompe la respuesta', async () => {
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
      request: { filters: VALID_FILTERS_COLOMBIA, pagination: { page: 0, size: 10 } },
    });

    global.fetch = savedFetch;
    assert.equal(result.ok, true);
    assert.equal(result.requestId, null);
  });
});

// ============================================================
// Q3F-5H — filters vacío rechazado por la API
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
    assert.equal(fetchCalls.length, 0);
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
    assert.equal(fetchCalls.length, 0);
    assert.ok(result.errorMessage?.includes('at least one filter'));
  });

  it('errorMessage menciona "at least one filter" o "cannot be empty"', async () => {
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

  it('filters con locations anidado permite request', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: VALID_FILTERS_COLOMBIA, pagination: { page: 0, size: 10 } },
    });

    assert.equal(fetchCalls.length, 1, 'Debe hacer llamada HTTP con filters válido');
    assert.equal(result.ok, true);
    assert.equal(result.status, 'no_results');
  });

  it('size < 10 sigue bloqueado incluso con filters válido', async () => {
    resetMock({ ok: true, status: 200, body: {} });

    const result = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: { filters: VALID_FILTERS_COLOMBIA, pagination: { page: 0, size: 5 } },
    });

    assert.equal(result.ok, false);
    assert.equal(fetchCalls.length, 0);
    assert.ok(result.errorMessage?.includes('10'));
  });
});

// ============================================================
// Garantías de aislamiento (Q3F-5D / Q3F-5O)
// ============================================================

describe('isolation guarantees — Q3F-5D / Q3F-5O', () => {
  it('no hay llamadas a Apollo en ninguna función V3 de company', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS, request: { filters: VALID_FILTERS_COLOMBIA } });
    await getLushaCompanyProspectingFilters({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS });
    await getLushaCompanyProspectingFilterValues({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS, filterType: 'country' });

    for (const call of fetchCalls) {
      assert.ok(!call.url.includes('apollo'), `No debe llamar a Apollo. URL detectada: ${call.url}`);
    }
  });

  it('todas las URLs son api.lusha.com', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });

    await searchLushaCompaniesV3({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS, request: { filters: VALID_FILTERS_COLOMBIA } });
    await getLushaCompanyProspectingFilters({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS });
    await getLushaCompanyProspectingFilterValues({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS, filterType: 'industry' });

    for (const call of fetchCalls) {
      assert.ok(call.url.startsWith('https://api.lusha.com'), `URL debe ser api.lusha.com. Got: ${call.url}`);
    }
  });

  it('resultsReturned es siempre 0 en respuesta de error', async () => {
    for (const status of [401, 402, 403, 429, 500]) {
      resetMock({ ok: false, status, body: 'error' });
      const result = await searchLushaCompaniesV3({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS, request: { filters: VALID_FILTERS_COLOMBIA } });
      assert.equal(result.resultsReturned, 0, `resultsReturned debe ser 0 para HTTP ${status}`);
    }
  });
});
