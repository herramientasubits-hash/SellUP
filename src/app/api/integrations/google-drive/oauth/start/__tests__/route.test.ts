// H5.16C — Google Drive OAuth start admin-factory migration, offline test.
//
// Exercises the GET handler of
//   src/app/api/integrations/google-drive/oauth/start/route.ts
// entirely OFFLINE. This test NEVER runs a real OAuth flow, NEVER calls a real
// Google endpoint, NEVER touches real Google Drive, NEVER touches a real
// Supabase project or Vault, and NEVER writes to a real database.
//
// This route is the sibling of the callback migrated in H5.16B but simpler: it
// only looks up the active internal user, persists a CSRF `state` in
// user_drive_audit and redirects to Google's authorize URL. It performs NO
// token exchange and issues NO fetch to Google — the redirect is a 302, not a
// server-side call. Any fetch to a Google host therefore means a regression and
// must fail the test.
//
// Mocking strategy (matches the H5.14B slack OAuth / H5.15B auth callback /
// H5.16B drive callback precedents):
//   - @/lib/supabase/server (createClient) IS module-mocked. The real one reads
//     next/headers cookies() which is unavailable under `node --test`. It only
//     owns auth.getUser() here; the fake makes the session user controllable.
//   - createSupabaseAdminClient() is NOT mocked. The REAL fail-closed factory
//     and its REAL env-guard (getSupabaseServiceRoleEnv) run for the
//     internal-user lookup and the audit insert, so the migration's fail-closed
//     behavior is genuinely exercised.
//   - globalThis.fetch IS mocked and routed by URL + method. Only the Supabase
//     PostgREST calls (internal_users SELECT, user_drive_audit INSERT) are
//     served. ANY other URL — Google included — throws loudly, so a real
//     network call fails the test.
//
// The default env points at a SAFE, non-production Supabase host so the real
// factory resolves; a dedicated test clears the Supabase env to force the
// fail-closed throw (UnsafeSupabaseEnvironmentError). Because the admin client
// is on this route's path (not caught), that throw rejects the request with no
// silent fallback. All credentials below are deliberately fake; assertions
// confirm none ever leak into a redirect Location.
//
// Requires: node --import tsx --experimental-test-module-mocks --test <thisfile>

