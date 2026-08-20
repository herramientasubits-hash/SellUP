// Tests — Automatic Routing Request Action Core (Hito 17B.4X.7C.5C)
//
// Full dependency injection — no Supabase, no network, no Apollo/Lusha
// calls, no env var is ever flipped (every scenario passes an explicit
// getConfig() via deps, same technique as
// contact-enrichment-routing-orchestrator.test.ts).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runAutomaticContactEnrichmentForRequestCore,
  type RunAutomaticContactEnrichmentForRequestResult,
} from '../automatic-routing-action-core';
import {
  contactEnrichmentChatReducer,
  createInitialContactEnrichmentChatState,
} from '@/components/contact-enrichment/contact-enrichment-chat-reducer';
import type { AutomaticRoutingUiResult } from '@/components/contact-enrichment/contact-enrichment-chat-types';
import type { AutomaticRoutingOrchestratorDeps } from '@/server/agents/contact-enrichment-toolkit/contact-enrichment-routing-orchestrator';
import type { ApolloEnrichmentRunResult } from '@/server/agents/contact-enrichment-toolkit/apollo-enrichment-runner';
import type { LushaRunnerResult } from '@/server/agents/contact-enrichment-toolkit/lusha-enrichment-runner';
import type { ContactEnrichmentRoutingConfigV1 } from '@/modules/contact-enrichment-routing/routing-config.server';
import { CONTACT_ENRICHMENT_ROUTING_V1_AUTOMATIC_POLICY_VERSION } from '@/modules/contact-enrichment-routing/routing-config.server';
import type { AttemptCreationResult } from '@/modules/contact-enrichment/request-attempt-types';

const EVALUATED_AT = '2026-07-15T00:00:00.000Z';
const TRIGGERED_BY = 'user-1';

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

function lushaResult(overrides: Partial<LushaRunnerResult> = {}): LushaRunnerResult {
  return {
    ok: true,
    status: 'success',
    runId: 'attempt-2',
    candidatesCreated: 1,
    duplicatesSkipped: 0,
    rawResultsCount: 1,
    creditsUsed: 1,
    message: 'ok',
    ...overrides,
  };
}

interface RecordedCalls {
  resolveAttempt1: number;
  runApollo: number;
  isFallbackAvailable: number;
  createFallback: number;
  runLusha: number;
  writeTelemetry: number;
}

function harness(
  config: ContactEnrichmentRoutingConfigV1,
  overrides: Partial<AutomaticRoutingOrchestratorDeps> = {},
): { deps: AutomaticRoutingOrchestratorDeps; calls: RecordedCalls } {
  const calls: RecordedCalls = {
    resolveAttempt1: 0,
    runApollo: 0,
    isFallbackAvailable: 0,
    createFallback: 0,
    runLusha: 0,
    writeTelemetry: 0,
  };

  const deps: AutomaticRoutingOrchestratorDeps = {
    getConfig: () => config,
    // Treat the environment as safe: the GAP-3 fail-closed env guard is
    // covered directly in contact-enrichment-routing-orchestrator.test.ts.
    // These core-mapping tests must not depend on process.env being set.
    assertEnvironmentSafe: () => {},
    resolveAttempt1: async () => {
      calls.resolveAttempt1 += 1;
      return { outcome: 'execute', attemptId: 'attempt-1' };
    },
    runApolloAttempt: async () => {
      calls.runApollo += 1;
      return apolloResult();
    },
    isFallbackProviderAvailable: async () => {
      calls.isFallbackAvailable += 1;
      return true;
    },
    createFallbackAttempt: async (): Promise<AttemptCreationResult> => {
      calls.createFallback += 1;
      return { status: 'created', attemptId: 'attempt-2', agentRunId: 'agent-run-2' };
    },
    runLushaAttempt: async () => {
      calls.runLusha += 1;
      return lushaResult();
    },
    estimateFallbackCostUsd: () => null,
    writeRoutingTelemetry: async () => {
      calls.writeTelemetry += 1;
    },
    ...overrides,
  };

  return { deps, calls };
}

