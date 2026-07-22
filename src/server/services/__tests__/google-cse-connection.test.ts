// H5.11B — Google CSE connection admin-factory migration, behavioral offline test.
//
// This test NEVER calls the real Google Custom Search JSON API
// (www.googleapis.com/customsearch/v1) and therefore never consumes the free
// daily quota, and it NEVER touches a real Supabase Vault, a real service-role
// key, or the database: the ONLY thing mocked is globalThis.fetch, and every
// request is routed by URL:
//   - {SUPABASE_URL}/rest/v1/rpc/get_vault_secret_decrypted     → FAKE Vault value
//   - {SUPABASE_URL}/rest/v1/rpc/has_vault_secret               → FAKE existence flag
//   - {SUPABASE_URL}/rest/v1/rpc/upsert_vault_secret            → FAKE store result
//   - {SUPABASE_URL}/rest/v1/rpc/delete_vault_secret            → FAKE delete result
//   - {SUPABASE_URL}/rest/v1/external_integration_connections   → FAKE PATCH result
//   - https://www.googleapis.com/customsearch/v1                → FAKE search response
// Any other URL throws, so a real network call would fail the test loudly.
//
// Because only fetch is mocked, the REAL createSupabaseAdminClient() factory and
// its env-guard (getSupabaseServiceRoleEnv) run unchanged — the migration's
// fail-closed behavior is exercised, not stubbed. The default env below is a
// safe, non-production Supabase target so the factory resolves; one group
// deliberately clears the Supabase env to force the fail-closed throw and assert
// that the admin/Vault functions reject with UnsafeSupabaseEnvironmentError
// (the exact ai-connection H5.10B precedent) instead of silently falling back to
// production. The H2 static guard (migrated-fallback-guard.test.ts) independently
// asserts the source no longer carries a hardcoded production fallback or the
// legacy enrichment_configuration_unavailable string.
//
// Deliberately fake credentials are used. Assertions confirm the key/cx never
// leak into any testGoogleCSEConnection result or any error payload.
//
// All cases live under a SINGLE describe so node:test runs them sequentially —
// the fetch mock and its counters are shared module state.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  GOOGLE_CSE_API_KEY_VAULT_NAME,
  GOOGLE_CSE_CX_VAULT_NAME,
} from '../google-cse-connection';

// Fake, non-real credentials. Never a real Google CSE key/cx, never a Supabase key.
const FAKE_API_KEY = 'google-cse-test-key-abcd1234';
const FAKE_CX = 'google-cse-test-cx-wxyz6789';
const FAKE_ENV_API_KEY = 'google-cse-env-key-zzzz0000';
const FAKE_ENV_CX = 'google-cse-env-cx-yyyy1111';

const SUPABASE_URL = 'https://fake-local-project.supabase.co';
const RPC_DECRYPTED = '/rest/v1/rpc/get_vault_secret_decrypted';
const RPC_HAS = '/rest/v1/rpc/has_vault_secret';
const RPC_UPSERT = '/rest/v1/rpc/upsert_vault_secret';
const RPC_DELETE = '/rest/v1/rpc/delete_vault_secret';
const CONN_TABLE = '/rest/v1/external_integration_connections';
const GOOGLE_ORIGIN = 'https://www.googleapis.com';
const GOOGLE_CSE_PATH = '/customsearch/v1';

type CseModule = typeof import('../google-cse-connection');
let storeGoogleCSECredentials: CseModule['storeGoogleCSECredentials'];
let removeGoogleCSECredentials: CseModule['removeGoogleCSECredentials'];
let hasGoogleCSECredentials: CseModule['hasGoogleCSECredentials'];
let getGoogleCSECredentials: CseModule['getGoogleCSECredentials'];
let testGoogleCSEConnection: CseModule['testGoogleCSEConnection'];
let maskGoogleCSECx: CseModule['maskGoogleCSECx'];

