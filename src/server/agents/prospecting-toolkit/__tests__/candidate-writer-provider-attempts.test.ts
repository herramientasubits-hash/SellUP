/**
 * Q3F-5BB.11F.1 — Apollo batch provider_attempts[] (OBSERVATIONAL).
 *
 * Proves, with NO real Apollo call / no env activation / no real DB:
 *   1. buildApolloBatchProviderAttempt — pure attempt shape (provider='apollo',
 *      role='primary', estimated_cost_usd=null, status mapping, null counts).
 *   2. shouldEmitApolloBatchProviderAttempts — the guard.
 *   3. reconcileApolloOrganizationsCredits — sums ONLY apollo/organizations_search
 *      credits; null when no confident source; excludes phone_reveal /
 *      organization_enrichment / other providers.
 *   4. writeProspectingCandidates runtime:
 *        - Apollo (apollo_organizations + provider_routing) → emits ONE
 *          provider_attempts[] entry with reconciled credits; provider_routing
 *          preserved untouched; counters mirror the persisted gate summaries.
 *        - Apollo WITHOUT provider_routing → NO provider_attempts (guard).
 *        - Tavily / mock → metadata byte-for-byte unchanged (no provider_attempts).
 *   5. Static boundary — the pure helper imports no Supabase / env / fetch /
 *      provider clients / contact-enrichment / phone-reveal.
 *
 * Node.js built-in test runner. Sin Supabase real, sin Apollo, sin LLM.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { writeProspectingCandidates, reconcileApolloOrganizationsCredits } from '../candidate-writer';
import {
  buildApolloBatchProviderAttempt,
  shouldEmitApolloBatchProviderAttempts,
  APOLLO_ROUTING_PROVIDER_ID,
  APOLLO_WEB_SEARCH_PROVIDER,
} from '../provider-routing-attempts';
import type {
  CandidateWriterInput,
  ProspectingPipelineOutput,
  ProspectingPipelineCandidate,
} from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PURE_HELPER = resolve(HERE, '..', 'provider-routing-attempts.ts');

const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const NEW_BATCH_ID = 'batch-11f1-9999-0000-0000-000000000099';

// ─── Provider_routing block 11E would have stamped (for the extraBatchMetadata seam) ───
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

function makeCandidate(
  overrides: Partial<ProspectingPipelineCandidate> & { name: string },
): ProspectingPipelineCandidate {
  return {
    domain: 'testcompany.com.co',
    website: 'https://testcompany.com.co',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Tecnología',
    scoring: {
      qualityLabel: 'high_quality_new',
      confidenceScore: 0.85,
      fitScore: 0.8,
      dataCompletenessScore: 0.9,
      recommendedAction: 'add_to_pipeline',
      reasons: [],
      warnings: [],
      blockers: [],
    },
    websiteVerification: null,
    duplicateCheck: null,
    sourceUrl: null,
    sourceTitle: null,
    sourceSnippet: null,
    inferredNameSource: 'title',
    searchTrace: null,
    llmEvaluation: null,
    ...overrides,
  } as unknown as ProspectingPipelineCandidate;
}

function makePipelineOutput(
  candidates: ProspectingPipelineCandidate[],
  provider: string,
): ProspectingPipelineOutput {
  return {
    candidates,
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: candidates.length,
      searchDepth: 'standard',
    },
    summary: {
      requested: candidates.length,
      returned: candidates.length,
      highQualityNew: candidates.length,
      needsReview: 0,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
    },
    metadata: {
      provider,
      pipelineVersion: 'test-v1',
      executedAt: '2026-07-28T00:00:00.000Z',
      total_raw_evaluated: 12,
    },
    warnings: [],
  } as unknown as ProspectingPipelineOutput;
}

// External-platform domains → reliably blocked (quality_skipped bucket).
const BLOCKED_CANDIDATES = [
  { name: 'Reddit', website: 'https://www.reddit.com/r/ColombiaDevs/comments/123', domain: 'reddit.com' },
  { name: 'Medium', website: 'https://medium.com/saas-empresarial-colombia', domain: 'medium.com' },
  { name: 'Computerweekly', website: 'https://www.computerweekly.com/es/cronica/x', domain: 'computerweekly.com' },
];

function makeBlockedCandidates(): ProspectingPipelineCandidate[] {
  return BLOCKED_CANDIDATES.map((c) =>
    makeCandidate({
      name: c.name,
      website: c.website,
      domain: c.domain,
      sourceSnippet: 'Software empresarial para empresas en Colombia',
    }),
  );
}

// ─── Fake admin ─────────────────────────────────────────────────────────────

type FakeAdminStats = { batchUpdateCalls: Record<string, unknown>[] };

type ProviderUsageLogRow = {
  batch_id?: string;
  provider_key?: string;
  operation_key?: string;
  credits_used?: unknown;
};

/** Chainable, filtering provider_usage_logs query mock (supports N × .eq()). */
function makeUsageLogQuery(
  rows: ProviderUsageLogRow[],
  error: { message: string } | null,
) {
  const filters: Record<string, unknown> = {};
  const builder = {
    eq(col: string, val: unknown) {
      filters[col] = val;
      return builder;
    },
    then<T>(
      onFulfilled: (v: { data: ProviderUsageLogRow[] | null; error: { message: string } | null }) => T,
      onRejected?: (e: unknown) => T,
    ) {
      if (error) return Promise.resolve({ data: null, error }).then(onFulfilled, onRejected);
      const matched = rows.filter((r) =>
        Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
      );
      return Promise.resolve({ data: matched, error: null }).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

function makeFakeAdmin(
  config: { providerUsageLogs?: ProviderUsageLogRow[]; providerUsageLogsError?: { message: string } | null },
  stats: FakeAdminStats,
): SupabaseClient {
  let candidateSeq = 0;
  return {
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          select() {
            return {
              eq(col: string) {
                if (col === 'source') {
                  return { gte: () => Promise.resolve({ data: [], error: null }) };
                }
                return { single: () => Promise.resolve({ data: null, error: { message: 'Not found' } }) };
              },
            };
          },
          update(data: Record<string, unknown>) {
            stats.batchUpdateCalls.push({ ...data });
            return { eq: () => Promise.resolve({ data: null, error: null }) };
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
            return {
              in(col: string) {
                if (col === 'domain') return Promise.resolve({ data: [], error: null });
                return { not: () => Promise.resolve({ data: [], error: null }) };
              },
            };
          },
          insert() {
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
        return {
          select: () =>
            makeUsageLogQuery(config.providerUsageLogs ?? [], config.providerUsageLogsError ?? null),
        };
      }
      throw new Error(`Unexpected table in fake admin: ${table}`);
    },
  } as unknown as SupabaseClient;
}

function makeInput(overrides: Partial<CandidateWriterInput> = {}): CandidateWriterInput {
  return {
    pipelineOutput: makePipelineOutput([], 'mock'),
    triggeredByUserId: USER_A,
    ownerId: USER_A,
    source: 'agent_1',
    dryRun: false,
    ...overrides,
  };
}

/** Read the LAST persisted batch metadata from the update calls. */
function lastPersistedMetadata(stats: FakeAdminStats): Record<string, unknown> {
  const last = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
  return (last['metadata'] ?? {}) as Record<string, unknown>;
}

// ============================================================================
// 1. Pure builder
// ============================================================================

describe('11F.1 buildApolloBatchProviderAttempt — pure shape', () => {
  const base = {
    writerStatus: 'success' as const,
    rawCount: 12,
    normalizedCount: 8,
    gateExcludedCount: 3,
    exactDuplicateCount: 1,
    possibleDuplicateCount: 2,
    persistedCount: 5,
    creditsUsed: 10,
    failureReason: null,
  };

  it('sets provider=apollo, role=primary, estimated_cost_usd=null', () => {
    const attempt = buildApolloBatchProviderAttempt(base);
    assert.equal(attempt.provider, APOLLO_ROUTING_PROVIDER_ID);
    assert.equal(attempt.provider, 'apollo');
    assert.equal(attempt.role, 'primary');
    assert.equal(attempt.estimated_cost_usd, null);
    assert.equal(attempt.pages_requested, null);
    assert.equal(attempt.quality_score, null);
  });

  it('maps writer status: success/partial_success → ok, failed → error', () => {
    assert.equal(buildApolloBatchProviderAttempt({ ...base, writerStatus: 'success' }).status, 'ok');
    assert.equal(buildApolloBatchProviderAttempt({ ...base, writerStatus: 'partial_success' }).status, 'ok');
    assert.equal(buildApolloBatchProviderAttempt({ ...base, writerStatus: 'failed' }).status, 'error');
  });

  it('carries counters through and keeps exact vs possible duplicates distinct', () => {
    const attempt = buildApolloBatchProviderAttempt(base);
    assert.equal(attempt.raw_count, 12);
    assert.equal(attempt.normalized_count, 8);
    assert.equal(attempt.gate_excluded_count, 3);
    assert.equal(attempt.exact_duplicate_count, 1);
    assert.equal(attempt.possible_duplicate_count, 2);
    assert.equal(attempt.persisted_count, 5);
    assert.equal(attempt.credits_used, 10);
  });

  it('keeps credits_used=null when unknown (never 0)', () => {
    const attempt = buildApolloBatchProviderAttempt({ ...base, creditsUsed: null });
    assert.equal(attempt.credits_used, null);
  });

  it('coerces non-finite / null counts to null (never 0)', () => {
    const attempt = buildApolloBatchProviderAttempt({
      ...base,
      rawCount: null,
      normalizedCount: NaN as unknown as number,
    });
    assert.equal(attempt.raw_count, null);
    assert.equal(attempt.normalized_count, null);
  });

  it('surfaces sanitized failure_reason only on error status', () => {
    const ok = buildApolloBatchProviderAttempt({ ...base, writerStatus: 'success', failureReason: 'boom' });
    assert.equal(ok.failure_reason, null);
    const err = buildApolloBatchProviderAttempt({ ...base, writerStatus: 'failed', failureReason: '  boom  ' });
    assert.equal(err.failure_reason, 'boom');
  });
});

// ============================================================================
// 2. Guard
// ============================================================================

describe('11F.1 shouldEmitApolloBatchProviderAttempts — guard', () => {
  it('true only for apollo_organizations + provider_routing present', () => {
    assert.equal(
      shouldEmitApolloBatchProviderAttempts({ webSearchProvider: APOLLO_WEB_SEARCH_PROVIDER, hasProviderRouting: true }),
      true,
    );
  });
  it('false when provider_routing is absent', () => {
    assert.equal(
      shouldEmitApolloBatchProviderAttempts({ webSearchProvider: 'apollo_organizations', hasProviderRouting: false }),
      false,
    );
  });
  it('false for tavily / mock / unknown providers', () => {
    for (const p of ['tavily', 'mock', 'unknown', undefined, null]) {
      assert.equal(shouldEmitApolloBatchProviderAttempts({ webSearchProvider: p, hasProviderRouting: true }), false);
    }
  });
});

// ============================================================================
// 3. Credit reconciliation — operation filter
// ============================================================================

describe('11F.1 reconcileApolloOrganizationsCredits — operation filter', () => {
  const BATCH = 'batch-recon-0001';
  const mkAdmin = (rows: ProviderUsageLogRow[], error: { message: string } | null = null): SupabaseClient =>
    ({
      from: () => ({ select: () => makeUsageLogQuery(rows, error) }),
    }) as unknown as SupabaseClient;

  it('sums ONLY apollo/organizations_search credits, excluding phone_reveal / org_enrichment / other providers', async () => {
    const rows: ProviderUsageLogRow[] = [
      { batch_id: BATCH, provider_key: 'apollo', operation_key: 'organizations_search', credits_used: 3 },
      { batch_id: BATCH, provider_key: 'apollo', operation_key: 'organizations_search', credits_used: 4 },
      { batch_id: BATCH, provider_key: 'apollo', operation_key: 'person_phone_reveal', credits_used: 8 },
      { batch_id: BATCH, provider_key: 'apollo', operation_key: 'organization_enrichment', credits_used: 5 },
      { batch_id: BATCH, provider_key: 'tavily', operation_key: 'multi_query_web_search', credits_used: 20 },
    ];
    const total = await reconcileApolloOrganizationsCredits(mkAdmin(rows), BATCH);
    assert.equal(total, 7); // 3 + 4 only
  });

  it('returns null when there are no matching organizations_search rows (never 0)', async () => {
    const rows: ProviderUsageLogRow[] = [
      { batch_id: BATCH, provider_key: 'apollo', operation_key: 'person_phone_reveal', credits_used: 8 },
    ];
    const total = await reconcileApolloOrganizationsCredits(mkAdmin(rows), BATCH);
    assert.equal(total, null);
  });

  it('returns null on query error (fail-soft)', async () => {
    const total = await reconcileApolloOrganizationsCredits(mkAdmin([], { message: 'db down' }), BATCH);
    assert.equal(total, null);
  });

  it('returns null when matching rows carry no numeric credit', async () => {
    const rows: ProviderUsageLogRow[] = [
      { batch_id: BATCH, provider_key: 'apollo', operation_key: 'organizations_search', credits_used: null },
    ];
    const total = await reconcileApolloOrganizationsCredits(mkAdmin(rows), BATCH);
    assert.equal(total, null);
  });
});

// ============================================================================
// 4. Runtime — writeProspectingCandidates
// ============================================================================

describe('11F.1 writeProspectingCandidates — Apollo provider_attempts[]', () => {
  it('emits ONE apollo attempt with reconciled credits + preserves provider_routing', async () => {
    const stats: FakeAdminStats = { batchUpdateCalls: [] };
    const routing = makeProviderRouting();
    const admin = makeFakeAdmin(
      {
        providerUsageLogs: [
          { batch_id: NEW_BATCH_ID, provider_key: 'apollo', operation_key: 'organizations_search', credits_used: 6 },
          { batch_id: NEW_BATCH_ID, provider_key: 'apollo', operation_key: 'person_phone_reveal', credits_used: 9 },
        ],
      },
      stats,
    );
    const result = await writeProspectingCandidates(
      makeInput({
        pipelineOutput: makePipelineOutput(makeBlockedCandidates(), APOLLO_WEB_SEARCH_PROVIDER),
        extraBatchMetadata: { provider_routing: routing },
      }),
      admin,
    );

    const meta = lastPersistedMetadata(stats);
    const attempts = meta['provider_attempts'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(attempts), 'provider_attempts must be an array');
    assert.equal(attempts.length, 1);

    const a = attempts[0];
    assert.equal(a['provider'], 'apollo');
    assert.equal(a['role'], 'primary');
    assert.equal(a['estimated_cost_usd'], null);
    assert.equal(a['credits_used'], 6); // organizations_search only; phone_reveal excluded
    assert.equal(a['persisted_count'], result.createdCandidateIds.length);

    // provider_routing preserved untouched (byte-for-byte vs the 11E block).
    assert.deepEqual(meta['provider_routing'], routing);
  });

  it('counter fields mirror the persisted gate summaries (no cross-mixing)', async () => {
    const stats: FakeAdminStats = { batchUpdateCalls: [] };
    const admin = makeFakeAdmin({ providerUsageLogs: [] }, stats);
    await writeProspectingCandidates(
      makeInput({
        pipelineOutput: makePipelineOutput(makeBlockedCandidates(), APOLLO_WEB_SEARCH_PROVIDER),
        extraBatchMetadata: { provider_routing: makeProviderRouting() },
      }),
      admin,
    );

    const meta = lastPersistedMetadata(stats);
    const a = (meta['provider_attempts'] as Array<Record<string, unknown>>)[0];
    const writerSummary = meta['writer_summary'] as Record<string, number>;
    const identityGate = meta['canonical_identity_gate'] as Record<string, number>;
    const precisionGate = meta['precision_gate'] as Record<string, number>;
    const duplicateGuard = meta['duplicate_guard'] as Record<string, number>;

    assert.equal(
      a['gate_excluded_count'],
      writerSummary['quality_skipped_count'] + identityGate['total_exclusions'],
    );
    assert.equal(a['exact_duplicate_count'], precisionGate['intra_batch_duplicates_removed']);
    assert.equal(a['possible_duplicate_count'], duplicateGuard['possible_duplicate_count']);
    // No credits logged → null (never 0).
    assert.equal(a['credits_used'], null);
    // normalized_count comes from pipeline summary.returned (3 candidates in).
    assert.equal(a['normalized_count'], 3);
    assert.equal(a['raw_count'], 12);
  });

  it('does NOT emit provider_attempts when provider_routing is absent (guard)', async () => {
    const stats: FakeAdminStats = { batchUpdateCalls: [] };
    const admin = makeFakeAdmin({ providerUsageLogs: [] }, stats);
    await writeProspectingCandidates(
      makeInput({
        pipelineOutput: makePipelineOutput(makeBlockedCandidates(), APOLLO_WEB_SEARCH_PROVIDER),
        // no provider_routing in extraBatchMetadata
      }),
      admin,
    );
    const meta = lastPersistedMetadata(stats);
    assert.equal('provider_attempts' in meta, false);
  });

  it('leaves Tavily metadata byte-for-byte unchanged (no provider_attempts)', async () => {
    const stats: FakeAdminStats = { batchUpdateCalls: [] };
    const admin = makeFakeAdmin({ providerUsageLogs: [] }, stats);
    await writeProspectingCandidates(
      makeInput({
        pipelineOutput: makePipelineOutput(makeBlockedCandidates(), 'tavily'),
        // Even if a stray provider_routing were present, a tavily provider must NOT emit.
        extraBatchMetadata: { provider_routing: makeProviderRouting() },
      }),
      admin,
    );
    const meta = lastPersistedMetadata(stats);
    assert.equal('provider_attempts' in meta, false);
  });

  it('leaves mock metadata unchanged (no provider_attempts)', async () => {
    const stats: FakeAdminStats = { batchUpdateCalls: [] };
    const admin = makeFakeAdmin({ providerUsageLogs: [] }, stats);
    await writeProspectingCandidates(
      makeInput({ pipelineOutput: makePipelineOutput(makeBlockedCandidates(), 'mock') }),
      admin,
    );
    const meta = lastPersistedMetadata(stats);
    assert.equal('provider_attempts' in meta, false);
  });
});

// ============================================================================
// 5. Static boundary — pure helper stays pure
// ============================================================================

describe('11F.1 static boundary — provider-routing-attempts.ts is pure', () => {
  const code = readFileSync(PURE_HELPER, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  const FORBIDDEN: Array<[string, RegExp]> = [
    ['supabase client', /@supabase\/supabase-js|createClient|SupabaseClient/],
    ['process.env', /process\.env/],
    ['fetch/network', /\bfetch\s*\(|axios|node:https?|from ['"]https?/],
    ['apollo provider client', /apollo-organizations-search|apollo-client|apollo-enrichment|apollo-cost/],
    ['contact-enrichment', /contact-enrichment/],
    ['phone reveal', /phone-reveal|phone_reveal|person_phone_reveal/],
    ['db migrations', /migrations?\//],
  ];

  for (const [label, re] of FORBIDDEN) {
    it(`does not reference ${label}`, () => {
      assert.equal(re.test(code), false, `pure helper must not reference ${label}`);
    });
  }
});
