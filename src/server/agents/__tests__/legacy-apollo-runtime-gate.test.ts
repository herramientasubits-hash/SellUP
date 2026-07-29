/**
 * A1-LEGACY-PATH-FENCE-1 — Capa 6 RUNTIME contract for the authoritative Apollo
 * gate inside `runProspectGenerationAgent`.
 *
 * The P0: the legacy cascade called `searchApolloOrganizations` directly and never
 * consulted ENABLE_APOLLO_COMPANY_SEARCH, so the flag that is supposed to be the
 * kill-switch for Apollo company discovery did not gate this path at all — up to
 * 25 credits per click, with no reservation and no idempotency.
 *
 * This runs the REAL agent function and proves at runtime that:
 *   - flag OFF blocks the direct Apollo call (non-CO/CL countries)
 *   - flag OFF blocks the Colombia RUES→Apollo fallback
 *   - flag OFF logs NO provider usage and estimates NO credits for a call that
 *     never happened, and creates no phantom apollo_company_search step
 *   - flag ON preserves the existing behaviour (Apollo called exactly once)
 *
 * Why a local PostgREST stub instead of mocking @supabase/supabase-js: under
 * tsx's CJS transform, `mock.module` does not intercept that package (the mock
 * factory is never invoked), so a supabase mock would silently do nothing and the
 * agent would die at batch creation BEFORE reaching the gate — making every
 * "Apollo was not called" assertion vacuously true. Pointing the real client at a
 * loopback stub keeps the assertions honest: the run genuinely reaches the gate.
 *
 * Apollo, HubSpot and usage logging ARE module-mocked (intra-repo modules, where
 * mock.module works) so no provider is contacted and no credit is spent.
 */

import { describe, it, beforeEach, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ── Spend + write spies ───────────────────────────────────────────────────────

let apolloSearchCalls: unknown[] = [];
let providerUsageLogs: { provider_key?: string; credits_used?: number }[] = [];
let agentRunStepKeys: string[] = [];
let agentRunUpdates: Record<string, unknown>[] = [];
/** Every write the agent sent to the stub, as {method, path, body}. */
let dbWrites: { method: string; path: string; body: Record<string, unknown> }[] = [];

let apolloFlagOn = false;
let ruesShouldThrow = false;

const APOLLO_ORG = {
  id: 'org-1',
  name: 'Acme SA',
  website_url: 'https://acme.example',
  primary_domain: 'acme.example',
  estimated_num_employees: 100,
  industry: 'technology',
  keywords: ['software'],
  short_description: 'Software company',
  linkedin_url: null,
  primary_phone: null,
  organization_city: null,
  organization_country: null,
};

// ── PostgREST stub (loopback only) ────────────────────────────────────────────

let server: http.Server;

/**
 * Minimal PostgREST behaviour: GET/PATCH return an empty set, POST echoes the
 * inserted rows with a synthetic id. `.single()` sends an Accept of
 * `application/vnd.pgrst.object+json`, for which PostgREST returns a bare object.
 */
function startStub(): Promise<number> {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const method = req.method ?? 'GET';
      const path = req.url ?? '';
      const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object');

      let parsed: Record<string, unknown> = {};
      if (raw) {
        try {
          const json = JSON.parse(raw);
          parsed = (Array.isArray(json) ? json[0] : json) ?? {};
        } catch {
          parsed = {};
        }
      }
      if (method !== 'GET') dbWrites.push({ method, path, body: parsed });

      let payload: unknown = [];
      if (method === 'POST') {
        const json = raw ? JSON.parse(raw) : {};
        const rows = (Array.isArray(json) ? json : [json]).map(
          (row: Record<string, unknown>, i: number) => ({ id: `row-${i + 1}`, ...row }),
        );
        payload = wantsObject ? rows[0] : rows;
      } else if (wantsObject) {
        // No row matched — PostgREST answers 406 for object-mode with zero rows.
        res.writeHead(406, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'no rows' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as { port: number }).port);
    });
  });
}

let runProspectGenerationAgent: typeof import('../prospect-generation')['runProspectGenerationAgent'];

