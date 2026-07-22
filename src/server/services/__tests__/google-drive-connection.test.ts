// H5.17A — Google Drive connection service admin-factory migration, offline test.
//
// Exercises the exported functions of
//   src/server/services/google-drive-connection.ts
// entirely OFFLINE. This test NEVER runs a real OAuth flow, NEVER calls a real
// Google endpoint, NEVER touches real Google Drive, NEVER touches a real
// Supabase project or Vault, and NEVER writes to a real database.
//
// Mocking strategy (mirrors the H5.16B drive OAuth callback precedent, minus
// the module mock):
//   - createSupabaseAdminClient() is NOT mocked. The REAL fail-closed factory
//     and its REAL env-guard (getSupabaseServiceRoleEnv) run, so the
//     migration's fail-closed behavior is genuinely exercised.
//   - This service does NOT import @/lib/supabase/server (no next/headers), so
//     this test needs NO --experimental-test-module-mocks. Functions are
//     imported directly.
//   - globalThis.fetch IS mocked and routed by URL + method. Every Supabase
//     PostgREST / Vault RPC call is served from fakes. ANY unmocked URL throws
//     loudly, so a real network call fails the test. There is NO Google
//     responder at all — this service must never call Google, and a Google URL
//     would fall through to the loud throw.
//
// The default env points at a SAFE, non-production Supabase host so the real
// factory resolves; dedicated tests clear or repoint the Supabase env to force
// the fail-closed throw (UnsafeSupabaseEnvironmentError). All credentials/
// tokens below are deliberately fake; assertions confirm none ever leak into a
// returned value.
//
// Requires: node --import tsx --test <thisfile>

import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Fake, non-real values (never real secrets) ──────────────────────────────
const SUPABASE_URL = 'https://fake-local-project.supabase.co';
const PROD_SUPABASE_URL = 'https://lrdruowtadwbdulndlph.supabase.co';
const FAKE_SERVICE_KEY = 'fake-service-role-key-not-real-0000';
const FAKE_USER_ID = 'internal-user-1';
const FAKE_REFRESH_TOKEN = 'fake-google-refresh-token-not-real-0000';
const FAKE_VAULT_ID = 'fake-vault-secret-id-0000';

// Env MUST be set before the service module loads.
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
delete process.env.VERCEL_ENV;
delete process.env.ALLOW_PRODUCTION_SUPABASE_IN_NON_PROD;

// ── Per-test controllable fake response state ───────────────────────────────
interface FakeState {
  // upsert_vault_secret RPC responder (returns the vault secret id, or error).
  vaultUpsertResponder: () => Response;
  // get_vault_secret_decrypted RPC responder (returns the decrypted secret).
  vaultGetResponder: () => Response;
  // has_vault_secret RPC responder (returns a boolean).
  vaultHasResponder: () => Response;
  // delete_vault_secret RPC responder (returns void, or error).
  vaultDeleteResponder: () => Response;
  // user_drive_connections POST (upsert) responder.
  connUpsertResponder: () => Response;
  // user_drive_connections PATCH (update) responder.
  connUpdateResponder: () => Response;
}

