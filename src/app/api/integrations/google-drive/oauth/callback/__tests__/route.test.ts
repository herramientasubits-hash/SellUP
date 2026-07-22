// H5.16B — Google Drive OAuth callback admin-factory migration, offline test.
//
// Exercises the GET handler of
//   src/app/api/integrations/google-drive/oauth/callback/route.ts
// entirely OFFLINE. This test NEVER runs a real OAuth flow, NEVER calls a real
// Google endpoint, NEVER performs a real token exchange, NEVER touches real
// Google Drive, NEVER touches a real Supabase project or Vault, and NEVER
// writes to a real database.
//
// Mocking strategy (matches the H5.14B slack OAuth / H5.15B auth callback
// precedents):
//   - @/lib/supabase/server (createClient) IS module-mocked. The real one
//     reads next/headers cookies() which is unavailable under `node --test`.
//     It only owns auth.getUser() here; the fake makes the session user
//     controllable per test.
//   - createSupabaseAdminClient() is NOT mocked. The REAL fail-closed factory
//     and its REAL env-guard (getSupabaseServiceRoleEnv) run for state
//     validation, internal-user lookup, audit logging and connection
//     persistence, so the migration's fail-closed behavior is genuinely
//     exercised. storeUserDriveRefreshToken / createSellUpDriveFolder also run
//     for real — their network calls are served by the fetch fake below.
//   - globalThis.fetch IS mocked and routed by URL + method. Every Supabase
//     PostgREST / Vault RPC call and every Google (token + Drive) call is
//     served from fakes. ANY unmocked URL throws loudly, so a real network
//     call fails the test.
//
// The default env points at a SAFE, non-production Supabase host so the real
// factory resolves; dedicated tests clear the Supabase env to force the
// fail-closed throw (UnsafeSupabaseEnvironmentError). Because the admin client
// is on this route's critical path (unlike the auth-callback Slack sidecar),
// that throw is NOT caught — the request rejects, with no silent fallback.
// All credentials/tokens below are deliberately fake; assertions confirm none
// ever leak into a redirect Location.
//
// Requires: node --import tsx --experimental-test-module-mocks --test <thisfile>

import { describe, it, before, beforeEach, afterEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';

// ── Fake, non-real values (never real secrets) ──────────────────────────────
const SUPABASE_URL = 'https://fake-local-project.supabase.co';
const FAKE_SERVICE_KEY = 'fake-service-role-key-not-real-0000';
const APP_ORIGIN = 'https://app.test';
const FAKE_GOOGLE_CLIENT_ID = 'fake-google-client-id.apps.googleusercontent.com';
const FAKE_GOOGLE_CLIENT_SECRET = 'fake-google-client-secret-not-real-0000';
const FAKE_GOOGLE_REDIRECT_URI = `${APP_ORIGIN}/api/integrations/google-drive/oauth/callback`;
const FAKE_CODE = 'fake-auth-code-not-real';
const FAKE_STATE = 'fake-oauth-state-not-real';
const FAKE_ACCESS_TOKEN = 'fake-google-access-token-not-real-0000';
const FAKE_REFRESH_TOKEN = 'fake-google-refresh-token-not-real-0000';
const FAKE_FOLDER_ID = 'fake-drive-folder-id-0000';
const FAKE_FOLDER_NAME = 'SellUp';
const STATE_USER_ID = 'internal-user-1';

// Env MUST be set before the route module (and google-drive-connection) load.
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
process.env.NEXT_PUBLIC_APP_URL = APP_ORIGIN;
process.env.GOOGLE_DRIVE_CLIENT_ID = FAKE_GOOGLE_CLIENT_ID;
process.env.GOOGLE_DRIVE_CLIENT_SECRET = FAKE_GOOGLE_CLIENT_SECRET;
process.env.GOOGLE_DRIVE_REDIRECT_URI = FAKE_GOOGLE_REDIRECT_URI;
// Never let the guard reject on VERCEL_ENV — the fake host is non-production anyway.
delete process.env.VERCEL_ENV;

// ── Mock @/lib/supabase/server (fake auth only) ─────────────────────────────
let mockAuthUser: { id: string; email?: string } | null = null;

mock.module('@/lib/supabase/server', {
  namedExports: {
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: mockAuthUser }, error: null }),
      },
    }),
  },
});

