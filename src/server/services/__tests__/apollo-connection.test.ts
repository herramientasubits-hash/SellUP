// H5.6 — Apollo connection admin-factory migration, behavioral offline test.
//
// This test NEVER calls the real Apollo API (api.apollo.io) and therefore
// never consumes Apollo credits, and it NEVER touches a real Supabase Vault,
// a real service-role key, or the database: the ONLY thing mocked is
// globalThis.fetch, and every request is routed by URL:
//   - {SUPABASE_URL}/rest/v1/rpc/get_vault_secret_decrypted → FAKE Vault key
//   - {SUPABASE_URL}/rest/v1/rpc/has_vault_secret           → FAKE existence flag
//   - https://api.apollo.io/...                             → FAKE health response
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
// in the X-Api-Key header and never leaks back to the caller in any field.
//
// All cases live under a SINGLE describe so node:test runs them sequentially —
// the fetch mock and its counters are shared module state.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Fake, non-real credential. Never a real Apollo key, never a Supabase key.
const FAKE_VAULT_KEY = 'apollo-test-key-abcd1234';

const SUPABASE_URL = 'https://fake-local-project.supabase.co';
const RPC_DECRYPTED = '/rest/v1/rpc/get_vault_secret_decrypted';
const RPC_HAS = '/rest/v1/rpc/has_vault_secret';
const APOLLO_ORIGIN = 'https://api.apollo.io';

type ApolloModule = typeof import('../apollo-connection');
let testApolloHealth: ApolloModule['testApolloHealth'];
let getApolloApiKey: ApolloModule['getApolloApiKey'];
let hasApolloApiKey: ApolloModule['hasApolloApiKey'];

let origFetch: typeof globalThis.fetch | null = null;
let apolloCalls = 0;
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
  // Apollo health responder. Receives the RequestInit so a test can assert the
  // X-Api-Key header. Absence means the health endpoint should never be hit.
  apollo?: (init: RequestInit | undefined) => Response;
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
    if (u.startsWith(APOLLO_ORIGIN)) {
      apolloCalls += 1;
      if (!routes.apollo) {
        throw new Error(`Apollo endpoint hit unexpectedly: ${u}`);
      }
      return routes.apollo(init);
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

  const mod = await import('../apollo-connection');
  testApolloHealth = mod.testApolloHealth;
  getApolloApiKey = mod.getApolloApiKey;
  hasApolloApiKey = mod.hasApolloApiKey;
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
  apolloCalls = 0;
});

