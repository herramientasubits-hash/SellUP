// H5.8B — Lusha connection admin-factory migration, behavioral offline test.
//
// This test NEVER calls the real Lusha API (api.lusha.com) and therefore never
// touches a real Lusha account or consumes credits, and it NEVER touches a real
// Supabase Vault, a real service-role key, or the database: the ONLY thing
// mocked is globalThis.fetch, and every request is routed by URL:
//   - {SUPABASE_URL}/rest/v1/rpc/get_vault_secret_decrypted → FAKE Vault key
//   - {SUPABASE_URL}/rest/v1/rpc/has_vault_secret           → FAKE existence flag
//   - {SUPABASE_URL}/rest/v1/rpc/upsert_vault_secret        → FAKE store result
//   - {SUPABASE_URL}/rest/v1/rpc/delete_vault_secret        → FAKE delete result
//   - https://api.lusha.com/account/usage                   → FAKE health response
// Any other URL throws, so a real network call would fail the test loudly.
//
// Because only fetch is mocked, the REAL createSupabaseAdminClient() factory and
// its env-guard (getSupabaseServiceRoleEnv) run unchanged — the migration's
// fail-closed behavior is exercised, not stubbed. The default env below is a
// safe, non-production Supabase target so the factory resolves; one case
// deliberately clears the Supabase env to force the fail-closed throw and assert
// that resolveLushaCredential still preserves the LUSHA_API_KEY env fallback.
// The H2 static guard (migrated-fallback-guard.test.ts) independently asserts
// the source no longer carries a hardcoded production fallback.
//
// A deliberately fake API key is used. Assertions confirm the key travels only
// in the "api_key" request header and never leaks back to the caller in any
// field.
//
// All cases live under a SINGLE describe so node:test runs them sequentially —
// the fetch mock and its counters are shared module state.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Fake, non-real credentials. Never a real Lusha key, never a Supabase key.
const FAKE_VAULT_KEY = 'lusha-test-key-abcd1234';
const FAKE_ENV_KEY = 'lusha-env-fallback-key-zzzz9999';

const SUPABASE_URL = 'https://fake-local-project.supabase.co';
const RPC_DECRYPTED = '/rest/v1/rpc/get_vault_secret_decrypted';
const RPC_HAS = '/rest/v1/rpc/has_vault_secret';
const RPC_UPSERT = '/rest/v1/rpc/upsert_vault_secret';
const RPC_DELETE = '/rest/v1/rpc/delete_vault_secret';
const LUSHA_ORIGIN = 'https://api.lusha.com';
const LUSHA_USAGE_URL = 'https://api.lusha.com/account/usage';

type LushaModule = typeof import('../lusha-connection');
let resolveLushaCredential: LushaModule['resolveLushaCredential'];
let getLushaApiKey: LushaModule['getLushaApiKey'];
let hasLushaApiKey: LushaModule['hasLushaApiKey'];
let storeLushaApiKey: LushaModule['storeLushaApiKey'];
let removeLushaApiKey: LushaModule['removeLushaApiKey'];
let testLushaHealth: LushaModule['testLushaHealth'];

let origFetch: typeof globalThis.fetch | null = null;
let lushaCalls = 0;
let prevUrl: string | undefined;
let prevKey: string | undefined;
let prevEnvFallback: string | undefined;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface CapturedRpc {
  url: string;
  body: unknown;
}

interface FetchRoutes {
  // PostgREST returns a scalar function result as the JSON body. null simulates
  // "no secret stored"; a status>=400 simulates a Vault RPC error.
  vault?: () => Response;
  hasSecret?: () => Response;
  upsert?: (captured: CapturedRpc) => Response;
  delete?: (captured: CapturedRpc) => Response;
  // Lusha responder. Receives the RequestInit so a test can assert the api_key
  // header. Absence means the Lusha endpoint should never be hit.
  lusha?: (init: RequestInit | undefined) => Response;
}

