// H5.19A — Usage-tracking actions admin-factory migration, offline test.
//
// Exercises the exported server actions of
//   src/modules/usage-tracking/actions.ts
// entirely OFFLINE. This test NEVER runs a real server action against
// production, NEVER calls a real provider, NEVER touches a real Supabase
// project or Vault, and NEVER writes to a real database. The module is
// read-only (SELECT + no writes); the fakes below only ever serve SELECTs.
//
// Mocking strategy (matches the H5.17B / H5.18 admin-factory precedents):
//   - @/lib/supabase/server (createClient) IS module-mocked. The real one
//     reads next/headers cookies() which is unavailable under `node --test`.
//     It owns only the requireAdmin() session lookup here (auth.getUser +
//     internal_users / roles reads); the fake makes the admin gate
//     controllable per test.
//   - next/navigation (redirect) IS module-mocked so a failed admin gate
//     throws a controllable, identifiable error instead of Next's runtime
//     redirect (which is unavailable under `node --test`).
//   - createSupabaseAdminClient() is NOT mocked. The REAL fail-closed factory
//     and its REAL env-guard (getSupabaseServiceRoleEnv) run for the
//     agent_runs / provider_usage_logs / result_quality_events reads, so the
//     migration's fail-closed behavior is genuinely exercised.
//   - globalThis.fetch IS mocked and routed by URL. Every Supabase PostgREST
//     table op is served from fakes. ANY unmocked URL throws loudly, so a real
//     network call fails the test.
//
// The default env points at a SAFE, non-production Supabase host so the real
// factory resolves; dedicated tests clear the Supabase env (or point it at the
// production host in a non-production environment) to force the fail-closed
// throw (UnsafeSupabaseEnvironmentError). The service-role key below is
// deliberately fake; an assertion confirms it never leaks into a result.
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
const FAKE_ROLE_ID = 'role-admin-1';
const FAKE_AUTH_USER_ID = 'auth-user-1';

// Env MUST be set before the module under test loads.
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
delete process.env.VERCEL_ENV;

// ── Mutable, per-test state driving the mocks ───────────────────────────────
let mockAuthUser: { id: string; email?: string } | null = null;
// requireAdmin() reads internal_users then roles through the SESSION client.
let mockInternalUser: { id: string; role_id: string } | null = null;
let mockRoleKey: string | null = null;
// Rows served to the ADMIN client through the fetch fake.
let mockAgentRuns: Array<Record<string, unknown>>;
let mockProviderLogs: Array<Record<string, unknown>>;
let mockQualityEvents: Array<Record<string, unknown>>;

// Track a RedirectError so tests can assert the admin gate blocked.
class RedirectError extends Error {
  readonly target: string;
  constructor(target: string) {
    super(`REDIRECT:${target}`);
    this.name = 'RedirectError';
    this.target = target;
  }
}

// ── Module mocks (registered at module eval, before any dynamic import) ──────
// The SESSION client used only by requireAdmin(). It resolves auth.getUser()
// and the internal_users / roles chained selects from mutable state above.
function makeSessionSelect(table: string) {
  const builder = {
    _filters: {} as Record<string, unknown>,
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    async single() {
      if (table === 'internal_users') {
        return { data: mockInternalUser, error: null };
      }
      if (table === 'roles') {
        return { data: mockRoleKey ? { key: mockRoleKey } : null, error: null };
      }
      return { data: null, error: null };
    },
  };
  return builder;
}

mock.module('@/lib/supabase/server', {
  namedExports: {
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: mockAuthUser }, error: null }),
      },
      from: (table: string) => makeSessionSelect(table),
    }),
  },
});

mock.module('next/navigation', {
  namedExports: {
    redirect: (target: string) => {
      throw new RedirectError(target);
    },
  },
});

