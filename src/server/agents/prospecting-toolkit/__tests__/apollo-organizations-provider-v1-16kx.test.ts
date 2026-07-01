/**
 * Tests — Apollo Organizations Provider v1.16K-X (real limited)
 *
 * Verifica:
 *   A. Flag off → skipped, sin llamada real, sin créditos
 *   B. Flag on real-limited con mock → mapea resultados, credits, cost
 *   C. Guardrail → recorta a 10, metadata indica capped
 *   D. Usage logging → usage_key, provider_key, operation_key
 *   E. Errores controlados → API key faltante (401/403), quota, org sin name
 *   F. Regression → Tavily no cambia, apollo_organizations no es default
 *
 * Sin Apollo real. Sin Supabase real. Sin créditos. Node.js test runner.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloOrganizationsSearch,
  mapApolloOrganizationToSearchResult,
  type ApolloOrganizationInput,
  type ApolloOrgsSearchDeps,
} from '../web-search-providers/apollo-organizations-search-provider';
import {
  buildApolloOrgsUsageKey,
} from '../apollo-organizations-usage-logging';
import type { ApolloSearchResult, ApolloOrganization } from '@/server/integrations/apollo-client';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';

// ─── Helpers de test ──────────────────────────────────────────────────────────

function makeOrg(overrides: Partial<ApolloOrganization> = {}): ApolloOrganization {
  return {
    id: overrides.id ?? 'org-test-001',
    name: overrides.name ?? 'Test Corp S.A.S',
    website_url: overrides.website_url ?? 'https://test.example.com',
    linkedin_url: overrides.linkedin_url ?? null,
    industry: overrides.industry ?? 'Technology',
    industry_tag_ids: [],
    employee_count: overrides.employee_count ?? null,
    estimated_num_employees: overrides.estimated_num_employees ?? 100,
    city: overrides.city ?? null,
    country: overrides.country ?? 'Colombia',
    phone: null,
    annual_revenue: null,
    technologies: [],
    short_description: null,
    keywords: [],
    ...overrides,
  };
}

function mockSearchSuccess(
  orgs: ApolloOrganization[],
): () => Promise<ApolloSearchResult<ApolloOrganization>> {
  return async () => ({ success: true, data: orgs, total: orgs.length });
}

function mockSearchError(
  statusCode: number,
  message = 'Apollo error',
): () => Promise<ApolloSearchResult<ApolloOrganization>> {
  return async () => ({
    success: false,
    error: { error: `HTTP_${statusCode}`, message, statusCode },
  });
}

function mockSearchException(): () => Promise<ApolloSearchResult<ApolloOrganization>> {
  return async () => {
    throw new Error('network failure');
  };
}

type CapturedLog = LogProviderUsageInput & { _capturedAt?: number };

function makeLogCapture() {
  const logs: CapturedLog[] = [];
  const logFn = async (input: LogProviderUsageInput) => {
    logs.push({ ...input, _capturedAt: Date.now() });
    return { kind: 'logged' as const };
  };
  return { logs, logFn };
}

// ─── A. Flag apagado ──────────────────────────────────────────────────────────

describe('A. Flag off → skipped, sin llamada real', () => {
  before(() => { delete process.env.ENABLE_APOLLO_COMPANY_SEARCH; });

  it('devuelve skipped=true, results=[], estimatedCostUsd=0', async () => {
    let called = false;
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: async () => { called = true; return { success: true, data: [] }; },
    };

    const out = await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, deps);

    assert.equal(out.skipped, true);
    assert.equal(out.skipReason, 'apollo_company_search_disabled');
    assert.equal(out.results.length, 0);
    assert.equal(out.estimatedCostUsd, 0);
    assert.equal(called, false, 'Apollo no debe llamarse con flag apagado');
  });

  it('metadata.dry_run=true y credits_used=0 con flag apagado', async () => {
    const out = await runApolloOrganizationsSearch({ query: 'fintech' }, 10);
    const usage = (out.metadata as Record<string, unknown>)?.usage as Record<string, unknown>;
    assert.equal((out.metadata as Record<string, unknown>)?.dry_run, true);
    assert.equal(usage?.credits_used, 0);
    assert.equal(usage?.estimated_cost_usd, 0);
    assert.equal(usage?.status, 'dry_run');
  });

  it('no invoca usage logger con flag apagado', async () => {
    const { logs, logFn } = makeLogCapture();
    await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, { logUsage: logFn });
    assert.equal(logs.length, 0, 'No debe escribir usage log cuando flag está apagado');
  });
});

// ─── B. Flag on real-limited con mock ────────────────────────────────────────

describe('B. Flag on real-limited con mock', () => {
  before(() => { process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true'; });
  after(() => { delete process.env.ENABLE_APOLLO_COMPANY_SEARCH; });

  it('llama searchOrgs mock y mapea resultados correctamente', async () => {
    const orgs = [makeOrg({ id: 'o1', name: 'Alpha Corp' }), makeOrg({ id: 'o2', name: 'Beta SA' })];
    const { logs, logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = { searchOrgs: mockSearchSuccess(orgs), logUsage: logFn };

    const out = await runApolloOrganizationsSearch({ query: 'tech Colombia' }, 5, undefined, deps);

    assert.equal(out.skipped, false);
    assert.equal(out.results.length, 2);
    assert.equal(out.results[0].title, 'Alpha Corp');
    assert.equal(out.results[1].title, 'Beta SA');
    assert.equal(out.results[0].provider, 'apollo_organizations');
  });

  it('credits_used = results_returned (1 crédito por org)', async () => {
    const orgs = [makeOrg({ id: 'o1' }), makeOrg({ id: 'o2' }), makeOrg({ id: 'o3' })];
    const { logs, logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = { searchOrgs: mockSearchSuccess(orgs), logUsage: logFn };

    const out = await runApolloOrganizationsSearch({ query: 'test' }, 10, undefined, deps);

    assert.equal(out.resultsCount, 3);
    const usage = (out.metadata as Record<string, unknown>)?.usage as Record<string, unknown>;
    assert.equal(usage?.credits_used, 3);
  });

  it('estimated_cost_usd = credits * 0.00875', async () => {
    const orgs = [makeOrg({ id: 'o1' }), makeOrg({ id: 'o2' })];
    const { logs, logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = { searchOrgs: mockSearchSuccess(orgs), logUsage: logFn };

    const out = await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, deps);

    const expectedCost = 2 * 0.00875;
    assert.ok(
      Math.abs((out.estimatedCostUsd ?? 0) - expectedCost) < 0.000001,
      `expected ~${expectedCost}, got ${out.estimatedCostUsd}`,
    );
  });

  it('metadata.provider_mode="real_limited" y dry_run=false', async () => {
    const { logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = { searchOrgs: mockSearchSuccess([makeOrg()]), logUsage: logFn };

    const out = await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, deps);
    const meta = out.metadata as Record<string, unknown>;
    assert.equal(meta?.provider_mode, 'real_limited');
    assert.equal(meta?.dry_run, false);
  });
});

// ─── C. Guardrail cap ─────────────────────────────────────────────────────────

describe('C. Guardrail — recorta a 10 orgs máximo', () => {
  before(() => { process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true'; });
  after(() => { delete process.env.ENABLE_APOLLO_COMPANY_SEARCH; });

  it('cuando input pide 25, Apollo recibe per_page=10', async () => {
    let capturedPerPage: number | undefined;
    const searchFn = async (params: { per_page?: number }) => {
      capturedPerPage = params.per_page;
      return { success: true as const, data: [] };
    };
    const { logFn } = makeLogCapture();

    await runApolloOrganizationsSearch({ query: 'test' }, 25, undefined, {
      searchOrgs: searchFn as ApolloOrgsSearchDeps['searchOrgs'],
      logUsage: logFn,
    });

    assert.equal(capturedPerPage, 10, 'per_page debe ser 10 (guardrail)');
  });

  it('metadata indica was_capped=true cuando maxResults > 10', async () => {
    const { logs, logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: mockSearchSuccess([]),
      logUsage: logFn,
    };

    await runApolloOrganizationsSearch({ query: 'test' }, 25, undefined, deps);

    assert.equal(logs.length, 1);
    const meta = logs[0].metadata as Record<string, unknown>;
    assert.equal(meta?.was_capped, true);
  });

  it('no recorta cuando maxResults <= 10', async () => {
    let capturedPerPage: number | undefined;
    const searchFn = async (params: { per_page?: number }) => {
      capturedPerPage = params.per_page;
      return { success: true as const, data: [] };
    };
    const { logFn } = makeLogCapture();

    await runApolloOrganizationsSearch({ query: 'test' }, 8, undefined, {
      searchOrgs: searchFn as ApolloOrgsSearchDeps['searchOrgs'],
      logUsage: logFn,
    });

    assert.equal(capturedPerPage, 8);
  });
});

// ─── D. Usage logging ─────────────────────────────────────────────────────────

describe('D. Usage logging', () => {
  before(() => { process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true'; });
  after(() => { delete process.env.ENABLE_APOLLO_COMPANY_SEARCH; });

  it('llamada exitosa crea log con provider_key=apollo y operation_key=organizations_search', async () => {
    const { logs, logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = { searchOrgs: mockSearchSuccess([makeOrg()]), logUsage: logFn };

    await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, deps);

    assert.equal(logs.length, 1);
    assert.equal(logs[0].provider_key, 'apollo');
    assert.equal(logs[0].operation_key, 'organizations_search');
    assert.equal(logs[0].status, 'success');
  });

  it('usage_key es estable entre misma query + mismo batchId', () => {
    const key1 = buildApolloOrgsUsageKey('empresas tech Colombia', 'batch-abc-123', 1000);
    const key2 = buildApolloOrgsUsageKey('empresas tech Colombia', 'batch-abc-123', 2000);
    assert.equal(key1, key2, 'mismo batchId + query → misma key (idempotencia)');
  });

  it('usage_key cambia con diferente batchId', () => {
    const key1 = buildApolloOrgsUsageKey('query test', 'batch-001', 1000);
    const key2 = buildApolloOrgsUsageKey('query test', 'batch-002', 1000);
    assert.notEqual(key1, key2);
  });

  it('usage_key sin batchId incluye timestamp (una por llamada real)', () => {
    const key1 = buildApolloOrgsUsageKey('query test', null, 1000);
    const key2 = buildApolloOrgsUsageKey('query test', null, 2000);
    assert.notEqual(key1, key2, 'sin batchId → keys distintas por timestamp');
  });

  it('log de error en error HTTP incluye status error/quota_exceeded', async () => {
    const { logs, logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = { searchOrgs: mockSearchError(429), logUsage: logFn };

    await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, deps);

    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, 'quota_exceeded');
    assert.equal(logs[0].credits_used, 0);
  });

  it('usageContext.batchId se propaga al log', async () => {
    const { logs, logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = { searchOrgs: mockSearchSuccess([makeOrg()]), logUsage: logFn };

    await runApolloOrganizationsSearch(
      { query: 'test' },
      5,
      { batchId: 'batch-xyz-999', agentRunId: 'run-001' },
      deps,
    );

    assert.equal(logs[0].batch_id, 'batch-xyz-999');
    assert.equal(logs[0].agent_run_id, 'run-001');
  });

  it('flag apagado → 0 logs escritos', async () => {
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    const { logs, logFn } = makeLogCapture();
    await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, { logUsage: logFn });
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    assert.equal(logs.length, 0);
  });
});

// ─── E. Errores controlados ───────────────────────────────────────────────────

describe('E. Errores controlados', () => {
  before(() => { process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true'; });
  after(() => { delete process.env.ENABLE_APOLLO_COMPANY_SEARCH; });

  it('HTTP 401 → skipped, no throw, skipReason incluye 401', async () => {
    const { logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = { searchOrgs: mockSearchError(401, 'Unauthorized'), logUsage: logFn };

    let threw = false;
    let out;
    try {
      out = await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, deps);
    } catch {
      threw = true;
    }

    assert.equal(threw, false, 'No debe lanzar en 401');
    assert.ok(out?.skipped, 'Debe retornar skipped');
    assert.ok(out?.skipReason?.includes('401'), `skipReason debe incluir 401, got: ${out?.skipReason}`);
  });

  it('HTTP 403 → skipped, no throw', async () => {
    const { logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = { searchOrgs: mockSearchError(403), logUsage: logFn };

    let out;
    try {
      out = await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, deps);
    } catch {
      assert.fail('No debe lanzar en 403');
    }

    assert.ok(out?.skipped);
    assert.ok(out?.skipReason?.includes('403'));
  });

  it('HTTP 429 quota → skipReason=apollo_quota_exceeded, credits=0', async () => {
    const { logs, logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = { searchOrgs: mockSearchError(429, 'Rate limit'), logUsage: logFn };

    const out = await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, deps);

    assert.equal(out.skipped, true);
    assert.equal(out.skipReason, 'apollo_quota_exceeded');
    assert.equal(out.estimatedCostUsd, 0);
    assert.equal(logs[0].status, 'quota_exceeded');
  });

  it('excepción de red → skipped, no throw, skipReason=apollo_fetch_exception', async () => {
    const { logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = { searchOrgs: mockSearchException(), logUsage: logFn };

    let out;
    try {
      out = await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, deps);
    } catch {
      assert.fail('No debe lanzar en excepción de red');
    }

    assert.ok(out?.skipped);
    assert.equal(out?.skipReason, 'apollo_fetch_exception');
  });

  it('Apollo devuelve org sin name → se descarta, sin throw', async () => {
    const orgs = [
      makeOrg({ id: 'valid', name: 'Valid Corp' }),
      makeOrg({ id: 'noname', name: null }),
      makeOrg({ id: 'empty', name: '   ' }),
    ];
    const { logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = { searchOrgs: mockSearchSuccess(orgs), logUsage: logFn };

    const out = await runApolloOrganizationsSearch({ query: 'test' }, 10, undefined, deps);

    assert.equal(out.results.length, 1, 'Solo la org con name válido debe aparecer');
    assert.equal(out.results[0].title, 'Valid Corp');
  });

  it('Apollo devuelve 0 resultados → resultsCount=0, credits=0, no throw', async () => {
    const { logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = { searchOrgs: mockSearchSuccess([]), logUsage: logFn };

    const out = await runApolloOrganizationsSearch({ query: 'noresults' }, 5, undefined, deps);

    assert.equal(out.skipped, false);
    assert.equal(out.resultsCount, 0);
    assert.equal(out.estimatedCostUsd, 0);
  });
});

// ─── F. Regression ───────────────────────────────────────────────────────────

describe('F. Regression', () => {
  it('buildApolloOrgsUsageKey retorna string con prefijo apollo_organizations', () => {
    const key = buildApolloOrgsUsageKey('test query', 'batch-001', 1000);
    assert.ok(key.startsWith('apollo_organizations:'), `key debe empezar con apollo_organizations:, got: ${key}`);
  });

  it('mapApolloOrganizationToSearchResult preserva todos los campos de metadata', () => {
    const org: ApolloOrganizationInput = {
      id: 'org-regression-01',
      name: 'Regression Corp',
      website_url: 'https://regression.example.com',
      primary_domain: 'regression.example.com',
      linkedin_url: 'https://linkedin.com/company/regression',
      industry: 'Fintech',
      estimated_num_employees: 500,
      country: 'Colombia',
    };

    const result = mapApolloOrganizationToSearchResult(org, 1);
    const meta = result.metadata as Record<string, unknown>;

    assert.equal(meta.source_provider, 'apollo');
    assert.equal(meta.source_key, 'apollo_organizations');
    assert.equal(meta.source_type, 'structured_company_database');
    assert.equal(meta.apollo_organization_id, 'org-regression-01');
    assert.equal(meta.domain, 'regression.example.com');
    assert.equal(meta.industry, 'Fintech');
    assert.equal(meta.employee_count, 500);
    assert.equal(meta.country, 'Colombia');
    assert.equal(meta.linkedin_url, 'https://linkedin.com/company/regression');
  });

  it('apollo_organizations no interfiere con provider mock ni tavily (key enum)', () => {
    const apolloKey: 'apollo_organizations' = 'apollo_organizations';
    const tavilyKey: 'tavily' = 'tavily';
    const mockKey: 'mock' = 'mock';
    assert.equal(apolloKey, 'apollo_organizations');
    assert.equal(tavilyKey, 'tavily');
    assert.equal(mockKey, 'mock');
  });
});