function parseBody(init: RequestInit | undefined): unknown {
  if (!init || typeof init.body !== 'string') return undefined;
  try {
    return JSON.parse(init.body);
  } catch {
    return init.body;
  }
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
    if (u.includes(RPC_UPSERT)) {
      const captured = { url: u, body: parseBody(init) };
      return (routes.upsert ?? (() => jsonResponse('fake-vault-secret-id')))(captured);
    }
    if (u.includes(RPC_DELETE)) {
      const captured = { url: u, body: parseBody(init) };
      return (routes.delete ?? (() => jsonResponse(null)))(captured);
    }
    if (u.startsWith(LUSHA_ORIGIN)) {
      lushaCalls += 1;
      if (!routes.lusha) {
        throw new Error(`Lusha endpoint hit unexpectedly: ${u}`);
      }
      return routes.lusha(init);
    }
    throw new Error(`Unexpected fetch to a non-mocked URL: ${u}`);
  }) as typeof globalThis.fetch;
}

// FAKE Vault holding the key.
const vaultReturnsKey = () => jsonResponse(FAKE_VAULT_KEY);
// FAKE Vault with no secret stored.
const vaultReturnsNull = () => jsonResponse(null);

before(async () => {
  // Safe, non-production Supabase env so the fail-closed factory resolves and
  // builds a client. Host is deliberately NOT the production project, and no
  // VERCEL_ENV is set, so resolveSupabaseServiceRoleEnv() succeeds.
  prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  prevEnvFallback = process.env.LUSHA_API_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key-not-real';
  delete process.env.LUSHA_API_KEY;

  const mod = await import('../lusha-connection');
  resolveLushaCredential = mod.resolveLushaCredential;
  getLushaApiKey = mod.getLushaApiKey;
  hasLushaApiKey = mod.hasLushaApiKey;
  storeLushaApiKey = mod.storeLushaApiKey;
  removeLushaApiKey = mod.removeLushaApiKey;
  testLushaHealth = mod.testLushaHealth;
});

after(() => {
  if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
  if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  if (prevEnvFallback === undefined) delete process.env.LUSHA_API_KEY;
  else process.env.LUSHA_API_KEY = prevEnvFallback;
});

afterEach(() => {
  if (origFetch) {
    globalThis.fetch = origFetch;
    origFetch = null;
  }
  lushaCalls = 0;
  delete process.env.LUSHA_API_KEY;
});