let origFetch: typeof globalThis.fetch | null = null;
let googleCalls = 0;
let prevUrl: string | undefined;
let prevKey: string | undefined;
let prevEnvApiKey: string | undefined;
let prevEnvCx: string | undefined;

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
  // PostgREST returns a scalar function result as the JSON body. Receives the
  // p_name so a route can return a different value per secret. null simulates
  // "no secret stored"; a status>=400 simulates a Vault RPC error.
  vault?: (pName: string) => Response;
  hasSecret?: (pName: string) => Response;
  upsert?: (captured: CapturedRpc) => Response;
  delete?: (captured: CapturedRpc) => Response;
  // external_integration_connections PATCH. Absence uses a 204 no-op default.
  conn?: (captured: CapturedRpc) => Response;
  // Google CSE responder. Receives the RequestInit. Absence means the Google
  // endpoint should never be hit (a hit throws, failing the test loudly).
  google?: (url: string, init: RequestInit | undefined) => Response;
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
    if (u.includes(RPC_DECRYPTED)) {
      return (routes.vault ?? (() => jsonResponse(null)))(pNameOf(init));
    }
    if (u.includes(RPC_HAS)) {
      return (routes.hasSecret ?? (() => jsonResponse(false)))(pNameOf(init));
    }
    if (u.includes(RPC_UPSERT)) {
      const captured = { url: u, body: parseBody(init) };
      return (routes.upsert ?? (() => jsonResponse('fake-vault-secret-id')))(captured);
    }
    if (u.includes(RPC_DELETE)) {
      const captured = { url: u, body: parseBody(init) };
      return (routes.delete ?? (() => jsonResponse(null)))(captured);
    }
    if (u.includes(CONN_TABLE)) {
      const captured = { url: u, body: parseBody(init) };
      return (routes.conn ?? (() => new Response(null, { status: 204 })))(captured);
    }
    if (u.startsWith(GOOGLE_ORIGIN)) {
      googleCalls += 1;
      if (!routes.google) {
        throw new Error(`Google CSE endpoint hit unexpectedly: ${u}`);
      }
      return routes.google(u, init);
    }
    throw new Error(`Unexpected fetch to a non-mocked URL: ${u}`);
  }) as typeof globalThis.fetch;
}

// FAKE Vault holding both secrets, keyed by p_name.
const vaultReturnsBoth = (pName: string): Response => {
  if (pName === GOOGLE_CSE_API_KEY_VAULT_NAME) return jsonResponse(FAKE_API_KEY);
  if (pName === GOOGLE_CSE_CX_VAULT_NAME) return jsonResponse(FAKE_CX);
  return jsonResponse(null);
};
// FAKE Vault with nothing stored.
const vaultReturnsNull = (): Response => jsonResponse(null);

before(async () => {
  // Safe, non-production Supabase env so the fail-closed factory resolves and
  // builds a client. Host is deliberately NOT the production project, and no
  // VERCEL_ENV is set, so resolveSupabaseServiceRoleEnv() succeeds.
  prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  prevEnvApiKey = process.env.GOOGLE_CSE_API_KEY;
  prevEnvCx = process.env.GOOGLE_CSE_CX;
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key-not-real';
  delete process.env.GOOGLE_CSE_API_KEY;
  delete process.env.GOOGLE_CSE_CX;

  const mod = await import('../google-cse-connection');
  storeGoogleCSECredentials = mod.storeGoogleCSECredentials;
  removeGoogleCSECredentials = mod.removeGoogleCSECredentials;
  hasGoogleCSECredentials = mod.hasGoogleCSECredentials;
  getGoogleCSECredentials = mod.getGoogleCSECredentials;
  testGoogleCSEConnection = mod.testGoogleCSEConnection;
  maskGoogleCSECx = mod.maskGoogleCSECx;
});

after(() => {
  if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
  if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  if (prevEnvApiKey === undefined) delete process.env.GOOGLE_CSE_API_KEY;
  else process.env.GOOGLE_CSE_API_KEY = prevEnvApiKey;
  if (prevEnvCx === undefined) delete process.env.GOOGLE_CSE_CX;
  else process.env.GOOGLE_CSE_CX = prevEnvCx;
});

afterEach(() => {
  if (origFetch) {
    globalThis.fetch = origFetch;
    origFetch = null;
  }
  googleCalls = 0;
  delete process.env.GOOGLE_CSE_API_KEY;
  delete process.env.GOOGLE_CSE_CX;
});

