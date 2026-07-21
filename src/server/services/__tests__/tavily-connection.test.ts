// H5.5 — Tavily connection admin-factory migration, behavioral offline test.
//
// This test NEVER calls the real Tavily API (api.tavily.com) and therefore
// never consumes Tavily credits: globalThis.fetch is mocked for every case.
// It also never touches a real Supabase Vault or a real service-role key:
// getTavilyApiKey() resolves the credential from the process.env.TAVILY_API_KEY
// non-production fallback (createSupabaseAdminClient() fails closed in the test
// environment and is caught), so no Supabase module mock is required.
//
// A deliberately fake API key is used. The assertions confirm the key is sent
// via the Authorization: Bearer header and is never leaked back to the caller
// in messages or any returned field.

import { describe, it, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testTavilyConnection } from '../tavily-connection';

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Fake, non-real credential. Never a real Tavily key, never a Supabase key.
const TEST_KEY = 'tvly-test-key-abcd1234';

before(() => {
  process.env.TAVILY_API_KEY = TEST_KEY;
});

after(() => {
  delete process.env.TAVILY_API_KEY;
  mock.restoreAll();
});

describe('testTavilyConnection (offline, mocked fetch — no real Tavily calls, no credits)', () => {
  it('returns success true on 200 with a results payload', async () => {
    mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      assert.equal(init.method, 'POST');
      const headers = init.headers as Record<string, string>;
      assert.equal(headers['Content-Type'], 'application/json');
      // Key travels in the Authorization: Bearer header, using the Bearer scheme.
      assert.equal(headers.Authorization, `Bearer ${TEST_KEY}`);
      assert.ok(headers.Authorization.startsWith('Bearer '));
      const body = JSON.parse(init.body as string);
      assert.equal(body.max_results, 1);
      return makeJsonResponse({ results: [{ title: 'x', url: 'https://example.com' }] });
    });

    const result = await testTavilyConnection();

    assert.equal(result.success, true);
    assert.equal(result.error, undefined);
    assert.ok(result.message);
    assert.equal(result.resultsCount, 1);
    assert.ok(result.responseTimeMs !== undefined);
  });

  it('sends a POST request to the correct Tavily endpoint', async () => {
    let capturedUrl: string | undefined;
    mock.method(globalThis, 'fetch', async (url: string) => {
      capturedUrl = url;
      return makeJsonResponse({ results: [] });
    });

    await testTavilyConnection();

    assert.equal(capturedUrl, 'https://api.tavily.com/search');
  });

  it('returns INVALID_API_KEY on 401', async () => {
    mock.method(globalThis, 'fetch', async () => makeJsonResponse({}, 401));

    const result = await testTavilyConnection();

    assert.equal(result.success, false);
    assert.equal(result.error, 'INVALID_API_KEY');
    assert.ok(result.message);
  });

  it('returns PERMISSION_DENIED on 403', async () => {
    mock.method(globalThis, 'fetch', async () => makeJsonResponse({}, 403));

    const result = await testTavilyConnection();

    assert.equal(result.success, false);
    assert.equal(result.error, 'PERMISSION_DENIED');
  });

  it('returns RATE_LIMIT on 429', async () => {
    mock.method(globalThis, 'fetch', async () => makeJsonResponse({}, 429));

    const result = await testTavilyConnection();

    assert.equal(result.success, false);
    assert.equal(result.error, 'RATE_LIMIT');
  });

  it('returns API_ERROR on other non-2xx statuses', async () => {
    mock.method(globalThis, 'fetch', async () =>
      new Response('upstream boom', { status: 500 }),
    );

    const result = await testTavilyConnection();

    assert.equal(result.success, false);
    assert.equal(result.error, 'API_ERROR');
  });

  it('returns CONNECTION_ERROR when fetch rejects', async () => {
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('network down');
    });

    const result = await testTavilyConnection();

    assert.equal(result.success, false);
    assert.equal(result.error, 'CONNECTION_ERROR');
  });

  it('returns NO_CREDENTIAL and never calls fetch when no key is configured', async () => {
    const previous = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;

    let fetchCalls = 0;
    mock.method(globalThis, 'fetch', async () => {
      fetchCalls += 1;
      return makeJsonResponse({ results: [] });
    });

    const result = await testTavilyConnection();

    assert.equal(result.success, false);
    assert.equal(result.error, 'NO_CREDENTIAL');
    assert.equal(fetchCalls, 0);

    process.env.TAVILY_API_KEY = previous;
  });

  it('never surfaces the API key in the returned result across every outcome', async () => {
    const scenarios: Array<() => Response> = [
      () => makeJsonResponse({ results: [{ title: 'ok' }] }, 200),
      () => makeJsonResponse({}, 401),
      () => makeJsonResponse({}, 403),
      () => makeJsonResponse({}, 429),
      () => new Response('upstream error detail', { status: 500 }),
    ];

    for (const respond of scenarios) {
      mock.method(globalThis, 'fetch', async () => respond());
      const result = await testTavilyConnection();
      assert.ok(
        !JSON.stringify(result).includes(TEST_KEY),
        'the raw API key must never appear in the returned result',
      );
      mock.restoreAll();
    }
  });

  it('sends the key only via the Authorization header, never in the request body', async () => {
    let capturedInit: RequestInit | undefined;
    mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      capturedInit = init;
      return makeJsonResponse({ results: [] });
    });

    await testTavilyConnection();

    const headers = capturedInit?.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Bearer ${TEST_KEY}`);
    assert.ok(!(capturedInit!.body as string).includes(TEST_KEY));
  });
});
