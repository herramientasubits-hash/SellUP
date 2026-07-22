// H5.17B — Google Drive actions admin-factory migration, offline test.
//
// Exercises the exported server actions of
//   src/modules/drive/actions.ts
// entirely OFFLINE. This test NEVER runs a real server action against
// production, NEVER starts a real OAuth flow, NEVER calls a real Google
// endpoint, NEVER touches real Google Drive, NEVER touches a real Supabase
// project or Vault, and NEVER writes to a real database.
//
// Mocking strategy (matches the H5.16B drive OAuth callback / H5.17A drive
// connection precedents):
//   - @/lib/supabase/server (createClient) IS module-mocked. The real one
//     reads next/headers cookies() which is unavailable under `node --test`.
//     It only owns auth.getUser() here; the fake makes the session user
//     controllable per test.
//   - @/server/services/google-drive-connection IS module-mocked. The action
//     delegates all Vault access (refresh-token read / removal) to it; the
//     fake proves the action never touches Vault directly. It was already
//     migrated to createSupabaseAdminClient() in H5.17A and is NOT touched
//     by this hito.
//   - @/server/services/google-drive-api IS module-mocked. The action
//     delegates every real Google call (token exchange, Drive test) to it;
//     the fake proves the action never calls Google directly.
//   - createSupabaseAdminClient() is NOT mocked. The REAL fail-closed factory
//     and its REAL env-guard (getSupabaseServiceRoleEnv) run for the
//     internal-user lookup, connection read/update, audit insert and the
//     stats RPC, so the migration's fail-closed behavior is genuinely
//     exercised.
//   - globalThis.fetch IS mocked and routed by URL + method. Every Supabase
//     PostgREST table op and the stats RPC is served from fakes. ANY unmocked
//     URL throws loudly, so a real network call fails the test. Because
//     google-drive-connection and google-drive-api are module-mocked, NO
//     Google/Vault URL ever reaches fetch at all.
//
// The default env points at a SAFE, non-production Supabase host so the real
// factory resolves; dedicated tests clear the Supabase env (or point it at the
// production host in a non-production environment) to force the fail-closed
// throw (UnsafeSupabaseEnvironmentError). All credentials/tokens below are
// deliberately fake; assertions confirm none ever leak into a visible message.
//
// Requires: node --import tsx --experimental-test-module-mocks --test <thisfile>

import { describe, it, before, beforeEach, afterEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';

// ── Fake, non-real values (never real secrets) ──────────────────────────────
const SUPABASE_URL = 'https://fake-local-project.supabase.co';
const FAKE_SERVICE_KEY = 'fake-service-role-key-not-real-0000';
const PRODUCTION_SUPABASE_URL = 'https://lrdruowtadwbdulndlph.supabase.co';
const FAKE_INTERNAL_USER_ID = 'internal-user-1';
const FAKE_AUTH_USER_ID = 'auth-user-1';
const FAKE_EMAIL = 'someone@ubits.co';
const FAKE_FOLDER_ID = 'fake-drive-folder-id-0000';
const FAKE_REFRESH_TOKEN = 'fake-google-refresh-token-not-real-0000';
const FAKE_ACCESS_TOKEN = 'fake-google-access-token-not-real-0000';

// Env MUST be set before the module under test loads.
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
delete process.env.VERCEL_ENV;

// ── Mutable, per-test state driving the mocks ───────────────────────────────
let mockAuthUser: { id: string; email?: string } | null = null;
let mockRefreshToken: string | null = null;
let mockRemoveResult: { success: boolean; error?: string } = { success: true };
let mockAccessTokenResult:
  | { success: true; accessToken: string }
  | { success: false; error: string } = { success: true, accessToken: FAKE_ACCESS_TOKEN };
let mockTestResult:
  | { success: true; email: string }
  | { success: false; error: string } = { success: true, email: FAKE_EMAIL };

// Delegation counters — prove the action never reaches Google/Vault directly.
let calls: {
  getRefreshToken: number;
  removeRefreshToken: number;
  getAccessToken: number;
  testDrive: number;
};

// ── Module mocks (registered at module eval, before any dynamic import) ──────
mock.module('@/lib/supabase/server', {
  namedExports: {
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: mockAuthUser }, error: null }),
      },
    }),
  },
});

mock.module('@/server/services/google-drive-connection', {
  namedExports: {
    getUserDriveRefreshToken: async () => {
      calls.getRefreshToken += 1;
      return mockRefreshToken;
    },
    removeUserDriveRefreshToken: async () => {
      calls.removeRefreshToken += 1;
      return mockRemoveResult;
    },
  },
});

