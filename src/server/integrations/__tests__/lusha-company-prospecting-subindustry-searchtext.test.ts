/**
 * Q3F-5BB.3 — extensión del client de Company Prospecting V3:
 *   - subIndustriesIds y searchText reconocidos como filtros válidos.
 *   - technologies / intentTopics / signals siguen siendo opcionales y ausentes
 *     salvo que se pasen explícitamente (el preview nunca los pasa).
 *   - extracción anidada de país (location.*) y linkedin (socialLinks.linkedin).
 *
 * Sin llamadas reales, sin DB writes, sin créditos. node:test + assert.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { searchLushaCompaniesV3 } from '../lusha-client';

const FAKE_API_KEY = 'test-key-q3f5bb3';
const TIMEOUT_MS = 5000;

type FetchCall = { url: string; method: string; body?: unknown };
let fetchCalls: FetchCall[] = [];
let mockResponse: { ok: boolean; status: number; body: unknown } = { ok: true, status: 200, body: {} };
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
      headers: { get: () => null },
      text: async () => (typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)),
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

describe('Q3F-5BB.3 — subIndustriesIds y searchText como filtros válidos', () => {
  it('acepta un request con SOLO subIndustriesIds (no lo rechaza por "sin filtros")', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });
    const res = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {
        filters: { companies: { include: { subIndustriesIds: [59] } } },
        pagination: { page: 0, size: 10 },
      },
    });
    assert.equal(fetchCalls.length, 1, 'debe hacer la llamada, no rechazar por filtros vacíos');
    assert.equal(res.ok, true);
    const body = fetchCalls[0].body as { filters: { companies: { include: Record<string, unknown> } } };
    assert.deepEqual(body.filters.companies.include.subIndustriesIds, [59]);
  });

  it('acepta un request con SOLO searchText', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });
    const res = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {
        filters: { companies: { include: { searchText: 'telemedicina' } } },
        pagination: { page: 0, size: 10 },
      },
    });
    assert.equal(fetchCalls.length, 1);
    assert.equal(res.ok, true);
    const body = fetchCalls[0].body as { filters: { companies: { include: Record<string, unknown> } } };
    assert.equal(body.filters.companies.include.searchText, 'telemedicina');
  });

  it('searchText en blanco NO cuenta como filtro (rechazo local, sin fetch)', async () => {
    resetMock({ ok: true, status: 200, body: { results: [] } });
    const res = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {
        filters: { companies: { include: { searchText: '   ' } } },
        pagination: { page: 0, size: 10 },
      },
    });
    assert.equal(fetchCalls.length, 0, 'no debe llamar a la API si no hay filtro real');
    assert.equal(res.ok, false);
  });
});

describe('Q3F-5BB.3 — extracción anidada de país y linkedin', () => {
  it('lee country desde location.country y linkedin desde socialLinks.linkedin', async () => {
    resetMock({
      ok: true,
      status: 200,
      body: {
        results: [
          {
            id: 'c1',
            name: 'Nested Co',
            domain: 'nested.com',
            location: { country: 'Colombia', countryIso2: 'CO' },
            socialLinks: { linkedin: 'https://linkedin.com/company/nested' },
            industry: 'Healthcare',
            employeeCount: { exact: 300, min: 201, max: 500 },
          },
        ],
      },
    });
    const res = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {
        filters: { companies: { include: { mainIndustriesIds: [11] } } },
        pagination: { page: 0, size: 10 },
      },
    });
    assert.equal(res.ok, true);
    const company = res.results?.[0];
    assert.ok(company);
    assert.equal(company!.country, 'Colombia');
    assert.equal(company!.countryIso2, 'CO');
    assert.equal(company!.linkedinUrl, 'https://linkedin.com/company/nested');
    assert.equal(company!.employeeCountExact, 300);
  });

  it('respeta el país de nivel raíz cuando viene (retrocompat)', async () => {
    resetMock({
      ok: true,
      status: 200,
      body: { results: [{ id: 'c1', name: 'Flat Co', domain: 'flat.com', country: 'CO', industry: 'Tech', employeeCount: 50 }] },
    });
    const res = await searchLushaCompaniesV3({
      apiKey: FAKE_API_KEY,
      timeoutMs: TIMEOUT_MS,
      request: {
        filters: { companies: { include: { mainIndustriesIds: [17] } } },
        pagination: { page: 0, size: 10 },
      },
    });
    assert.equal(res.results?.[0]?.country, 'CO');
  });
});
