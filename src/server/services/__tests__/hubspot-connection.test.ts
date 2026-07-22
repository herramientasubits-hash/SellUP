// H5.12B — HubSpot connection admin-factory migration, behavioral offline test.
//
// This test NEVER calls the real HubSpot API and NEVER touches a real Supabase Vault,
// a real service-role key, or the database: the ONLY thing mocked is globalThis.fetch,
// and every request is routed by URL:
//   - {SUPABASE_URL}/rest/v1/rpc/upsert_vault_secret             → FAKE Vault store result
//   - {SUPABASE_URL}/rest/v1/rpc/delete_vault_secret             → FAKE Vault delete result
//   - {SUPABASE_URL}/rest/v1/rpc/has_vault_secret                → FAKE existence flag
//   - {SUPABASE_URL}/rest/v1/rpc/get_vault_secret_decrypted      → FAKE Vault value
//   - {SUPABASE_URL}/rest/v1/external_integration_connections    → FAKE PATCH result
//   - https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info → FAKE response
// Any other URL throws, so a real network call would fail the test loudly.
//
// Because only fetch is mocked, the REAL createSupabaseAdminClient() factory and
// its env-guard (getSupabaseServiceRoleEnv) run unchanged — the migration's
// fail-closed behavior is exercised, not stubbed. The default env below is a
// safe, non-production Supabase target so the factory resolves; one group
// deliberately clears the Supabase env to force the fail-closed throw and assert
// that the admin/Vault functions reject with UnsafeSupabaseEnvironmentError
// (the exact ai-connection H5.10B and google-cse-connection H5.11B precedent)
// instead of silently falling back to production or throwing enrichment_configuration_unavailable.
// The H2 static guard (migrated-fallback-guard.test.ts) independently asserts
// the source no longer carries a hardcoded production fallback or the legacy
// enrichment_configuration_unavailable string.
//
// Deliberately fake HubSpot tokens are used. Assertions confirm the token never
// leaks into any testHubSpotConnection result or any error payload.
//
// All cases live under a SINGLE describe so node:test runs them sequentially —
// the fetch mock and its counters are shared module state.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

type HubSpotModule = typeof import('../hubspot-connection');
let storeHubSpotCredential: HubSpotModule['storeHubSpotCredential'];
let removeHubSpotCredential: HubSpotModule['removeHubSpotCredential'];
let hasHubSpotCredential: HubSpotModule['hasHubSpotCredential'];
let testHubSpotConnection: HubSpotModule['testHubSpotConnection'];
let computeHubSpotScopeReadiness: HubSpotModule['computeHubSpotScopeReadiness'];

// Fake, non-real credentials. Never a real HubSpot token, never a Supabase key.
const FAKE_TOKEN = 'hubspot-test-token-abcd1234567890';

const SUPABASE_URL = 'https://fake-local-project.supabase.co';
const RPC_UPSERT = '/rest/v1/rpc/upsert_vault_secret';
const RPC_DELETE = '/rest/v1/rpc/delete_vault_secret';
const RPC_HAS = '/rest/v1/rpc/has_vault_secret';
const RPC_DECRYPTED = '/rest/v1/rpc/get_vault_secret_decrypted';
const CONN_TABLE = '/rest/v1/external_integration_connections';
const HUBSPOT_ORIGIN = 'https://api.hubapi.com';
const HUBSPOT_PATH = '/oauth/v2/private-apps/get/access-token-info';

let origFetch: typeof globalThis.fetch | null = null;
let hubspotCalls = 0;
let prevUrl: string | undefined;
let prevKey: string | undefined;

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
  upsert?: (captured: CapturedRpc) => Response;
  delete?: (captured: CapturedRpc) => Response;
  hasSecret?: (pName: string) => Response;
  vault?: (pName: string) => Response;
  conn?: (captured: CapturedRpc) => Response;
  hubspot?: (url: string, init: RequestInit | undefined) => Response;
}

