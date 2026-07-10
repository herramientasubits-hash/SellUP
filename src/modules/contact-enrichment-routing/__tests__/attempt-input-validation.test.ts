/**
 * Tests — Routing Attempt Observation Input Validation (17B.4X.7A, § 22)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateRoutingAttemptObservationInputV1 } from '../policy-evaluator';
import type { RoutingAttemptObservationInputDraftV1 } from '../types';

function draft(
  overrides: Partial<RoutingAttemptObservationInputDraftV1> = {},
): RoutingAttemptObservationInputDraftV1 {
  return {
    actualProvider: 'apollo',
    attemptOrder: 1,
    technicalOutcome: 'technical_success',
    reviewableCandidateCount: 3,
    ...overrides,
  };
}

describe('validateRoutingAttemptObservationInputV1', () => {
  it('valid attempt input → accepted', () => {
    const result = validateRoutingAttemptObservationInputV1(draft());
    assert.equal(result.valid, true);
  });

  it('TEST 7 — attemptOrder 0 → rejected', () => {
    const result = validateRoutingAttemptObservationInputV1(draft({ attemptOrder: 0 }));
    assert.equal(result.valid, false);
    if (result.valid) throw new Error('expected invalid');
    assert.ok(result.errors.some((e) => e.code === 'invalid_attempt_order'));
  });

  it('TEST 8 — attemptOrder decimal → rejected', () => {
    const result = validateRoutingAttemptObservationInputV1(draft({ attemptOrder: 1.5 }));
    assert.equal(result.valid, false);
    if (result.valid) throw new Error('expected invalid');
    assert.ok(result.errors.some((e) => e.code === 'invalid_attempt_order'));
  });

  it('TEST 9 — reviewableCandidateCount negative → rejected', () => {
    const result = validateRoutingAttemptObservationInputV1(draft({ reviewableCandidateCount: -1 }));
    assert.equal(result.valid, false);
    if (result.valid) throw new Error('expected invalid');
    assert.ok(result.errors.some((e) => e.code === 'invalid_reviewable_candidate_count'));
  });

  it('TEST 10 — reviewableCandidateCount decimal → rejected', () => {
    const result = validateRoutingAttemptObservationInputV1(draft({ reviewableCandidateCount: 2.5 }));
    assert.equal(result.valid, false);
    if (result.valid) throw new Error('expected invalid');
    assert.ok(result.errors.some((e) => e.code === 'invalid_reviewable_candidate_count'));
  });

  it('attemptOrder NaN → rejected, not silently coerced', () => {
    const result = validateRoutingAttemptObservationInputV1(draft({ attemptOrder: NaN }));
    assert.equal(result.valid, false);
    if (result.valid) throw new Error('expected invalid');
    assert.ok(result.errors.some((e) => e.code === 'invalid_attempt_order'));
  });

  it('attemptOrder Infinity → rejected', () => {
    const result = validateRoutingAttemptObservationInputV1(draft({ attemptOrder: Infinity }));
    assert.equal(result.valid, false);
    if (result.valid) throw new Error('expected invalid');
    assert.ok(result.errors.some((e) => e.code === 'invalid_attempt_order'));
  });

  it('invalid actualProvider string → rejected', () => {
    const result = validateRoutingAttemptObservationInputV1(draft({ actualProvider: 'hunter' }));
    assert.equal(result.valid, false);
    if (result.valid) throw new Error('expected invalid');
    assert.ok(result.errors.some((e) => e.code === 'invalid_actual_provider'));
  });

  it('invalid technicalOutcome string → rejected', () => {
    const result = validateRoutingAttemptObservationInputV1(draft({ technicalOutcome: 'success' }));
    assert.equal(result.valid, false);
    if (result.valid) throw new Error('expected invalid');
    assert.ok(result.errors.some((e) => e.code === 'invalid_technical_outcome'));
  });

  it('reviewableCandidateCount 0 is valid (non-negative integer)', () => {
    const result = validateRoutingAttemptObservationInputV1(draft({ reviewableCandidateCount: 0 }));
    assert.equal(result.valid, true);
  });
});