import { describe, it, before, beforeEach, afterEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';

// ── Fake, non-real values (never real secrets) ──────────────────────────────
const SUPABASE_URL = 'https://fake-local-project.supabase.co';
const FAKE_SERVICE_KEY = 'fake-service-role-key-not-real-0000';
const APP_ORIGIN = 'https://app.test';
const FAKE_GOOGLE_CLIENT_ID = 'fake-google-client-id.apps.googleusercontent.com';
const FAKE_GOOGLE_REDIRECT_URI = `${APP_ORIGIN}/api/integrations/google-drive/oauth/callback`;
const STATE_USER_ID = 'internal-user-1';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

// Env MUST be set before the route module loads (APP_BASE_URL is module-level).
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
process.env.NEXT_PUBLIC_APP_URL = APP_ORIGIN;
process.env.GOOGLE_DRIVE_CLIENT_ID = FAKE_GOOGLE_CLIENT_ID;
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

// ── Per-test controllable Supabase response state ───────────────────────────
interface RouteState {
  // internal_users .single() id (null → not found / not active).
  activeInternalUserId: string | null;
  // Whether the user_drive_audit INSERT should surface a PostgREST error.
  auditInsertFails: boolean;
}

let state: RouteState;
let auditInserts: Array<Record<string, unknown>>;
let internalUsersSelectCalls: number;
let auditInsertCalls: number;
let fetchedUrls: string[];
let origFetch: typeof globalThis.fetch;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Empty body → postgrest-js yields data=null for .single().
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
    fetchedUrls.push(u);
    const method = (init?.method ?? 'GET').toUpperCase();

    // ── PostgREST: internal_users (SELECT id, .single()) ─────────────────
    if (u.includes('/rest/v1/internal_users')) {
      internalUsersSelectCalls += 1;
      return state.activeInternalUserId
        ? jsonResponse({ id: state.activeInternalUserId })
        : emptyOk();
    }

    // ── PostgREST: user_drive_audit (INSERT drive_oauth_started) ─────────
    if (u.includes('/rest/v1/user_drive_audit')) {
      if (method === 'GET') {
        // The start route never reads this table; only the callback does.
        throw new Error(`Unexpected user_drive_audit GET in start route: ${u}`);
      }
      auditInsertCalls += 1;
      recordAuditInsert(parseBody(init));
      if (state.auditInsertFails) {
        return jsonResponse(
          { code: 'PGRST000', message: 'insert failed', details: null, hint: null },
          400,
        );
      }
      return emptyOk(201);
    }

    // Anything else (Google authorize host, Google APIs, or any real host)
    // is a regression: the start route must never fetch it.
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
  internalUsersSelectCalls = 0;
  auditInsertCalls = 0;
  fetchedUrls = [];

  // Default: healthy happy-path — authenticated active user, audit insert ok.
  mockAuthUser = { id: 'auth-user-1', email: 'someone@ubits.co' };
  state = {
    activeInternalUserId: STATE_USER_ID,
    auditInsertFails: false,
  };

  // Safe env per test (individual tests override then restore in afterEach).
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
  process.env.NEXT_PUBLIC_APP_URL = APP_ORIGIN;
  process.env.GOOGLE_DRIVE_CLIENT_ID = FAKE_GOOGLE_CLIENT_ID;
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

function startRequest(): unknown {
  return new NextRequest(`${APP_ORIGIN}/api/integrations/google-drive/oauth/start`);
}

function calledGoogle(): boolean {
  return fetchedUrls.some(
    (u) => u.includes('accounts.google.com') || u.includes('googleapis.com'),
  );
}

function auditEventTypes(): string[] {
  return auditInserts.map((r) => String(r.event_type));
}

function assertNoSecretLeak(res: Response): void {
  const haystack = `${locationOf(res)} ${JSON.stringify([...res.headers])}`;
  assert.ok(!haystack.includes(FAKE_SERVICE_KEY), 'Supabase service-role key must never leak');
}

// ════════════════════════════════════════════════════════════════════════════
describe('google-drive/oauth/start (offline handler)', () => {
  // ── 1. Missing GOOGLE_DRIVE_CLIENT_ID ───────────────────────────────────
  it('1. missing GOOGLE_DRIVE_CLIENT_ID → error redirect, no admin, no audit, no Google', async () => {
    delete process.env.GOOGLE_DRIVE_CLIENT_ID;
    const res = await GET(startRequest());
    assert.ok(
      locationOf(res).startsWith(`${APP_ORIGIN}/settings/my-drive?error=`),
      locationOf(res),
    );
    assert.equal(internalUsersSelectCalls, 0); // returns before touching Supabase
    assert.equal(auditInsertCalls, 0);
    assert.equal(calledGoogle(), false);
    assertNoSecretLeak(res);
  });

  // ── 2. Unauthenticated user ─────────────────────────────────────────────
  it('2. no authenticated user → /settings redirect, no internal_users lookup, no audit, no Google', async () => {
    mockAuthUser = null;
    const res = await GET(startRequest());
    assert.equal(locationOf(res), `${APP_ORIGIN}/settings`, locationOf(res));
    // getActiveInternalUserId returns before building the admin client.
    assert.equal(internalUsersSelectCalls, 0);
    assert.equal(auditInsertCalls, 0);
    assert.equal(calledGoogle(), false);
    assertNoSecretLeak(res);
  });

  // ── 3. Authenticated but no active internal user ────────────────────────
  it('3. authenticated user without active internal_user → /settings redirect, no audit, no Google', async () => {
    state.activeInternalUserId = null;
    const res = await GET(startRequest());
    assert.equal(locationOf(res), `${APP_ORIGIN}/settings`, locationOf(res));
    assert.equal(internalUsersSelectCalls, 1); // lookup ran, returned none
    assert.equal(auditInsertCalls, 0);
    assert.equal(calledGoogle(), false);
    assertNoSecretLeak(res);
  });

  // ── 4. Audit insert failure ─────────────────────────────────────────────
  it('4. user_drive_audit insert fails → internal-error redirect, no Google', async () => {
    state.auditInsertFails = true;
    const res = await GET(startRequest());
    assert.equal(
      locationOf(res),
      `${APP_ORIGIN}/settings/my-drive?${new URLSearchParams({
        error: 'Error interno al iniciar la conexión.',
      })}`,
      locationOf(res),
    );
    assert.equal(internalUsersSelectCalls, 1);
    assert.equal(auditInsertCalls, 1); // insert attempted
    assert.equal(calledGoogle(), false);
    assertNoSecretLeak(res);
  });

  // ── 5. Happy path ───────────────────────────────────────────────────────
  it('5. authenticated active user + audit ok → redirect to Google authorize URL with all params', async () => {
    const res = await GET(startRequest());
    const location = locationOf(res);

    // Redirects to the Google authorize endpoint.
    assert.ok(location.startsWith(GOOGLE_AUTH_ENDPOINT), location);
    const authUrl = new URL(location);
    assert.equal(authUrl.origin + authUrl.pathname, GOOGLE_AUTH_ENDPOINT);

    // All authorize params preserved.
    assert.equal(authUrl.searchParams.get('client_id'), FAKE_GOOGLE_CLIENT_ID);
    assert.equal(authUrl.searchParams.get('redirect_uri'), FAKE_GOOGLE_REDIRECT_URI);
    assert.equal(authUrl.searchParams.get('response_type'), 'code');
    assert.equal(authUrl.searchParams.get('scope'), DRIVE_SCOPE);
    assert.equal(authUrl.searchParams.get('access_type'), 'offline');
    assert.equal(authUrl.searchParams.get('prompt'), 'consent');
    assert.equal(authUrl.searchParams.get('include_granted_scopes'), 'true');

    // state exists and has the expected hex shape (randomBytes(16) → 32 hex).
    const urlState = authUrl.searchParams.get('state');
    assert.ok(urlState, 'authorize URL must carry a state');
    assert.match(urlState, /^[0-9a-f]{32}$/);

    // Exactly one audit insert, event_type drive_oauth_started, with metadata.
    assert.equal(auditInsertCalls, 1);
    assert.deepEqual(auditEventTypes(), ['drive_oauth_started']);
    const row = auditInserts[0];
    assert.equal(row.internal_user_id, STATE_USER_ID);
    const meta = row.metadata as Record<string, unknown>;
    assert.ok(meta, 'audit row must carry metadata');
    assert.ok(typeof meta.oauth_state === 'string', 'metadata.oauth_state present');
    assert.ok(typeof meta.oauth_state_at === 'string', 'metadata.oauth_state_at present');

    // The persisted oauth_state matches the state on the authorize URL.
    assert.equal(meta.oauth_state, urlState);

    // No Google fetch — the redirect is a 302, not a server-side call.
    assert.equal(calledGoogle(), false);
    assertNoSecretLeak(res);
  });

  // ── 6. Fail-closed admin env ────────────────────────────────────────────
  it('6a. missing SUPABASE_SERVICE_ROLE_KEY → factory throws, request rejects, no Google', async () => {
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

    // The admin client is on the path (no try/catch): GET rejects.
    await assert.rejects(
      () => GET(startRequest()),
      (err: unknown) => err instanceof UnsafeSupabaseEnvironmentError,
    );
    assert.equal(auditInsertCalls, 0);
    assert.equal(calledGoogle(), false);
  });

  it('6b. missing NEXT_PUBLIC_SUPABASE_URL → factory throws, request rejects, no silent prod fallback', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await assert.rejects(
      () => GET(startRequest()),
      (err: unknown) => err instanceof UnsafeSupabaseEnvironmentError,
    );
    assert.equal(auditInsertCalls, 0);
    assert.equal(calledGoogle(), false);
  });

  // ── 7. Sanitization ──────────────────────────────────────────────────────
  it('7. authorize redirect never contains the service-role key (client_id is a public OAuth param)', async () => {
    const res = await GET(startRequest());
    const location = locationOf(res);
    assert.ok(location.startsWith(GOOGLE_AUTH_ENDPOINT), location);
    // Service-role key must never appear anywhere in the redirect.
    assert.ok(!location.includes(FAKE_SERVICE_KEY), 'service-role key must never leak');
    // client_id is a public OAuth parameter and legitimately appears — that's fine.
    assert.equal(new URL(location).searchParams.get('client_id'), FAKE_GOOGLE_CLIENT_ID);
    assertNoSecretLeak(res);
  });

  it('7b. error redirects never leak the service-role key either', async () => {
    state.auditInsertFails = true;
    const res = await GET(startRequest());
    assert.ok(locationOf(res).startsWith(`${APP_ORIGIN}/settings/my-drive?error=`), locationOf(res));
    assertNoSecretLeak(res);
  });

  // ── 8. No real network ────────────────────────────────────────────────────
  it('8a. an unmocked URL throws loudly (guards against real network calls)', async () => {
    await assert.rejects(() => globalThis.fetch('https://example.com/real'), /non-mocked URL/);
  });

  it('8b. happy path issues no fetch to accounts.google.com or Google APIs', async () => {
    await GET(startRequest());
    assert.equal(calledGoogle(), false);
    // Only Supabase PostgREST hosts were contacted.
    for (const u of fetchedUrls) {
      assert.ok(u.includes('/rest/v1/'), `unexpected fetch target: ${u}`);
    }
  });
});
