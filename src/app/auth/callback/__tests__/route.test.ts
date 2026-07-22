// H5.15B — Auth callback admin-factory migration, offline test.
//
// Exercises the GET handler of src/app/auth/callback/route.ts entirely
// OFFLINE. This test NEVER performs a real login, NEVER starts a real OAuth
// flow, NEVER calls a real Slack API, NEVER sends a Slack message, NEVER
// touches a real Supabase project or Vault, and NEVER writes to a real
// database.
//
// Mocking strategy (matches the H5.13B slack-connection / H5.14B slack OAuth
// route precedents):
//   - @/lib/supabase/server (createClient) IS module-mocked. The real one
//     reads next/headers cookies() which is unavailable under `node --test`,
//     and it owns the LOGIN-CRITICAL path we must not exercise for real:
//     auth.exchangeCodeForSession, auth.signOut, rpc('sync_internal_user'),
//     rpc('get_internal_user'). The fake makes every one controllable per test.
//   - createSupabaseAdminClient() is NOT mocked. The REAL fail-closed factory
//     and its REAL env-guard (getSupabaseServiceRoleEnv) run on the Slack DM
//     sidecar path, so the migration's fail-closed behavior is genuinely
//     exercised. openSlackDMForUser / getSlackToken build their own real admin
//     client too — also unmocked.
//   - globalThis.fetch IS mocked and routed by URL. Every Supabase PostgREST /
//     Vault RPC call and every Slack API call is served from fakes. ANY
//     unmocked URL throws loudly, so a real network call fails the test.
//
// The default env below points at a SAFE, non-production Supabase host so the
// real factory resolves; one test clears the Supabase env to force the
// fail-closed throw (UnsafeSupabaseEnvironmentError). The migration's contract
// is that this throw is caught by the existing Slack DM try/catch and login
// still completes. All Supabase/Slack credentials are deliberately fake;
// assertions confirm none of them ever leak into a redirect Location.
//
// Requires: node --import tsx --experimental-test-module-mocks --test <thisfile>

import { describe, it, before, beforeEach, afterEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';

// ── Fake, non-real credentials (never real values) ──────────────────────────
const SUPABASE_URL = 'https://fake-local-project.supabase.co';
const FAKE_SERVICE_KEY = 'fake-service-role-key-not-real-0000';
const FAKE_SLACK_TOKEN = 'xoxb-fake-slack-bot-token-not-real-0000';
const APP_ORIGIN = 'https://app.test';
const UBITS_EMAIL = 'someone@ubits.co';
const NON_UBITS_EMAIL = 'someone@example.com';

// Env MUST be set before the route module (and slack-connection) load.
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
// Never let the guard reject on VERCEL_ENV — the fake host is non-production anyway.
delete process.env.VERCEL_ENV;

// ── Mock @/lib/supabase/server (fake login-critical surface only) ───────────
// Controllable per test. `rpc` dispatches by function name.
interface AuthExchangeResult {
  data: { user: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null } | null;
  error: unknown;
}

let mockExchangeResult: AuthExchangeResult;
let mockSyncResult: { data: unknown; error: unknown };
let mockGetInternalUserResult: { data: unknown; error: unknown };
let signOutCalls: number;
let exchangeCalls: number;
let rpcCalls: string[];

mock.module('@/lib/supabase/server', {
  namedExports: {
    createClient: async () => ({
      auth: {
        exchangeCodeForSession: async () => {
          exchangeCalls += 1;
          return mockExchangeResult;
        },
        signOut: async () => {
          signOutCalls += 1;
          return { error: null };
        },
      },
      rpc: async (fn: string) => {
        rpcCalls.push(fn);
        if (fn === 'sync_internal_user') return mockSyncResult;
        if (fn === 'get_internal_user') return mockGetInternalUserResult;
        throw new Error(`Unexpected server-client rpc: ${fn}`);
      },
    }),
  },
});

// ── Per-test controllable admin PostgREST + Slack response state ────────────
interface RouteState {
  // internal_users SELECT slack_dm_channel_id → this row (or null)
  existingSlackDmChannelId: string | null;
  // Vault get_vault_secret_decrypted → Slack bot token (null → openSlackDMForUser bails)
  vaultSlackToken: string | null;
  // Slack users.lookupByEmail responder
  lookupResponder: () => Response;
  // Slack conversations.open responder
  openResponder: () => Response;
}

let state: RouteState;
let adminSelectCalls: number;
let adminUpdateCalls: number;
let adminUpdateBodies: unknown[];
let slackApiCalls: string[];
let origFetch: typeof globalThis.fetch;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// `.single()` with an empty body → postgrest-js yields data=null (no error).
function emptyOk(status = 200): Response {
  return new Response('', { status, headers: { 'Content-Type': 'application/json' } });
}

function installFetch(): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    // ── Supabase Vault RPC (getSlackToken → get_vault_secret_decrypted) ──
    if (u.includes('/rest/v1/rpc/get_vault_secret_decrypted')) {
      return jsonResponse(state.vaultSlackToken);
    }

    // ── PostgREST: internal_users (SELECT slack_dm_channel_id / UPDATE) ──
    if (u.includes('/rest/v1/internal_users')) {
      if (method === 'GET') {
        adminSelectCalls += 1;
        return state.existingSlackDmChannelId
          ? jsonResponse({ slack_dm_channel_id: state.existingSlackDmChannelId })
          : emptyOk();
      }
      // PATCH (UPDATE slack_dm_channel_id)
      adminUpdateCalls += 1;
      if (init && typeof init.body === 'string') {
        try {
          adminUpdateBodies.push(JSON.parse(init.body));
        } catch {
          adminUpdateBodies.push(init.body);
        }
      }
      return emptyOk(204);
    }

    // ── Slack API — only users.lookupByEmail / conversations.open here ───
    if (u.startsWith('https://slack.com/api/')) {
      slackApiCalls.push(u);
      if (u.includes('users.lookupByEmail')) return state.lookupResponder();
      if (u.includes('conversations.open')) return state.openResponder();
      throw new Error(`Unexpected Slack API call: ${u}`);
    }

    throw new Error(`Unexpected fetch to a non-mocked URL: ${u}`);
  }) as typeof globalThis.fetch;
}

