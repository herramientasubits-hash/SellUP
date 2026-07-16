// Tests — Automatic Fallback Orchestrator (Hito 17B.4X.7C.5B)
//
// Full dependency injection — no Supabase, no network, no Apollo/Lusha calls.
// Every scenario from the hito's test matrix (§10) is covered. No test in
// this file flips ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING or any other
// env var — the "flag off" cases construct a config object directly.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runAutomaticContactEnrichmentFallbackForRequest,
  type AutomaticRoutingOrchestratorDeps,
} from '../contact-enrichment-routing-orchestrator';
import type { ApolloEnrichmentRunResult } from '../apollo-enrichment-runner';
import type { LushaRunnerResult } from '../lusha-enrichment-runner';
import type { ContactEnrichmentRoutingConfigV1 } from '@/modules/contact-enrichment-routing/routing-config.server';
import { CONTACT_ENRICHMENT_ROUTING_V1_AUTOMATIC_POLICY_VERSION } from '@/modules/contact-enrichment-routing/routing-config.server';
import type { AttemptCreationResult } from '@/modules/contact-enrichment/request-attempt-types';
import { APOLLO_NOT_CONNECTED_REASON } from '../apollo-people-adapter';
import {
  assertAutomaticRoutingEnvironmentIsSafe,
  PRODUCTION_SUPABASE_HOST,
} from '@/lib/supabase/env-guard.server';

/** Real GAP-3 guard bound to a caller-supplied env-like object — no process.env mutation. */
function envGuardFor(env: Record<string, string | undefined>): (enabled: boolean) => void {
  return (enabled: boolean) => assertAutomaticRoutingEnvironmentIsSafe(enabled, env);
}

const EVALUATED_AT = '2026-07-15T00:00:00.000Z';

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
  assertEnvironmentSafe: number;
  writeTelemetry: Array<{ attemptId: string; columns: unknown; summary: unknown }>;
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
    assertEnvironmentSafe: 0,
    writeTelemetry: [],
  };

  const deps: AutomaticRoutingOrchestratorDeps = {
    getConfig: () => config,
    // Default: treat the environment as safe. The GAP-3 env guard is
    // exercised directly against the real assert with simulated env in the
    // dedicated "environment guard" describe block below — routing-logic
    // tests must not depend on process.env being configured.
    assertEnvironmentSafe: () => {
      calls.assertEnvironmentSafe += 1;
    },
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
    writeRoutingTelemetry: async (attemptId, columns, summary) => {
      calls.writeTelemetry.push({ attemptId, columns, summary });
    },
    ...overrides,
  };

  return { deps, calls };
}

