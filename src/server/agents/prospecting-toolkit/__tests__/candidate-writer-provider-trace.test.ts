/**
 * Q3F-5BB.11F.2 — Apollo per-candidate provider_trace + source_trace (OBSERVATIONAL).
 *
 * Proves, with NO real Apollo call / no env activation / no real DB:
 *   1. buildApolloCandidateProviderTrace — pure trace shape (provider='apollo',
 *      role='primary', attempt_index=0, source_provider='apollo',
 *      cost_attribution null/null — never coerced to 0).
 *   2. writeProspectingCandidates runtime:
 *        - Apollo (apollo_organizations + provider_routing) → each inserted
 *          candidate row carries metadata.source_provider='apollo',
 *          metadata.provider_trace (provider/source_provider='apollo',
 *          attempt_index=0) and source_trace.sourceProvider='apollo'.
 *        - Apollo WITHOUT provider_routing → NO source_provider / provider_trace,
 *          and source_trace stays absent (guard).
 *        - Tavily / mock → candidate row byte-for-byte unchanged (no
 *          source_provider / provider_trace, no source_trace key).
 *   3. Consistency fail-closed — a candidate that already carries a DIFFERENT
 *      provider makes mergeCandidateProviderMetadata throw
 *      ProviderMetadataConsistencyError (no silent overwrite).
 *   4. Static boundary — the pure helper + touched writer do not reference
 *      contact-enrichment / phone-reveal / person_phone_reveal /
 *      organization_enrichment, and the pure helper imports no Supabase / env /
 *      fetch / provider clients / migrations.
 *
 * Node.js built-in test runner. Sin Supabase real, sin Apollo, sin LLM.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { writeProspectingCandidates } from '../candidate-writer';
import { buildApolloCandidateProviderTrace } from '../provider-routing-attempts';
import {
  mergeCandidateProviderMetadata,
  ProviderMetadataConsistencyError,
} from '@/modules/prospect-batches/provider-routing';
import type { CandidateWriterInput, CatalogContextResult } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PURE_HELPER = resolve(HERE, '..', 'provider-routing-attempts.ts');
const CANDIDATE_WRITER = resolve(HERE, '..', 'candidate-writer.ts');

const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const NEW_BATCH_ID = 'batch-11f2-9999-0000-0000-000000000099';
const APOLLO_WEB_SEARCH_PROVIDER = 'apollo_organizations';

// ─── provider_routing block 11E would have stamped (extraBatchMetadata seam) ───
function makeProviderRouting(): Record<string, unknown> {
  return {
    contract_version: 'provider_routing_v1',
    mode: 'observe_only',
    environment: 'test',
    intended_provider: 'default_ai',
    selected_provider: 'apollo',
    fallback_allowed: false,
    fallback_reason: 'apollo_company_discovery_no_fallback',
    estimated_cost: { credits_max: 10, usd_max: 0.0875, unknown: false },
    requires_confirmation: false,
    confirmed_by: null,
    dry_run_only: false,
    blocked_reason: null,
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FAKE_CATALOG_CONTEXT: CatalogContextResult = {
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'EdTech',
  searchDepth: 'standard',
  fiscalIdentifierLabel: null,
  recommendedSources: [],
  sectorSources: [],
  risks: [],
  operatingRules: [],
  coverageNotes: [],
  promptContext: '',
};

/** Passing candidate factory (mirrors candidate-writer-existing-batch.test.ts). */
function makePipelineOutput(provider: string, candidateCount = 2) {
  const candidates = Array.from({ length: candidateCount }, (_, i) => ({
    name: `Empresa Test ${i + 1}`,
    website: `https://empresa-test-${i + 1}.com.co`,
    domain: `empresa-test-${i + 1}.com.co`,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'EdTech',
    sourceUrl: `https://source-${i + 1}.com`,
    sourceTitle: `Empresa Test ${i + 1} - Software empresarial en Colombia`,
    sourceSnippet: `Empresa colombiana de software empresarial para clientes corporativos en Colombia.`,
    inferredNameSource: null,
    searchTrace: null,
    llmEvaluation: null,
    websiteVerification: null,
    duplicateCheck: {
      status: 'new_candidate' as const,
      confidence: 1,
      input: {
        name: `Empresa Test ${i + 1}`,
        website: `https://empresa-test-${i + 1}.com.co`,
        domain: `empresa-test-${i + 1}.com.co`,
      },
      checkedSources: ['sellup' as const],
      summary: 'No match',
      matches: [],
    },
    scoring: {
      qualityLabel: 'high_quality_new' as const,
      confidenceScore: 0.9,
      fitScore: 0.85,
      dataCompletenessScore: 0.8,
      recommendedAction: 'approve_for_review' as const,
      breakdown: {
        existenceSignals: 1,
        websiteSignals: 1,
        duplicateSignals: 1,
        sourceSignals: 1,
        fitSignals: 1,
        completenessSignals: 1,
        penalties: 0,
      },
      reasons: [],
      warnings: [],
      blockers: [],
    },
  }));

  return {
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'EdTech',
      webSearchProvider: provider,
      mode: 'multi_query' as const,
    },
    catalogContext: FAKE_CATALOG_CONTEXT,
    searchQuery: 'EdTech Colombia',
    webSearch: {
      provider,
      query: 'test',
      results: [],
      resultsCount: candidateCount,
      skipped: false,
      estimatedCostUsd: null,
      metadata: {},
    },
    candidates,
    summary: {
      requested: candidateCount,
      searched: candidateCount,
      returned: candidateCount,
      highQualityNew: candidateCount,
      needsReview: 0,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
      unchecked: 0,
    },
    warnings: [],
    metadata: {
      provider,
      pipelineVersion: 'test-v1',
      executedAt: '2026-07-28T00:00:00.000Z',
      total_raw_evaluated: candidateCount,
    },
  };
}