describe('lusha-connection (offline — fake Vault via fetch, mocked fetch, no real Lusha, no DB writes)', () => {
  // ── resolveLushaCredential ────────────────────────────────────────────────

  it('resolveLushaCredential returns the Vault key with source "vault"', async () => {
    installFetch({ vault: vaultReturnsKey });
    const res = await resolveLushaCredential();
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.source, 'vault');
      assert.equal(res.apiKey, FAKE_VAULT_KEY);
      assert.equal(res.safe.length, FAKE_VAULT_KEY.length);
      assert.equal(typeof res.safe.fingerprint, 'string');
    }
  });

  it('resolveLushaCredential falls back to LUSHA_API_KEY when Vault has no secret', async () => {
    process.env.LUSHA_API_KEY = FAKE_ENV_KEY;
    installFetch({ vault: vaultReturnsNull });
    const res = await resolveLushaCredential();
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.source, 'env_fallback');
      assert.equal(res.apiKey, FAKE_ENV_KEY);
    }
  });

  it('resolveLushaCredential preserves env fallback when the admin factory fails closed (env unsafe/missing)', async () => {
    // Force createSupabaseAdminClient() to throw UnsafeSupabaseEnvironmentError
    // by removing the Supabase URL, then confirm the LUSHA_API_KEY fallback wins
    // and the stage/source contract is preserved (env_fallback, not env_check).
    const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.LUSHA_API_KEY = FAKE_ENV_KEY;
    // No fetch route needed — the factory throws before any RPC. Install a mock
    // that would loudly fail if any network call were attempted.
    installFetch({});
    try {
      const res = await resolveLushaCredential();
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.source, 'env_fallback');
        assert.equal(res.apiKey, FAKE_ENV_KEY);
      }
    } finally {
      if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
    }
  });

  it('resolveLushaCredential returns ok:false stage "env_check" when factory fails closed and no env fallback', async () => {
    const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.LUSHA_API_KEY;
    installFetch({});
    try {
      const res = await resolveLushaCredential();
      assert.equal(res.ok, false);
      if (!res.ok) assert.equal(res.stage, 'env_check');
    } finally {
      if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
    }
  });

  // ── getLushaApiKey / hasLushaApiKey ────────────────────────────────────────

  it('getLushaApiKey returns the decrypted key from Vault', async () => {
    installFetch({ vault: vaultReturnsKey });
    assert.equal(await getLushaApiKey(), FAKE_VAULT_KEY);
  });

  it('getLushaApiKey returns null when Vault has no key and no env fallback', async () => {
    installFetch({ vault: vaultReturnsNull });
    assert.equal(await getLushaApiKey(), null);
  });

  it('hasLushaApiKey returns true when Vault reports the secret exists', async () => {
    installFetch({ hasSecret: () => jsonResponse(true) });
    assert.equal(await hasLushaApiKey(), true);
  });

  it('hasLushaApiKey returns false when Vault reports absence', async () => {
    installFetch({ hasSecret: () => jsonResponse(false) });
    assert.equal(await hasLushaApiKey(), false);
  });

  it('hasLushaApiKey returns false when the has_vault_secret RPC errors', async () => {
    installFetch({ hasSecret: () => jsonResponse({ message: 'boom' }, 400) });
    assert.equal(await hasLushaApiKey(), false);
  });

  // ── storeLushaApiKey / removeLushaApiKey ───────────────────────────────────

  it('storeLushaApiKey calls the upsert_vault_secret RPC and returns the vault secret id', async () => {
    let captured: CapturedRpc | undefined;
    installFetch({
      upsert: (c) => {
        captured = c;
        return jsonResponse('vault-secret-id-123');
      },
    });

    const result = await storeLushaApiKey(FAKE_VAULT_KEY);

    assert.equal(result.success, true);
    assert.equal(result.vaultSecretId, 'vault-secret-id-123');
    assert.ok(captured);
    assert.ok(captured!.url.includes(RPC_UPSERT));
    // The RPC payload names the Lusha secret; the fake key travels only here.
    const body = captured!.body as Record<string, unknown>;
    assert.equal(body.p_name, 'sellup_prospecting_lusha_api_key');
    assert.equal(body.p_secret, FAKE_VAULT_KEY);
  });

  it('storeLushaApiKey returns a VAULT_STORAGE_ERROR when the RPC errors', async () => {
    installFetch({ upsert: () => jsonResponse({ message: 'nope' }, 400) });
    const result = await storeLushaApiKey(FAKE_VAULT_KEY);
    assert.equal(result.success, false);
    assert.equal(result.error, 'VAULT_STORAGE_ERROR');
  });

  it('removeLushaApiKey calls the delete_vault_secret RPC and succeeds', async () => {
    let captured: CapturedRpc | undefined;
    installFetch({
      delete: (c) => {
        captured = c;
        return jsonResponse(null);
      },
    });

    const result = await removeLushaApiKey();

    assert.equal(result.success, true);
    assert.ok(captured);
    assert.ok(captured!.url.includes(RPC_DELETE));
    const body = captured!.body as Record<string, unknown>;
    assert.equal(body.p_name, 'sellup_prospecting_lusha_api_key');
  });

  // ── testLushaHealth ────────────────────────────────────────────────────────

  it('returns success true on 200 and sends the key only via the api_key header', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    installFetch({
      vault: vaultReturnsKey,
      lusha: (init) => {
        capturedInit = init;
        assert.equal(init?.method, 'GET');
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers['api_key'], FAKE_VAULT_KEY);
        return jsonResponse({ usage: 'ok' });
      },
    });
    const routed = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.startsWith(LUSHA_ORIGIN)) capturedUrl = u;
      return routed(url as never, init);
    }) as typeof globalThis.fetch;

    const result = await testLushaHealth();

    assert.equal(result.success, true);
    assert.equal(result.error, undefined);
    assert.ok(result.message);
    assert.equal(lushaCalls, 1);
    assert.equal(capturedUrl, LUSHA_USAGE_URL);
    // Key travels only in the api_key header — never Authorization, never a body.
    const headers = capturedInit?.headers as Record<string, string>;
    assert.ok(!('Authorization' in headers));
    assert.equal(capturedInit?.body, undefined);
  });

  it('returns success true on 429 (rate limited but key valid)', async () => {
    installFetch({ vault: vaultReturnsKey, lusha: () => jsonResponse({}, 429) });
    const result = await testLushaHealth();
    assert.equal(result.success, true);
  });

  it('returns success via the env fallback key when Vault has no secret', async () => {
    process.env.LUSHA_API_KEY = FAKE_ENV_KEY;
    let sentHeader: string | undefined;
    installFetch({
      vault: vaultReturnsNull,
      lusha: (init) => {
        const headers = init?.headers as Record<string, string>;
        sentHeader = headers['api_key'];
        return jsonResponse({ usage: 'ok' });
      },
    });
    const result = await testLushaHealth();
    assert.equal(result.success, true);
    assert.equal(sentHeader, FAKE_ENV_KEY);
  });

  it('returns NO_CREDENTIAL and never calls Lusha when no Vault key and no env fallback', async () => {
    installFetch({ vault: vaultReturnsNull });
    const result = await testLushaHealth();
    assert.equal(result.success, false);
    assert.equal(result.error, 'NO_CREDENTIAL');
    assert.equal(lushaCalls, 0);
  });

  it('returns INVALID_API_KEY on 400', async () => {
    installFetch({ vault: vaultReturnsKey, lusha: () => jsonResponse({}, 400) });
    const result = await testLushaHealth();
    assert.equal(result.success, false);
    assert.equal(result.error, 'INVALID_API_KEY');
    assert.ok(result.message);
  });

  it('returns INVALID_API_KEY on 401', async () => {
    installFetch({ vault: vaultReturnsKey, lusha: () => jsonResponse({}, 401) });
    const result = await testLushaHealth();
    assert.equal(result.success, false);
    assert.equal(result.error, 'INVALID_API_KEY');
  });

  it('returns PERMISSION_DENIED on 403', async () => {
    installFetch({ vault: vaultReturnsKey, lusha: () => jsonResponse({}, 403) });
    const result = await testLushaHealth();
    assert.equal(result.success, false);
    assert.equal(result.error, 'PERMISSION_DENIED');
  });

  it('returns API_ERROR on other non-2xx statuses and includes the status code', async () => {
    installFetch({
      vault: vaultReturnsKey,
      lusha: () => new Response('upstream boom', { status: 500 }),
    });
    const result = await testLushaHealth();
    assert.equal(result.success, false);
    assert.equal(result.error, 'API_ERROR');
    assert.ok(result.message?.includes('500'));
  });

  it('returns CONNECTION_ERROR when the Lusha request rejects (network error)', async () => {
    installFetch({
      vault: vaultReturnsKey,
      lusha: () => {
        throw new Error('network down');
      },
    });
    const result = await testLushaHealth();
    assert.equal(result.success, false);
    assert.equal(result.error, 'CONNECTION_ERROR');
  });

  it('never surfaces the API key in the returned result across every outcome', async () => {
    const lushaScenarios: Array<() => Response> = [
      () => jsonResponse({ usage: 'ok' }, 200),
      () => jsonResponse({}, 429),
      () => jsonResponse({}, 400),
      () => jsonResponse({}, 401),
      () => jsonResponse({}, 403),
      () => new Response('upstream error detail', { status: 500 }),
    ];

    for (const respond of lushaScenarios) {
      installFetch({ vault: vaultReturnsKey, lusha: () => respond() });
      const result = await testLushaHealth();
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
