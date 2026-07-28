/**
 * Q3F-5BB.11C — additive provider-routing metadata contract tests.
 *
 * Pure, offline, deterministic. No env, no provider calls, no DB. Covers:
 *   1. Batch merge is additive (existing keys survive).
 *   2. Candidate merge is additive (source_enrichment + duplicateDetails survive).
 *   3. Unknown cost stays null — never 0.
 *   4. provider_attempts[] preserve order and attempt_index alignment.
 *   5. provider consistency: metadata.source_provider === source_trace.sourceProvider,
 *      and a mismatch throws a typed error.
 *   6. Compatibility with 11B: consumes ProviderRoutingPlan + ProviderRunResult.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PROVIDER_ROUTING_CONTRACT_VERSION,
  ProviderMetadataConsistencyError,
  buildProviderRoutingMetadata,
  buildProviderAttemptMetadata,
  buildCandidateProviderTraceMetadata,
  mergeProviderRoutingBatchMetadata,
  mergeCandidateProviderMetadata,
  resolveCandidateProviderConsistency,
  resolveProviderRoutingPlan,
  DEFAULT_PROVIDER_REGISTRY,
} from '../index';
import type {
  ProviderAttemptMetadata,
  ProviderRoutingMetadata,
  CandidateProviderTraceMetadata,
} from '../metadata-contract';
import type {
  ProviderRoutingConfig,
  ProviderRoutingCriteria,
  ProviderRunResult,
} from '../types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const REGISTRY = DEFAULT_PROVIDER_REGISTRY;

function makeConfig(overrides: Partial<ProviderRoutingConfig> = {}): ProviderRoutingConfig {
  return {
    mode: 'observe_only',
    allowFallback: false,
    minUsefulCandidates: 5,
    enabledProviders: {},
    environment: 'production',
    ...overrides,
  };
}

function lushaEligibleCriteria(
  overrides: Partial<ProviderRoutingCriteria> = {},
): ProviderRoutingCriteria {
  return {
    intendedProvider: 'lusha',
    searchType: 'companies_by_criteria',
    countryCode: 'CO',
    sector: 'healthcare',
    needsCompanySearch: true,
    ...overrides,
  };
}

/** A realistic pre-existing batch metadata (mirrors lusha-pending-review). */
function existingBatchMetadata(): Record<string, unknown> {
  return {
    provider: 'lusha',
    discovery_source: 'generate_with_ia_wizard',
    limited_scope: true,
    billing: {
      provider: 'lusha',
      endpoint_category: 'company_prospecting',
      credits_charged: 1,
      results_returned: 10,
      expected_max_credits: 2,
      pages_requested: 1,
    },
    gate_summary: {
      hard_excluded_count: 0,
      warning_count: 0,
      clean_count: 9,
      reason_counts: {},
    },
    source_enrichment_summary: {
      matched_count: 9,
      low_confidence_count: 0,
      not_found_count: 0,
      unsupported_count: 0,
      error_count: 0,
    },
  };
}

/** A realistic pre-existing candidate (mirrors lusha-pending-review). */
function existingCandidate(): {
  metadata: Record<string, unknown>;
  source_trace: Record<string, unknown>;
} {
  return {
    metadata: {
      provider: 'lusha',
      score: 0.82,
      source_provider: 'lusha',
      source_enrichment: {
        co_siis: { status: 'matched', confidence: 0.85 },
      },
      duplicate_check: { summary: 'Sin coincidencias', sources_checked: ['sellup'], matches: [] },
    },
    source_trace: {
      sourceProvider: 'lusha',
      sourceKey: 'clinica-imbanaco.com',
      discovery: 'generate_with_ia_wizard',
      duplicateDetails: {
        reviewerMessage: 'Coincidencia posible con cuenta activa',
        sources: [{ source: 'active_candidate', strength: 'possible' }],
      },
    },
  };
}

function lushaRunResult(overrides: Partial<ProviderRunResult> = {}): ProviderRunResult {
  return {
    provider: 'lusha',
    status: 'success',
    usefulCandidateCount: 9,
    creditsSpent: 1,
    usdSpent: null,
    error: null,
    ...overrides,
  };
}

// ── 1. Batch merge is additive ───────────────────────────────────────────────

