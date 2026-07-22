// H5.14B — Slack OAuth route handlers admin-factory migration, offline test.
//
// Exercises the GET handlers of:
//   - src/app/api/integrations/slack/oauth/start/route.ts
//   - src/app/api/integrations/slack/oauth/callback/route.ts
// entirely OFFLINE. This test NEVER starts a real OAuth flow, NEVER performs a
// real token exchange, NEVER calls a real Slack API, NEVER sends a Slack
// message, NEVER creates a Slack channel, NEVER touches a real Supabase project
// or Vault, and NEVER writes to a real database.
//
// Mocking strategy (matches the H5.13B slack-connection precedent):
//   - @/lib/supabase/server (createClient) IS module-mocked — the real one
//     reads next/headers cookies() which is unavailable under `node --test`.
//     The mock only exposes a fake auth.getUser(), controllable per test.
//   - createSupabaseAdminClient() is NOT mocked. The REAL fail-closed factory
//     and its REAL env-guard (getSupabaseServiceRoleEnv) run on every admin
//     path, so the migration's fail-closed behavior is genuinely exercised.
//   - slack-connection.ts is NOT mocked; its real functions run and build their
//     own real admin client too.
//   - globalThis.fetch IS mocked and routed by URL. Every Supabase PostgREST /
//     RPC call and the single Slack oauth.v2.access call is served from fakes.
//     ANY unmocked URL throws loudly, so a real network call fails the test.
//
// The default env below points at a SAFE, non-production Supabase host so the
// real factory resolves; one group clears the Supabase env to force the
// fail-closed throw (UnsafeSupabaseEnvironmentError) instead of a silent
// fallback to production. All Slack/Supabase credentials are deliberately fake;
// assertions confirm none of them ever leak into a redirect Location or a
// serialized response.
//
// Requires: node --import tsx --experimental-test-module-mocks --test <thisfile>

import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { UnsafeSupabaseEnvironmentError } from '@/lib/supabase/env-guard.server';

// ── Fake, non-real credentials (never real values) ──────────────────────────
const SUPABASE_URL = 'https://fake-local-project.supabase.co';
const FAKE_SERVICE_KEY = 'fake-service-role-key-not-real-0000';
const FAKE_CLIENT_ID = 'fake-slack-client-id-0000';
const FAKE_CLIENT_SECRET = 'fake-slack-client-secret-not-real-0000';
const FAKE_REDIRECT_URI = 'https://app.test/api/integrations/slack/oauth/callback';
const FAKE_ACCESS_TOKEN = 'xoxb-fake-slack-bot-token-not-real-0000';
const FAKE_VAULT_CLIENT_SECRET = 'fake-vault-decrypted-client-secret-0000';
const APP_URL = 'https://app.test';

// Env MUST be set before the route modules load (callback derives module-level
// APP_BASE_URL / SUCCESS_REDIRECT constants at import time).
process.env.NEXT_PUBLIC_APP_URL = APP_URL;
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
process.env.SLACK_CLIENT_ID = FAKE_CLIENT_ID;
process.env.SLACK_CLIENT_SECRET = FAKE_CLIENT_SECRET;
process.env.SLACK_REDIRECT_URI = FAKE_REDIRECT_URI;
// Never let the guard reject on VERCEL_ENV — the fake host is non-production anyway.
delete process.env.VERCEL_ENV;

// ── Mock @/lib/supabase/server (fake auth only) ─────────────────────────────
let mockAuthUser: { id: string } | null = null;

mock.module('@/lib/supabase/server', {
  namedExports: {
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: mockAuthUser }, error: null }),
      },
    }),
  },
});

// ── Per-test controllable Supabase/Slack response state ─────────────────────
interface RouteState {
  internalUser: { id: string; role_id: string } | null;
  role: { key: string } | null;
  auditSelectRows: Array<{ metadata: Record<string, unknown>; created_at: string }>;
  existingConn: { id: string; metadata?: Record<string, unknown> } | null;
  integrationRow: { id: string } | null;
  vaultClientSecret: string | null;
  oauthResponder: (captured: CapturedReq) => Response | Promise<Response>;
}

interface CapturedReq {
  url: string;
  method: string;
  body: unknown;
}