describe('runAutomaticContactEnrichmentForRequestCore', () => {
  it('rejects a non-string/blank requestId without touching the orchestrator', async () => {
    const config = baseConfig();
    const { deps, calls } = harness(config);

    const result = await runAutomaticContactEnrichmentForRequestCore('  ', TRIGGERED_BY, EVALUATED_AT, deps);

    assert.equal(result.success, false);
    assert.equal(result.status, 'invalid_request_id');
    assert.equal(result.automaticRoutingEnabled, false);
    assert.equal(calls.resolveAttempt1, 0);
    assert.equal(calls.runApollo, 0);
  });

  it('A — flag off: no-op, no attempt creation, no provider calls, no telemetry', async () => {
    const config = baseConfig({ automaticRoutingEnabled: false, mode: 'observe_only' });
    const { deps, calls } = harness(config);

    const result = await runAutomaticContactEnrichmentForRequestCore('req-1', TRIGGERED_BY, EVALUATED_AT, deps);

    assert.equal(result.success, true);
    assert.equal(result.status, 'automatic_routing_disabled');
    assert.equal(result.automaticRoutingEnabled, false);
    assert.equal(result.fallbackExecuted, false);
    assert.equal(result.attempt1AttemptId, null);
    assert.equal(result.attempt2AttemptId, null);
    assert.equal(calls.resolveAttempt1, 0);
    assert.equal(calls.runApollo, 0);
    assert.equal(calls.createFallback, 0);
    assert.equal(calls.runLusha, 0);
    assert.equal(calls.writeTelemetry, 0);
  });

  it('B — flag on, Apollo success with reviewable candidates: no fallback, no attempt_order=2', async () => {
    const config = baseConfig();
    const { deps, calls } = harness(config, {
      runApolloAttempt: async () => {
        calls.runApollo += 1;
        return apolloResult({ candidatesCreated: 3, providerStatus: 'success' });
      },
    });

    const result = await runAutomaticContactEnrichmentForRequestCore('req-1', TRIGGERED_BY, EVALUATED_AT, deps);

    assert.equal(result.status, 'no_fallback_needed');
    assert.equal(result.automaticRoutingEnabled, true);
    assert.equal(result.fallbackExecuted, false);
    assert.equal(result.attempt1AttemptId, 'attempt-1');
    assert.equal(result.attempt2AttemptId, null);
    assert.equal(calls.runApollo, 1);
    assert.equal(calls.createFallback, 0);
    assert.equal(calls.runLusha, 0);
  });

  it('C — flag on, Apollo zero reviewable candidates: creates attempt_order=2, calls Lusha once', async () => {
    const config = baseConfig();
    const { deps, calls } = harness(config, {
      runApolloAttempt: async () => {
        calls.runApollo += 1;
        return apolloResult({ candidatesCreated: 0, providerStatus: 'success' });
      },
    });

    const result = await runAutomaticContactEnrichmentForRequestCore('req-1', TRIGGERED_BY, EVALUATED_AT, deps);

    assert.equal(result.status, 'fallback_executed');
    assert.equal(result.fallbackExecuted, true);
    assert.equal(result.attempt1AttemptId, 'attempt-1');
    assert.equal(result.attempt2AttemptId, 'attempt-2');
    assert.equal(calls.runApollo, 1);
    assert.equal(calls.createFallback, 1);
    assert.equal(calls.runLusha, 1);
  });

  it('D — provider_error with providerErrorFallbackEnabled=false: no fallback', async () => {
    const config = baseConfig({ providerErrorFallbackEnabled: false, enabledFallbackReasons: ['zero_reviewable_candidates'] });
    const { deps, calls } = harness(config, {
      runApolloAttempt: async () => {
        calls.runApollo += 1;
        return apolloResult({ providerStatus: 'error', error: 'Apollo returned a 500' });
      },
    });

    const result = await runAutomaticContactEnrichmentForRequestCore('req-1', TRIGGERED_BY, EVALUATED_AT, deps);

    assert.equal(result.status, 'no_fallback_needed');
    assert.equal(result.fallbackExecuted, false);
    assert.equal(calls.createFallback, 0);
    assert.equal(calls.runLusha, 0);
  });

  it('E — provider_error with providerErrorFallbackEnabled=true: creates Lusha attempt_order=2', async () => {
    const config = baseConfig({
      providerErrorFallbackEnabled: true,
      enabledFallbackReasons: ['zero_reviewable_candidates', 'provider_error'],
    });
    const { deps, calls } = harness(config, {
      runApolloAttempt: async () => {
        calls.runApollo += 1;
        return apolloResult({ providerStatus: 'error', error: 'Apollo returned a 500' });
      },
    });

    const result = await runAutomaticContactEnrichmentForRequestCore('req-1', TRIGGERED_BY, EVALUATED_AT, deps);

    assert.equal(result.status, 'fallback_executed');
    assert.equal(result.attempt2AttemptId, 'attempt-2');
    assert.equal(calls.createFallback, 1);
    assert.equal(calls.runLusha, 1);
  });

  it('safety: result surface never carries an approval/HubSpot/phone/contact signal', async () => {
    const config = baseConfig();
    const { deps } = harness(config, {
      runApolloAttempt: async () => apolloResult({ candidatesCreated: 0, providerStatus: 'success' }),
    });

    const result = await runAutomaticContactEnrichmentForRequestCore('req-1', TRIGGERED_BY, EVALUATED_AT, deps);

    assert.equal('approved' in result, false);
    assert.equal('hubspot' in result, false);
    assert.equal('phone' in result, false);
    assert.equal('contactId' in result, false);
    assert.equal(result.fallbackExecuted, true);
  });
});