function parseBody(init: RequestInit | undefined): Record<string, unknown> | undefined {
  if (!init || typeof init.body !== 'string') return undefined;
  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function pNameOf(init: RequestInit | undefined): string {
  const body = parseBody(init);
  return typeof body?.p_name === 'string' ? body.p_name : '';
}

function installFetch(routes: FetchRoutes): void {
  if (!origFetch) origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.includes(RPC_UPSERT)) {
      const captured = { url: u, body: parseBody(init) };
      return (routes.upsert ?? (() => jsonResponse('fake-vault-secret-id')))(captured);
    }
    if (u.includes(RPC_DELETE)) {
      const captured = { url: u, body: parseBody(init) };
      return (routes.delete ?? (() => jsonResponse(null)))(captured);
    }
    if (u.includes(RPC_HAS)) {
      return (routes.hasSecret ?? (() => jsonResponse(false)))(pNameOf(init));
    }
    if (u.includes(RPC_DECRYPTED)) {
      return (routes.vault ?? (() => jsonResponse(null)))(pNameOf(init));
    }
    if (u.includes(CONN_TABLE)) {
      const captured = { url: u, body: parseBody(init) };
      return (routes.conn ?? (() => new Response(null, { status: 204 })))(captured);
    }
    if (u.startsWith(HUBSPOT_ORIGIN)) {
      hubspotCalls += 1;
      if (!routes.hubspot) {
        throw new Error(`HubSpot endpoint hit unexpectedly: ${u}`);
      }
      return routes.hubspot(u, init);
    }
    throw new Error(`Unexpected fetch to a non-mocked URL: ${u}`);
  }) as typeof globalThis.fetch;
}

before(async () => {
  prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key-not-real';

  const mod = await import('../hubspot-connection');
  storeHubSpotCredential = mod.storeHubSpotCredential;
  removeHubSpotCredential = mod.removeHubSpotCredential;
  hasHubSpotCredential = mod.hasHubSpotCredential;
  testHubSpotConnection = mod.testHubSpotConnection;
  computeHubSpotScopeReadiness = mod.computeHubSpotScopeReadiness;
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
  hubspotCalls = 0;
});

