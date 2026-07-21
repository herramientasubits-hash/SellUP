// H5.7 — Samu connection admin-factory migration, behavioral offline test.
//
// This test NEVER calls the real Samu API (api.samu.ai) and therefore never
// touches a real Samu account, and it NEVER touches a real Supabase Vault, a
// real service-role key, or the database: the ONLY thing mocked is
// globalThis.fetch, and every request is routed by URL:
//   - {SUPABASE_URL}/rest/v1/rpc/get_vault_secret_decrypted → FAKE Vault key
//   - {SUPABASE_URL}/rest/v1/rpc/has_vault_secret           → FAKE existence flag
//   - https://api.samu.ai/...                               → FAKE users response
// Any other URL throws, so a real network call would fail the test loudly.
//
// Because only fetch is mocked, the REAL createSupabaseAdminClient() factory
// and its env-guard (getSupabaseServiceRoleEnv) run unchanged — the migration's
// fail-closed behavior is exercised, not stubbed. The env below is a safe,
// non-production Supabase target so the factory resolves; the H2 static guard
// (migrated-fallback-guard.test.ts) independently asserts the source no longer
// carries a hardcoded production fallback.
//
// A deliberately fake API key is used. Assertions confirm the key travels only
// in the "apiKey" request header and never leaks back to the caller in any field.
//
// All cases live under a SINGLE describe so node:test runs them sequentially —
// the fetch mock and its counters are shared module state.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Fake, non-real credential. Never a real Samu key, never a Supabase key.
const FAKE_VAULT_KEY = 'samu-test-key-abcd1234';

const SUPABASE_URL = 'https://fake-local-project.supabase.co';
const RPC_DECRYPTED = '/rest/v1/rpc/get_vault_secret_decrypted';
const RPC_HAS = '/rest/v1/rpc/has_vault_secret';
const SAMU_ORIGIN = 'https://api.samu.ai';

type SamuModule = typeof import('../samu-connection');
let testSamuHealth: SamuModule['testSamuHealth'];
let getSamuApiKey: SamuModule['getSamuApiKey'];
let hasSamuApiKey: SamuModule['hasSamuApiKey'];

let origFetch: typeof globalThis.fetch | null = null;
let samuCalls = 0;
let prevUrl: string | undefined;
let prevKey: string | undefined;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface FetchRoutes {
  // PostgREST returns a scalar function result as the JSON body. null simulates
  // "no secret stored"; a status>=400 simulates a Vault RPC error.
  vault?: () => Response;
  hasSecret?: () => Response;
  // Samu responder. Receives the RequestInit so a test can assert the apiKey
  // header. Absence means the Samu endpoint should never be hit.
  samu?: (init: RequestInit | undefined) => Response;
}

function installFetch(routes: FetchRoutes): void {
  if (!origFetch) origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.includes(RPC_DECRYPTED)) {
      return (routes.vault ?? (() => jsonResponse(null)))();
    }
    if (u.includes(RPC_HAS)) {
      return (routes.hasSecret ?? (() => jsonResponse(false)))();
    }
    if (u.startsWith(SAMU_ORIGIN)) {
      samuCalls += 1;
      if (!routes.samu) {
        throw new Error(`Samu endpoint hit unexpectedly: ${u}`);
      }
      return routes.samu(init);
    }
    throw new Error(`Unexpected fetch to a non-mocked URL: ${u}`);
  }) as typeof globalThis.fetch;
}

// FAKE Vault holding the key.
const vaultReturnsKey = () => jsonResponse(FAKE_VAULT_KEY);
// FAKE Vault with no secret stored.
const vaultReturnsNull = () => jsonResponse(null);
// FAKE Vault RPC error.
const vaultReturnsError = () => jsonResponse({ message: 'vault down' }, 400);

before(async () => {
  // Safe, non-production Supabase env so the fail-closed factory resolves and
  // builds a client. Host is deliberately NOT the production project, and no
  // VERCEL_ENV is set, so resolveSupabaseServiceRoleEnv() succeeds.
  prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key-not-real';

  const mod = await import('../samu-connection');
  testSamuHealth = mod.testSamuHealth;
  getSamuApiKey = mod.getSamuApiKey;
  hasSamuApiKey = mod.hasSamuApiKey;
});

after(() => {
  if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
  if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
});

afterEach(() => {
  if (origFetch) {
    globalThis.fetch = origFetch;
    origFetch = null;
  }
  samuCalls = 0;
});

