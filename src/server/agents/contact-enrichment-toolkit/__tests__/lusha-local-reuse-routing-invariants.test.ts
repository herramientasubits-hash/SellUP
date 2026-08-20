// Tests — LOCAL reuse gate inside the LIVE automatic router
// AGENT2A-LUSHA-LOCAL-REUSE-GATE-1
//
// The point of these tests is PLACEMENT. The reuse gate must execute after the
// Apollo fallback signal recommends a fallback and BEFORE any Lusha
// provider-specific work: no availability lookup (therefore no API-key
// resolution), no fallback cost estimate, no budget evaluation, no
// attempt_order=2, no Lusha run. A free local result must not be rejected
// because a hypothetical provider call would be unavailable or unaffordable.
//
// Fully offline: every dependency is injected. No Supabase, no network, no
// Apollo/Lusha/HubSpot call, no credential, 0 credits.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  runAutomaticContactEnrichmentFallbackForRequest,
  type AutomaticRoutingOrchestratorDeps,
  type AutomaticRoutingOrchestratorResult,
} from '../contact-enrichment-routing-orchestrator';
import type { ApolloEnrichmentRunResult } from '../apollo-enrichment-runner';
import type { LushaRunnerResult } from '../lusha-enrichment-runner';
import type { ContactEnrichmentRoutingConfigV1 } from '@/modules/contact-enrichment-routing/routing-config.server';
import { CONTACT_ENRICHMENT_ROUTING_V1_AUTOMATIC_POLICY_VERSION } from '@/modules/contact-enrichment-routing/routing-config.server';
import type { AttemptCreationResult } from '@/modules/contact-enrichment/request-attempt-types';
import type { LushaLocalReuseGateResultV1 } from '../lusha-local-candidate-reuse-gate';

/**
 * Reads a sibling module and returns ONLY its executable body: block comments
 * and line comments are removed first.
 *
 * This matters. A static guard that greps the RAW file text confuses "the code
 * does X" with "a comment SAYS the code must never do X" — every negative
 * assertion below would pass or fail on prose instead of behaviour. Each guard
 * is verified in the negative (see the self-check block at the end of this
 * file) so a stripper that silently returned an empty string could not make
 * the whole suite green.
 */