// ── AGENT2A-LUSHA-LOCAL-REUSE-GATE-1 ────────────────────────────

describe('action core surfaces the local reuse contract', () => {
  it('a reuse HIT surfaces status fallback_skipped_local_reuse and reusedExistingCandidates >= 1', async () => {
    const config = baseConfig();
    const { deps, calls } = harness(config, {
      runApolloAttempt: async () => apolloResult({ candidatesCreated: 0, providerStatus: 'success' }),
      evaluateLocalCandidateReuse: async () => ({
        hit: true,
        actionableReusableCandidateCount: 2,
        observability: {
          gate_applied: true,
          gate_skipped_reason: null,
          actionable_reusable_candidate_count: 2,
          threshold: 1,
          provider_calls: 0,
          outcome: 'fallback_satisfied_by_existing_candidate',
          company_scope_kind: 'account_id',
          lookup_error: null,
        },
      }),
    });

    const result = await runAutomaticContactEnrichmentForRequestCore('req-1', TRIGGERED_BY, EVALUATED_AT, deps);

    assert.equal(result.success, true);
    assert.equal(result.status, 'fallback_skipped_local_reuse');
    assert.equal(result.reusedExistingCandidates, 2);
    assert.equal(result.fallbackExecuted, false);
    assert.equal(result.attempt1AttemptId, 'attempt-1');
    assert.equal(result.attempt2AttemptId, null);
    assert.equal(result.blockedReason, null);
    assert.equal(calls.createFallback, 0);
    assert.equal(calls.runLusha, 0);
  });

  it('every non-reuse branch reports reusedExistingCandidates = 0', async () => {
    const flagOff = harness(baseConfig({ automaticRoutingEnabled: false, mode: 'observe_only' }));
    const disabled = await runAutomaticContactEnrichmentForRequestCore('req-1', TRIGGERED_BY, EVALUATED_AT, flagOff.deps);
    assert.equal(disabled.status, 'automatic_routing_disabled');
    assert.equal(disabled.reusedExistingCandidates, 0);

    const executed = harness(baseConfig(), {
      runApolloAttempt: async () => apolloResult({ candidatesCreated: 0, providerStatus: 'success' }),
    });
    const fallback = await runAutomaticContactEnrichmentForRequestCore('req-1', TRIGGERED_BY, EVALUATED_AT, executed.deps);
    assert.equal(fallback.status, 'fallback_executed');
    assert.equal(fallback.reusedExistingCandidates, 0);

    const invalid = await runAutomaticContactEnrichmentForRequestCore(42, TRIGGERED_BY, EVALUATED_AT);
    assert.equal(invalid.status, 'invalid_request_id');
    assert.equal(invalid.reusedExistingCandidates, 0);
  });

  it('the action-core result never exposes a combined effective candidate count', async () => {
    const { deps } = harness(baseConfig(), {
      runApolloAttempt: async () => apolloResult({ candidatesCreated: 0, providerStatus: 'success' }),
    });
    const result = await runAutomaticContactEnrichmentForRequestCore('req-1', TRIGGERED_BY, EVALUATED_AT, deps);
    assert.equal('effectiveReviewableCandidateCount' in result, false);
    assert.equal('candidatesCreated' in result, false);
    assert.equal('candidates_created' in result, false);
  });
});

describe('wizard stays compatible with the new outcome', () => {
  it('the UI result type accepts the extended server result, and a reuse hit reads as DONE', () => {
    // Structural compatibility: the wizard forwards the server result verbatim
    // into AutomaticRoutingUiResult, whose `status` is intentionally widened to
    // string, so a new outcome value needs no UI type change.
    const serverResult: RunAutomaticContactEnrichmentForRequestResult = {
      success: true,
      status: 'fallback_skipped_local_reuse',
      automaticRoutingEnabled: true,
      fallbackExecuted: false,
      attempt1AttemptId: 'attempt-1',
      attempt2AttemptId: null,
      blockedReason: null,
      reusedExistingCandidates: 1,
    };
    const uiResult: AutomaticRoutingUiResult = serverResult;
    assert.equal(uiResult.status, 'fallback_skipped_local_reuse');

    // The reducer's own classification: routing enabled + an attempt-1 id means
    // "a search ran, candidates are in pending_review" — which is exactly the
    // truth on a local reuse hit, where the pre-existing pending_review
    // candidate remains the reviewable deliverable.
    const settled = contactEnrichmentChatReducer(
      { ...createInitialContactEnrichmentChatState(), step: 'done', requestId: 'req-1' },
      { type: 'AUTOMATIC_ROUTING_SETTLED', result: uiResult },
    );
    assert.equal(settled.step, 'done');
    assert.equal(settled.automaticResult?.status, 'fallback_skipped_local_reuse');
    const last = settled.messages[settled.messages.length - 1];
    assert.equal(last.tone, undefined);
  });
});
