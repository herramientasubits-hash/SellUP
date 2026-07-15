/**
 * Tests — Apollo Organization Enrichment: raw industry label capture wiring
 * (Q3F-5AU.12)
 *
 * Verifies the best-effort wiring of captureProviderIndustryRawLabelObservations
 * into runApolloOrganizationsSearch for labels observed during the Apollo
 * Organization Enrichment cascade (not Organization Search):
 *   T1. industry string present in enrichment → capture called with
 *       operationKey=organization_enrichment, sourceVocabularyKey=
 *       apollo_organization_industry, providerKey=apollo.
 *   T2. industries array present → capture called.
 *   T3. industry + industries present → ingestion dedup collapses duplicate
 *       normalized labels into one representative.
 *   T4. industry null / industries empty → capture NOT called.
 *   T5. sourceContext carries no domain/company name/LinkedIn/email/phone/raw
 *       payload — only operation/resultCount.
 *   T6. capture helper fails/returns failed → flow still returns results;
 *       organization_enrichment usage logging is unaffected.
 *   T7. usage logging for organization_enrichment still runs even when
 *       capture fails.
 *   T8. cascade OFF (default) → capture never called.
 *   T9. no candidate writer / account / prospect / contact coupling
 *       introduced by this wiring.
 *   T10. countryCode/requestedIndustry/agentRunId passed the same way as the
 *        existing Q3F-5AU.7 Search-side wiring.
 *
 * Sin Apollo real. Sin Supabase real. Sin créditos. Node.js test runner.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloOrganizationsSearch,
  type ApolloOrgsSearchDeps,
} from '../web-search-providers/apollo-organizations-search-provider';
import { normalizeClassificationValue } from '@/modules/prospect-batches/import-classification/catalog-normalization';
import type { CaptureProviderIndustryRawLabelObservationsResult } from '../provider-industry-raw-label-capture';
import type { ApolloOrganization, ApolloEnrichResult } from '@/server/integrations/apollo-client';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';

const MODULE_PATH = join(
  process.cwd(),
  'src/server/agents/prospecting-toolkit/web-search-providers/apollo-organizations-search-provider.ts',
);
const MODULE_SOURCE = readFileSync(MODULE_PATH, 'utf-8');
const IMPORT_STATEMENTS = MODULE_SOURCE
  .split('\n')
  .filter((line) => /^\s*import\b/.test(line))
  .join('\n');

// ─── Helpers de test ──────────────────────────────────────────────────────────

function makeOrg(overrides: Partial<ApolloOrganization> & Pick<ApolloOrganization, 'id' | 'name'>): ApolloOrganization {
  return {
    website_url: `https://${overrides.id}.example.com`,
    primary_domain: `${overrides.id}.example.com`,
    linkedin_url: null,
    // Q3F-5AU.12 isolation: search-time industry stays null so the existing
    // Q3F-5AU.7 Search-side capture never fires in these tests — only the
    // enrichment-side capture under test is exercised.
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

function makeLogCapture() {
  const logs: LogProviderUsageInput[] = [];
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

type CaptureCall = {
  sourceVocabularyKey: string;
  providerKey: string;
  operationKey: string;
  labels: ReadonlyArray<{ rawLabel: string; normalizedLookupKey: string }>;
  countryCode?: string | null;
  requestedIndustry?: string | null;
  agentRunId?: string | null;
  sourceContext?: Record<string, unknown>;
};

function makeCaptureCapture(
  result: CaptureProviderIndustryRawLabelObservationsResult = {
    status: 'captured',
    capturedCount: 1,
    insertedCount: 1,
    updatedCount: 0,
    skippedCount: 0,
  },
) {
  const calls: CaptureCall[] = [];
  const captureIndustryLabels = (async (input: CaptureCall) => {
    calls.push(input);
    return result;
  }) as ApolloOrgsSearchDeps['captureIndustryLabels'];
  return { calls, captureIndustryLabels };
}

// Search-time org: no industry evidence so the Q3F-5AU.7 Search-side capture
// stays silent; the enrichment mock below is what supplies industry data.
const ORG_SEARCH_BARE = makeOrg({ id: 'bare-co', name: 'Bare Co' });

function withEnabledEnv(fn: () => void) {
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
  fn();
}

describe('Q3F-5AU.12 — Apollo organization enrichment: raw industry label capture wiring', () => {
  withEnabledEnv(() => {
    it('T1: industry string present in enrichment → capture called with correct contract', async () => {
      const enrichedOrg = makeOrg({ id: 'alpha', name: 'Alpha Corp', industry: 'Software', industries: null });
      const { calls, captureIndustryLabels } = makeCaptureCapture();
      const deps: ApolloOrgsSearchDeps = {
        searchOrgs: makeSearchSuccess([ORG_SEARCH_BARE]),
        logUsage: makeLogCapture().logFn,
        enrichOrg: makeEnrichSuccess(enrichedOrg),
        captureIndustryLabels,
      };

      await runApolloOrganizationsSearch(
        { query: 'tech Colombia', countryCode: 'CO', industry: 'Technology' },
        3,
        { agentRunId: 'run-abc-1' },
        deps,
      );

      const enrichCalls = calls.filter((c) => c.operationKey === 'organization_enrichment');
      assert.equal(enrichCalls.length, 1, 'enrichment capture must be called exactly once');
      const call = enrichCalls[0];
      assert.equal(call.sourceVocabularyKey, 'apollo_organization_industry');
      assert.equal(call.providerKey, 'apollo');
      assert.equal(call.operationKey, 'organization_enrichment');
      assert.deepEqual(call.labels.map((l) => l.rawLabel), ['Software']);
      assert.equal(call.labels[0].normalizedLookupKey, normalizeClassificationValue('Software'));
    });

    it('T2: industries array present → capture called', async () => {
      const enrichedOrg = makeOrg({ id: 'beta', name: 'Beta SA', industry: null, industries: ['FinTech', 'Banking'] });
      const { calls, captureIndustryLabels } = makeCaptureCapture();
      const deps: ApolloOrgsSearchDeps = {
        searchOrgs: makeSearchSuccess([ORG_SEARCH_BARE]),
        logUsage: makeLogCapture().logFn,
        enrichOrg: makeEnrichSuccess(enrichedOrg),
        captureIndustryLabels,
      };

      await runApolloOrganizationsSearch({ query: 'test' }, 3, undefined, deps);

      const enrichCalls = calls.filter((c) => c.operationKey === 'organization_enrichment');
      assert.equal(enrichCalls.length, 1);
      assert.deepEqual(enrichCalls[0].labels.map((l) => l.rawLabel).sort(), ['Banking', 'FinTech']);
    });

    it('T3: industry + industries present → dedup collapses duplicate normalized labels', async () => {
      const enrichedOrg = makeOrg({
        id: 'gamma',
        name: 'Gamma Corp',
        industry: 'Software',
        industries: ['software', 'SOFTWARE', 'SaaS'],
      });
      const { calls, captureIndustryLabels } = makeCaptureCapture();
      const deps: ApolloOrgsSearchDeps = {
        searchOrgs: makeSearchSuccess([ORG_SEARCH_BARE]),
        logUsage: makeLogCapture().logFn,
        enrichOrg: makeEnrichSuccess(enrichedOrg),
        captureIndustryLabels,
      };

      await runApolloOrganizationsSearch({ query: 'test' }, 3, undefined, deps);

      const enrichCalls = calls.filter((c) => c.operationKey === 'organization_enrichment');
      assert.equal(enrichCalls.length, 1);
      // 'Software' / 'software' / 'SOFTWARE' collapse into a single
      // normalized-key group; 'SaaS' is a distinct group. Two labels total.
      assert.equal(enrichCalls[0].labels.length, 2, 'no duplicate normalized labels');
      const normalizedKeys = enrichCalls[0].labels.map((l) => l.normalizedLookupKey).sort();
      assert.deepEqual(normalizedKeys, [normalizeClassificationValue('SaaS'), normalizeClassificationValue('Software')].sort());
    });

    it('T4: industry null / industries empty → capture NOT called', async () => {
      const enrichedOrg = makeOrg({ id: 'delta', name: 'Delta Ltd', industry: null, industries: [] });
      const { calls, captureIndustryLabels } = makeCaptureCapture();
      const deps: ApolloOrgsSearchDeps = {
        searchOrgs: makeSearchSuccess([ORG_SEARCH_BARE]),
        logUsage: makeLogCapture().logFn,
        enrichOrg: makeEnrichSuccess(enrichedOrg),
        captureIndustryLabels,
      };

      await runApolloOrganizationsSearch({ query: 'test' }, 3, undefined, deps);

      const enrichCalls = calls.filter((c) => c.operationKey === 'organization_enrichment');
      assert.equal(enrichCalls.length, 0, 'capture must not be called when enrichment carries no industry evidence');
    });

    it('T5: sourceContext carries no domain/company name/LinkedIn/email/phone/raw payload', async () => {
      const enrichedOrg = makeOrg({
        id: 'epsilon',
        name: 'Epsilon Holdings',
        industry: 'Software',
        linkedin_url: 'https://linkedin.com/company/epsilon',
        primary_domain: 'epsilon-secret.example.com',
      });
      const { calls, captureIndustryLabels } = makeCaptureCapture();
      const deps: ApolloOrgsSearchDeps = {
        searchOrgs: makeSearchSuccess([ORG_SEARCH_BARE]),
        logUsage: makeLogCapture().logFn,
        enrichOrg: makeEnrichSuccess(enrichedOrg),
        captureIndustryLabels,
      };

      await runApolloOrganizationsSearch({ query: 'test' }, 3, undefined, deps);

      const enrichCalls = calls.filter((c) => c.operationKey === 'organization_enrichment');
      assert.equal(enrichCalls.length, 1);
      const sourceContext = enrichCalls[0].sourceContext ?? {};
      assert.deepEqual(Object.keys(sourceContext).sort(), ['operation', 'resultCount']);
      assert.equal(sourceContext['operation'], 'apollo_organization_enrichment');
      const serialized = JSON.stringify(sourceContext);
      assert.equal(serialized.includes('linkedin.com'), false);
      assert.equal(serialized.includes('epsilon-secret.example.com'), false);
      assert.equal(serialized.includes('Epsilon Holdings'), false, 'must not embed the org name');
      assert.equal(serialized.includes('@'), false);
    });

    it('T6: capture helper fails → flow still returns the same results', async () => {
      const enrichedOrg = makeOrg({ id: 'zeta', name: 'Zeta Inc', industry: 'Software' });
      const { captureIndustryLabels } = makeCaptureCapture({ status: 'failed', errorCode: 'rpc_call_failed' });
      const depsWithCapture: ApolloOrgsSearchDeps = {
        searchOrgs: makeSearchSuccess([ORG_SEARCH_BARE]),
        logUsage: makeLogCapture().logFn,
        enrichOrg: makeEnrichSuccess(enrichedOrg),
        captureIndustryLabels,
      };
      const depsWithoutCapture: ApolloOrgsSearchDeps = {
        searchOrgs: makeSearchSuccess([ORG_SEARCH_BARE]),
        logUsage: makeLogCapture().logFn,
        enrichOrg: makeEnrichSuccess(enrichedOrg),
      };

      const outWithFailedCapture = await runApolloOrganizationsSearch({ query: 'test' }, 3, undefined, depsWithCapture);
      const outBaseline = await runApolloOrganizationsSearch({ query: 'test' }, 3, undefined, depsWithoutCapture);

      assert.deepEqual(outWithFailedCapture.results, outBaseline.results);
      assert.equal(outWithFailedCapture.resultsCount, outBaseline.resultsCount);
      assert.equal(outWithFailedCapture.skipped, false);
    });

    it('T7: organization_enrichment usage logging still runs even when capture fails', async () => {
      const enrichedOrg = makeOrg({ id: 'eta', name: 'Eta Corp', industry: 'Software' });
      const { logs, logFn } = makeLogCapture();
      const { captureIndustryLabels } = makeCaptureCapture({ status: 'failed', errorCode: 'rpc_call_failed' });
      const deps: ApolloOrgsSearchDeps = {
        searchOrgs: makeSearchSuccess([ORG_SEARCH_BARE]),
        logUsage: logFn,
        enrichOrg: makeEnrichSuccess(enrichedOrg),
        captureIndustryLabels,
      };

      await runApolloOrganizationsSearch({ query: 'test' }, 3, undefined, deps);

      const enrichLogs = logs.filter((l) => l.operation_key === 'organization_enrichment');
      assert.equal(enrichLogs.length, 1, 'organization_enrichment usage log must still be emitted');
      assert.equal(enrichLogs[0].status, 'success');
    });

    it('helper throwing synchronously is contained — flow still returns results', async () => {
      const enrichedOrg = makeOrg({ id: 'theta', name: 'Theta Corp', industry: 'Software' });
      const deps: ApolloOrgsSearchDeps = {
        searchOrgs: makeSearchSuccess([ORG_SEARCH_BARE]),
        logUsage: makeLogCapture().logFn,
        enrichOrg: makeEnrichSuccess(enrichedOrg),
        captureIndustryLabels: (async () => {
          throw new Error('unexpected capture bug');
        }) as ApolloOrgsSearchDeps['captureIndustryLabels'],
      };

      let threw = false;
      let out;
      try {
        out = await runApolloOrganizationsSearch({ query: 'test' }, 3, undefined, deps);
      } catch {
        threw = true;
      }

      assert.equal(threw, false, 'capture helper throwing must not propagate outward');
      assert.equal(out?.skipped, false);
    });

    it('T10: countryCode/requestedIndustry/agentRunId passed the same way as Search-side wiring', async () => {
      const enrichedOrg = makeOrg({ id: 'iota', name: 'Iota Corp', industry: 'Software' });
      const { calls, captureIndustryLabels } = makeCaptureCapture();
      const deps: ApolloOrgsSearchDeps = {
        searchOrgs: makeSearchSuccess([ORG_SEARCH_BARE]),
        logUsage: makeLogCapture().logFn,
        enrichOrg: makeEnrichSuccess(enrichedOrg),
        captureIndustryLabels,
      };

      await runApolloOrganizationsSearch(
        { query: 'test', countryCode: 'MX', industry: 'Retail' },
        3,
        { agentRunId: 'run-xyz-9' },
        deps,
      );

      const enrichCalls = calls.filter((c) => c.operationKey === 'organization_enrichment');
      assert.equal(enrichCalls.length, 1);
      assert.equal(enrichCalls[0].countryCode, 'MX');
      assert.equal(enrichCalls[0].requestedIndustry, 'Retail');
      assert.equal(enrichCalls[0].agentRunId, 'run-xyz-9');
    });

    it('T10b: missing countryCode/industry/agentRunId fall back to null, same as Search-side wiring', async () => {
      const enrichedOrg = makeOrg({ id: 'kappa', name: 'Kappa Corp', industry: 'Software' });
      const { calls, captureIndustryLabels } = makeCaptureCapture();
      const deps: ApolloOrgsSearchDeps = {
        searchOrgs: makeSearchSuccess([ORG_SEARCH_BARE]),
        logUsage: makeLogCapture().logFn,
        enrichOrg: makeEnrichSuccess(enrichedOrg),
        captureIndustryLabels,
      };

      await runApolloOrganizationsSearch({ query: 'test' }, 3, undefined, deps);

      const enrichCalls = calls.filter((c) => c.operationKey === 'organization_enrichment');
      assert.equal(enrichCalls.length, 1);
      assert.equal(enrichCalls[0].countryCode, null);
      assert.equal(enrichCalls[0].requestedIndustry, null);
      assert.equal(enrichCalls[0].agentRunId, null);
    });
  });

  it('T8: cascade OFF (default, flag not set) → enrichment capture never called', async () => {
    delete process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE;
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
    try {
      const enrichedOrg = makeOrg({ id: 'lambda', name: 'Lambda Corp', industry: 'Software' });
      let enrichCalled = false;
      const { calls, captureIndustryLabels } = makeCaptureCapture();
      const deps: ApolloOrgsSearchDeps = {
        searchOrgs: makeSearchSuccess([ORG_SEARCH_BARE]),
        logUsage: makeLogCapture().logFn,
        enrichOrg: async (p) => {
          enrichCalled = true;
          return makeEnrichSuccess(enrichedOrg)(p);
        },
        captureIndustryLabels,
      };

      await runApolloOrganizationsSearch({ query: 'test' }, 3, undefined, deps);

      assert.equal(enrichCalled, false, 'enrichOrg must not be called when cascade flag is OFF');
      const enrichCalls = calls.filter((c) => c.operationKey === 'organization_enrichment');
      assert.equal(enrichCalls.length, 0, 'capture must never be called when the cascade never ran');
    } finally {
      delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    }
  });

  it('T9: wiring does not import the candidate writer or mapping/DRAFT lifecycle modules', () => {
    assert.ok(!/candidate.writer/i.test(IMPORT_STATEMENTS));
    for (const marker of ['mapping-draft', 'mapping-publication', 'snapshot-service', 'association-service', 'contact-', 'account-', 'hubspot']) {
      assert.ok(!IMPORT_STATEMENTS.toLowerCase().includes(marker), `must not import "${marker}"`);
    }
  });

  it('does not add a new fetch/network call — enrichment path stays deps-injected', () => {
    assert.ok(!/\bfetch\s*\(/.test(MODULE_SOURCE), 'wiring must not introduce a new fetch call');
  });
});