describe('11C batch merge — additive', () => {
  const plan = resolveProviderRoutingPlan(
    lushaEligibleCriteria(),
    makeConfig({ enabledProviders: { lusha: true } }),
    REGISTRY,
  );
  const routing = buildProviderRoutingMetadata(plan, {
    environment: 'production',
    fallbackAllowed: false,
  });
  const attempt = buildProviderAttemptMetadata(lushaRunResult(), {
    role: 'primary',
    rawCount: 10,
    normalizedCount: 10,
    gateExcludedCount: 0,
    exactDuplicateCount: 1,
    possibleDuplicateCount: 0,
    persistedCount: 9,
    pagesRequested: 1,
  });

  const existing = existingBatchMetadata();
  const merged = mergeProviderRoutingBatchMetadata(existing, routing, [attempt]);

  it('preserves every existing key', () => {
    assert.equal(merged.provider, 'lusha');
    assert.equal(merged.discovery_source, 'generate_with_ia_wizard');
    assert.deepEqual(merged.billing, existing.billing);
    assert.deepEqual(merged.gate_summary, existing.gate_summary);
    assert.deepEqual(merged.source_enrichment_summary, existing.source_enrichment_summary);
  });

  it('adds provider_routing and provider_attempts', () => {
    assert.deepEqual(merged.provider_routing, routing);
    assert.ok(Array.isArray(merged.provider_attempts));
    assert.equal((merged.provider_attempts as unknown[]).length, 1);
  });

  it('does not mutate the input metadata (immutable)', () => {
    assert.equal('provider_routing' in existing, false);
    assert.equal('provider_attempts' in existing, false);
    assert.notEqual(merged, existing);
  });

  it('matches the 11A contract shape for the routing block', () => {
    const r = merged.provider_routing as ProviderRoutingMetadata;
    assert.equal(r.contract_version, PROVIDER_ROUTING_CONTRACT_VERSION);
    assert.equal(r.mode, 'observe_only');
    assert.equal(r.environment, 'production');
    assert.equal(r.intended_provider, 'lusha');
    assert.equal(r.selected_provider, 'lusha');
    assert.equal(r.fallback_allowed, false);
    assert.equal(r.fallback_reason, null);
    assert.equal(r.dry_run_only, true);
    assert.equal(r.confirmed_by, null);
    assert.equal(r.blocked_reason, null);
  });
});

// ── 2. Candidate merge is additive ───────────────────────────────────────────

describe('11C candidate merge — additive', () => {
  const attempt: ProviderAttemptMetadata = buildProviderAttemptMetadata(lushaRunResult(), {
    role: 'primary',
  });
  const trace = buildCandidateProviderTraceMetadata({ sourceProvider: 'lusha' }, attempt, {
    attemptIndex: 0,
  });

  const existing = existingCandidate();
  const result = mergeCandidateProviderMetadata(existing, trace);

  it('preserves metadata.source_enrichment and other keys', () => {
    assert.deepEqual(result.metadata.source_enrichment, existing.metadata.source_enrichment);
    assert.deepEqual(result.metadata.duplicate_check, existing.metadata.duplicate_check);
    assert.equal(result.metadata.provider, 'lusha');
    assert.equal(result.metadata.score, 0.82);
  });

  it('preserves source_trace.duplicateDetails and other keys', () => {
    assert.deepEqual(result.source_trace.duplicateDetails, existing.source_trace.duplicateDetails);
    assert.equal(result.source_trace.sourceKey, 'clinica-imbanaco.com');
    assert.equal(result.source_trace.discovery, 'generate_with_ia_wizard');
  });

  it('adds source_provider + provider_trace to metadata', () => {
    assert.equal(result.metadata.source_provider, 'lusha');
    assert.deepEqual(result.metadata.provider_trace, trace);
  });

  it('keeps sourceProvider on source_trace', () => {
    assert.equal(result.source_trace.sourceProvider, 'lusha');
  });

  it('does not mutate the input candidate (immutable)', () => {
    assert.equal('provider_trace' in existing.metadata, false);
    assert.notEqual(result.metadata, existing.metadata);
    assert.notEqual(result.source_trace, existing.source_trace);
  });

  it('merges into empty candidate columns without error', () => {
    const r = mergeCandidateProviderMetadata({}, trace);
    assert.equal(r.metadata.source_provider, 'lusha');
    assert.equal(r.source_trace.sourceProvider, 'lusha');
    assert.deepEqual(r.metadata.provider_trace, trace);
  });
});