function executableSource(relativePath: string): string {
  const raw = readFileSync(new URL(relativePath, import.meta.url), 'utf-8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}

/** Raw file text — only for assertions ABOUT the prose itself. */
function rawSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf-8');
}

const ORCHESTRATOR = '../contact-enrichment-routing-orchestrator.ts';
const REUSE_GATE = '../lusha-local-candidate-reuse-gate.ts';
const NOVELTY_GATE = '../provider-native-novelty-gate.ts';

const EVALUATED_AT = '2026-08-20T00:00:00.000Z';
const INPUT = { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT };

function baseConfig(overrides: Partial<ContactEnrichmentRoutingConfigV1> = {}): ContactEnrichmentRoutingConfigV1 {
  return {
    automaticRoutingEnabled: true,
    mode: 'automatic',
    primaryProvider: 'apollo',
    fallbackProvider: 'lusha',
    maxAttempts: 2,
    enabledFallbackReasons: ['zero_reviewable_candidates'],
    firstRolloutReason: 'zero_reviewable_candidates',
    providerErrorFallbackEnabled: false,
    zeroReviewableFallbackEnabled: true,
    budgetGuardrailEnabled: false,
    perRequestMaxEstimatedCostUsd: null,
    allowManualProviderSelection: true,
    requireHumanReview: true,
    allowHubSpotAutoWrite: false,
    allowPhoneReveal: false,
    policyVersion: CONTACT_ENRICHMENT_ROUTING_V1_AUTOMATIC_POLICY_VERSION,
    ...overrides,
  };
}

function apolloResult(overrides: Partial<ApolloEnrichmentRunResult> = {}): ApolloEnrichmentRunResult {
  return {
    status: 'ready_for_review',
    runStatus: 'ready_for_review',
    candidatesCreated: 0,
    duplicatesSkipped: 0,
    possibleDuplicates: 0,
    exactDuplicates: 0,
    rawResultsCount: 0,
    normalizedCount: 0,
    evaluatedCount: 0,
    rejectedByRelevance: 0,
    noReviewableContactsFound: false,
    existingPendingDuplicatesSkipped: 0,
    completionAttempted: 0,
    completionCompleted: 0,
    actionableContactsCount: 0,
    noActionableContactsFound: false,
    providerStatus: 'success',
    estimatedCostUsd: 0,
    totalCandidates: 0,
    ...overrides,
  };
}

function lushaResult(): LushaRunnerResult {
  return {
    ok: true,
    status: 'success',
    runId: 'attempt-2',
    candidatesCreated: 1,
    duplicatesSkipped: 0,
    rawResultsCount: 1,
    creditsUsed: 1,
    message: 'ok',
  };
}

function reuseHit(count = 1): LushaLocalReuseGateResultV1 {
  return {
    hit: true,
    actionableReusableCandidateCount: count,
    observability: {
      gate_applied: true,
      gate_skipped_reason: null,
      actionable_reusable_candidate_count: count,
      threshold: 1,
      provider_calls: 0,
      outcome: 'fallback_satisfied_by_existing_candidate',
      company_scope_kind: 'account_id',
      lookup_error: null,
    },
  };
}

function reuseMiss(
  reason: LushaLocalReuseGateResultV1['observability']['gate_skipped_reason'] = 'no_actionable_reusable_candidate',
  lookupError: string | null = null,
): LushaLocalReuseGateResultV1 {
  return {
    hit: false,
    actionableReusableCandidateCount: 0,
    observability: {
      gate_applied: reason === 'no_actionable_reusable_candidate',
      gate_skipped_reason: reason,
      actionable_reusable_candidate_count: 0,
      threshold: 1,
      provider_calls: 0,
      outcome: 'fallback_not_satisfied_locally',
      company_scope_kind: 'account_id',
      lookup_error: lookupError,
    },
  };
}

interface Calls {
  resolveAttempt1: number;
  runApollo: number;
  isFallbackAvailable: number;
  estimateFallbackCost: number;
  createFallback: number;
  runLusha: number;
  evaluateLocalReuse: number;
  writeTelemetry: Array<{ attemptId: string; columns: Record<string, unknown>; summary: Record<string, unknown> }>;
  /** Ordered log — proves the reuse gate runs BEFORE availability/budget, not merely instead of them. */
  order: string[];
}

function harness(
  config: ContactEnrichmentRoutingConfigV1,
  overrides: Partial<AutomaticRoutingOrchestratorDeps> = {},
): { deps: AutomaticRoutingOrchestratorDeps; calls: Calls } {
  const calls: Calls = {
    resolveAttempt1: 0,
    runApollo: 0,
    isFallbackAvailable: 0,
    estimateFallbackCost: 0,
    createFallback: 0,
    runLusha: 0,
    evaluateLocalReuse: 0,
    writeTelemetry: [],
    order: [],
  };

  const deps: AutomaticRoutingOrchestratorDeps = {
    getConfig: () => config,
    assertEnvironmentSafe: () => {},
    resolveAttempt1: async () => {
      calls.resolveAttempt1 += 1;
      calls.order.push('resolveAttempt1');
      return { outcome: 'execute', attemptId: 'attempt-1' };
    },
    runApolloAttempt: async () => {
      calls.runApollo += 1;
      calls.order.push('runApollo');
      return apolloResult();
    },
    evaluateLocalCandidateReuse: async () => {
      calls.evaluateLocalReuse += 1;
      calls.order.push('evaluateLocalCandidateReuse');
      return reuseMiss();
    },
    isFallbackProviderAvailable: async () => {
      calls.isFallbackAvailable += 1;
      calls.order.push('isFallbackProviderAvailable');
      return true;
    },
    estimateFallbackCostUsd: () => {
      calls.estimateFallbackCost += 1;
      calls.order.push('estimateFallbackCostUsd');
      return null;
    },
    createFallbackAttempt: async (): Promise<AttemptCreationResult> => {
      calls.createFallback += 1;
      calls.order.push('createFallbackAttempt');
      return { status: 'created', attemptId: 'attempt-2', agentRunId: 'agent-run-2' };
    },
    runLushaAttempt: async () => {
      calls.runLusha += 1;
      calls.order.push('runLushaAttempt');
      return lushaResult();
    },
    writeRoutingTelemetry: async (attemptId, columns, summary) => {
      calls.writeTelemetry.push({
        attemptId,
        columns: columns as unknown as Record<string, unknown>,
        summary: summary as unknown as Record<string, unknown>,
      });
    },
    ...overrides,
  };

  return { deps, calls };
}

/** Flag OFF is modelled the way the orchestrator's own default does it: the gate returns a disabled MISS without touching any reader. */
function flagOffDeps(config: ContactEnrichmentRoutingConfigV1) {
  return harness(config, {
    evaluateLocalCandidateReuse: undefined,
  });
}

// ── 1. Flag OFF: exact existing path, reader never executes ─────

describe('new reuse flag default OFF', () => {
  it('the flag-off gate result keeps the existing fallback path byte-for-byte', async () => {
    const { deps, calls } = harness(baseConfig(), {
      evaluateLocalCandidateReuse: async () => {
        calls.evaluateLocalReuse += 1;
        calls.order.push('evaluateLocalCandidateReuse');
        return reuseMiss('gate_disabled');
      },
    });

    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);

    assert.equal(result.outcome, 'fallback_executed');
    assert.equal(result.reusedExistingCandidates, 0);
    assert.equal(calls.isFallbackAvailable, 1);
    assert.equal(calls.createFallback, 1);
    assert.equal(calls.runLusha, 1);
  });

  it('with the flag off no reuse READER runs — the gate short-circuits before any query', async () => {
    // Proven at the gate level (see lusha-local-candidate-reuse-gate.test.ts):
    // isGateEnabled() === false returns before readRequestCompanyKeys /
    // readReusableCandidates are consulted. Here we assert the router's own
    // default dep is the flag-guarded gate, not a bare reader.
    const source = executableSource(ORCHESTRATOR);
    assert.match(source, /isLushaLocalReuseGateEnabled/);
    assert.match(source, /isGateEnabled: isLushaLocalReuseGateEnabled/);
    assert.doesNotMatch(source, /readReusableLushaCandidatesForCompanyScope/);
  });

  it('router-level flag-off default still produces the untouched fallback outcome', async () => {
    const { deps } = flagOffDeps(baseConfig());
    // The default dep resolves the real, flag-guarded gate. With
    // ENABLE_LUSHA_LOCAL_REUSE_GATE unset in this test process the gate is
    // disabled, so the fallback executes exactly as before.
    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
    assert.equal(result.outcome, 'fallback_executed');
    assert.equal(result.reusedExistingCandidates, 0);
  });
});