// ─── Fake admin ─────────────────────────────────────────────────────────────

type FakeAdminStats = {
  candidateInsertCalls: Record<string, unknown>[];
  batchUpdateCalls: Record<string, unknown>[];
};

/** Chainable + thenable stub for empty query results (novelty / usage logs). */
class ChainResult {
  constructor(private readonly _val: unknown) {}
  eq(): ChainResult { return this; }
  neq(): ChainResult { return this; }
  in(): ChainResult { return this; }
  not(): ChainResult { return this; }
  gte(): ChainResult { return this; }
  limit(): ChainResult { return this; }
  select(): ChainResult { return this; }
  then<T>(onFulfilled: (v: unknown) => T | PromiseLike<T>, onRejected?: (r: unknown) => T | PromiseLike<T>): Promise<T> {
    return Promise.resolve(this._val).then(onFulfilled, onRejected);
  }
  single(): Promise<unknown> { return Promise.resolve(this._val); }
}

function makeFakeAdmin(stats: FakeAdminStats): SupabaseClient {
  let candidateSeq = 0;
  return {
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          select() {
            return {
              eq(col: string) {
                if (col === 'source') return new ChainResult({ data: [], error: null });
                return { single: () => Promise.resolve({ data: null, error: { message: 'Not found' } }) };
              },
            };
          },
          update(data: Record<string, unknown>) {
            stats.batchUpdateCalls.push({ ...data });
            return new ChainResult({ error: null });
          },
          insert() {
            return {
              select() {
                return { single: () => Promise.resolve({ data: { id: NEW_BATCH_ID }, error: null }) };
              },
            };
          },
        };
      }
      if (table === 'prospect_candidates') {
        return {
          select() {
            return new ChainResult({ data: [], error: null });
          },
          insert(data: Record<string, unknown>) {
            stats.candidateInsertCalls.push({ ...data });
            const id = `cand-fake-${++candidateSeq}`;
            return {
              select() {
                return { single: () => Promise.resolve({ data: { id }, error: null }) };
              },
            };
          },
        };
      }
      if (table === 'prospect_candidate_audit') {
        return { insert: () => Promise.resolve({ data: null, error: null }) };
      }
      if (table === 'provider_usage_logs') {
        return { select: () => new ChainResult({ data: [], error: null }) };
      }
      throw new Error(`Unexpected table in fake admin: ${table}`);
    },
  } as unknown as SupabaseClient;
}

function makeInput(overrides: Partial<CandidateWriterInput> = {}): CandidateWriterInput {
  return {
    pipelineOutput: makePipelineOutput('mock') as unknown as CandidateWriterInput['pipelineOutput'],
    triggeredByUserId: USER_A,
    ownerId: USER_A,
    source: 'agent_1',
    dryRun: false,
    ...overrides,
  };
}

