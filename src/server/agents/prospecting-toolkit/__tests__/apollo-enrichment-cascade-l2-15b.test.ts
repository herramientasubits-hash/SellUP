/**
 * Tests — Apollo Organization Enrichment Cascade v1.L2.15-B
 *
 * Valida la integración cascade↔provider↔log:
 *   A. Cascade OFF → apollo_enrichment_cascade.enabled=false en log metadata, sin enrichment log
 *   B. Cascade ON, 0 resultados de search → no enrichment call, no enrichment log
 *   C. Cascade ON, domain elegible → log organization_enrichment emitido
 *   D. MAX_ENRICHMENTS_PER_RUN=1 → solo 1 enrichment log, aunque haya más resultados
 *   E. Sin dominio → no enrichment call, no enrichment log
 *   F. apollo_enrichment_cascade incluido en metadata del organizations_search log (no solo return)
 *   G. Enrichment fallido → log con status=error, enrichment_failed
 *   H. Cascade ON, resultado enriquecido con LMS → pasa gate formacion corporativa
 *
 * Sin llamadas reales. Sin API keys. Sin créditos.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloOrganizationsSearch,
  type ApolloOrgsSearchDeps,
} from '../web-search-providers/apollo-organizations-search-provider';
import type { ApolloOrganization, ApolloEnrichResult } from '@/server/integrations/apollo-client';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOrg(overrides: Partial<ApolloOrganization> & Pick<ApolloOrganization, 'id' | 'name'>): ApolloOrganization {
  return {
    website_url: `https://${overrides.id}.example.com`,
    primary_domain: `${overrides.id}.example.com`,
    linkedin_url: null,
    industry: null,
    industry_tag_ids: [],
    employee_count: null,
    estimated_num_employees: 250,
    city: null,
    country: 'Colombia',
    phone: null,
    annual_revenue: null,
    technologies: [],
    short_description: null,
    seo_description: null,
    keywords: [],
    ...overrides,
  };
}

function makeSearchSuccess(orgs: ApolloOrganization[]) {
  return async () => ({ success: true as const, data: orgs, total: orgs.length });
}

type CapturedLog = LogProviderUsageInput;

function makeLogCapture() {
  const logs: CapturedLog[] = [];
  const logFn = async (input: LogProviderUsageInput) => {
    logs.push({ ...input });
    return { kind: 'logged' as const };
  };
  return { logs, logFn };
}

function makeEnrichSuccess(org: ApolloOrganization) {
  return async (_params: { domain: string }): Promise<ApolloEnrichResult<ApolloOrganization>> => ({
    success: true,
    data: org,
  });
}

function makeEnrichFailure(message = 'not found') {
  return async (_params: { domain: string }): Promise<ApolloEnrichResult<ApolloOrganization>> => ({
    success: false,
    error: { error: 'not_found', message },
  });
}

// Fixture orgs
const ORG_LMS = makeOrg({
  id: 'platzi',
  name: 'Platzi',
  primary_domain: 'platzi.com',
  website_url: 'https://platzi.com',
  industry: 'E-learning',
  keywords: ['lms', 'online learning', 'corporate training', 'edtech'],
  short_description: 'Platzi is a leading online learning platform for corporate training.',
  estimated_num_employees: 500,
});

const ORG_GENERIC = makeOrg({
  id: 'terpel',
  name: 'Terpel',
  primary_domain: 'terpel.com',
  website_url: 'https://terpel.com',
  industry: null,
  keywords: [],
});

// ─── A. Cascade OFF ───────────────────────────────────────────────────────────

describe('L2.15-B-A: Cascade OFF → no enrichment log, cascade.enabled=false in orgsearch log', () => {
  before(() => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    delete process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE;
  });
  after(() => {
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
  });

  it('no enrichment log emitted when cascade is OFF', async () => {
    const { logs, logFn } = makeLogCapture();
    let enrichCalled = false;
    const enrichFn = async () => { enrichCalled = true; return { success: false as const }; };
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchSuccess([ORG_GENERIC]),
      logUsage: logFn,
      enrichOrg: enrichFn as never,
    };

    await runApolloOrganizationsSearch({ query: 'test', industry: 'Educación' }, 3, undefined, deps);

    assert.equal(enrichCalled, false, 'enrichOrg must not be called when cascade is OFF');
    const enrichLogs = logs.filter(l => l.operation_key === 'organization_enrichment');
    assert.equal(enrichLogs.length, 0, 'No organization_enrichment logs when cascade OFF');
  });

  it('organizations_search log has apollo_enrichment_cascade.enabled=false', async () => {
    const { logs, logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchSuccess([ORG_GENERIC]),
      logUsage: logFn,
    };

    await runApolloOrganizationsSearch({ query: 'test', industry: 'Educación' }, 3, undefined, deps);

    const searchLog = logs.find(l => l.operation_key === 'organizations_search');
    assert.ok(searchLog, 'organizations_search log must exist');
    const meta = searchLog!.metadata as Record<string, unknown>;
    const cascadeMeta = meta['apollo_enrichment_cascade'] as Record<string, unknown> | undefined;
    assert.ok(cascadeMeta, 'apollo_enrichment_cascade must be in log metadata');
    assert.equal(cascadeMeta['enabled'], false, 'cascade.enabled must be false when flag OFF');
  });
});

// ─── B. Cascade ON, 0 resultados search ──────────────────────────────────────

describe('L2.15-B-B: Cascade ON, 0 search results → no enrichment call or log', () => {
  before(() => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE = 'true';
    process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN = '1';
  });
  after(() => {
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    delete process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE;
    delete process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN;
  });

  it('no enrichment log when Apollo search returns 0 results', async () => {
    const { logs, logFn } = makeLogCapture();
    let enrichCalled = false;
    const enrichFn = async () => { enrichCalled = true; return { success: false as const }; };
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchSuccess([]),
      logUsage: logFn,
      enrichOrg: enrichFn as never,
    };

    await runApolloOrganizationsSearch({ query: 'test', industry: 'Educación' }, 3, undefined, deps);

    assert.equal(enrichCalled, false);
    const enrichLogs = logs.filter(l => l.operation_key === 'organization_enrichment');
    assert.equal(enrichLogs.length, 0);
  });
});

// ─── C. Cascade ON, domain elegible → enrichment log ─────────────────────────

describe('L2.15-B-C: Cascade ON, domain present → organization_enrichment log emitted', () => {
  before(() => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE = 'true';
    process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN = '1';
  });
  after(() => {
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    delete process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE;
    delete process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN;
  });

  it('organization_enrichment log appears with correct fields', async () => {
    const { logs, logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchSuccess([ORG_GENERIC]),
      logUsage: logFn,
      enrichOrg: makeEnrichSuccess(ORG_LMS),
    };

    await runApolloOrganizationsSearch(
      { query: 'lms colombia', industry: 'Educación', subindustries: ['Formación Corporativa'] },
      3,
      { batchId: 'test-batch-001' },
      deps,
    );

    const enrichLogs = logs.filter(l => l.operation_key === 'organization_enrichment');
    assert.equal(enrichLogs.length, 1, 'Exactly 1 enrichment log for 1 enriched org');

    const enrichLog = enrichLogs[0]!;
    assert.equal(enrichLog.provider_key, 'apollo');
    assert.equal(enrichLog.operation_key, 'organization_enrichment');
    assert.equal(enrichLog.status, 'success');
    assert.equal(enrichLog.batch_id, 'test-batch-001');
    assert.equal(enrichLog.results_returned, 1);

    const meta = enrichLog.metadata as Record<string, unknown>;
    assert.ok(typeof meta['domain'] === 'string', 'metadata.domain must be present');
    assert.equal(meta['pricing_missing_warning'], false, 'pricing_missing_warning must be false (migration 079 configured)');
    assert.ok(Array.isArray(meta['fields_added']), 'fields_added must be array');
  });

  it('organizations_search log includes apollo_enrichment_cascade with enabled=true', async () => {
    const { logs, logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchSuccess([ORG_GENERIC]),
      logUsage: logFn,
      enrichOrg: makeEnrichSuccess(ORG_LMS),
    };

    await runApolloOrganizationsSearch({ query: 'test', industry: 'Educación' }, 3, undefined, deps);

    const searchLog = logs.find(l => l.operation_key === 'organizations_search');
    assert.ok(searchLog, 'organizations_search log must exist');
    const meta = searchLog!.metadata as Record<string, unknown>;
    const cascadeMeta = meta['apollo_enrichment_cascade'] as Record<string, unknown> | undefined;
    assert.ok(cascadeMeta, 'apollo_enrichment_cascade must be in log metadata');
    assert.equal(cascadeMeta['enabled'], true);
    assert.ok(typeof cascadeMeta['attempted_count'] === 'number');
    assert.ok(typeof cascadeMeta['enriched_count'] === 'number');
  });
});

// ─── D. MAX_ENRICHMENTS_PER_RUN=1 → solo 1 enrichment log ───────────────────

describe('L2.15-B-D: MAX_ENRICHMENTS=1 → at most 1 enrichment log', () => {
  before(() => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE = 'true';
    process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN = '1';
  });
  after(() => {
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    delete process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE;
    delete process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN;
  });

  it('only 1 enrichment log when 3 orgs returned but max=1', async () => {
    const { logs, logFn } = makeLogCapture();
    let enrichCallCount = 0;
    const enrichFn = async (_p: { domain: string }): Promise<ApolloEnrichResult<ApolloOrganization>> => {
      enrichCallCount++;
      return { success: true, data: ORG_LMS };
    };
    const orgs = [
      makeOrg({ id: 'org1', name: 'Org One', primary_domain: 'org1.com' }),
      makeOrg({ id: 'org2', name: 'Org Two', primary_domain: 'org2.com' }),
      makeOrg({ id: 'org3', name: 'Org Three', primary_domain: 'org3.com' }),
    ];
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchSuccess(orgs),
      logUsage: logFn,
      enrichOrg: enrichFn,
    };

    await runApolloOrganizationsSearch({ query: 'test', industry: 'Educación' }, 5, undefined, deps);

    assert.equal(enrichCallCount, 1, 'Only 1 real enrichment call when MAX_ENRICHMENTS=1');
    const enrichLogs = logs.filter(l => l.operation_key === 'organization_enrichment');
    assert.equal(enrichLogs.length, 1, 'Only 1 enrichment log when MAX_ENRICHMENTS=1');
  });
});

// ─── E. Sin dominio → no enrichment call, no log ─────────────────────────────

describe('L2.15-B-E: No domain → no enrichment call, no enrichment log', () => {
  before(() => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE = 'true';
    process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN = '1';
  });
  after(() => {
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    delete process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE;
    delete process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN;
  });

  it('org without domain is skipped, no enrichment log', async () => {
    const { logs, logFn } = makeLogCapture();
    let enrichCalled = false;
    const enrichFn = async () => { enrichCalled = true; return { success: false as const }; };
    // Org with no domain or website
    const noDomainOrg: ApolloOrganization = {
      id: 'no-domain-org',
      name: 'Sin Dominio S.A.S',
      website_url: null,
      primary_domain: null,
      linkedin_url: null,
      industry: null,
      industry_tag_ids: [],
      employee_count: null,
      estimated_num_employees: 100,
      city: null,
      country: 'Colombia',
      phone: null,
      annual_revenue: null,
      technologies: [],
      short_description: null,
      seo_description: null,
      keywords: [],
    };
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchSuccess([noDomainOrg]),
      logUsage: logFn,
      enrichOrg: enrichFn as never,
    };

    await runApolloOrganizationsSearch({ query: 'test', industry: 'Educación' }, 3, undefined, deps);

    assert.equal(enrichCalled, false, 'enrichOrg must not be called for org without domain');
    const enrichLogs = logs.filter(l => l.operation_key === 'organization_enrichment');
    assert.equal(enrichLogs.length, 0, 'No enrichment log for org without domain');
  });
});

// ─── F. apollo_enrichment_cascade in logFn metadata ──────────────────────────

describe('L2.15-B-F: apollo_enrichment_cascade persisted in DB log metadata', () => {
  before(() => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE = 'true';
    process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN = '1';
  });
  after(() => {
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    delete process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE;
    delete process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN;
  });

  it('cascade meta has all required tracking fields in the logFn call', async () => {
    const { logs, logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchSuccess([ORG_GENERIC]),
      logUsage: logFn,
      enrichOrg: makeEnrichSuccess(ORG_LMS),
    };

    await runApolloOrganizationsSearch({ query: 'test', industry: 'Educación' }, 3, undefined, deps);

    const searchLog = logs.find(l => l.operation_key === 'organizations_search');
    assert.ok(searchLog);
    const cascadeMeta = (searchLog!.metadata as Record<string, unknown>)['apollo_enrichment_cascade'] as Record<string, unknown>;
    assert.ok(cascadeMeta, 'apollo_enrichment_cascade must be in logFn metadata (not just return value)');
    assert.ok('cascade_version' in cascadeMeta);
    assert.ok('attempted_count' in cascadeMeta);
    assert.ok('enriched_count' in cascadeMeta);
    assert.ok('skipped_count' in cascadeMeta);
    assert.ok('failed_count' in cascadeMeta);
    assert.ok('max_enrichments' in cascadeMeta);
    assert.ok('entries' in cascadeMeta);
  });
});

// ─── G+. Pricing correctness — credits_used=1, estimated_cost_usd=0.00875 ─────

describe('L2.15-B-G-pricing: organization_enrichment logs correct pricing (migration 079)', () => {
  before(() => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE = 'true';
    process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN = '3';
  });
  after(() => {
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    delete process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE;
    delete process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN;
  });

  it('success enrichment → credits_used=1, estimated_cost_usd=0.00875, pricing_missing_warning=false', async () => {
    const { logs, logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchSuccess([ORG_GENERIC]),
      logUsage: logFn,
      enrichOrg: makeEnrichSuccess(ORG_LMS),
    };

    await runApolloOrganizationsSearch(
      { query: 'test', industry: 'Educación' },
      3,
      { batchId: 'pricing-test-001' },
      deps,
    );

    const enrichLogs = logs.filter(l => l.operation_key === 'organization_enrichment');
    assert.equal(enrichLogs.length, 1, 'Exactly 1 enrichment log');
    const log = enrichLogs[0]!;
    assert.equal(log.credits_used, 1, 'credits_used must be 1 for a real enrichment call');
    assert.equal(log.estimated_cost_usd, 0.00875, 'estimated_cost_usd must be 0.00875 (migration 079)');
    assert.equal(
      (log.metadata as Record<string, unknown>)['pricing_missing_warning'],
      false,
      'pricing_missing_warning must be false when pricing is configured',
    );
  });

  it('failed enrichment (success=false) → credits_used=1, estimated_cost_usd=0.00875 (API call was made)', async () => {
    const { logs, logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchSuccess([ORG_GENERIC]),
      logUsage: logFn,
      enrichOrg: makeEnrichFailure('Organization not found'),
    };

    await runApolloOrganizationsSearch(
      { query: 'test', industry: 'Educación' },
      3,
      { batchId: 'pricing-test-002' },
      deps,
    );

    const enrichLogs = logs.filter(l => l.operation_key === 'organization_enrichment');
    assert.equal(enrichLogs.length, 1, 'Failed enrichment still generates a log (real API call was made)');
    const log = enrichLogs[0]!;
    assert.equal(log.credits_used, 1, 'credits_used=1 even on failure (Apollo charges the call)');
    assert.equal(log.estimated_cost_usd, 0.00875, 'estimated_cost_usd=0.00875 even on failure');
    assert.equal(log.status, 'error');
  });

  it('missing_domain skip → no enrichment log, no credits', async () => {
    const { logs, logFn } = makeLogCapture();
    const noDomainOrg: ApolloOrganization = {
      id: 'no-domain-pricing',
      name: 'Sin Dominio Pricing Test S.A.S',
      website_url: null,
      primary_domain: null,
      linkedin_url: null,
      industry: null,
      industry_tag_ids: [],
      employee_count: null,
      estimated_num_employees: 300,
      city: null,
      country: 'Colombia',
      phone: null,
      annual_revenue: null,
      technologies: [],
      short_description: null,
      seo_description: null,
      keywords: [],
    };
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchSuccess([noDomainOrg]),
      logUsage: logFn,
      enrichOrg: makeEnrichSuccess(ORG_LMS),
    };

    await runApolloOrganizationsSearch({ query: 'test', industry: 'Educación' }, 3, undefined, deps);

    const enrichLogs = logs.filter(l => l.operation_key === 'organization_enrichment');
    assert.equal(enrichLogs.length, 0, 'missing_domain skip must not generate enrichment log');
  });

  it('cap_reached skip → no extra enrichment log beyond cap', async () => {
    const { logs, logFn } = makeLogCapture();
    process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN = '1';
    const orgs = [
      makeOrg({ id: 'org-cap-1', name: 'Cap Org One', primary_domain: 'caporg1.com' }),
      makeOrg({ id: 'org-cap-2', name: 'Cap Org Two', primary_domain: 'caporg2.com' }),
    ];
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchSuccess(orgs),
      logUsage: logFn,
      enrichOrg: makeEnrichSuccess(ORG_LMS),
    };

    await runApolloOrganizationsSearch({ query: 'test', industry: 'Educación' }, 5, undefined, deps);

    const enrichLogs = logs.filter(l => l.operation_key === 'organization_enrichment');
    assert.equal(enrichLogs.length, 1, 'cap_reached: only 1 enrichment log (cap=1), no log for skipped org');
    process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN = '3';
  });
});

// ─── G. Enrichment fallido → log status=error ────────────────────────────────

describe('L2.15-B-G: Enrichment failure → organization_enrichment log with status=error', () => {
  before(() => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE = 'true';
    process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN = '1';
  });
  after(() => {
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    delete process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE;
    delete process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN;
  });

  it('failed enrichment (success=false) → log with status=error', async () => {
    const { logs, logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchSuccess([ORG_GENERIC]),
      logUsage: logFn,
      enrichOrg: makeEnrichFailure('Organization not found in Apollo'),
    };

    await runApolloOrganizationsSearch({ query: 'test', industry: 'Educación' }, 3, undefined, deps);

    const enrichLogs = logs.filter(l => l.operation_key === 'organization_enrichment');
    assert.equal(enrichLogs.length, 1, 'Failed enrichment still generates a log (real API call was made)');
    assert.equal(enrichLogs[0]!.status, 'error');
    assert.equal(enrichLogs[0]!.results_returned, 0);
    assert.equal(enrichLogs[0]!.error_code, 'enrichment_failed');
  });

  it('thrown enrichment error → log with status=error', async () => {
    const { logs, logFn } = makeLogCapture();
    const throwFn = async () => { throw new Error('Apollo API timeout'); };
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchSuccess([ORG_GENERIC]),
      logUsage: logFn,
      enrichOrg: throwFn as never,
    };

    await runApolloOrganizationsSearch({ query: 'test', industry: 'Educación' }, 3, undefined, deps);

    const enrichLogs = logs.filter(l => l.operation_key === 'organization_enrichment');
    assert.equal(enrichLogs.length, 1);
    assert.equal(enrichLogs[0]!.status, 'error');
  });
});

// ─── H. Enriquecido con LMS → pasa gate formacion corporativa ────────────────

describe('L2.15-B-H: Enriched LMS org passes formacion corporativa gate', () => {
  before(() => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE = 'true';
    process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN = '1';
  });
  after(() => {
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    delete process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE;
    delete process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN;
  });

  it('org bare (no sector evidence) enriched with LMS profile → appears in output results', async () => {
    const { logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchSuccess([ORG_GENERIC]),
      logUsage: logFn,
      enrichOrg: makeEnrichSuccess(ORG_LMS),
    };

    const out = await runApolloOrganizationsSearch(
      {
        query: 'lms colombia',
        industry: 'Educación',
        subindustries: ['Formación Corporativa y Corporate Training'],
      },
      3,
      undefined,
      deps,
    );

    // After enrichment, the generic org gets LMS keywords → passes gate
    assert.ok(out.results.length >= 1,
      `Expected >=1 result after enrichment. Got ${out.results.length}. ` +
      `(raw=${(out.metadata as Record<string, unknown>)['apollo_raw_results_count']}, ` +
      `gate=${(out.metadata as Record<string, unknown>)['apollo_post_gate_results_count']})`);
  });
});