mock.module('@/server/services/google-drive-api', {
  namedExports: {
    getGoogleDriveAccessToken: async () => {
      calls.getAccessToken += 1;
      return mockAccessTokenResult;
    },
    testDriveConnection: async () => {
      calls.testDrive += 1;
      return mockTestResult;
    },
  },
});

// ── Per-test PostgREST state served through the fetch fake ───────────────────
interface FetchState {
  // internal_users .single() id (null → not found / not active).
  activeInternalUserId: string | null;
  // user_drive_connections .maybeSingle() existing row (null → none).
  connectionRow: Record<string, unknown> | null;
  // get_drive_connection_stats RPC responder.
  statsResponder: () => Response;
  // user_drive_audit INSERT responder (default 201; can throw to test non-blocking audit).
  auditResponder: () => Response;
}

let state: FetchState;
let internalUsersSelectCalls: number;
let connSelectCalls: number;
let connUpdateCalls: number;
let auditInserts: Array<Record<string, unknown>>;
let statsRpcCalls: number;
let origFetch: typeof globalThis.fetch;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Empty body → postgrest-js yields data=null for .single() and .maybeSingle().
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

    // ── PostgREST: internal_users (SELECT id, .single()) ─────────────────
    if (u.includes('/rest/v1/internal_users')) {
      internalUsersSelectCalls += 1;
      return state.activeInternalUserId
        ? jsonResponse({ id: state.activeInternalUserId })
        : emptyOk();
    }

    // ── PostgREST: user_drive_connections (SELECT .maybeSingle / UPDATE) ─
    if (u.includes('/rest/v1/user_drive_connections')) {
      if (method === 'GET') {
        connSelectCalls += 1;
        // .maybeSingle() → array of 0 or 1 rows.
        return jsonResponse(state.connectionRow ? [state.connectionRow] : []);
      }
      // PATCH (connection_status / last_tested_at / error updates).
      connUpdateCalls += 1;
      return emptyOk(204);
    }

    // ── PostgREST: user_drive_audit (INSERT, non-blocking) ───────────────
    if (u.includes('/rest/v1/user_drive_audit')) {
      recordAuditInsert(parseBody(init));
      return state.auditResponder();
    }

    // ── Supabase RPC: get_drive_connection_stats ─────────────────────────
    if (u.includes('/rest/v1/rpc/get_drive_connection_stats')) {
      statsRpcCalls += 1;
      return state.statsResponder();
    }

    throw new Error(`Unexpected fetch to a non-mocked URL: ${u}`);
  }) as typeof globalThis.fetch;
}

// ── Actions + factory error (dynamic import AFTER mocks + env in place) ───────
let getUserDriveConnection: typeof import('../actions').getUserDriveConnection;
let testUserDriveConnection: typeof import('../actions').testUserDriveConnection;
let disconnectUserDrive: typeof import('../actions').disconnectUserDrive;
let getDriveConnectionStats: typeof import('../actions').getDriveConnectionStats;
let getAuthorizedDriveClientForUser: typeof import('../actions').getAuthorizedDriveClientForUser;
let UnsafeSupabaseEnvironmentError: typeof import('@/lib/supabase/env-guard.server').UnsafeSupabaseEnvironmentError;

before(async () => {
  ({
    getUserDriveConnection,
    testUserDriveConnection,
    disconnectUserDrive,
    getDriveConnectionStats,
    getAuthorizedDriveClientForUser,
  } = await import('../actions'));
  ({ UnsafeSupabaseEnvironmentError } = await import('@/lib/supabase/env-guard.server'));
});