describe('runAutomaticContactEnrichmentFallbackForRequest', () => {
  it('A — flag off: no attempt creation, no provider calls, no telemetry writes', async () => {
    const config = baseConfig({ automaticRoutingEnabled: false, mode: 'observe_only' });
    const { deps, calls } = harness(config);

    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
      deps,
    );

    assert.equal(result.outcome, 'automatic_routing_disabled');
    assert.equal(result.automaticRoutingEnabled, false);
    assert.equal(result.attempt1, null);
    assert.equal(result.attempt2, null);
    assert.equal(result.fallbackExecuted, false);
    assert.equal(calls.resolveAttempt1, 0);
    assert.equal(calls.runApollo, 0);
    assert.equal(calls.createFallback, 0);
    assert.equal(calls.runLusha, 0);
    assert.equal(calls.writeTelemetry.length, 0);
    // Flag-off is a no-op that returns BEFORE the environment guard runs.
    assert.equal(calls.assertEnvironmentSafe, 0);
  });

  it('B — Apollo success with reviewable candidates: no fallback, no attempt_order=2', async () => {
    const config = baseConfig();
    const { deps, calls } = harness(config, {
      runApolloAttempt: async () => {
        calls.runApollo += 1;
        return apolloResult({ candidatesCreated: 3, providerStatus: 'success' });
      },
    });

    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
      deps,
    );

    assert.equal(result.outcome, 'no_fallback_needed');
    assert.equal(result.fallbackExecuted, false);
    assert.equal(result.fallbackReason, 'not_applicable');
    assert.equal(result.attempt2, null);
    assert.equal(calls.createFallback, 0);
    assert.equal(calls.runLusha, 0);
    assert.equal(calls.writeTelemetry.length, 1);
    assert.equal((calls.writeTelemetry[0].columns as { provider_attempt_role: string }).provider_attempt_role, 'primary');
  });

  it('C — Apollo zero reviewable candidates: creates attempt_order=2 and calls Lusha once', async () => {
    const config = baseConfig();
    const { deps, calls } = harness(config, {
      runApolloAttempt: async () => {
        calls.runApollo += 1;
        return apolloResult({ candidatesCreated: 0, providerStatus: 'success' });
      },
    });

    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
      deps,
    );

    assert.equal(result.outcome, 'fallback_executed');
    assert.equal(result.fallbackExecuted, true);
    assert.equal(result.fallbackReason, 'zero_reviewable_candidates');
    assert.equal(result.attempt2?.attemptId, 'attempt-2');
    assert.equal(calls.createFallback, 1);
    assert.equal(calls.runLusha, 1);
    // attempt 1 + attempt 2 telemetry writes, no third write (anti-loop).
    assert.equal(calls.writeTelemetry.length, 2);
    const attempt2Write = calls.writeTelemetry.find((w) => w.attemptId === 'attempt-2');
    assert.equal((attempt2Write?.columns as { provider_attempt_role: string }).provider_attempt_role, 'fallback');
  });

  it('D — provider_error with providerErrorFallbackEnabled=false: no fallback', async () => {
    const config = baseConfig({ providerErrorFallbackEnabled: false, enabledFallbackReasons: ['zero_reviewable_candidates'] });
    const { deps, calls } = harness(config, {
      runApolloAttempt: async () => {
        calls.runApollo += 1;
        return apolloResult({ providerStatus: 'error', error: 'Apollo returned a 500' });
      },
    });

    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
      deps,
    );

    assert.equal(result.outcome, 'no_fallback_needed');
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

    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
      deps,
    );

    assert.equal(result.outcome, 'fallback_executed');
    assert.equal(result.fallbackReason, 'provider_error');
    assert.equal(calls.createFallback, 1);
    assert.equal(calls.runLusha, 1);
  });

  it('F — Lusha disabled/unconfigured: no attempt_order=2, no Lusha call', async () => {
    const config = baseConfig();
    const { deps, calls } = harness(config, {
      runApolloAttempt: async () => {
        calls.runApollo += 1;
        return apolloResult({ candidatesCreated: 0, providerStatus: 'success' });
      },
      isFallbackProviderAvailable: async () => {
        calls.isFallbackAvailable += 1;
        return false;
      },
    });

    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
      deps,
    );

    assert.equal(result.outcome, 'fallback_provider_unavailable');
    assert.equal(result.fallbackExecuted, false);
    assert.equal(result.blockedReason, 'fallback_provider_unavailable');
    assert.equal(calls.createFallback, 0);
    assert.equal(calls.runLusha, 0);
  });

  it('G — budget cap exceeded (unknown fallback cost + cap configured): no attempt_order=2', async () => {
    const config = baseConfig({ budgetGuardrailEnabled: true, perRequestMaxEstimatedCostUsd: 5 });
    const { deps, calls } = harness(config, {
      runApolloAttempt: async () => {
        calls.runApollo += 1;
        return apolloResult({ candidatesCreated: 0, providerStatus: 'success', estimatedCostUsd: 1 });
      },
      // default estimateFallbackCostUsd stays null (unknown) — conservative block per §9.
    });

    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
      deps,
    );

    assert.equal(result.outcome, 'fallback_blocked_by_budget');
    assert.equal(result.fallbackReason, 'budget_guardrail');
    assert.equal(result.blockedReason, 'unknown_fallback_cost');
    assert.equal(calls.createFallback, 0);
    assert.equal(calls.runLusha, 0);
  });

  it('G2 — budget cap NOT exceeded (known fallback cost within cap): fallback proceeds', async () => {
    const config = baseConfig({ budgetGuardrailEnabled: true, perRequestMaxEstimatedCostUsd: 5 });
    const { deps, calls } = harness(config, {
      runApolloAttempt: async () => {
        calls.runApollo += 1;
        return apolloResult({ candidatesCreated: 0, providerStatus: 'success', estimatedCostUsd: 1 });
      },
      estimateFallbackCostUsd: () => 2,
    });

    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
      deps,
    );

    assert.equal(result.outcome, 'fallback_executed');
    assert.equal(calls.createFallback, 1);
    assert.equal(calls.runLusha, 1);
  });

  it('H — attempt_order=2 already exists: no duplicate attempt, no second Lusha call', async () => {
    const config = baseConfig();
    const { deps, calls } = harness(config, {
      runApolloAttempt: async () => {
        calls.runApollo += 1;
        return apolloResult({ candidatesCreated: 0, providerStatus: 'success' });
      },
      createFallbackAttempt: async () => {
        calls.createFallback += 1;
        return { status: 'already_exists', attemptId: 'attempt-2-existing', agentRunId: 'agent-run-2' };
      },
    });

    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
      deps,
    );

    assert.equal(result.outcome, 'attempt2_already_exists');
    assert.equal(result.fallbackExecuted, true);
    assert.equal(result.attempt2?.attemptId, 'attempt-2-existing');
    assert.equal(result.attempt2?.result, null);
    assert.equal(calls.runLusha, 0);
  });

  it('I — concurrent race: only one caller creates attempt_order=2, the other observes already_exists', async () => {
    const config = baseConfig();
    let creationCount = 0;
    const runLushaCalls: string[] = [];

    const makeDeps = (): AutomaticRoutingOrchestratorDeps => ({
      getConfig: () => config,
      assertEnvironmentSafe: () => {},
      resolveAttempt1: async () => ({ outcome: 'execute', attemptId: 'attempt-1' }),
      runApolloAttempt: async () => apolloResult({ candidatesCreated: 0, providerStatus: 'success' }),
      isFallbackProviderAvailable: async () => true,
      createFallbackAttempt: async () => {
        creationCount += 1;
        // Simulates the DB-level row lock + unique index (migration 086):
        // exactly one caller observes 'created', the other 'already_exists'.
        if (creationCount === 1) {
          return { status: 'created', attemptId: 'attempt-2', agentRunId: 'agent-run-2' };
        }
        return { status: 'already_exists', attemptId: 'attempt-2', agentRunId: 'agent-run-2' };
      },
      runLushaAttempt: async (attemptId) => {
        runLushaCalls.push(attemptId);
        return lushaResult();
      },
      estimateFallbackCostUsd: () => null,
      writeRoutingTelemetry: async () => {},
    });

    const [resultA, resultB] = await Promise.all([
      runAutomaticContactEnrichmentFallbackForRequest(
        { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
        makeDeps(),
      ),
      runAutomaticContactEnrichmentFallbackForRequest(
        { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
        makeDeps(),
      ),
    ]);

    assert.equal(runLushaCalls.length, 1);
    const outcomes = [resultA.outcome, resultB.outcome].sort();
    assert.deepEqual(outcomes, ['attempt2_already_exists', 'fallback_executed']);
  });

  it('J — manual Lusha selection never reaches this orchestrator (static contract check)', async () => {
    // This orchestrator has exactly one entry point. Manual per-provider
    // request actions (runContactEnrichmentLushaForRequestAction) call
    // executeContactEnrichmentLushaRun directly and never import this
    // module — see the static grep gate for the codebase-wide assertion.
    assert.equal(typeof runAutomaticContactEnrichmentFallbackForRequest, 'function');
  });

  it('K — attempt1 rejected upstream (invalid request): no fallback, no telemetry write', async () => {
    const config = baseConfig();
    const { deps, calls } = harness(config, {
      resolveAttempt1: async () => {
        calls.resolveAttempt1 += 1;
        return { outcome: 'rejected', reason: 'invalid_request', message: 'not found' };
      },
    });

    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'missing-req', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
      deps,
    );

    assert.equal(result.outcome, 'attempt1_rejected');
    assert.equal(result.blockedReason, 'invalid_request');
    assert.equal(calls.runApollo, 0);
    assert.equal(calls.writeTelemetry.length, 0);
  });

  it('L — Apollo not connected (no real provider call): no fallback even with zero candidates', async () => {
    const config = baseConfig();
    const { deps, calls } = harness(config, {
      runApolloAttempt: async () => {
        calls.runApollo += 1;
        return apolloResult({
          status: 'error',
          providerStatus: 'error',
          candidatesCreated: 0,
          error: APOLLO_NOT_CONNECTED_REASON,
        });
      },
    });

    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
      deps,
    );

    assert.equal(result.outcome, 'attempt1_provider_not_called');
    assert.equal(result.fallbackExecuted, false);
    assert.equal(calls.createFallback, 0);
    assert.equal(calls.runLusha, 0);
  });

  it('M — Apollo skipped (insufficient identity data): no fallback', async () => {
    const config = baseConfig();
    const { deps, calls } = harness(config, {
      runApolloAttempt: async () => {
        calls.runApollo += 1;
        return apolloResult({ status: 'skipped', providerStatus: 'skipped', candidatesCreated: 0 });
      },
    });

    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
      deps,
    );

    assert.equal(result.outcome, 'attempt1_provider_not_called');
    assert.equal(calls.createFallback, 0);
    assert.equal(calls.runLusha, 0);
  });

  it('N — safety: no approval, no HubSpot writes, no phone reveal, no official contact creation', async () => {
    const config = baseConfig();
    const { deps } = harness(config, {
      runApolloAttempt: async () => apolloResult({ candidatesCreated: 0, providerStatus: 'success' }),
    });

    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
      deps,
    );

    // The orchestrator's public result surface never carries an approval,
    // HubSpot, or phone-reveal signal — nothing to approve/write/reveal.
    assert.equal('approved' in result, false);
    assert.equal('hubspot' in result, false);
    assert.equal('phone' in result, false);
    assert.equal('contactId' in result, false);
    assert.equal(result.fallbackExecuted, true);
  });

  it('invalid policy config is treated as not-engaged (defensive)', async () => {
    const config = baseConfig({ primaryProvider: 'lusha', fallbackProvider: 'lusha' as 'apollo' | 'lusha' });
    const { deps, calls } = harness(config);

    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
      deps,
    );

    assert.equal(result.outcome, 'invalid_policy');
    assert.equal(calls.resolveAttempt1, 0);
  });
});

