/**
 * Tests — getLushaAccountUsage (Agente 2A · 17B.4A)
 *
 * Verifica el health check seguro contra GET /v3/account/usage.
 * No hace llamadas reales. Usa mocks de global.fetch.
 * No consume créditos. No busca personas. No revela PII.
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getLushaAccountUsage } from '../lusha-client';

const FAKE_KEY = 'test-lusha-api-key-not-real';
const USAGE_ENDPOINT = 'https://api.lusha.com/v3/account/usage';

// ── Helpers para mockear global.fetch ──────────────────────────────────────

type FetchMock = (url: string, opts?: RequestInit) => Promise<Response>;

let originalFetch: typeof global.fetch;

function mockFetch(impl: FetchMock) {
  // @ts-expect-error override for tests
  global.fetch = impl;
}

function makeResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  const headersObj = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headersObj,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as unknown as Response;
}

before(() => {
  originalFetch = global.fetch;
});

after(() => {
  global.fetch = originalFetch;
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('getLushaAccountUsage', () => {
  it('retorna success en 200', async () => {
    mockFetch(async () =>
      makeResponse(200, { usage: { credits_remaining: 500 } })
    );

    const result = await getLushaAccountUsage({ apiKey: FAKE_KEY, timeoutMs: 5000 });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'success');
    assert.equal(result.httpStatus, 200);
  });

  it('mapea 401 a provider_auth_error', async () => {
    mockFetch(async () => makeResponse(401, 'Unauthorized'));

    const result = await getLushaAccountUsage({ apiKey: FAKE_KEY, timeoutMs: 5000 });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_auth_error');
    assert.equal(result.httpStatus, 401);
  });

  it('mapea 402 a insufficient_credits', async () => {
    mockFetch(async () => makeResponse(402, 'Payment Required'));

    const result = await getLushaAccountUsage({ apiKey: FAKE_KEY, timeoutMs: 5000 });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'insufficient_credits');
    assert.equal(result.httpStatus, 402);
  });

  it('mapea 429 a rate_limited', async () => {
    mockFetch(async () =>
      makeResponse(429, 'Too Many Requests', { 'x-ratelimit-remaining': '0' })
    );

    const result = await getLushaAccountUsage({ apiKey: FAKE_KEY, timeoutMs: 5000 });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'rate_limited');
    assert.equal(result.httpStatus, 429);
  });

  it('no expone la API key en el resultado', async () => {
    mockFetch(async () => makeResponse(200, { usage: {} }));

    const result = await getLushaAccountUsage({ apiKey: FAKE_KEY, timeoutMs: 5000 });
    const serialized = JSON.stringify(result);

    assert.ok(
      !serialized.includes(FAKE_KEY),
      'El resultado NO debe contener la API key',
    );
  });

  it('usa el endpoint /v3/account/usage', async () => {
    let capturedUrl = '';

    mockFetch(async (url: string) => {
      capturedUrl = url;
      return makeResponse(200, { usage: {} });
    });

    await getLushaAccountUsage({ apiKey: FAKE_KEY, timeoutMs: 5000 });

    assert.equal(capturedUrl, USAGE_ENDPOINT);
  });

  it('captura headers de rate limit cuando están presentes', async () => {
    mockFetch(async () =>
      makeResponse(200, { usage: {} }, {
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': '95',
        'x-ratelimit-reset': '1720000000',
      })
    );

    const result = await getLushaAccountUsage({ apiKey: FAKE_KEY, timeoutMs: 5000 });

    assert.equal(result.ok, true);
    assert.equal(result.rateLimit?.['limit'], '100');
    assert.equal(result.rateLimit?.['remaining'], '95');
  });

  it('retorna provider_timeout cuando AbortController dispara', async () => {
    mockFetch(async (_url: string, opts?: RequestInit) => {
      // Simular abort inmediato
      opts?.signal?.addEventListener('abort', () => {});
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    });

    const result = await getLushaAccountUsage({ apiKey: FAKE_KEY, timeoutMs: 1 });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_timeout');
  });
});
