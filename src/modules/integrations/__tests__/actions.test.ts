// H5.18 — Integrations actions admin-factory migration, offline test.
//
// Exercises the exported server actions of
//   src/modules/integrations/actions.ts
// entirely OFFLINE. This test NEVER runs a real server action against
// production, NEVER calls a real HubSpot / Slack / Samu / Tavily / Google CSE
// endpoint, NEVER touches a real Supabase project or Vault, and NEVER writes
// to a real database.
//
// Mocking strategy (matches the H5.17B drive/actions precedent):
//   - @/lib/supabase/server (createClient) IS module-mocked. The real one
//     reads next/headers cookies() which is unavailable under `node --test`.
//     The session client owns auth.getUser() and the internal_users / roles
//     admin-gate lookups (getAdminInternalUserId reads those through the
//     SESSION client, not the service-role client), so the fake makes the
//     authenticated user + role controllable per test.
//   - The five provider connection services ARE module-mocked:
//       @/server/services/hubspot-connection
//       @/server/services/slack-connection
//       @/server/services/samu-connection
//       @/server/services/tavily-connection
//       @/server/services/google-cse-connection
//     The actions delegate ALL provider I/O and ALL Vault access to these
//     services; the fakes prove the actions never call a real provider or
//     touch Vault directly. None of these services are touched by this hito.
//   - createSupabaseAdminClient() is NOT mocked. The REAL fail-closed factory
//     and its REAL env-guard (getSupabaseServiceRoleEnv) run for every
//     external_integrations / external_integration_connections read+write and
//     every integration_audit insert, so the migration's fail-closed behavior
//     is genuinely exercised.
//   - globalThis.fetch IS mocked and routed by URL + method + Accept. Every
//     PostgREST op on external_integrations, external_integration_connections
//     and integration_audit is served from fakes. ANY unmocked URL throws
//     loudly, so a real network call fails the test. Because every provider
//     service is module-mocked, NO provider/Vault URL ever reaches fetch.
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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ── Fake, non-real values (never real secrets) ──────────────────────────────
const SUPABASE_URL = 'https://fake-local-project.supabase.co';
const FAKE_SERVICE_KEY = 'fake-service-role-key-not-real-0000';
const PRODUCTION_SUPABASE_URL = 'https://lrdruowtadwbdulndlph.supabase.co';
const FAKE_INTERNAL_USER_ID = 'internal-user-1';
const FAKE_AUTH_USER_ID = 'auth-user-1';
const FAKE_EMAIL = 'someone@ubits.co';
const FAKE_ROLE_ID = 'role-admin-1';
const FAKE_INTEGRATION_ID = 'integration-1';
const FAKE_TOKEN = 'fake-hubspot-private-app-token-not-real-0000';
const FAKE_SLACK_BOT_TOKEN = 'xoxb-fake-slack-bot-token-not-real-0000';

// Env MUST be set before the module under test loads.
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
delete process.env.VERCEL_ENV;

// ── Mutable, per-test state driving the SESSION-client mock ──────────────────
let mockAuthUser: { id: string; email?: string } | null = null;
let mockInternalUser: { id: string; role_id: string } | null = null;
let mockRole: { key: string } | null = null;
let sessionFromCalls: Record<string, number>;

// ── Provider service mock state + delegation counters ────────────────────────
interface ProviderTestResult {
  success: boolean;
  error?: string;
  message?: string;
  tokenInfo?: Record<string, unknown>;
  userCount?: number;
  responseTimeMs?: number;
  resultsCount?: number;
  channelId?: string;
  channelName?: string;
  alreadyExists?: boolean;
}

let calls: {
  hubspot: { store: number; remove: number; has: number; test: number };
  slack: {
    store: number;
    remove: number;
    has: number;
    test: number;
    createChannel: number;
    sendTest: number;
    storeOAuth: number;
  };
  samu: { store: number; remove: number; has: number; test: number };
  tavily: { store: number; remove: number; has: number; test: number };
  googleCse: {
    store: number;
    remove: number;
    has: number;
    test: number;
    getCreds: number;
    mask: number;
  };
};

let mockStore: { success: boolean; error?: string };
let mockHasCredential: boolean;
let mockHubspotTest: ProviderTestResult;
let mockSlackTest: ProviderTestResult;
let mockSamuTest: ProviderTestResult;
let mockTavilyTest: ProviderTestResult;
let mockGoogleCseTest: ProviderTestResult;
let mockGoogleCseCreds: { apiKey: string; cx: string } | null;