before(async () => {
  const port = await startStub();
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

  mock.module('@/lib/feature-flags.server', {
    namedExports: { isApolloCompanySearchEnabled: () => apolloFlagOn },
  });

  mock.module('@/server/integrations/apollo-client', {
    namedExports: {
      searchApolloOrganizations: async (params: unknown) => {
        apolloSearchCalls.push(params);
        return { success: true, data: [APOLLO_ORG], total: 1, error: undefined };
      },
    },
  });

  mock.module('@/server/integrations/hubspot-company-search', {
    namedExports: {
      checkHubSpotCompanyDuplicate: async () => ({ hasDuplicate: false, skipped: true }),
    },
  });

  mock.module('@/modules/usage-tracking/logging', {
    namedExports: {
      createAgentRun: async () => ({ id: 'run-1' }),
      updateAgentRun: async (_id: string, patch: Record<string, unknown>) => {
        agentRunUpdates.push(patch);
      },
      createAgentRunStep: async (input: { step_key: string }) => {
        agentRunStepKeys.push(input.step_key);
        return { id: `step-${agentRunStepKeys.length}` };
      },
      finishAgentRunStep: async () => {},
      logProviderUsage: async (entry: { provider_key?: string }) => {
        providerUsageLogs.push(entry);
      },
      logResultQualityEvent: async () => {},
    },
  });

  mock.module('@/server/source-catalog/run-source-discovery', {
    namedExports: {
      runSourceDiscovery: async () => {
        if (ruesShouldThrow) throw new Error('RUES unavailable');
        return {
          ok: false,
          status: 'official_source_error',
          records: [],
          warnings: [],
          errors: [],
        };
      },
    },
  });

  ({ runProspectGenerationAgent } = await import('../prospect-generation'));
});

after(() => {
  server?.close();
});

beforeEach(() => {
  apolloSearchCalls = [];
  providerUsageLogs = [];
  agentRunStepKeys = [];
  agentRunUpdates = [];
  dbWrites = [];
  apolloFlagOn = false;
  ruesShouldThrow = false;
});

const BASE_PARAMS = {
  country: 'México',
  countryCode: 'MX',
  industry: 'Tecnología',
  targetCount: 10,
  searchDepth: 'basic' as const,
  internalUserId: 'user-1',
};

/** The batch metadata patch that records why Apollo was skipped. */
function skipStatusPatch() {
  return dbWrites.find(
    (w) =>
      w.method === 'PATCH' &&
      w.path.includes('prospect_batches') &&
      (w.body.metadata as Record<string, unknown> | undefined)?.apollo_fallback_status ===
        'disabled_flag_off',
  );
}

// ── Harness self-check ────────────────────────────────────────────────────────
// Without this, every "Apollo was not called" assertion could pass simply because
// the run died before the gate.

describe('harness — the run actually reaches the Apollo gate', () => {
  it('the batch is created, so the gate is genuinely exercised', async () => {
    const result = await runProspectGenerationAgent(BASE_PARAMS);
    assert.ok(
      dbWrites.some((w) => w.method === 'POST' && w.path.includes('prospect_batches')),
      'batch insert reached the database layer',
    );
    assert.ok(result.batchId, 'a batch id was returned — creation did not fail early');
    assert.doesNotMatch(
      result.error ?? '',
      /Error al crear lote/,
      'the run must not die before the gate',
    );
  });
});

// ── Flag OFF: direct Apollo path ──────────────────────────────────────────────

describe('Capa 6 — flag OFF blocks the direct Apollo call', () => {
  it('never calls searchApolloOrganizations', async () => {
    const result = await runProspectGenerationAgent(BASE_PARAMS);
    assert.equal(apolloSearchCalls.length, 0, 'Apollo must not be called');
    assert.equal(result.success, false);
  });

  it('logs NO provider usage for a call that never happened', async () => {
    await runProspectGenerationAgent(BASE_PARAMS);
    const apolloLogs = providerUsageLogs.filter((l) => l.provider_key === 'apollo');
    assert.equal(apolloLogs.length, 0, 'no provider_usage_log for a skipped call');
  });

  it('attributes zero credits and zero cost', async () => {
    const result = await runProspectGenerationAgent(BASE_PARAMS);
    assert.equal(result.estimatedCostUsd, 0);
    assert.equal(result.candidatesCreated, 0);
    assert.equal(providerUsageLogs.filter((l) => (l.credits_used ?? 0) > 0).length, 0);
  });

  it('creates no apollo_company_search step (no phantom audit record)', async () => {
    await runProspectGenerationAgent(BASE_PARAMS);
    assert.equal(agentRunStepKeys.includes('apollo_company_search'), false);
  });

  it('records apollo_fallback_status=disabled_flag_off on the batch', async () => {
    await runProspectGenerationAgent(BASE_PARAMS);
    assert.ok(skipStatusPatch(), 'batch metadata carries the PII-free skip status');
  });

  it('does not invent results — the run closes as failed', async () => {
    const result = await runProspectGenerationAgent(BASE_PARAMS);
    assert.equal(result.success, false);
    assert.ok(agentRunUpdates.some((u) => u.status === 'failed'));
  });

  it('the user-facing error names no flag and no provider', async () => {
    const result = await runProspectGenerationAgent(BASE_PARAMS);
    assert.ok(result.error);
    assert.doesNotMatch(result.error!, /ENABLE_/);
    assert.doesNotMatch(result.error!, /apollo/i);
  });

  it('writes no prospect_candidates — nothing downstream of the blocked call runs', async () => {
    await runProspectGenerationAgent(BASE_PARAMS);
    assert.equal(
      dbWrites.filter((w) => w.method === 'POST' && w.path.includes('prospect_candidates'))
        .length,
      0,
    );
    assert.equal(agentRunStepKeys.includes('hubspot_duplicate_check'), false);
  });
});