// ── Per-test controllable Supabase / Google response state ──────────────────
interface RouteState {
  // user_drive_audit .maybeSingle() state-validation row (null → not found /
  // outside the 10-min window, which real PostgREST would filter out).
  stateAuditRow: { internal_user_id: string; created_at: string } | null;
  // internal_users .single() id (null → not found / not active).
  activeInternalUserId: string | null;
  // user_drive_connections .maybeSingle() existing row (null → none).
  existingConnection: { drive_folder_id: string | null; drive_folder_name: string | null } | null;
  // Google token endpoint responder.
  tokenResponder: () => Response;
  // Google Drive files endpoint responder.
  driveFolderResponder: () => Response;
  // Vault upsert_vault_secret RPC responder.
  vaultResponder: () => Response;
}

let state: RouteState;
let auditInserts: Array<Record<string, unknown>>;
let tokenExchangeCalls: number;
let driveFolderCalls: number;
let vaultRpcCalls: number;
let internalUsersSelectCalls: number;
let auditSelectCalls: number;
let connUpsertCalls: number;
let origFetch: typeof globalThis.fetch;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Empty body → postgrest-js yields data=null for both .single() and .maybeSingle().
function emptyOk(status = 200): Response {
  return new Response('', { status, headers: { 'Content-Type': 'application/json' } });
}

function parseBody(init: RequestInit | undefined): unknown {
  if (!init || typeof init.body !== 'string') return undefined;
  try {
    return JSON.parse(init.body);
  } catch {
    return undefined;
  }
}

function recordAuditInsert(body: unknown): void {
  const rows = Array.isArray(body) ? body : body ? [body] : [];
  for (const row of rows) {
    if (row && typeof row === 'object') auditInserts.push(row as Record<string, unknown>);
  }
}

function installFetch(): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    // ── Supabase Vault RPC (storeUserDriveRefreshToken) ──────────────────
    if (u.includes('/rest/v1/rpc/upsert_vault_secret')) {
      vaultRpcCalls += 1;
      return state.vaultResponder();
    }

    // ── PostgREST: user_drive_audit (SELECT state / INSERT audit) ────────
    if (u.includes('/rest/v1/user_drive_audit')) {
      if (method === 'GET') {
        auditSelectCalls += 1;
        // .maybeSingle() → postgrest-js expects an array (0 or 1 rows).
        return jsonResponse(state.stateAuditRow ? [state.stateAuditRow] : []);
      }
      // INSERT (drive_oauth_failed / drive_oauth_connected / drive_folder_created)
      recordAuditInsert(parseBody(init));
      return emptyOk(201);
    }

    // ── PostgREST: internal_users (SELECT id, .single()) ─────────────────
    if (u.includes('/rest/v1/internal_users')) {
      internalUsersSelectCalls += 1;
      return state.activeInternalUserId
        ? jsonResponse({ id: state.activeInternalUserId })
        : emptyOk();
    }

    // ── PostgREST: user_drive_connections (SELECT existing / UPSERT) ─────
    if (u.includes('/rest/v1/user_drive_connections')) {
      if (method === 'GET') {
        // .maybeSingle() → array of 0 or 1 rows.
        return jsonResponse(state.existingConnection ? [state.existingConnection] : []);
      }
      // UPSERT (from storeUserDriveRefreshToken and from the route's step 9).
      connUpsertCalls += 1;
      return emptyOk(201);
    }

    // ── Google OAuth token exchange ──────────────────────────────────────
    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      tokenExchangeCalls += 1;
      return state.tokenResponder();
    }

    // ── Google Drive API (folder creation) ───────────────────────────────
    if (u.startsWith('https://www.googleapis.com/drive/v3/files')) {
      driveFolderCalls += 1;
      return state.driveFolderResponder();
    }

    throw new Error(`Unexpected fetch to a non-mocked URL: ${u}`);
  }) as typeof globalThis.fetch;
}

