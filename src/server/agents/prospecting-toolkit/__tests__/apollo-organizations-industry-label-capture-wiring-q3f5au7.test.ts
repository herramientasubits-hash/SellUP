/**
 * Tests — Apollo Organizations Search: raw industry label capture wiring
 * (Q3F-5AU.7)
 *
 * Verifies the best-effort wiring of captureProviderIndustryRawLabelObservations
 * into runApolloOrganizationsSearch:
 *   T1. Industry labels present → helper called with correct
 *       sourceVocabularyKey/providerKey/operationKey/labels shape.
 *   T2. No industry labels → helper is never called.
 *   T3. Helper returns 'failed' → Apollo flow returns the same results
 *       (unaffected).
 *   T4. Helper returns 'skipped' → Apollo flow returns the same results
 *       (unaffected).
 *   T5. sourceContext sent to the helper carries no full org payload, no
 *       email/phone/LinkedIn — only the minimal allowlisted keys.
 *   T6. No live Apollo — fully mocked via dependency injection.
 *   T7. No candidate-writer coupling introduced by this wiring.
 *   T8. Duplicate raw labels across organizations are deduplicated by the
 *       existing ingestion boundary (no new dedup semantics introduced here).
 *   T9. Helper throwing synchronously is contained — flow still returns
 *       results, does not throw outward.
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
import type { ApolloSearchResult, ApolloOrganization } from '@/server/integrations/apollo-client';

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

function noopLogUsage(): ApolloOrgsSearchDeps['logUsage'] {
  return (async () => ({ kind: 'logged' as const })) as ApolloOrgsSearchDeps['logUsage'];
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

describe('Q3F-5AU.7 — Apollo organizations search: raw industry label capture wiring', () => {
  before(() => { process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true'; });
  after(() => { delete process.env.ENABLE_APOLLO_COMPANY_SEARCH; });

  it('T1: industry labels present → helper called with correct contract', async () => {
    const orgs = [
      makeOrg({ id: 'o1', name: 'Alpha Corp', industry: 'Software', industries: ['Software', 'SaaS'] }),
      makeOrg({ id: 'o2', name: 'Beta SA', industry: 'FinTech', industries: null }),
    ];
    const { calls, captureIndustryLabels } = makeCaptureCapture();
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: mockSearchSuccess(orgs),
      logUsage: noopLogUsage(),
      captureIndustryLabels,
    };

    await runApolloOrganizationsSearch(
      { query: 'tech Colombia', countryCode: 'CO', industry: 'Technology' },
      5,
      { agentRunId: 'run-abc-1' },
      deps,
    );

    assert.equal(calls.length, 1, 'capture helper must be called exactly once');
    const call = calls[0];
    assert.equal(call.sourceVocabularyKey, 'apollo_organization_industry');
    assert.equal(call.providerKey, 'apollo');
    assert.equal(call.operationKey, 'organizations_search');
    assert.equal(call.countryCode, 'CO');
    assert.equal(call.requestedIndustry, 'Technology');
    assert.equal(call.agentRunId, 'run-abc-1');

    // Dedup groups: FinTech, SaaS, Software (normalized-key ASC order — same
    // ordering contract as ingestApolloOrganizationIndustryRawLabels).
    const expectedRawLabels = ['FinTech', 'SaaS', 'Software'];
    assert.deepEqual(call.labels.map((l) => l.rawLabel), expectedRawLabels);
    for (const label of call.labels) {
      assert.equal(
        label.normalizedLookupKey,
        normalizeClassificationValue(label.rawLabel),
        `normalizedLookupKey must match the canonical normalizer for "${label.rawLabel}"`,
      );
    }
  });

  it('T2: no industry labels present → helper is never called', async () => {
    const orgs = [
      makeOrg({ id: 'o1', name: 'NoIndustry Corp', industry: null, industries: undefined }),
      makeOrg({ id: 'o2', name: 'AlsoNoIndustry SA', industry: null, industries: [] }),
    ];
    const { calls, captureIndustryLabels } = makeCaptureCapture();
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: mockSearchSuccess(orgs),
      logUsage: noopLogUsage(),
      captureIndustryLabels,
    };

    const out = await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, deps);

    assert.equal(calls.length, 0, 'capture helper must not be called when there are no raw labels');
    assert.equal(out.results.length, 2, 'Apollo flow unaffected by absence of industry labels');
  });

  it('T3: helper returns failed → Apollo flow returns the same results', async () => {
    const orgs = [makeOrg({ id: 'o1', name: 'Alpha Corp', industry: 'Software' })];
    const { captureIndustryLabels } = makeCaptureCapture({ status: 'failed', errorCode: 'rpc_call_failed' });
    const depsWithCapture: ApolloOrgsSearchDeps = {
      searchOrgs: mockSearchSuccess(orgs),
      logUsage: noopLogUsage(),
      captureIndustryLabels,
    };
    const depsWithoutCapture: ApolloOrgsSearchDeps = {
      searchOrgs: mockSearchSuccess(orgs),
      logUsage: noopLogUsage(),
    };

    const outWithFailedCapture = await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, depsWithCapture);
    const outBaseline = await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, depsWithoutCapture);

    assert.deepEqual(outWithFailedCapture.results, outBaseline.results);
    assert.equal(outWithFailedCapture.resultsCount, outBaseline.resultsCount);
    assert.equal(outWithFailedCapture.skipped, false);
  });

  it('T4: helper returns skipped → Apollo flow returns the same results', async () => {
    const orgs = [makeOrg({ id: 'o1', name: 'Alpha Corp', industry: 'Software' })];
    const { captureIndustryLabels } = makeCaptureCapture({ status: 'skipped', reason: 'client_unavailable' });
    const depsWithCapture: ApolloOrgsSearchDeps = {
      searchOrgs: mockSearchSuccess(orgs),
      logUsage: noopLogUsage(),
      captureIndustryLabels,
    };
    const depsWithoutCapture: ApolloOrgsSearchDeps = {
      searchOrgs: mockSearchSuccess(orgs),
      logUsage: noopLogUsage(),
    };

    const outWithSkippedCapture = await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, depsWithCapture);
    const outBaseline = await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, depsWithoutCapture);

    assert.deepEqual(outWithSkippedCapture.results, outBaseline.results);
    assert.equal(outWithSkippedCapture.resultsCount, outBaseline.resultsCount);
  });

  it('T5: sourceContext sent to helper carries no PII/full payload — minimal keys only', async () => {
    const orgs = [
      makeOrg({
        id: 'o1',
        name: 'Alpha Corp',
        industry: 'Software',
        linkedin_url: 'https://linkedin.com/company/alpha',
      }),
    ];
    const { calls, captureIndustryLabels } = makeCaptureCapture();
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: mockSearchSuccess(orgs),
      logUsage: noopLogUsage(),
      captureIndustryLabels,
    };

    await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, deps);

    assert.equal(calls.length, 1);
    const sourceContext = calls[0].sourceContext ?? {};
    assert.deepEqual(Object.keys(sourceContext).sort(), ['operation', 'resultCount']);
    const serialized = JSON.stringify(sourceContext);
    assert.equal(serialized.includes('linkedin.com'), false);
    assert.equal(serialized.includes('@'), false);
    assert.equal(serialized.includes('Alpha Corp'), false, 'must not embed the org name');
    assert.equal(serialized.includes('org-test-001'), false, 'must not embed a full org object');
  });

  it('T6: fully mocked — no live Apollo call, no fetch/network usage', async () => {
    let searchOrgsCalled = false;
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: async () => {
        searchOrgsCalled = true;
        return { success: true, data: [makeOrg({ industry: 'Software' })] };
      },
      logUsage: noopLogUsage(),
      captureIndustryLabels: makeCaptureCapture().captureIndustryLabels,
    };

    await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, deps);

    assert.equal(searchOrgsCalled, true, 'the injected mock — not the real client — must be invoked');
    assert.ok(!/\bfetch\s*\(/.test(MODULE_SOURCE), 'wiring must not introduce a new fetch call');
  });

  it('T7: wiring does not import the candidate writer or mapping/DRAFT lifecycle modules', () => {
    assert.ok(!/candidate.writer/i.test(IMPORT_STATEMENTS));
    for (const marker of ['mapping-draft', 'mapping-publication', 'snapshot-service', 'association-service']) {
      assert.ok(!IMPORT_STATEMENTS.toLowerCase().includes(marker), `must not import "${marker}"`);
    }
  });

  it('T8: duplicate raw labels across organizations are deduplicated (existing ingestion semantics)', async () => {
    const orgs = [
      makeOrg({ id: 'o1', name: 'Alpha Corp', industry: 'Software' }),
      makeOrg({ id: 'o2', name: 'Beta SA', industry: 'software' }),
      makeOrg({ id: 'o3', name: 'Gamma SA', industry: 'SOFTWARE' }),
    ];
    const { calls, captureIndustryLabels } = makeCaptureCapture();
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: mockSearchSuccess(orgs),
      logUsage: noopLogUsage(),
      captureIndustryLabels,
    };

    await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, deps);

    assert.equal(calls.length, 1);
    // All three collapse into a single normalized-key group ('software');
    // exactly one representative label is sent.
    assert.equal(calls[0].labels.length, 1);
    assert.equal(calls[0].labels[0].normalizedLookupKey, 'software');
  });

  it('T9: helper throwing synchronously is contained — Apollo flow still returns results', async () => {
    const orgs = [makeOrg({ id: 'o1', name: 'Alpha Corp', industry: 'Software' })];
    const deps: ApolloOrgsSearchDeps = {
      searchOrgs: mockSearchSuccess(orgs),
      logUsage: noopLogUsage(),
      captureIndustryLabels: (async () => {
        throw new Error('unexpected capture bug');
      }) as ApolloOrgsSearchDeps['captureIndustryLabels'],
    };

    let threw = false;
    let out;
    try {
      out = await runApolloOrganizationsSearch({ query: 'test' }, 5, undefined, deps);
    } catch {
      threw = true;
    }

    assert.equal(threw, false, 'capture helper throwing must not propagate outward');
    assert.equal(out?.results.length, 1);
    assert.equal(out?.results[0].title, 'Alpha Corp');
  });
});
