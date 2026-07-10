/**
 * Tests — Observed Fallback Signal Derivation (17B.4X.7A, § 23)
 *
 * Signal derivation looks only at the actual attempt's technical outcome and
 * reviewable count. technical_failure always wins over a zero-reviewable
 * read (§ 11) — never reinterpreted as a commercial zero-output outcome.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveObservedFallbackReasonV1 } from '../policy-evaluator';
import type { RoutingAttemptObservationInputV1 } from '../types';

function attempt(overrides: Partial<RoutingAttemptObservationInputV1> = {}): RoutingAttemptObservationInputV1 {
  return {
    actualProvider: 'apollo',
    attemptOrder: 1,
    technicalOutcome: 'technical_success',
    reviewableCandidateCount: 0,
    ...overrides,
  };
}

describe('deriveObservedFallbackReasonV1', () => {
  it('TEST 11 — technical_failure + 0 reviewables → provider_error, NOT zero_reviewable_candidates', () => {
    const reason = deriveObservedFallbackReasonV1(
      attempt({ technicalOutcome: 'technical_failure', reviewableCandidateCount: 0 }),
    );
    assert.equal(reason, 'provider_error');
  });

  it('technical_failure + 5 reviewables → still provider_error (failure dominates)', () => {
    const reason = deriveObservedFallbackReasonV1(
      attempt({ technicalOutcome: 'technical_failure', reviewableCandidateCount: 5 }),
    );
    assert.equal(reason, 'provider_error');
  });

  it('TEST 12 — technical_success + 0 reviewables → zero_reviewable_candidates', () => {
    const reason = deriveObservedFallbackReasonV1(
      attempt({ technicalOutcome: 'technical_success', reviewableCandidateCount: 0 }),
    );
    assert.equal(reason, 'zero_reviewable_candidates');
  });

  it('TEST 13 — technical_success + 5 reviewables → no signal', () => {
    const reason = deriveObservedFallbackReasonV1(
      attempt({ technicalOutcome: 'technical_success', reviewableCandidateCount: 5 }),
    );
    assert.equal(reason, null);
  });

  it('TEST 14 — technical_unknown + 0 reviewables → no signal', () => {
    const reason = deriveObservedFallbackReasonV1(
      attempt({ technicalOutcome: 'technical_unknown', reviewableCandidateCount: 0 }),
    );
    assert.equal(reason, null);
  });

  it('technical_unknown + 5 reviewables → no signal', () => {
    const reason = deriveObservedFallbackReasonV1(
      attempt({ technicalOutcome: 'technical_unknown', reviewableCandidateCount: 5 }),
    );
    assert.equal(reason, null);
  });
});