// ============================================================================
// 1. Pure builder
// ============================================================================

describe('11F.2 buildApolloCandidateProviderTrace — pure shape', () => {
  it('emits the minimal Apollo trace (provider/role/attempt_index/source_provider)', () => {
    const trace = buildApolloCandidateProviderTrace();
    assert.equal(trace.contract_version, 'provider_routing_v1');
    assert.equal(trace.provider, 'apollo');
    assert.equal(trace.role, 'primary');
    assert.equal(trace.attempt_index, 0);
    assert.equal(trace.source_provider, 'apollo');
  });

  it('keeps per-candidate cost null/null (never coerced to 0)', () => {
    const trace = buildApolloCandidateProviderTrace();
    assert.equal(trace.cost_attribution.credits_used, null);
    assert.equal(trace.cost_attribution.estimated_cost_usd, null);
  });

  it('carries no keys beyond the 11C contract shape', () => {
    const trace = buildApolloCandidateProviderTrace();
    assert.deepEqual(Object.keys(trace).sort(), [
      'attempt_index',
      'contract_version',
      'cost_attribution',
      'provider',
      'role',
      'source_provider',
    ]);
  });
});

// ============================================================================
// 2. Runtime — Apollo with provider_routing
// ============================================================================

describe('11F.2 writeProspectingCandidates — Apollo + provider_routing stamps candidate trace', () => {
  it('stamps source_provider + provider_trace + source_trace on every inserted candidate', async () => {
    const stats: FakeAdminStats = { candidateInsertCalls: [], batchUpdateCalls: [] };
    const admin = makeFakeAdmin(stats);
    await writeProspectingCandidates(
      makeInput({
        pipelineOutput: makePipelineOutput(APOLLO_WEB_SEARCH_PROVIDER) as unknown as CandidateWriterInput['pipelineOutput'],
        extraBatchMetadata: { provider_routing: makeProviderRouting() },
      }),
      admin,
    );

    assert.ok(stats.candidateInsertCalls.length > 0, 'at least one candidate must persist');
    for (const row of stats.candidateInsertCalls) {
      const metadata = row['metadata'] as Record<string, unknown>;
      const sourceTrace = row['source_trace'] as Record<string, unknown>;
      assert.equal(metadata['source_provider'], 'apollo');
      const trace = metadata['provider_trace'] as Record<string, unknown>;
      assert.ok(trace, 'provider_trace must be present');
      assert.equal(trace['provider'], 'apollo');
      assert.equal(trace['source_provider'], 'apollo');
      assert.equal(trace['role'], 'primary');
      assert.equal(trace['attempt_index'], 0);
      const cost = trace['cost_attribution'] as Record<string, unknown>;
      assert.equal(cost['credits_used'], null);
      assert.equal(cost['estimated_cost_usd'], null);
      assert.ok(sourceTrace, 'source_trace must be present');
      assert.equal(sourceTrace['sourceProvider'], 'apollo');
    }
  });
});

// ============================================================================
// 3. Runtime — Apollo WITHOUT provider_routing (guard)
// ============================================================================

describe('11F.2 writeProspectingCandidates — Apollo without provider_routing does NOT stamp', () => {
  it('leaves candidate rows without source_provider / provider_trace / source_trace key', async () => {
    const stats: FakeAdminStats = { candidateInsertCalls: [], batchUpdateCalls: [] };
    const admin = makeFakeAdmin(stats);
    await writeProspectingCandidates(
      makeInput({
        pipelineOutput: makePipelineOutput(APOLLO_WEB_SEARCH_PROVIDER) as unknown as CandidateWriterInput['pipelineOutput'],
        // no provider_routing in extraBatchMetadata
      }),
      admin,
    );

    assert.ok(stats.candidateInsertCalls.length > 0, 'at least one candidate must persist');
    for (const row of stats.candidateInsertCalls) {
      const metadata = row['metadata'] as Record<string, unknown>;
      assert.equal('source_provider' in metadata, false);
      assert.equal('provider_trace' in metadata, false);
      assert.equal('source_trace' in row, false);
    }
  });
});

// ============================================================================
// 4. Runtime — Tavily / mock byte-for-byte unchanged
// ============================================================================