// ── fetch fake: serves the ADMIN client's PostgREST SELECTs only ─────────────
let agentRunsSelectCalls: number;
let providerLogsSelectCalls: number;
let qualityEventsSelectCalls: number;
let writeAttempts: number;
let origFetch: typeof globalThis.fetch;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetch(): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    // Read-only module: any non-GET to PostgREST is a regression.
    if (method !== 'GET' && u.includes('/rest/v1/')) {
      writeAttempts += 1;
      throw new Error(`Unexpected write (${method}) to a read-only module: ${u}`);
    }

    if (u.includes('/rest/v1/agent_runs')) {
      agentRunsSelectCalls += 1;
      return jsonResponse(mockAgentRuns);
    }
    if (u.includes('/rest/v1/provider_usage_logs')) {
      providerLogsSelectCalls += 1;
      return jsonResponse(mockProviderLogs);
    }
    if (u.includes('/rest/v1/result_quality_events')) {
      qualityEventsSelectCalls += 1;
      return jsonResponse(mockQualityEvents);
    }

    throw new Error(`Unexpected fetch to a non-mocked URL: ${u}`);
  }) as typeof globalThis.fetch;
}

// ── Actions + factory error (dynamic import AFTER mocks + env in place) ───────
let getUsageSummary: typeof import('../actions').getUsageSummary;
let getRecentUsageActivity: typeof import('../actions').getRecentUsageActivity;
let aggregateUsageSummaryCost: typeof import('../actions').aggregateUsageSummaryCost;
let UnsafeSupabaseEnvironmentError: typeof import('@/lib/supabase/env-guard.server').UnsafeSupabaseEnvironmentError;

before(async () => {
  ({ getUsageSummary, getRecentUsageActivity, aggregateUsageSummaryCost } = await import(
    '../actions'
  ));
  ({ UnsafeSupabaseEnvironmentError } = await import('@/lib/supabase/env-guard.server'));
});

