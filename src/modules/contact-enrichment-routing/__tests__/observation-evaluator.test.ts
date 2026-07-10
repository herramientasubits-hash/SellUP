/**
 * Tests — Routing Observation Evaluator (17B.4X.7A, § 24–26)
 *
 * Observation safety: a fallback observed on a NON-primary attempt must
 * never be reported as "the policy would have fallen back" — the draft
 * policy never executed that attempt's provider (§ 12, § 17).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  evaluateRoutingObservationV1,
  validateRoutingObservationPolicyV1,
} from '../policy-evaluator';
import type {
  RoutingAttemptObservationInputV1,
  RoutingObservationPolicyV1,
} from '../types';

function policy(overrides: Partial<Parameters<typeof validateRoutingObservationPolicyV1>[0]> = {}): RoutingObservationPolicyV1 {
  const result = validateRoutingObservationPolicyV1({
    mode: 'observe_only',
    policyVersion: 1,
    candidatePrimaryProvider: 'apollo',
    fallbackProvider: 'lusha',
    enabledFallbackReasons: ['provider_error', 'zero_reviewable_candidates'],
    maxProviderAttempts: 2,
    ...overrides,
  });
  if (!result.valid) throw new Error('test fixture policy must be valid');
  return result.policy;
}

function attempt(overrides: Partial<RoutingAttemptObservationInputV1> = {}): RoutingAttemptObservationInputV1 {
  return {
    actualProvider: 'apollo',
    attemptOrder: 1,
    technicalOutcome: 'technical_success',
    reviewableCandidateCount: 3,
    ...overrides,
  };
}

describe('evaluateRoutingObservationV1', () => {
  it('TEST 15 — primary match + enabled provider_error + attempt 1 → policy fallback matched, not executed', () => {
    const result = evaluateRoutingObservationV1(
      policy(),
      attempt({ actualProvider: 'apollo', attemptOrder: 1, technicalOutcome: 'technical_failure' }),
    );
    assert.equal(result.primaryMatch, true);
    assert.equal(result.observedFallbackReason, 'provider_error');
    assert.equal(result.policyFallbackConditionMatched, true);
    assert.equal(result.wouldFallbackToProvider, 'lusha');
    assert.equal(result.fallbackNotExecuted, true);
    assert.equal(result.state, 'fallback_condition_matched');
  });

  it('TEST 16 — evaluator module imports no runner/provider/DB modules (zero provider calls, structurally)', () => {
    const source = readFileSync(path.join(__dirname, '..', 'policy-evaluator.ts'), 'utf8');
    const forbidden = [
      'apollo-enrichment-runner',
      'lusha-enrichment-runner',
      'provider-effectiveness/actions',
      'provider-effectiveness/queries',
      '@supabase',
      'next/server',
      'react',
    ];
    for (const needle of forbidden) {
      assert.equal(source.includes(needle), false, `must not import ${needle}`);
    }
  });

  it('TEST 17 — actual provider differs from candidate primary + provider_error → signal visible, no policy match', () => {
    const result = evaluateRoutingObservationV1(
      policy({ candidatePrimaryProvider: 'apollo', fallbackProvider: 'lusha' }),
      attempt({ actualProvider: 'lusha', attemptOrder: 1, technicalOutcome: 'technical_failure' }),
    );
    assert.equal(result.primaryMatch, false);
    assert.equal(result.observedFallbackReason, 'provider_error');
    assert.equal(result.policyFallbackConditionMatched, false);
    assert.equal(result.wouldFallbackToProvider, null);
    assert.equal(result.fallbackNotExecuted, true);
    assert.equal(result.state, 'actual_provider_differs_from_policy_primary');
  });

  it('TEST 18 — fallback reason disabled → signal visible, no policy match', () => {
    const result = evaluateRoutingObservationV1(
      policy({ enabledFallbackReasons: ['zero_reviewable_candidates'] }),
      attempt({ actualProvider: 'apollo', attemptOrder: 1, technicalOutcome: 'technical_failure' }),
    );
    assert.equal(result.observedFallbackReason, 'provider_error');
    assert.equal(result.fallbackReasonEnabled, false);
    assert.equal(result.policyFallbackConditionMatched, false);
    assert.equal(result.wouldFallbackToProvider, null);
    assert.equal(result.state, 'no_fallback_condition');
  });

  it('TEST 19 — attemptOrder = 2 + enabled fallback reason → attempt_cap_reached, no wouldFallback provider', () => {
    const result = evaluateRoutingObservationV1(
      policy(),
      attempt({ actualProvider: 'apollo', attemptOrder: 2, technicalOutcome: 'technical_failure' }),
    );
    assert.equal(result.policyFallbackConditionMatched, false);
    assert.equal(result.fallbackEligibleWithinAttemptCap, false);
    assert.equal(result.wouldFallbackToProvider, null);
    assert.equal(result.state, 'attempt_cap_reached');
  });

  it('TEST 20 — technical_unknown → no policy fallback', () => {
    const result = evaluateRoutingObservationV1(
      policy(),
      attempt({ actualProvider: 'apollo', attemptOrder: 1, technicalOutcome: 'technical_unknown' }),
    );
    assert.equal(result.observedFallbackReason, null);
    assert.equal(result.policyFallbackConditionMatched, false);
    assert.equal(result.wouldFallbackToProvider, null);
    assert.equal(result.state, 'technical_outcome_unknown');
  });

  it('TEST 21 — no fallback condition (technical_success, reviewables present) → no policy fallback', () => {
    const result = evaluateRoutingObservationV1(
      policy(),
      attempt({ actualProvider: 'apollo', attemptOrder: 1, technicalOutcome: 'technical_success', reviewableCandidateCount: 5 }),
    );
    assert.equal(result.observedFallbackReason, null);
    assert.equal(result.policyFallbackConditionMatched, false);
    assert.equal(result.wouldFallbackToProvider, null);
    assert.equal(result.state, 'policy_primary_observed');
  });

  it('TEST 22 — same input evaluated twice → deepStrictEqual outputs', () => {
    const p = policy();
    const a = attempt({ actualProvider: 'apollo', attemptOrder: 1, technicalOutcome: 'technical_failure' });
    const first = evaluateRoutingObservationV1(p, a);
    const second = evaluateRoutingObservationV1(p, a);
    assert.deepStrictEqual(first, second);
  });

  it('TEST 23 — enabledFallbackReasons order differs, semantic set identical → same semantic result', () => {
    const a = attempt({ actualProvider: 'apollo', attemptOrder: 1, technicalOutcome: 'technical_failure' });
    const resultA = evaluateRoutingObservationV1(
      policy({ enabledFallbackReasons: ['provider_error', 'zero_reviewable_candidates'] }),
      a,
    );
    const resultB = evaluateRoutingObservationV1(
      policy({ enabledFallbackReasons: ['zero_reviewable_candidates', 'provider_error'] }),
      a,
    );
    assert.equal(resultA.policyFallbackConditionMatched, resultB.policyFallbackConditionMatched);
    assert.equal(resultA.wouldFallbackToProvider, resultB.wouldFallbackToProvider);
    assert.equal(resultA.state, resultB.state);
  });

  it('TEST 24 — policy candidate primary Lusha, actual provider Apollo → evaluator does not override candidate primary', () => {
    const result = evaluateRoutingObservationV1(
      policy({ candidatePrimaryProvider: 'lusha', fallbackProvider: 'apollo' }),
      attempt({ actualProvider: 'apollo', attemptOrder: 1, technicalOutcome: 'technical_failure' }),
    );
    assert.equal(result.candidatePrimaryProvider, 'lusha');
    assert.equal(result.primaryMatch, false);
    assert.equal(result.state, 'actual_provider_differs_from_policy_primary');
  });
});
