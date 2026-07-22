// H5.13B — Slack connection admin-factory migration, behavioral offline test.
//
// This test NEVER calls the real Slack API, NEVER starts an OAuth flow, NEVER
// sends a real message or creates a real channel, and NEVER touches a real
// Supabase Vault, a real service-role key, or the database. The ONLY thing
// mocked is globalThis.fetch, and every request is routed by URL:
//   - {SUPABASE_URL}/rest/v1/rpc/upsert_vault_secret          → FAKE Vault store result
//   - {SUPABASE_URL}/rest/v1/rpc/delete_vault_secret          → FAKE Vault delete result
//   - {SUPABASE_URL}/rest/v1/rpc/has_vault_secret             → FAKE existence flag
//   - {SUPABASE_URL}/rest/v1/rpc/get_vault_secret_decrypted   → FAKE Vault value (bot token / client secret)
//   - {SUPABASE_URL}/rest/v1/external_integrations            → FAKE integration id row
//   - {SUPABASE_URL}/rest/v1/external_integration_connections → FAKE GET metadata / PATCH result
//   - https://slack.com/api/auth.test                         → FAKE response
//   - https://slack.com/api/users.lookupByEmail               → FAKE response
//   - https://slack.com/api/conversations.open                → FAKE response
//   - https://slack.com/api/conversations.create              → FAKE response
//   - https://slack.com/api/chat.postMessage                  → FAKE response
// Any other URL throws, so a real network call would fail the test loudly.
//
// Because only fetch is mocked, the REAL createSupabaseAdminClient() factory and
// its env-guard (getSupabaseServiceRoleEnv) run unchanged — the migration's
// fail-closed behavior is exercised, not stubbed. The default env below is a
// safe, non-production Supabase target so the factory resolves; one group
// deliberately clears the Supabase env to force the fail-closed throw and assert
// that the admin/Vault/Slack functions reject with UnsafeSupabaseEnvironmentError
// (the exact ai-connection H5.10B / google-cse H5.11B / hubspot H5.12B precedent)
// instead of silently falling back to production or throwing the legacy
// enrichment_configuration_unavailable string. The H2 static guard
// (migrated-fallback-guard.test.ts) independently asserts the source no longer
// carries a hardcoded production fallback or that legacy error string.
//
// Deliberately fake Slack tokens / client secrets are used. Assertions confirm
// they never leak into any returned result or error payload.
//
// All cases live under a SINGLE describe so node:test runs them sequentially —
// the fetch mock and its counters are shared module state.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

type SlackModule = typeof import('../slack-connection');
let storeSlackCredential: SlackModule['storeSlackCredential'];
let removeSlackCredential: SlackModule['removeSlackCredential'];
let hasSlackCredential: SlackModule['hasSlackCredential'];
let storeSlackOAuthConfig: SlackModule['storeSlackOAuthConfig'];
let getSlackOAuthConfig: SlackModule['getSlackOAuthConfig'];
let getSlackClientSecret: SlackModule['getSlackClientSecret'];
let openSlackDMForUser: SlackModule['openSlackDMForUser'];
let testSlackConnection: SlackModule['testSlackConnection'];
let createSlackChannel: SlackModule['createSlackChannel'];
let sendSlackTestMessage: SlackModule['sendSlackTestMessage'];

// Fake, non-real credentials. Never a real Slack token, never a Supabase key.
const FAKE_BOT_TOKEN = 'xoxb-fake-slack-bot-token-not-real-0000';
const FAKE_CLIENT_SECRET = 'fake-slack-client-secret-not-real-0000';
const FAKE_SERVICE_KEY = 'fake-service-role-key-not-real';

const SUPABASE_URL = 'https://fake-local-project.supabase.co';
const RPC_UPSERT = '/rest/v1/rpc/upsert_vault_secret';
const RPC_DELETE = '/rest/v1/rpc/delete_vault_secret';
const RPC_HAS = '/rest/v1/rpc/has_vault_secret';
const RPC_DECRYPTED = '/rest/v1/rpc/get_vault_secret_decrypted';
const CONN_TABLE = '/rest/v1/external_integration_connections';
const INTEG_TABLE = '/rest/v1/external_integrations';
const SLACK_ORIGIN = 'https://slack.com/api/';

const BOT_SECRET_NAME = 'sellup_integration_slack_bot_token';
const CLIENT_SECRET_NAME = 'sellup_integration_slack_client_secret';