describe('hubspot-connection (offline — fake Vault via fetch, mocked fetch, no real HubSpot, no DB writes)', () => {
  // ── computeHubSpotScopeReadiness (pure) ────────────────────────────────────

  it('computeHubSpotScopeReadiness returns correct readiness when required scopes are present', () => {
    const scopes = ['crm.objects.companies.read', 'crm.objects.companies.write'];
    const result = computeHubSpotScopeReadiness(scopes);
    assert.equal(result.canReadCompanies, true);
    assert.equal(result.canWriteCompanies, true);
    assert.equal(result.missingReadScopes.length, 0);
    assert.equal(result.missingWriteScopes.length, 0);
  });

  it('computeHubSpotScopeReadiness detects missing read scope', () => {
    const scopes = ['crm.objects.companies.write'];
    const result = computeHubSpotScopeReadiness(scopes);
    assert.equal(result.canReadCompanies, false);
    assert.equal(result.canWriteCompanies, true);
    assert.equal(result.missingReadScopes.length, 1);
  });

  // ── hasHubSpotCredential ──────────────────────────────────────────────────

  it('hasHubSpotCredential returns true when secret exists', async () => {
    installFetch({ hasSecret: () => jsonResponse(true) });
    assert.equal(await hasHubSpotCredential(), true);
  });

  it('hasHubSpotCredential returns false when secret does not exist', async () => {
    installFetch({ hasSecret: () => jsonResponse(false) });
    assert.equal(await hasHubSpotCredential(), false);
  });

  it('hasHubSpotCredential returns false when the RPC errors', async () => {
    installFetch({ hasSecret: () => jsonResponse({ message: 'boom' }, 400) });
    assert.equal(await hasHubSpotCredential(), false);
  });

  // ── storeHubSpotCredential ────────────────────────────────────────────────

  it('storeHubSpotCredential upserts the token and PATCHes the connection row', async () => {
    let upsertCall: CapturedRpc | undefined;
    let connCall: CapturedRpc | undefined;
    installFetch({
      upsert: (c) => {
        upsertCall = c;
        return jsonResponse('vault-secret-id-123');
      },
      conn: (c) => {
        connCall = c;
        return new Response(null, { status: 204 });
      },
    });

    const result = await storeHubSpotCredential(FAKE_TOKEN);

    assert.equal(result.success, true);
    assert.ok(upsertCall);
    const upsertBody = upsertCall!.body as Record<string, unknown>;
    assert.equal(upsertBody.p_secret, FAKE_TOKEN);
    assert.ok(connCall);
    const connBody = connCall!.body as Record<string, unknown>;
    assert.equal(connBody.credentials_status, 'stored');
    assert.ok(!JSON.stringify(connBody).includes(FAKE_TOKEN));
    assert.equal(hubspotCalls, 0);
  });

  it('storeHubSpotCredential returns VAULT_STORAGE_ERROR when upsert fails', async () => {
    installFetch({ upsert: () => jsonResponse({ message: 'nope' }, 400) });
    const result = await storeHubSpotCredential(FAKE_TOKEN);
    assert.equal(result.success, false);
    assert.equal(result.error, 'VAULT_STORAGE_ERROR');
    assert.ok(!JSON.stringify(result).includes(FAKE_TOKEN));
  });

  // ── removeHubSpotCredential ───────────────────────────────────────────────

  it('removeHubSpotCredential deletes the secret and returns success', async () => {
    installFetch({ delete: () => jsonResponse(null) });
    const result = await removeHubSpotCredential();
    assert.equal(result.success, true);
  });

  it('removeHubSpotCredential returns error when delete fails', async () => {
    installFetch({ delete: () => jsonResponse({ message: 'boom' }, 400) });
    const result = await removeHubSpotCredential();
    assert.equal(result.success, false);
  });

  // ── testHubSpotConnection ─────────────────────────────────────────────────

  it('returns NO_CREDENTIAL when there is no token stored', async () => {
    installFetch({ vault: () => jsonResponse(null) });
    const result = await testHubSpotConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'NO_CREDENTIAL');
    assert.equal(hubspotCalls, 0);
  });

  it('returns success true on a valid 200 response from HubSpot', async () => {
    installFetch({
      vault: () => jsonResponse(FAKE_TOKEN),
      hubspot: () =>
        jsonResponse({
          hubId: 123,
          appId: 456,
          userId: 789,
          scopes: ['crm.objects.companies.read', 'crm.objects.companies.write'],
        }),
    });
    const result = await testHubSpotConnection();
    assert.equal(result.success, true);
    assert.ok(result.tokenInfo);
    assert.equal(result.tokenInfo!.hubId, 123);
    assert.equal(hubspotCalls, 1);
    assert.ok(!JSON.stringify(result).includes(FAKE_TOKEN));
  });

  it('returns INVALID_TOKEN on a 401 response', async () => {
    installFetch({
      vault: () => jsonResponse(FAKE_TOKEN),
      hubspot: () => jsonResponse({}, 401),
    });
    const result = await testHubSpotConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'INVALID_TOKEN');
  });

  it('returns PERMISSION_DENIED on a 403 response', async () => {
    installFetch({
      vault: () => jsonResponse(FAKE_TOKEN),
      hubspot: () => jsonResponse({}, 403),
    });
    const result = await testHubSpotConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'PERMISSION_DENIED');
  });

  it('returns API_ERROR on a 5xx response', async () => {
    installFetch({
      vault: () => jsonResponse(FAKE_TOKEN),
      hubspot: () => jsonResponse({ error: 'upstream' }, 500),
    });
    const result = await testHubSpotConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'API_ERROR');
    assert.ok(result.message?.includes('500'));
  });

  it('returns CONNECTION_ERROR when the HubSpot request rejects', async () => {
    installFetch({
      vault: () => jsonResponse(FAKE_TOKEN),
      hubspot: () => {
        throw new Error('network down');
      },
    });
    const result = await testHubSpotConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'CONNECTION_ERROR');
  });

  it('never surfaces the token in the returned result across any outcome', async () => {
    const scenarios: Array<() => Response> = [
      () =>
        jsonResponse({
          hubId: 123,
          scopes: ['crm.objects.companies.read'],
        }),
      () => jsonResponse({}, 401),
      () => jsonResponse({}, 403),
      () => jsonResponse({}, 500),
    ];

    for (const respond of scenarios) {
      installFetch({
        vault: () => jsonResponse(FAKE_TOKEN),
        hubspot: () => respond(),
      });
      const result = await testHubSpotConnection();
      const serialized = JSON.stringify(result);
      assert.ok(!serialized.includes(FAKE_TOKEN), 'the token must never appear in the result');
      if (origFetch) {
        globalThis.fetch = origFetch;
        origFetch = null;
      }
    }
  });

  // ── Fail-closed: admin/Vault functions reject when the env is unsafe/missing ─

  it('admin/Vault functions reject with UnsafeSupabaseEnvironmentError when env is missing, with no network call', async () => {
    const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    installFetch({});
    const isUnsafe = (err: unknown): boolean =>
      err instanceof Error && err.name === 'UnsafeSupabaseEnvironmentError';
    try {
      await assert.rejects(() => hasHubSpotCredential(), isUnsafe);
      await assert.rejects(() => storeHubSpotCredential(FAKE_TOKEN), isUnsafe);
      await assert.rejects(() => removeHubSpotCredential(), isUnsafe);
      await assert.rejects(() => testHubSpotConnection(), isUnsafe);
      assert.equal(hubspotCalls, 0);
    } finally {
      if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
    }
  });
});