// ── Flag OFF: Colombia RUES → Apollo fallback ────────────────────────────────

/**
 * Colombia: verified behaviour at this commit is that Apollo is NEVER reached,
 * with the flag on or off.
 *
 * The `isColombia` branch in runProspectGenerationAgent returns unconditionally
 * (hito 16AK.15E — Apollo does not run as a Colombian fallback), so the RUES→
 * Apollo fallback the brief anticipated does not exist as a live route, and the
 * later `coOfficialFirstMode` block that contains one is unreachable today. These
 * tests pin that invariant so a future change that re-opens a Colombian Apollo
 * route cannot do so silently and unfenced.
 */
describe('Capa 6 — Colombia never reaches Apollo (RUES fallback is not a live route)', () => {
  const CO_PARAMS = {
    ...BASE_PARAMS,
    country: 'Colombia',
    countryCode: 'CO',
    targetCount: 5,
  };

  it('a failed RUES phase does NOT fall back to Apollo', async () => {
    ruesShouldThrow = true;
    const result = await runProspectGenerationAgent(CO_PARAMS);
    assert.equal(apolloSearchCalls.length, 0, 'RUES failure must not reach Apollo');
    assert.equal(providerUsageLogs.filter((l) => l.provider_key === 'apollo').length, 0);
    assert.equal(result.commercialBatch?.skipped, true);
  });

  it('Colombia skips the commercial provider for an official-source reason', async () => {
    ruesShouldThrow = true;
    const result = await runProspectGenerationAgent(CO_PARAMS);
    assert.equal(result.commercialBatch?.reason, 'official_source_satisfied');
  });

  it('Colombia reaches no Apollo call even with the flag ON — the country gate is upstream', async () => {
    apolloFlagOn = true;
    ruesShouldThrow = true;
    await runProspectGenerationAgent(CO_PARAMS);
    assert.equal(apolloSearchCalls.length, 0);
  });

  it('Colombia never creates an apollo_company_search step', async () => {
    ruesShouldThrow = true;
    await runProspectGenerationAgent(CO_PARAMS);
    assert.equal(agentRunStepKeys.includes('apollo_company_search'), false);
  });
});

describe('Capa 6 — Chile never reaches Apollo', () => {
  it('the Chile preview path skips the commercial provider explicitly', async () => {
    apolloFlagOn = true;
    const result = await runProspectGenerationAgent({
      ...BASE_PARAMS,
      country: 'Chile',
      countryCode: 'CL',
      createStructuredSourceBatch: true,
      targetCount: 10,
    });
    assert.equal(apolloSearchCalls.length, 0, 'Chile must never call Apollo');
    assert.equal(result.commercialBatch?.reason, 'chile_preview_no_apollo');
  });
});

// ── Flag ON: existing behaviour preserved ────────────────────────────────────

describe('Capa 6 — flag ON preserves the existing behaviour', () => {
  it('calls searchApolloOrganizations exactly once', async () => {
    apolloFlagOn = true;
    await runProspectGenerationAgent(BASE_PARAMS);
    assert.equal(apolloSearchCalls.length, 1);
  });

  it('creates the apollo_company_search step when the call really happens', async () => {
    apolloFlagOn = true;
    await runProspectGenerationAgent(BASE_PARAMS);
    assert.ok(agentRunStepKeys.includes('apollo_company_search'));
  });

  it('logs Apollo provider usage only when the call really happened', async () => {
    apolloFlagOn = true;
    await runProspectGenerationAgent(BASE_PARAMS);
    assert.equal(providerUsageLogs.filter((l) => l.provider_key === 'apollo').length, 1);
  });

  it('does not stamp the skip status when Apollo actually ran', async () => {
    apolloFlagOn = true;
    await runProspectGenerationAgent(BASE_PARAMS);
    assert.equal(skipStatusPatch(), undefined);
  });

  it('the gate is the ONLY difference: ON reaches Apollo, OFF does not', async () => {
    apolloFlagOn = false;
    await runProspectGenerationAgent(BASE_PARAMS);
    const offCalls = apolloSearchCalls.length;

    apolloSearchCalls = [];
    apolloFlagOn = true;
    await runProspectGenerationAgent(BASE_PARAMS);
    const onCalls = apolloSearchCalls.length;

    assert.equal(offCalls, 0);
    assert.equal(onCalls, 1);
  });
});

// ── No network egress beyond the loopback stub ────────────────────────────────

describe('Capa 6 — the suite contacts no real provider', () => {
  it('the Supabase URL is loopback only', () => {
    assert.match(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('Apollo is a mock — no API key is read and no HTTP call leaves the process', async () => {
    apolloFlagOn = true;
    await runProspectGenerationAgent(BASE_PARAMS);
    // The spy recorded the params, proving the mock (not the real client) ran.
    assert.equal(apolloSearchCalls.length, 1);
    assert.ok(typeof apolloSearchCalls[0] === 'object');
  });
});