let origFetch: typeof globalThis.fetch | null = null;
let slackCalls = 0;
let prevUrl: string | undefined;
let prevKey: string | undefined;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface CapturedReq {
  url: string;
  method: string;
  body: unknown;
  authorization?: string;
}

interface FetchRoutes {
  upsert?: (captured: CapturedReq) => Response;
  delete?: (captured: CapturedReq) => Response;
  hasSecret?: (pName: string) => Response;
  vault?: (pName: string) => Response;
  integration?: (captured: CapturedReq) => Response;
  conn?: (captured: CapturedReq) => Response;
  authTest?: (captured: CapturedReq) => Response;
  lookupByEmail?: (captured: CapturedReq) => Response;
  conversationsOpen?: (captured: CapturedReq) => Response;
  conversationsCreate?: (captured: CapturedReq) => Response;
  postMessage?: (captured: CapturedReq) => Response;
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

function authOf(init: RequestInit | undefined): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Authorization;
}

function captureOf(u: string, init: RequestInit | undefined): CapturedReq {
  return {
    url: u,
    method: (init?.method ?? 'GET').toUpperCase(),
    body: parseBody(init),
    authorization: authOf(init),
  };
}

function installFetch(routes: FetchRoutes): void {
  if (!origFetch) origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.includes(RPC_UPSERT)) {
      return (routes.upsert ?? (() => jsonResponse('fake-vault-secret-id')))(captureOf(u, init));
    }
    if (u.includes(RPC_DELETE)) {
      return (routes.delete ?? (() => jsonResponse(null)))(captureOf(u, init));
    }
    if (u.includes(RPC_HAS)) {
      return (routes.hasSecret ?? (() => jsonResponse(false)))(pNameOf(init));
    }
    if (u.includes(RPC_DECRYPTED)) {
      return (routes.vault ?? (() => jsonResponse(null)))(pNameOf(init));
    }
    // Check the more specific table first: external_integration_connections
    if (u.includes(CONN_TABLE)) {
      const captured = captureOf(u, init);
      return (
        routes.conn ??
        ((c: CapturedReq) =>
          c.method === 'GET'
            ? jsonResponse({ metadata: {} })
            : new Response(null, { status: 204 }))
      )(captured);
    }
    if (u.includes(INTEG_TABLE)) {
      return (routes.integration ?? (() => jsonResponse({ id: 'fake-integration-id' })))(
        captureOf(u, init),
      );
    }
    if (u.startsWith(SLACK_ORIGIN)) {
      slackCalls += 1;
      const captured = captureOf(u, init);
      if (u.includes('auth.test') && routes.authTest) return routes.authTest(captured);
      if (u.includes('users.lookupByEmail') && routes.lookupByEmail) return routes.lookupByEmail(captured);
      if (u.includes('conversations.open') && routes.conversationsOpen) return routes.conversationsOpen(captured);
      if (u.includes('conversations.create') && routes.conversationsCreate) return routes.conversationsCreate(captured);
      if (u.includes('chat.postMessage') && routes.postMessage) return routes.postMessage(captured);
      throw new Error(`Slack endpoint hit unexpectedly: ${u}`);
    }
    throw new Error(`Unexpected fetch to a non-mocked URL: ${u}`);
  }) as typeof globalThis.fetch;
}

before(async () => {
  prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;

  const mod = await import('../slack-connection');
  storeSlackCredential = mod.storeSlackCredential;
  removeSlackCredential = mod.removeSlackCredential;
  hasSlackCredential = mod.hasSlackCredential;
  storeSlackOAuthConfig = mod.storeSlackOAuthConfig;
  getSlackOAuthConfig = mod.getSlackOAuthConfig;
  getSlackClientSecret = mod.getSlackClientSecret;
  openSlackDMForUser = mod.openSlackDMForUser;
  testSlackConnection = mod.testSlackConnection;
  createSlackChannel = mod.createSlackChannel;
  sendSlackTestMessage = mod.sendSlackTestMessage;
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
  slackCalls = 0;
});

/** Assert none of the fake secrets appear in a serialized value. */
function assertNoSecretLeak(value: unknown): void {
  const serialized = JSON.stringify(value) ?? '';
  assert.ok(!serialized.includes(FAKE_BOT_TOKEN), 'bot token must never appear');
  assert.ok(!serialized.includes(FAKE_CLIENT_SECRET), 'client secret must never appear');
  assert.ok(!serialized.includes(FAKE_SERVICE_KEY), 'service-role key must never appear');
}