// ── SESSION client mock (auth + internal_users/roles admin gate) ─────────────
function makeSessionClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: mockAuthUser }, error: null }),
    },
    from(table: string) {
      sessionFromCalls[table] = (sessionFromCalls[table] ?? 0) + 1;
      const builder = {
        select: () => builder,
        eq: () => builder,
        single: async () => {
          if (table === 'internal_users') {
            return {
              data: mockInternalUser,
              error: mockInternalUser ? null : { message: 'not found' },
            };
          }
          if (table === 'roles') {
            return { data: mockRole, error: mockRole ? null : { message: 'not found' } };
          }
          return { data: null, error: null };
        },
      };
      return builder;
    },
  };
}

// ── Module mocks (registered at module eval, before any dynamic import) ──────
mock.module('@/lib/supabase/server', {
  namedExports: {
    createClient: async () => makeSessionClient(),
  },
});

mock.module('@/server/services/hubspot-connection', {
  namedExports: {
    storeHubSpotCredential: async () => {
      calls.hubspot.store += 1;
      return mockStore;
    },
    removeHubSpotCredential: async () => {
      calls.hubspot.remove += 1;
    },
    hasHubSpotCredential: async () => {
      calls.hubspot.has += 1;
      return mockHasCredential;
    },
    testHubSpotConnection: async () => {
      calls.hubspot.test += 1;
      return mockHubspotTest;
    },
  },
});

mock.module('@/server/services/slack-connection', {
  namedExports: {
    storeSlackCredential: async () => {
      calls.slack.store += 1;
      return mockStore;
    },
    removeSlackCredential: async () => {
      calls.slack.remove += 1;
    },
    hasSlackCredential: async () => {
      calls.slack.has += 1;
      return mockHasCredential;
    },
    testSlackConnection: async () => {
      calls.slack.test += 1;
      return mockSlackTest;
    },
    createSlackChannel: async () => {
      calls.slack.createChannel += 1;
      return { success: true, channelId: 'chan-1', channelName: 'sellup' };
    },
    sendSlackTestMessage: async () => {
      calls.slack.sendTest += 1;
      return { success: true, message: 'ok' };
    },
    storeSlackOAuthConfig: async () => {
      calls.slack.storeOAuth += 1;
      return { success: true };
    },
  },
});

mock.module('@/server/services/samu-connection', {
  namedExports: {
    storeSamuApiKey: async () => {
      calls.samu.store += 1;
      return mockStore;
    },
    removeSamuApiKey: async () => {
      calls.samu.remove += 1;
    },
    hasSamuApiKey: async () => {
      calls.samu.has += 1;
      return mockHasCredential;
    },
    testSamuHealth: async () => {
      calls.samu.test += 1;
      return mockSamuTest;
    },
  },
});

mock.module('@/server/services/tavily-connection', {
  namedExports: {
    storeTavilyApiKey: async () => {
      calls.tavily.store += 1;
      return mockStore;
    },
    removeTavilyApiKey: async () => {
      calls.tavily.remove += 1;
    },
    hasTavilyApiKey: async () => {
      calls.tavily.has += 1;
      return mockHasCredential;
    },
    testTavilyConnection: async () => {
      calls.tavily.test += 1;
      return mockTavilyTest;
    },
  },
});

mock.module('@/server/services/google-cse-connection', {
  namedExports: {
    storeGoogleCSECredentials: async () => {
      calls.googleCse.store += 1;
      return mockStore;
    },
    removeGoogleCSECredentials: async () => {
      calls.googleCse.remove += 1;
    },
    hasGoogleCSECredentials: async () => {
      calls.googleCse.has += 1;
      return mockHasCredential;
    },
    testGoogleCSEConnection: async () => {
      calls.googleCse.test += 1;
      return mockGoogleCseTest;
    },
    getGoogleCSECredentials: async () => {
      calls.googleCse.getCreds += 1;
      return mockGoogleCseCreds;
    },
    maskGoogleCSECx: (cx: string) => {
      calls.googleCse.mask += 1;
      return `masked-${String(cx).slice(-2)}`;
    },
  },
});

// ── Per-test PostgREST state served through the fetch fake ───────────────────
interface FetchState {
  // external_integrations: array GET (getAllIntegrations) / .single() lookups.
  integrationsList: Array<Record<string, unknown>>;
  integrationRow: Record<string, unknown> | null;
  // external_integration_connections: array GET (getAllIntegrations) / .single().
  connectionsList: Array<Record<string, unknown>>;
  connectionRow: Record<string, unknown> | null;
  // integration_audit INSERT responder (default 201).
  auditResponder: () => Response;
}