// ── 3. Unknown cost stays null — never 0 ─────────────────────────────────────

describe('11C unknown cost — never coerced to 0', () => {
  const plan = resolveProviderRoutingPlan(
    lushaEligibleCriteria(),
    makeConfig({ enabledProviders: { lusha: true } }),
    REGISTRY,
  );
  const routing = buildProviderRoutingMetadata(plan, {
    environment: 'production',
    fallbackAllowed: false,
  });

  it('routing estimated_cost.usd_max is null with unknown=true (Lusha unpriced)', () => {
    assert.equal(routing.estimated_cost.unknown, true);
    assert.equal(routing.estimated_cost.usd_max, null);
    assert.notEqual(routing.estimated_cost.usd_max, 0);
    // credits are known (expectedMaxCredits = 2) even though USD is not.
    assert.equal(routing.estimated_cost.credits_max, 2);
  });

  it('attempt credits_used / estimated_cost_usd keep null when unknown', () => {
    const attempt = buildProviderAttemptMetadata(
      lushaRunResult({ creditsSpent: null, usdSpent: null }),
      { role: 'primary' },
    );
    assert.equal(attempt.credits_used, null);
    assert.equal(attempt.estimated_cost_usd, null);
    assert.notEqual(attempt.credits_used, 0);
    assert.notEqual(attempt.estimated_cost_usd, 0);
  });

  it('unsupplied attempt counts are null, not 0', () => {
    const attempt = buildProviderAttemptMetadata(lushaRunResult(), { role: 'primary' });
    assert.equal(attempt.raw_count, null);
    assert.equal(attempt.gate_excluded_count, null);
    assert.equal(attempt.pages_requested, null);
    assert.equal(attempt.quality_score, null);
  });

  it('candidate cost_attribution defaults to null', () => {
    const attempt = buildProviderAttemptMetadata(lushaRunResult(), { role: 'primary' });
    const trace = buildCandidateProviderTraceMetadata({ sourceProvider: 'lusha' }, attempt, {
      attemptIndex: 0,
    });
    assert.equal(trace.cost_attribution.credits_used, null);
    assert.equal(trace.cost_attribution.estimated_cost_usd, null);
  });
});

// ── 4. provider_attempts[] order + attempt_index alignment ───────────────────

describe('11C attempts — order preserved, attempt_index aligned', () => {
  const attempts: ProviderAttemptMetadata[] = [
    buildProviderAttemptMetadata(lushaRunResult(), { role: 'primary' }),
    buildProviderAttemptMetadata(lushaRunResult({ provider: 'tavily', status: 'skipped' }), {
      role: 'fallback',
    }),
  ];

  it('preserves attempts order in the merged batch metadata', () => {
    const merged = mergeProviderRoutingBatchMetadata({}, {} as ProviderRoutingMetadata, attempts);
    const persisted = merged.provider_attempts as ProviderAttemptMetadata[];
    assert.equal(persisted[0].provider, 'lusha');
    assert.equal(persisted[0].role, 'primary');
    assert.equal(persisted[1].provider, 'tavily');
    assert.equal(persisted[1].role, 'fallback');
    assert.equal(persisted[1].status, 'skipped');
  });

  it('candidate provider_trace attempt_index matches its attempt position', () => {
    attempts.forEach((attempt, index) => {
      const trace = buildCandidateProviderTraceMetadata(
        { sourceProvider: attempt.provider },
        attempt,
        { attemptIndex: index },
      );
      assert.equal(trace.attempt_index, index);
      assert.equal(trace.provider, attempt.provider);
      assert.equal(trace.role, attempt.role);
    });
  });

  it('maps run status success → ok', () => {
    const attempt = buildProviderAttemptMetadata(lushaRunResult({ status: 'success' }), {
      role: 'primary',
    });
    assert.equal(attempt.status, 'ok');
  });
});

// ── 5. Provider consistency ──────────────────────────────────────────────────