let state: RouteState;
let auditInserts: Array<Record<string, unknown>>;
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

    // ── Supabase Vault RPCs ──────────────────────────────────────────────
    if (u.includes('/rest/v1/rpc/upsert_vault_secret')) {
      return jsonResponse('fake-vault-secret-id');
    }
    if (u.includes('/rest/v1/rpc/get_vault_secret_decrypted')) {
      return jsonResponse(state.vaultClientSecret);
    }

    // ── PostgREST tables ─────────────────────────────────────────────────
    if (u.includes('/rest/v1/internal_users')) {
      return state.internalUser ? jsonResponse(state.internalUser) : emptyOk();
    }
    if (u.includes('/rest/v1/roles')) {
      return state.role ? jsonResponse(state.role) : emptyOk();
    }
    if (u.includes('/rest/v1/integration_audit')) {
      if (method === 'GET') {
        // .maybeSingle() → postgrest-js expects an array (0 or 1 rows).
        return jsonResponse(state.auditSelectRows);
      }
      // INSERT (oauth_started / oauth_failed / oauth_connected)
      recordAuditInsert(parseBody(init));
      return emptyOk(201);
    }
    if (u.includes('/rest/v1/external_integrations')) {
      return state.integrationRow ? jsonResponse(state.integrationRow) : emptyOk();
    }
    if (u.includes('/rest/v1/external_integration_connections')) {
      if (method === 'GET') {
        return state.existingConn ? jsonResponse(state.existingConn) : emptyOk();
      }
      // INSERT / UPDATE of the connection row.
      return emptyOk(204);
    }

    // ── Slack API — only oauth.v2.access is ever legitimate here ─────────
    if (u.startsWith('https://slack.com/api/')) {
      slackApiCalls.push(u);
      if (u.includes('oauth.v2.access')) {
        return state.oauthResponder({ url: u, method, body: init?.body ?? null });
      }
      throw new Error(`Unexpected Slack API call: ${u}`);
    }

    throw new Error(`Unexpected fetch to a non-mocked URL: ${u}`);
  }) as typeof globalThis.fetch;
}

// ── Route handlers (dynamic import AFTER mock + env are in place) ────────────
let startGET: (request: unknown) => Promise<Response>;
let callbackGET: (request: unknown) => Promise<Response>;
let NextRequest: typeof import('next/server').NextRequest;

before(async () => {
  ({ NextRequest } = await import('next/server'));
  ({ GET: startGET } = (await import('../start/route')) as unknown as {
    GET: (request: unknown) => Promise<Response>;
  });
  ({ GET: callbackGET } = (await import('../callback/route')) as unknown as {
    GET: (request: unknown) => Promise<Response>;
  });
});