let state: FakeState;
let allUrls: string[];
let googleCalls: number;
let vaultUpsertCalls: number;
let vaultGetCalls: number;
let vaultHasCalls: number;
let vaultDeleteCalls: number;
let connUpsertCalls: number;
let connUpdateCalls: number;
let origFetch: typeof globalThis.fetch;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Empty (null) body → postgrest-js yields data=null (return=minimal
// upsert/update). Body must be null for a 204 to be a valid Response.
function emptyOk(status = 204): Response {
  return new Response(null, { status, headers: { 'Content-Type': 'application/json' } });
}

// PostgREST-shaped error body → supabase-js populates error.message.
function pgError(message: string, status = 500): Response {
  return jsonResponse({ message, code: 'XX000', details: null, hint: null }, status);
}

function installFetch(): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    allUrls.push(u);

    // Any Google URL is a hard failure — this service must never call Google.
    if (u.includes('googleapis.com') || u.includes('google.com')) {
      googleCalls += 1;
      throw new Error(`Forbidden Google call from a Vault-only service: ${u}`);
    }

    // ── Supabase Vault RPCs ───────────────────────────────────────────────
    if (u.includes('/rest/v1/rpc/upsert_vault_secret')) {
      vaultUpsertCalls += 1;
      return state.vaultUpsertResponder();
    }
    if (u.includes('/rest/v1/rpc/get_vault_secret_decrypted')) {
      vaultGetCalls += 1;
      return state.vaultGetResponder();
    }
    if (u.includes('/rest/v1/rpc/has_vault_secret')) {
      vaultHasCalls += 1;
      return state.vaultHasResponder();
    }
    if (u.includes('/rest/v1/rpc/delete_vault_secret')) {
      vaultDeleteCalls += 1;
      return state.vaultDeleteResponder();
    }

    // ── PostgREST: user_drive_connections (UPSERT via POST / UPDATE via PATCH) ─
    if (u.includes('/rest/v1/user_drive_connections')) {
      if (method === 'PATCH') {
        connUpdateCalls += 1;
        return state.connUpdateResponder();
      }
      connUpsertCalls += 1;
      return state.connUpsertResponder();
    }

    throw new Error(`Unexpected fetch to a non-mocked URL: ${u}`);
  }) as typeof globalThis.fetch;
}

// ── Service functions (dynamic import AFTER env in place) ────────────────────
let storeUserDriveRefreshToken: typeof import('../google-drive-connection').storeUserDriveRefreshToken;
let getUserDriveRefreshToken: typeof import('../google-drive-connection').getUserDriveRefreshToken;
let hasUserDriveRefreshToken: typeof import('../google-drive-connection').hasUserDriveRefreshToken;
let removeUserDriveRefreshToken: typeof import('../google-drive-connection').removeUserDriveRefreshToken;
let UnsafeSupabaseEnvironmentError: typeof import('@/lib/supabase/env-guard.server').UnsafeSupabaseEnvironmentError;

before(async () => {
  ({
    storeUserDriveRefreshToken,
    getUserDriveRefreshToken,
    hasUserDriveRefreshToken,
    removeUserDriveRefreshToken,
  } = await import('../google-drive-connection'));
  ({ UnsafeSupabaseEnvironmentError } = await import('@/lib/supabase/env-guard.server'));
});

beforeEach(() => {
  origFetch = globalThis.fetch;
  allUrls = [];
  googleCalls = 0;
  vaultUpsertCalls = 0;
  vaultGetCalls = 0;
  vaultHasCalls = 0;
  vaultDeleteCalls = 0;
  connUpsertCalls = 0;
  connUpdateCalls = 0;

  // Default: healthy happy-path responders.
  state = {
    vaultUpsertResponder: () => jsonResponse(FAKE_VAULT_ID),
    vaultGetResponder: () => jsonResponse(FAKE_REFRESH_TOKEN),
    vaultHasResponder: () => jsonResponse(true),
    vaultDeleteResponder: () => emptyOk(),
    connUpsertResponder: () => emptyOk(201),
    connUpdateResponder: () => emptyOk(204),
  };

  // Safe, non-production env per test.
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
  delete process.env.VERCEL_ENV;
  delete process.env.ALLOW_PRODUCTION_SUPABASE_IN_NON_PROD;

  installFetch();
});

afterEach(() => {
  globalThis.fetch = origFetch;
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
  delete process.env.VERCEL_ENV;
});

// ── Helpers ──────────────────────────────────────────────────────────────────
const EXPECTED_SECRET_NAME = `sellup_user_drive_refresh_token_${FAKE_USER_ID}`;

function assertOnlyFakeSupabaseHost(): void {
  for (const u of allUrls) {
    assert.ok(
      u.startsWith(`${SUPABASE_URL}/rest/v1/`),
      `only fake Supabase PostgREST URLs are allowed, saw: ${u}`,
    );
  }
  assert.equal(googleCalls, 0, 'no Google call may ever be made');
}