// ── Route handler + factory error (dynamic import AFTER mock + env in place) ─
let GET: (request: unknown) => Promise<Response>;
let NextRequest: typeof import('next/server').NextRequest;
let UnsafeSupabaseEnvironmentError: typeof import('@/lib/supabase/env-guard.server').UnsafeSupabaseEnvironmentError;

before(async () => {
  ({ NextRequest } = await import('next/server'));
  ({ GET } = (await import('../route')) as unknown as {
    GET: (request: unknown) => Promise<Response>;
  });
  ({ UnsafeSupabaseEnvironmentError } = await import('@/lib/supabase/env-guard.server'));
});

beforeEach(() => {
  origFetch = globalThis.fetch;
  auditInserts = [];
  tokenExchangeCalls = 0;
  driveFolderCalls = 0;
  vaultRpcCalls = 0;
  internalUsersSelectCalls = 0;
  auditSelectCalls = 0;
  connUpsertCalls = 0;

  // Default: healthy happy-path — valid state, authenticated matching user,
  // no existing connection, successful token exchange + folder + vault.
  mockAuthUser = { id: 'auth-user-1', email: 'someone@ubits.co' };
  state = {
    stateAuditRow: { internal_user_id: STATE_USER_ID, created_at: '2026-07-22T00:00:00.000Z' },
    activeInternalUserId: STATE_USER_ID,
    existingConnection: null,
    tokenResponder: () =>
      jsonResponse({
        access_token: FAKE_ACCESS_TOKEN,
        refresh_token: FAKE_REFRESH_TOKEN,
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/drive.file',
      }),
    driveFolderResponder: () => jsonResponse({ id: FAKE_FOLDER_ID, name: FAKE_FOLDER_NAME }),
    vaultResponder: () => jsonResponse('fake-vault-secret-id'),
  };

  // Safe env per test (individual tests override then restore in afterEach).
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
  process.env.NEXT_PUBLIC_APP_URL = APP_ORIGIN;
  process.env.GOOGLE_DRIVE_CLIENT_ID = FAKE_GOOGLE_CLIENT_ID;
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = FAKE_GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_DRIVE_REDIRECT_URI = FAKE_GOOGLE_REDIRECT_URI;
  delete process.env.VERCEL_ENV;

  installFetch();
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

after(() => {
  mock.reset();
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function locationOf(res: Response): string {
  return res.headers.get('location') ?? '';
}

function callbackRequest(query: Record<string, string> = {}): unknown {
  const url = new URL(`${APP_ORIGIN}/api/integrations/google-drive/oauth/callback`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url.toString());
}

function eventTypes(): string[] {
  return auditInserts.map((r) => String(r.event_type));
}

function errorCodes(): string[] {
  return auditInserts
    .filter((r) => r.event_type === 'drive_oauth_failed')
    .map((r) => {
      const meta = r.metadata as Record<string, unknown> | undefined;
      return String(meta?.error_code);
    });
}

function assertNoSecretLeak(res: Response): void {
  const haystack = `${locationOf(res)} ${JSON.stringify([...res.headers])}`;
  assert.ok(!haystack.includes(FAKE_REFRESH_TOKEN), 'Google refresh token must never leak');
  assert.ok(!haystack.includes(FAKE_ACCESS_TOKEN), 'Google access token must never leak');
  assert.ok(!haystack.includes(FAKE_GOOGLE_CLIENT_SECRET), 'Google client secret must never leak');
  assert.ok(!haystack.includes(FAKE_SERVICE_KEY), 'Supabase service-role key must never leak');
}

// ════════════════════════════════════════════════════════════════════════════
describe('google-drive/oauth/callback (offline handler)', () => {
  // ── 1. Missing params / Google-side error ──────────────────────────────
  it('1a. missing code+state → error redirect, no admin, no token exchange, no Drive, no Vault', async () => {
    const res = await GET(callbackRequest());
    assert.ok(locationOf(res).startsWith(`${APP_ORIGIN}/settings/my-drive?error=`), locationOf(res));
    assert.equal(auditSelectCalls, 0); // returns before building any admin client
    assert.equal(tokenExchangeCalls, 0);
    assert.equal(driveFolderCalls, 0);
    assert.equal(vaultRpcCalls, 0);
    assertNoSecretLeak(res);
  });

  it('1b. missing state (code present) → error redirect, no token exchange', async () => {
    const res = await GET(callbackRequest({ code: FAKE_CODE }));
    assert.ok(locationOf(res).startsWith(`${APP_ORIGIN}/settings/my-drive?error=`), locationOf(res));
    assert.equal(tokenExchangeCalls, 0);
  });

  it('1c. Google error=access_denied → error redirect, no token exchange, no Drive, no Vault', async () => {
    const res = await GET(callbackRequest({ error: 'access_denied' }));
    assert.ok(locationOf(res).startsWith(`${APP_ORIGIN}/settings/my-drive?error=`), locationOf(res));
    assert.equal(auditSelectCalls, 0);
    assert.equal(tokenExchangeCalls, 0);
    assert.equal(driveFolderCalls, 0);
    assert.equal(vaultRpcCalls, 0);
  });

  // ── 2. Unauthenticated user ─────────────────────────────────────────────
  it('2. state valid but no authenticated user → error redirect, user_mismatch audit, no token exchange', async () => {
    mockAuthUser = null;
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: FAKE_STATE }));
    assert.ok(locationOf(res).startsWith(`${APP_ORIGIN}/settings/my-drive?error=`), locationOf(res));
    assert.equal(auditSelectCalls, 1); // state validation ran
    assert.equal(internalUsersSelectCalls, 0); // no user → internal_users never queried
    assert.deepEqual(errorCodes(), ['user_mismatch']);
    assert.equal(tokenExchangeCalls, 0);
    assert.equal(driveFolderCalls, 0);
    assert.equal(vaultRpcCalls, 0);
    assertNoSecretLeak(res);
  });

  // ── 3. Invalid state ────────────────────────────────────────────────────
  it('3. invalid state (no matching audit row) → error redirect, NO audit insert, no token exchange', async () => {
    state.stateAuditRow = null;
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: 'bogus-state' }));
    assert.ok(locationOf(res).startsWith(`${APP_ORIGIN}/settings/my-drive?error=`), locationOf(res));
    assert.equal(auditSelectCalls, 1);
    // Current contract: an unmatched state returns before any audit insert.
    assert.deepEqual(auditInserts, []);
    assert.equal(internalUsersSelectCalls, 0);
    assert.equal(tokenExchangeCalls, 0);
  });

  // ── 4. Expired state ────────────────────────────────────────────────────
  it('4. expired state (filtered out by the 10-min window) → error redirect, no token exchange', async () => {
    // The route applies .gte(created_at, tenMinutesAgo) server-side, so an
    // expired row is not returned by PostgREST → the offline fake returns none.
    state.stateAuditRow = null;
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: FAKE_STATE }));
    assert.ok(locationOf(res).startsWith(`${APP_ORIGIN}/settings/my-drive?error=`), locationOf(res));
    assert.equal(tokenExchangeCalls, 0);
    assert.deepEqual(auditInserts, []);
  });

  // ── 5. User mismatch ────────────────────────────────────────────────────
  it('5. state belongs to a different internal user → error redirect, user_mismatch audit, no token exchange', async () => {
    state.stateAuditRow = { internal_user_id: 'state-owner', created_at: '2026-07-22T00:00:00.000Z' };
    state.activeInternalUserId = 'different-user';
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: FAKE_STATE }));
    assert.ok(locationOf(res).startsWith(`${APP_ORIGIN}/settings/my-drive?error=`), locationOf(res));
    assert.equal(internalUsersSelectCalls, 1);
    assert.deepEqual(errorCodes(), ['user_mismatch']);
    assert.equal(tokenExchangeCalls, 0);
    assert.equal(driveFolderCalls, 0);
    assert.equal(vaultRpcCalls, 0);
  });

  // ── 6. Full success ─────────────────────────────────────────────────────
  it('6. token exchange success → Vault store, folder created, connected + folder_created audits, ?connected=1', async () => {
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: FAKE_STATE }));
    assert.equal(locationOf(res), `${APP_ORIGIN}/settings/my-drive?connected=1`, locationOf(res));
    assert.equal(tokenExchangeCalls, 1);
    assert.equal(vaultRpcCalls, 1);
    assert.equal(driveFolderCalls, 1);
    assert.ok(connUpsertCalls >= 1);
    assert.ok(eventTypes().includes('drive_oauth_connected'));
    assert.ok(eventTypes().includes('drive_folder_created'));
    assert.deepEqual(errorCodes(), []);
    assertNoSecretLeak(res);
  });

  // ── 7. Token exchange returns an OAuth error (invalid_grant) ────────────
  it('7. token exchange ok:200 but error=invalid_grant → error redirect, no folder, no Vault', async () => {
    state.tokenResponder = () =>
      jsonResponse({ error: 'invalid_grant', error_description: 'Bad Request' });
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: FAKE_STATE }));
    assert.ok(locationOf(res).startsWith(`${APP_ORIGIN}/settings/my-drive?error=`), locationOf(res));
    assert.equal(tokenExchangeCalls, 1);
    assert.equal(vaultRpcCalls, 0);
    assert.equal(driveFolderCalls, 0);
    assert.deepEqual(errorCodes(), ['invalid_grant']);
    assertNoSecretLeak(res);
  });

  // ── 8. Token exchange HTTP error / network throw ────────────────────────
  it('8a. token exchange HTTP 400 → error redirect, http_400 audit, no folder, no Vault', async () => {
    state.tokenResponder = () => jsonResponse({ error: 'invalid_request' }, 400);
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: FAKE_STATE }));
    assert.ok(locationOf(res).startsWith(`${APP_ORIGIN}/settings/my-drive?error=`), locationOf(res));
    assert.equal(tokenExchangeCalls, 1);
    assert.equal(vaultRpcCalls, 0);
    assert.equal(driveFolderCalls, 0);
    assert.deepEqual(errorCodes(), ['http_400']);
  });

  it('8b. token exchange network throw → error redirect, network_error audit, no folder, no Vault', async () => {
    state.tokenResponder = () => {
      throw new Error('google network down');
    };
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: FAKE_STATE }));
    assert.ok(locationOf(res).startsWith(`${APP_ORIGIN}/settings/my-drive?error=`), locationOf(res));
    assert.equal(vaultRpcCalls, 0);
    assert.equal(driveFolderCalls, 0);
    assert.deepEqual(errorCodes(), ['network_error']);
  });

  it('8c. token response missing refresh_token → error redirect, no_refresh_token audit, no folder, no Vault', async () => {
    state.tokenResponder = () =>
      jsonResponse({ access_token: FAKE_ACCESS_TOKEN, expires_in: 3600, token_type: 'Bearer' });
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: FAKE_STATE }));
    assert.ok(locationOf(res).startsWith(`${APP_ORIGIN}/settings/my-drive?error=`), locationOf(res));
    assert.equal(vaultRpcCalls, 0);
    assert.equal(driveFolderCalls, 0);
    assert.deepEqual(errorCodes(), ['no_refresh_token']);
  });

  // ── 9. Drive folder creation failure (non-blocking per contract) ────────
  it('9. Drive folder creation fails → connection still succeeds, connected audit only, ?connected=1', async () => {
    state.driveFolderResponder = () => jsonResponse({ error: 'insufficientPermissions' }, 403);
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: FAKE_STATE }));
    // Contract: folder failure does NOT block the connection.
    assert.equal(locationOf(res), `${APP_ORIGIN}/settings/my-drive?connected=1`, locationOf(res));
    assert.equal(vaultRpcCalls, 1); // vault stored before folder attempt
    assert.equal(driveFolderCalls, 1); // folder attempted
    assert.ok(eventTypes().includes('drive_oauth_connected'));
    assert.ok(!eventTypes().includes('drive_folder_created')); // no folder → no folder audit
    assertNoSecretLeak(res);
  });

  // ── 10. Existing folder reuse (no duplicate creation) ───────────────────
  it('10. existing connection folder is reused → no Drive folder creation call, ?connected=1', async () => {
    state.existingConnection = { drive_folder_id: 'existing-folder-id', drive_folder_name: 'SellUp' };
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: FAKE_STATE }));
    assert.equal(locationOf(res), `${APP_ORIGIN}/settings/my-drive?connected=1`, locationOf(res));
    assert.equal(driveFolderCalls, 0); // reused → no duplicate folder
    assert.equal(vaultRpcCalls, 1);
    assert.ok(eventTypes().includes('drive_oauth_connected'));
    assert.ok(!eventTypes().includes('drive_folder_created'));
    assertNoSecretLeak(res);
  });

  // ── 11. Fail-closed admin env ────────────────────────────────────────────
  it('11a. missing SUPABASE_SERVICE_ROLE_KEY → factory throws, request rejects, no Google/Vault call', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Prove the real factory fails closed here.
    const { createSupabaseAdminClient } = await import('@/lib/supabase/admin');
    let threw: unknown;
    try {
      createSupabaseAdminClient();
    } catch (err) {
      threw = err;
    }
    assert.ok(
      threw instanceof UnsafeSupabaseEnvironmentError,
      'factory must fail closed when the service-role key is missing',
    );

    // The admin client is on the critical path (no try/catch): GET rejects.
    await assert.rejects(
      () => GET(callbackRequest({ code: FAKE_CODE, state: FAKE_STATE })),
      (err: unknown) => err instanceof UnsafeSupabaseEnvironmentError,
    );
    assert.equal(tokenExchangeCalls, 0); // never reached token exchange
    assert.equal(driveFolderCalls, 0);
    assert.equal(vaultRpcCalls, 0);
  });

  it('11b. missing NEXT_PUBLIC_SUPABASE_URL → factory throws, request rejects, no silent prod fallback', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await assert.rejects(
      () => GET(callbackRequest({ code: FAKE_CODE, state: FAKE_STATE })),
      (err: unknown) => err instanceof UnsafeSupabaseEnvironmentError,
    );
    assert.equal(tokenExchangeCalls, 0);
    assert.equal(driveFolderCalls, 0);
    assert.equal(vaultRpcCalls, 0);
  });

  // ── 12. Sanitization ─────────────────────────────────────────────────────
  it('12. success redirect never contains any fake token/secret/service key', async () => {
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: FAKE_STATE }));
    assert.equal(locationOf(res), `${APP_ORIGIN}/settings/my-drive?connected=1`, locationOf(res));
    const location = locationOf(res);
    assert.ok(!location.includes(FAKE_REFRESH_TOKEN));
    assert.ok(!location.includes(FAKE_ACCESS_TOKEN));
    assert.ok(!location.includes(FAKE_GOOGLE_CLIENT_SECRET));
    assert.ok(!location.includes(FAKE_SERVICE_KEY));
    assertNoSecretLeak(res);
  });

  it('12b. error redirects never leak secrets either', async () => {
    state.tokenResponder = () => jsonResponse({ error: 'invalid_grant' });
    const res = await GET(callbackRequest({ code: FAKE_CODE, state: FAKE_STATE }));
    assert.ok(locationOf(res).startsWith(`${APP_ORIGIN}/settings/my-drive?error=`), locationOf(res));
    assertNoSecretLeak(res);
  });

  // ── 13. No real network ──────────────────────────────────────────────────
  it('13. an unmocked URL throws loudly (guards against real network calls)', async () => {
    await assert.rejects(
      () => globalThis.fetch('https://example.com/real'),
      /non-mocked URL/,
    );
  });
});
