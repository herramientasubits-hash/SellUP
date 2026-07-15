// Tests — Automatic Fallback Decision Core (Hito 17B.4X.7C.5B)
//
// Pure functions only — no mocks, no DI, no Supabase, no provider calls.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveApolloProviderCallAttemptedV1,
  deriveApolloTechnicalOutcomeV1,
  deriveAttempt1FallbackSignalV1,
  evaluateBudgetGuardrailV1,
} from '../contact-enrichment-fallback-decision-core';
import { APOLLO_NOT_CONNECTED_REASON } from '../apollo-people-adapter';
import type { RoutingObservationPolicyV1 } from '@/modules/contact-enrichment-routing/types';

const POLICY_ZERO_ONLY: RoutingObservationPolicyV1 = {
  mode: 'observe_only',
  policyVersion: 1,
  candidatePrimaryProvider: 'apollo',
  fallbackProvider: 'lusha',
  enabledFallbackReasons: ['zero_reviewable_candidates'],
  maxProviderAttempts: 2,
};

const POLICY_BOTH_REASONS: RoutingObservationPolicyV1 = {
  ...POLICY_ZERO_ONLY,
  enabledFallbackReasons: ['zero_reviewable_candidates', 'provider_error'],
};

describe('resolveApolloProviderCallAttemptedV1', () => {
  it('returns false for skipped (insufficient identity data)', () => {
    assert.equal(resolveApolloProviderCallAttemptedV1({ providerStatus: 'skipped' }), false);
  });

  it('returns false for error with the not-connected reason', () => {
    assert.equal(
      resolveApolloProviderCallAttemptedV1({ providerStatus: 'error', error: APOLLO_NOT_CONNECTED_REASON }),
      false,
    );
  });

  it('returns true for a real provider error', () => {
    assert.equal(
      resolveApolloProviderCallAttemptedV1({ providerStatus: 'error', error: 'Apollo returned a 500' }),
      true,
    );
  });

  it('returns true for success', () => {
    assert.equal(resolveApolloProviderCallAttemptedV1({ providerStatus: 'success' }), true);
  });
});

describe('deriveApolloTechnicalOutcomeV1', () => {
  it('maps error -> technical_failure, success -> technical_success, skipped -> technical_unknown', () => {
    assert.equal(deriveApolloTechnicalOutcomeV1({ providerStatus: 'error' }), 'technical_failure');
    assert.equal(deriveApolloTechnicalOutcomeV1({ providerStatus: 'success' }), 'technical_success');
    assert.equal(deriveApolloTechnicalOutcomeV1({ providerStatus: 'skipped' }), 'technical_unknown');
  });
});

describe('deriveAttempt1FallbackSignalV1', () => {
  it('recommends fallback on zero reviewable candidates when enabled', () => {
    const signal = deriveAttempt1FallbackSignalV1(POLICY_ZERO_ONLY, {
      actualProvider: 'apollo',
      technicalOutcome: 'technical_success',
      reviewableCandidateCount: 0,
    });
    assert.equal(signal?.wouldRecommendFallback, true);
    assert.equal(signal?.fallbackReasonForTelemetry, 'zero_reviewable_candidates');
  });

  it('does not recommend fallback when candidates exist', () => {
    const signal = deriveAttempt1FallbackSignalV1(POLICY_ZERO_ONLY, {
      actualProvider: 'apollo',
      technicalOutcome: 'technical_success',
      reviewableCandidateCount: 5,
    });
    assert.equal(signal?.wouldRecommendFallback, false);
    assert.equal(signal?.fallbackReasonForTelemetry, 'not_applicable');
  });

  it('does not recommend fallback on provider_error when that reason is disabled', () => {
    const signal = deriveAttempt1FallbackSignalV1(POLICY_ZERO_ONLY, {
      actualProvider: 'apollo',
      technicalOutcome: 'technical_failure',
      reviewableCandidateCount: 0,
    });
    assert.equal(signal?.wouldRecommendFallback, false);
    assert.equal(signal?.fallbackReasonForTelemetry, 'not_applicable');
  });

  it('recommends fallback on provider_error when that reason is enabled', () => {
    const signal = deriveAttempt1FallbackSignalV1(POLICY_BOTH_REASONS, {
      actualProvider: 'apollo',
      technicalOutcome: 'technical_failure',
      reviewableCandidateCount: 0,
    });
    assert.equal(signal?.wouldRecommendFallback, true);
    assert.equal(signal?.fallbackReasonForTelemetry, 'provider_error');
  });

  it('returns null for structurally invalid input (defensive)', () => {
    const signal = deriveAttempt1FallbackSignalV1(POLICY_ZERO_ONLY, {
      actualProvider: 'apollo',
      technicalOutcome: 'technical_success',
      reviewableCandidateCount: -1,
    });
    assert.equal(signal, null);
  });
});

describe('evaluateBudgetGuardrailV1', () => {
  it('never blocks when no cap is configured', () => {
    const result = evaluateBudgetGuardrailV1({
      budgetGuardrailEnabled: false,
      perRequestMaxEstimatedCostUsd: null,
      accumulatedCostUsd: 999,
      estimatedFallbackCostUsd: null,
    });
    assert.equal(result.blocked, false);
    assert.equal(result.reason, 'no_cap_configured');
  });

  it('blocks when a cap is configured and the fallback cost is unknown', () => {
    const result = evaluateBudgetGuardrailV1({
      budgetGuardrailEnabled: true,
      perRequestMaxEstimatedCostUsd: 5,
      accumulatedCostUsd: 0,
      estimatedFallbackCostUsd: null,
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'unknown_fallback_cost');
  });

  it('blocks when accumulated + estimated exceeds the cap', () => {
    const result = evaluateBudgetGuardrailV1({
      budgetGuardrailEnabled: true,
      perRequestMaxEstimatedCostUsd: 5,
      accumulatedCostUsd: 4,
      estimatedFallbackCostUsd: 2,
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'cap_exceeded');
  });

  it('allows when accumulated + estimated stays within the cap', () => {
    const result = evaluateBudgetGuardrailV1({
      budgetGuardrailEnabled: true,
      perRequestMaxEstimatedCostUsd: 5,
      accumulatedCostUsd: 1,
      estimatedFallbackCostUsd: 2,
    });
    assert.equal(result.blocked, false);
    assert.equal(result.reason, 'within_cap');
  });
});