// ── 2. Fallback not recommended: gate never runs ────────────────

describe('flag ON but Apollo does not recommend a fallback', () => {
  it('the reuse gate is never evaluated', async () => {
    const { deps, calls } = harness(baseConfig(), {
      runApolloAttempt: async () => {
        calls.runApollo += 1;
        return apolloResult({ candidatesCreated: 3 });
      },
      evaluateLocalCandidateReuse: async () => {
        calls.evaluateLocalReuse += 1;
        return reuseHit();
      },
    });

    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);

    assert.equal(result.outcome, 'no_fallback_needed');
    assert.equal(result.reusedExistingCandidates, 0);
    assert.equal(calls.evaluateLocalReuse, 0);
  });
});

// ── 3–9. Reuse HIT: outcome, contract, and the placement proofs ─

describe('reuse HIT', () => {
  async function hitRun(
    overrides: Partial<AutomaticRoutingOrchestratorDeps> = {},
    config = baseConfig(),
  ): Promise<{ result: AutomaticRoutingOrchestratorResult; calls: Calls }> {
    const { deps, calls } = harness(config, {
      evaluateLocalCandidateReuse: async () => {
        calls.evaluateLocalReuse += 1;
        calls.order.push('evaluateLocalCandidateReuse');
        return reuseHit();
      },
      ...overrides,
    });
    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
    return { result, calls };
  }

  it('outcome is fallback_skipped_local_reuse', async () => {
    const { result } = await hitRun();
    assert.equal(result.outcome, 'fallback_skipped_local_reuse');
    assert.equal(result.automaticRoutingEnabled, true);
    assert.equal(result.blockedReason, null);
  });

  it('reusedExistingCandidates >= 1', async () => {
    const { result } = await hitRun();
    assert.ok(result.reusedExistingCandidates >= 1);
    assert.equal(result.reusedExistingCandidates, 1);
  });

  it('attempt2 is null and attempt1 keeps the real Apollo attempt/result', async () => {
    const { result } = await hitRun();
    assert.equal(result.attempt2, null);
    assert.equal(result.attempt1?.attemptId, 'attempt-1');
    assert.equal(result.attempt1?.result.candidatesCreated, 0);
  });

  it('fallbackExecuted is false while wouldRecommendFallback stays true', async () => {
    const { result } = await hitRun();
    assert.equal(result.fallbackExecuted, false);
    assert.equal(result.wouldRecommendFallback, true);
  });

  it('the ORIGINAL Apollo fallback reason is preserved', async () => {
    const { result } = await hitRun();
    assert.equal(result.fallbackReason, 'zero_reviewable_candidates');
  });

  it('createFallbackAttempt is NOT called', async () => {
    const { calls } = await hitRun();
    assert.equal(calls.createFallback, 0);
  });

  it('runLushaAttempt is NOT called', async () => {
    const { calls } = await hitRun();
    assert.equal(calls.runLusha, 0);
  });

  it('isFallbackProviderAvailable is NOT called — so getLushaApiKey is never reached', async () => {
    const { calls } = await hitRun();
    assert.equal(calls.isFallbackAvailable, 0);
  });

  it('estimateFallbackCostUsd is NOT called and no budget evaluation happens', async () => {
    const { calls } = await hitRun({}, baseConfig({
      budgetGuardrailEnabled: true,
      perRequestMaxEstimatedCostUsd: 0.01,
    }));
    assert.equal(calls.estimateFallbackCost, 0);
  });

  it('the reuse gate runs strictly BEFORE availability and budget in call order', async () => {
    const { calls } = await hitRun();
    assert.deepEqual(calls.order, ['resolveAttempt1', 'runApollo', 'evaluateLocalCandidateReuse']);
    assert.equal(calls.order.includes('isFallbackProviderAvailable'), false);
    assert.equal(calls.order.includes('estimateFallbackCostUsd'), false);
  });

  it('creates 0 candidate rows: Apollo created none and no Lusha runner ever ran', async () => {
    const { result, calls } = await hitRun();
    assert.equal(result.attempt1?.result.candidatesCreated, 0);
    assert.equal(calls.runLusha, 0);
    assert.equal(calls.createFallback, 0);
  });

  it('writes exactly one telemetry row, on ATTEMPT #1, and no provider usage log', async () => {
    const { calls } = await hitRun();
    assert.equal(calls.writeTelemetry.length, 1);
    const write = calls.writeTelemetry[0];
    assert.equal(write.attemptId, 'attempt-1');
    assert.equal(write.columns.provider_attempt_role, 'primary');
    assert.equal(write.columns.fallback_reason, 'zero_reviewable_candidates');
    assert.equal(write.columns.routing_mode, 'automatic');
    // The orchestrator has no provider_usage_logs writer at all — the only
    // persistence hook it owns is writeRoutingTelemetry.
    assert.doesNotMatch(executableSource(ORCHESTRATOR), /provider_usage_logs/);
  });

  it('telemetry preserves the primary-provider truth and carries the reuse evidence', async () => {
    const { calls } = await hitRun();
    const summary = calls.writeTelemetry[0].summary as {
      actual_provider: string;
      would_recommend_fallback: boolean;
      fallback_executed: boolean;
      fallback_attempt_run_id: string | null;
      evidence: { local_lusha_reuse: Record<string, unknown> };
    };
    assert.equal(summary.actual_provider, 'apollo');
    assert.equal(summary.would_recommend_fallback, true);
    assert.equal(summary.fallback_executed, false);
    assert.equal(summary.fallback_attempt_run_id, null);

    const evidence = summary.evidence.local_lusha_reuse;
    assert.equal(evidence.gate_applied, true);
    assert.equal(evidence.actionable_reusable_candidate_count, 1);
    assert.equal(evidence.threshold, 1);
    assert.equal(evidence.provider_calls, 0);
    assert.equal(evidence.outcome, 'fallback_satisfied_by_existing_candidate');
    assert.equal(evidence.company_scope_kind, 'account_id');

    const serialized = JSON.stringify(summary);
    for (const forbidden of ['avoided_paid_calls', 'credits_saved', 'usd_saved', 'projected_savings']) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} must not be claimed`);
    }
  });
});

// ── 10–12. A free local result survives hostile provider conditions ──

describe('local reuse cannot be defeated by provider conditions', () => {
  async function hostileRun(
    overrides: Partial<AutomaticRoutingOrchestratorDeps>,
    config = baseConfig(),
  ) {
    const { deps, calls } = harness(config, {
      evaluateLocalCandidateReuse: async () => {
        calls.evaluateLocalReuse += 1;
        calls.order.push('evaluateLocalCandidateReuse');
        return reuseHit();
      },
      ...overrides,
    });
    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
    return { result, calls };
  }

  it('A — Lusha provider unavailable: reuse still succeeds locally', async () => {
    const { result, calls } = await hostileRun({
      isFallbackProviderAvailable: async () => {
        calls.isFallbackAvailable += 1;
        return false;
      },
    });
    assert.equal(result.outcome, 'fallback_skipped_local_reuse');
    assert.equal(result.reusedExistingCandidates, 1);
    assert.equal(calls.isFallbackAvailable, 0);
  });

  it('B — Lusha API key absent (availability throws): reuse still succeeds locally', async () => {
    const { result, calls } = await hostileRun({
      isFallbackProviderAvailable: async () => {
        calls.isFallbackAvailable += 1;
        throw new Error('LUSHA_API_KEY missing — must never be reached');
      },
    });
    assert.equal(result.outcome, 'fallback_skipped_local_reuse');
    assert.equal(calls.isFallbackAvailable, 0);
  });

  it('C — a budget that WOULD block a provider fallback: reuse still succeeds locally', async () => {
    const { result, calls } = await hostileRun(
      {
        estimateFallbackCostUsd: () => {
          calls.estimateFallbackCost += 1;
          return 999;
        },
      },
      baseConfig({ budgetGuardrailEnabled: true, perRequestMaxEstimatedCostUsd: 0.0001 }),
    );
    assert.equal(result.outcome, 'fallback_skipped_local_reuse');
    assert.equal(result.blockedReason, null);
    assert.equal(result.fallbackReason, 'zero_reviewable_candidates');
    assert.equal(calls.estimateFallbackCost, 0);
  });

  it('D — unknown hypothetical fallback cost: reuse still succeeds locally', async () => {
    const { result, calls } = await hostileRun(
      {
        estimateFallbackCostUsd: () => {
          calls.estimateFallbackCost += 1;
          return null;
        },
      },
      baseConfig({ budgetGuardrailEnabled: true, perRequestMaxEstimatedCostUsd: 5 }),
    );
    assert.equal(result.outcome, 'fallback_skipped_local_reuse');
    assert.equal(calls.estimateFallbackCost, 0);
  });
});

// ── 13–16. Reuse MISS: existing behaviour unchanged ─────────────

describe('reuse MISS leaves the existing pipeline untouched', () => {
  async function missRun(
    reuse: LushaLocalReuseGateResultV1,
    overrides: Partial<AutomaticRoutingOrchestratorDeps> = {},
    config = baseConfig(),
  ) {
    const { deps, calls } = harness(config, {
      evaluateLocalCandidateReuse: async () => {
        calls.evaluateLocalReuse += 1;
        calls.order.push('evaluateLocalCandidateReuse');
        return reuse;
      },
      ...overrides,
    });
    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);
    return { result, calls };
  }

  it('existing fallback availability behaviour is unchanged (unavailable still blocks)', async () => {
    let availabilityLookups = 0;
    const { result, calls } = await missRun(reuseMiss(), {
      isFallbackProviderAvailable: async () => {
        availabilityLookups += 1;
        return false;
      },
    });
    assert.equal(result.outcome, 'fallback_provider_unavailable');
    assert.equal(result.blockedReason, 'fallback_provider_unavailable');
    assert.equal(result.reusedExistingCandidates, 0);
    assert.equal(availabilityLookups, 1);
    assert.equal(calls.createFallback, 0);
  });

  it('existing budget behaviour is unchanged (unknown cost under a cap still blocks)', async () => {
    const { result, calls } = await missRun(
      reuseMiss(),
      {},
      baseConfig({ budgetGuardrailEnabled: true, perRequestMaxEstimatedCostUsd: 5 }),
    );
    assert.equal(result.outcome, 'fallback_blocked_by_budget');
    assert.equal(result.fallbackReason, 'budget_guardrail');
    assert.equal(result.reusedExistingCandidates, 0);
    assert.equal(calls.estimateFallbackCost, 1);
    assert.equal(calls.createFallback, 0);
  });

  it('full fallback still executes and reports reusedExistingCandidates = 0', async () => {
    const { result, calls } = await missRun(reuseMiss());
    assert.equal(result.outcome, 'fallback_executed');
    assert.equal(result.fallbackExecuted, true);
    assert.equal(result.reusedExistingCandidates, 0);
    assert.equal(calls.runLusha, 1);
    assert.deepEqual(calls.order, [
      'resolveAttempt1',
      'runApollo',
      'evaluateLocalCandidateReuse',
      'isFallbackProviderAvailable',
      'estimateFallbackCostUsd',
      'createFallbackAttempt',
      'runLushaAttempt',
    ]);
  });

  it('a lookup error fails OPEN into the existing fallback', async () => {
    const { result, calls } = await missRun(reuseMiss('lookup_error', 'connection_reset'));
    assert.equal(result.outcome, 'fallback_executed');
    assert.equal(result.reusedExistingCandidates, 0);
    assert.equal(calls.runLusha, 1);
  });

  it('no deterministic company key fails OPEN into the existing fallback', async () => {
    const { result, calls } = await missRun(reuseMiss('no_deterministic_company_key'));
    assert.equal(result.outcome, 'fallback_executed');
    assert.equal(calls.runLusha, 1);
  });
});

// ── 33. candidatesCreated semantics ─────────────────────────────

describe('candidatesCreated semantics are never mutated or reinterpreted', () => {
  it('the reuse count is a separate field and no combined effective count is exposed', async () => {
    const { deps, calls } = harness(baseConfig(), {
      evaluateLocalCandidateReuse: async () => {
        calls.evaluateLocalReuse += 1;
        return reuseHit(4);
      },
    });
    const result = await runAutomaticContactEnrichmentFallbackForRequest(INPUT, deps);

    assert.equal(result.reusedExistingCandidates, 4);
    // Apollo's own counter is untouched by the reuse branch.
    assert.equal(result.attempt1?.result.candidatesCreated, 0);
    assert.equal('effectiveReviewableCandidateCount' in result, false);
    assert.equal('candidatesCreated' in result, false);
  });

  it('the orchestrator source never derives a combined effective candidate count', async () => {
    const source = executableSource(ORCHESTRATOR);
    assert.doesNotMatch(source, /effectiveReviewableCandidateCount/);
    assert.doesNotMatch(source, /candidates_created/);
  });
});

// ── #315 interaction + no direct contactId re-enrich ────────────

describe('#315 interaction and the no-automatic-re-enrich invariant', () => {
  it('the local gate never calls the controlled direct-contactId Lusha enrich runner', async () => {
    for (const source of [executableSource(REUSE_GATE), executableSource(ORCHESTRATOR)]) {
      assert.doesNotMatch(source, /executeControlledLushaContactEnrichRun/);
      assert.doesNotMatch(source, /contacts\/enrich/);
    }
  });

  it('the local gate performs no write, no provider call and no phone reveal', async () => {
    const source = executableSource(REUSE_GATE);
    assert.doesNotMatch(source, /\.(insert|update|delete|upsert|rpc)\s*\(/);
    assert.doesNotMatch(source, /fetch\s*\(/);
    assert.doesNotMatch(source, /phone_reveal|revealPhone/);
    assert.doesNotMatch(source, /hubspot(?!_company_id|CompanyId)/i);
  });

  it('the local gate delegates company identity to the #315 helpers instead of duplicating them', async () => {
    const source = executableSource(REUSE_GATE);
    assert.match(source, /from '\.\/provider-native-novelty-gate'/);
    assert.match(source, /matchesDeterministicCompanyScope/);
    assert.match(source, /resolveStrongestCompanyScopeKind/);
    assert.match(source, /hasDeterministicCompanyKey/);
    // No re-implemented company matcher, and no forbidden identity signal.
    assert.doesNotMatch(source, /function matchesDeterministicCompanyScope/);
    assert.doesNotMatch(source, /companyName|company_name|fuzzy|levenshtein/i);
  });

  it('#315 provider-native novelty module is not modified by this gate (import-only relationship)', async () => {
    assert.doesNotMatch(rawSource(NOVELTY_GATE), /lusha-local-candidate-reuse-gate/);
  });
});

// ── Stale comments no longer contradict executable code ─────────

describe('stale "ships dark / no caller" prose is corrected', () => {
  it('the orchestrator no longer claims that no caller invokes it', async () => {
    const prose = rawSource(ORCHESTRATOR)
      .split('\n')
      .filter((line) => line.trimStart().startsWith('//') || line.trimStart().startsWith('*'))
      .join('\n');
    assert.doesNotMatch(prose, /No caller in this codebase invokes this/);
    assert.doesNotMatch(prose, /ships the orchestrator dark/);
    assert.match(prose, /LIVE, NOT DARK/);
  });
});

// ── Self-check: the static guards above are tested in the NEGATIVE ──────
//
// A comment-stripping guard is only trustworthy if it can still FAIL. These
// assertions prove the stripper removes prose without swallowing code, so a
// broken stripper cannot silently green-light every guard above.

describe('executableSource is a real guard, not a no-op', () => {
  it('strips line and block comments but keeps executable text', () => {
    const source = executableSource(REUSE_GATE);
    assert.ok(source.includes('export function isActionableReusableLushaCandidate'));
    assert.ok(source.includes("from './provider-native-novelty-gate'"));
    // These tokens exist in this module ONLY inside prose.
    assert.doesNotMatch(source, /provider_usage_logs/);
    assert.ok(rawSource(REUSE_GATE).includes('provider_usage_logs'));
  });

  it('would still catch a forbidden token that appeared in real code', () => {
    const stripped = executableSource(REUSE_GATE);
    // Sanity: the stripper is not returning an empty or gutted string.
    assert.ok(stripped.trim().length > 2_000);
    assert.match(stripped, /matchesDeterministicCompanyScope/);
  });
});