describe('google-cse-connection (offline — fake Vault via fetch, mocked fetch, no real Google CSE, no DB writes)', () => {
  // ── hasGoogleCSECredentials ───────────────────────────────────────────────

  it('hasGoogleCSECredentials returns true when both secrets exist', async () => {
    installFetch({ hasSecret: () => jsonResponse(true) });
    assert.equal(await hasGoogleCSECredentials(), true);
  });

  it('hasGoogleCSECredentials returns false when the API key is missing', async () => {
    installFetch({
      hasSecret: (pName) =>
        jsonResponse(pName === GOOGLE_CSE_API_KEY_VAULT_NAME ? false : true),
    });
    assert.equal(await hasGoogleCSECredentials(), false);
  });

  it('hasGoogleCSECredentials returns false when the cx is missing', async () => {
    installFetch({
      hasSecret: (pName) =>
        jsonResponse(pName === GOOGLE_CSE_CX_VAULT_NAME ? false : true),
    });
    assert.equal(await hasGoogleCSECredentials(), false);
  });

  it('hasGoogleCSECredentials returns false when the has_vault_secret RPC errors', async () => {
    installFetch({ hasSecret: () => jsonResponse({ message: 'boom' }, 400) });
    assert.equal(await hasGoogleCSECredentials(), false);
  });

  // ── getGoogleCSECredentials ───────────────────────────────────────────────

  it('getGoogleCSECredentials returns { apiKey, cx } from Vault', async () => {
    installFetch({ vault: vaultReturnsBoth });
    const creds = await getGoogleCSECredentials();
    assert.deepEqual(creds, { apiKey: FAKE_API_KEY, cx: FAKE_CX });
  });

  it('getGoogleCSECredentials returns null when only one secret is present (no env fallback)', async () => {
    installFetch({
      vault: (pName) =>
        pName === GOOGLE_CSE_API_KEY_VAULT_NAME ? jsonResponse(FAKE_API_KEY) : jsonResponse(null),
    });
    assert.equal(await getGoogleCSECredentials(), null);
  });

  it('getGoogleCSECredentials returns null when the get_vault_secret_decrypted RPC errors (no env fallback)', async () => {
    installFetch({ vault: () => jsonResponse({ message: 'boom' }, 400) });
    assert.equal(await getGoogleCSECredentials(), null);
  });

  it('getGoogleCSECredentials falls back to GOOGLE_CSE_API_KEY/CX env in non-production when Vault is empty', async () => {
    process.env.GOOGLE_CSE_API_KEY = FAKE_ENV_API_KEY;
    process.env.GOOGLE_CSE_CX = FAKE_ENV_CX;
    installFetch({ vault: vaultReturnsNull });
    const creds = await getGoogleCSECredentials();
    assert.deepEqual(creds, { apiKey: FAKE_ENV_API_KEY, cx: FAKE_ENV_CX });
    assert.equal(googleCalls, 0);
  });

  it('getGoogleCSECredentials does NOT use the env fallback in production', async () => {
    // NODE_ENV is typed read-only, so mutate via a plain-record view. It is a
    // normal writable property at runtime; the service reads it at call time.
    const mutableEnv = process.env as Record<string, string | undefined>;
    const savedNodeEnv = mutableEnv.NODE_ENV;
    process.env.GOOGLE_CSE_API_KEY = FAKE_ENV_API_KEY;
    process.env.GOOGLE_CSE_CX = FAKE_ENV_CX;
    mutableEnv.NODE_ENV = 'production';
    installFetch({ vault: vaultReturnsNull });
    try {
      assert.equal(await getGoogleCSECredentials(), null);
    } finally {
      if (savedNodeEnv === undefined) delete mutableEnv.NODE_ENV;
      else mutableEnv.NODE_ENV = savedNodeEnv;
    }
  });

  // ── storeGoogleCSECredentials ─────────────────────────────────────────────

  it('storeGoogleCSECredentials upserts both secrets, PATCHes the connection row, and returns success', async () => {
    const upserts: CapturedRpc[] = [];
    let connCall: CapturedRpc | undefined;
    installFetch({
      upsert: (c) => {
        upserts.push(c);
        return jsonResponse('vault-secret-id-123');
      },
      conn: (c) => {
        connCall = c;
        return new Response(null, { status: 204 });
      },
    });

    const result = await storeGoogleCSECredentials(FAKE_API_KEY, FAKE_CX);

    assert.equal(result.success, true);
    // Two upserts: one per secret, carrying the fake value only in the RPC body.
    assert.equal(upserts.length, 2);
    const byName = new Map(
      upserts.map((c) => {
        const b = c.body as Record<string, unknown>;
        return [b.p_name as string, b.p_secret as string];
      }),
    );
    assert.equal(byName.get(GOOGLE_CSE_API_KEY_VAULT_NAME), FAKE_API_KEY);
    assert.equal(byName.get(GOOGLE_CSE_CX_VAULT_NAME), FAKE_CX);
    // Connection row PATCHed with the stored status — never the secret values.
    assert.ok(connCall);
    assert.ok(connCall!.url.includes(CONN_TABLE));
    const connBody = connCall!.body as Record<string, unknown>;
    assert.equal(connBody.credentials_status, 'stored');
    assert.ok(!JSON.stringify(connBody).includes(FAKE_API_KEY));
    assert.ok(!JSON.stringify(connBody).includes(FAKE_CX));
    assert.equal(googleCalls, 0);
  });

  it('storeGoogleCSECredentials returns VAULT_STORAGE_ERROR when an upsert RPC errors', async () => {
    installFetch({ upsert: () => jsonResponse({ message: 'nope' }, 400) });
    const result = await storeGoogleCSECredentials(FAKE_API_KEY, FAKE_CX);
    assert.equal(result.success, false);
    assert.equal(result.error, 'VAULT_STORAGE_ERROR');
    assert.ok(!JSON.stringify(result).includes(FAKE_API_KEY));
    assert.ok(!JSON.stringify(result).includes(FAKE_CX));
  });

  // ── removeGoogleCSECredentials ────────────────────────────────────────────

  it('removeGoogleCSECredentials deletes both secrets and returns success', async () => {
    const deletes: CapturedRpc[] = [];
    installFetch({
      delete: (c) => {
        deletes.push(c);
        return jsonResponse(null);
      },
    });

    const result = await removeGoogleCSECredentials();

    assert.equal(result.success, true);
    assert.equal(deletes.length, 2);
    const names = deletes.map((c) => (c.body as Record<string, unknown>).p_name);
    assert.ok(names.includes(GOOGLE_CSE_API_KEY_VAULT_NAME));
    assert.ok(names.includes(GOOGLE_CSE_CX_VAULT_NAME));
  });

  // ── testGoogleCSEConnection ───────────────────────────────────────────────

  it('returns success true on 200 and never sends the key back to the caller', async () => {
    let capturedUrl: string | undefined;
    installFetch({
      vault: vaultReturnsBoth,
      google: (u, init) => {
        capturedUrl = u;
        assert.equal(init?.method, 'GET');
        return jsonResponse({ items: [{ title: 'ok' }] });
      },
    });

    const result = await testGoogleCSEConnection();

    assert.equal(result.success, true);
    assert.equal(result.resultsCount, 1);
    assert.equal(result.error, undefined);
    assert.equal(googleCalls, 1);
    assert.ok(capturedUrl?.includes(GOOGLE_CSE_PATH));
    assert.ok(!JSON.stringify(result).includes(FAKE_API_KEY));
    assert.ok(!JSON.stringify(result).includes(FAKE_CX));
  });

  it('returns NO_CREDENTIALS and never calls Google when there are no credentials', async () => {
    installFetch({ vault: vaultReturnsNull });
    const result = await testGoogleCSEConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'NO_CREDENTIALS');
    assert.equal(googleCalls, 0);
  });

  it('returns INVALID_API_KEY on a generic 403', async () => {
    installFetch({ vault: vaultReturnsBoth, google: () => jsonResponse({}, 403) });
    const result = await testGoogleCSEConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'INVALID_API_KEY');
  });

  it('returns GOOGLE_CSE_PROJECT_NO_ACCESS on a 403 PERMISSION_DENIED for Custom Search JSON API', async () => {
    installFetch({
      vault: vaultReturnsBoth,
      google: () =>
        jsonResponse(
          {
            error: {
              status: 'PERMISSION_DENIED',
              message: 'Custom Search JSON API has not been used in project ...',
            },
          },
          403,
        ),
    });
    const result = await testGoogleCSEConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'GOOGLE_CSE_PROJECT_NO_ACCESS');
  });

  it('returns INVALID_CX on a 400', async () => {
    installFetch({ vault: vaultReturnsBoth, google: () => jsonResponse({}, 400) });
    const result = await testGoogleCSEConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'INVALID_CX');
  });

  it('returns QUOTA_EXCEEDED on a 429', async () => {
    installFetch({ vault: vaultReturnsBoth, google: () => jsonResponse({}, 429) });
    const result = await testGoogleCSEConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'QUOTA_EXCEEDED');
  });

  it('returns API_ERROR on a 5xx and includes the status code', async () => {
    installFetch({
      vault: vaultReturnsBoth,
      google: () => new Response('upstream boom', { status: 500 }),
    });
    const result = await testGoogleCSEConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'API_ERROR');
    assert.ok(result.message?.includes('500'));
  });

  it('returns TIMEOUT when the request aborts', async () => {
    installFetch({
      vault: vaultReturnsBoth,
      google: () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      },
    });
    const result = await testGoogleCSEConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'TIMEOUT');
  });

  it('returns CONNECTION_ERROR when the Google request rejects (network error)', async () => {
    installFetch({
      vault: vaultReturnsBoth,
      google: () => {
        throw new Error('network down');
      },
    });
    const result = await testGoogleCSEConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'CONNECTION_ERROR');
  });

  it('never surfaces the API key or cx in the returned result across every outcome', async () => {
    const scenarios: Array<() => Response> = [
      () => jsonResponse({ items: [{ title: 'ok' }] }, 200),
      () => jsonResponse({}, 400),
      () => jsonResponse({}, 403),
      () => jsonResponse({}, 429),
      () => new Response('upstream error detail', { status: 500 }),
    ];

    for (const respond of scenarios) {
      installFetch({ vault: vaultReturnsBoth, google: () => respond() });
      const result = await testGoogleCSEConnection();
      const serialized = JSON.stringify(result);
      assert.ok(!serialized.includes(FAKE_API_KEY), 'the raw API key must never appear in the result');
      assert.ok(!serialized.includes(FAKE_CX), 'the raw cx must never appear in the result');
      if (origFetch) {
        globalThis.fetch = origFetch;
        origFetch = null;
      }
    }
  });

  // ── maskGoogleCSECx (pure) ────────────────────────────────────────────────

  it('maskGoogleCSECx never reveals the full cx and is stable', async () => {
    const masked = maskGoogleCSECx(FAKE_CX);
    assert.notEqual(masked, FAKE_CX);
    assert.ok(!masked.includes(FAKE_CX));
    assert.equal(masked, maskGoogleCSECx(FAKE_CX));
  });

  it('maskGoogleCSECx fully masks a short cx', async () => {
    assert.equal(maskGoogleCSECx('abc'), '****');
  });

  // ── Fail-closed: admin/Vault functions reject when the env is unsafe/missing ─

  it('admin/Vault functions reject with UnsafeSupabaseEnvironmentError when the env is unsafe, with no network call', async () => {
    const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    // Install a mock that would loudly fail if any network call were attempted;
    // the factory must throw before any RPC or Google request.
    installFetch({});
    const isUnsafe = (err: unknown): boolean =>
      err instanceof Error && err.name === 'UnsafeSupabaseEnvironmentError';
    try {
      await assert.rejects(() => hasGoogleCSECredentials(), isUnsafe);
      await assert.rejects(() => getGoogleCSECredentials(), isUnsafe);
      await assert.rejects(() => storeGoogleCSECredentials(FAKE_API_KEY, FAKE_CX), isUnsafe);
      await assert.rejects(() => removeGoogleCSECredentials(), isUnsafe);
      await assert.rejects(() => testGoogleCSEConnection(), isUnsafe);
      assert.equal(googleCalls, 0);
    } finally {
      if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
    }
  });
});