// ── Route handler (dynamic import AFTER mock + env are in place) ─────────────
let GET: (request: Request) => Promise<Response>;
let UnsafeSupabaseEnvironmentError: typeof import('@/lib/supabase/env-guard.server').UnsafeSupabaseEnvironmentError;

before(async () => {
  ({ GET } = (await import('../route')) as unknown as {
    GET: (request: Request) => Promise<Response>;
  });
  ({ UnsafeSupabaseEnvironmentError } = await import('@/lib/supabase/env-guard.server'));
});

beforeEach(() => {
  origFetch = globalThis.fetch;
  exchangeCalls = 0;
  signOutCalls = 0;
  rpcCalls = [];
  adminSelectCalls = 0;
  adminUpdateCalls = 0;
  adminUpdateBodies = [];
  slackApiCalls = [];

  // Default: healthy active ubits.co user with an internal id, no existing DM.
  mockExchangeResult = {
    data: { user: { id: 'auth-user-1', email: UBITS_EMAIL, user_metadata: {} } },
    error: null,
  };
  mockSyncResult = { data: 'internal-user-1', error: null };
  mockGetInternalUserResult = { data: [{ access_status: 'active' }], error: null };

  state = {
    existingSlackDmChannelId: null,
    vaultSlackToken: FAKE_SLACK_TOKEN,
    lookupResponder: () => jsonResponse({ ok: true, user: { id: 'U-fake' } }),
    openResponder: () => jsonResponse({ ok: true, channel: { id: 'D-fake-dm' } }),
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
function locationOf(res: Response): string {
  return res.headers.get('location') ?? '';
}

function callbackRequest(query: Record<string, string> = {}): Request {
  const url = new URL(`${APP_ORIGIN}/auth/callback`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

function assertNoSecretLeak(res: Response): void {
  const haystack = `${locationOf(res)} ${JSON.stringify([...res.headers])}`;
  assert.ok(!haystack.includes(FAKE_SERVICE_KEY), 'Supabase service-role key must never leak');
  assert.ok(!haystack.includes(FAKE_SLACK_TOKEN), 'Slack bot token must never leak');
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Missing code
// ════════════════════════════════════════════════════════════════════════════
describe('auth/callback (offline handler)', () => {
  it('1. missing code → /login?error=missing_auth_code, no exchange, no admin, no Slack', async () => {
    const res = await GET(callbackRequest());
    assert.ok(locationOf(res).endsWith('/login?error=missing_auth_code'), locationOf(res));
    assert.equal(exchangeCalls, 0);
    assert.equal(adminSelectCalls, 0);
    assert.deepEqual(slackApiCalls, []);
    assertNoSecretLeak(res);
  });

  it('2. exchange failure → /login?error=auth_callback_failed, no provisioning, no admin, no Slack', async () => {
    mockExchangeResult = { data: null, error: { message: 'bad code' } };
    const res = await GET(callbackRequest({ code: 'bad' }));
    assert.ok(locationOf(res).endsWith('/login?error=auth_callback_failed'), locationOf(res));
    assert.equal(exchangeCalls, 1);
    assert.deepEqual(rpcCalls, []); // no sync/get provisioning
    assert.equal(adminSelectCalls, 0);
    assert.deepEqual(slackApiCalls, []);
  });

  it('3. no user (exchange ok, user null) → /login?error=auth_callback_failed', async () => {
    mockExchangeResult = { data: { user: null }, error: null };
    const res = await GET(callbackRequest({ code: 'c' }));
    assert.ok(locationOf(res).endsWith('/login?error=auth_callback_failed'), locationOf(res));
    assert.deepEqual(rpcCalls, []);
    assert.deepEqual(slackApiCalls, []);
  });

  it('4. non-ubits domain → signOut called, /login?error=domain_not_authorized, no Slack', async () => {
    mockExchangeResult = {
      data: { user: { id: 'auth-user-1', email: NON_UBITS_EMAIL, user_metadata: {} } },
      error: null,
    };
    const res = await GET(callbackRequest({ code: 'c' }));
    assert.ok(locationOf(res).endsWith('/login?error=domain_not_authorized'), locationOf(res));
    assert.equal(signOutCalls, 1);
    assert.deepEqual(rpcCalls, []); // no provisioning after domain rejection
    assert.equal(adminSelectCalls, 0);
    assert.deepEqual(slackApiCalls, []);
  });

  it('5. sync_internal_user fails → error handled, login continues to access-status flow', async () => {
    // sync error → data null → no internalUserId → Slack block skipped, but
    // get_internal_user still runs and drives the redirect. Behavior unchanged.
    mockSyncResult = { data: null, error: { message: 'sync boom' } };
    mockGetInternalUserResult = { data: [{ access_status: 'active' }], error: null };
    const res = await GET(callbackRequest({ code: 'c' }));
    assert.ok(locationOf(res).endsWith('/pipeline'), locationOf(res));
    assert.deepEqual(rpcCalls, ['sync_internal_user', 'get_internal_user']);
    assert.equal(adminSelectCalls, 0); // internalUserId null → no admin path
    assert.deepEqual(slackApiCalls, []);
  });

  // ── 6. Access status mapping ────────────────────────────────────────────
  const accessCases: Array<[string, string]> = [
    ['pending_approval', '/access-pending'],
    ['rejected', '/access-rejected'],
    ['suspended', '/access-suspended'],
    ['archived', '/access-archived'],
    ['active', '/pipeline'],
  ];
  for (const [status, expectedPath] of accessCases) {
    it(`6. access status "${status}" → ${expectedPath}`, async () => {
      // Existing DM present so the Slack sidecar is a no-op and does not
      // interfere with the redirect being asserted.
      state.existingSlackDmChannelId = 'D-existing';
      mockGetInternalUserResult = { data: [{ access_status: status }], error: null };
      const res = await GET(callbackRequest({ code: 'c' }));
      assert.ok(locationOf(res).endsWith(expectedPath), locationOf(res));
    });
  }

  it('6b. unknown/absent access status → /access-pending (default)', async () => {
    state.existingSlackDmChannelId = 'D-existing';
    mockGetInternalUserResult = { data: [{ access_status: 'weird_unknown' }], error: null };
    const res1 = await GET(callbackRequest({ code: 'c' }));
    assert.ok(locationOf(res1).endsWith('/access-pending'), locationOf(res1));

    // Empty access data also defaults to pending_approval → /access-pending.
    state.existingSlackDmChannelId = 'D-existing';
    mockGetInternalUserResult = { data: [], error: null };
    const res2 = await GET(callbackRequest({ code: 'c' }));
    assert.ok(locationOf(res2).endsWith('/access-pending'), locationOf(res2));
  });

  it('7. active user WITH existing Slack DM → no openSlackDMForUser, no Slack fetch, /pipeline', async () => {
    state.existingSlackDmChannelId = 'D-existing';
    const res = await GET(callbackRequest({ code: 'c' }));
    assert.ok(locationOf(res).endsWith('/pipeline'), locationOf(res));
    assert.equal(adminSelectCalls, 1); // SELECT happened
    assert.equal(adminUpdateCalls, 0); // no UPDATE
    assert.deepEqual(slackApiCalls, []); // openSlackDMForUser never invoked
    assertNoSecretLeak(res);
  });

  it('8. active user WITHOUT Slack DM → Slack lookup+open, admin UPDATE saves channel, /pipeline', async () => {
    state.existingSlackDmChannelId = null;
    const res = await GET(callbackRequest({ code: 'c' }));
    assert.ok(locationOf(res).endsWith('/pipeline'), locationOf(res));
    assert.equal(adminSelectCalls, 1);
    // Both Slack endpoints hit, in order.
    assert.equal(slackApiCalls.length, 2);
    assert.ok(slackApiCalls[0].includes('users.lookupByEmail'));
    assert.ok(slackApiCalls[1].includes('conversations.open'));
    // Admin UPDATE persisted the resolved channel id.
    assert.equal(adminUpdateCalls, 1);
    const body = adminUpdateBodies[0] as Record<string, unknown>;
    assert.equal(body.slack_dm_channel_id, 'D-fake-dm');
    assertNoSecretLeak(res);
  });

  it('9. Slack DM failure (lookup ok:false) → caught, no UPDATE, login continues to /pipeline', async () => {
    state.existingSlackDmChannelId = null;
    state.lookupResponder = () => jsonResponse({ ok: false, error: 'users_not_found' });
    const res = await GET(callbackRequest({ code: 'c' }));
    assert.ok(locationOf(res).endsWith('/pipeline'), locationOf(res));
    assert.equal(slackApiCalls.length, 1); // only the lookup attempt
    assert.equal(adminUpdateCalls, 0); // no channel resolved → no update
  });

  it('9b. Slack DM failure (network throw) → caught, login continues to /pipeline', async () => {
    state.existingSlackDmChannelId = null;
    state.lookupResponder = () => {
      throw new Error('slack network down');
    };
    const res = await GET(callbackRequest({ code: 'c' }));
    assert.ok(locationOf(res).endsWith('/pipeline'), locationOf(res));
    assert.equal(adminUpdateCalls, 0);
  });

  it('10. fail-closed: missing service-role key → factory throws, caught, login continues to /pipeline, no prod fallback, no Slack', async () => {
    state.existingSlackDmChannelId = null;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Prove the real factory would throw UnsafeSupabaseEnvironmentError here.
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

    // The route must swallow that throw in the Slack DM try/catch and still
    // complete login. No silent fallback to production, no Slack call.
    const res = await GET(callbackRequest({ code: 'c' }));
    assert.ok(locationOf(res).endsWith('/pipeline'), locationOf(res));
    assert.equal(adminSelectCalls, 0); // never built a client / hit PostgREST
    assert.deepEqual(slackApiCalls, []);
    assertNoSecretLeak(res);
  });

  it('11. sanitization: fake service key and Slack token never appear in the redirect Location', async () => {
    state.existingSlackDmChannelId = null;
    const res = await GET(callbackRequest({ code: 'c' }));
    assert.ok(locationOf(res).endsWith('/pipeline'), locationOf(res));
    assertNoSecretLeak(res);
  });

  it('12. no real network: an unmocked URL throws loudly (guard against real calls)', async () => {
    await assert.rejects(
      () => globalThis.fetch('https://example.com/real'),
      /non-mocked URL/,
    );
  });
});