let state: FetchState;
let integrationsSelectCalls: number;
let connSelectCalls: number;
let connUpdateCalls: number;
let connInsertCalls: number;
let connUpdates: Array<Record<string, unknown>>;
let connInserts: Array<Record<string, unknown>>;
let auditInserts: Array<Record<string, unknown>>;
let origFetch: typeof globalThis.fetch;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Empty body → postgrest-js yields data=null for .single() (not-found).
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

function recordInsert(bucket: Array<Record<string, unknown>>, body: unknown): void {
  const rows = Array.isArray(body) ? body : body ? [body] : [];
  for (const row of rows) {
    if (row && typeof row === 'object') bucket.push(row as Record<string, unknown>);
  }
}

function wantsSingle(init: RequestInit | undefined): boolean {
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  return (headers.get('Accept') ?? '').includes('pgrst.object');
}

function installFetch(): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    // ── PostgREST: external_integrations (SELECT array or .single()) ─────
    if (u.includes('/rest/v1/external_integrations')) {
      if (method === 'GET') {
        integrationsSelectCalls += 1;
        if (wantsSingle(init)) {
          return state.integrationRow ? jsonResponse(state.integrationRow) : emptyOk();
        }
        return jsonResponse(state.integrationsList);
      }
      throw new Error(`Unexpected ${method} to external_integrations`);
    }

    // ── PostgREST: external_integration_connections (SELECT/UPDATE/INSERT) ─
    if (u.includes('/rest/v1/external_integration_connections')) {
      if (method === 'GET') {
        connSelectCalls += 1;
        if (wantsSingle(init)) {
          return state.connectionRow ? jsonResponse(state.connectionRow) : emptyOk();
        }
        return jsonResponse(state.connectionsList);
      }
      if (method === 'PATCH') {
        connUpdateCalls += 1;
        recordInsert(connUpdates, parseBody(init));
        return emptyOk(204);
      }
      if (method === 'POST') {
        connInsertCalls += 1;
        recordInsert(connInserts, parseBody(init));
        return emptyOk(201);
      }
      throw new Error(`Unexpected ${method} to external_integration_connections`);
    }

    // ── PostgREST: integration_audit (INSERT) ────────────────────────────
    if (u.includes('/rest/v1/integration_audit')) {
      recordInsert(auditInserts, parseBody(init));
      return state.auditResponder();
    }

    throw new Error(`Unexpected fetch to a non-mocked URL: ${u}`);
  }) as typeof globalThis.fetch;
}

// ── Actions + factory error (dynamic import AFTER mocks + env in place) ───────
let actions: typeof import('../actions');
let UnsafeSupabaseEnvironmentError: typeof import('@/lib/supabase/env-guard.server').UnsafeSupabaseEnvironmentError;

const ACTIONS_SOURCE_PATH = (() => {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '..', 'actions.ts');
})();

before(async () => {
  actions = await import('../actions');
  ({ UnsafeSupabaseEnvironmentError } = await import('@/lib/supabase/env-guard.server'));
});