function assertNoSecretLeak(value: unknown): void {
  const haystack = JSON.stringify(value);
  assert.ok(!haystack.includes(FAKE_REFRESH_TOKEN), 'refresh token must never leak into output');
  assert.ok(!haystack.includes(FAKE_SERVICE_KEY), 'service-role key must never leak into output');
}

// ════════════════════════════════════════════════════════════════════════════
describe('google-drive-connection (offline, real factory + env-guard)', () => {
  // ── 1. store happy path ─────────────────────────────────────────────────
  it('1. storeUserDriveRefreshToken happy path → vault upsert with correct secret name, then connection upsert', async () => {
    let vaultBody: Record<string, unknown> | undefined;
    state.vaultUpsertResponder = () => jsonResponse(FAKE_VAULT_ID);
    // Capture the RPC body by re-wrapping fetch for the vault URL.
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const u = typeof input === 'string' ? input : input.toString();
      if (u.includes('/rest/v1/rpc/upsert_vault_secret') && typeof init?.body === 'string') {
        vaultBody = JSON.parse(init.body);
      }
      return inner(input, init);
    }) as typeof globalThis.fetch;

    const result = await storeUserDriveRefreshToken(FAKE_USER_ID, FAKE_REFRESH_TOKEN);

    assert.deepEqual(result, { success: true });
    assert.equal(vaultUpsertCalls, 1);
    assert.equal(connUpsertCalls, 1);
    assert.equal(connUpdateCalls, 0);
    assert.equal(vaultBody?.p_name, EXPECTED_SECRET_NAME);
    assert.equal(vaultBody?.p_secret, FAKE_REFRESH_TOKEN);
    assertOnlyFakeSupabaseHost();
    assertNoSecretLeak(result);
  });

  // ── 2. store with Vault RPC error ───────────────────────────────────────
  it('2. storeUserDriveRefreshToken with Vault RPC error → {success:false}, NO connection upsert, no leak', async () => {
    state.vaultUpsertResponder = () => pgError('vault upsert failed');
    const result = await storeUserDriveRefreshToken(FAKE_USER_ID, FAKE_REFRESH_TOKEN);

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /^Vault error:/);
    assert.equal(vaultUpsertCalls, 1);
    assert.equal(connUpsertCalls, 0, 'connection must not be upserted when the vault call fails');
    assertOnlyFakeSupabaseHost();
    assertNoSecretLeak(result);
  });

  // ── 2b. store with connection (DB) error ────────────────────────────────
  it('2b. storeUserDriveRefreshToken with DB upsert error → {success:false, DB error}, no leak', async () => {
    state.connUpsertResponder = () => pgError('conn upsert failed');
    const result = await storeUserDriveRefreshToken(FAKE_USER_ID, FAKE_REFRESH_TOKEN);

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /^DB error:/);
    assert.equal(vaultUpsertCalls, 1);
    assert.equal(connUpsertCalls, 1);
    assertNoSecretLeak(result);
  });

  // ── 3. get happy path ───────────────────────────────────────────────────
  it('3. getUserDriveRefreshToken happy path → returns token, correct secret name, no connection touch', async () => {
    let getBody: Record<string, unknown> | undefined;
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const u = typeof input === 'string' ? input : input.toString();
      if (u.includes('/rest/v1/rpc/get_vault_secret_decrypted') && typeof init?.body === 'string') {
        getBody = JSON.parse(init.body);
      }
      return inner(input, init);
    }) as typeof globalThis.fetch;

    const token = await getUserDriveRefreshToken(FAKE_USER_ID);

    assert.equal(token, FAKE_REFRESH_TOKEN);
    assert.equal(vaultGetCalls, 1);
    assert.equal(connUpsertCalls, 0);
    assert.equal(connUpdateCalls, 0);
    assert.equal(getBody?.p_name, EXPECTED_SECRET_NAME);
    assertOnlyFakeSupabaseHost();
  });

  // ── 4. get with no secret ───────────────────────────────────────────────
  it('4. getUserDriveRefreshToken with no secret (null) → returns null', async () => {
    state.vaultGetResponder = () => jsonResponse(null);
    const token = await getUserDriveRefreshToken(FAKE_USER_ID);
    assert.equal(token, null);
    assert.equal(vaultGetCalls, 1);
    assertOnlyFakeSupabaseHost();
  });

  it('4b. getUserDriveRefreshToken with Vault RPC error → returns null (no throw, no leak)', async () => {
    state.vaultGetResponder = () => pgError('vault read failed');
    const token = await getUserDriveRefreshToken(FAKE_USER_ID);
    assert.equal(token, null);
    assertNoSecretLeak(token);
  });

  // ── 5. has → true ───────────────────────────────────────────────────────
  it('5. hasUserDriveRefreshToken true → returns true, calls has_vault_secret', async () => {
    let hasBody: Record<string, unknown> | undefined;
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const u = typeof input === 'string' ? input : input.toString();
      if (u.includes('/rest/v1/rpc/has_vault_secret') && typeof init?.body === 'string') {
        hasBody = JSON.parse(init.body);
      }
      return inner(input, init);
    }) as typeof globalThis.fetch;

    const has = await hasUserDriveRefreshToken(FAKE_USER_ID);
    assert.equal(has, true);
    assert.equal(vaultHasCalls, 1);
    assert.equal(hasBody?.p_name, EXPECTED_SECRET_NAME);
    assertOnlyFakeSupabaseHost();
  });

  // ── 6. has → false ──────────────────────────────────────────────────────
  it('6. hasUserDriveRefreshToken false → returns false', async () => {
    state.vaultHasResponder = () => jsonResponse(false);
    const has = await hasUserDriveRefreshToken(FAKE_USER_ID);
    assert.equal(has, false);
    assert.equal(vaultHasCalls, 1);
    assertOnlyFakeSupabaseHost();
  });

  // ── 7. remove happy path ────────────────────────────────────────────────
  it('7. removeUserDriveRefreshToken happy path → delete_vault_secret + connection PATCH clearing fields', async () => {
    let deleteBody: Record<string, unknown> | undefined;
    let updateBody: Record<string, unknown> | undefined;
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const u = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      if (u.includes('/rest/v1/rpc/delete_vault_secret') && typeof init?.body === 'string') {
        deleteBody = JSON.parse(init.body);
      }
      if (u.includes('/rest/v1/user_drive_connections') && method === 'PATCH' && typeof init?.body === 'string') {
        updateBody = JSON.parse(init.body);
      }
      return inner(input, init);
    }) as typeof globalThis.fetch;

    const result = await removeUserDriveRefreshToken(FAKE_USER_ID);

    assert.deepEqual(result, { success: true });
    assert.equal(vaultDeleteCalls, 1);
    assert.equal(connUpdateCalls, 1);
    assert.equal(connUpsertCalls, 0);
    assert.equal(deleteBody?.p_name, EXPECTED_SECRET_NAME);
    // Field-clear contract preserved.
    assert.equal(updateBody?.vault_secret_id, null);
    assert.equal(updateBody?.credentials_status, 'missing');
    assert.equal(updateBody?.connection_status, 'disconnected');
    assert.equal(updateBody?.drive_folder_id, null);
    assert.equal(updateBody?.drive_folder_name, null);
    assert.equal(updateBody?.last_connection_error, null);
    assertOnlyFakeSupabaseHost();
  });

  // ── 8. remove with Vault error ──────────────────────────────────────────
  it('8. removeUserDriveRefreshToken with Vault error → {success:false}, NO connection PATCH, no leak', async () => {
    state.vaultDeleteResponder = () => pgError('vault delete failed');
    const result = await removeUserDriveRefreshToken(FAKE_USER_ID);

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /^Vault error:/);
    assert.equal(vaultDeleteCalls, 1);
    assert.equal(connUpdateCalls, 0, 'connection must not be cleared when the vault delete fails');
    assertNoSecretLeak(result);
  });

  // ── 9. Fail-closed admin env (missing config) ───────────────────────────
  it('9a. missing SUPABASE_SERVICE_ROLE_KEY → factory throws UnsafeSupabaseEnvironmentError, NO Vault/Supabase/Google call', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await assert.rejects(
      () => storeUserDriveRefreshToken(FAKE_USER_ID, FAKE_REFRESH_TOKEN),
      (err: unknown) => err instanceof UnsafeSupabaseEnvironmentError,
    );
    assert.equal(vaultUpsertCalls, 0);
    assert.equal(connUpsertCalls, 0);
    assert.equal(allUrls.length, 0, 'no network call before the fail-closed throw');
  });

  it('9b. missing NEXT_PUBLIC_SUPABASE_URL → factory throws, no silent prod fallback, no network call', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await assert.rejects(
      () => getUserDriveRefreshToken(FAKE_USER_ID),
      (err: unknown) => err instanceof UnsafeSupabaseEnvironmentError,
    );
    assert.equal(vaultGetCalls, 0);
    assert.equal(allUrls.length, 0);
  });

  it('9c. every exported function fails closed on missing env (store/get/has/remove)', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await assert.rejects(() => storeUserDriveRefreshToken(FAKE_USER_ID, FAKE_REFRESH_TOKEN), UnsafeSupabaseEnvironmentError);
    await assert.rejects(() => getUserDriveRefreshToken(FAKE_USER_ID), UnsafeSupabaseEnvironmentError);
    await assert.rejects(() => hasUserDriveRefreshToken(FAKE_USER_ID), UnsafeSupabaseEnvironmentError);
    await assert.rejects(() => removeUserDriveRefreshToken(FAKE_USER_ID), UnsafeSupabaseEnvironmentError);
    assert.equal(allUrls.length, 0);
  });

  // ── 10. Non-production env targeting production Supabase (H2 pattern) ────
  it('10. non-production env resolving to the production Supabase host → factory throws, no network call', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = PROD_SUPABASE_URL;
    delete process.env.VERCEL_ENV; // local / non-Vercel, no override set
    await assert.rejects(
      () => hasUserDriveRefreshToken(FAKE_USER_ID),
      (err: unknown) =>
        err instanceof UnsafeSupabaseEnvironmentError &&
        err.reason === 'non_production_environment_targets_production_supabase',
    );
    assert.equal(allUrls.length, 0, 'must not reach the production project');
  });

  // ── 11. No real network ─────────────────────────────────────────────────
  it('11. an unmocked URL throws loudly (guards against real network calls)', async () => {
    await assert.rejects(
      () => globalThis.fetch('https://example.com/real'),
      /non-mocked URL/,
    );
  });

  it('11b. a Google URL is rejected outright (service must never call Google)', async () => {
    await assert.rejects(
      () => globalThis.fetch('https://www.googleapis.com/drive/v3/files'),
      /Forbidden Google call/,
    );
    assert.equal(googleCalls, 1);
  });

  // ── 12. Sanitization across a full store→get→remove cycle ───────────────
  it('12. full store→get→has→remove cycle only touches fake Supabase, never Google, never leaks secrets', async () => {
    const stored = await storeUserDriveRefreshToken(FAKE_USER_ID, FAKE_REFRESH_TOKEN);
    const got = await getUserDriveRefreshToken(FAKE_USER_ID);
    const has = await hasUserDriveRefreshToken(FAKE_USER_ID);
    const removed = await removeUserDriveRefreshToken(FAKE_USER_ID);

    assert.deepEqual(stored, { success: true });
    assert.equal(got, FAKE_REFRESH_TOKEN); // read is allowed to return the token to the server caller
    assert.equal(has, true);
    assert.deepEqual(removed, { success: true });

    assertOnlyFakeSupabaseHost();
    // The two {success} objects must never carry the token or the service key.
    assertNoSecretLeak(stored);
    assertNoSecretLeak(removed);
  });
});