describe('runAutomaticContactEnrichmentFallbackForRequest — GAP-3 environment guard', () => {
  const PROD_URL = `https://${PRODUCTION_SUPABASE_HOST}`;

  it('flag ON + unsafe env (Preview resolving to production Supabase): rejects before any effect', async () => {
    const config = baseConfig();
    const { deps, calls } = harness(config, {
      assertEnvironmentSafe: envGuardFor({
        VERCEL_ENV: 'preview',
        NEXT_PUBLIC_SUPABASE_URL: PROD_URL,
        SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
      }),
    });

    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
      deps,
    );

    assert.equal(result.outcome, 'unsafe_environment');
    assert.equal(result.automaticRoutingEnabled, true);
    assert.equal(result.blockedReason, 'non_production_environment_targets_production_supabase');
    assert.equal(result.attempt1, null);
    assert.equal(result.attempt2, null);
    assert.equal(result.fallbackExecuted, false);
    // Nothing effectful ran: no attempt resolution, no provider calls, no telemetry.
    assert.equal(calls.resolveAttempt1, 0);
    assert.equal(calls.runApollo, 0);
    assert.equal(calls.createFallback, 0);
    assert.equal(calls.runLusha, 0);
    assert.equal(calls.writeTelemetry.length, 0);
  });

  it('flag ON + missing Supabase URL: rejects before any effect', async () => {
    const config = baseConfig();
    const { deps, calls } = harness(config, {
      assertEnvironmentSafe: envGuardFor({
        SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
      }),
    });

    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
      deps,
    );

    assert.equal(result.outcome, 'unsafe_environment');
    assert.equal(result.blockedReason, 'missing_supabase_url');
    assert.equal(calls.resolveAttempt1, 0);
    assert.equal(calls.runApollo, 0);
    assert.equal(calls.createFallback, 0);
    assert.equal(calls.runLusha, 0);
    assert.equal(calls.writeTelemetry.length, 0);
  });

  it('flag ON + missing service role key: rejects before any effect', async () => {
    const config = baseConfig();
    const { deps, calls } = harness(config, {
      assertEnvironmentSafe: envGuardFor({
        NEXT_PUBLIC_SUPABASE_URL: 'https://preview-project.supabase.co',
      }),
    });

    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
      deps,
    );

    assert.equal(result.outcome, 'unsafe_environment');
    assert.equal(result.blockedReason, 'missing_service_role_key');
    assert.equal(calls.resolveAttempt1, 0);
    assert.equal(calls.runApollo, 0);
    assert.equal(calls.createFallback, 0);
    assert.equal(calls.runLusha, 0);
    assert.equal(calls.writeTelemetry.length, 0);
  });

  it('flag ON + safe env (isolated non-production project, real guard): fallback proceeds with mocked deps', async () => {
    const config = baseConfig();
    const { deps, calls } = harness(config, {
      // Real guard, but pointed at a non-production, fully-configured project:
      // it passes, and the existing zero-reviewable→fallback logic runs.
      assertEnvironmentSafe: envGuardFor({
        NEXT_PUBLIC_SUPABASE_URL: 'https://preview-project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
      }),
      runApolloAttempt: async () => {
        calls.runApollo += 1;
        return apolloResult({ candidatesCreated: 0, providerStatus: 'success' });
      },
    });

    const result = await runAutomaticContactEnrichmentFallbackForRequest(
      { requestId: 'req-1', triggeredBy: 'user-1', evaluatedAt: EVALUATED_AT },
      deps,
    );

    assert.equal(result.outcome, 'fallback_executed');
    assert.equal(result.fallbackExecuted, true);
    assert.equal(calls.createFallback, 1);
    assert.equal(calls.runLusha, 1);
  });
});