describe('samu-connection (offline — fake Vault via fetch, mocked fetch, no real Samu, no DB writes)', () => {
  // ── Vault credential resolution (getSamuApiKey / hasSamuApiKey) ────────────

  it('getSamuApiKey returns the decrypted key from Vault', async () => {
    installFetch({ vault: vaultReturnsKey });
    assert.equal(await getSamuApiKey(), FAKE_VAULT_KEY);
  });

  it('getSamuApiKey returns null when Vault has no key (data null)', async () => {
    installFetch({ vault: vaultReturnsNull });
    assert.equal(await getSamuApiKey(), null);
  });

  it('getSamuApiKey returns null when the Vault RPC errors', async () => {
    installFetch({ vault: vaultReturnsError });
    assert.equal(await getSamuApiKey(), null);
  });

  it('hasSamuApiKey returns true when Vault reports the secret exists', async () => {
    installFetch({ hasSecret: () => jsonResponse(true) });
    assert.equal(await hasSamuApiKey(), true);
  });

  it('hasSamuApiKey returns false when Vault reports absence', async () => {
    installFetch({ hasSecret: () => jsonResponse(false) });
    assert.equal(await hasSamuApiKey(), false);
  });

  // ── Connection health check (testSamuHealth) ───────────────────────────────

  it('returns success true on 200 with a users array and sends the key via the apiKey header', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    installFetch({
      vault: vaultReturnsKey,
      samu: (init) => {
        capturedInit = init;
        assert.equal(init?.method, 'GET');
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers['apiKey'], FAKE_VAULT_KEY);
        return jsonResponse([{ id: 1 }, { id: 2 }, { id: 3 }]);
      },
    });
    // Capture the URL the health check hit via a wrapper.
    const routed = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.startsWith(SAMU_ORIGIN)) capturedUrl = u;
      return routed(url as never, init);
    }) as typeof globalThis.fetch;

    const result = await testSamuHealth();

    assert.equal(result.success, true);
    assert.equal(result.error, undefined);
    assert.ok(result.message);
    assert.equal(result.userCount, 3);
    assert.equal(samuCalls, 1);
    assert.equal(capturedUrl, 'https://api.samu.ai/api/users');
    // Key travels only in the apiKey header — never an Authorization header, never a body.
    const headers = capturedInit?.headers as Record<string, string>;
    assert.ok(!('Authorization' in headers));
    assert.equal(capturedInit?.body, undefined);
  });

  it('returns success with userCount 0 on 200 when the body is not an array', async () => {
    installFetch({ vault: vaultReturnsKey, samu: () => jsonResponse({ unexpected: 'shape' }) });

    const result = await testSamuHealth();

    assert.equal(result.success, true);
    assert.equal(result.userCount, 0);
  });

  it('returns NO_CREDENTIAL and never calls the Samu endpoint when Vault has no key', async () => {
    installFetch({ vault: vaultReturnsNull });

    const result = await testSamuHealth();

    assert.equal(result.success, false);
    assert.equal(result.error, 'NO_CREDENTIAL');
    assert.equal(samuCalls, 0);
  });

  it('returns NO_CREDENTIAL when the Vault RPC errors (never reaches Samu)', async () => {
    installFetch({ vault: vaultReturnsError });

    const result = await testSamuHealth();

    assert.equal(result.success, false);
    assert.equal(result.error, 'NO_CREDENTIAL');
    assert.equal(samuCalls, 0);
  });

  it('returns INVALID_API_KEY on 401', async () => {
    installFetch({ vault: vaultReturnsKey, samu: () => jsonResponse({}, 401) });

    const result = await testSamuHealth();

    assert.equal(result.success, false);
    assert.equal(result.error, 'INVALID_API_KEY');
    assert.ok(result.message);
  });

  it('returns PERMISSION_DENIED on 403', async () => {
    installFetch({ vault: vaultReturnsKey, samu: () => jsonResponse({}, 403) });

    const result = await testSamuHealth();

    assert.equal(result.success, false);
    assert.equal(result.error, 'PERMISSION_DENIED');
  });

  it('returns API_ERROR on other non-2xx statuses and includes the status code', async () => {
    installFetch({
      vault: vaultReturnsKey,
      samu: () => new Response('upstream boom', { status: 500 }),
    });

    const result = await testSamuHealth();

    assert.equal(result.success, false);
    assert.equal(result.error, 'API_ERROR');
    assert.ok(result.message?.includes('500'));
  });

  it('returns CONNECTION_ERROR when the Samu request rejects', async () => {
    installFetch({
      vault: vaultReturnsKey,
      samu: () => {
        throw new Error('network down');
      },
    });

    const result = await testSamuHealth();

    assert.equal(result.success, false);
    assert.equal(result.error, 'CONNECTION_ERROR');
  });

  it('never surfaces the API key in the returned result across every outcome', async () => {
    const samuScenarios: Array<() => Response> = [
      () => jsonResponse([{ id: 1 }], 200),
      () => jsonResponse({ unexpected: 'shape' }, 200),
      () => jsonResponse({}, 401),
      () => jsonResponse({}, 403),
      () => new Response('upstream error detail', { status: 500 }),
    ];

    for (const respond of samuScenarios) {
      installFetch({ vault: vaultReturnsKey, samu: () => respond() });
      const result = await testSamuHealth();
      assert.ok(
        !JSON.stringify(result).includes(FAKE_VAULT_KEY),
        'the raw API key must never appear in the returned result',
      );
      if (origFetch) {
        globalThis.fetch = origFetch;
        origFetch = null;
      }
    }
  });
});