describe('11C provider consistency', () => {
  const attempt = buildProviderAttemptMetadata(lushaRunResult(), { role: 'primary' });

  it('metadata.source_provider === source_trace.sourceProvider after merge', () => {
    const trace = buildCandidateProviderTraceMetadata({ sourceProvider: 'lusha' }, attempt, {
      attemptIndex: 0,
    });
    const result = mergeCandidateProviderMetadata(existingCandidate(), trace);
    assert.equal(result.metadata.source_provider, result.source_trace.sourceProvider);
  });

  it('throws a typed error when incoming provider mismatches source_trace', () => {
    const trace: CandidateProviderTraceMetadata = buildCandidateProviderTraceMetadata(
      { sourceProvider: 'apollo' },
      { provider: 'apollo', role: 'primary' },
      { attemptIndex: 0 },
    );
    // existing candidate is a Lusha candidate → apollo trace conflicts.
    assert.throws(
      () => mergeCandidateProviderMetadata(existingCandidate(), trace),
      (err: unknown) => {
        assert.ok(err instanceof ProviderMetadataConsistencyError);
        assert.equal(err.code, 'source_trace_provider_mismatch');
        assert.equal(err.existingProvider, 'lusha');
        assert.equal(err.incomingProvider, 'apollo');
        return true;
      },
    );
  });

  it('detects metadata.source_provider mismatch (no source_trace marker)', () => {
    const existing = {
      metadata: { source_provider: 'lusha' },
      source_trace: {},
    };
    const trace = buildCandidateProviderTraceMetadata(
      { sourceProvider: 'tavily' },
      { provider: 'tavily', role: 'primary' },
      { attemptIndex: 0 },
    );
    assert.throws(
      () => mergeCandidateProviderMetadata(existing, trace),
      (err: unknown) =>
        err instanceof ProviderMetadataConsistencyError &&
        err.code === 'metadata_provider_mismatch',
    );
  });

  it('flags a pre-existing internal mismatch between the two markers', () => {
    const existing = {
      metadata: { source_provider: 'apollo' },
      source_trace: { sourceProvider: 'lusha' },
    };
    const result = resolveCandidateProviderConsistency(existing, 'lusha');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'existing_provider_internal_mismatch');
  });

  it('resolves deterministically: respects an existing source_trace provider', () => {
    const existing = { metadata: {}, source_trace: { sourceProvider: 'lusha' } };
    const result = resolveCandidateProviderConsistency(existing, 'lusha');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.resolvedProvider, 'lusha');
  });

  it('adopts the incoming provider when no existing marker is present', () => {
    const result = resolveCandidateProviderConsistency({}, 'tavily');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.resolvedProvider, 'tavily');
  });
});

// ── 6. Compatibility with 11B ────────────────────────────────────────────────

describe('11C compatibility with 11B', () => {
  it('consumes a ProviderRoutingPlan straight from resolveProviderRoutingPlan', () => {
    const plan = resolveProviderRoutingPlan(
      lushaEligibleCriteria(),
      makeConfig({ enabledProviders: { lusha: true } }),
      REGISTRY,
    );
    const routing = buildProviderRoutingMetadata(plan, {
      environment: 'production',
      fallbackAllowed: false,
    });
    assert.equal(routing.selected_provider, plan.selectedProvider);
    assert.equal(routing.intended_provider, plan.intendedProvider);
    assert.equal(routing.requires_confirmation, plan.requiresUserConfirmation);
  });

  it('preserves the 10C3 invariant observably: a Lusha plan never selects Apollo', () => {
    const plan = resolveProviderRoutingPlan(
      lushaEligibleCriteria(),
      makeConfig({
        allowFallback: true,
        enabledProviders: { lusha: true, apollo: true },
        fallbackChain: ['apollo'],
      }),
      REGISTRY,
    );
    const routing = buildProviderRoutingMetadata(plan, {
      environment: 'production',
      fallbackAllowed: true,
    });
    assert.equal(plan.wouldUseApollo, false);
    assert.notEqual(routing.selected_provider, 'apollo');
  });

  it('consumes a ProviderRunResult straight into an attempt entry', () => {
    const runResult: ProviderRunResult = lushaRunResult({ creditsSpent: 1, usefulCandidateCount: 9 });
    const attempt = buildProviderAttemptMetadata(runResult, { role: 'primary', persistedCount: 9 });
    assert.equal(attempt.provider, 'lusha');
    assert.equal(attempt.status, 'ok');
    assert.equal(attempt.persisted_count, 9);
    assert.equal(attempt.credits_used, 1);
  });
});