beforeEach(() => {
  origFetch = globalThis.fetch;

  // Default: healthy admin happy path.
  mockAuthUser = { id: FAKE_AUTH_USER_ID, email: 'admin@ubits.co' };
  mockInternalUser = { id: FAKE_INTERNAL_USER_ID, role_id: FAKE_ROLE_ID };
  mockRoleKey = 'admin';

  mockAgentRuns = [
    { status: 'running', estimated_cost_usd: 1 },
    { status: 'failed', estimated_cost_usd: 2 },
    { status: 'succeeded', estimated_cost_usd: 3 },
  ];
  mockProviderLogs = [
    { status: 'ok', estimated_cost_usd: 5 },
    { status: 'error', estimated_cost_usd: null },
    { status: 'rate_limited', estimated_cost_usd: 2 },
  ];
  mockQualityEvents = [{ id: 'q-1' }, { id: 'q-2' }];

  agentRunsSelectCalls = 0;
  providerLogsSelectCalls = 0;
  qualityEventsSelectCalls = 0;
  writeAttempts = 0;

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

// ════════════════════════════════════════════════════════════════════════════
// 1. Static regression — the migrated source never reintroduces inline admin.
// ════════════════════════════════════════════════════════════════════════════
describe('usage-tracking/actions — static migration guard', () => {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  // src/modules/usage-tracking/__tests__ → up 4 → repo root
  const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');
  const source = readFileSync(
    path.join(repoRoot, 'src/modules/usage-tracking/actions.ts'),
    'utf8',
  );

  it('imports createSupabaseAdminClient from @/lib/supabase/admin', () => {
    assert.match(
      source,
      /import\s*\{\s*createSupabaseAdminClient\s*\}\s*from\s*['"]@\/lib\/supabase\/admin['"]/,
    );
  });

  it('calls createSupabaseAdminClient()', () => {
    assert.match(source, /createSupabaseAdminClient\(\)/);
  });

  it('no longer imports createAdminClient from @supabase/supabase-js', () => {
    assert.doesNotMatch(source, /createAdminClient/);
  });

  it('no longer defines the local getAdminClient() helper', () => {
    assert.doesNotMatch(source, /getAdminClient\s*\(/);
  });

  it('does not build an admin client inline via createClient(SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL)', () => {
    assert.doesNotMatch(source, /createClient\s*\(\s*process\.env\.NEXT_PUBLIC_SUPABASE_URL/);
    assert.doesNotMatch(source, /createClient\s*\(\s*url\s*,/);
    assert.doesNotMatch(source, /createClient\s*\(\s*SUPABASE_URL/);
  });

  it('does not read SUPABASE_SERVICE_ROLE_KEY directly', () => {
    assert.doesNotMatch(source, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('does not contain the hardcoded production Supabase host', () => {
    assert.equal(source.includes('lrdruowtadwbdulndlph.supabase.co'), false);
  });

  it('does not contain the NEXT_PUBLIC_SUPABASE_URL || fallback pattern', () => {
    assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_URL\s*\|\|/);
  });

  it('does not contain the NEXT_PUBLIC_SUPABASE_URL ?? fallback pattern', () => {
    assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_URL\s*\?\?/);
  });

  it('does not carry the legacy enrichment_configuration_unavailable error', () => {
    assert.equal(source.includes('enrichment_configuration_unavailable'), false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. getUsageSummary — real factory, fake network, read-only.
// ════════════════════════════════════════════════════════════════════════════
describe('usage-tracking/actions — getUsageSummary (offline)', () => {
  it('aggregates counts and cost totals from the admin reads', async () => {
    const summary = await getUsageSummary();
    assert.deepEqual(summary, {
      total_agent_runs: 3,
      running_agent_runs: 1,
      failed_agent_runs: 1,
      total_provider_calls: 3,
      total_estimated_cost_usd: 7, // 5 + 2; NULL excluded
      has_unknown_cost: true, // the NULL row
      error_calls: 2, // 'error' + 'rate_limited'
    });
    assert.equal(agentRunsSelectCalls, 1);
    assert.equal(providerLogsSelectCalls, 1);
    assert.equal(writeAttempts, 0); // never writes
  });

  it('handles empty result sets as complete zeros', async () => {
    mockAgentRuns = [];
    mockProviderLogs = [];
    const summary = await getUsageSummary();
    assert.equal(summary.total_agent_runs, 0);
    assert.equal(summary.total_provider_calls, 0);
    assert.equal(summary.total_estimated_cost_usd, 0);
    assert.equal(summary.has_unknown_cost, false);
    assert.equal(summary.error_calls, 0);
  });

  it('never surfaces the service-role key in the result', async () => {
    const summary = await getUsageSummary();
    assert.ok(!JSON.stringify(summary).includes(FAKE_SERVICE_KEY));
  });

  // requireAdmin gate — session client, unchanged by this migration.
  it('redirects to /login when there is no auth user (never builds an admin client)', async () => {
    mockAuthUser = null;
    await assert.rejects(
      () => getUsageSummary(),
      (err: unknown) => err instanceof RedirectError && (err as RedirectError).target === '/login',
    );
    assert.equal(agentRunsSelectCalls, 0);
    assert.equal(providerLogsSelectCalls, 0);
  });

  it('redirects to /settings when the user is not an admin (never builds an admin client)', async () => {
    mockRoleKey = 'member';
    await assert.rejects(
      () => getUsageSummary(),
      (err: unknown) =>
        err instanceof RedirectError && (err as RedirectError).target === '/settings',
    );
    assert.equal(agentRunsSelectCalls, 0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. getRecentUsageActivity — real factory, fake network, read-only.
// ════════════════════════════════════════════════════════════════════════════
describe('usage-tracking/actions — getRecentUsageActivity (offline)', () => {
  it('returns the three activity tables from the admin reads', async () => {
    const activity = await getRecentUsageActivity(20);
    assert.equal(activity.agent_runs.length, 3);
    assert.equal(activity.provider_logs.length, 3);
    assert.equal(activity.quality_events.length, 2);
    assert.equal(agentRunsSelectCalls, 1);
    assert.equal(providerLogsSelectCalls, 1);
    assert.equal(qualityEventsSelectCalls, 1);
    assert.equal(writeAttempts, 0); // never writes
  });

  it('coerces missing table data to empty arrays', async () => {
    mockAgentRuns = [];
    mockProviderLogs = [];
    mockQualityEvents = [];
    const activity = await getRecentUsageActivity();
    assert.deepEqual(activity, { agent_runs: [], provider_logs: [], quality_events: [] });
  });

  it('redirects (admin gate) before any admin read when there is no auth user', async () => {
    mockAuthUser = null;
    await assert.rejects(() => getRecentUsageActivity(), RedirectError);
    assert.equal(agentRunsSelectCalls, 0);
    assert.equal(providerLogsSelectCalls, 0);
    assert.equal(qualityEventsSelectCalls, 0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Fail-closed admin env — the REAL factory + env-guard.
// ════════════════════════════════════════════════════════════════════════════
describe('usage-tracking/actions — fail-closed admin env', () => {
  it('missing SUPABASE_SERVICE_ROLE_KEY → getUsageSummary rejects with UnsafeSupabaseEnvironmentError', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Prove the real factory fails closed here.
    const { createSupabaseAdminClient } = await import('@/lib/supabase/admin');
    assert.throws(() => createSupabaseAdminClient(), UnsafeSupabaseEnvironmentError);

    await assert.rejects(
      () => getUsageSummary(),
      (err: unknown) => err instanceof UnsafeSupabaseEnvironmentError,
    );
    // The admin gate passed (session client is mocked), but the read never happened.
    assert.equal(agentRunsSelectCalls, 0);
    assert.equal(providerLogsSelectCalls, 0);
  });

  it('missing NEXT_PUBLIC_SUPABASE_URL → getRecentUsageActivity rejects, no silent prod fallback', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await assert.rejects(
      () => getRecentUsageActivity(),
      (err: unknown) =>
        err instanceof UnsafeSupabaseEnvironmentError &&
        err.reason === 'missing_supabase_url',
    );
    assert.equal(agentRunsSelectCalls, 0);
  });

  it('non-production env resolving to the production host → fail-closed, no network', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = PRODUCTION_SUPABASE_URL;
    delete process.env.VERCEL_ENV; // not a production Vercel env
    await assert.rejects(
      () => getUsageSummary(),
      (err: unknown) =>
        err instanceof UnsafeSupabaseEnvironmentError &&
        err.reason === 'non_production_environment_targets_production_supabase',
    );
    assert.equal(agentRunsSelectCalls, 0);
    assert.equal(providerLogsSelectCalls, 0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. No real network — any unmocked URL throws loudly.
// ════════════════════════════════════════════════════════════════════════════
describe('usage-tracking/actions — no real network', () => {
  it('an unmocked URL throws', async () => {
    await assert.rejects(() => globalThis.fetch('https://example.com/real'), /non-mocked URL/);
  });

  it('any non-GET PostgREST op throws (read-only guarantee)', async () => {
    await assert.rejects(
      () => globalThis.fetch(`${SUPABASE_URL}/rest/v1/agent_runs`, { method: 'POST' }),
      /read-only module/,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. Existing pure behavior — aggregateUsageSummaryCost null-cost semantics.
// ════════════════════════════════════════════════════════════════════════════
describe('usage-tracking/actions — aggregateUsageSummaryCost (pure, unchanged)', () => {
  it('a NULL-cost row contributes 0 and sets has_unknown_cost', () => {
    const result = aggregateUsageSummaryCost([{ estimated_cost_usd: null }]);
    assert.equal(result.total_estimated_cost_usd, 0);
    assert.equal(result.has_unknown_cost, true);
  });

  it('a numeric-zero row contributes 0 but does NOT set has_unknown_cost', () => {
    const result = aggregateUsageSummaryCost([{ estimated_cost_usd: 0 }]);
    assert.equal(result.total_estimated_cost_usd, 0);
    assert.equal(result.has_unknown_cost, false);
  });

  it('a known 5 + an unknown NULL → subtotal 5, has_unknown_cost true', () => {
    const result = aggregateUsageSummaryCost([
      { estimated_cost_usd: 5 },
      { estimated_cost_usd: null },
    ]);
    assert.equal(result.total_estimated_cost_usd, 5);
    assert.equal(result.has_unknown_cost, true);
  });
});