beforeEach(() => {
  origFetch = globalThis.fetch;

  // Default: authenticated active admin.
  mockAuthUser = { id: FAKE_AUTH_USER_ID, email: FAKE_EMAIL };
  mockInternalUser = { id: FAKE_INTERNAL_USER_ID, role_id: FAKE_ROLE_ID };
  mockRole = { key: 'admin' };
  sessionFromCalls = {};

  mockStore = { success: true };
  mockHasCredential = true;
  mockHubspotTest = {
    success: true,
    tokenInfo: { hubId: 'hub-1', appId: 'app-1', scopes: ['crm.objects.contacts.read'] },
  };
  mockSlackTest = {
    success: true,
    tokenInfo: {
      teamId: 'T1',
      teamName: 'SellUp Workspace',
      botUserId: 'U1',
      appId: 'A1',
    },
  };
  mockSamuTest = { success: true, userCount: 42 };
  mockTavilyTest = { success: true, responseTimeMs: 120, resultsCount: 3 };
  mockGoogleCseTest = { success: true, responseTimeMs: 90, resultsCount: 5 };
  mockGoogleCseCreds = { apiKey: 'fake-cse-key', cx: 'fake-cx-123456' };

  calls = {
    hubspot: { store: 0, remove: 0, has: 0, test: 0 },
    slack: {
      store: 0,
      remove: 0,
      has: 0,
      test: 0,
      createChannel: 0,
      sendTest: 0,
      storeOAuth: 0,
    },
    samu: { store: 0, remove: 0, has: 0, test: 0 },
    tavily: { store: 0, remove: 0, has: 0, test: 0 },
    googleCse: { store: 0, remove: 0, has: 0, test: 0, getCreds: 0, mask: 0 },
  };

  integrationsSelectCalls = 0;
  connSelectCalls = 0;
  connUpdateCalls = 0;
  connInsertCalls = 0;
  connUpdates = [];
  connInserts = [];
  auditInserts = [];

  state = {
    integrationsList: [
      { id: FAKE_INTEGRATION_ID, integration_key: 'hubspot', name: 'HubSpot' },
      { id: 'integration-2', integration_key: 'slack', name: 'Slack' },
    ],
    integrationRow: { id: FAKE_INTEGRATION_ID },
    connectionsList: [
      { id: 'conn-1', integration_id: FAKE_INTEGRATION_ID, connection_status: 'connected' },
    ],
    connectionRow: null,
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

function providerCallTotal(): number {
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  return (
    sum(calls.hubspot) +
    sum(calls.slack) +
    sum(calls.samu) +
    sum(calls.tavily) +
    sum(calls.googleCse)
  );
}

function assertNoSecretLeak(haystack: string | undefined): void {
  const s = haystack ?? '';
  assert.ok(!s.includes(FAKE_SERVICE_KEY), 'service-role key must never leak');
  assert.ok(!s.includes(FAKE_TOKEN), 'hubspot token must never leak');
  assert.ok(!s.includes(FAKE_SLACK_BOT_TOKEN), 'slack bot token must never leak');
}

// ════════════════════════════════════════════════════════════════════════════
describe('integrations/actions (offline server actions)', () => {
  // ── 1. getAllIntegrations happy path ─────────────────────────────────────
  it('1. getAllIntegrations returns integrations joined with connections, no providers', async () => {
    const result = await actions.getAllIntegrations();
    assert.equal(result.length, 2);
    const hubspot = result.find((r) => r.integration_key === 'hubspot');
    assert.ok(hubspot);
    assert.ok(hubspot.connection);
    assert.equal(hubspot.connection?.connection_status, 'connected');
    const slack = result.find((r) => r.integration_key === 'slack');
    assert.equal(slack?.connection, null); // no matching connection row
    // Two array GETs (integrations + connections) via the REAL admin factory.
    assert.equal(integrationsSelectCalls, 1);
    assert.equal(connSelectCalls, 1);
    assert.equal(providerCallTotal(), 0);
  });

  // ── 2. connectHubSpot happy path (representative connect/update action) ───
  it('2. connectHubSpot stores credential, inserts connection, audits, preserves shape', async () => {
    state.connectionRow = null; // no existing connection → INSERT path
    const res = await actions.connectHubSpot(FAKE_TOKEN);
    assert.deepEqual(res, {
      success: true,
      message: 'Credencial guardada correctamente. Ahora puedes probar la conexión.',
    });
    // Delegated to the correct provider service, and ONLY that one.
    assert.equal(calls.hubspot.store, 1);
    assert.equal(calls.slack.store + calls.samu.store + calls.tavily.store + calls.googleCse.store, 0);
    // Connection row inserted (not updated), audit written.
    assert.equal(connInsertCalls, 1);
    assert.equal(connUpdateCalls, 0);
    assert.deepEqual(auditEventTypes(), ['credential_stored']);
    assertNoSecretLeak(res.message);
  });

  it('2b. connectHubSpot rejects a too-short token before any I/O', async () => {
    const res = await actions.connectHubSpot('short');
    assert.deepEqual(res, { success: false, error: 'Token inválido o demasiado corto.' });
    assert.equal(calls.hubspot.store, 0);
    assert.equal(auditInserts.length, 0);
  });

  it('2c. connectHubSpot updates an existing connection instead of inserting', async () => {
    state.connectionRow = { id: 'conn-1' }; // existing → UPDATE path
    const res = await actions.connectHubSpot(FAKE_TOKEN);
    assert.equal(res.success, true);
    assert.equal(connUpdateCalls, 1);
    assert.equal(connInsertCalls, 0);
  });

  // ── 3. testHubSpotConnectionAction happy path (representative test conn.) ──
  it('3. testHubSpotConnectionAction returns provider result shape + audits, no real call', async () => {
    const res = await actions.testHubSpotConnectionAction();
    assert.deepEqual(res, { success: true, error: undefined, message: undefined });
    assert.equal(calls.hubspot.test, 1);
    assert.ok(connUpdateCalls >= 1); // connection marked connected
    assert.ok(auditEventTypes().includes('connection_tested'));
    assert.ok(auditEventTypes().includes('connection_succeeded'));
    assertNoSecretLeak(res.message);
  });

  it('3b. testHubSpotConnectionAction on provider failure records error audit + shape', async () => {
    mockHubspotTest = { success: false, error: 'invalid_token', message: 'Token rechazado.' };
    const res = await actions.testHubSpotConnectionAction();
    assert.deepEqual(res, { success: false, error: 'invalid_token', message: 'Token rechazado.' });
    assert.ok(auditEventTypes().includes('connection_failed'));
    assertNoSecretLeak(res.message);
  });

  // ── 4. disconnectHubSpot (representative disconnect action) ───────────────
  it('4. disconnectHubSpot delegates removal, updates connection, audits', async () => {
    state.connectionRow = { id: 'conn-1' };
    const res = await actions.disconnectHubSpot();
    assert.deepEqual(res, {
      success: true,
      message: 'HubSpot desconectado correctamente.',
    });
    assert.equal(calls.hubspot.remove, 1);
    assert.equal(connUpdateCalls, 1);
    assert.deepEqual(auditEventTypes(), ['disconnected']);
  });

  // ── 5. Admin authorization gate (via getAdminInternalUserId) ─────────────
  it('5a. connectHubSpot with no auth user → No autenticado, no store, no audit', async () => {
    mockAuthUser = null;
    const res = await actions.connectHubSpot(FAKE_TOKEN);
    assert.deepEqual(res, { success: false, error: 'No autenticado' });
    assert.equal(calls.hubspot.store, 0);
    assert.equal(auditInserts.length, 0);
  });

  it('5b. connectHubSpot with a non-admin role → No autorizado, no store', async () => {
    mockRole = { key: 'member' };
    const res = await actions.connectHubSpot(FAKE_TOKEN);
    assert.deepEqual(res, { success: false, error: 'No autorizado' });
    assert.equal(calls.hubspot.store, 0);
    assert.equal(auditInserts.length, 0);
  });

  it('5c. connectHubSpot with inactive/missing internal user → exact message', async () => {
    mockInternalUser = null;
    const res = await actions.connectHubSpot(FAKE_TOKEN);
    assert.deepEqual(res, { success: false, error: 'Usuario no encontrado o inactivo' });
    assert.equal(calls.hubspot.store, 0);
  });

  // ── 6. Audit insert shape is preserved and secret-free ───────────────────
  it('6. integration_audit rows carry event_type/actor/metadata, no secrets', async () => {
    await actions.testHubSpotConnectionAction();
    assert.ok(auditInserts.length >= 2);
    for (const row of auditInserts) {
      assert.equal(typeof row.integration_key, 'string');
      assert.equal(typeof row.event_type, 'string');
      assert.equal(row.actor_user_id, FAKE_INTERNAL_USER_ID);
      const serialized = JSON.stringify(row);
      assertNoSecretLeak(serialized);
    }
    // The success audit carries the safe token metadata (hub/app/scopes only).
    const success = auditInserts.find((r) => r.event_type === 'connection_succeeded');
    assert.ok(success);
    const meta = JSON.stringify(success?.metadata ?? {});
    assert.ok(!meta.includes(FAKE_TOKEN));
  });

  // ── 7. A second provider proves per-service delegation isolation ─────────
  it('7. testSlackConnectionAction delegates to Slack only, preserves shape', async () => {
    state.integrationRow = { id: 'integration-2' };
    const res = await actions.testSlackConnectionAction();
    assert.deepEqual(res, { success: true, error: undefined, message: undefined });
    assert.equal(calls.slack.test, 1);
    assert.equal(calls.hubspot.test, 0);
    assert.equal(calls.samu.test + calls.tavily.test + calls.googleCse.test, 0);
    assert.ok(auditEventTypes().includes('connection_tested'));
    assert.ok(auditEventTypes().includes('connection_succeeded'));
  });

  it('7b. getGoogleCSEIntegration returns masked cx and delegates to CSE service', async () => {
    state.integrationRow = { id: 'integration-3', integration_key: 'google_cse' };
    state.connectionRow = { id: 'conn-3', integration_id: 'integration-3' };
    const res = await actions.getGoogleCSEIntegration();
    assert.ok(res);
    assert.equal(res.cx_masked, 'masked-56');
    assert.equal(calls.googleCse.getCreds, 1);
    assert.equal(calls.googleCse.mask, 1);
    assert.equal(calls.hubspot.test + calls.slack.test, 0);
  });

  // ── 8. Fail-closed admin env (missing config) ────────────────────────────
  it('8a. missing SUPABASE_SERVICE_ROLE_KEY → action rejects with UnsafeSupabaseEnvironmentError', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Prove the real factory fails closed here.
    const { createSupabaseAdminClient } = await import('@/lib/supabase/admin');
    assert.throws(() => createSupabaseAdminClient(), UnsafeSupabaseEnvironmentError);

    await assert.rejects(
      () => actions.getAllIntegrations(),
      (err: unknown) => err instanceof UnsafeSupabaseEnvironmentError,
    );
    assert.equal(providerCallTotal(), 0);
    assert.equal(integrationsSelectCalls, 0); // never issued a request
  });

  it('8b. missing NEXT_PUBLIC_SUPABASE_URL → action rejects, no silent prod fallback', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await assert.rejects(
      () => actions.getAllIntegrations(),
      (err: unknown) => err instanceof UnsafeSupabaseEnvironmentError,
    );
    assert.equal(integrationsSelectCalls, 0);
    assert.equal(providerCallTotal(), 0);
  });

  // ── 9. Non-production env targeting the production host ───────────────────
  it('9. non-production env resolving to the production host → fail-closed, no network', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = PRODUCTION_SUPABASE_URL;
    delete process.env.VERCEL_ENV; // not a production Vercel env
    await assert.rejects(
      () => actions.getAllIntegrations(),
      (err: unknown) =>
        err instanceof UnsafeSupabaseEnvironmentError &&
        err.reason === 'non_production_environment_targets_production_supabase',
    );
    assert.equal(integrationsSelectCalls, 0);
    assert.equal(providerCallTotal(), 0);
  });

  // ── 10. Static regression — migrated file drops all legacy patterns ──────
  it('10. actions.ts no longer contains any pre-migration admin-client pattern', () => {
    const source = readFileSync(ACTIONS_SOURCE_PATH, 'utf8');
    assert.ok(!source.includes('lrdruowtadwbdulndlph.supabase.co'), 'hardcoded prod host removed');
    assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_URL\s*\|\|/, 'no || fallback');
    assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_URL\s*\?\?/, 'no ?? fallback');
    assert.doesNotMatch(source, /createClient\s*\(\s*process\.env\.NEXT_PUBLIC_SUPABASE_URL/);
    assert.ok(!source.includes('createAdminClient'), 'no createAdminClient alias');
    assert.ok(
      !source.includes('enrichment_configuration_unavailable'),
      'legacy error string removed',
    );
    assert.ok(!source.includes('getAdminSupabase()'), 'inline admin helper removed');
    assert.match(
      source,
      /import\s*\{\s*createSupabaseAdminClient\s*\}\s*from\s*['"]@\/lib\/supabase\/admin['"]/,
    );
    assert.match(source, /createSupabaseAdminClient\(\)/);
  });

  // ── 11. No real network — unmocked URLs throw loudly ─────────────────────
  it('11. an unmocked URL (incl. provider hosts) throws loudly', async () => {
    await assert.rejects(() => globalThis.fetch('https://example.com/real'), /non-mocked URL/);
    await assert.rejects(
      () => globalThis.fetch('https://api.hubapi.com/oauth/v1/access-tokens/x'),
      /non-mocked URL/,
    );
    await assert.rejects(
      () => globalThis.fetch('https://slack.com/api/auth.test'),
      /non-mocked URL/,
    );
    await assert.rejects(
      () => globalThis.fetch('https://www.googleapis.com/customsearch/v1'),
      /non-mocked URL/,
    );
  });

  // ── 12. Sanitization — visible messages never carry fake secrets ─────────
  it('12. user-visible messages never contain fake tokens or the service key', async () => {
    const connect = await actions.connectHubSpot(FAKE_TOKEN);
    assertNoSecretLeak(connect.message);

    const test = await actions.testHubSpotConnectionAction();
    assertNoSecretLeak(test.message);

    state.connectionRow = { id: 'conn-1' };
    const disconnect = await actions.disconnectHubSpot();
    assertNoSecretLeak(disconnect.message);
  });
});