describe('apollo-connection (offline — fake Vault via fetch, mocked fetch, no real Apollo, no DB writes)', () => {
  // ── Vault credential resolution (getApolloApiKey / hasApolloApiKey) ────────

  it('getApolloApiKey returns the decrypted key from Vault', async () => {
    installFetch({ vault: vaultReturnsKey });
    assert.equal(await getApolloApiKey(), FAKE_VAULT_KEY);
  });

  it('getApolloApiKey returns null when Vault has no key (data null)', async () => {
    installFetch({ vault: vaultReturnsNull });
    assert.equal(await getApolloApiKey(), null);
  });

  it('getApolloApiKey returns null when the Vault RPC errors', async () => {
    installFetch({ vault: vaultReturnsError });
    assert.equal(await getApolloApiKey(), null);
  });

  it('hasApolloApiKey returns true when Vault reports the secret exists', async () => {
    installFetch({ hasSecret: () => jsonResponse(true) });
    assert.equal(await hasApolloApiKey(), true);
  });

  it('hasApolloApiKey returns false when Vault reports absence', async () => {
    installFetch({ hasSecret: () => jsonResponse(false) });
    assert.equal(await hasApolloApiKey(), false);
  });

  // ── Connection health check (testApolloHealth) ─────────────────────────────

  it('returns success true on 200 with is_logged_in and sends the key via X-Api-Key', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    installFetch({
      vault: vaultReturnsKey,
      apollo: (init) => {
        capturedInit = init;
        assert.equal(init?.method, 'GET');
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers['X-Api-Key'], FAKE_VAULT_KEY);
        return jsonResponse({ is_logged_in: true });
      },
    });
    // Capture the URL the health check hit via a wrapper.
    const routed = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.startsWith(APOLLO_ORIGIN)) capturedUrl = u;
      return routed(url as never, init);
    }) as typeof globalThis.fetch;

    const result = await testApolloHealth();

    assert.equal(result.success, true);
    assert.equal(result.error, undefined);
    assert.ok(result.message);
    assert.equal(apolloCalls, 1);
    assert.equal(capturedUrl, 'https://api.apollo.io/v1/auth/health');
    // Key travels only in the header — never an Authorization header, never a body.
    const headers = capturedInit?.headers as Record<string, string>;
    assert.ok(!('Authorization' in headers));
    assert.equal(capturedInit?.body, undefined);
  });

  it('returns NO_CREDENTIAL and never calls the Apollo endpoint when Vault has no key', async () => {
    installFetch({ vault: vaultReturnsNull });

    const result = await testApolloHealth();

    assert.equal(result.success, false);
    assert.equal(result.error, 'NO_CREDENTIAL');
    assert.equal(apolloCalls, 0);
  });

  it('returns NO_CREDENTIAL when the Vault RPC errors (never reaches Apollo)', async () => {
    installFetch({ vault: vaultReturnsError });

    const result = await testApolloHealth();

    assert.equal(result.success, false);
    assert.equal(result.error, 'NO_CREDENTIAL');
    assert.equal(apolloCalls, 0);
  });

  it('returns INVALID_API_KEY on 401', async () => {
    installFetch({ vault: vaultReturnsKey, apollo: () => jsonResponse({}, 401) });

    const result = await testApolloHealth();

    assert.equal(result.success, false);
    assert.equal(result.error, 'INVALID_API_KEY');
    assert.ok(result.message);
  });

  it('returns PERMISSION_DENIED on 403', async () => {
    installFetch({ vault: vaultReturnsKey, apollo: () => jsonResponse({}, 403) });

    const result = await testApolloHealth();

    assert.equal(result.success, false);
    assert.equal(result.error, 'PERMISSION_DENIED');
  });

  it('returns API_ERROR on other non-2xx statuses', async () => {
    installFetch({
      vault: vaultReturnsKey,
      apollo: () => new Response('upstream boom', { status: 500 }),
    });

    const result = await testApolloHealth();

    assert.equal(result.success, false);
    assert.equal(result.error, 'API_ERROR');
    assert.ok(result.message?.includes('500'));
  });

  it('returns AUTH_FAILED on 200 when is_logged_in is not true', async () => {
    installFetch({ vault: vaultReturnsKey, apollo: () => jsonResponse({ is_logged_in: false }) });

    const result = await testApolloHealth();

    assert.equal(result.success, false);
    assert.equal(result.error, 'AUTH_FAILED');
  });

  it('returns CONNECTION_ERROR when the Apollo request rejects', async () => {
    installFetch({
      vault: vaultReturnsKey,
      apollo: () => {
        throw new Error('network down');
      },
    });

    const result = await testApolloHealth();

    assert.equal(result.success, false);
    assert.equal(result.error, 'CONNECTION_ERROR');
  });

  it('never surfaces the API key in the returned result across every outcome', async () => {
    const apolloScenarios: Array<() => Response> = [
      () => jsonResponse({ is_logged_in: true }, 200),
      () => jsonResponse({ is_logged_in: false }, 200),
      () => jsonResponse({}, 401),
      () => jsonResponse({}, 403),
      () => new Response('upstream error detail', { status: 500 }),
    ];

    for (const respond of apolloScenarios) {
      installFetch({ vault: vaultReturnsKey, apollo: () => respond() });
      const result = await testApolloHealth();
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
