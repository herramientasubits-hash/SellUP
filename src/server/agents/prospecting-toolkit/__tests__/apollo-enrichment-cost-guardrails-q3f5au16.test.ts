/**
 * Tests — Q3F-5AU.16: Apollo Enrichment Cost Guardrails
 *
 * Fix 1 — true run-level enrichment cap:
 *   T1. 3 queries, AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN=3 → total real enrichOrg
 *       calls across the whole invocation is capped at 3, not 3×3=9.
 *   T2. Once the run-level budget hits 0, subsequent queries produce cap_reached
 *       and make 0 real enrichOrg calls.
 *   T3. remainingEnrichmentBudget absent → runApolloOrganizationsSearch keeps its
 *       old per-call behavior (resolveApolloMaxEnrichmentsPerRun() as the ceiling).
 *
 * Fix 2 — runtime pricing guard:
 *   T4. Pricing missing → organization_enrichment budget forced to 0 for the whole
 *       wizard execution; never throws (non-blocking).
 *   T5. Pricing present (threaded via usageContext) → organization_enrichment usage
 *       log uses the live unit cost, never the organizations_search hardcode.
 *   T6. organizations_search behavior/costing is unchanged.
 *   T7. ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE default OFF is unchanged.
 *   T10. Pricing loader returning null degrades safely (no throw); non-blocking.
 *
 * Static/structural:
 *   T8. No candidate writer / account / contact / prospect side effects were
 *       introduced by the guardrail code.
 *
 * T9 (apollo-enrichment-industry-label-capture-wiring-q3f5au12.test.ts still
 * passing with the new context) is verified by re-running that suite unmodified,
 * not duplicated here.
 *
 * NO real Apollo / Supabase / AI calls. All providers, loggers, and pipeline
 * calls are injected fakes or explicit env-based degradations.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  runApolloOrganizationsSearch,
  type ApolloOrgsSearchDeps,
} from '../web-search-providers/apollo-organizations-search-provider';
import { runMultiQueryWebSearch } from '../web-search-tool';
import type { TavilyUsageDeps, TavilyUsageContext } from '../tavily-usage-logging';
import { runIncrementalProspectingSearch } from '../incremental-search';
import { loadActiveApolloOrganizationEnrichmentPricing } from '@/modules/usage-tracking/provider-pricing';
import { isApolloOrganizationEnrichmentCascadeEnabled } from '@/lib/feature-flags.server';
import type { ApolloOrganization, ApolloEnrichResult } from '@/server/integrations/apollo-client';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';
import type { writeProspectingCandidates } from '../candidate-writer';
import type {
  ProspectingPipelineInput,
  ProspectingPipelineOutput,
  WebSearchOutput,
} from '../types';

// Q3F-5AU.16: mirrors the local intersection types production code uses in
// incremental-search.ts/web-search-tool.ts — remainingEnrichmentBudget /
// organizationEnrichmentUnitCostUsd are never added to TavilyUsageContext
// itself (that module must stay provider-agnostic).
type ApolloTestUsageContext = TavilyUsageContext & {
  remainingEnrichmentBudget?: number;
  organizationEnrichmentUnitCostUsd?: number | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOrg(
  overrides: Partial<ApolloOrganization> & Pick<ApolloOrganization, 'id' | 'name'>,
): ApolloOrganization {
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

function makeSearchFn(orgs: ApolloOrganization[]) {
  return async () => ({ success: true as const, data: orgs, total: orgs.length });
}

function makeLogCapture() {
  const logs: LogProviderUsageInput[] = [];
  const logFn = async (input: LogProviderUsageInput) => {
    logs.push({ ...input });
    return { kind: 'logged' as const };
  };
  return { logs, logFn };
}

function makeEnrichCounter(returnOrg: ApolloOrganization) {
  const state = { count: 0 };
  const fn = async (_params: { domain: string }): Promise<ApolloEnrichResult<ApolloOrganization>> => {
    state.count++;
    return { success: true, data: returnOrg };
  };
  return { fn, count: () => state.count };
}

const ORG_LMS = makeOrg({
  id: 'platzi',
  name: 'Platzi',
  primary_domain: 'platzi.com',
  industry: 'E-learning',
  keywords: ['lms', 'corporate training'],
});

function threeDistinctOrgsFor(queryLabel: string): ApolloOrganization[] {
  return [1, 2, 3].map((n) =>
    makeOrg({
      id: `${queryLabel}-org${n}`,
      name: `Org ${queryLabel} ${n}`,
      primary_domain: `${queryLabel}-org${n}.example.com`,
    }),
  );
}

function makeFakePipelineOutput(
  input: ProspectingPipelineInput,
  apolloEnrichmentAttemptedCountTotal: number,
): ProspectingPipelineOutput {
  const webSearch: WebSearchOutput = {
    provider: input.webSearchProvider ?? 'mock',
    query: 'fake-query',
    results: [],
    resultsCount: 0,
    skipped: false,
    skipReason: null,
    estimatedCostUsd: null,
    metadata: {
      apollo_enrichment_attempted_count_total: apolloEnrichmentAttemptedCountTotal,
    },
  };
  return {
    input,
    catalogContext: {
      country: input.country,
      countryCode: input.countryCode,
      industry: input.industry,
      searchDepth: 'standard',
      fiscalIdentifierLabel: null,
      recommendedSources: [],
      sectorSources: [],
      risks: [],
      operatingRules: [],
      coverageNotes: [],
      promptContext: '',
    },
    searchQuery: 'fake-query',
    webSearch,
    candidates: [],
    summary: {
      requested: 0,
      searched: 0,
      returned: 0,
      highQualityNew: 0,
      needsReview: 0,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
      unchecked: 0,
    },
    warnings: [],
    metadata: {},
  };
}

const NOOP_WRITER: typeof writeProspectingCandidates = async () => ({
  dryRun: false,
  batchId: 'fake-batch-0000-0000-0000-000000000000',
  candidatesCreated: 0,
  candidatesSkipped: 0,
  createdCandidateIds: [],
  skipped: [],
  status: 'success',
  errors: [],
});

function withoutSupabaseEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fn().finally(() => {
    if (prevUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    if (prevKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  });
}

// ─── T1/T2 — true run-level cap within a single runMultiQueryWebSearch call ──

describe('Q3F-5AU.16 — T1/T2: true run-level enrichment cap (web-search-tool.ts)', () => {
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

  it('T1: 3 queries × 3 enrichable orgs each, cap=3 → total real enrichOrg calls = 3 (not 9)', async () => {
    const enrich = makeEnrichCounter(ORG_LMS);
    const { logFn } = makeLogCapture();

    const dispatchQuery: TavilyUsageDeps['dispatchQuery'] = async (provider, input, maxResults, usageContext) => {
      return runApolloOrganizationsSearch(input, maxResults, usageContext, {
        searchOrgs: makeSearchFn(threeDistinctOrgsFor(input.query)),
        logUsage: logFn,
        enrichOrg: enrich.fn,
      });
    };

    const usageContext: ApolloTestUsageContext = {
      batchId: 'run-level-cap-batch',
      triggeredByUserId: 'user-1',
      roundNumber: 1,
      remainingEnrichmentBudget: 3,
      organizationEnrichmentUnitCostUsd: 0.00875,
    };

    await runMultiQueryWebSearch(
      {
        country: 'Colombia',
        countryCode: 'CO',
        industry: 'Educación',
        provider: 'apollo_organizations',
        queries: ['q1', 'q2', 'q3'],
        usageContext,
      },
      {
        loadPricing: async () => ({ unitCostUsd: 0.008, unit: 'per_credit' }),
        logUsage: logFn,
        dispatchQuery,
      },
    );

    assert.equal(
      enrich.count(),
      3,
      `Expected exactly 3 real enrichOrg calls across all 3 queries (true run-level cap), got ${enrich.count()}`,
    );
  });

  it('T2: once budget reaches 0 mid-run, later queries make 0 real enrichOrg calls', async () => {
    const enrich = makeEnrichCounter(ORG_LMS);
    const { logFn } = makeLogCapture();

    const dispatchQuery: TavilyUsageDeps['dispatchQuery'] = async (provider, input, maxResults, usageContext) => {
      // Every query offers 1 enrichable org — with budget=1, only the first query
      // should consume it; the second must be forced into cap_reached.
      return runApolloOrganizationsSearch(
        input,
        maxResults,
        usageContext,
        {
          searchOrgs: makeSearchFn([
            makeOrg({ id: `${input.query}-org`, name: `Org ${input.query}`, primary_domain: `${input.query}.example.com` }),
          ]),
          logUsage: logFn,
          enrichOrg: enrich.fn,
        },
      );
    };

    const usageContext: ApolloTestUsageContext = {
      batchId: 'budget-exhausted-batch',
      triggeredByUserId: 'user-1',
      roundNumber: 1,
      remainingEnrichmentBudget: 1,
      organizationEnrichmentUnitCostUsd: 0.00875,
    };

    await runMultiQueryWebSearch(
      {
        country: 'Colombia',
        countryCode: 'CO',
        industry: 'Educación',
        provider: 'apollo_organizations',
        queries: ['q1', 'q2'],
        usageContext,
      },
      {
        loadPricing: async () => ({ unitCostUsd: 0.008, unit: 'per_credit' }),
        logUsage: logFn,
        dispatchQuery,
      },
    );

    assert.equal(enrich.count(), 1, 'exactly 1 real enrichOrg call total once budget=1 is exhausted by query 1');
  });
});

// ─── T3 — remainingEnrichmentBudget absent preserves old per-call behavior ───

describe('Q3F-5AU.16 — T3: remainingEnrichmentBudget absent → old per-call behavior', () => {
  before(() => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE = 'true';
    process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN = '2';
  });
  after(() => {
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    delete process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE;
    delete process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN;
  });

  it('usageContext present but without remainingEnrichmentBudget field → falls back to resolveApolloMaxEnrichmentsPerRun()', async () => {
    const enrich = makeEnrichCounter(ORG_LMS);
    const { logFn } = makeLogCapture();
    const orgs = [
      makeOrg({ id: 'a', name: 'A', primary_domain: 'a.example.com' }),
      makeOrg({ id: 'b', name: 'B', primary_domain: 'b.example.com' }),
      makeOrg({ id: 'c', name: 'C', primary_domain: 'c.example.com' }),
    ];
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchFn(orgs),
      logUsage: logFn,
      enrichOrg: enrich.fn,
    };

    // usageContext carries batchId/triggeredByUserId (as a caller predating
    // Q3F-5AU.16 would) but never sets remainingEnrichmentBudget.
    await runApolloOrganizationsSearch(
      { query: 'test', industry: 'Educación' },
      5,
      { batchId: 'legacy-caller-batch', triggeredByUserId: 'user-1' },
      deps,
    );

    assert.equal(
      enrich.count(),
      2,
      'AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN=2 must still cap real calls at 2 when remainingEnrichmentBudget is absent',
    );
  });
});

// ─── T4/T10 — runtime pricing guard (incremental-search.ts) ──────────────────

describe('Q3F-5AU.16 — T4/T10: runtime pricing guard blocks enrichment when pricing is missing', () => {
  it('T4/T10: pricing missing (no Supabase env) → remainingEnrichmentBudget forced to 0 every round, never throws', async () => {
    const capturedUsageContexts: Array<ApolloTestUsageContext | null> = [];

    const pipelineOverride = async (input: ProspectingPipelineInput): Promise<ProspectingPipelineOutput> => {
      capturedUsageContexts.push((input.usageContext as ApolloTestUsageContext | null) ?? null);
      return makeFakePipelineOutput(input, 0);
    };

    let threw = false;
    await withoutSupabaseEnv(async () => {
      try {
        await runIncrementalProspectingSearch(
          {
            country: 'Colombia',
            countryCode: 'CO',
            industry: 'Educación',
            webSearchProvider: 'apollo_organizations',
            dryRun: false,
            maxRounds: 2,
            triggeredByUserId: 'user-1',
            ownerId: 'user-1',
            usageInputContext: { batchId: 'pricing-missing-batch', triggeredByUserId: 'user-1' },
          },
          NOOP_WRITER,
          pipelineOverride,
        );
      } catch {
        threw = true;
      }
    });

    assert.equal(threw, false, 'a missing/failed pricing lookup must never throw or block the main flow');
    assert.ok(capturedUsageContexts.length >= 1, 'the pipeline must have been invoked at least once');
    for (const ctx of capturedUsageContexts) {
      assert.ok(ctx, 'usageContext must be present when usageInputContext was provided');
      assert.equal(ctx!.remainingEnrichmentBudget, 0, 'remainingEnrichmentBudget must be forced to 0 for every round when pricing is missing');
      assert.equal(ctx!.organizationEnrichmentUnitCostUsd, null, 'organizationEnrichmentUnitCostUsd must be null when pricing is missing');
    }
  });

  it('T10: loadActiveApolloOrganizationEnrichmentPricing degrades to null (never throws) when Supabase is unconfigured', async () => {
    await withoutSupabaseEnv(async () => {
      const result = await loadActiveApolloOrganizationEnrichmentPricing();
      assert.equal(result, null);
    });
  });

  it('T4: with pricing missing, runApolloOrganizationsSearch never calls enrichOrg when remainingEnrichmentBudget=0', async () => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE = 'true';
    process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN = '3';
    try {
      const enrich = makeEnrichCounter(ORG_LMS);
      const { logs, logFn } = makeLogCapture();
      const deps: ApolloOrgsSearchDeps = {
        searchOrgs: makeSearchFn([
          makeOrg({ id: 'org1', name: 'Org One', primary_domain: 'org1.example.com' }),
        ]),
        logUsage: logFn,
        enrichOrg: enrich.fn,
      };

      await runApolloOrganizationsSearch(
        { query: 'test', industry: 'Educación' },
        5,
        {
          batchId: 'pricing-missing-provider-batch',
          triggeredByUserId: 'user-1',
          remainingEnrichmentBudget: 0,
          organizationEnrichmentUnitCostUsd: null,
        },
        deps,
      );

      assert.equal(enrich.count(), 0, 'no real enrichOrg call when remainingEnrichmentBudget=0');
      const enrichLogs = logs.filter((l) => l.operation_key === 'organization_enrichment');
      assert.equal(enrichLogs.length, 0, 'no organization_enrichment usage log when no real call was made — no fabricated cost');
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
      delete process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE;
      delete process.env.AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN;
    }
  });
});

// ─── T5 — pricing present → live unit cost used, never the hardcode ─────────

describe('Q3F-5AU.16 — T5: organization_enrichment cost comes from context, never the hardcode', () => {
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

  // Deliberately distinct from APOLLO_ORGANIZATIONS_UNIT_COST_USD (0.00875) so a
  // pass only if the log used the hardcode would be immediately visible.
  const DISTINCT_LIVE_UNIT_COST = 0.02345;

  it('estimated_cost_usd for organization_enrichment equals the live context value, not the hardcode', async () => {
    const { logs, logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchFn([makeOrg({ id: 'org1', name: 'Org One', primary_domain: 'org1.example.com' })]),
      logUsage: logFn,
      enrichOrg: async () => ({ success: true, data: ORG_LMS }),
    };

    await runApolloOrganizationsSearch(
      { query: 'test', industry: 'Educación' },
      3,
      {
        batchId: 'live-pricing-batch',
        triggeredByUserId: 'user-1',
        remainingEnrichmentBudget: 1,
        organizationEnrichmentUnitCostUsd: DISTINCT_LIVE_UNIT_COST,
      },
      deps,
    );

    const enrichLogs = logs.filter((l) => l.operation_key === 'organization_enrichment');
    assert.equal(enrichLogs.length, 1);
    assert.equal(enrichLogs[0]!.estimated_cost_usd, DISTINCT_LIVE_UNIT_COST, 'estimated_cost_usd must equal the live unit cost passed via context');
    assert.notEqual(enrichLogs[0]!.estimated_cost_usd, 0.00875, 'must never silently fall back to the organizations_search hardcode');
    assert.equal(
      (enrichLogs[0]!.metadata as Record<string, unknown>)['pricing_missing_warning'],
      false,
      'pricing_missing_warning must be false when a live cost was provided',
    );
  });

  it('estimated_cost_usd is null (not 0, not the hardcode) when no live cost is threaded', async () => {
    const { logs, logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchFn([makeOrg({ id: 'org2', name: 'Org Two', primary_domain: 'org2.example.com' })]),
      logUsage: logFn,
      enrichOrg: async () => ({ success: true, data: ORG_LMS }),
    };

    // remainingEnrichmentBudget present (so the real call still happens) but no
    // organizationEnrichmentUnitCostUsd — defensive path.
    await runApolloOrganizationsSearch(
      { query: 'test', industry: 'Educación' },
      3,
      { batchId: 'no-cost-context-batch', triggeredByUserId: 'user-1', remainingEnrichmentBudget: 1 },
      deps,
    );

    const enrichLogs = logs.filter((l) => l.operation_key === 'organization_enrichment');
    assert.equal(enrichLogs.length, 1);
    assert.equal(enrichLogs[0]!.estimated_cost_usd, null, 'estimated_cost_usd must be null (unknown cost), never a fabricated value');
    assert.equal((enrichLogs[0]!.metadata as Record<string, unknown>)['pricing_missing_warning'], true);
  });
});

// ─── T6 — organizations_search regression guard ──────────────────────────────

describe('Q3F-5AU.16 — T6: organizations_search cost/behavior is unchanged', () => {
  before(() => {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
  });
  after(() => {
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
  });

  it('organizations_search still uses the 0.00875 hardcode regardless of organizationEnrichmentUnitCostUsd', async () => {
    const { logs, logFn } = makeLogCapture();
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: makeSearchFn([makeOrg({ id: 'org1', name: 'Org One' })]),
      logUsage: logFn,
    };

    await runApolloOrganizationsSearch(
      { query: 'test', industry: 'Educación' },
      3,
      { batchId: 'b', triggeredByUserId: 'u', organizationEnrichmentUnitCostUsd: 9.99 },
      deps,
    );

    const searchLog = logs.find((l) => l.operation_key === 'organizations_search');
    assert.ok(searchLog);
    assert.equal(searchLog!.estimated_cost_usd, 0.00875, 'organizations_search cost must remain the existing hardcode, unaffected by the enrichment pricing context');
  });
});

// ─── T7 — cascade flag default OFF unchanged ─────────────────────────────────

describe('Q3F-5AU.16 — T7: ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE default is unchanged', () => {
  it('flag resolves to false when unset', () => {
    delete process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE;
    assert.equal(isApolloOrganizationEnrichmentCascadeEnabled(), false);
  });
});

// ─── T8 — no candidate writer / account / contact / prospect side effects ───

describe('Q3F-5AU.16 — T8: guardrail changes introduce no candidate/account/contact/prospect side effects', () => {
  const FORBIDDEN_IMPORT_PATTERNS = [
    "from '../candidate-writer'",
    'from "@/server/prospect-batches',
    "createAccount",
    "createContact",
    "createProspect",
  ];

  const TOUCHED_FILES = [
    'src/modules/usage-tracking/provider-pricing.ts',
    'src/server/agents/prospecting-toolkit/apollo-organizations-usage-logging.ts',
    'src/server/agents/prospecting-toolkit/tavily-usage-logging.ts',
    'src/server/agents/prospecting-toolkit/web-search-tool.ts',
    'src/server/agents/prospecting-toolkit/web-search-providers/apollo-organizations-search-provider.ts',
  ];

  for (const relPath of TOUCHED_FILES) {
    it(`${relPath} does not import candidate writer / account / contact / prospect symbols`, () => {
      const source = readFileSync(join(process.cwd(), relPath), 'utf-8');
      for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
        assert.ok(!source.includes(pattern), `${relPath} must not reference "${pattern}"`);
      }
    });
  }
});