describe('slack-connection (offline — fake Vault via fetch, mocked fetch, no real Slack, no OAuth, no DB writes)', () => {
  // ── hasSlackCredential ─────────────────────────────────────────────────────

  it('hasSlackCredential returns true when the secret exists', async () => {
    installFetch({ hasSecret: () => jsonResponse(true) });
    assert.equal(await hasSlackCredential(), true);
    assert.equal(slackCalls, 0);
  });

  it('hasSlackCredential returns false when the secret does not exist', async () => {
    installFetch({ hasSecret: () => jsonResponse(false) });
    assert.equal(await hasSlackCredential(), false);
    assert.equal(slackCalls, 0);
  });

  it('hasSlackCredential returns false when the RPC errors (current contract)', async () => {
    installFetch({ hasSecret: () => jsonResponse({ message: 'boom' }, 400) });
    assert.equal(await hasSlackCredential(), false);
    assert.equal(slackCalls, 0);
  });

  // ── storeSlackCredential ───────────────────────────────────────────────────

  it('storeSlackCredential upserts the bot token and PATCHes the connection row', async () => {
    let upsertCall: CapturedReq | undefined;
    let connCall: CapturedReq | undefined;
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

    const result = await storeSlackCredential(FAKE_BOT_TOKEN);

    assert.equal(result.success, true);
    assert.ok(upsertCall);
    const upsertBody = upsertCall!.body as Record<string, unknown>;
    assert.equal(upsertBody.p_name, BOT_SECRET_NAME);
    assert.equal(upsertBody.p_secret, FAKE_BOT_TOKEN);
    assert.ok(connCall);
    const connBody = connCall!.body as Record<string, unknown>;
    assert.equal(connBody.credentials_status, 'stored');
    assert.ok(!JSON.stringify(connBody).includes(FAKE_BOT_TOKEN));
    assert.equal(slackCalls, 0);
    assertNoSecretLeak(result);
  });

  it('storeSlackCredential returns VAULT_STORAGE_ERROR when the upsert fails', async () => {
    installFetch({ upsert: () => jsonResponse({ message: 'nope' }, 400) });
    const result = await storeSlackCredential(FAKE_BOT_TOKEN);
    assert.equal(result.success, false);
    assert.equal(result.error, 'VAULT_STORAGE_ERROR');
    assert.equal(slackCalls, 0);
    assertNoSecretLeak(result);
  });

  // ── removeSlackCredential ──────────────────────────────────────────────────

  it('removeSlackCredential deletes the secret and returns success', async () => {
    let deleteCall: CapturedReq | undefined;
    installFetch({
      delete: (c) => {
        deleteCall = c;
        return jsonResponse(null);
      },
    });
    const result = await removeSlackCredential();
    assert.equal(result.success, true);
    assert.ok(deleteCall);
    assert.equal((deleteCall!.body as Record<string, unknown>).p_name, BOT_SECRET_NAME);
    assert.equal(slackCalls, 0);
  });

  it('removeSlackCredential preserves its success return shape even when the delete RPC responds with an error status', async () => {
    // Current contract: removeSlackCredential does not inspect the RPC error
    // object (supabase-js resolves rather than throws on a non-2xx), so the
    // return shape stays { success: true }. This test locks that behavior
    // rather than asserting an unreachable failure path.
    installFetch({ delete: () => jsonResponse({ message: 'boom' }, 400) });
    const result = await removeSlackCredential();
    assert.equal(result.success, true);
    assert.equal(slackCalls, 0);
  });

  // ── storeSlackOAuthConfig ──────────────────────────────────────────────────

  it('storeSlackOAuthConfig stores the client secret in Vault and metadata in the connection row', async () => {
    let upsertCall: CapturedReq | undefined;
    const connCalls: CapturedReq[] = [];
    installFetch({
      upsert: (c) => {
        upsertCall = c;
        return jsonResponse('vault-client-secret-id');
      },
      conn: (c) => {
        connCalls.push(c);
        return c.method === 'GET' ? jsonResponse({ metadata: {} }) : new Response(null, { status: 204 });
      },
    });

    const result = await storeSlackOAuthConfig(
      'client-id-123',
      FAKE_CLIENT_SECRET,
      'https://app.example.com/api/integrations/slack/oauth/callback',
    );

    assert.equal(result.success, true);
    assert.ok(upsertCall);
    const upsertBody = upsertCall!.body as Record<string, unknown>;
    assert.equal(upsertBody.p_name, CLIENT_SECRET_NAME);
    assert.equal(upsertBody.p_secret, FAKE_CLIENT_SECRET);
    // The PATCH persists client_id / redirect_uri in metadata, never the secret.
    const patch = connCalls.find((c) => c.method === 'PATCH');
    assert.ok(patch);
    const patchBody = patch!.body as Record<string, unknown>;
    const meta = patchBody.metadata as Record<string, unknown>;
    assert.equal(meta.oauth_client_id, 'client-id-123');
    assert.ok(!JSON.stringify(patchBody).includes(FAKE_CLIENT_SECRET));
    assert.equal(slackCalls, 0);
    assertNoSecretLeak(result);
  });

  it('storeSlackOAuthConfig returns failure when the Vault upsert errors and never leaks the secret', async () => {
    installFetch({
      upsert: () => jsonResponse({ message: 'vault down' }, 400),
    });
    const result = await storeSlackOAuthConfig('client-id-123', FAKE_CLIENT_SECRET, 'https://x/cb');
    assert.equal(result.success, false);
    assert.equal(slackCalls, 0);
    assertNoSecretLeak(result);
  });

  it('storeSlackOAuthConfig returns failure when the Slack integration row is not found', async () => {
    installFetch({
      upsert: () => jsonResponse('vault-client-secret-id'),
      integration: () => jsonResponse({}), // no id → getSlackIntegrationId resolves null
    });
    const result = await storeSlackOAuthConfig('client-id-123', FAKE_CLIENT_SECRET, 'https://x/cb');
    assert.equal(result.success, false);
    assert.equal(slackCalls, 0);
    assertNoSecretLeak(result);
  });

  // ── getSlackOAuthConfig ────────────────────────────────────────────────────

  it('getSlackOAuthConfig returns clientId/redirectUri from metadata', async () => {
    installFetch({
      conn: (c) =>
        c.method === 'GET'
          ? jsonResponse({
              metadata: {
                oauth_client_id: 'client-id-abc',
                oauth_redirect_uri: 'https://app.example.com/cb',
              },
            })
          : new Response(null, { status: 204 }),
    });
    const config = await getSlackOAuthConfig();
    assert.ok(config);
    assert.equal(config!.clientId, 'client-id-abc');
    assert.equal(config!.redirectUri, 'https://app.example.com/cb');
    assert.equal(slackCalls, 0);
  });

  it('getSlackOAuthConfig returns null when the metadata is incomplete', async () => {
    installFetch({
      conn: (c) => (c.method === 'GET' ? jsonResponse({ metadata: {} }) : new Response(null, { status: 204 })),
    });
    const config = await getSlackOAuthConfig();
    assert.equal(config, null);
    assert.equal(slackCalls, 0);
  });

  // ── getSlackClientSecret ───────────────────────────────────────────────────

  it('getSlackClientSecret reads the client-secret Vault entry and returns it', async () => {
    let seenPName = '';
    installFetch({
      vault: (pName) => {
        seenPName = pName;
        return jsonResponse(pName === CLIENT_SECRET_NAME ? FAKE_CLIENT_SECRET : null);
      },
    });
    const secret = await getSlackClientSecret();
    assert.equal(seenPName, CLIENT_SECRET_NAME);
    assert.equal(secret, FAKE_CLIENT_SECRET);
    assert.equal(slackCalls, 0);
  });

  it('getSlackClientSecret returns null when the Vault RPC errors', async () => {
    installFetch({ vault: () => jsonResponse({ message: 'boom' }, 400) });
    const secret = await getSlackClientSecret();
    assert.equal(secret, null);
    assert.equal(slackCalls, 0);
  });

  // ── testSlackConnection (auth.test) ────────────────────────────────────────

  it('testSlackConnection returns NO_CREDENTIAL when there is no stored token', async () => {
    installFetch({ vault: () => jsonResponse(null) });
    const result = await testSlackConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'NO_CREDENTIAL');
    assert.equal(slackCalls, 0);
  });

  it('testSlackConnection returns success on a valid auth.test response, token only in Authorization header', async () => {
    let authHeader: string | undefined;
    installFetch({
      vault: () => jsonResponse(FAKE_BOT_TOKEN),
      authTest: (c) => {
        authHeader = c.authorization;
        return jsonResponse({
          ok: true,
          team: 'SellUp Workspace',
          team_id: 'T123',
          user_id: 'U456',
          app_id: 'A789',
        });
      },
    });
    const result = await testSlackConnection();
    assert.equal(result.success, true);
    assert.ok(result.tokenInfo);
    assert.equal(result.tokenInfo!.teamId, 'T123');
    assert.equal(slackCalls, 1);
    assert.equal(authHeader, `Bearer ${FAKE_BOT_TOKEN}`);
    assertNoSecretLeak(result);
  });

  it('testSlackConnection returns INVALID_TOKEN on invalid_auth', async () => {
    installFetch({
      vault: () => jsonResponse(FAKE_BOT_TOKEN),
      authTest: () => jsonResponse({ ok: false, error: 'invalid_auth' }),
    });
    const result = await testSlackConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'INVALID_TOKEN');
    assertNoSecretLeak(result);
  });

  it('testSlackConnection surfaces a MISSING_SCOPE-style error via the generic branch', async () => {
    installFetch({
      vault: () => jsonResponse(FAKE_BOT_TOKEN),
      authTest: () => jsonResponse({ ok: false, error: 'missing_scope' }),
    });
    const result = await testSlackConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'MISSING_SCOPE');
    assertNoSecretLeak(result);
  });

  it('testSlackConnection returns HTTP_ERROR on a non-ok HTTP status', async () => {
    installFetch({
      vault: () => jsonResponse(FAKE_BOT_TOKEN),
      authTest: () => jsonResponse({}, 500),
    });
    const result = await testSlackConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'HTTP_ERROR');
    assert.ok(result.message?.includes('500'));
    assertNoSecretLeak(result);
  });

  it('testSlackConnection returns CONNECTION_ERROR when the request rejects', async () => {
    installFetch({
      vault: () => jsonResponse(FAKE_BOT_TOKEN),
      authTest: () => {
        throw new Error('network down');
      },
    });
    const result = await testSlackConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'CONNECTION_ERROR');
    assertNoSecretLeak(result);
  });

  // ── openSlackDMForUser (lookupByEmail + conversations.open) ─────────────────

  it('openSlackDMForUser returns null when there is no stored token, with no Slack call', async () => {
    installFetch({ vault: () => jsonResponse(null) });
    const channelId = await openSlackDMForUser('user@example.com');
    assert.equal(channelId, null);
    assert.equal(slackCalls, 0);
  });

  it('openSlackDMForUser returns the DM channel id on success', async () => {
    installFetch({
      vault: () => jsonResponse(FAKE_BOT_TOKEN),
      lookupByEmail: () => jsonResponse({ ok: true, user: { id: 'U999' } }),
      conversationsOpen: () => jsonResponse({ ok: true, channel: { id: 'D111' } }),
    });
    const channelId = await openSlackDMForUser('user@example.com');
    assert.equal(channelId, 'D111');
    assert.equal(slackCalls, 2);
  });

  it('openSlackDMForUser returns null when the user is not found in the workspace', async () => {
    installFetch({
      vault: () => jsonResponse(FAKE_BOT_TOKEN),
      lookupByEmail: () => jsonResponse({ ok: false, error: 'users_not_found' }),
    });
    const channelId = await openSlackDMForUser('ghost@example.com');
    assert.equal(channelId, null);
    assert.equal(slackCalls, 1);
  });

  // ── createSlackChannel (conversations.create) ──────────────────────────────

  it('createSlackChannel returns success with the created channel id', async () => {
    installFetch({
      vault: () => jsonResponse(FAKE_BOT_TOKEN),
      conversationsCreate: () => jsonResponse({ ok: true, channel: { id: 'C222', name: 'sellup' } }),
    });
    const result = await createSlackChannel('SellUp');
    assert.equal(result.success, true);
    assert.equal(result.channelId, 'C222');
    assert.equal(slackCalls, 1);
    assertNoSecretLeak(result);
  });

  it('createSlackChannel returns NAME_TAKEN when the channel already exists', async () => {
    installFetch({
      vault: () => jsonResponse(FAKE_BOT_TOKEN),
      conversationsCreate: () => jsonResponse({ ok: false, error: 'name_taken' }),
    });
    const result = await createSlackChannel('SellUp');
    assert.equal(result.success, false);
    assert.equal(result.error, 'NAME_TAKEN');
    assert.equal(result.alreadyExists, true);
    assertNoSecretLeak(result);
  });

  it('createSlackChannel returns MISSING_SCOPE when the bot lacks channels:manage', async () => {
    installFetch({
      vault: () => jsonResponse(FAKE_BOT_TOKEN),
      conversationsCreate: () => jsonResponse({ ok: false, error: 'missing_scope' }),
    });
    const result = await createSlackChannel('SellUp');
    assert.equal(result.success, false);
    assert.equal(result.error, 'MISSING_SCOPE');
    assertNoSecretLeak(result);
  });

  // ── sendSlackTestMessage (chat.postMessage) ────────────────────────────────

  it('sendSlackTestMessage returns success on a valid postMessage response', async () => {
    installFetch({
      vault: () => jsonResponse(FAKE_BOT_TOKEN),
      postMessage: () => jsonResponse({ ok: true }),
    });
    const result = await sendSlackTestMessage('C222');
    assert.equal(result.success, true);
    assert.equal(slackCalls, 1);
    assertNoSecretLeak(result);
  });

  it('sendSlackTestMessage returns CHANNEL_NOT_FOUND', async () => {
    installFetch({
      vault: () => jsonResponse(FAKE_BOT_TOKEN),
      postMessage: () => jsonResponse({ ok: false, error: 'channel_not_found' }),
    });
    const result = await sendSlackTestMessage('C-missing');
    assert.equal(result.success, false);
    assert.equal(result.error, 'CHANNEL_NOT_FOUND');
    assertNoSecretLeak(result);
  });

  it('sendSlackTestMessage returns NOT_IN_CHANNEL', async () => {
    installFetch({
      vault: () => jsonResponse(FAKE_BOT_TOKEN),
      postMessage: () => jsonResponse({ ok: false, error: 'not_in_channel' }),
    });
    const result = await sendSlackTestMessage('C222');
    assert.equal(result.success, false);
    assert.equal(result.error, 'NOT_IN_CHANNEL');
    assertNoSecretLeak(result);
  });

  it('sendSlackTestMessage returns MISSING_SCOPE', async () => {
    installFetch({
      vault: () => jsonResponse(FAKE_BOT_TOKEN),
      postMessage: () => jsonResponse({ ok: false, error: 'missing_scope' }),
    });
    const result = await sendSlackTestMessage('C222');
    assert.equal(result.success, false);
    assert.equal(result.error, 'MISSING_SCOPE');
    assertNoSecretLeak(result);
  });

  // ── Fail-closed: admin/Vault/Slack functions reject when env is unsafe/missing ─

  it('admin/Vault/token-gated functions reject with UnsafeSupabaseEnvironmentError when env is missing, with no network call', async () => {
    const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    installFetch({});
    const isUnsafe = (err: unknown): boolean =>
      err instanceof Error && err.name === 'UnsafeSupabaseEnvironmentError';
    try {
      await assert.rejects(() => hasSlackCredential(), isUnsafe);
      await assert.rejects(() => storeSlackCredential(FAKE_BOT_TOKEN), isUnsafe);
      await assert.rejects(() => removeSlackCredential(), isUnsafe);
      await assert.rejects(
        () => storeSlackOAuthConfig('id', FAKE_CLIENT_SECRET, 'https://x/cb'),
        isUnsafe,
      );
      await assert.rejects(() => getSlackOAuthConfig(), isUnsafe);
      await assert.rejects(() => getSlackClientSecret(), isUnsafe);
      // Slack-facing functions read the token via the admin factory first,
      // so they also fail closed before any Slack call.
      await assert.rejects(() => testSlackConnection(), isUnsafe);
      await assert.rejects(() => openSlackDMForUser('user@example.com'), isUnsafe);
      await assert.rejects(() => createSlackChannel('SellUp'), isUnsafe);
      await assert.rejects(() => sendSlackTestMessage('C222'), isUnsafe);
      assert.equal(slackCalls, 0);
    } finally {
      if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
    }
  });

  // ── Sanitization sweep across Slack error outcomes ─────────────────────────

  it('never surfaces the bot token in any testSlackConnection outcome', async () => {
    const scenarios: Array<() => Response> = [
      () => jsonResponse({ ok: true, team: 'W', team_id: 'T', user_id: 'U', app_id: 'A' }),
      () => jsonResponse({ ok: false, error: 'invalid_auth' }),
      () => jsonResponse({ ok: false, error: 'missing_scope' }),
      () => jsonResponse({}, 500),
    ];
    for (const respond of scenarios) {
      installFetch({
        vault: () => jsonResponse(FAKE_BOT_TOKEN),
        authTest: () => respond(),
      });
      const result = await testSlackConnection();
      assertNoSecretLeak(result);
      if (origFetch) {
        globalThis.fetch = origFetch;
        origFetch = null;
      }
    }
  });
});