describe('11F.2 writeProspectingCandidates — Tavily / mock candidate rows unchanged', () => {
  for (const provider of ['tavily', 'mock']) {
    it(`${provider}: no source_provider / provider_trace / source_trace even if provider_routing present`, async () => {
      const stats: FakeAdminStats = { candidateInsertCalls: [], batchUpdateCalls: [] };
      const admin = makeFakeAdmin(stats);
      await writeProspectingCandidates(
        makeInput({
          pipelineOutput: makePipelineOutput(provider) as unknown as CandidateWriterInput['pipelineOutput'],
          // Even a stray routing block must NOT make a non-Apollo provider stamp.
          extraBatchMetadata: { provider_routing: makeProviderRouting() },
        }),
        admin,
      );

      assert.ok(stats.candidateInsertCalls.length > 0, 'at least one candidate must persist');
      for (const row of stats.candidateInsertCalls) {
        const metadata = row['metadata'] as Record<string, unknown>;
        assert.equal('source_provider' in metadata, false);
        assert.equal('provider_trace' in metadata, false);
        assert.equal('source_trace' in row, false);
      }
    });
  }
});

// ============================================================================
// 5. Consistency — fail-closed on provider mismatch
// ============================================================================

describe('11F.2 mergeCandidateProviderMetadata — fail-closed on provider mismatch', () => {
  it('throws ProviderMetadataConsistencyError when an existing marker is a DIFFERENT provider', () => {
    assert.throws(
      () =>
        mergeCandidateProviderMetadata(
          { metadata: { source_provider: 'lusha' }, source_trace: { sourceProvider: 'lusha' } },
          buildApolloCandidateProviderTrace(),
        ),
      ProviderMetadataConsistencyError,
    );
  });

  it('does NOT throw when there is no existing provider marker (clean adopt)', () => {
    const merged = mergeCandidateProviderMetadata(
      { metadata: {}, source_trace: undefined },
      buildApolloCandidateProviderTrace(),
    );
    assert.equal(merged.metadata['source_provider'], 'apollo');
    assert.equal((merged.source_trace as Record<string, unknown>)['sourceProvider'], 'apollo');
  });
});

// ============================================================================
// 6. Static boundary
// ============================================================================

describe('11F.2 static boundary — pure helper + touched writer stay in scope', () => {
  const stripComments = (code: string) =>
    code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  const helperCode = stripComments(readFileSync(PURE_HELPER, 'utf8'));

  const HELPER_FORBIDDEN: Array<[string, RegExp]> = [
    ['supabase client', /@supabase\/supabase-js|createClient|SupabaseClient/],
    ['process.env', /process\.env/],
    ['fetch/network', /\bfetch\s*\(|axios|node:https?|from ['"]https?/],
    ['apollo provider client', /apollo-organizations-search|apollo-client|apollo-enrichment|apollo-cost/],
    ['contact-enrichment', /contact-enrichment/],
    ['phone reveal', /phone-reveal|phone_reveal|person_phone_reveal/],
    ['organization enrichment', /organization_enrichment/],
    ['db migrations', /migrations?\//],
  ];

  for (const [label, re] of HELPER_FORBIDDEN) {
    it(`pure helper does not reference ${label}`, () => {
      assert.equal(re.test(helperCode), false, `pure helper must not reference ${label}`);
    });
  }

  // The writer already legitimately references Apollo enrichment cost helpers
  // (reconcileApolloOrganizationsCredits) predating 11F.2, so we only assert the
  // company-discovery boundary the candidate trace must respect: it must not
  // reach into phone reveal / contact enrichment.
  const writerCode = stripComments(readFileSync(CANDIDATE_WRITER, 'utf8'));
  const WRITER_FORBIDDEN: Array<[string, RegExp]> = [
    ['contact-enrichment import', /from ['"][^'"]*contact-enrichment/],
    ['phone-reveal import', /from ['"][^'"]*phone-reveal/],
    ['person_phone_reveal reference', /person_phone_reveal/],
  ];
  for (const [label, re] of WRITER_FORBIDDEN) {
    it(`candidate-writer does not reference ${label}`, () => {
      assert.equal(re.test(writerCode), false, `candidate-writer must not reference ${label}`);
    });
  }
});