beforeEach(() => {
  origFetch = globalThis.fetch;
  auditInserts = [];
  slackApiCalls = [];
  mockAuthUser = { id: 'auth-user-1' };
  state = {
    internalUser: { id: 'internal-user-1', role_id: 'role-admin' },
    role: { key: 'admin' },
    auditSelectRows: [],
    existingConn: { id: 'conn-1', metadata: {} },
    integrationRow: { id: 'integration-slack-1' },
    vaultClientSecret: null,
    oauthResponder: () =>
      jsonResponse({
        ok: true,
        access_token: FAKE_ACCESS_TOKEN,
        token_type: 'bot',
        bot_user_id: 'B-fake',
        app_id: 'A-fake',
        team: { id: 'T-fake', name: 'Fake Workspace' },
        authed_user: { id: 'U-fake' },
        scope: 'channels:manage,chat:write',
      }),
  };
  // Default safe env per test (individual tests override then restore).
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
  process.env.SLACK_CLIENT_ID = FAKE_CLIENT_ID;
  process.env.SLACK_CLIENT_SECRET = FAKE_CLIENT_SECRET;
  process.env.SLACK_REDIRECT_URI = FAKE_REDIRECT_URI;
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

function setCookieOf(res: Response): string {
  // Next stores response cookies; expose them regardless of header casing.
  const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === 'function') return getSetCookie.call(res.headers).join('; ');
  return res.headers.get('set-cookie') ?? '';
}

function assertNoSecretLeak(res: Response): void {
  const haystack = `${locationOf(res)} ${setCookieOf(res)} ${JSON.stringify([...res.headers])}`;
  assert.ok(!haystack.includes(FAKE_ACCESS_TOKEN), 'Slack access token must never leak');
  assert.ok(!haystack.includes(FAKE_CLIENT_SECRET), 'Slack client secret must never leak');
  assert.ok(!haystack.includes(FAKE_VAULT_CLIENT_SECRET), 'Vault client secret must never leak');
  assert.ok(!haystack.includes(FAKE_SERVICE_KEY), 'Supabase service-role key must never leak');
}

function startRequest(): unknown {
  return new NextRequest(`${APP_URL}/api/integrations/slack/oauth/start`);
}

function callbackRequest(query: Record<string, string>): unknown {
  const url = new URL(`${APP_URL}/api/integrations/slack/oauth/callback`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url.toString());
}

function countAudit(eventType: string): number {
  return auditInserts.filter((r) => r.event_type === eventType).length;
}

// ════════════════════════════════════════════════════════════════════════════
// START ROUTE
// ════════════════════════════════════════════════════════════════════════════
describe('slack/oauth/start (offline handler)', () => {
  it('1. authenticated admin → redirects to Slack authorize URL with correct params', async () => {
    const res = await startGET(startRequest());
    const location = locationOf(res);

    assert.ok(location.startsWith('https://slack.com/oauth/v2/authorize'), location);
    const authorize = new URL(location);
    assert.equal(authorize.searchParams.get('client_id'), FAKE_CLIENT_ID);
    assert.equal(authorize.searchParams.get('redirect_uri'), FAKE_REDIRECT_URI);
    assert.ok((authorize.searchParams.get('scope') ?? '').includes('chat:write'));
    assert.match(authorize.searchParams.get('state') ?? '', /^[a-f0-9]{32}$/);

    // oauth_started audit written with the state in metadata.
    assert.equal(countAudit('oauth_started'), 1);
    const started = auditInserts.find((r) => r.event_type === 'oauth_started')!;
    const meta = started.metadata as Record<string, unknown>;
    assert.equal(meta.oauth_state, authorize.searchParams.get('state'));

    // No real Slack API call — authorize is a browser redirect, not a fetch.
    assert.deepEqual(slackApiCalls, []);
    assertNoSecretLeak(res);
  });

  it('2. unauthenticated → redirects to /settings, no OAuth, no audit insert', async () => {
    mockAuthUser = null;
    const res = await startGET(startRequest());
    assert.ok(locationOf(res).endsWith('/settings'), locationOf(res));
    assert.equal(auditInserts.length, 0);
    assert.deepEqual(slackApiCalls, []);
  });

  it('3. authenticated non-admin → redirects to /settings, no OAuth started', async () => {
    state.role = { key: 'viewer' };
    const res = await startGET(startRequest());
    assert.ok(locationOf(res).endsWith('/settings'), locationOf(res));
    assert.equal(countAudit('oauth_started'), 0);
    assert.deepEqual(slackApiCalls, []);
  });

  it('4. missing config (no env, no DB config) → error redirect, no OAuth', async () => {
    delete process.env.SLACK_CLIENT_ID;
    delete process.env.SLACK_REDIRECT_URI;
    state.existingConn = { id: 'conn-1', metadata: {} }; // getSlackOAuthConfig → null
    const res = await startGET(startRequest());
    const location = locationOf(res);
    assert.ok(location.includes('/settings/integrations/slack'), location);
    assert.ok(location.includes('error='), location);
    assert.equal(countAudit('oauth_started'), 0);
    assert.deepEqual(slackApiCalls, []);
  });

  it('5. fail-closed: missing service-role key → UnsafeSupabaseEnvironmentError, no fetch, no prod fallback', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    let threw: unknown;
    try {
      await startGET(startRequest());
    } catch (err) {
      threw = err;
    }
    assert.ok(threw instanceof UnsafeSupabaseEnvironmentError, 'must fail closed');
    assert.equal((threw as UnsafeSupabaseEnvironmentError).reason, 'missing_service_role_key');
    // Never silently fell back to production and never hit the network.
    assert.equal(auditInserts.length, 0);
    assert.deepEqual(slackApiCalls, []);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CALLBACK ROUTE
// ════════════════════════════════════════════════════════════════════════════
describe('slack/oauth/callback (offline handler)', () => {
  const VALID_STATE = 'a'.repeat(32);

  function foundState(): void {
    state.auditSelectRows = [
      { metadata: { oauth_state: VALID_STATE }, created_at: new Date(Date.now() - 1000).toISOString() },
    ];
  }

  it('6. Slack reports error/cancellation → error redirect, cookie cleared, no token exchange', async () => {
    const res = await callbackGET(callbackRequest({ error: 'access_denied' }));
    const location = locationOf(res);
    assert.ok(location.includes('/settings/integrations/slack'), location);
    assert.ok(location.includes('error='), location);
    assert.ok(setCookieOf(res).includes('slack_oauth_state='), 'state cookie must be cleared');
    assert.deepEqual(slackApiCalls, []);
  });

  it('7. missing code/state → error redirect, no token exchange', async () => {
    const res = await callbackGET(callbackRequest({ state: VALID_STATE })); // no code
    assert.ok(locationOf(res).includes('error='), locationOf(res));
    assert.deepEqual(slackApiCalls, []);
  });

  it('8. invalid state (no matching audit row) → error redirect, oauth_failed, no token exchange', async () => {
    state.auditSelectRows = []; // not found
    const res = await callbackGET(callbackRequest({ code: 'c1', state: VALID_STATE }));
    assert.ok(locationOf(res).includes('error='), locationOf(res));
    assert.equal(countAudit('oauth_failed'), 1);
    assert.deepEqual(slackApiCalls, []);
  });

  it('9. expired state (outside 10-min window → excluded by query) → error redirect, no token exchange', async () => {
    // The route relies on the created_at gte filter; an expired row simply is not
    // returned by the select, so the fake returns no rows.
    state.auditSelectRows = [];
    const res = await callbackGET(callbackRequest({ code: 'c1', state: VALID_STATE }));
    assert.ok(locationOf(res).includes('error='), locationOf(res));
    assert.deepEqual(slackApiCalls, []);
  });

  it('10. token exchange success → stores credential, success redirect ?connected=1, no leak', async () => {
    foundState();
    const res = await callbackGET(callbackRequest({ code: 'good-code', state: VALID_STATE }));
    const location = locationOf(res);

    assert.ok(location.includes('/settings/integrations/slack'), location);
    assert.ok(location.includes('connected=1'), location);
    assert.ok(!location.includes('error='), location);

    // Exactly one Slack call — the token exchange.
    assert.equal(slackApiCalls.length, 1);
    assert.ok(slackApiCalls[0].includes('oauth.v2.access'));

    assert.equal(countAudit('oauth_connected'), 1);
    assert.ok(setCookieOf(res).includes('slack_oauth_state='), 'state cookie cleared on success');

    // Token must never appear in the redirect or serialized headers.
    assertNoSecretLeak(res);
  });

  it('11. token exchange ok:false → error redirect, oauth_failed, token not leaked', async () => {
    foundState();
    state.oauthResponder = () => jsonResponse({ ok: false, error: 'invalid_code' });
    const res = await callbackGET(callbackRequest({ code: 'bad-code', state: VALID_STATE }));
    const location = locationOf(res);
    assert.ok(location.includes('error='), location);
    assert.ok(location.includes('invalid_code'), location);
    assert.equal(countAudit('oauth_failed'), 1);
    assert.equal(slackApiCalls.length, 1);
    assertNoSecretLeak(res);
  });

  it('12. token exchange network error → error redirect, handled (no unhandled throw)', async () => {
    foundState();
    state.oauthResponder = () => {
      throw new Error('network down');
    };
    const res = await callbackGET(callbackRequest({ code: 'good-code', state: VALID_STATE }));
    assert.ok(locationOf(res).includes('error='), locationOf(res));
    assert.equal(slackApiCalls.length, 1); // attempted once, then caught
  });

  it('13. missing client secret (no env, vault returns null) → error redirect, no token exchange', async () => {
    foundState();
    delete process.env.SLACK_CLIENT_SECRET;
    state.vaultClientSecret = null; // getSlackClientSecret → null
    const res = await callbackGET(callbackRequest({ code: 'good-code', state: VALID_STATE }));
    assert.ok(locationOf(res).includes('error='), locationOf(res));
    assert.deepEqual(slackApiCalls, []); // never reached token exchange
  });

  it('14. sanitization: no fake secret appears in a success redirect', async () => {
    foundState();
    const res = await callbackGET(callbackRequest({ code: 'good-code', state: VALID_STATE }));
    assertNoSecretLeak(res);
  });

  it('15. fail-closed on callback admin path: missing supabase url → UnsafeSupabaseEnvironmentError, no token exchange', async () => {
    // State validation runs first and builds an admin client → fails closed before any Slack call.
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    let threw: unknown;
    try {
      await callbackGET(callbackRequest({ code: 'good-code', state: VALID_STATE }));
    } catch (err) {
      threw = err;
    }
    assert.ok(threw instanceof UnsafeSupabaseEnvironmentError, 'must fail closed');
    assert.deepEqual(slackApiCalls, []);
  });

  it('15b. no real network: an unmocked URL throws loudly (guard against real calls)', async () => {
    await assert.rejects(
      () => origFetch === globalThis.fetch ? Promise.reject(new Error('n/a')) : globalThis.fetch('https://example.com/real'),
      /non-mocked URL/,
    );
  });
});