beforeEach(() => {
  origFetch = globalThis.fetch;

  // Default: healthy happy path.
  mockAuthUser = { id: FAKE_AUTH_USER_ID, email: FAKE_EMAIL };
  mockRefreshToken = FAKE_REFRESH_TOKEN;
  mockRemoveResult = { success: true };
  mockAccessTokenResult = { success: true, accessToken: FAKE_ACCESS_TOKEN };
  mockTestResult = { success: true, email: FAKE_EMAIL };

  calls = { getRefreshToken: 0, removeRefreshToken: 0, getAccessToken: 0, testDrive: 0 };

  internalUsersSelectCalls = 0;
  connSelectCalls = 0;
  connUpdateCalls = 0;
  auditInserts = [];
  statsRpcCalls = 0;

  state = {
    activeInternalUserId: FAKE_INTERNAL_USER_ID,
    connectionRow: {
      id: 'conn-1',
      internal_user_id: FAKE_INTERNAL_USER_ID,
      connection_status: 'connected',
      drive_folder_id: FAKE_FOLDER_ID,
    },
    statsResponder: () =>
      jsonResponse([{ total_connected: '3', total_disconnected: '1', total_error: '2' }]),
    auditResponder: () => emptyOk(201),
  };

  // Safe env per test (individual tests override then restore in afterEach).
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
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
function auditEventTypes(): string[] {
  return auditInserts.map((r) => String(r.event_type));
}

function assertNoGoogle(): void {
  assert.equal(calls.getAccessToken, 0, 'must not request a Google access token');
  assert.equal(calls.testDrive, 0, 'must not call the Google Drive test');
}

function assertNoVault(): void {
  assert.equal(calls.getRefreshToken, 0, 'must not read a Vault refresh token');
  assert.equal(calls.removeRefreshToken, 0, 'must not remove a Vault refresh token');
}

function assertNoSecretLeak(haystack: string): void {
  assert.ok(!haystack.includes(FAKE_REFRESH_TOKEN), 'refresh token must never leak');
  assert.ok(!haystack.includes(FAKE_ACCESS_TOKEN), 'access token must never leak');
  assert.ok(!haystack.includes(FAKE_SERVICE_KEY), 'service-role key must never leak');
}

// ════════════════════════════════════════════════════════════════════════════
describe('drive/actions (offline server actions)', () => {
  // ── 1. getUserDriveConnection happy path ─────────────────────────────────
  it('1. getUserDriveConnection returns the current connection, no Google, no Vault', async () => {
    const conn = await getUserDriveConnection();
    assert.ok(conn);
    assert.equal(conn.internal_user_id, FAKE_INTERNAL_USER_ID);
    assert.equal(internalUsersSelectCalls, 1);
    assert.equal(connSelectCalls, 1);
    assertNoGoogle();
    assertNoVault();
  });

  // ── 2. getUserDriveConnection without user ───────────────────────────────
  it('2. getUserDriveConnection with no auth user returns null, no admin reads', async () => {
    mockAuthUser = null;
    const conn = await getUserDriveConnection();
    assert.equal(conn, null);
    assert.equal(internalUsersSelectCalls, 0); // never builds an admin client
    assert.equal(connSelectCalls, 0);
    assertNoGoogle();
    assertNoVault();
  });

  // ── 3. getUserDriveConnection without active internal user ───────────────
  it('3. getUserDriveConnection with no active internal user returns null, no connection read', async () => {
    state.activeInternalUserId = null;
    const conn = await getUserDriveConnection();
    assert.equal(conn, null);
    assert.equal(internalUsersSelectCalls, 1);
    assert.equal(connSelectCalls, 0); // returns before reading connections
    assertNoGoogle();
    assertNoVault();
  });

  // ── 4. testUserDriveConnection without user ──────────────────────────────
  it('4. testUserDriveConnection with no auth user → No autorizado., no Google, no Vault', async () => {
    mockAuthUser = null;
    const res = await testUserDriveConnection();
    assert.deepEqual(res, { success: false, message: 'No autorizado.' });
    assert.equal(auditInserts.length, 0);
    assertNoGoogle();
    assertNoVault();
  });

  // ── 5. testUserDriveConnection without stored refresh token ──────────────
  it('5. testUserDriveConnection without a stored refresh token → exact message, no access token', async () => {
    mockRefreshToken = null;
    const res = await testUserDriveConnection();
    assert.deepEqual(res, {
      success: false,
      message: 'No hay credenciales de Drive almacenadas.',
    });
    // drive_connection_tested audit fired before the refresh-token read.
    assert.deepEqual(auditEventTypes(), ['drive_connection_tested']);
    assert.equal(calls.getRefreshToken, 1);
    assert.equal(calls.getAccessToken, 0); // never reached Google
    assert.equal(calls.testDrive, 0);
  });

  // ── 6. testUserDriveConnection: access-token acquisition fails ───────────
  it('6. testUserDriveConnection when access token cannot be obtained → error message + status update', async () => {
    mockAccessTokenResult = { success: false, error: 'token_denied' };
    const res = await testUserDriveConnection();
    assert.deepEqual(res, {
      success: false,
      message: 'No se pudo obtener acceso a Drive. Verifica la conexión.',
    });
    assert.equal(calls.getAccessToken, 1);
    assert.equal(calls.testDrive, 0); // never reached the Drive test
    assert.ok(connUpdateCalls >= 1); // connection marked error
    assert.ok(auditEventTypes().includes('drive_connection_failed'));
  });

  // ── 7. testUserDriveConnection: Drive test fails ─────────────────────────
  it('7. testUserDriveConnection when the Drive test fails → reconnect message + status update', async () => {
    mockTestResult = { success: false, error: 'drive_unreachable' };
    const res = await testUserDriveConnection();
    assert.deepEqual(res, {
      success: false,
      message: 'La conexión a Drive falló. Reconecta tu cuenta.',
    });
    assert.equal(calls.getAccessToken, 1);
    assert.equal(calls.testDrive, 1);
    assert.ok(connUpdateCalls >= 1);
    assert.ok(auditEventTypes().includes('drive_connection_failed'));
  });

  // ── 8. testUserDriveConnection happy path ────────────────────────────────
  it('8. testUserDriveConnection happy path → verified message, connected update + audits', async () => {
    const res = await testUserDriveConnection();
    assert.deepEqual(res, {
      success: true,
      message: 'Conexión a Google Drive verificada correctamente.',
    });
    assert.equal(calls.getRefreshToken, 1);
    assert.equal(calls.getAccessToken, 1);
    assert.equal(calls.testDrive, 1);
    assert.ok(connUpdateCalls >= 1);
    assert.ok(auditEventTypes().includes('drive_connection_tested'));
    assert.ok(auditEventTypes().includes('drive_connection_succeeded'));
    assertNoSecretLeak(res.message);
  });

  // ── 9. disconnectUserDrive without user ──────────────────────────────────
  it('9. disconnectUserDrive with no auth user → No autorizado., no Vault removal', async () => {
    mockAuthUser = null;
    const res = await disconnectUserDrive();
    assert.deepEqual(res, { success: false, message: 'No autorizado.' });
    assert.equal(calls.removeRefreshToken, 0);
    assert.equal(auditInserts.length, 0);
    assertNoGoogle();
  });

  // ── 10. disconnectUserDrive happy path ───────────────────────────────────
  it('10. disconnectUserDrive happy path → removes Vault token, audits, success message', async () => {
    const res = await disconnectUserDrive();
    assert.deepEqual(res, {
      success: true,
      message: 'Google Drive desconectado correctamente.',
    });
    assert.equal(calls.removeRefreshToken, 1);
    assert.deepEqual(auditEventTypes(), ['drive_disconnected']);
    assertNoGoogle();
  });

  // ── 11. disconnectUserDrive when removal fails ───────────────────────────
  it('11a. disconnectUserDrive with a removal error → preserves error message, no audit', async () => {
    mockRemoveResult = { success: false, error: 'vault_remove_failed' };
    const res = await disconnectUserDrive();
    assert.deepEqual(res, { success: false, message: 'vault_remove_failed' });
    assert.equal(auditInserts.length, 0); // failure short-circuits before audit
    assertNoSecretLeak(res.message);
  });

  it('11b. disconnectUserDrive removal error without a message → fallback Spanish message', async () => {
    mockRemoveResult = { success: false };
    const res = await disconnectUserDrive();
    assert.deepEqual(res, { success: false, message: 'Error al desconectar Drive.' });
  });

  // ── 12. getDriveConnectionStats happy path ───────────────────────────────
  it('12. getDriveConnectionStats parses the RPC row, no Google, no Vault', async () => {
    const stats = await getDriveConnectionStats();
    assert.deepEqual(stats, { total_connected: 3, total_disconnected: 1, total_error: 2 });
    assert.equal(statsRpcCalls, 1);
    assertNoGoogle();
    assertNoVault();
  });

  // ── 13. getDriveConnectionStats empty / error ────────────────────────────
  it('13a. getDriveConnectionStats with an empty RPC result → null', async () => {
    state.statsResponder = () => jsonResponse([]);
    const stats = await getDriveConnectionStats();
    assert.equal(stats, null);
    assertNoGoogle();
    assertNoVault();
  });

  it('13b. getDriveConnectionStats with an RPC error → null', async () => {
    state.statsResponder = () => jsonResponse({ message: 'rpc boom' }, 500);
    const stats = await getDriveConnectionStats();
    assert.equal(stats, null);
  });

  // ── 14. getAuthorizedDriveClientForUser happy path ───────────────────────
  it('14. getAuthorizedDriveClientForUser returns access token + folder, no auth/internal lookup', async () => {
    const res = await getAuthorizedDriveClientForUser(FAKE_INTERNAL_USER_ID);
    assert.deepEqual(res, {
      success: true,
      accessToken: FAKE_ACCESS_TOKEN,
      folderId: FAKE_FOLDER_ID,
    });
    assert.equal(calls.getRefreshToken, 1);
    assert.equal(calls.getAccessToken, 1);
    assert.equal(internalUsersSelectCalls, 0); // takes an explicit id — no auth path
    assert.equal(connSelectCalls, 1);
  });

  // ── 15. getAuthorizedDriveClientForUser failures ─────────────────────────
  it('15a. getAuthorizedDriveClientForUser without a refresh token → error shape', async () => {
    mockRefreshToken = null;
    const res = await getAuthorizedDriveClientForUser(FAKE_INTERNAL_USER_ID);
    assert.deepEqual(res, {
      success: false,
      error: 'No hay credenciales de Drive para este usuario.',
    });
    assert.equal(calls.getAccessToken, 0);
    assert.equal(connSelectCalls, 0);
  });

  it('15b. getAuthorizedDriveClientForUser when access-token acquisition fails → error shape', async () => {
    mockAccessTokenResult = { success: false, error: 'token_denied' };
    const res = await getAuthorizedDriveClientForUser(FAKE_INTERNAL_USER_ID);
    assert.deepEqual(res, { success: false, error: 'token_denied' });
    assert.equal(connSelectCalls, 0); // never reads the connection row
  });

  // ── 16. Audit is non-blocking ────────────────────────────────────────────
  it('16. a failing user_drive_audit insert does not change the main success result', async () => {
    state.auditResponder = () => {
      throw new Error('audit backend down');
    };
    const res = await testUserDriveConnection();
    // logDriveAudit swallows the failure — the primary result is unchanged.
    assert.deepEqual(res, {
      success: true,
      message: 'Conexión a Google Drive verificada correctamente.',
    });
    assert.ok(connUpdateCalls >= 1);
  });

  // ── 17. Fail-closed admin env ────────────────────────────────────────────
  it('17a. missing SUPABASE_SERVICE_ROLE_KEY → action rejects with UnsafeSupabaseEnvironmentError', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Prove the real factory fails closed here.
    const { createSupabaseAdminClient } = await import('@/lib/supabase/admin');
    assert.throws(() => createSupabaseAdminClient(), UnsafeSupabaseEnvironmentError);

    await assert.rejects(
      () => getUserDriveConnection(),
      (err: unknown) => err instanceof UnsafeSupabaseEnvironmentError,
    );
    assertNoGoogle();
    assertNoVault();
  });

  it('17b. missing NEXT_PUBLIC_SUPABASE_URL → action rejects, no silent prod fallback', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await assert.rejects(
      () => getUserDriveConnection(),
      (err: unknown) => err instanceof UnsafeSupabaseEnvironmentError,
    );
    assertNoGoogle();
    assertNoVault();
  });

  // ── 18. Non-production env targeting production Supabase ──────────────────
  it('18. non-production env resolving to the production host → fail-closed, no network', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = PRODUCTION_SUPABASE_URL;
    delete process.env.VERCEL_ENV; // not a production Vercel env
    await assert.rejects(
      () => getUserDriveConnection(),
      (err: unknown) =>
        err instanceof UnsafeSupabaseEnvironmentError &&
        err.reason === 'non_production_environment_targets_production_supabase',
    );
    assert.equal(internalUsersSelectCalls, 0); // never issued a request
    assertNoGoogle();
    assertNoVault();
  });

  // ── 19. No real network ──────────────────────────────────────────────────
  it('19. an unmocked URL (incl. Google/Vault hosts) throws loudly', async () => {
    await assert.rejects(() => globalThis.fetch('https://example.com/real'), /non-mocked URL/);
    await assert.rejects(
      () => globalThis.fetch('https://accounts.google.com/o/oauth2/token'),
      /non-mocked URL/,
    );
    await assert.rejects(
      () => globalThis.fetch('https://www.googleapis.com/drive/v3/about'),
      /non-mocked URL/,
    );
  });

  // ── 20. Sanitization ─────────────────────────────────────────────────────
  it('20. user-visible messages never contain the fake token/service key', async () => {
    const test = await testUserDriveConnection();
    assertNoSecretLeak(test.message);

    const disconnect = await disconnectUserDrive();
    assertNoSecretLeak(disconnect.message);

    mockAccessTokenResult = { success: false, error: 'token_denied' };
    const failed = await testUserDriveConnection();
    assertNoSecretLeak(failed.message);
  });
});
